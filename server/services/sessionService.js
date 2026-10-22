import crypto from 'node:crypto';
import { createDefaultMemory } from '../agent/memoryUpdater.js';
import { enrichNarrativeState } from '../config/narrativeProfiles.js';
import { createAuthoringLedger, normalizeAuthoringLedger } from '../authoring/authoringLedger.js';
import { DEFAULT_AGENT_PROFILE_ID, normalizeAgentProfileId } from '../authoring/agentProfiles.js';
import { materializeSessionOwnedConfig } from '../config/sessionScopedConfig.js';
import { normalizeResponseLengthMode } from '../agent/responseContract.js';
import { normalizeRoleplayMode } from '../agent/roleplayMode.js';
import { normalizeActivationStrategy } from '../agent/groupSpeakerSelector.js';
import { createDegradedKnowledgeGraphState } from '../knowledgeGraph/knowledgeGraphService.js';
import { GlobalMvuStore } from '../memory/globalMvuStore.js';
import { ensureEventLog, appendSessionEvents } from '../agent/sessionEventLog.js';

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export class SessionService {
  constructor(store, { knowledgeGraphService = null } = {}) {
    this.store = store;
    this.writeTails = new Map();
    this.knowledgeGraphService = knowledgeGraphService;
    this.globalMvuStore = new GlobalMvuStore(store);
  }

  async getSession(sessionId = 'main', { hydrateKnowledgeGraph = true } = {}) {
    const id = validateSessionId(sessionId);
    const session = await this.store.read(sessionPath(id), createSession(id));
    const enriched = enrichSessionNarrativeState(session);
    // 读同步：把跨会话 global 根合并进会话（落盘值优先，接收其他会话的更新）
    await this.globalMvuStore.mergeIntoSession(enriched);
    // 影子事件日志：迁移旧会话 + 挂载基线快照（messages 仍是唯一事实源）
    ensureEventLog(enriched);
    return hydrateKnowledgeGraph ? this.hydrateKnowledgeGraph(enriched) : enriched;
  }

  withWriteLock(id, work) {
    const run = (this.writeTails.get(id) || Promise.resolve()).then(work);
    const tail = run.catch(() => {});
    this.writeTails.set(id, tail);
    tail.finally(() => { if (this.writeTails.get(id) === tail) this.writeTails.delete(id); });
    return run;
  }

  async saveSession(session) {
    return this.withWriteLock(validateSessionId(session?.id), () => this.writeSession(session));
  }

  async saveSessionIfUnchanged(session, expectedRevision) {
    return this.withWriteLock(validateSessionId(session?.id), async () => {
      const stored = await this.store.read(sessionPath(session.id), null);
      if (!stored || (stored.storageRevision || '') !== expectedRevision) return null;
      await this.globalMvuStore.mergeIntoSession(session);
      return this.writeSession(session);
    });
  }

  async writeSession(session) {
    const id = validateSessionId(session?.id);
    session.storageRevision = crypto.randomUUID();
    // 事件日志随 spread 一起进入 next（基线即日志，不依赖对象身份）
    ensureEventLog(session);
    const next = await this.hydrateKnowledgeGraph({ ...session, id });
    Object.assign(session, next);
    // 影子事件日志：diff 基线生成事件追加（在会话锁保护区内调用）
    appendSessionEvents(next);
    // 同步回调用方持有的引用，保证同一会话对象多次 save 时增量事件持续积累
    session.eventLog = next.eventLog;
    await this.store.write(sessionPath(id), next);
    // 写传播：把会话内 global 根落盘（会话快照优先）；失败不阻塞会话保存
    try {
      await this.globalMvuStore.persistFromSession(next);
    } catch (error) {
      next.globalMvuError = String(error?.message || 'GLOBAL_MVU_PERSIST_FAILED');
    }
    return next;
  }

  async listSessions() {
    const files = await this.store.list('sessions');
    return files.filter((file) => file.endsWith('.json')).map((file) => file.replace(/\.json$/, ''));
  }

  async listSessionSummaries() {
    const sessionIds = await this.listSessions();
    const sessions = await Promise.all(sessionIds.map((sessionId) => this.getSession(sessionId)));
    return sessions
      .map(summarizeSession)
      .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));
  }

  async createSessionWithConfig({ id, title, config, memory, storyProjectId = '', basePackId = '' }) {
    const sessionId = id ? validateSessionId(id) : crypto.randomUUID();
    const session = createSession(sessionId);
    session.title = title || session.title;
    session.config = materializeSessionOwnedConfig(config);
    session.storyProjectId = cleanSessionReference(storyProjectId);
    session.basePackId = cleanSessionReference(basePackId);
    if (memory && typeof memory === 'object' && !Array.isArray(memory)) {
      session.memory = structuredClone(memory);
    }
    await this.saveSession(session);
    return session;
  }

  async hydrateKnowledgeGraph(session) {
    if (!this.knowledgeGraphService) return session;
    try {
      return this.knowledgeGraphService.synchronizeSession(session);
    } catch (error) {
      return createDegradedKnowledgeGraphState(session, error);
    }
  }

  async deleteSession(sessionId) {
    const id = validateSessionId(sessionId);
    if (id === 'main') throw new Error('CANNOT_DELETE_MAIN_SESSION');
    return this.withWriteLock(id, async () => {
      const session = await this.store.read(sessionPath(id), null);
      if (!session) return null;
      await this.store.remove(sessionPath(id));
      return { id, storyProjectId: cleanSessionReference(session.storyProjectId) || '' };
    });
  }
}

