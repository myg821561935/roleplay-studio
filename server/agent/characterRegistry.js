import { resolveCharacterContentMode } from '../character/characterContentMode.js';

export const CHARACTER_REGISTRY_SPEC = 'lra.character-registry/v1';

const MAX_RECORDS = 80;
const MAX_ACT_MEMBERS = 16;
const MAX_TEXT = 480;
const STAGE_STATES = new Set(['on-stage', 'off-stage', 'mentioned', 'pending']);
const CHARACTER_NAME = /^[\u3400-\u9fffA-Za-z][\u3400-\u9fffA-Za-z0-9·・]{0,31}$/;

/**
 * Keeps a compact, session-owned projection of the cast. Imported cards and
 * world books remain the canonical facts; this registry only stores their
 * source reference plus observable session deltas and the active scene cast.
 */
export function syncCharacterRegistry(memory, {
  characterCard,
  groupMembers,
  characterPresets,
  worldBook,
  assistantMessage,
  turnId,
  now = () => new Date().toISOString()
} = {}) {
  const next = structuredClone(isRecord(memory) ? memory : {});
  const previous = normalizeCharacterRegistry(next.characterRegistry);
  const records = new Map(previous.records.map((item) => [item.id, item]));
  const byName = new Map(previous.records.map((item) => [normalizeName(item.name), item.id]).filter(([name]) => name));
  const generatedAt = normalizeTimestamp(now());
  const worldState = isRecord(next.worldState) ? next.worldState : {};
  const simulationActors = Array.isArray(next.simulation?.actors) ? next.simulation.actors : [];
  const contentMode = resolveCharacterContentMode(characterCard, worldBook);
  const scenarioContainer = contentMode.kind === 'scenario-container';
  const scenarioRootName = scenarioContainer ? normalizeName(characterCard?.name) : '';

  // Old sessions may already contain the scenario bundle as a synthetic actor.
  // Remove only this derived projection; imported resources and chat history stay untouched.
  if (scenarioRootName) {
    const staleRootId = byName.get(scenarioRootName);
    if (staleRootId) records.delete(staleRootId);
    byName.delete(scenarioRootName);
  }

  const upsert = (candidate, source = {}) => {
    const name = cleanName(candidate?.name);
    if (!name) return null;
    const existingId = byName.get(normalizeName(name));
    const id = existingId || createRecordId(source.kind, candidate?.id, name);
    const previousRecord = records.get(id);
    const profile = normalizeProfile(candidate, previousRecord?.profile);
    const session = normalizeSession({
      ...previousRecord?.session,
      ...sessionPatch(candidate, { turnId, generatedAt })
    });
    const nextRecord = {
      id,
      name,
      kind: selectKind(source.kind || candidate?.kind, previousRecord?.kind),
      source: selectSource(source, previousRecord?.source),
      profile,
      session,
      createdAt: previousRecord?.createdAt || generatedAt,
      updatedAt: generatedAt
    };
    records.set(id, nextRecord);
    byName.set(normalizeName(name), id);
    return nextRecord;
  };

  const protagonist = isRecord(worldState.protagonist) ? worldState.protagonist : {};
  const primaryCard = protagonist?.name ? protagonist : scenarioContainer ? null : characterCard;
  const protagonistRecord = primaryCard ? upsert({
    ...primaryCard,
    ...protagonist,
    name: protagonist.name || primaryCard?.name,
    encountered: true
  }, {
    kind: 'protagonist',
    sourceKind: 'character-card',
    sourceId: primaryCard?.id || 'active-character-card'
  }) : null;

  if (!scenarioContainer
    && characterCard?.name
    && normalizeName(characterCard.name) !== normalizeName(protagonist?.name)) {
    upsert(characterCard, {
      kind: 'source-npc',
      sourceKind: 'character-card',
      sourceId: characterCard.id || 'active-character-card'
    });
  }

  for (const member of uniqueMembers(groupMembers)) {
    upsert(member, {
      kind: 'source-npc',
      sourceKind: 'group-member',
      sourceId: member.id || member.name
    });
  }
  for (const preset of uniqueMembers((Array.isArray(characterPresets) ? characterPresets : [])
    .map((item) => item?.characterCard || item))) {
    upsert(preset, {
      kind: 'source-npc',
      sourceKind: 'character-preset',
      sourceId: preset.id || preset.name
    });
  }
  for (const character of collectWorldBookCharacters(worldBook)) {
    upsert(character, {
      kind: 'source-npc',
      sourceKind: 'world-book',
      sourceId: character.id || character.name
    });
  }
  for (const actor of uniqueMembers(simulationActors)) {
    if (scenarioRootName && normalizeName(actor.name) === scenarioRootName) continue;
    upsert({
      ...actor,
      encountered: actor.encountered === true
    }, {
      kind: 'source-npc',
      sourceKind: 'simulation-actor',
      sourceId: actor.id || actor.name
    });
  }
  // The simulation actor is a planning projection; the extracted world state is
  // the latest observable narrative fact. Apply it last so a stale schedule or
  // pending-interaction marker cannot overwrite the dossier's current status.
  for (const character of uniqueMembers(worldState.characters)) {
    if (scenarioRootName && normalizeName(character.name) === scenarioRootName) continue;
    upsert(character, {
      kind: character.encountered === true ? 'discovered-npc' : 'source-npc',
      sourceKind: 'world-state',
      sourceId: character.id || character.name
    });
  }

  const panelEntries = parseCurrentActEntries(assistantMessage?.roleplayPanels?.characterStatus);
  const panelEntriesByName = new Map(panelEntries.map((entry) => [normalizeName(entry.name), entry]));
  const frameEntries = inferTurnFrameCurrentActEntries(assistantMessage, {
    worldState,
    simulationActors,
    records: [...records.values()]
  }).map((entry) => ({
    ...entry,
    status: panelEntriesByName.get(normalizeName(entry.name))?.status || ''
  }));
  const observedEntries = inferObservedCurrentActEntries(assistantMessage, {
    worldState,
    simulationActors
  });
  const explicitEntries = uniqueByName(frameEntries.length
    ? frameEntries
    : [...panelEntries, ...observedEntries]);
  const continuityEntries = explicitEntries.length
    ? []
    : inferContinuousCurrentActEntries(assistantMessage, {
      previousCurrentAct: previous.currentAct,
      worldState,
      simulationActors,
      protagonistName: protagonistRecord?.name
    });
  const recoveredEntries = explicitEntries.length || continuityEntries.length
    ? []
    : inferCanonicalCurrentActEntries({
      previousCurrentAct: previous.currentAct,
      worldState,
      simulationActors,
      protagonistName: protagonistRecord?.name
    });
  const currentActEntries = uniqueByName([
    ...explicitEntries,
    ...continuityEntries,
    ...recoveredEntries
  ]);
  const currentActMembers = [];
  const shouldRefreshCurrentAct = Boolean(assistantMessage) || recoveredEntries.length > 0;
  if (shouldRefreshCurrentAct) {
    if (protagonistRecord) {
      currentActMembers.push(toActMember(protagonistRecord, { state: 'on-stage', status: '' }));
    }
    for (const entry of currentActEntries) {
      const record = upsert({
        name: entry.name,
        role: entry.role,
        status: entry.status,
        encountered: true
      }, {
        kind: 'discovered-npc',
        sourceKind: entry.sourceKind || 'status-panel',
        sourceId: entry.name
      });
      if (record && !currentActMembers.some((item) => item.characterId === record.id)) {
        currentActMembers.push(toActMember(record, { state: 'on-stage', status: entry.status }));
      }
    }
    const speakerName = cleanName(assistantMessage?.speaker);
    const speakerId = speakerName ? byName.get(normalizeName(speakerName)) : '';
    if (speakerId && !currentActMembers.some((item) => item.characterId === speakerId)) {
      const record = records.get(speakerId);
      if (record) currentActMembers.push(toActMember(record, { state: 'on-stage', role: 'speaker' }));
    }
  }

  const sortedRecords = [...records.values()]
    .sort((left, right) => recordRank(left) - recordRank(right) || left.name.localeCompare(right.name, 'zh-CN'))
    .slice(0, MAX_RECORDS);
  const currentAct = assistantMessage
    ? {
      id: String(turnId || assistantMessage.id || `act-${Date.now()}`).slice(0, 120),
      turnId: String(turnId || assistantMessage.id || '').slice(0, 120),
      location: textValue(worldState.location?.current || worldState.location, 160),
      summary: textValue(assistantMessage?.roleplayPanels?.sceneStatus, MAX_TEXT),
      members: currentActMembers.slice(0, MAX_ACT_MEMBERS),
      next: parseNextActCandidates(assistantMessage?.roleplayPanels?.nextCharacter, byName),
      updatedAt: generatedAt
    }
    : recoveredEntries.length
      ? {
        ...(previous.currentAct || {}),
        location: textValue(worldState.location?.current || worldState.location, 160),
        members: currentActMembers.slice(0, MAX_ACT_MEMBERS),
        updatedAt: generatedAt
      }
      : previous.currentAct;

  next.characterRegistry = {
    spec: CHARACTER_REGISTRY_SPEC,
    records: sortedRecords,
    currentAct: normalizeCurrentAct(currentAct),
    updatedAt: generatedAt
  };
  return next;
}

