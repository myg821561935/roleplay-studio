import { appendTurnEvent } from '../agent/memoryUpdater.js';
import { MAX_ACTIONS_PER_ENVELOPE, normalizeActionEnvelope } from '../simulation/actionProtocol.js';
import { appendLedgerEvent, createManualLedgerEvent, projectEventLedger } from '../simulation/eventLedger.js';
import { ensureSimulationMemory, normalizeActors, projectSimulation } from '../simulation/npcSimulation.js';
import { adjudicateActionEnvelope, replayActionHistory } from '../simulation/worldStateArbiter.js';
import { buildTurnChroniclePlan, combineChronicleActionEnvelope } from '../simulation/chronicleEngine.js';
import { compileStructuredWorldSystems } from '../resources/playableResourceCompiler.js';
import {
  beginCardRuntimeInteraction,
  ensureCardRuntimeMemory,
  projectCardRuntime,
  recordCardRuntimeFeedback
} from '../agent/cardRuntime.js';
import { syncCharacterRegistry } from '../agent/characterRegistry.js';

export class WorldSimulationService {
  constructor({ sessionService, resolveCharacterPresets }) {
    this.sessionService = sessionService;
    this.resolveCharacterPresets = typeof resolveCharacterPresets === 'function'
      ? resolveCharacterPresets
      : () => [];
    this.preparedChronicles = new WeakMap();
  }

  prepareSession(session, seeds = {}) {
    this.preparedChronicles.delete(session);
    const resolvedSeeds = resolveSessionSeeds(session, seeds, this.resolveCharacterPresets);
    session.memory = ensureSimulationMemory(session.memory, resolvedSeeds);
    session.memory = reconcileSimulationHistory(session.memory, session.messages);
    session.memory = ensureCardRuntimeMemory(session.memory, {
      ...resolvedSeeds,
      worldBook: session.config?.worldBook
    }, { enabled: session.settings?.cardRuntimeEnabled !== false });
    session.memory = syncCharacterRegistry(session.memory, resolvedSeeds);
    const baselineMemory = ensureSimulationMemory({ simulation: session.memory.simulationBaseline }, resolvedSeeds);
    session.memory.simulationBaseline = baselineMemory.simulation;
    if (!session.memory.worldStateBaseline) {
      session.memory.worldStateBaseline = structuredClone(session.memory.worldState || {});
    }
    return session;
  }

  refreshCurrentAct(session, assistantMessage) {
    session.memory = syncCharacterRegistry(session.memory, {
      ...sessionSeedFromSession(session),
      assistantMessage,
      turnId: assistantMessage?.id
    });
    return session;
  }

  prepareInteraction({ session, userMessage, generationType = 'normal' }) {
    const prepared = beginCardRuntimeInteraction(session.memory, { userMessage, generationType });
    session.memory = prepared.memory;
    const chronicle = this.prepareChronicle({ session, userMessage, generationType });
    return {
      ...prepared.interaction,
      chronicle: chronicle ? structuredClone(chronicle.metadata) : null
    };
  }

  projectDecisionMemory({ session, assistantMessage, actionEnvelope = null }) {
    let memory = structuredClone(session?.memory || {});
    if (actionEnvelope) {
      const projected = adjudicateActionEnvelope({ memory, envelope: actionEnvelope });
      if (projected.result?.status !== 'rejected') memory = projected.memory;
    }
    return syncCharacterRegistry(memory, {
      ...sessionSeedFromSession(session || {}),
      assistantMessage,
      turnId: assistantMessage?.id || 'decision-preview'
    });
  }

