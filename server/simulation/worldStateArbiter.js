import { applyGroundedLedgerAction, isProtectedLedgerWrite } from './groundedLedger.js';
import { normalizeActionEnvelope } from './actionProtocol.js';
import { projectWorldClock } from './worldClock.js';
import { advanceSimulationClock, ensureSimulationMemory } from './npcSimulation.js';

const ALLOWED_STATE_ROOTS = new Set([
  'protagonist',
  'location',
  'relationships',
  'quests',
  'factions',
  'flags',
  'timeline',
  'resources',
  'counters',
  'inventory',
  'time',
  'date',
  'currentLocation'
]);

export class WorldStateArbitrationError extends Error {
  constructor(code, detail = '') {
    super(code);
    this.name = 'WorldStateArbitrationError';
    this.code = code;
    this.detail = detail;
  }
}

export function adjudicateActionEnvelope({ memory, envelope, evidenceContext, now = () => new Date() } = {}) {
  const normalized = normalizeActionEnvelope(envelope);
  const next = ensureSimulationMemory(memory);
  const revisionBefore = Number(next.simulation.revision || 0);

  if (normalized.baseRevision !== null && normalized.baseRevision !== revisionBefore) {
    return {
      memory: next,
      result: {
        status: 'rejected',
        code: 'ACTION_REVISION_CONFLICT',
        revisionBefore,
        revisionAfter: revisionBefore,
        accepted: [],
        rejected: normalized.actions.map((action) => ({ action, code: 'ACTION_REVISION_CONFLICT' })),
        effects: []
      }
    };
  }

  if (!next.worldStateBaseline) next.worldStateBaseline = structuredClone(next.worldState || {});
  if (!next.simulationBaseline) next.simulationBaseline = structuredClone(next.simulation);

  const accepted = [];
  const rejected = [];
  const effects = [];
  for (const action of normalized.actions) {
    try {
      assertConditions(next, action.conditions);
      const actionEffects = applyAction(next, action, now, evidenceContext);
      accepted.push({ action, effects: actionEffects });
      effects.push(...actionEffects);
    } catch (error) {
      const arbitrationError = error instanceof WorldStateArbitrationError
        ? error
        : new WorldStateArbitrationError(error.code?.startsWith('LEDGER_') ? error.code : 'ACTION_APPLY_FAILED', error.detail || error.message);
      rejected.push({ action, code: arbitrationError.code, detail: arbitrationError.detail });
    }
  }

  const changed = accepted.length > 0;
  if (changed) next.simulation.revision = revisionBefore + 1;
  const status = accepted.length && rejected.length ? 'partial' : accepted.length ? 'accepted' : 'rejected';
  return {
    memory: next,
    result: {
      status,
      code: status === 'rejected' ? 'ACTION_ALL_REJECTED' : '',
      envelopeId: normalized.id,
      protocol: normalized.spec,
      actorId: normalized.actorId,
      summary: normalized.summary,
      revisionBefore,
      revisionAfter: Number(next.simulation.revision || revisionBefore),
      accepted,
      rejected,
      effects
    }
  };
}

export function replayActionHistory({ memory, messages, now = () => new Date() } = {}) {
  const source = ensureSimulationMemory(memory);
  const next = ensureSimulationMemory({
    ...source,
    worldState: structuredClone(source.worldStateBaseline || source.worldState || {}),
    simulation: structuredClone(source.simulationBaseline || source.simulation),
    eventLedger: []
  });
  const results = new Map();
  const safeMessages = Array.isArray(messages) ? messages : [];
  const checkpointId = String(source.actionCheckpointMessageId || '');
  const checkpointIndex = checkpointId ? safeMessages.findIndex((message) => message?.id === checkpointId) : -1;
  const replayMessages = checkpointIndex >= 0 ? safeMessages.slice(checkpointIndex + 1) : safeMessages;
  let userMessage = null;
  for (const message of replayMessages) {
    if (message?.role === 'user') userMessage = message;
    if (message?.role !== 'assistant'
      || message?.contextExcluded === true
      || message?.excluded === true
      || !message.actionEnvelope) continue;
    const adjudicated = adjudicateActionEnvelope({ memory: next, envelope: message.actionEnvelope, evidenceContext: { userMessage, assistantMessage: message }, now });
    Object.assign(next, adjudicated.memory);
    results.set(message.id, adjudicated.result);
  }
  return { memory: next, results };
}