function inferTurnFrameCurrentActEntries(assistantMessage, { worldState, simulationActors, records } = {}) {
  const turnFrame = assistantMessage?.turnFrame;
  if (turnFrame?.validation?.status !== 'accepted') return [];
  const names = Array.isArray(turnFrame?.scene?.presentActors) ? turnFrame.scene.presentActors : [];
  if (!names.length) return [];
  const candidates = new Map(uniqueByName([
    ...uniqueMembers(worldState?.characters),
    ...uniqueMembers(simulationActors),
    ...uniqueMembers(records)
  ]).map((candidate) => [normalizeName(candidate.name), candidate]));
  return uniqueByName(names.flatMap((value) => {
    const name = cleanName(value);
    const candidate = candidates.get(normalizeName(name));
    if (!name || !candidate) return [];
    return [{
      name: candidate.name,
      role: textValue(candidate.role || candidate.identity || candidate.profile?.role, 180),
      // A turn frame proves presence, not that a previously stored status is still current.
      // Only a same-turn structured status panel may populate the current-act status.
      status: '',
      sourceKind: 'turn-frame'
    }];
  }));
}

export function normalizeCharacterRegistry(value) {
  const source = isRecord(value) ? value : {};
  const seenIds = new Set();
  const seenNames = new Set();
  const records = (Array.isArray(source.records) ? source.records : [])
    .map((item) => normalizeRegistryRecord(item))
    .filter((item) => {
      const name = normalizeName(item?.name);
      if (!item || seenIds.has(item.id) || seenNames.has(name)) return false;
      seenIds.add(item.id);
      seenNames.add(name);
      return true;
    })
    .slice(0, MAX_RECORDS);
  return {
    spec: CHARACTER_REGISTRY_SPEC,
    records,
    currentAct: normalizeCurrentAct(source.currentAct),
    updatedAt: normalizeTimestamp(source.updatedAt)
  };
}