  applyTurn({ session, userMessage, assistantMessage, actionEnvelope, actionError }) {
    let chronicle = this.preparedChronicles.get(session) || null;
    this.preparedChronicles.delete(session);
    if (!chronicle) chronicle = this.prepareChronicle({ session, userMessage });
    this.preparedChronicles.delete(session);

    let modelEnvelope = actionEnvelope;
    if (modelEnvelope && chronicle) {
      modelEnvelope = limitModelActionsForChronicle(modelEnvelope, chronicle.envelope.actions.length);
    }
    let adjudication = null;
    if (chronicle) {
      const combinedEnvelope = combineChronicleActionEnvelope({
        chronicleEnvelope: chronicle.envelope,
        modelEnvelope,
        acceptedModelActions: modelEnvelope?.actions || []
      });
      const commitMemory = restoreChronicleBaseline(session.memory, chronicle.memoryBefore);
      const adjudicated = adjudicateActionEnvelope({ memory: commitMemory, envelope: combinedEnvelope });
      session.memory = adjudicated.memory;
      adjudication = orderChronicleEffects(adjudicated.result, chronicle.envelope);
      assistantMessage.actionEnvelope = combinedEnvelope;
      assistantMessage.chronicle = structuredClone(chronicle.metadata);
    } else if (modelEnvelope) {
      const adjudicated = adjudicateActionEnvelope({ memory: session.memory, envelope: modelEnvelope });
      session.memory = adjudicated.memory;
      adjudication = adjudicated.result;
      assistantMessage.actionEnvelope = structuredClone(modelEnvelope);
    }
    if (adjudication) {
      assistantMessage.adjudication = summarizeAdjudication(adjudication);
    }
    if (actionError) {
      assistantMessage.actionError = {
        code: actionError.code || 'ACTION_PARSE_FAILED',
        detail: String(actionError.detail || actionError.message || '')
      };
    }
    const runtimeTurn = recordCardRuntimeFeedback(session.memory, {
      userMessage,
      assistantMessage,
      adjudication,
      actionError
    });
    session.memory = runtimeTurn.memory;
    session.memory = syncCharacterRegistry(session.memory, {
      ...sessionSeedFromSession(session),
      assistantMessage,
      turnId: assistantMessage.id
    });
    if (runtimeTurn.feedback) assistantMessage.runtimeFeedback = structuredClone(runtimeTurn.feedback);
    const swipeIndex = Number(assistantMessage.activeSwipeIndex || 0);
    const swipeMetadata = Array.isArray(assistantMessage.swipeMetadata) ? assistantMessage.swipeMetadata : [];
    while (swipeMetadata.length <= swipeIndex) swipeMetadata.push({});
    swipeMetadata[swipeIndex] = {
      actionEnvelope: assistantMessage.actionEnvelope ? structuredClone(assistantMessage.actionEnvelope) : null,
      actionError: assistantMessage.actionError ? structuredClone(assistantMessage.actionError) : null,
      mvuPatches: Array.isArray(assistantMessage.mvuPatches) ? structuredClone(assistantMessage.mvuPatches) : [],
      mvuError: assistantMessage.mvuError ? structuredClone(assistantMessage.mvuError) : null,
      adjudication: assistantMessage.adjudication ? structuredClone(assistantMessage.adjudication) : null,
      recommendedActions: Array.isArray(assistantMessage.recommendedActions) ? structuredClone(assistantMessage.recommendedActions) : [],
      recommendedActionOptions: Array.isArray(assistantMessage.recommendedActionOptions) ? structuredClone(assistantMessage.recommendedActionOptions) : [],
      decisionNode: assistantMessage.decisionNode ? structuredClone(assistantMessage.decisionNode) : null,
      turnFrame: assistantMessage.turnFrame ? structuredClone(assistantMessage.turnFrame) : null,
      turnFrameError: assistantMessage.turnFrameError ? structuredClone(assistantMessage.turnFrameError) : null,
      narrativeConsistency: assistantMessage.narrativeConsistency ? structuredClone(assistantMessage.narrativeConsistency) : null,
      roleplayPanels: assistantMessage.roleplayPanels ? structuredClone(assistantMessage.roleplayPanels) : null,
      worldBookActivation: assistantMessage.worldBookActivation ? structuredClone(assistantMessage.worldBookActivation) : null,
      runtimeFeedback: assistantMessage.runtimeFeedback ? structuredClone(assistantMessage.runtimeFeedback) : null,
      chronicle: assistantMessage.chronicle ? structuredClone(assistantMessage.chronicle) : null,
      speaker: assistantMessage.speaker ? String(assistantMessage.speaker).slice(0, 30) : ''
    };
    assistantMessage.swipeMetadata = swipeMetadata;
    session.memory = appendTurnEvent({
      memory: session.memory,
      userMessage,
      assistantMessage,
      turnId: assistantMessage.id,
      adjudication,
      actionError
    });
    return { session, adjudication, chronicle: assistantMessage.chronicle || null };
  }

