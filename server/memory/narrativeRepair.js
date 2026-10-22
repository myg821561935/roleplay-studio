const NARRATIVE_REPAIR_SPEC = 'nre.narrative-repair/v1';

export function applyNarrativeForwardRepair(session, {
  reason = '',
  excludeMessageIds = [],
  canonicalFacts = {},
  hardFacts = [],
  canonicalSummary = '',
  prohibitedPhrases = [],
  worldState = null,
  resetDerivedMemory = false,
  now = () => new Date()
} = {}) {
  const next = structuredClone(session || {});
  const messages = Array.isArray(next.messages) ? next.messages : [];
  const knownMessageIds = new Set(messages.map((message) => String(message?.id || '')).filter(Boolean));
  const excluded = uniqueStrings(excludeMessageIds).filter((id) => knownMessageIds.has(id));
  const previous = normalizeNarrativeRepair(next.memory?.narrativeRepair);
  const facts = normalizeCanonicalFacts(canonicalFacts);
  const appliedAt = now().toISOString();

  next.memory = next.memory && typeof next.memory === 'object' ? next.memory : {};
  next.memory.narrativeRepair = {
    spec: NARRATIVE_REPAIR_SPEC,
    revision: previous.revision + 1,
    appliedAt,
    reason: String(reason || 'narrative-forward-repair').trim().slice(0, 240),
    excludedMessageIds: uniqueStrings([...previous.excludedMessageIds, ...excluded]),
    canonicalFacts: facts,
    hardFacts: mergeHardFacts(previous.hardFacts, hardFacts),
    prohibitedPhrases: uniqueStrings(prohibitedPhrases).slice(0, 24)
  };
  if (String(canonicalSummary || '').trim()) {
    next.memory.rollingSummary = String(canonicalSummary).trim().slice(0, 12000);
  }
  next.memory.worldState = worldState && typeof worldState === 'object' && !Array.isArray(worldState)
    ? structuredClone(worldState)
    : mergeCanonicalWorldState(next.memory.worldState, facts);
  if (resetDerivedMemory) resetDerivedNarrativeMemory(next.memory, appliedAt);
  if (resetDerivedMemory) next.memory.worldStateBaseline = structuredClone(next.memory.worldState);
  next.messages = messages.map((message) => (
    next.memory.narrativeRepair.excludedMessageIds.includes(String(message?.id || ''))
      ? {
          ...message,
          contextExcluded: true,
          contextExclusionReason: next.memory.narrativeRepair.reason,
          contextExcludedAt: appliedAt
        }
      : message
  ));
  supersedeEpisodesForExcludedMessages(next.memory.episodicMemory, next.memory.narrativeRepair.excludedMessageIds, appliedAt);
  next.updatedAt = appliedAt;
  return next;
}

export function filterNarrativeContextMessages(messages = [], memory = {}) {
  const excluded = getNarrativeRepairContextExclusions(memory);
  return (Array.isArray(messages) ? messages : []).filter((message) => (
    message?.contextExcluded !== true && !excluded.has(String(message?.id || ''))
  ));
}

export function getNarrativeRepairContextExclusions(memory = {}) {
  return new Set(normalizeNarrativeRepair(memory?.narrativeRepair).excludedMessageIds);
}

export function renderNarrativeRepairPrompt(memory = {}) {
  const repair = normalizeNarrativeRepair(memory?.narrativeRepair);
  if (!repair.revision) return '';
  const facts = repair.canonicalFacts;
  const locationAndCastAreStale = hasLaterSceneState(memory, repair);
  const lines = [
    '# 已确认的叙事纠偏锚点',
    '历史原文为审计留档；被标记为不进入上下文的消息、以及下列已否定内容，不得作为当前事实、人物或场景的来源。角色卡和世界书仍高于摘要与模型旧输出。'
  ];
  if (facts.protagonistName) lines.push(`- 主角规范名称：${facts.protagonistName}。`);
  if (facts.protagonistRole) lines.push(`- 主角规范身份/称呼：${facts.protagonistRole}。`);
  if (!locationAndCastAreStale) {
    if (facts.time) lines.push(`- 当前时间：${facts.time}。`);
    if (facts.location) lines.push(`- 当前地点：${facts.location}。`);
    if (facts.presentCharacters.length) lines.push(`- 当前已实体化在场人物：${facts.presentCharacters.join('、')}。未在此列或角色卡/世界书/当前消息中出现的人物不得凭空回归。`);
  } else {
    lines.push('- 本纠偏后的剧情已经继续推进：时间、地点与在场人物必须以当前 World State 和最近未排除正文为准；不得把本次纠偏发生时的旧场景重新写成“当前”。');
  }
  if (repair.prohibitedPhrases.length) lines.push(`- 已否定的旧输出：${repair.prohibitedPhrases.map((value) => `「${value}」`).join('、')}。不得复用或把它们解释为既成事实。`);
  return lines.join('\n');
}