function normalizeRegistryRecord(value) {
  if (!isRecord(value)) return null;
  const name = cleanName(value.name);
  if (!name) return null;
  return {
    id: textValue(value.id, 120) || createRecordId(value.kind, '', name),
    name,
    kind: normalizeKind(value.kind),
    source: normalizeSource(value.source),
    profile: normalizeProfile(value),
    session: normalizeSession(value.session),
    createdAt: normalizeTimestamp(value.createdAt),
    updatedAt: normalizeTimestamp(value.updatedAt)
  };
}

function normalizeCurrentAct(value) {
  if (!isRecord(value)) return null;
  const seen = new Set();
  const members = (Array.isArray(value.members) ? value.members : [])
    .map((item) => {
      const characterId = textValue(item?.characterId, 120);
      const name = cleanName(item?.name);
      if (!characterId || !name || seen.has(characterId)) return null;
      seen.add(characterId);
      return {
        characterId,
        name,
        state: STAGE_STATES.has(item?.state) ? item.state : 'on-stage',
        role: textValue(item?.role, 80),
        status: textValue(item?.status, MAX_TEXT)
      };
    })
    .filter(Boolean)
    .slice(0, MAX_ACT_MEMBERS);
  return {
    id: textValue(value.id, 120),
    turnId: textValue(value.turnId, 120),
    location: textValue(value.location, 160),
    summary: textValue(value.summary, MAX_TEXT),
    members,
    next: (Array.isArray(value.next) ? value.next : [])
      .map((item) => ({
        characterId: textValue(item?.characterId, 120),
        name: cleanName(item?.name),
        reason: textValue(item?.reason, 200)
      }))
      .filter((item) => item.name)
      .slice(0, 6),
    updatedAt: normalizeTimestamp(value.updatedAt)
  };
}

function normalizeProfile(value, fallback = {}) {
  return {
    role: textValue(value?.role || value?.identity || fallback?.role, 180),
    description: textValue(value?.description || value?.detail || value?.notes || fallback?.description, MAX_TEXT),
    personality: textValue(value?.personality || fallback?.personality, 240),
    portrait: textValue(value?.portrait || value?.avatar || value?.image || fallback?.portrait, 500)
  };
}

