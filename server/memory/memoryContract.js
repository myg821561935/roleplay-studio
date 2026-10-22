import crypto from 'node:crypto';

export const MEMORY_SPEC = 'nre.memory/v1';
export const MEMORY_KINDS = Object.freeze({
  EPISODE: 'episode',
  SUMMARY: 'summary',
  DECISION: 'decision'
});
export const MEMORY_SUMMARY_LEVELS = Object.freeze({
  SCENE: 'scene',
  CHAPTER: 'chapter',
  ARC: 'arc'
});
export const MEMORY_HIERARCHY_POLICY = Object.freeze({
  scenesPerChapter: 4,
  chaptersPerArc: 3
});

const MEMORY_STATUSES = new Set(['candidate', 'confirmed', 'superseded']);
const MEMORY_VISIBILITIES = new Set(['player', 'director']);
const SUMMARY_LEVELS = new Set(Object.values(MEMORY_SUMMARY_LEVELS));
const SUMMARY_COLLECTIONS = Object.freeze({
  [MEMORY_SUMMARY_LEVELS.SCENE]: 'scenes',
  [MEMORY_SUMMARY_LEVELS.CHAPTER]: 'chapters',
  [MEMORY_SUMMARY_LEVELS.ARC]: 'arcs'
});
const FORBIDDEN_REASONING_KEYS = new Set([
  'analysis',
  'chainofthought',
  'chain_of_thought',
  'cot',
  'reasoning',
  'thinking',
  'scratchpad'
]);
const HIDDEN_REASONING_BLOCK = /<(think|thinking|analysis|reasoning|planing|planning|cot)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const UNCLOSED_REASONING_BLOCK = /<(think|thinking|analysis|reasoning|planing|planning|cot)\b[^>]*>[\s\S]*$/gi;
const ORPHAN_REASONING_TAG = /<\/?(?:think|thinking|analysis|reasoning|planing|planning|cot)\b[^>]*>/gi;

export function createCoreMemory() {
  return {
    personaView: '',
    activeCommitments: [],
    coreDirectives: []
  };
}

export function normalizeCoreMemory(value) {
  const source = isPlainObject(value) ? value : {};
  return {
    personaView: sanitizeMemoryText(source.personaView || '', 600),
    activeCommitments: (Array.isArray(source.activeCommitments) ? source.activeCommitments : typeof source.activeCommitments === 'string' ? [source.activeCommitments] : [])
      .map((item) => sanitizeMemoryText(item, 240))
      .filter(Boolean)
      .slice(0, 10),
    coreDirectives: (Array.isArray(source.coreDirectives) ? source.coreDirectives : typeof source.coreDirectives === 'string' ? [source.coreDirectives] : [])
      .map((item) => sanitizeMemoryText(item, 240))
      .filter(Boolean)
      .slice(0, 10)
  };
}

export function createMemoryState() {
  return {
    spec: MEMORY_SPEC,
    coreMemory: createCoreMemory(),
    episodes: [],
    summaries: {
      scenes: [],
      chapters: [],
      arcs: []
    },
    decisions: [],
    retrievalAudit: [],
    updatedAt: ''
  };
}

export function normalizeMemoryState(value) {
  const source = isPlainObject(value) ? value : {};
  const defaults = createMemoryState();
  return {
    spec: MEMORY_SPEC,
    coreMemory: normalizeCoreMemory(source.coreMemory),
    episodes: (Array.isArray(source.episodes) ? source.episodes : [])
      .map(normalizeMemoryItem)
      .filter((item) => item.kind === MEMORY_KINDS.EPISODE)
      .slice(-2000),
    summaries: {
      scenes: normalizeSummaryList(source.summaries?.scenes, MEMORY_SUMMARY_LEVELS.SCENE),
      chapters: normalizeSummaryList(source.summaries?.chapters, MEMORY_SUMMARY_LEVELS.CHAPTER),
      arcs: normalizeSummaryList(source.summaries?.arcs, MEMORY_SUMMARY_LEVELS.ARC)
    },
    decisions: (Array.isArray(source.decisions) ? source.decisions : [])
      .map(normalizeDecisionRecord)
      .filter((item) => item.decision)
      .slice(-200),
    retrievalAudit: (Array.isArray(source.retrievalAudit) ? source.retrievalAudit : [])
      .map(normalizeRetrievalAudit)
      .slice(-100),
    updatedAt: normalizeIsoDate(source.updatedAt, defaults.updatedAt)
  };
}