function sessionPath(sessionId) {
  return `sessions/${validateSessionId(sessionId)}.json`;
}

function validateSessionId(sessionId) {
  const id = String(sessionId ?? '');
  if (!SESSION_ID_PATTERN.test(id)) throw new Error('Invalid session id');
  return id;
}

function createSession(id) {
  return {
    id,
    title: '新的江湖',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: [],
    usageLedger: [],
    memory: createDefaultMemory(),
    authoring: createAuthoringLedger(),
    settings: {
      providerId: '',
      fastTaskProviderId: '',
      taskProviderOverrides: {},
      taskFallbackOverrides: {},
      recentPairs: 8,
      maxPromptTokens: 8000,
      maxInjectedCards: 5,
      narrativeMode: 'stable',
      roleplayMode: 'dm',
      responseLength: 'balanced',
      worldBookIncludeNames: true,
      worldBookCaseSensitive: false,
      worldBookMatchWholeWords: false,
      worldBookMinActivations: 0,
      worldBookMinActivationsDepthMax: 0,
      activeAgentProfileId: DEFAULT_AGENT_PROFILE_ID,
      theme: '',
      backgroundImage: '',
      visualContentPack: ''
    }
  };
}

function enrichSessionNarrativeState(session) {
  const next = structuredClone(session);
  next.usageLedger = Array.isArray(next.usageLedger) ? next.usageLedger : [];
  next.authoring = normalizeAuthoringLedger(next.authoring);
  next.settings = next.settings && typeof next.settings === 'object' ? next.settings : {};
  next.settings.activeAgentProfileId = normalizeAgentProfileId(next.settings.activeAgentProfileId);
  next.settings.roleplayMode = normalizeRoleplayMode(next.settings.roleplayMode);
  next.settings.responseLength = normalizeResponseLengthMode(next.settings.responseLength);
  // 群聊发言者策略（p2-03b）：非法值回落 talkativeness（与选择器内核默认一致）
  next.settings.groupSpeakerStrategy = normalizeActivationStrategy(next.settings.groupSpeakerStrategy);
  const memory = next.memory && typeof next.memory === 'object' ? next.memory : createDefaultMemory();
  const packId = String(
    memory.narrativeState?.lockedGenre
    || memory.ruleSystem?.contentPackId
    || memory.worldState?.flags?.genre
    || ''
  ).trim();
  const narrativeState = enrichNarrativeState(packId, memory.narrativeState);
  next.memory = narrativeState ? { ...memory, narrativeState } : memory;
  return next;
}

function summarizeSession(session) {
  const messages = Array.isArray(session.messages) ? session.messages : [];
  const lastMessage = messages.at(-1);
  const memory = session.memory && typeof session.memory === 'object' ? session.memory : {};
  const packId = String(
    session.basePackId
    || memory.resourcePackId
    || memory.ruleSystem?.contentPackId
    || memory.worldState?.flags?.genre
    || ''
  ).trim();
  return {
    id: session.id,
    title: session.title || session.id,
    storyProjectId: cleanSessionReference(session.storyProjectId),
    basePackId: cleanSessionReference(session.basePackId) || packId,
    packId,
    messageCount: messages.length,
    lastMessagePreview: String(lastMessage?.content || '').replace(/\s+/g, ' ').trim().slice(0, 120),
    createdAt: session.createdAt || '',
    updatedAt: session.updatedAt || session.createdAt || ''
  };
}

function cleanSessionReference(value) {
  const id = String(value || '').trim();
  return SESSION_ID_PATTERN.test(id) ? id : '';
}