function normalizeSession(value) {
  const source = isRecord(value) ? value : {};
  return {
    encountered: source.encountered === true,
    location: textValue(source.location, 160),
    status: textValue(source.status, MAX_TEXT),
    lastSeenTurn: textValue(source.lastSeenTurn, 120),
    lastUpdatedAt: normalizeTimestamp(source.lastUpdatedAt)
  };
}

function sessionPatch(candidate, { turnId, generatedAt }) {
  const patch = {};
  const location = textValue(candidate?.location, 160);
  const status = textValue(candidate?.status || candidate?.state, MAX_TEXT);
  const encountered = candidate?.encountered === true;
  if (encountered) patch.encountered = true;
  if (location) patch.location = location;
  if (status) patch.status = status;
  if (encountered || location || status) {
    patch.lastSeenTurn = textValue(turnId, 120);
    patch.lastUpdatedAt = generatedAt;
  }
  return patch;
}

function normalizeSource(value, fallback = {}) {
  const source = isRecord(value) ? value : {};
  return {
    kind: textValue(source.sourceKind || source.kind || fallback?.kind || 'session', 80),
    id: textValue(source.sourceId || source.id || fallback?.id, 160)
  };
}

function selectSource(candidate, previous) {
  const nextSource = normalizeSource(candidate);
  const previousSource = normalizeSource(previous);
  return sourceRank(nextSource.kind) <= sourceRank(previousSource.kind)
    ? nextSource
    : previousSource;
}

function sourceRank(kind) {
  return ({
    'character-card': 0,
    'group-member': 1,
    'character-preset': 2,
    'world-book': 3,
    'world-state': 4,
    'simulation-actor': 5,
    'status-panel': 6,
    session: 7
  })[String(kind || '')] ?? 7;
}

function parseCurrentActEntries(value) {
  const text = String(value || '');
  const entries = [];
  const pattern = /『\s*([^·『』\n]{1,32})\s*[·｜|]\s*([^』\n]{1,480})』([\s\S]*?)(?=『|$)/g;
  for (const match of text.matchAll(pattern)) {
    const name = cleanName(match[1]);
    if (!name) continue;
    entries.push({
      name,
      role: '',
      status: textValue([match[2], match[3]].filter(Boolean).join(' '), MAX_TEXT),
      sourceKind: 'status-panel'
    });
  }
  return uniqueByName(entries);
}

/**
 * Some community cards omit the optional status block for a reply. The roster
 * must still follow the visible scene instead of collapsing to the protagonist
 * alone. Only session characters explicitly named in this reply are recovered;
 * previously encountered but off-scene characters stay out of the current act.
 */
function inferObservedCurrentActEntries(assistantMessage, { worldState, simulationActors } = {}) {
  const panels = assistantMessage?.roleplayPanels || {};
  const sceneText = [
    assistantMessage?.content,
    panels.sceneStatus,
    panels.characterStatus,
    panels.relationshipStatus,
    panels.nextCharacter
  ].filter(Boolean).join('\n');
  if (!sceneText.trim()) return [];

  const candidates = uniqueByName([
    ...uniqueMembers(worldState?.characters),
    ...uniqueMembers(simulationActors)
  ]);
  return candidates
    .filter((candidate) => candidate.encountered === true)
    .filter((candidate) => isCurrentActMentioned(sceneText, candidate.name))
    .map((candidate) => ({
      name: candidate.name,
      role: textValue(candidate.role || candidate.identity, 180),
      status: textValue(candidate.status || candidate.state, MAX_TEXT),
      sourceKind: 'world-state'
    }));
}

/**
 * A normal prose reply often replaces a known actor's name with a pronoun. Keep
 * already on-stage NPCs across that continuous beat, but stop at explicit scene
 * changes or departures. This preserves continuity without pulling every
 * encountered world-book character into the scene.
 */