function applyAction(memory, action, now, evidenceContext) {
  if (action.type === 'commitment.update' || action.type.startsWith('item.')) return applyGroundedLedgerAction(memory, action, evidenceContext);
  if (action.type.startsWith('state.')) return applyStateAction(memory, action);
  if (action.type === 'actor.move') return applyActorField(memory, action, 'location', action.location);
  if (action.type === 'actor.status') return applyActorField(memory, action, 'status', action.status);
  if (action.type === 'actor.knowledge.add') return applyActorKnowledge(memory, action);
  if (action.type === 'actor.relationship.adjust') return applyRelationship(memory, action);
  if (action.type === 'quest.update') return applyQuest(memory, action);
  if (action.type === 'clock.advance') {
    const advanced = advanceSimulationClock(memory.simulation, { minutes: action.minutes, reason: action.reason, now });
    memory.simulation = advanced.simulation;
    memory.worldState.clock = projectWorldClock(memory.worldState.clock, memory.simulation);
    return advanced.effects.map((effect) => ({ ...effect, actionId: action.id }));
  }
  throw new WorldStateArbitrationError('ACTION_TYPE_UNSUPPORTED', action.type);
}

function applyStateAction(memory, action) {
  assertAllowedPath(action.path);
  if (isProtectedLedgerWrite(memory.worldState, action.path, action.value)) throw new WorldStateArbitrationError('LEDGER_DIRECT_WRITE_FORBIDDEN', action.path);
  const segments = action.path.split('.');
  const before = structuredClone(getPath(memory.worldState, segments));
  let after;

  if (action.type === 'state.set') {
    after = structuredClone(action.value);
    setPath(memory.worldState, segments, after);
  } else if (action.type === 'state.increment') {
    const current = before === undefined || before === null ? 0 : Number(before);
    if (!Number.isFinite(current)) throw new WorldStateArbitrationError('ACTION_TARGET_NOT_NUMERIC', action.path);
    after = current + action.delta;
    setPath(memory.worldState, segments, after);
  } else if (action.type === 'state.append') {
    const current = before === undefined || before === null ? [] : before;
    if (!Array.isArray(current)) throw new WorldStateArbitrationError('ACTION_TARGET_NOT_ARRAY', action.path);
    after = structuredClone(current);
    if (!after.some((item) => deepEqual(item, action.value))) after.push(structuredClone(action.value));
    setPath(memory.worldState, segments, after);
  } else {
    const current = before === undefined || before === null ? [] : before;
    if (!Array.isArray(current)) throw new WorldStateArbitrationError('ACTION_TARGET_NOT_ARRAY', action.path);
    after = current.filter((item) => !deepEqual(item, action.value));
    setPath(memory.worldState, segments, after);
  }

  return [effect(action, `worldState.${action.path}`, before, structuredClone(after))];
}

function applyActorField(memory, action, field, value) {
  const actor = findActor(memory, action.actorId);
  const before = actor[field];
  actor[field] = value;
  return [effect(action, `simulation.actors.${actor.id}.${field}`, before, value)];
}

function applyActorKnowledge(memory, action) {
  const actor = findActor(memory, action.actorId);
  const field = action.visibility === 'public' ? 'publicKnowledge' : 'privateKnowledge';
  const before = structuredClone(actor[field]);
  if (!actor[field].includes(action.fact)) actor[field].push(action.fact);
  return [effect(action, `simulation.actors.${actor.id}.${field}`, before, structuredClone(actor[field]))];
}

