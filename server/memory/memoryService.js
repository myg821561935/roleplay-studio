import { buildSceneContinuity } from '../agent/sceneContinuity.js';
import { filterNarrativeContextMessages } from './narrativeRepair.js';
import { rebuildMemoryFromMessages } from '../agent/memoryUpdater.js';
import {
  MEMORY_HIERARCHY_POLICY,
  MEMORY_SPEC,
  MEMORY_SUMMARY_LEVELS,
  appendRetrievalAudit,
  composeRollingSummary,
  createDecisionRecord,
  createHierarchySummary,
  createMemoryState,
  createTurnEpisode,
  normalizeMemoryState,
  refreshSummaryValidity,
  selectEpisodicMemories,
  selectHierarchicalSummaries,
  supersedeInactiveEpisodes,
  upsertEpisode,
  upsertSummary
} from './memoryContract.js';
import { getNarrativeRepairContextExclusions } from './narrativeRepair.js';
import { expandQueryWithGraph } from './graphGuidedRetrieval.js';

export class MemoryService {
  constructor({ vectorMemoryService = null, now = () => new Date() } = {}) {
    this.vectorMemoryService = vectorMemoryService;
    this.now = now;
  }

  ensureState(session) {
    session.memory = session.memory && typeof session.memory === 'object' ? session.memory : {};
    session.memory.episodicMemory = normalizeMemoryState(
      session.memory.episodicMemory || createMemoryState()
    );
    return session.memory.episodicMemory;
  }

  observeTurn({ session, userMessage, assistantMessage }) {
    const state = this.ensureState(session);
    const episode = createTurnEpisode({ session, userMessage, assistantMessage, now: this.now });
    session.memory.episodicMemory = upsertEpisode(state, episode, { now: this.now });
    session.memory.sceneContinuity = this.buildContinuity(session);
    // Parsing hints survive history replay losing the transient cast registry.
    // Rebuild always re-reads current prose; these names never restore old facts.
    assistantMessage.sceneContinuityActors = session.memory.sceneContinuity.actors
      .filter(event => event.sourceMessageId === assistantMessage.id).map(event => event.actor);
    return episode;
  }

  buildContinuity(session, messages = session.messages, memory = session.memory) {
    return buildSceneContinuity({ messages: filterNarrativeContextMessages(messages || [], memory), memory,
      worldBook: session.config?.worldBook, persona: session.config?.persona });
  }

  recordDecision({ session, ...input }) {
    const state = this.ensureState(session);
    const record = createDecisionRecord(input, { now: this.now });
    const index = state.decisions.findIndex((item) => item.id === record.id);
    if (index < 0) state.decisions.push(record);
    else state.decisions[index] = record;
    state.decisions = state.decisions.slice(-200);
    state.updatedAt = this.now().toISOString();
    session.memory.episodicMemory = state;
    return record;
  }

  recordSceneSummary({ session, title, summary, messages = [] }) {
    let state = this.ensureState(session);
    const sourceMessageIds = messages
      .filter((message) => message && !message.excluded)
      .map((message) => message.id)
      .filter(Boolean);
    const sourceMessageIdSet = new Set(sourceMessageIds);
    const sourceEpisodes = state.episodes.filter((episode) => (
      episode.status === 'confirmed'
      && episode.sourceMessageIds.some((id) => sourceMessageIdSet.has(id))
    ));
    const sourceEpisodeIds = sourceEpisodes.map((episode) => episode.id);
    const sourceEpisodeRefs = sourceEpisodes.map((episode) => `${episode.id}@${episode.revision}`);
    const validFromTurn = sourceEpisodes.length
      ? Math.min(...sourceEpisodes.map((episode) => episode.validFromTurn))
      : Math.max(0, Number(session?.messages?.length || 0) - sourceMessageIds.length);
    const validToTurn = sourceEpisodes.length
      ? Math.max(...sourceEpisodes.map((episode) => episode.validToTurn ?? episode.validFromTurn))
      : Math.max(0, Number(session?.messages?.length || 0) - 1);
    const visibility = sourceEpisodes.some((episode) => episode.visibility === 'director')
      ? 'director'
      : 'player';
    const record = createHierarchySummary({
      level: MEMORY_SUMMARY_LEVELS.SCENE,
      title,
      summary,
      sourceMessageIds,
      sourceEpisodeIds,
      sourceEpisodeRefs,
      validFromTurn,
      validToTurn,
      visibility,
      now: this.now
    });
    state = upsertSummary(state, record, { now: this.now });
    state = refreshSummaryValidity(state, {
      validToTurn: Number(session?.messages?.length || 0),
      now: this.now
    });
    const promotion = promoteHierarchy(state, { now: this.now });
    session.memory.episodicMemory = promotion.state;
    return {
      summary: findSummaryById(promotion.state, record.id),
      promotedChapters: promotion.promotedChapters,
      promotedArcs: promotion.promotedArcs
    };
  }