export function createTurnEpisode({
  session,
  userMessage,
  assistantMessage,
  now = () => new Date()
} = {}) {
  const assistantId = cleanId(assistantMessage?.id);
  if (!assistantId) throw new MemoryContractError('MEMORY_ASSISTANT_MESSAGE_REQUIRED');
  const userId = cleanId(userMessage?.id);
  const userIntent = sanitizeMemoryText(userMessage?.content, 320);
  const narrative = sanitizeMemoryText(assistantMessage?.content, 900);
  const sourceMessageIds = [userId, assistantId].filter(Boolean);
  const createdAt = normalizeIsoDate(assistantMessage?.createdAt || now().toISOString());
  const location = sanitizeMemoryText(session?.memory?.worldState?.location?.current, 120);
  const speaker = sanitizeMemoryText(assistantMessage?.speaker, 80);
  const entities = collectKnownEntities(session, `${userIntent}\n${narrative}`);
  const branchKey = `${assistantId}:${normalizeInteger(assistantMessage?.activeSwipeIndex, 0)}`;
  const excluded = userMessage?.excluded || assistantMessage?.excluded || assistantMessage?.contextExcluded;
  return normalizeMemoryItem({
    id: `episode:${assistantId}`,
    kind: MEMORY_KINDS.EPISODE,
    title: firstSentence(narrative || userIntent) || `第 ${sourceMessageIds.length ? session?.messages?.length || 0 : 0} 轮`,
    summary: narrative,
    userIntent,
    sourceMessageIds,
    perspective: speaker || 'narrator',
    visibility: userMessage?.hiddenFromChat || assistantMessage?.hiddenFromChat ? 'director' : 'player',
    confidence: 1,
    importance: estimateImportance({ userMessage, assistantMessage }),
    status: excluded ? 'superseded' : 'confirmed',
    authority: assistantMessage?.turnFrame?.validation?.status === 'accepted'
      ? 'accepted-turn-frame'
      : 'model-narrative',
    sourceKind: assistantMessage?.turnFrame?.validation?.status === 'accepted'
      ? 'structured-turn'
      : 'unstructured-turn',
    validFromTurn: Math.max(0, Number(session?.messages?.length || 0) - 1),
    validToTurn: null,
    branchKey,
    contentHash: contentHash(`${userIntent}\n${narrative}\n${branchKey}`),
    tags: uniqueStrings([assistantMessage?.kind, location ? 'scene' : '', speaker ? 'speaker' : '']),
    entities,
    scene: location,
    revision: 1,
    createdAt,
    updatedAt: now().toISOString()
  });
}

export function upsertEpisode(memoryState, input, { now = () => new Date() } = {}) {
  const state = normalizeMemoryState(memoryState);
  const episode = normalizeMemoryItem(input);
  const index = state.episodes.findIndex((item) => item.id === episode.id);
  if (index < 0) {
    state.episodes.push(episode);
  } else {
    const previous = state.episodes[index];
    state.episodes[index] = {
      ...previous,
      ...episode,
      createdAt: previous.createdAt || episode.createdAt,
      revision: previous.contentHash === episode.contentHash
        ? previous.revision
        : Math.max(1, previous.revision + 1),
      updatedAt: now().toISOString()
    };
  }
  state.episodes = state.episodes.slice(-2000);
  state.updatedAt = now().toISOString();
  return state;
}