function inferContinuousCurrentActEntries(assistantMessage, {
  previousCurrentAct,
  worldState,
  simulationActors,
  protagonistName
} = {}) {
  const sceneText = currentActSceneText(assistantMessage);
  if (!sceneText || hasCurrentActResetCue(sceneText, protagonistName)) return [];

  const previousMembers = Array.isArray(previousCurrentAct?.members)
    ? previousCurrentAct.members
    : [];
  const activeNames = previousMembers
    .filter((member) => member?.state === 'on-stage')
    .map((member) => cleanName(member?.name))
    .filter((name) => name && normalizeName(name) !== normalizeName(protagonistName));
  if (!activeNames.length) return [];

  const candidates = new Map(uniqueByName([
    ...uniqueMembers(worldState?.characters),
    ...uniqueMembers(simulationActors)
  ]).map((candidate) => [normalizeName(candidate.name), candidate]));
  return activeNames.flatMap((name) => {
    const candidate = candidates.get(normalizeName(name)) || { name };
    if (isExplicitlyOffSceneStatus(candidate.status || candidate.state)) return [];
    return [{
      name,
      role: textValue(candidate.role || candidate.identity, 180),
      status: textValue(candidate.status || candidate.state, MAX_TEXT),
      sourceKind: 'scene-continuity'
    }];
  });
}

/**
 * Fact extraction can learn the active NPC after the prose projection has
 * already collapsed to the protagonist. Recover only one unambiguous actor
 * whose canonical session status strongly anchors them to the protagonist or
 * current location; ambiguous casts remain unchanged for manual/model evidence.
 */
function inferCanonicalCurrentActEntries({
  previousCurrentAct,
  worldState,
  simulationActors,
  protagonistName
} = {}) {
  const previousNpc = (Array.isArray(previousCurrentAct?.members) ? previousCurrentAct.members : [])
    .some((member) => member?.state === 'on-stage'
      && normalizeName(member?.name) !== normalizeName(protagonistName));
  if (previousNpc) return [];

  const currentLocation = textValue(worldState?.location?.current || worldState?.location, 160);
  const ranked = uniqueByName([
    ...uniqueMembers(worldState?.characters),
    ...uniqueMembers(simulationActors)
  ])
    .filter((candidate) => candidate.encountered === true)
    .filter((candidate) => normalizeName(candidate.name) !== normalizeName(protagonistName))
    .filter((candidate) => !isExplicitlyOffSceneStatus(candidate.status || candidate.state))
    .map((candidate) => ({ candidate, score: currentActCandidateScore(candidate, { protagonistName, currentLocation }) }))
    .filter((entry) => entry.score >= 3)
    .sort((left, right) => right.score - left.score);

  const first = ranked[0];
  const second = ranked[1];
  if (!first || (second && second.score >= first.score - 1)) return [];
  return [{
    name: first.candidate.name,
    role: textValue(first.candidate.role || first.candidate.identity, 180),
    status: textValue(first.candidate.status || first.candidate.state, MAX_TEXT),
    sourceKind: 'world-state-recovery'
  }];
}