export function renderNarrativeHardFactsPrompt(memory = {}) {
  const facts = getActiveNarrativeHardFacts(memory);
  if (!facts.length) return '';
  return [
    '# 发送前硬事实复核',
    '以下事实已经由结构化状态或人工纠偏确认。输出前必须逐条核对；若草稿与任一事实冲突，先在内部改写草稿，不得把冲突版本写入有效历史。',
    ...facts.map((item) => `- [${item.id}] ${item.fact}`),
    '- 不得用幻觉、记忆模糊、时间倒流或“其实刚才没有发生”来绕过这些事实，除非当前用户明确要求回溯、重置或改写历史。'
  ].join('\n');
}

export function getActiveNarrativeHardFacts(memory = {}) {
  const repair = normalizeNarrativeRepair(memory?.narrativeRepair);
  return repair.hardFacts.filter((item) => hardFactIsActive(item, memory));
}

export function validateNarrativeHardFacts(content, memory = {}) {
  const text = String(content || '');
  const conflicts = [];
  for (const item of getActiveNarrativeHardFacts(memory)) {
    const matched = item.contradictions.find((phrase) => phrase && text.includes(phrase));
    if (!matched) continue;
    conflicts.push({ id: item.id, fact: item.fact, matched });
  }

  // 检查 NPC 涉密边界（防剧透与已知事实隔离确定性校验）
  const characterKnowledge = memory?.worldState?.characterKnowledge || {};
  for (const [npcName, knowledge] of Object.entries(characterKnowledge)) {
    if (!knowledge || !Array.isArray(knowledge.secretBoundaries)) continue;
    for (const secret of knowledge.secretBoundaries) {
      if (secret && typeof secret === 'string' && secret.trim().length >= 2 && text.includes(secret.trim())) {
        conflicts.push({
          id: `spoiler-${npcName}`,
          fact: `角色【${npcName}】涉密盲区：禁止越权知晓或提及「${secret}」`,
          matched: secret.trim(),
          kind: 'character-secret-boundary'
        });
      }
    }
  }

  return {
    valid: conflicts.length === 0,
    checkedCount: getActiveNarrativeHardFacts(memory).length,
    conflicts
  };
}

export function resolveCanonicalPlayerName(memory = {}) {
  return normalizeNarrativeRepair(memory?.narrativeRepair).canonicalFacts.protagonistName;
}

function normalizeNarrativeRepair(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    revision: Math.max(0, Math.trunc(Number(source.revision) || 0)),
    appliedAt: cleanText(source.appliedAt, 64),
    excludedMessageIds: uniqueStrings(source.excludedMessageIds),
    canonicalFacts: normalizeCanonicalFacts(source.canonicalFacts),
    hardFacts: normalizeHardFacts(source.hardFacts),
    prohibitedPhrases: uniqueStrings(source.prohibitedPhrases).slice(0, 24)
  };
}

function mergeHardFacts(previous, incoming) {
  const merged = new Map(normalizeHardFacts(previous).map((item) => [item.id, item]));
  for (const item of normalizeHardFacts(incoming)) merged.set(item.id, item);
  return [...merged.values()].slice(0, 48);
}

function normalizeHardFacts(values) {
  return (Array.isArray(values) ? values : []).map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const fact = cleanText(item.fact || item.text || item.assertion, 320);
    if (!fact) return null;
    const id = cleanFactId(item.id || `fact-${index + 1}`);
    const path = cleanStatePath(item.when?.path || item.statePath);
    const hasExpected = Object.hasOwn(item.when || {}, 'equals') || Object.hasOwn(item, 'expected');
    const expected = Object.hasOwn(item.when || {}, 'equals') ? item.when.equals : item.expected;
    return {
      id,
      fact,
      contradictions: uniqueStrings(item.contradictions).slice(0, 16),
      ...(path && hasExpected ? { when: { path, equals: normalizeExpectedValue(expected) } } : {})
    };
  }).filter(Boolean);
}

function hardFactIsActive(item, memory) {
  if (isHistoricalRepairAnchor(item) && Number(memory?.simulation?.revision || 0) > 0) return false;
  if (!item.when?.path) return true;
  return Object.is(readStatePath(memory, item.when.path), item.when.equals);
}

function isHistoricalRepairAnchor(item) {
  const id = String(item?.id || '');
  const fact = String(item?.fact || '');
  return /(?:repair|纠偏|续接)/iu.test(`${id} ${fact}`)
    && /(?:续接点|纠偏.*(?:时间|时刻)|第\s*\d+\s*日|\d{1,2}:\d{2})/u.test(fact);
}