  prepareChronicle({ session, userMessage, generationType = 'normal' }) {
    const plan = buildTurnChroniclePlan({ memory: session.memory, userMessage, generationType });
    if (!plan) return null;
    const memoryBefore = structuredClone(session.memory);
    const adjudicated = adjudicateActionEnvelope({ memory: session.memory, envelope: plan.envelope });
    if (adjudicated.result.status === 'rejected') return null;
    session.memory = adjudicated.memory;
    const chronicle = { ...plan, memoryBefore };
    this.preparedChronicles.set(session, chronicle);
    return chronicle;
  }

  async getSnapshot(sessionId = 'main', { director = true } = {}) {
    const session = await this.sessionService.getSession(sessionId);
    this.prepareSession(session, sessionSeedFromSession(session));
    return projectSnapshot(session, { director });
  }

  async previewActions(sessionId = 'main', envelope, { director = true } = {}) {
    const session = await this.sessionService.getSession(sessionId);
    this.prepareSession(session, sessionSeedFromSession(session));
    const normalized = normalizeActionEnvelope(envelope);
    const adjudicated = adjudicateActionEnvelope({ memory: session.memory, envelope: normalized });
    return {
      committed: false,
      envelope: normalized,
      adjudication: summarizeAdjudication(adjudicated.result, { includeEffects: true }),
      snapshot: projectSnapshot({ ...session, memory: adjudicated.memory }, { director })
    };
  }

  async commitActions(sessionId = 'main', envelope, { actor = 'creator', kind = 'manual-action', director = true } = {}) {
    const session = await this.sessionService.getSession(sessionId);
    this.prepareSession(session, sessionSeedFromSession(session));
    const normalized = normalizeActionEnvelope(envelope);
    const adjudicated = adjudicateActionEnvelope({ memory: session.memory, envelope: normalized });
    session.memory = adjudicated.memory;
    session.memory = appendLedgerEvent(session.memory, createManualLedgerEvent({
      actor,
      summary: normalized.summary || `${actor}提交世界动作`,
      adjudication: adjudicated.result,
      kind
    }));
    checkpointMemory(session);
    session.updatedAt = new Date().toISOString();
    await this.sessionService.saveSession(session);
    return {
      committed: adjudicated.result.status !== 'rejected',
      envelope: normalized,
      adjudication: summarizeAdjudication(adjudicated.result, { includeEffects: true }),
      snapshot: projectSnapshot(session, { director })
    };
  }