function currentActCandidateScore(candidate, { protagonistName, currentLocation } = {}) {
  const status = textValue(candidate?.status || candidate?.state, MAX_TEXT);
  const location = textValue(candidate?.location, 160);
  let score = 0;
  // A historical status often names the protagonist long after that NPC left.
  // Name co-occurrence alone is not enough to restore someone to the current act.
  if (protagonistName && status.includes(protagonistName)) {
    const protagonist = escapeRegExp(protagonistName);
    const directInteraction = new RegExp(
      `(?:${protagonist}.{0,12}(?:身旁|面前|同处|同行|对话|交谈|回应|等待|对峙|交手)|(?:身旁|面前|同处|同行|对话|交谈|回应|等待|对峙|交手).{0,12}${protagonist})`,
      'u'
    );
    score += directInteraction.test(status) ? 5 : 1;
  }
  if (/(?:正在|正与|当前|此刻|本轮|身旁|面前|同处|同行|对话|交谈|回应|追问|对峙|交手|跟随|握住|抱住|扶住|跪|端坐|躺)/u.test(status)) score += 3;
  if (currentLocation && location && (currentLocation.includes(location) || location.includes(currentLocation))) score += 3;
  return score;
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isExplicitlyOffSceneStatus(value) {
  return /(?:本轮(?:未|不)(?:再)?登场|未(?:再)?登场|尚未登场|待登场|不在(?:当前|本)幕|已离去|已经?离开(?:当前|现场|此地|场景)?|留守|远处待命|背景人物)/u
    .test(String(value || ''));
}

function currentActSceneText(assistantMessage) {
  const panels = assistantMessage?.roleplayPanels || {};
  return [
    assistantMessage?.content,
    panels.sceneStatus,
    panels.characterStatus,
    panels.relationshipStatus,
    panels.nextCharacter
  ].filter(Boolean).join('\n').trim();
}

function hasCurrentActResetCue(text, protagonistName) {
  const content = String(text || '');
  if (/(?:与此同时|另一边|画面一转|镜头转向|场景切换|翌日|次日|第二天|数日后)/u.test(content)) return true;
  if (/(?:她|他|对方|来人).{0,16}(?:转身离开|离开了|走远|消失在|退场)/u.test(content)) return true;
  const protagonist = cleanName(protagonistName);
  return /(?:只剩(?:下)?你|独自一人)/u.test(content)
    || Boolean(protagonist && content.includes(`只剩${protagonist}`));
}

function isCurrentActMentioned(text, name) {
  const safeName = cleanName(name);
  return safeName.length >= 2 && String(text || '').includes(safeName);
}

function parseNextActCandidates(value, byName) {
  const text = String(value || '');
  const names = [...text.matchAll(/『\s*([^·『』\n]{1,32})\s*(?:[·｜|][^』\n]*)?』/g)]
    .map((match) => cleanName(match[1]))
    .filter(Boolean);
  return uniqueByName(names.map((name) => ({
    characterId: byName.get(normalizeName(name)) || '',
    name,
    reason: textValue(text, 200)
  }))).slice(0, 6);
}

function toActMember(record, { state = 'on-stage', role = '', status } = {}) {
  return {
    characterId: record.id,
    name: record.name,
    state: STAGE_STATES.has(state) ? state : 'on-stage',
    role: textValue(role, 80),
    status: textValue(status === undefined ? record.session?.status : status, MAX_TEXT)
  };
}

function uniqueMembers(value) {
  return (Array.isArray(value) ? value : []).filter((item) => isRecord(item) && item.enabled !== false && cleanName(item.name));
}

function collectWorldBookCharacters(entries) {
  const names = new Set();
  return (Array.isArray(entries) ? entries : []).flatMap((entry) => {
    if (!isRecord(entry) || entry.enabled === false) return [];
    const extensions = isRecord(entry.extensions) ? entry.extensions : {};
    const local = isRecord(extensions.local_roleplay_agent) ? extensions.local_roleplay_agent : {};
    const title = textValue(entry.title || entry.name, 160);
    const explicitName = cleanName(local.characterName || extensions.characterName || entry.characterName);
    const matchedName = cleanName(title.match(/^(.{1,32}?)[_·\s-]+(?:基础信息|二次解释|性格调色盘|人物档案|角色档案|人物设定|角色设定)(?:[_·\s-]|$)/u)?.[1]);
    const name = explicitName || matchedName;
    if (!name || names.has(normalizeName(name))) return [];
    names.add(normalizeName(name));
    return [{
      id: textValue(entry.id, 160),
      name,
      role: textValue(local.role || extensions.role || '世界书人物', 180),
      talkativeness: normalizeTalkativeness(local.talkativeness ?? extensions.talkativeness)
    }];
  });
}

function uniqueByName(values) {
  const names = new Set();
  return values.filter((item) => {
    const name = normalizeName(item?.name || item);
    if (!name || names.has(name)) return false;
    names.add(name);
    return true;
  });
}

function cleanName(value) {
  const name = textValue(value, 32);
  return CHARACTER_NAME.test(name) ? name : '';
}

function normalizeName(value) {
  return String(value || '').trim().toLocaleLowerCase('zh-CN');
}

function normalizeTalkativeness(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0 || num > 1) return null;
  return num;
}

function createRecordId(kind, sourceId, name) {
  const base = textValue(sourceId || name, 100)
    .toLocaleLowerCase('zh-CN')
    .replace(/[^a-z0-9_.:\-\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${normalizeKind(kind)}:${base || 'character'}`.slice(0, 120);
}

function normalizeKind(value) {
  return ['protagonist', 'source-npc', 'discovered-npc', 'temporary'].includes(value)
    ? value
    : 'discovered-npc';
}

function selectKind(candidate, previous) {
  const prior = normalizeKind(previous);
  if (['protagonist', 'source-npc'].includes(prior)) return prior;
  return normalizeKind(candidate || prior);
}

function recordRank(record) {
  return ({ protagonist: 0, 'source-npc': 1, 'discovered-npc': 2, temporary: 3 })[record.kind] ?? 4;
}

function textValue(value, max = MAX_TEXT) {
  if (value === undefined || value === null || typeof value === 'object') return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeTimestamp(value) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}T/.test(text) ? text : '';
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