function readStatePath(memory, path) {
  let current = memory;
  for (const segment of String(path || '').split('.')) {
    if (!current || typeof current !== 'object' || !Object.hasOwn(current, segment)) return undefined;
    current = current[segment];
  }
  return current;
}

function cleanFactId(value) {
  return String(value || '').trim().toLowerCase()
    .replace(/[^a-z0-9_.:\-\u4e00-\u9fff]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 100) || 'fact';
}

function cleanStatePath(value) {
  const path = String(value || '').trim();
  return /^[A-Za-z0-9_.-]{1,160}$/u.test(path) ? path : '';
}

function normalizeExpectedValue(value) {
  if (typeof value === 'boolean' || typeof value === 'string' || value === null) return value;
  if (Number.isFinite(Number(value))) return Number(value);
  return String(value || '').slice(0, 160);
}

function hasLaterSceneState(memory, repair) {
  const appliedAt = Date.parse(repair.appliedAt || '');
  const currentActAt = Date.parse(String(memory?.characterRegistry?.currentAct?.updatedAt || ''));
  if (Number.isFinite(appliedAt) && Number.isFinite(currentActAt) && currentActAt > appliedAt) return true;

  const facts = repair.canonicalFacts;
  const currentLocation = cleanText(memory?.worldState?.location?.name || memory?.worldState?.location?.current, 160);
  const currentTime = cleanText(memory?.worldState?.flags?.time, 160);
  return Boolean(
    (facts.location && currentLocation && currentLocation !== facts.location)
    || (facts.time && currentTime && currentTime !== facts.time)
  );
}

function normalizeCanonicalFacts(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    protagonistName: cleanText(source.protagonistName, 100),
    protagonistRole: cleanText(source.protagonistRole, 240),
    time: cleanText(source.time, 160),
    location: cleanText(source.location, 160),
    presentCharacters: uniqueStrings(source.presentCharacters).slice(0, 32)
  };
}

function mergeCanonicalWorldState(worldState, facts) {
  const next = worldState && typeof worldState === 'object' && !Array.isArray(worldState)
    ? structuredClone(worldState)
    : {};
  if (facts.protagonistName || facts.protagonistRole) {
    next.protagonist = {
      ...(next.protagonist && typeof next.protagonist === 'object' ? next.protagonist : {}),
      ...(facts.protagonistName ? { name: facts.protagonistName } : {}),
      ...(facts.protagonistRole ? { role: facts.protagonistRole } : {})
    };
  }
  if (facts.location) {
    next.location = {
      ...(next.location && typeof next.location === 'object' ? next.location : {}),
      name: facts.location
    };
  }
  if (facts.time) {
    next.flags = {
      ...(next.flags && typeof next.flags === 'object' ? next.flags : {}),
      time: facts.time
    };
  }
  return next;
}

function supersedeEpisodesForExcludedMessages(episodicMemory, excludedMessageIds, appliedAt) {
  if (!episodicMemory || typeof episodicMemory !== 'object' || !Array.isArray(episodicMemory.episodes)) return;
  const excluded = new Set(excludedMessageIds);
  episodicMemory.episodes = episodicMemory.episodes.map((episode) => {
    const sourceIds = Array.isArray(episode?.sourceMessageIds) ? episode.sourceMessageIds : [];
    if (!sourceIds.some((id) => excluded.has(String(id || '')))) return episode;
    return {
      ...episode,
      status: 'superseded',
      updatedAt: appliedAt,
      supersededReason: 'narrative-forward-repair'
    };
  });
}

function resetDerivedNarrativeMemory(memory, appliedAt) {
  memory.memoryCards = [];
  memory.eventLedger = [];
  memory.knowledgeGraph = {
    revision: Number(memory?.knowledgeGraph?.revision || 0) + 1,
    nodes: [],
    edges: []
  };
  delete memory.simulation;
  delete memory.simulationBaseline;
  delete memory.actionCheckpointMessageId;
  memory.unsummarizedTurnCount = 0;
  if (!memory.episodicMemory || typeof memory.episodicMemory !== 'object') return;
  const state = memory.episodicMemory;
  if (Array.isArray(state.episodes)) {
    state.episodes = state.episodes.map((episode) => ({
      ...episode,
      status: 'superseded',
      updatedAt: appliedAt,
      supersededReason: 'narrative-forward-repair'
    }));
  }
  for (const collection of Object.values(state.summaries || {})) {
    if (!Array.isArray(collection)) continue;
    collection.forEach((summary) => {
      summary.status = 'superseded';
      summary.updatedAt = appliedAt;
    });
  }
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => cleanText(value, 240))
    .filter(Boolean))];
}

function cleanText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}