export function createHierarchySummary({
  id,
  level,
  title,
  summary,
  sourceMessageIds = [],
  sourceEpisodeIds = [],
  sourceEpisodeRefs = [],
  childSummaryIds = [],
  childSummaryRefs = [],
  validFromTurn = 0,
  validToTurn = null,
  visibility = 'player',
  confidence = 1,
  importance = 0.7,
  now = () => new Date()
} = {}) {
  const summaryLevel = normalizeSummaryLevel(level);
  const safeSummary = sanitizeMemoryText(summary, 1200);
  if (!safeSummary) throw new MemoryContractError('MEMORY_SUMMARY_CONTENT_REQUIRED');
  const references = uniqueStrings([
    ...sourceEpisodeRefs,
    ...childSummaryRefs,
    ...sourceEpisodeIds,
    ...childSummaryIds
  ]);
  const stableReference = references.at(-1) || contentHash(safeSummary).slice(0, 16);
  const timestamp = now().toISOString();
  return normalizeMemoryItem({
    id: cleanId(id) || `summary:${summaryLevel}:${stableReference}`,
    kind: MEMORY_KINDS.SUMMARY,
    summaryLevel,
    title: sanitizeMemoryText(title, 160) || firstSentence(safeSummary) || `${summaryLevel} 摘要`,
    summary: safeSummary,
    sourceMessageIds,
    sourceEpisodeIds,
    sourceEpisodeRefs,
    childSummaryIds,
    childSummaryRefs,
    perspective: 'narrator',
    visibility,
    confidence,
    importance,
    status: 'confirmed',
    validFromTurn,
    validToTurn,
    branchKey: references.join('|'),
    contentHash: contentHash(`${summaryLevel}\n${safeSummary}\n${references.join('|')}`),
    tags: ['hierarchical-summary', summaryLevel],
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

export function upsertSummary(memoryState, input, { now = () => new Date() } = {}) {
  const state = normalizeMemoryState(memoryState);
  const summary = normalizeMemoryItem({ ...input, kind: MEMORY_KINDS.SUMMARY });
  const collection = SUMMARY_COLLECTIONS[summary.summaryLevel];
  const list = state.summaries[collection];
  const index = list.findIndex((item) => item.id === summary.id);
  if (index < 0) {
    list.push(summary);
  } else {
    const previous = list[index];
    list[index] = {
      ...previous,
      ...summary,
      createdAt: previous.createdAt || summary.createdAt,
      revision: previous.contentHash === summary.contentHash
        ? previous.revision
        : Math.max(1, previous.revision + 1),
      updatedAt: now().toISOString()
    };
  }
  state.summaries[collection] = list.slice(-200);
  state.updatedAt = now().toISOString();
  return state;
}

export function supersedeInactiveEpisodes(memoryState, activeMessageIds, {
  validToTurn = null,
  now = () => new Date()
} = {}) {
  const state = normalizeMemoryState(memoryState);
  const active = new Set(Array.isArray(activeMessageIds) ? activeMessageIds.map(cleanId).filter(Boolean) : []);
  state.episodes = state.episodes.map((episode) => {
    const remainsActive = episode.sourceMessageIds.every((id) => active.has(id));
    if (remainsActive || episode.status === 'superseded') return episode;
    return {
      ...episode,
      status: 'superseded',
      validToTurn: validToTurn === null ? episode.validToTurn : normalizeInteger(validToTurn, 0),
      updatedAt: now().toISOString()
    };
  });
  state.updatedAt = now().toISOString();
  return state;
}

export function refreshSummaryValidity(memoryState, {
  validToTurn = null,
  now = () => new Date()
} = {}) {
  const state = normalizeMemoryState(memoryState);
  const timestamp = now().toISOString();
  const episodeMap = new Map(state.episodes.map((item) => [item.id, item]));
  state.summaries.scenes = refreshSummaryList(
    state.summaries.scenes,
    episodeMap,
    'sourceEpisodeIds',
    'sourceEpisodeRefs',
    validToTurn,
    timestamp
  );
  const sceneMap = new Map(state.summaries.scenes.map((item) => [item.id, item]));
  state.summaries.chapters = refreshSummaryList(
    state.summaries.chapters,
    sceneMap,
    'childSummaryIds',
    'childSummaryRefs',
    validToTurn,
    timestamp
  );
  const chapterMap = new Map(state.summaries.chapters.map((item) => [item.id, item]));
  state.summaries.arcs = refreshSummaryList(
    state.summaries.arcs,
    chapterMap,
    'childSummaryIds',
    'childSummaryRefs',
    validToTurn,
    timestamp
  );
  state.updatedAt = timestamp;
  return state;
}

export function selectEpisodicMemories(memoryState, {
  query = '',
  excludeMessageIds = [],
  limit = 6,
  view = 'player',
  activeScene = null,
  relatedEntities = []
} = {}) {
  const state = normalizeMemoryState(memoryState);
  const excluded = new Set(excludeMessageIds.map(cleanId).filter(Boolean));
  const queryTerms = tokenize(query);
  const entityBoost = buildEntityBoost(relatedEntities);
  const director = view === 'director';
  const candidates = state.episodes
    .filter((episode) => episode.status === 'confirmed')
    .filter((episode) => director || episode.visibility === 'player')
    .filter((episode) => !episode.sourceMessageIds.some((id) => excluded.has(id)))
    .map((episode, index) => ({
      ...episode,
      retrievalScore: scoreEpisode(episode, queryTerms, index, state.episodes.length)
        + scoreEntityBoost(episode, entityBoost)
    }))
    .filter((episode) => !queryTerms.size || episode.retrievalScore > 0);
  const sceneAnchored = constrainEpisodesToActiveScene(candidates, activeScene);
  return sceneAnchored
    .sort((left, right) => (
      right.retrievalScore - left.retrievalScore
      || right.importance - left.importance
      || String(right.updatedAt).localeCompare(String(left.updatedAt))
    ))
    .slice(0, clampInteger(limit, 1, 20, 6));
}

function constrainEpisodesToActiveScene(episodes, activeScene) {
  const location = String(activeScene?.location || '').trim();
  if (!location) return episodes;
  const matches = episodes.filter((episode) => episodeMatchesSceneLocation(episode, location));
  // 有明确的当前地点但历史片段没有同场景证据时，宁可不召回，
  // 也不能把同名人物的旧场景重新写进当前剧情。
  return matches;
}

function episodeMatchesSceneLocation(episode, location) {
  const source = [episode?.title, episode?.summary, episode?.scene]
    .filter(Boolean)
    .join('\n')
    .normalize('NFKC');
  return source.includes(location.normalize('NFKC'));
}

export function selectHierarchicalSummaries(memoryState, {
  query = '',
  excludeMessageIds = [],
  view = 'player',
  limits = {},
  relatedEntities = []
} = {}) {
  const state = normalizeMemoryState(memoryState);
  const excluded = new Set(excludeMessageIds.map(cleanId).filter(Boolean));
  const queryTerms = tokenize(query);
  const entityBoost = buildEntityBoost(relatedEntities);
  const director = view === 'director';
  const requestedLimits = {
    [MEMORY_SUMMARY_LEVELS.ARC]: clampInteger(limits.arc, 0, 4, 1),
    [MEMORY_SUMMARY_LEVELS.CHAPTER]: clampInteger(limits.chapter, 0, 8, 2),
    [MEMORY_SUMMARY_LEVELS.SCENE]: clampInteger(limits.scene, 0, 12, 3)
  };
  return [
    [MEMORY_SUMMARY_LEVELS.ARC, state.summaries.arcs],
    [MEMORY_SUMMARY_LEVELS.CHAPTER, state.summaries.chapters],
    [MEMORY_SUMMARY_LEVELS.SCENE, state.summaries.scenes]
  ].flatMap(([level, items]) => items
    .filter((item) => item.status === 'confirmed')
    .filter((item) => director || item.visibility === 'player')
    .filter((item) => !item.sourceMessageIds.some((id) => excluded.has(id)))
    .map((item, index) => ({
      ...item,
      retrievalScore: scoreSummary(item, queryTerms, index, items.length)
        + scoreEntityBoost(item, entityBoost)
    }))
    .sort((left, right) => (
      right.retrievalScore - left.retrievalScore
      || right.validFromTurn - left.validFromTurn
      || String(right.updatedAt).localeCompare(String(left.updatedAt))
    ))
    .slice(0, requestedLimits[level]));
}

export function composeRollingSummary(memoryState) {
  const state = normalizeMemoryState(memoryState);
  const arcs = state.summaries.arcs.filter((item) => item.status === 'confirmed');
  const coveredChapters = new Set(arcs.flatMap((item) => item.childSummaryIds));
  const chapters = state.summaries.chapters
    .filter((item) => item.status === 'confirmed' && !coveredChapters.has(item.id));
  const coveredScenes = new Set([
    ...state.summaries.chapters
      .filter((item) => item.status === 'confirmed')
      .flatMap((item) => item.childSummaryIds)
  ]);
  const scenes = state.summaries.scenes
    .filter((item) => item.status === 'confirmed' && !coveredScenes.has(item.id));
  return sanitizeMemoryText(
    [...arcs, ...chapters, ...scenes]
      .sort((left, right) => left.validFromTurn - right.validFromTurn)
      .map((item) => `${item.title}：${item.summary}`)
      .join('\n'),
    6000
  );
}

export function createDecisionRecord(input = {}, { now = () => new Date() } = {}) {
  const safe = stripReasoningFields(input);
  return normalizeDecisionRecord({
    id: safe.id || `decision:${crypto.randomUUID()}`,
    decision: safe.decision || safe.outcome || safe.conclusion,
    evidenceMessageIds: safe.evidenceMessageIds || safe.evidenceIds,
    policy: safe.policy || safe.rule,
    confidence: safe.confidence,
    visibility: safe.visibility,
    createdAt: safe.createdAt || now().toISOString()
  });
}

export function appendRetrievalAudit(memoryState, input, { now = () => new Date() } = {}) {
  const state = normalizeMemoryState(memoryState);
  state.retrievalAudit.push(normalizeRetrievalAudit({
    id: input?.id || `retrieval:${crypto.randomUUID()}`,
    queryHash: contentHash(String(input?.query || '')),
    episodeIds: input?.episodeIds,
    summaryIds: input?.summaryIds,
    vectorMessageIds: input?.vectorMessageIds,
    graphRevision: input?.graphRevision,
    createdAt: input?.createdAt || now().toISOString()
  }));
  state.retrievalAudit = state.retrievalAudit.slice(-100);
  state.updatedAt = now().toISOString();
  return state;
}

export function sanitizeMemoryText(value, maxLength = 1000) {
  return String(value ?? '')
    .replace(HIDDEN_REASONING_BLOCK, '')
    .replace(UNCLOSED_REASONING_BLOCK, '')
    .replace(ORPHAN_REASONING_TAG, '')
    .replace(/```(?:analysis|reasoning|thinking|cot)[\s\S]*?```/gi, '')
    .replace(/```(?:analysis|reasoning|thinking|cot)[\s\S]*$/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export class MemoryContractError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function normalizeMemoryItem(value) {
  const source = stripReasoningFields(isPlainObject(value) ? value : {});
  return {
    id: cleanId(source.id) || `memory:${crypto.randomUUID()}`,
    kind: source.kind === MEMORY_KINDS.SUMMARY ? MEMORY_KINDS.SUMMARY : MEMORY_KINDS.EPISODE,
    summaryLevel: source.kind === MEMORY_KINDS.SUMMARY ? normalizeSummaryLevel(source.summaryLevel) : '',
    title: sanitizeMemoryText(source.title, 160),
    summary: sanitizeMemoryText(source.summary || source.content, 1200),
    userIntent: sanitizeMemoryText(source.userIntent, 400),
    sourceMessageIds: uniqueStrings(source.sourceMessageIds),
    sourceEpisodeIds: uniqueStrings(source.sourceEpisodeIds),
    sourceEpisodeRefs: uniqueStrings(source.sourceEpisodeRefs),
    childSummaryIds: uniqueStrings(source.childSummaryIds),
    childSummaryRefs: uniqueStrings(source.childSummaryRefs),
    perspective: sanitizeMemoryText(source.perspective, 80) || 'narrator',
    visibility: normalizeVisibility(source.visibility),
    confidence: clampNumber(source.confidence, 0, 1, 1),
    importance: clampNumber(source.importance, 0, 1, 0.5),
    status: normalizeStatus(source.status),
    authority: sanitizeMemoryText(source.authority, 80),
    sourceKind: sanitizeMemoryText(source.sourceKind, 80),
    validFromTurn: normalizeInteger(source.validFromTurn, 0),
    validToTurn: source.validToTurn === null || source.validToTurn === undefined
      ? null
      : normalizeInteger(source.validToTurn, 0),
    branchKey: sanitizeMemoryText(source.branchKey, 160),
    contentHash: cleanId(source.contentHash) || contentHash(source.summary || source.content || ''),
    tags: uniqueStrings(source.tags),
    entities: uniqueStrings(source.entities),
    scene: sanitizeMemoryText(source.scene, 160),
    revision: Math.max(1, normalizeInteger(source.revision, 1)),
    createdAt: normalizeIsoDate(source.createdAt),
    updatedAt: normalizeIsoDate(source.updatedAt || source.createdAt)
  };
}

function normalizeDecisionRecord(value) {
  const source = stripReasoningFields(isPlainObject(value) ? value : {});
  return {
    id: cleanId(source.id) || `decision:${crypto.randomUUID()}`,
    decision: sanitizeMemoryText(source.decision, 500),
    evidenceMessageIds: uniqueStrings(source.evidenceMessageIds),
    policy: sanitizeMemoryText(source.policy, 240),
    confidence: clampNumber(source.confidence, 0, 1, 1),
    visibility: normalizeVisibility(source.visibility),
    createdAt: normalizeIsoDate(source.createdAt)
  };
}

function normalizeSummaryList(value, level) {
  return (Array.isArray(value) ? value : [])
    .map((item) => normalizeMemoryItem({
      ...item,
      kind: MEMORY_KINDS.SUMMARY,
      summaryLevel: normalizeSummaryLevel(item?.summaryLevel || level)
    }))
    .slice(-200);
}

function normalizeRetrievalAudit(value) {
  const source = isPlainObject(value) ? value : {};
  return {
    id: cleanId(source.id) || `retrieval:${crypto.randomUUID()}`,
    queryHash: cleanId(source.queryHash),
    episodeIds: uniqueStrings(source.episodeIds),
    summaryIds: uniqueStrings(source.summaryIds),
    vectorMessageIds: uniqueStrings(source.vectorMessageIds),
    graphRevision: normalizeInteger(source.graphRevision, 0),
    createdAt: normalizeIsoDate(source.createdAt)
  };
}

function stripReasoningFields(value) {
  if (!isPlainObject(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key]) => (
    !FORBIDDEN_REASONING_KEYS.has(String(key).toLowerCase())
  )));
}

function collectKnownEntities(session, text) {
  const state = session?.memory?.worldState || {};
  const candidates = [
    state.protagonist?.name,
    ...(state.characters || []).map((item) => item?.name || item?.character),
    ...(state.factions || []).map((item) => item?.name || item?.faction)
  ].map((item) => sanitizeMemoryText(item, 80)).filter(Boolean);
  return uniqueStrings(candidates.filter((name) => String(text || '').includes(name)));
}

function estimateImportance({ userMessage, assistantMessage }) {
  const text = `${userMessage?.content || ''}\n${assistantMessage?.content || ''}`;
  let score = 0.35;
  if (assistantMessage?.bookmarked || userMessage?.bookmarked) score += 0.35;
  if (assistantMessage?.actionEnvelope || assistantMessage?.adjudication) score += 0.15;
  if (assistantMessage?.roleplayPanels?.relationshipStatus) score += 0.1;
  if (/死亡|受伤|承诺|背叛|秘密|真相|任务|决定|加入|离开|关系|信任|敌对/.test(text)) score += 0.15;
  return Math.min(1, score);
}

function buildEntityBoost(relatedEntities) {
  const terms = [];
  (Array.isArray(relatedEntities) ? relatedEntities : []).forEach((entity) => {
    if (!entity) return;
    if (typeof entity === 'string') {
      const name = entity.trim();
      if (name) terms.push(name);
      return;
    }
    if (entity.name) terms.push(String(entity.name).trim());
    if (Array.isArray(entity.aliases)) {
      entity.aliases.forEach((alias) => {
        if (alias) terms.push(String(alias).trim());
      });
    }
  });
  return [...new Set(terms.filter(Boolean))].slice(0, 30);
}

function scoreEntityBoost(item, entityTerms) {
  if (!entityTerms.length) return 0;
  const source = [
    item?.title,
    item?.summary,
    item?.userIntent,
    item?.scene,
    ...(Array.isArray(item?.entities) ? item.entities : []),
    ...(Array.isArray(item?.tags) ? item.tags : [])
  ].filter(Boolean).join('\n').normalize('NFKC');

  let boost = 0;
  entityTerms.forEach((term) => {
    if (term.length >= 2 && source.includes(term)) boost += 8;
  });
  return boost;
}

function scoreEpisode(episode, queryTerms, index, total) {
  if (!queryTerms.size) return episode.importance * 2 + index / Math.max(1, total);
  const episodeTerms = tokenize([
    episode.title,
    episode.summary,
    episode.userIntent,
    episode.scene,
    ...episode.entities,
    ...episode.tags
  ].join(' '));
  let matches = 0;
  queryTerms.forEach((term) => {
    if (episodeTerms.has(term)) matches += term.length > 1 ? 2 : 1;
  });
  return matches * 10 + episode.importance * 2 + index / Math.max(1, total);
}

function scoreSummary(summary, queryTerms, index, total) {
  const summaryTerms = tokenize([
    summary.title,
    summary.summary,
    ...summary.entities,
    ...summary.tags
  ].join(' '));
  let matches = 0;
  queryTerms.forEach((term) => {
    if (summaryTerms.has(term)) matches += term.length > 1 ? 2 : 1;
  });
  const levelWeight = summary.summaryLevel === MEMORY_SUMMARY_LEVELS.ARC
    ? 3
    : summary.summaryLevel === MEMORY_SUMMARY_LEVELS.CHAPTER ? 2 : 1;
  return matches * 10 + levelWeight + summary.importance * 2 + index / Math.max(1, total);
}

function refreshSummaryList(items, sourceMap, idField, refField, validToTurn, timestamp) {
  return items.map((item) => {
    const ids = item[idField];
    const refs = item[refField];
    const valid = refs.length
      ? refs.every((ref) => referenceIsCurrent(ref, sourceMap))
      : ids.length ? ids.every((id) => sourceMap.get(id)?.status === 'confirmed') : true;
    const nextStatus = valid ? 'confirmed' : 'superseded';
    if (item.status === nextStatus) return item;
    return {
      ...item,
      status: nextStatus,
      validToTurn: valid
        ? item.validToTurn
        : validToTurn === null ? item.validToTurn : normalizeInteger(validToTurn, 0),
      updatedAt: timestamp
    };
  });
}

function referenceIsCurrent(reference, sourceMap) {
  const value = String(reference || '');
  const separator = value.lastIndexOf('@');
  if (separator <= 0) return sourceMap.get(value)?.status === 'confirmed';
  const id = value.slice(0, separator);
  const revision = Number(value.slice(separator + 1));
  const source = sourceMap.get(id);
  return source?.status === 'confirmed' && Number(source.revision) === revision;
}

function tokenize(value) {
  const text = String(value || '').normalize('NFKC').toLocaleLowerCase('zh-CN');
  const tokens = new Set(text.match(/[a-z0-9_]{2,}|[\u3400-\u9fff]{1,4}/g) || []);
  const chinese = [...text].filter((char) => /[\u3400-\u9fff]/.test(char));
  for (let index = 0; index < chinese.length - 1; index += 1) {
    tokens.add(chinese[index] + chinese[index + 1]);
  }
  return tokens;
}

function firstSentence(value) {
  return String(value || '').split(/[。！？!?\n]/)[0].trim().slice(0, 100);
}

function contentHash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function uniqueStrings(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((item) => sanitizeMemoryText(item, 160))
    .filter(Boolean))].slice(0, 64);
}

function cleanId(value) {
  return String(value || '').trim().slice(0, 200);
}

function normalizeVisibility(value) {
  const visibility = String(value || 'player').toLowerCase();
  return MEMORY_VISIBILITIES.has(visibility) ? visibility : 'player';
}

function normalizeSummaryLevel(value) {
  const level = String(value || MEMORY_SUMMARY_LEVELS.SCENE).toLowerCase();
  return SUMMARY_LEVELS.has(level) ? level : MEMORY_SUMMARY_LEVELS.SCENE;
}

function normalizeStatus(value) {
  const status = String(value || 'confirmed').toLowerCase();
  return MEMORY_STATUSES.has(status) ? status : 'confirmed';
}

function normalizeInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : fallback;
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.floor(number))) : fallback;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function normalizeIsoDate(value, fallback = '') {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