  async saveActors(sessionId = 'main', actors, { director = true } = {}) {
    const session = await this.sessionService.getSession(sessionId);
    this.prepareSession(session, sessionSeedFromSession(session));
    const normalized = normalizeActors(actors);
    session.memory.simulation.actors = normalized;
    session.memory.simulation.settings = {
      ...session.memory.simulation.settings,
      rosterInitialized: true
    };
    session.memory.simulation.revision += 1;
    session.memory = appendLedgerEvent(session.memory, createManualLedgerEvent({
      actor: 'creator',
      summary: `更新 NPC 档案：${normalized.length} 人`,
      kind: 'actor-registry',
      adjudication: {
        status: 'accepted',
        revisionBefore: session.memory.simulation.revision - 1,
        revisionAfter: session.memory.simulation.revision,
        accepted: [],
        rejected: [],
        effects: [{
          actionId: 'actor-registry',
          type: 'actor.registry.replace',
          path: 'simulation.actors',
          before: [],
          after: normalized.map((item) => item.id),
          visibility: 'director',
          reason: '创作者更新 NPC 档案'
        }]
      }
    }));
    checkpointMemory(session);
    session.updatedAt = new Date().toISOString();
    await this.sessionService.saveSession(session);
    return projectSnapshot(session, { director });
  }

  async advance(sessionId = 'main', { minutes = 60, reason = '创作者推进时间', director = true } = {}) {
    const session = await this.sessionService.getSession(sessionId);
    this.prepareSession(session, sessionSeedFromSession(session));
    return this.commitActions(sessionId, {
      actorId: 'world-clock',
      summary: String(reason || '推进世界时间'),
      baseRevision: session.memory.simulation.revision,
      actions: [{ type: 'clock.advance', minutes, reason, visibility: 'public' }]
    }, { actor: 'world-clock', kind: 'simulation-tick', director });
  }

  async listEvents(sessionId = 'main', { director = true, limit = 200 } = {}) {
    const session = await this.sessionService.getSession(sessionId);
    return {
      events: projectEventLedger(session.memory?.eventLedger, { director, limit }),
      revision: Number(session.memory?.simulation?.revision || 0)
    };
  }
}

function projectSnapshot(session, { director }) {
  const memory = session.memory || {};
  return {
    sessionId: session.id,
    worldState: structuredClone(memory.worldState || {}),
    simulation: projectSimulation(memory.simulation, { director }),
    events: projectEventLedger(memory.eventLedger, { director, limit: 100 }),
    narrativeState: structuredClone(memory.narrativeState || {}),
    characterRegistry: structuredClone(memory.characterRegistry || null),
    ruleSystem: structuredClone(memory.ruleSystem || null),
    cardRuntime: projectCardRuntime(memory.cardRuntime, { includeFeedback: director })
  };
}

function sessionSeedFromSession(session) {
  return {
    characterCard: session.config?.characterCard,
    groupMembers: session.config?.groupMembers || [],
    worldBook: session.config?.worldBook || [],
    worldSystems: session.config?.worldSystems,
    ...(Object.hasOwn(session.config || {}, 'characterPresets')
      ? { characterPresets: session.config.characterPresets }
      : {})
  };
}

function resolveSessionSeeds(session, seeds, resolveCharacterPresets) {
  const config = session.config && typeof session.config === 'object' ? session.config : {};
  const packId = String(
    config.contentPackId
    || session.memory?.ruleSystem?.contentPackId
    || session.memory?.narrativeState?.lockedGenre
    || session.memory?.worldState?.flags?.genre
    || ''
  ).trim();
  const hasSeedPresets = Object.hasOwn(seeds || {}, 'characterPresets');
  const hasConfigPresets = Object.hasOwn(config, 'characterPresets');
  const resolvedPresets = hasSeedPresets
    ? seeds.characterPresets
    : hasConfigPresets
      ? config.characterPresets
      : resolveCharacterPresets(packId);
  const worldSystems = seeds.worldSystems
    || config.worldSystems
    || compileStructuredWorldSystems(config.worldBook);
  return {
    characterCard: seeds.characterCard || config.characterCard,
    groupMembers: Array.isArray(seeds.groupMembers) ? seeds.groupMembers : config.groupMembers,
    worldBook: Array.isArray(seeds.worldBook) ? seeds.worldBook : config.worldBook,
    characterPresets: Array.isArray(resolvedPresets) ? resolvedPresets : [],
    worldSystems
  };
}