  async retrieveContext({ session, userMessage, excludeMessageIds = [], view = 'player' }) {
    const query = String(userMessage?.content || userMessage || '').trim();
    const state = this.ensureState(session);
    const recentMessageIds = (Array.isArray(session?.messages) ? session.messages : [])
      .slice(-16)
      .map((message) => message?.id)
      .filter(Boolean);
    const repairExcludes = [...getNarrativeRepairContextExclusions(session.memory)];
    const retrievalExcludes = [...new Set([...excludeMessageIds, ...recentMessageIds, ...repairExcludes])];
    const activeScene = resolveActiveSceneAnchor(session.memory);
    const graph = session.memory?.knowledgeGraph || null;

    const graphExpansion = expandQueryWithGraph({
      graph,
      query,
      hops: 2,
      view
    });

    const episodicHits = selectEpisodicMemories(state, {
      query,
      excludeMessageIds: retrievalExcludes,
      limit: 6,
      view,
      activeScene,
      relatedEntities: graphExpansion.relatedEntities
    });
    const summaryHits = selectHierarchicalSummaries(state, {
      query,
      excludeMessageIds: retrievalExcludes,
      view,
      relatedEntities: graphExpansion.relatedEntities
    });
    const { vectorHits, vectorEnabled } = await this.retrieveVectorHits({
      session,
      query: graphExpansion.expandedQuery,
      excludeMessageIds: retrievalExcludes
    });
    session.memory.episodicMemory = appendRetrievalAudit(state, {
      query,
      episodeIds: episodicHits.map((item) => item.id),
      summaryIds: summaryHits.map((item) => item.id),
      vectorMessageIds: vectorHits.map((item) => item.messageId),
      graphRevision: graph?.revision
    }, { now: this.now });
    return {
      spec: MEMORY_SPEC,
      query,
      episodicHits,
      summaryHits,
      vectorHits,
      vectorEnabled,
      graphRevision: Number(graph?.revision || 0),
      graphExpansion,
      decisionRecords: state.decisions.filter((item) => view === 'director' || item.visibility === 'player').slice(-8),
      audit: {
        episodicCount: episodicHits.length,
        summaryCount: summaryHits.length,
        vectorCount: vectorHits.length,
        graphRevision: Number(graph?.revision || 0),
        graphRelatedEntities: graphExpansion.relatedEntities.length,
        graphActionableRelations: graphExpansion.actionableRelations.length
      }
    };
  }

  getCoreMemory(session) {
    const state = this.ensureState(session);
    return state.coreMemory || { personaView: '', activeCommitments: [], coreDirectives: [] };
  }

  updateCoreMemory(session, patch = {}) {
    const state = this.ensureState(session);
    const current = state.coreMemory || { personaView: '', activeCommitments: [], coreDirectives: [] };
    const next = {
      personaView: patch.personaView !== undefined ? String(patch.personaView).trim() : current.personaView,
      activeCommitments: Array.isArray(patch.activeCommitments)
        ? patch.activeCommitments.map((i) => String(i || '').trim()).filter(Boolean)
        : current.activeCommitments,
      coreDirectives: Array.isArray(patch.coreDirectives)
        ? patch.coreDirectives.map((i) => String(i || '').trim()).filter(Boolean)
        : current.coreDirectives
    };
    state.coreMemory = next;
    state.updatedAt = (typeof this.now === 'function' ? this.now() : new Date()).toISOString();
    return state.coreMemory;
  }

  rebuildRange({ session, messages = session?.messages || [] }) {
    const previousState = this.ensureState(session);
    const nextMemory = rebuildMemoryFromMessages({ memory: session.memory, messages });
    let nextState = supersedeInactiveEpisodes(
      previousState,
      messages.map((message) => message?.id),
      { validToTurn: messages.length, now: this.now }
    );

    for (let index = 0; index < messages.length - 1; index += 1) {
      const userMessage = messages[index];
      const assistantMessage = messages[index + 1];
      if (userMessage?.role !== 'user' || assistantMessage?.role !== 'assistant') continue;
      const episode = createTurnEpisode({
        session: { ...session, memory: nextMemory, messages: messages.slice(0, index + 2) },
        userMessage,
        assistantMessage,
        now: this.now
      });
      nextState = upsertEpisode(nextState, episode, { now: this.now });
      index += 1;
    }
    const previouslyConfirmedSummaryIds = new Set([
      ...previousState.summaries.scenes,
      ...previousState.summaries.chapters,
      ...previousState.summaries.arcs
    ].filter((item) => item.status === 'confirmed').map((item) => item.id));
    nextState = refreshSummaryValidity(nextState, {
      validToTurn: messages.length,
      now: this.now
    });
    const currentSummaries = new Map([
      ...nextState.summaries.scenes,
      ...nextState.summaries.chapters,
      ...nextState.summaries.arcs
    ].map((item) => [item.id, item]));
    const invalidatedSummary = [...previouslyConfirmedSummaryIds]
      .some((id) => currentSummaries.get(id)?.status !== 'confirmed');
    nextMemory.episodicMemory = nextState;
    nextMemory.sceneContinuity = this.buildContinuity(session, messages, nextMemory);
    if (invalidatedSummary) nextMemory.rollingSummary = composeRollingSummary(nextState);
    return nextMemory;
  }