function applyRelationship(memory, action) {
  const actor = findActor(memory, action.actorId);
  findActor(memory, action.targetId);
  let relationship = actor.relationships.find((item) => item.targetId === action.targetId);
  if (!relationship) {
    relationship = { targetId: action.targetId, trust: 0, tension: 0, lastReason: '' };
    actor.relationships.push(relationship);
  }
  const before = structuredClone(relationship);
  relationship.trust = clamp(relationship.trust + action.delta, -100, 100);
  relationship.lastReason = action.reason;
  return [effect(action, `simulation.actors.${actor.id}.relationships.${action.targetId}`, before, structuredClone(relationship))];
}

function applyQuest(memory, action) {
  const quests = Array.isArray(memory.worldState.quests) ? memory.worldState.quests : [];
  memory.worldState.quests = quests;
  let quest = quests.find((item) => String(item.id || item.questId) === action.questId);
  const before = quest ? structuredClone(quest) : null;
  if (!quest) {
    quest = { id: action.questId, title: action.title || action.questId, status: 'active', progress: 0, notes: [] };
    quests.push(quest);
  }
  if (action.title) quest.title = action.title;
  if (action.status) quest.status = action.status;
  if (action.progress !== null) quest.progress = action.progress;
  if (action.note) {
    quest.notes = Array.isArray(quest.notes) ? quest.notes : [];
    if (!quest.notes.includes(action.note)) quest.notes.push(action.note);
  }
  return [effect(action, `worldState.quests.${action.questId}`, before, structuredClone(quest))];
}

function assertConditions(memory, conditions) {
  for (const condition of conditions || []) {
    const value = resolveConditionPath(memory, condition.path);
    const matched = evaluateCondition(value, condition.operator, condition.value);
    if (!matched) throw new WorldStateArbitrationError('ACTION_CONDITION_NOT_MET', condition.path);
  }
}

function resolveConditionPath(memory, path) {
  const segments = path.split('.');
  if (segments[0] === 'simulation') return getPath(memory, segments);
  return getPath(memory.worldState, segments[0] === 'worldState' ? segments.slice(1) : segments);
}

function evaluateCondition(current, operator, expected) {
  if (operator === 'exists') return expected ? current !== undefined && current !== null : current === undefined || current === null;
  if (operator === 'eq') return deepEqual(current, expected);
  if (operator === 'neq') return !deepEqual(current, expected);
  if (operator === 'gt') return Number(current) > Number(expected);
  if (operator === 'gte') return Number(current) >= Number(expected);
  if (operator === 'lt') return Number(current) < Number(expected);
  if (operator === 'lte') return Number(current) <= Number(expected);
  if (operator === 'includes') return Array.isArray(current) ? current.some((item) => deepEqual(item, expected)) : String(current || '').includes(String(expected || ''));
  return false;
}

function assertAllowedPath(path) {
  const root = path.split('.')[0];
  if (!ALLOWED_STATE_ROOTS.has(root)) throw new WorldStateArbitrationError('ACTION_PATH_FORBIDDEN', path);
}

function findActor(memory, actorId) {
  const actor = memory.simulation.actors.find((item) => item.id === actorId || item.name === actorId);
  if (!actor) throw new WorldStateArbitrationError('ACTION_ACTOR_NOT_FOUND', actorId);
  return actor;
}

function effect(action, path, before, after) {
  return {
    actionId: action.id,
    type: action.type,
    path,
    before,
    after,
    visibility: action.visibility,
    reason: action.reason
  };
}

function getPath(root, segments) {
  let current = root;
  for (const segment of segments) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = current[segment];
  }
  return current;
}

function setPath(root, segments, value) {
  let current = root;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (!current[segment] || typeof current[segment] !== 'object' || Array.isArray(current[segment])) current[segment] = {};
    current = current[segment];
  }
  current[segments.at(-1)] = value;
}

function deepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}