function reconcileSimulationHistory(memory, messages) {
  const source = memory && typeof memory === 'object' ? memory : {};
  const history = Array.isArray(messages) ? messages : [];
  if (!history.some((message) => message?.role === 'assistant' && message?.actionEnvelope)) {
    return source;
  }

  const replayed = replayActionHistory({ memory: source, messages: history }).memory;
  const current = source.simulation || {};
  const canonical = replayed.simulation || {};
  if (sameSimulationRevision(current, canonical)) return source;

  // Narrative extraction may update free-form state, but it must never make the
  // deterministic clock/actor simulation diverge from the selected message branch.
  return {
    ...source,
    simulation: structuredClone(canonical),
    worldState: {
      ...(source.worldState || {}),
      timeline: structuredClone(replayed.worldState?.timeline || source.worldState?.timeline || [])
    }
  };
}

function sameSimulationRevision(left = {}, right = {}) {
  return Number(left?.revision || 0) === Number(right?.revision || 0)
    && Number(left?.clock?.day || 1) === Number(right?.clock?.day || 1)
    && Number(left?.clock?.minuteOfDay || 0) === Number(right?.clock?.minuteOfDay || 0);
}

function checkpointMemory(session) {
  session.memory.worldStateBaseline = structuredClone(session.memory.worldState || {});
  session.memory.simulationBaseline = structuredClone(session.memory.simulation);
  const assistantMessages = (Array.isArray(session.messages) ? session.messages : []).filter((message) => message.role === 'assistant');
  session.memory.actionCheckpointMessageId = assistantMessages.at(-1)?.id || '';
}

function summarizeAdjudication(result, { includeEffects = false } = {}) {
  if (!result) return null;
  return {
    status: result.status,
    code: result.code || '',
    protocol: result.protocol || '',
    envelopeId: result.envelopeId || '',
    actorId: result.actorId || '',
    summary: result.summary || '',
    revisionBefore: result.revisionBefore,
    revisionAfter: result.revisionAfter,
    acceptedCount: result.accepted?.length || 0,
    rejectedCount: result.rejected?.length || 0,
    rejected: (result.rejected || []).map((item) => ({ id: item.action?.id, type: item.action?.type, code: item.code, detail: item.detail })),
    ...(includeEffects ? { effects: structuredClone(result.effects || []) } : {})
  };
}

function limitModelActionsForChronicle(envelope, chronicleActionCount) {
  const normalized = normalizeActionEnvelope(envelope);
  const remaining = Math.max(0, MAX_ACTIONS_PER_ENVELOPE - chronicleActionCount);
  if (normalized.actions.length <= remaining) return normalized;
  if (!remaining) return null;
  return {
    ...normalized,
    actions: normalized.actions.slice(0, remaining),
    summary: `${normalized.summary || '模型世界动作'}（仅保留前 ${remaining} 项）`.slice(0, 240)
  };
}

function restoreChronicleBaseline(currentMemory, baselineMemory) {
  const next = structuredClone(currentMemory || {});
  const baseline = baselineMemory || {};
  // The preview is intentionally visible to the prompt. At commit time restore
  // only its deterministic mutations, keeping lifecycle/MVU changes produced
  // after prompt assembly intact.
  next.simulation = structuredClone(baseline.simulation || next.simulation);
  next.worldState = {
    ...(next.worldState || {}),
    timeline: structuredClone(baseline.worldState?.timeline || [])
  };
  return next;
}

function orderChronicleEffects(adjudication, chronicleEnvelope) {
  if (!adjudication || !chronicleEnvelope) return adjudication;
  const chronicleActionIds = new Set((chronicleEnvelope.actions || []).map((action) => action.id));
  return {
    ...adjudication,
    effects: [
      ...(adjudication.effects || []).filter((effect) => !chronicleActionIds.has(effect.actionId)),
      ...(adjudication.effects || []).filter((effect) => chronicleActionIds.has(effect.actionId))
    ]
  };
}