  invalidateFromMessage({ session, messageId }) {
    const messages = Array.isArray(session?.messages) ? session.messages : [];
    const index = messages.findIndex((message) => message?.id === messageId);
    const retained = index < 0 ? messages : messages.slice(0, index);
    session.messages = retained;
    session.memory = this.rebuildRange({ session, messages: retained });
    this.vectorMemoryService?.dropIndex?.(session?.id || 'main');
    return session.memory;
  }

  async retrieveVectorHits({ session, query, excludeMessageIds }) {
    if (!this.vectorMemoryService) return { vectorHits: [], vectorEnabled: false };
    const vectorEnabled = await this.vectorMemoryService.isEnabled(session);
    if (!vectorEnabled) return { vectorHits: [], vectorEnabled: false };
    await this.vectorMemoryService.indexMessages({
      sessionId: session.id || 'main',
      messages: session.messages
    });
    if (!query) return { vectorHits: [], vectorEnabled: true };
    const topK = await this.vectorMemoryService.getTopK(session);
    const vectorHits = await this.vectorMemoryService.search({
      sessionId: session.id || 'main',
      query,
      topK,
      excludeMessageIds
    });
    return { vectorHits, vectorEnabled: true };
  }
}

function resolveActiveSceneAnchor(memory = {}) {
  const location = String(
    memory?.narrativeRepair?.canonicalFacts?.location
    || memory?.worldState?.location?.name
    || ''
  ).trim();
  return location.length >= 4 ? { location } : null;
}

function promoteHierarchy(memoryState, { now }) {
  let state = normalizeMemoryState(memoryState);
  let promotedChapters = 0;
  let promotedArcs = 0;

  while (true) {
    const usedSceneIds = new Set(state.summaries.chapters
      .filter((item) => item.status === 'confirmed')
      .flatMap((item) => item.childSummaryIds));
    const scenes = state.summaries.scenes
      .filter((item) => item.status === 'confirmed' && !usedSceneIds.has(item.id))
      .sort(compareMemoryCoverage)
      .slice(0, MEMORY_HIERARCHY_POLICY.scenesPerChapter);
    if (scenes.length < MEMORY_HIERARCHY_POLICY.scenesPerChapter) break;
    state = upsertSummary(state, buildParentSummary({
      level: MEMORY_SUMMARY_LEVELS.CHAPTER,
      children: scenes,
      sequence: state.summaries.chapters.length + 1,
      now
    }), { now });
    promotedChapters += 1;
  }

  while (true) {
    const usedChapterIds = new Set(state.summaries.arcs
      .filter((item) => item.status === 'confirmed')
      .flatMap((item) => item.childSummaryIds));
    const chapters = state.summaries.chapters
      .filter((item) => item.status === 'confirmed' && !usedChapterIds.has(item.id))
      .sort(compareMemoryCoverage)
      .slice(0, MEMORY_HIERARCHY_POLICY.chaptersPerArc);
    if (chapters.length < MEMORY_HIERARCHY_POLICY.chaptersPerArc) break;
    state = upsertSummary(state, buildParentSummary({
      level: MEMORY_SUMMARY_LEVELS.ARC,
      children: chapters,
      sequence: state.summaries.arcs.length + 1,
      now
    }), { now });
    promotedArcs += 1;
  }

  return { state, promotedChapters, promotedArcs };
}

function buildParentSummary({ level, children, sequence, now }) {
  const label = level === MEMORY_SUMMARY_LEVELS.CHAPTER ? '章节' : '故事弧';
  return createHierarchySummary({
    level,
    title: `第 ${sequence} 个${label}记忆`,
    summary: children.map((item) => `${item.title}：${item.summary}`).join('\n'),
    sourceMessageIds: children.flatMap((item) => item.sourceMessageIds),
    sourceEpisodeIds: children.flatMap((item) => item.sourceEpisodeIds),
    sourceEpisodeRefs: children.flatMap((item) => item.sourceEpisodeRefs),
    childSummaryIds: children.map((item) => item.id),
    childSummaryRefs: children.map((item) => `${item.id}@${item.revision}`),
    validFromTurn: Math.min(...children.map((item) => item.validFromTurn)),
    validToTurn: Math.max(...children.map((item) => item.validToTurn ?? item.validFromTurn)),
    visibility: children.some((item) => item.visibility === 'director') ? 'director' : 'player',
    importance: level === MEMORY_SUMMARY_LEVELS.ARC ? 0.95 : 0.85,
    now
  });
}

function compareMemoryCoverage(left, right) {
  return left.validFromTurn - right.validFromTurn
    || String(left.createdAt).localeCompare(String(right.createdAt));
}

function findSummaryById(state, id) {
  return [
    ...state.summaries.scenes,
    ...state.summaries.chapters,
    ...state.summaries.arcs
  ].find((item) => item.id === id) || null;
}
