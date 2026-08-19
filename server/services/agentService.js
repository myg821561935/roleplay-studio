import { assemblePrompt } from '../agent/promptAssembler.js';
import { selectGroupSpeaker } from '../agent/groupSpeakerSelector.js';
import { buildSummaryPrompt, parseSummaryResult, shouldSummarize } from '../agent/summaryScheduler.js';
import { applyFactExtractionResult, buildFactExtractionPrompt, normalizeDynamicWorldBookEntries } from '../agent/factExtractor.js';
import { worldBookIdentity } from '../agent/factCards.js';
import { estimateTokens } from '../agent/token.js';
import { VectorMemoryService } from '../agent/vectorMemory.js';
import { resolveNarrativeContext } from '../agent/narrativeControl.js';
import { parseRoleplayResponse } from '../agent/roleplayResponse.js';
import {
  findLatestMeaningfulUserMessage,
  isContinuationSignal
} from '../agent/interactionContract.js';
import {
  buildTurnFrameStateEnvelope,
  extractNarrativeTurnFrame,
  materializeTurnFramePanels,
  resolveNarrativeTurnFrame,
  turnFrameAllowsFactAdmission
} from '../agent/turnFrame.js';
import { planRecommendedActions } from '../agent/decisionPlanner.js';
import { extractActionEnvelope } from '../simulation/actionProtocol.js';
import {
  applyMvuPatchEnvelope,
  extractMvuPatchEnvelope,
  normalizeMvuSnapshot,
  MVU_PATCH_SPEC
} from '../compat/mvuProtocol.js';
import { executeDeclarativeLifecycle } from '../compat/declarativeLifecycle.js';
import { applyPromptTransforms } from '../compat/lightFrontendRuntime.js';
import { parseMacroVariableWrites } from '../compat/lifecyclePolicy.js';
import {
  buildEditableSessionConfig,
  hasCompleteSessionConfig
} from '../config/sessionScopedConfig.js';
import { WorldSimulationService } from './worldSimulationService.js';
import { MemoryService } from '../memory/memoryService.js';
import {
  filterNarrativeContextMessages,
  validateNarrativeHardFacts
} from '../memory/narrativeRepair.js';
import {
  forkTimeline,
  switchTimelineBranch,
  renameTimelineBranch,
  deleteTimelineBranch,
  compareTimelineBranches,
  listTimelineBranches
} from '../agent/timelineStore.js';
import { ensureEventLog } from '../agent/sessionEventLog.js';

const MAX_CONSECUTIVE_SUMMARY_FAILURES = 3;
const INTERACTIVE_PROVIDER_TASKS = new Set(['chat', 'rewrite']);
// 中止留存的可见正文下限：低于该长度视为尚未开始有效生成，静默丢弃
const MIN_ABORTED_PARTIAL_CHARS = 12;

export class AgentService {
  constructor({ configService, sessionService, providerClient, vectorMemoryService, memoryService, worldSimulationService, mcpRegistry }) {
    this.configService = configService;
    this.sessionService = sessionService;
    this.providerClient = providerClient;
    this.vectorMemoryService = vectorMemoryService || new VectorMemoryService({ configService, fetchImpl: fetch });
    this.memoryService = memoryService || new MemoryService({ vectorMemoryService: this.vectorMemoryService });
    this.worldSimulationService = worldSimulationService || new WorldSimulationService({ sessionService });
    this.mcpRegistry = mcpRegistry || null;
    this.sessionLocks = new Map();
  }

  /**
   * 会话级互斥锁：同一会话的读-改-写操作串行执行，
   * 避免并发生成/编辑时互相覆盖整份会话数据。
   */
  withSessionLock(sessionId, fn) {
    const key = String(sessionId || 'main');
    const previous = this.sessionLocks.get(key) || Promise.resolve();
    const run = previous.then(() => fn());
    const tail = run.then(() => undefined, () => undefined);
    this.sessionLocks.set(key, tail);
    tail.then(() => {
      if (this.sessionLocks.get(key) === tail) this.sessionLocks.delete(key);
    });
    return run;
  }

  /**
   * 在 assemblePrompt 前调用：增量索引 session.messages + 用 userMessage 做向量检索
   * 兼容旧调用名；实际由统一 MemoryService 返回情节、向量与图谱检索上下文。
   */
  async maybeRetrieveVectorMemory({ session, userMessage, excludeMessageIds = [] }) {
    const memoryContext = await this.memoryService.retrieveContext({
      session,
      userMessage,
      excludeMessageIds
    });
    return {
      vectorHits: memoryContext.vectorHits,
      vectorEnabled: memoryContext.vectorEnabled,
      memoryContext
    };
  }

  async resolveSessionConfig(session, globalConfigOverride) {
    const globalConfig = globalConfigOverride || await this.configService.getAll();
    const activeConfig = buildEditableSessionConfig(globalConfig, session);
    if (!hasCompleteSessionConfig(session.config)) {
      session.config = activeConfig;
      await this.sessionService.saveSession(session);
    }
    return activeConfig;
  }

  async prepareChatContext({ sessionId, taskKey = 'chat' }) {
    const [globalConfig, session] = await Promise.all([
      this.configService.getAll(),
      this.sessionService.getSession(sessionId)
    ]);
    const activeConfig = await this.resolveSessionConfig(session, globalConfig);
    this.worldSimulationService.prepareSession(session, {
      characterCard: activeConfig.characterCard,
      characterPresets: activeConfig.characterPresets,
      groupMembers: activeConfig.groupMembers,
      worldSystems: activeConfig.worldSystems
    });
    const provider = getActiveProvider(globalConfig, session);
    const fallbackChain = getProviderChain(globalConfig, session, provider, taskKey).slice(1);
    return { globalConfig, session, activeConfig, provider, fallbackChain };
  }

  async sendMessage({ sessionId = 'main', content, targetSpeaker }) {
    const { globalConfig, session, activeConfig, provider, fallbackChain } = await this.prepareChatContext({ sessionId, taskKey: 'chat' });
    const continuation = isContinuationSignal(content);

    const userMessage = createMessage('user', content, {
      kind: continuation ? 'continuation' : isJourneySetupContent(content) ? 'journey-setup' : 'chat'
    });
    const userLifecycle = applySessionLifecycle(session, activeConfig.lightFrontend, 'onUser');
    const { vectorHits, memoryContext } = await this.maybeRetrieveVectorMemory({
      session,
      userMessage: continuation
        ? buildContinuationRetrievalQuery(session.messages, userMessage.content)
        : userMessage.content
    });
    const { assistantMessage, assembled, actionEnvelope, actionError } = await this.generateAssistantMessage({
      config: activeConfig,
      session,
      provider,
      userMessage,
      groupMembers: activeConfig.groupMembers,
      targetSpeaker,
      templates: globalConfig.macroTemplates,
      customArrays: globalConfig.customArrays,
      fallbackChain,
      vectorHits,
      memoryContext,
      generationType: continuation ? 'continue' : 'normal',
      lifecyclePatches: userLifecycle.envelopes,
      lifecycleReports: [userLifecycle.report]
    });

    session.messages.push(userMessage, assistantMessage);
    if (assistantMessage.contextExcluded !== true) {
      this.worldSimulationService.applyTurn({
        session,
        userMessage,
        assistantMessage,
        actionEnvelope,
        actionError
      });
      this.memoryService.observeTurn({ session, userMessage, assistantMessage });
    }

    await this.runMemoryMaintenanceIfNeeded({ session, provider, assembled, globalConfig });

    session.updatedAt = new Date().toISOString();
    await this.sessionService.saveSession(session);
    return {
      session,
      reply: assistantMessage,
      debug: assembled
    };
  }

  async sendMessageStream({ sessionId = 'main', content, targetSpeaker, hideUserMessage = false, onToken, onPhase, signal = null }) {
    const { globalConfig, session, activeConfig, provider, fallbackChain } = await this.prepareChatContext({ sessionId, taskKey: 'chat' });
    const continuation = isContinuationSignal(content);
    const userMessage = createMessage('user', content, {
      kind: continuation ? 'continuation' : isJourneySetupContent(content) ? 'journey-setup' : 'chat',
      hiddenFromChat: hideUserMessage
    });
    const userLifecycle = applySessionLifecycle(session, activeConfig.lightFrontend, 'onUser');
    const { vectorHits, memoryContext } = await this.maybeRetrieveVectorMemory({
      session,
      userMessage: continuation
        ? buildContinuationRetrievalQuery(session.messages, userMessage.content)
        : userMessage.content
    });
    const memoryBeforeGeneration = structuredClone(session.memory || {});
    this.worldSimulationService.prepareInteraction({ session, userMessage, generationType: continuation ? 'continue' : 'normal' });
    // 群聊发言者决策（p2-03b）：未指定时按策略选择（加权随机/顺序轮转），
    // 使「# 当前发言角色」指令与期望发言者一致，不再依赖模型自由发挥
    const speakerSelection = selectGroupSpeaker({
      groupMembers: activeConfig.groupMembers,
      characterCard: activeConfig.characterCard,
      messages: session.messages,
      targetSpeaker,
      activationStrategy: activeConfig.settings?.groupSpeakerStrategy || session.settings?.groupSpeakerStrategy
    });
    const resolvedStreamSpeaker = speakerSelection.speaker;
    const assembled = assemblePrompt({
      promptModules: activeConfig.promptModules,
      characterCard: activeConfig.characterCard,
      worldBook: activeConfig.worldBook,
      memory: session.memory,
      authoring: session.authoring,
      messages: session.messages,
      userMessage: continuation ? '' : userMessage.content,
      persona: activeConfig.persona,
      groupMembers: activeConfig.groupMembers,
      targetSpeaker: resolvedStreamSpeaker,
      templates: globalConfig.macroTemplates,
      customArrays: globalConfig.customArrays,
      vectorHits,
      memoryContext,
      lightFrontend: activeConfig.lightFrontend,
      activationContext: { seed: session.id || sessionId, generationType: continuation ? 'continue' : 'normal' },
      options: session.settings
    });

    const streamFilter = createHiddenBlockStreamFilter(onToken);
    let assistantResult;
    try {
      assistantResult = await this.completeAssistantContentStream({
        provider,
        messages: assembled.messages,
        onToken: streamFilter.push,
        fallbackChain,
        taskKey: 'chat',
        signal
      });
    } catch (error) {
      // 用户主动中止：已生成的可见正文留存为 aborted 消息（SillyTavern 停止语义），
      // 不执行 MVU / 世界模拟 / 记忆维护，跳过一致性判定（半截内容无法可靠解析协议块）
      if (isAbortError(error) || signal?.aborted) {
        const partialContent = streamFilter.getVisibleText().trim();
        if (partialContent.length < MIN_ABORTED_PARTIAL_CHARS) throw error;
        const abortedMessage = createMessage('assistant', partialContent, {
          aborted: true,
          abortedAt: new Date().toISOString(),
          abortReason: 'user-stopped',
          worldBookActivation: assembled.sections.worldBookActivation,
          usage: buildUsageSnapshot({ provider, assembled, content: partialContent, providerResult: null })
        });
        session.messages.push(userMessage, abortedMessage);
        session.updatedAt = new Date().toISOString();
        await this.sessionService.saveSession(session);
        const abortError = new Error('GENERATION_ABORTED');
        abortError.code = 'GENERATION_ABORTED';
        abortError.partialMessage = abortedMessage;
        throw abortError;
      }
      throw error;
    }
    await streamFilter.end();
    await emitStreamPhase(onPhase, 'finalizing');
    const parsedOutput = parseAssistantOutput(assistantResult.content);
    const consistency = validateNarrativeHardFacts(parsedOutput?.reply?.content, session.memory);
    if (!consistency.valid) session.memory = memoryBeforeGeneration;
    const mvuUpdate = consistency.valid
      ? applyAssistantMvuUpdate(session, parsedOutput)
      : { patches: [], error: { code: 'NARRATIVE_CONSISTENCY_REJECTED', detail: consistencyConflictDetail(consistency) } };
    const assistantLifecycle = consistency.valid
      ? applySessionLifecycle(session, activeConfig.lightFrontend, 'onAssistant')
      : skippedLifecycle('onAssistant', 'narrative-consistency-rejected');
    const speaker = parsedOutput.speaker;
    const parsedReply = parsedOutput.reply;
    const turnFrame = resolveNarrativeTurnFrame(parsedOutput.turnFrame, {
      consistencyValid: consistency.valid,
      content: parsedReply.content,
      memory: session.memory
    });
    const fallbackStateEnvelope = buildTurnFrameStateEnvelope(turnFrame, session.memory, parsedOutput.actionEnvelope, {
      content: parsedReply.content
    });
    const effectiveActionEnvelope = mergeActionEnvelopes(parsedOutput.actionEnvelope, fallbackStateEnvelope);
    const roleplayPanels = applyConsistencyNotice(
      mergeRoleplayPanels({}, {
        ...materializeTurnFramePanels(turnFrame),
        ...parsedOutput.roleplayPanels
      }, assembled),
      consistency
    );
    const decisionMemory = consistency.valid
      ? this.worldSimulationService.projectDecisionMemory({
        session,
        assistantMessage: {
          id: 'decision-preview',
          role: 'assistant',
          content: parsedReply.content,
          roleplayPanels,
          speaker,
          turnFrame
        },
        actionEnvelope: effectiveActionEnvelope
      })
      : session.memory;
    const recommendationPlan = consistency.valid
      ? resolveRecommendationPlan(parsedReply.recommendedActions, decisionMemory, {
        userMessage,
        assistantContent: parsedReply.content,
        recentMessages: session.messages,
        generationType: continuation ? 'continue' : 'normal',
        roleplayMode: activeConfig?.settings?.roleplayMode || session.settings?.roleplayMode,
        characterCard: activeConfig?.characterCard,
        groupMembers: activeConfig?.groupMembers,
        turnFrame,
        recommendationSource: parsedReply.recommendedActionPresentation?.source
      })
      : emptyRecommendationPlan();
    const usage = buildUsageSnapshot({ provider, assembled, content: parsedReply.content, providerResult: assistantResult });
    const assistantMessage = createMessage('assistant', parsedReply.content, {
      recommendedActions: recommendationPlan.actions,
      recommendedActionOptions: recommendationPlan.actionOptions,
      recommendedActionPresentation: parsedReply.recommendedActionPresentation || recommendationPlan.presentation,
      decisionNode: recommendationPlan.decision,
      turnFrame,
      turnFrameError: parsedOutput.turnFrameError,
      narrativeConsistency: consistency,
      contextExcluded: !consistency.valid,
      contextExclusionReason: !consistency.valid ? 'narrative-hard-fact-conflict' : '',
      usage,
      actionEnvelope: effectiveActionEnvelope,
      actionError: parsedOutput.actionError,
      mvuPatches: [...userLifecycle.envelopes, ...mvuUpdate.patches, ...assistantLifecycle.envelopes],
      mvuError: mvuUpdate.error,
      lifecycleReports: [userLifecycle.report, assistantLifecycle.report],
      roleplayPanels,
      worldBookActivation: assembled.sections.worldBookActivation,
      speaker
    });
    recordPromptRuntime(session, assembled);
    appendUsageLedgerEntry(session, {
      taskKey: 'chat',
      messageId: assistantMessage.id,
      usage,
      routing: assistantResult.routing
    });

    session.messages.push(userMessage, assistantMessage);
    if (assistantMessage.contextExcluded !== true) {
      this.worldSimulationService.applyTurn({
        session,
        userMessage,
        assistantMessage,
        actionEnvelope: effectiveActionEnvelope,
        actionError: parsedOutput.actionError
      });
      this.memoryService.observeTurn({ session, userMessage, assistantMessage });
    }
    await this.runMemoryMaintenanceIfNeeded({ session, provider, assembled, globalConfig });

    session.updatedAt = new Date().toISOString();
    await this.sessionService.saveSession(session);
    return { session, reply: assistantMessage, debug: assembled };
  }

  async completeAssistantContentStream({ provider, messages, onToken, fallbackChain = [], taskKey = 'chat', signal = null }) {
    if (typeof this.providerClient.stream === 'function') {
      const result = await this.streamWithFallback({
        primaryProvider: provider,
        fallbackChain,
        messages,
        onToken,
        taskKey,
        signal
      });
      return result;
    }

    const result = await this.completeWithFallback({
      primaryProvider: provider,
      fallbackChain,
      messages,
      taskKey
    });
    const actionParsed = extractActionEnvelope(result.content);
    const parsed = extractRecommendedActions(actionParsed.content);
    for (const token of chunkText(parsed.content)) {
      await onToken?.(token);
    }
    return result;
  }

  async editMessage({ sessionId = 'main', messageId, content }) {
    const { globalConfig, session, activeConfig, provider, fallbackChain } = await this.prepareChatContext({ sessionId, taskKey: 'chat' });
    const index = findMessageIndex(session, messageId);
    const message = session.messages[index];

    if (message.role === 'assistant') {
      message.swipes = normalizeSwipes(message.swipes, message.content);
      const newContent = String(content || '');
      if (!message.swipes.includes(newContent)) message.swipes.push(newContent);
      message.content = newContent;
      message.activeSwipeIndex = Math.max(0, message.swipes.indexOf(message.content));
      message.swipeMetadata = normalizeSwipeMetadata(message, message.swipes);
      message.swipeMetadata[message.activeSwipeIndex] = emptySwipeMetadata();
      clearMessageWorldUpdate(message);
      message.updatedAt = new Date().toISOString();
      session.messages = session.messages.slice(0, index + 1);
      this.invalidateVectorIndex(session);
      session.memory = this.memoryService.rebuildRange({ session, messages: session.messages });
      session.updatedAt = new Date().toISOString();
      await this.sessionService.saveSession(session);
      return { session, reply: message };
    }

    if (message.role !== 'user') throw new Error('UNSUPPORTED_MESSAGE_ROLE');

    message.swipes = normalizeSwipes(message.swipes, message.content);
    const newContent = String(content || '');
    if (!message.swipes.includes(newContent)) message.swipes.push(newContent);
    message.content = newContent;
    message.activeSwipeIndex = Math.max(0, message.swipes.indexOf(message.content));
    message.updatedAt = new Date().toISOString();
    session.messages = session.messages.slice(0, index + 1);
    this.invalidateVectorIndex(session);
    session.memory = this.memoryService.rebuildRange({ session, messages: session.messages });

    const { vectorHits, memoryContext } = await this.maybeRetrieveVectorMemory({
      session,
      userMessage: message.content
    });
    const { assistantMessage, assembled, actionEnvelope, actionError } = await this.generateAssistantMessage({
      config: activeConfig,
      session,
      provider,
      userMessage: message,
      groupMembers: activeConfig.groupMembers,
      templates: globalConfig.macroTemplates,
      customArrays: globalConfig.customArrays,
      fallbackChain,
      vectorHits,
      memoryContext,
      promptMessages: session.messages.slice(0, -1)
    });

    session.messages.push(assistantMessage);
    this.worldSimulationService.applyTurn({
      session,
      userMessage: message,
      assistantMessage,
      actionEnvelope,
      actionError
    });
    this.memoryService.observeTurn({ session, userMessage: message, assistantMessage });
    await this.runMemoryMaintenanceIfNeeded({ session, provider, assembled, globalConfig });

    session.updatedAt = new Date().toISOString();
    await this.sessionService.saveSession(session);
    return { session, reply: assistantMessage, debug: assembled };
  }

  async switchMessageSwipe({ sessionId = 'main', messageId, swipeIndex }) {
    const session = await this.sessionService.getSession(sessionId);
    const index = findMessageIndex(session, messageId);
    const message = session.messages[index];
    const swipes = normalizeSwipes(message.swipes, message.content);
    if (!swipes.length) throw new Error('NO_SWIPES_AVAILABLE');
    const targetIndex = Number(swipeIndex);
    if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= swipes.length) {
      throw new Error('INVALID_SWIPE_INDEX');
    }
    message.swipes = swipes;
    message.swipeMetadata = normalizeSwipeMetadata(message, swipes);
    message.activeSwipeIndex = targetIndex;
    message.content = swipes[targetIndex];
    applySwipeMetadata(message, message.swipeMetadata[targetIndex]);
    message.updatedAt = new Date().toISOString();
    session.memory = this.memoryService.rebuildRange({ session, messages: session.messages });
    session.updatedAt = new Date().toISOString();
    this.invalidateVectorIndex(session);
    await this.sessionService.saveSession(session);
    return { session };
  }

  async regenerateAssistantMessage({ sessionId = 'main', messageId }) {
    const { globalConfig, session, activeConfig, provider, fallbackChain } = await this.prepareChatContext({ sessionId, taskKey: 'chat' });
    const index = findMessageIndex(session, messageId);
    const assistantMessage = session.messages[index];
    if (assistantMessage.role !== 'assistant') throw new Error('MESSAGE_NOT_ASSISTANT');

    const userMessage = session.messages[index - 1];
    if (!userMessage || userMessage.role !== 'user') throw new Error('MISSING_USER_MESSAGE');

    session.messages = session.messages.slice(0, index);
    session.memory = this.memoryService.rebuildRange({ session, messages: session.messages });
    this.invalidateVectorIndex(session);
    const { vectorHits, memoryContext } = await this.maybeRetrieveVectorMemory({
      session,
      userMessage: userMessage.content
    });
    const result = await this.generateAssistantMessage({
      config: activeConfig,
      session,
      provider,
      userMessage,
      groupMembers: activeConfig.groupMembers,
      templates: globalConfig.macroTemplates,
      customArrays: globalConfig.customArrays,
      fallbackChain,
      vectorHits,
      memoryContext,
      promptMessages: session.messages.slice(0, -1),
      targetSpeaker: assistantMessage.speaker,
      generationType: Array.isArray(activeConfig.groupMembers)
        && activeConfig.groupMembers.some((member) => member && member.enabled !== false)
        ? 'normal'
        : 'regenerate'
    });
    const nextSwipe = result.assistantMessage.content;
    const swipes = normalizeSwipes(assistantMessage.swipes, assistantMessage.content);
    const swipeMetadata = normalizeSwipeMetadata(assistantMessage, swipes);
    swipes.push(nextSwipe);
    swipeMetadata.push(metadataFromMessage(result.assistantMessage));

    assistantMessage.content = nextSwipe;
    assistantMessage.swipes = swipes;
    assistantMessage.swipeMetadata = swipeMetadata;
    assistantMessage.activeSwipeIndex = swipes.length - 1;
    assistantMessage.usage = result.assistantMessage.usage;
    linkUsageLedgerEntry(session, assistantMessage.usage?.callId, assistantMessage.id);
    assistantMessage.updatedAt = new Date().toISOString();
    applySwipeMetadata(assistantMessage, swipeMetadata.at(-1));
    session.messages.push(assistantMessage);
    this.worldSimulationService.applyTurn({
      session,
      userMessage,
      assistantMessage,
      actionEnvelope: result.actionEnvelope,
      actionError: result.actionError
    });
    this.memoryService.observeTurn({ session, userMessage, assistantMessage });
    await this.runMemoryMaintenanceIfNeeded({ session, provider, assembled: result.assembled, globalConfig });

    session.updatedAt = new Date().toISOString();
    await this.sessionService.saveSession(session);
    return { session, reply: assistantMessage, debug: result.assembled };
  }

  async generateAssistantMessage({
    config,
    session,
    provider,
    userMessage,
    groupMembers,
    targetSpeaker,
    templates,
    customArrays,
    fallbackChain = [],
    vectorHits = [],
    memoryContext = null,
    promptMessages = session.messages,
    generationType = 'normal',
    lifecyclePatches = [],
    lifecycleReports = []
  }) {
    const memoryBeforeGeneration = structuredClone(session.memory || {});
    this.worldSimulationService.prepareInteraction({ session, userMessage, generationType });
    const resolvedSpeaker = selectGroupSpeaker({
      groupMembers,
      characterCard: config.characterCard,
      messages: session.messages,
      targetSpeaker,
      activationStrategy: config.settings?.groupSpeakerStrategy || session.settings?.groupSpeakerStrategy
    }).speaker;
    const assembled = assemblePrompt({
      promptModules: config.promptModules,
      characterCard: config.characterCard,
      worldBook: config.worldBook,
      memory: session.memory,
      authoring: session.authoring,
      messages: promptMessages,
      userMessage: generationType === 'continue' ? '' : userMessage.content,
      persona: config.persona,
      groupMembers,
      targetSpeaker: resolvedSpeaker,
      templates,
      customArrays,
      vectorHits,
      memoryContext,
      lightFrontend: config.lightFrontend,
      activationContext: { seed: session.id || '', generationType },
      options: session.settings
    });

    const assistantResult = await this.completeWithToolLoop({
      provider,
      fallbackChain,
      messages: assembled.messages
    });
    const parsedOutput = parseAssistantOutput(assistantResult.content);
    const consistency = validateNarrativeHardFacts(parsedOutput?.reply?.content, session.memory);
    if (!consistency.valid) session.memory = memoryBeforeGeneration;
    const mvuUpdate = consistency.valid
      ? applyAssistantMvuUpdate(session, parsedOutput)
      : { patches: [], error: { code: 'NARRATIVE_CONSISTENCY_REJECTED', detail: consistencyConflictDetail(consistency) } };
    const assistantLifecycle = consistency.valid
      ? applySessionLifecycle(session, config.lightFrontend, 'onAssistant')
      : skippedLifecycle('onAssistant', 'narrative-consistency-rejected');
    const speaker = parsedOutput.speaker;
    const parsedReply = parsedOutput.reply;
    const turnFrame = resolveNarrativeTurnFrame(parsedOutput.turnFrame, {
      consistencyValid: consistency.valid,
      content: parsedReply.content,
      memory: session.memory
    });
    const fallbackStateEnvelope = buildTurnFrameStateEnvelope(turnFrame, session.memory, parsedOutput.actionEnvelope, {
      content: parsedReply.content
    });
    const effectiveActionEnvelope = mergeActionEnvelopes(parsedOutput.actionEnvelope, fallbackStateEnvelope);
    const roleplayPanels = applyConsistencyNotice(
      mergeRoleplayPanels({}, {
        ...materializeTurnFramePanels(turnFrame),
        ...parsedOutput.roleplayPanels
      }, assembled),
      consistency
    );
    const decisionMemory = consistency.valid
      ? this.worldSimulationService.projectDecisionMemory({
        session,
        assistantMessage: {
          id: 'decision-preview',
          role: 'assistant',
          content: parsedReply.content,
          roleplayPanels,
          speaker,
          turnFrame
        },
        actionEnvelope: effectiveActionEnvelope
      })
      : session.memory;
    const recommendationPlan = consistency.valid
      ? resolveRecommendationPlan(parsedReply.recommendedActions, decisionMemory, {
        userMessage,
        assistantContent: parsedReply.content,
        recentMessages: session.messages,
        generationType,
        roleplayMode: config?.settings?.roleplayMode || session.settings?.roleplayMode,
        characterCard: config?.characterCard,
        groupMembers,
        turnFrame,
        recommendationSource: parsedReply.recommendedActionPresentation?.source
      })
      : emptyRecommendationPlan();
    const usage = buildUsageSnapshot({ provider, assembled, content: parsedReply.content, providerResult: assistantResult });
    const assistantMessage = createMessage('assistant', parsedReply.content, {
      recommendedActions: recommendationPlan.actions,
      recommendedActionOptions: recommendationPlan.actionOptions,
      recommendedActionPresentation: parsedReply.recommendedActionPresentation || recommendationPlan.presentation,
      decisionNode: recommendationPlan.decision,
      turnFrame,
      turnFrameError: parsedOutput.turnFrameError,
      narrativeConsistency: consistency,
      contextExcluded: !consistency.valid,
      contextExclusionReason: !consistency.valid ? 'narrative-hard-fact-conflict' : '',
      usage,
      actionEnvelope: effectiveActionEnvelope,
      actionError: parsedOutput.actionError,
      mvuPatches: [...lifecyclePatches, ...mvuUpdate.patches, ...assistantLifecycle.envelopes],
      mvuError: mvuUpdate.error,
      lifecycleReports: [...lifecycleReports, assistantLifecycle.report],
      roleplayPanels,
      worldBookActivation: assembled.sections.worldBookActivation,
      speaker
    });
    recordPromptRuntime(session, assembled);
    appendUsageLedgerEntry(session, {
      taskKey: 'chat',
      messageId: assistantMessage.id,
      usage,
      routing: assistantResult.routing
    });

    return {
      assistantMessage,
      assembled,
      actionEnvelope: effectiveActionEnvelope,
      actionError: parsedOutput.actionError
    };
  }

  async rewriteText({ sessionId = 'main', target = 'chat-input', text, instruction = '' }) {
    const sourceText = String(text || '').trim();
    if (!sourceText) throw new Error('EMPTY_REWRITE_TEXT');

    const [config, session] = await Promise.all([
      this.configService.getAll(),
      this.sessionService.getSession(sessionId)
    ]);
    const activeConfig = await this.resolveSessionConfig(session);
    const provider = getProviderForTask(config, session, 'rewrite');
    const fallbackChain = getProviderChain(config, session, provider, 'rewrite').slice(1);
    const messages = buildRewriteMessages({
      target,
      text: sourceText,
      instruction,
      context: normalizeRewriteTarget(target) === 'recommended-action'
        ? buildRecommendedActionContext({ session, characterCard: activeConfig.characterCard })
        : ''
    });
    const result = await this.completeWithFallback({
      primaryProvider: provider,
      fallbackChain,
      messages,
      taskKey: 'rewrite'
    });
    const usage = buildUsageSnapshot({ provider, messages, content: result.content, providerResult: result });
    appendUsageLedgerEntry(session, {
      taskKey: 'rewrite',
      usage,
      routing: result.routing
    });
    session.updatedAt = new Date().toISOString();
    await this.sessionService.saveSession(session);

    return {
      target: normalizeRewriteTarget(target),
      text: cleanRewriteText(result.content),
      providerId: usage.providerId,
      model: usage.model,
      routing: result.routing,
      usage
    };
  }

  async toggleMessageVisibility({ sessionId = 'main', messageId }) {
    const session = await this.sessionService.getSession(sessionId);
    const index = findMessageIndex(session, messageId);
    const message = session.messages[index];
    message.excluded = !message.excluded;
    message.updatedAt = new Date().toISOString();
    session.memory = this.memoryService.rebuildRange({ session, messages: session.messages });
    session.updatedAt = new Date().toISOString();
    this.invalidateVectorIndex(session);
    await this.sessionService.saveSession(session);
    return { session };
  }

  async toggleMessageBookmark({ sessionId = 'main', messageId, label }) {
    const session = await this.sessionService.getSession(sessionId);
    const index = findMessageIndex(session, messageId);
    const message = session.messages[index];
    if (message.bookmarked) {
      message.bookmarked = false;
      message.bookmarkLabel = '';
    } else {
      message.bookmarked = true;
      message.bookmarkLabel = String(label || '').trim().slice(0, 40) || `书签 ${session.messages.filter((m) => m.bookmarked).length + 1}`;
    }
    message.updatedAt = new Date().toISOString();
    session.updatedAt = new Date().toISOString();
    await this.sessionService.saveSession(session);
    return { session };
  }

  // —— 时间线分支（p2-02）：编排锁内的「读分支内核 → 记忆/索引重建 → 落盘」 ——

  async forkTimelineAtMessage({ sessionId = 'main', messageId, label = '', switchTo = false }) {
    const session = await this.sessionService.getSession(sessionId);
    const { branchId } = forkTimeline(session, { messageId, label, switchTo });
    if (switchTo) {
      // 换轨即重建：记忆按分支消息重算，向量索引失效
      session.memory = this.memoryService.rebuildRange({ session, messages: session.messages });
      this.invalidateVectorIndex(session);
    }
    session.updatedAt = new Date().toISOString();
    await this.sessionService.saveSession(session);
    const branch = listTimelineBranches(session).find((b) => b.id === branchId);
    return { session, branchId, branch };
  }

  async switchTimeline({ sessionId = 'main', branchId }) {
    const session = await this.sessionService.getSession(sessionId);
    const { switched } = switchTimelineBranch(session, branchId);
    if (switched) {
      session.memory = this.memoryService.rebuildRange({ session, messages: session.messages });
      this.invalidateVectorIndex(session);
    }
    session.updatedAt = new Date().toISOString();
    await this.sessionService.saveSession(session);
    return { session, switched };
  }

  async renameTimelineBranchLabel({ sessionId = 'main', branchId, label }) {
    const session = await this.sessionService.getSession(sessionId);
    renameTimelineBranch(session, branchId, label);
    session.updatedAt = new Date().toISOString();
    await this.sessionService.saveSession(session);
    return { session };
  }

  async removeTimelineBranch({ sessionId = 'main', branchId }) {
    const session = await this.sessionService.getSession(sessionId);
    deleteTimelineBranch(session, branchId);
    session.updatedAt = new Date().toISOString();
    await this.sessionService.saveSession(session);
    return { session };
  }

  async getTimeline({ sessionId = 'main' }) {
    const session = await this.sessionService.getSession(sessionId);
    ensureEventLog(session);
    return { branches: listTimelineBranches(session), activeBranchId: session.timeline.activeBranchId };
  }

  async compareTimeline({ sessionId = 'main', leftBranchId, rightBranchId }) {
    const session = await this.sessionService.getSession(sessionId);
    return compareTimelineBranches(session, leftBranchId, rightBranchId);
  }

  async continueMessage({ sessionId = 'main', onToken, signal = null }) {
    const { globalConfig, session, activeConfig, provider, fallbackChain } = await this.prepareChatContext({ sessionId, taskKey: 'chat' });

    const messages = Array.isArray(session.messages) ? session.messages : [];
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage.role !== 'assistant') throw new Error('LAST_MESSAGE_NOT_ASSISTANT');

    const continuationContent = String(lastMessage.content || '').trim();
    if (!continuationContent) throw new Error('EMPTY_ASSISTANT_CONTENT');

    const { vectorHits, memoryContext } = await this.maybeRetrieveVectorMemory({
      session,
      userMessage: buildContinuationRetrievalQuery(messages, continuationContent),
      excludeMessageIds: [lastMessage.id]
    });
    const assembled = assemblePrompt({
      promptModules: activeConfig.promptModules,
      characterCard: activeConfig.characterCard,
      worldBook: activeConfig.worldBook,
      memory: session.memory,
      messages: session.messages,
      userMessage: '',
      persona: activeConfig.persona,
      groupMembers: activeConfig.groupMembers,
      templates: globalConfig.macroTemplates,
      customArrays: globalConfig.customArrays,
      vectorHits,
      memoryContext,
      lightFrontend: activeConfig.lightFrontend,
      targetSpeaker: lastMessage.speaker,
      activationContext: { seed: session.id || sessionId, generationType: 'continue' },
      options: session.settings
    });

    assembled.messages.push({
      role: 'assistant',
      content: applyPromptTransforms(
        continuationContent,
        activeConfig.lightFrontend?.regexTransforms,
        {
          role: 'assistant',
          context: {
            user: activeConfig.persona?.enabled ? activeConfig.persona.name || '用户' : '用户',
            char: activeConfig.characterCard?.name || '',
            characterCard: activeConfig.characterCard,
            persona: activeConfig.persona,
            lightFrontendState: session.memory?.lightFrontendState || {}
          },
          depth: 0
        }
      )
    });

    const streamFilter = createHiddenBlockStreamFilter(onToken);
    let assistantResult;
    try {
      assistantResult = await this.completeAssistantContentStream({
        provider,
        messages: assembled.messages,
        onToken: streamFilter.push,
        fallbackChain,
        taskKey: 'chat',
        signal
      });
    } catch (error) {
      // 用户主动中止：把已流出的续写增量并入 last assistant（aborted 标记），
      // 不执行 MVU / 世界模拟 / 记忆维护；增量过短则静默丢弃保持原消息不变
      if (isAbortError(error) || signal?.aborted) {
        const partialIncrement = streamFilter.getVisibleText().trim();
        if (partialIncrement.length < MIN_ABORTED_PARTIAL_CHARS) throw error;
        lastMessage.content = `${continuationContent}\n${partialIncrement}`;
        lastMessage.aborted = true;
        lastMessage.abortedAt = new Date().toISOString();
        lastMessage.abortReason = 'user-stopped-continuation';
        lastMessage.updatedAt = lastMessage.abortedAt;
        lastMessage.swipes = normalizeSwipes(lastMessage.swipes, lastMessage.content);
        lastMessage.activeSwipeIndex = Math.max(0, lastMessage.swipes.indexOf(lastMessage.content));
        session.updatedAt = lastMessage.abortedAt;
        await this.sessionService.saveSession(session);
        const abortError = new Error('GENERATION_ABORTED');
        abortError.code = 'GENERATION_ABORTED';
        abortError.partialMessage = lastMessage;
        throw abortError;
      }
      throw error;
    }
    await streamFilter.end();
    const parsedContinuation = parseAssistantOutput(assistantResult.content);
    const consistency = validateNarrativeHardFacts(parsedContinuation.reply.content, session.memory);
    const continuationFrame = resolveNarrativeTurnFrame(parsedContinuation.turnFrame, {
      consistencyValid: consistency.valid,
      content: parsedContinuation.reply.content,
      memory: session.memory
    });
    const usage = buildUsageSnapshot({
      provider,
      assembled,
      content: parsedContinuation.reply.content,
      providerResult: assistantResult
    });
    appendUsageLedgerEntry(session, {
      taskKey: 'chat',
      messageId: lastMessage.id,
      usage,
      routing: assistantResult.routing
    });
    if (!consistency.valid) {
      lastMessage.rejectedContinuations = [
        ...(Array.isArray(lastMessage.rejectedContinuations) ? lastMessage.rejectedContinuations : []),
        {
          content: String(parsedContinuation.reply.content || ''),
          consistency,
          rejectedAt: new Date().toISOString()
        }
      ].slice(-8);
      lastMessage.narrativeConsistency = consistency;
      lastMessage.roleplayPanels = applyConsistencyNotice(lastMessage.roleplayPanels || {}, consistency);
      lastMessage.updatedAt = new Date().toISOString();
      session.updatedAt = lastMessage.updatedAt;
      await this.sessionService.saveSession(session);
      return { session, reply: lastMessage, debug: assembled };
    }
    const mvuUpdate = applyAssistantMvuUpdate(session, parsedContinuation);
    const continuedContent = continuationContent + '\n' + String(parsedContinuation.reply.content || '').trim();
    const parsedReply = extractRecommendedActions(continuedContent);

    lastMessage.content = parsedReply.content;
    lastMessage.turnFrame = continuationFrame;
    if (!lastMessage.turnFrame) delete lastMessage.turnFrame;
    if (parsedContinuation.turnFrameError) lastMessage.turnFrameError = parsedContinuation.turnFrameError;
    else delete lastMessage.turnFrameError;
    const continuationModelEnvelope = mergeActionEnvelopes(lastMessage.actionEnvelope, parsedContinuation.actionEnvelope);
    const fallbackStateEnvelope = buildTurnFrameStateEnvelope(continuationFrame, session.memory, continuationModelEnvelope, {
      content: parsedReply.content
    });
    lastMessage.actionEnvelope = mergeActionEnvelopes(continuationModelEnvelope, fallbackStateEnvelope);
    if (!lastMessage.actionEnvelope) delete lastMessage.actionEnvelope;
    if (parsedContinuation.actionError) {
      lastMessage.actionError = {
        code: parsedContinuation.actionError.code,
        detail: String(parsedContinuation.actionError.detail || parsedContinuation.actionError.message || '')
      };
    }
    lastMessage.mvuPatches = [
      ...(Array.isArray(lastMessage.mvuPatches) ? lastMessage.mvuPatches : []),
      ...mvuUpdate.patches
    ].slice(-64);
    if (!lastMessage.mvuPatches.length) delete lastMessage.mvuPatches;
    if (mvuUpdate.error) lastMessage.mvuError = structuredClone(mvuUpdate.error);
    lastMessage.roleplayPanels = mergeRoleplayPanels(
      lastMessage.roleplayPanels,
      {
        ...materializeTurnFramePanels(continuationFrame),
        ...parsedContinuation.roleplayPanels
      },
      assembled
    );
    const continuationDecisionMemory = this.worldSimulationService.projectDecisionMemory({
      session,
      assistantMessage: lastMessage,
      actionEnvelope: lastMessage.actionEnvelope
    });
    const latestUserMessage = findLatestMeaningfulUserMessage(session.messages);
    const recommendationPlan = resolveRecommendationPlan(
      parsedContinuation.reply.recommendedActions,
      continuationDecisionMemory,
      {
        userMessage: latestUserMessage,
        assistantContent: lastMessage.content,
        recentMessages: session.messages.slice(0, -1),
        generationType: 'continue',
        roleplayMode: activeConfig?.settings?.roleplayMode || session.settings?.roleplayMode,
        characterCard: activeConfig?.characterCard,
        groupMembers: activeConfig?.groupMembers,
        turnFrame: continuationFrame,
        recommendationSource: parsedContinuation.reply.recommendedActionPresentation?.source
      }
    );
    lastMessage.recommendedActions = recommendationPlan.actions;
    lastMessage.recommendedActionOptions = recommendationPlan.actionOptions;
    const recommendationPresentation = parsedContinuation.reply.recommendedActionPresentation
      || recommendationPlan.presentation;
    if (recommendationPresentation) {
      lastMessage.recommendedActionPresentation = structuredClone(recommendationPresentation);
    } else {
      delete lastMessage.recommendedActionPresentation;
    }
    lastMessage.decisionNode = recommendationPlan.decision;
    lastMessage.worldBookActivation = structuredClone(assembled.sections.worldBookActivation);
    delete lastMessage.adjudication;
    lastMessage.swipes = normalizeSwipes(lastMessage.swipes, lastMessage.content);
    lastMessage.activeSwipeIndex = Math.max(0, lastMessage.swipes.indexOf(lastMessage.content));
    lastMessage.swipeMetadata = normalizeSwipeMetadata(lastMessage, lastMessage.swipes);
    lastMessage.swipeMetadata[lastMessage.activeSwipeIndex] = metadataFromMessage(lastMessage);
    lastMessage.updatedAt = new Date().toISOString();

    session.memory = this.memoryService.rebuildRange({ session, messages: session.messages });
    this.worldSimulationService.refreshCurrentAct(session, lastMessage);
    await this.runMemoryMaintenanceIfNeeded({ session, provider, assembled, globalConfig });
    session.updatedAt = new Date().toISOString();
    this.invalidateVectorIndex(session);
    await this.sessionService.saveSession(session);
    return { session, reply: lastMessage, debug: assembled };
  }

  async runMemoryMaintenanceIfNeeded({ session, provider, assembled, globalConfig }) {
    const shouldRunMaintenance = shouldSummarize({
      unsummarizedTurnCount: session.memory.unsummarizedTurnCount,
      promptTokenEstimate: assembled.tokenEstimate,
      maxPromptTokens: session.settings.maxPromptTokens
    });
    if (!shouldRunMaintenance) return;

    const consecutiveFailures = Number(session.memory.consecutiveSummaryFailures || 0);
    if (consecutiveFailures >= MAX_CONSECUTIVE_SUMMARY_FAILURES) {
      session.memory.lastSummaryError = session.memory.lastSummaryError || 'summary paused after repeated failures';
      return;
    }

    // fact/summary 可使用独立 provider，并按任务回退链或全局回退链重试。
    const config = globalConfig || await this.configService.getAll();
    const factProvider = getProviderForTask(config, session, 'fact');
    const factFallback = getProviderChain(config, session, factProvider, 'fact').slice(1);
    const summaryProvider = getProviderForTask(config, session, 'summary');
    const summaryFallback = getProviderChain(config, session, summaryProvider, 'summary').slice(1);
    const narrativeContext = resolveNarrativeContext({
      memory: session.memory,
      mode: session.settings?.narrativeMode
    });
    await this.tryExtractFacts({ session, provider: factProvider, fallbackChain: factFallback, narrativeContext });
    await this.trySummarize({ session, provider: summaryProvider, fallbackChain: summaryFallback, narrativeContext });
  }

  async tryExtractFacts({ session, provider, fallbackChain = [], narrativeContext }) {
    const unsummarizedTurnCount = Number(session.memory.unsummarizedTurnCount || 0);
    const messageWindow = Math.min(40, Math.max(8, unsummarizedTurnCount * 2));
    const recent = filterNarrativeContextMessages(session.messages, session.memory)
      .filter((message) => !message.excluded)
      .slice(-messageWindow);
    try {
      const messages = buildFactExtractionPrompt({
        worldState: session.memory.worldState,
        messages: recent,
        narrativeContext,
        canonicalContext: buildCanonicalSourceDigest(session.config, recent)
      });
      const result = await this.completeWithFallback({
        primaryProvider: provider,
        fallbackChain,
        messages,
        taskKey: 'fact'
      });
      const usage = buildUsageSnapshot({ provider, messages, content: result.content, providerResult: result });
      appendUsageLedgerEntry(session, {
        taskKey: 'fact',
        usage,
        routing: result.routing
      });
      const latestAssistant = [...(Array.isArray(session.messages) ? session.messages : [])]
        .reverse()
        .find((message) => message?.role === 'assistant' && message?.excluded !== true && message?.contextExcluded !== true);
      const allowWorldStatePatch = turnFrameAllowsFactAdmission(latestAssistant?.turnFrame)
        || ['accepted', 'partial'].includes(String(latestAssistant?.adjudication?.status || ''));
      session.memory = applyFactExtractionResult(session.memory, result.content, {
        narrativeContext,
        allowWorldStatePatch,
        registryContext: {
          characterCard: session.config?.characterCard,
          characterPresets: session.config?.characterPresets,
          groupMembers: session.config?.groupMembers,
          worldBook: session.config?.worldBook,
          assistantMessage: latestAssistant,
          turnId: latestAssistant?.id
        }
      });
      if (allowWorldStatePatch) {
        await this.appendDynamicWorldBookEntries({ session, content: result.content, narrativeContext });
      }
    } catch (error) {
      session.memory.lastFactExtractionError = error.message;
    }
  }

  async appendDynamicWorldBookEntries({ session, content, narrativeContext }) {
    const entries = normalizeDynamicWorldBookEntries(content, { narrativeContext });
    if (!entries.length) return;
    const activeConfig = await this.resolveSessionConfig(session);
    const existing = Array.isArray(activeConfig.worldBook) ? activeConfig.worldBook : [];
    const existingKeys = new Set(existing.map(worldBookIdentity));
    const nextEntries = entries.filter((entry) => !existingKeys.has(worldBookIdentity(entry)));
    if (!nextEntries.length) return;
    activeConfig.worldBook = [...existing, ...nextEntries];
    session.config = activeConfig;
  }

  async trySummarize({ session, provider, fallbackChain = [], narrativeContext }) {
    const unsummarizedTurnCount = Number(session.memory.unsummarizedTurnCount || 0);
    const messageWindow = Math.min(40, Math.max(8, unsummarizedTurnCount * 2));
    const recent = filterNarrativeContextMessages(session.messages, session.memory).slice(-messageWindow);
    try {
      const messages = buildSummaryPrompt({
        rollingSummary: session.memory.rollingSummary,
        messages: recent,
        narrativeContext,
        canonicalContext: buildCanonicalSourceDigest(session.config, recent)
      });
      const result = await this.completeWithFallback({
        primaryProvider: provider,
        fallbackChain,
        messages,
        taskKey: 'summary'
      });
      const usage = buildUsageSnapshot({ provider, messages, content: result.content, providerResult: result });
      appendUsageLedgerEntry(session, {
        taskKey: 'summary',
        usage,
        routing: result.routing
      });
      const summary = parseSummaryResult(result.content);
      if (!summary.rollingSummary) throw new Error('SUMMARY_OUTPUT_EMPTY');
      session.memory.rollingSummary = summary.rollingSummary;
      if (summary.sceneSummary) {
        this.memoryService.recordSceneSummary({
          session,
          title: summary.sceneTitle,
          summary: summary.sceneSummary,
          messages: recent
        });
      }
      session.memory.unsummarizedTurnCount = 0;
      session.memory.lastSummaryError = '';
      session.memory.consecutiveSummaryFailures = 0;
    } catch (error) {
      session.memory.lastSummaryError = error.message;
      session.memory.consecutiveSummaryFailures = Number(session.memory.consecutiveSummaryFailures || 0) + 1;
    }
  }

  /**
   * 带回退的 complete 调用：主 provider 失败时按顺序尝试 fallbackChain
   * 全部失败时抛出最后一个错误
   */
  async completeWithFallback({ primaryProvider, fallbackChain = [], messages, taskKey = 'chat', tools = null }) {
    const chain = [primaryProvider, ...fallbackChain].filter(Boolean);
    const startedAt = Date.now();
    const attempts = [];
    let lastError;
    for (let index = 0; index < chain.length; index += 1) {
      const provider = chain[index];
      const attemptStartedAt = Date.now();
      try {
        const result = await this.providerClient.complete({ provider, messages, tools });
        attempts.push(buildRoutingAttempt({ provider, status: 'success', startedAt: attemptStartedAt }));
        return attachRoutingMetadata(result, {
          taskKey,
          primaryProvider,
          selectedProvider: provider,
          fallbackUsed: index > 0,
          attempts,
          startedAt
        });
      } catch (error) {
        lastError = error;
        attempts.push(buildRoutingAttempt({ provider, status: 'error', startedAt: attemptStartedAt, error }));
      }
    }
    if (lastError && typeof lastError === 'object') {
      lastError.routing = buildRoutingMetadata({
        taskKey,
        primaryProvider,
        selectedProvider: null,
        fallbackUsed: attempts.length > 1,
        attempts,
        startedAt
      });
    }
    throw lastError || new Error('ALL_PROVIDERS_FAILED');
  }

  /**
   * MCP function calling 循环：获取 MCP 工具，调用 provider，若有 tool_calls 则执行工具并循环。
   * 最大循环 5 次，防止无限调用。无 mcpRegistry 或无工具时退化为普通 completeWithFallback。
   */
  async completeWithToolLoop({ provider, fallbackChain, messages, taskKey = 'chat' }) {
    const mcpTools = await this.listMcpTools();
    if (!mcpTools.length) {
      return this.completeWithFallback({ primaryProvider: provider, fallbackChain, messages, taskKey });
    }

    const MAX_TOOL_ROUNDS = 5;
    let currentMessages = [...messages];
    let result = null;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      result = await this.completeWithFallback({
        primaryProvider: provider,
        fallbackChain,
        messages: currentMessages,
        taskKey,
        tools: mcpTools
      });

      if (!Array.isArray(result.toolCalls) || result.toolCalls.length === 0) {
        return result;
      }

      // 追加 assistant 的 tool_calls 消息（OpenAI 格式）
      currentMessages = [
        ...currentMessages,
        {
          role: 'assistant',
          content: result.content || '',
          tool_calls: result.toolCalls.map((call) => ({
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: JSON.stringify(call.arguments) }
          }))
        }
      ];

      // 执行每个工具调用，追加 tool 结果消息
      for (const call of result.toolCalls) {
        const toolResult = await this.executeMcpToolCall(call);
        currentMessages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: toolResult
        });
      }
    }

    // 达到最大循环次数，返回最后一次结果（可能仍有 toolCalls，但不再执行）
    return result;
  }

  async listMcpTools() {
    if (!this.mcpRegistry) return [];
    try {
      const tools = await this.mcpRegistry.listAllTools();
      return Array.isArray(tools) ? tools : [];
    } catch {
      return [];
    }
  }

  async executeMcpToolCall(call) {
    if (!this.mcpRegistry) return JSON.stringify({ error: 'MCP registry not available' });
    const tool = await this.resolveMcpToolByName(call.name);
    if (!tool) return JSON.stringify({ error: `Tool ${call.name} not found` });
    try {
      const result = await this.mcpRegistry.callTool({
        serverId: tool.serverId,
        toolName: tool.toolName,
        arguments: call.arguments || {}
      });
      return serializeToolResult(result);
    } catch (error) {
      return JSON.stringify({ error: error.message || 'Tool execution failed' });
    }
  }

  async resolveMcpToolByName(name) {
    const tools = await this.listMcpTools();
    return tools.find((tool) => tool.toolName === name || tool.name === name) || null;
  }

  /**
   * 带回退的 stream 调用；signal 中止（用户主动停止）时立即失败，不触发回退重试
   */
  async streamWithFallback({ primaryProvider, fallbackChain = [], messages, onToken, taskKey = 'chat', signal = null }) {
    const chain = [primaryProvider, ...fallbackChain].filter(Boolean);
    const startedAt = Date.now();
    const attempts = [];
    let lastError;
    for (let index = 0; index < chain.length; index += 1) {
      if (signal?.aborted) {
        const abortError = new Error('GENERATION_ABORTED');
        abortError.code = 'GENERATION_ABORTED';
        throw abortError;
      }
      const provider = chain[index];
      const attemptStartedAt = Date.now();
      try {
        const result = await this.providerClient.stream({ provider, messages, onToken, signal });
        attempts.push(buildRoutingAttempt({ provider, status: 'success', startedAt: attemptStartedAt }));
        return attachRoutingMetadata(result, {
          taskKey,
          primaryProvider,
          selectedProvider: provider,
          fallbackUsed: index > 0,
          attempts,
          startedAt
        });
      } catch (error) {
        // 用户主动中止不属于 provider 故障，禁止回退重试继续消耗 token
        if (isAbortError(error) || signal?.aborted) {
          const abortError = new Error('GENERATION_ABORTED');
          abortError.code = 'GENERATION_ABORTED';
          abortError.routing = buildRoutingMetadata({
            taskKey,
            primaryProvider,
            selectedProvider: provider,
            fallbackUsed: index > 0,
            attempts,
            startedAt
          });
          throw abortError;
        }
        lastError = error;
        attempts.push(buildRoutingAttempt({ provider, status: 'error', startedAt: attemptStartedAt, error }));
      }
    }
    if (lastError && typeof lastError === 'object') {
      lastError.routing = buildRoutingMetadata({
        taskKey,
        primaryProvider,
        selectedProvider: null,
        fallbackUsed: attempts.length > 1,
        attempts,
        startedAt
      });
    }
    throw lastError || new Error('ALL_PROVIDERS_FAILED');
  }

  invalidateVectorIndex(session) {
    if (typeof this.vectorMemoryService?.dropIndex !== 'function') return;
    this.vectorMemoryService.dropIndex(session?.id || 'main');
  }
}

// 同一会话的读-改-写入口统一加会话级互斥锁，防止并发请求互相覆盖会话数据
const SESSION_LOCKED_METHODS = [
  'sendMessage',
  'sendMessageStream',
  'editMessage',
  'switchMessageSwipe',
  'regenerateAssistantMessage',
  'rewriteText',
  'toggleMessageVisibility',
  'toggleMessageBookmark',
  'continueMessage',
  'forkTimelineAtMessage',
  'switchTimeline',
  'renameTimelineBranchLabel',
  'removeTimelineBranch'
];
for (const methodName of SESSION_LOCKED_METHODS) {
  const original = AgentService.prototype[methodName];
  AgentService.prototype[methodName] = function lockedSessionMethod(...args) {
    return this.withSessionLock(args[0]?.sessionId, () => original.apply(this, args));
  };
}

// 判定错误是否为用户主动中止（AbortError / DOMException AbortError / 自定义 GENERATION_ABORTED）
function isAbortError(error) {
  if (!error) return false;
  if (error.code === 'GENERATION_ABORTED') return true;
  const name = String(error.name || '');
  if (name === 'AbortError') return true;
  return /aborted|abort/i.test(String(error.message || ''));
}

function attachRoutingMetadata(result, options) {
  const normalizedResult = isPlainObject(result) ? result : { content: String(result || '') };
  return {
    ...normalizedResult,
    routing: buildRoutingMetadata(options)
  };
}

function buildRoutingMetadata({ taskKey, primaryProvider, selectedProvider, fallbackUsed, attempts, startedAt }) {
  return {
    callId: `call-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    taskKey: String(taskKey || 'chat'),
    requestedProviderId: String(primaryProvider?.id || ''),
    providerId: String(selectedProvider?.id || ''),
    model: String(selectedProvider?.model || ''),
    fallbackUsed: fallbackUsed === true,
    attempts: Array.isArray(attempts) ? attempts.map((attempt) => ({ ...attempt })) : [],
    durationMs: Math.max(0, Date.now() - Number(startedAt || Date.now()))
  };
}

function buildRoutingAttempt({ provider, status, startedAt, error }) {
  return {
    providerId: String(provider?.id || ''),
    model: String(provider?.model || ''),
    status: status === 'success' ? 'success' : 'error',
    durationMs: Math.max(0, Date.now() - Number(startedAt || Date.now())),
    error: error ? String(error.message || error).slice(0, 300) : ''
  };
}

function serializeToolResult(result) {
  if (typeof result === 'string') return result.slice(0, 8000);
  if (Array.isArray(result?.content)) {
    return result.content
      .map((block) => {
        if (block?.type === 'text' && typeof block.text === 'string') return block.text;
        if (typeof block === 'string') return block;
        return JSON.stringify(block);
      })
      .join('\n')
      .slice(0, 8000);
  }
  return JSON.stringify(result || {}).slice(0, 8000);
}

function createMessage(role, content, extras = {}) {
  const message = {
    id: `${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role,
    content: String(content || ''),
    createdAt: new Date().toISOString()
  };
  message.swipes = [message.content];
  message.activeSwipeIndex = 0;
  if (Array.isArray(extras.recommendedActions) && extras.recommendedActions.length) {
    message.recommendedActions = extras.recommendedActions;
  }
  if (Array.isArray(extras.recommendedActionOptions) && extras.recommendedActionOptions.length) {
    message.recommendedActionOptions = structuredClone(extras.recommendedActionOptions);
  }
  if (extras.recommendedActionPresentation && typeof extras.recommendedActionPresentation === 'object') {
    message.recommendedActionPresentation = structuredClone(extras.recommendedActionPresentation);
  }
  if (extras.decisionNode && typeof extras.decisionNode === 'object' && !Array.isArray(extras.decisionNode)) {
    message.decisionNode = structuredClone(extras.decisionNode);
  }
  if (extras.turnFrame && typeof extras.turnFrame === 'object' && !Array.isArray(extras.turnFrame)) {
    message.turnFrame = structuredClone(extras.turnFrame);
  }
  if (extras.turnFrameError && typeof extras.turnFrameError === 'object' && !Array.isArray(extras.turnFrameError)) {
    message.turnFrameError = structuredClone(extras.turnFrameError);
  }
  if (extras.narrativeConsistency && typeof extras.narrativeConsistency === 'object') {
    message.narrativeConsistency = structuredClone(extras.narrativeConsistency);
  }
  if (extras.usage && typeof extras.usage === 'object' && !Array.isArray(extras.usage)) {
    message.usage = extras.usage;
  }
  if (extras.actionEnvelope && typeof extras.actionEnvelope === 'object') {
    message.actionEnvelope = structuredClone(extras.actionEnvelope);
  }
  if (extras.actionError) {
    message.actionError = {
      code: String(extras.actionError.code || 'ACTION_PARSE_FAILED'),
      detail: String(extras.actionError.detail || extras.actionError.message || '')
    };
  }
  if (Array.isArray(extras.mvuPatches) && extras.mvuPatches.length) {
    message.mvuPatches = structuredClone(extras.mvuPatches);
  }
  if (extras.mvuError) {
    message.mvuError = {
      code: String(extras.mvuError.code || 'MVU_PATCH_FAILED'),
      detail: String(extras.mvuError.detail || extras.mvuError.message || '')
    };
  }
  if (Array.isArray(extras.lifecycleReports) && extras.lifecycleReports.length) {
    message.lifecycleReports = structuredClone(extras.lifecycleReports);
  }
  if (extras.kind) message.kind = String(extras.kind);
  if (extras.hiddenFromChat === true) message.hiddenFromChat = true;
  // 中止留存的 partial 回合：aborted 消息保留正文但不参与协议解析产物
  if (extras.aborted === true) {
    message.aborted = true;
    message.abortedAt = String(extras.abortedAt || new Date().toISOString());
    message.abortReason = String(extras.abortReason || 'user-stopped').slice(0, 40);
  }
  if (extras.contextExcluded === true) {
    message.contextExcluded = true;
    message.contextExclusionReason = String(extras.contextExclusionReason || 'context-excluded').slice(0, 160);
    message.contextExcludedAt = new Date().toISOString();
  }
  if (extras.speaker) message.speaker = String(extras.speaker).slice(0, 30);
  if (extras.roleplayPanels && typeof extras.roleplayPanels === 'object' && !Array.isArray(extras.roleplayPanels)) {
    message.roleplayPanels = structuredClone(extras.roleplayPanels);
  }
  if (extras.worldBookActivation && typeof extras.worldBookActivation === 'object' && !Array.isArray(extras.worldBookActivation)) {
    message.worldBookActivation = structuredClone(extras.worldBookActivation);
  }
  message.swipeMetadata = [metadataFromMessage(message)];
  return message;
}

function buildRewriteMessages({ target, text, instruction, context = '' }) {
  const normalizedTarget = normalizeRewriteTarget(target);
  const recommendedActionRules = normalizedTarget === 'recommended-action'
    ? [
        '这是玩家已经选定的行动意图，请把它展开成当前主角真正会说、会做的一段行动。',
        '使用第一人称或与最近玩家消息一致的视角，控制在一至三句。',
        '体现角色的身份、性格、措辞和现场环境；需要询问时写出自然、明确的台词。',
        '只能补充动作、语气、观察和表达方式，不得新增行动结果、隐藏知识、NPC回应或新的核心决定。'
      ]
    : [];
  const system = [
    '# Magic Rewrite 改写器',
    '你负责把用户提供的文本改写得更适合沉浸式角色扮演创作。',
    '只输出改写后的文本，不要解释，不要加标题，不要使用 Markdown 代码块。',
    '保持原意、视角和用户已经决定的行动，不新增关键剧情事实，不替用户做新的核心选择。',
    '可以增强节奏、感官细节、语气、画面感和角色扮演可读性。',
    ...recommendedActionRules
  ].join('\n');
  const user = [
    `目标字段：${normalizedTarget}`,
    `改写要求：${String(instruction || '').trim() || '更有画面感，适合作为下一轮角色行动或旁白输入。'}`,
    context ? `\n当前扮演上下文：\n${context}` : '',
    '',
    normalizedTarget === 'recommended-action' ? '选定行动意图：' : '原文：',
    text
  ].filter((line) => line !== '').join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ];
}

function buildRecommendedActionContext({ session, characterCard }) {
  const card = characterCard && typeof characterCard === 'object' ? characterCard : {};
  const memory = session?.memory && typeof session.memory === 'object' ? session.memory : {};
  const worldState = memory.worldState && typeof memory.worldState === 'object' ? memory.worldState : {};
  const protagonist = worldState.protagonist && typeof worldState.protagonist === 'object'
    ? worldState.protagonist
    : {};
  const narrativeState = memory.narrativeState && typeof memory.narrativeState === 'object'
    ? memory.narrativeState
    : {};
  const explicitRole = card.role && card.role !== card.creator ? card.role : '';
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  const recentMessages = messages.slice(-4).map((message) => {
    const speaker = message.role === 'user' ? '玩家' : (message.speaker || '旁白');
    return `${speaker}：${compactRewriteContext(message.content, 900)}`;
  });
  const latestAssistant = [...messages].reverse().find((message) => message?.role === 'assistant');
  const panels = latestAssistant?.roleplayPanels && typeof latestAssistant.roleplayPanels === 'object'
    ? latestAssistant.roleplayPanels
    : {};

  return [
    ['主角', protagonist.name || card.name],
    ['身份', explicitRole || protagonist.realm],
    ['性格与行动习惯', card.personality],
    ['人物背景', card.description],
    ['角色语言示例', card.exampleDialog],
    ['当前地点', worldState.location?.current || worldState.location],
    ['当前主线', narrativeState.activeArc || worldState.activeArc || worldState.quest],
    ['本幕环境', panels.sceneStatus],
    ['本幕人物状态', panels.characterStatus],
    ['最近对话', recentMessages.join('\n')]
  ]
    .map(([label, value]) => [label, compactRewriteContext(value, label === '最近对话' ? 2400 : 700)])
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}：${value}`)
    .join('\n');
}

function compactRewriteContext(value, maxLength = 700) {
  if (value === undefined || value === null || value === '') return '';
  const text = Array.isArray(value)
    ? value.map((item) => compactRewriteContext(item, maxLength)).filter(Boolean).join('；')
    : typeof value === 'object'
      ? JSON.stringify(value)
      : String(value);
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength)}…` : compact;
}

function normalizeRewriteTarget(target) {
  const value = String(target || '').trim();
  return value || 'chat-input';
}

function cleanRewriteText(content) {
  const text = String(content || '').trim();
  const fenced = text.match(/^```(?:\w+)?\s*([\s\S]*?)\s*```$/);
  const unfenced = fenced ? fenced[1].trim() : text;
  return unfenced
    .replace(/^(改写后|润色后|结果|输出)[:：]\s*/i, '')
    .trim();
}

function getActiveProvider(config, session = {}) {
  return getProviderForTask(config, session, 'chat');
}

/**
 * 按任务获取 provider
 * @param {string} taskKey - chat | fact | summary
 */
function getProviderForTask(config, session = {}, taskKey = 'chat') {
  const providersConfig = config.providers || {};
  const providers = Array.isArray(providersConfig.providers) ? providersConfig.providers : [];

  const taskProviders = isPlainObject(providersConfig.taskProviders) ? providersConfig.taskProviders : {};
  const sessionTaskProviders = isPlainObject(session.settings?.taskProviderOverrides)
    ? session.settings.taskProviderOverrides
    : {};
  const sessionTaskProviderId = String(sessionTaskProviders[taskKey] || '').trim();
  const sessionProviderId = INTERACTIVE_PROVIDER_TASKS.has(taskKey)
    ? String(session.settings?.providerId || '').trim()
    : '';
  const taskProviderId = String(
    taskProviders[taskKey]
    || (taskKey === 'rewrite' ? taskProviders.chat : '')
    || ''
  ).trim();
  const activeProviderId = String(providersConfig.activeProviderId || '').trim();

  // 会话模型只覆盖交互任务；后台 fact/summary 仍使用各自的任务路由。
  const preferredId = sessionTaskProviderId || sessionProviderId || taskProviderId || activeProviderId;
  const provider = providers.find((p) => p.id === preferredId)
    || providers.find((p) => p.id === activeProviderId)
    || providers[0];
  if (!provider) throw new Error('NO_ACTIVE_PROVIDER');
  return provider;
}

/**
 * 获取 provider 回退链：[主, ...回退]，去重
 */
function getProviderChain(config, session, primaryProvider, taskKey = 'chat') {
  const providersConfig = config.providers || {};
  const providers = Array.isArray(providersConfig.providers) ? providersConfig.providers : [];
  const sessionTaskFallbacks = isPlainObject(session.settings?.taskFallbackOverrides)
    ? session.settings.taskFallbackOverrides
    : {};
  const taskFallbackChains = isPlainObject(providersConfig.taskFallbackChains)
    ? providersConfig.taskFallbackChains
    : {};
  const taskFallbackIds = Array.isArray(sessionTaskFallbacks[taskKey]) && sessionTaskFallbacks[taskKey].length
    ? sessionTaskFallbacks[taskKey]
    : (Array.isArray(taskFallbackChains[taskKey]) && taskFallbackChains[taskKey].length
        ? taskFallbackChains[taskKey]
        : (taskKey === 'rewrite' && Array.isArray(taskFallbackChains.chat) ? taskFallbackChains.chat : []));
  const fallbackIds = taskFallbackIds.length
    ? taskFallbackIds
    : (Array.isArray(providersConfig.fallbackChain) ? providersConfig.fallbackChain : []);
  const chain = [primaryProvider];
  fallbackIds.forEach((id) => {
    const p = providers.find((x) => x.id === id);
    if (p && !chain.some((c) => c.id === p.id)) chain.push(p);
  });
  return chain;
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function buildUsageSnapshot({ provider, assembled = {}, messages = [], content, providerResult }) {
  const providerUsage = providerResult?.usage || providerResult?.raw?.usage || {};
  const routing = isPlainObject(providerResult?.routing) ? providerResult.routing : {};
  const promptEstimate = Number.isFinite(Number(assembled?.tokenEstimate))
    ? Number(assembled.tokenEstimate)
    : estimateMessageTokens(messages);
  const promptTokens = normalizeTokenCount(providerUsage.prompt_tokens ?? providerUsage.promptTokens, promptEstimate);
  const completionTokens = normalizeTokenCount(
    providerUsage.completion_tokens ?? providerUsage.completionTokens,
    estimateTokens(content)
  );
  return {
    callId: String(routing.callId || ''),
    taskKey: String(routing.taskKey || 'chat'),
    requestedProviderId: String(routing.requestedProviderId || provider?.id || ''),
    providerId: String(routing.providerId || provider?.id || ''),
    model: String(routing.model || provider?.model || ''),
    fallbackUsed: routing.fallbackUsed === true,
    durationMs: normalizeTokenCount(routing.durationMs, 0),
    promptTokens,
    completionTokens,
    totalTokens: normalizeTokenCount(
      providerUsage.total_tokens ?? providerUsage.totalTokens,
      promptTokens + completionTokens
    ),
    injectedCards: Array.isArray(assembled.injectedCards) ? assembled.injectedCards.length : 0,
    promptModules: Array.isArray(assembled.sections?.retainedPromptModuleIds)
      ? assembled.sections.retainedPromptModuleIds.length
      : 0,
    promptModuleRuntime: summarizePromptModuleRuntime(assembled.sections),
    estimated: !hasNumericUsage(providerUsage)
  };
}

function mergeRoleplayPanels(previousPanels, currentPanels, assembled) {
  const previous = previousPanels && typeof previousPanels === 'object' ? previousPanels : {};
  const current = currentPanels && typeof currentPanels === 'object' ? currentPanels : {};
  const next = { ...previous, ...current };
  const notice = buildRoleplayRuntimeNotice(next, assembled?.sections);
  if (notice) next.runtimeNotice = notice;
  else delete next.runtimeNotice;
  return next;
}

function buildRoleplayRuntimeNotice(panels = {}, sections = {}) {
  const notices = [];
  const suppressedBundles = Array.isArray(sections?.communityPresetIntegrity?.finalSuppressed)
    ? sections.communityPresetIntegrity.finalSuppressed
    : [];
  if (suppressedBundles.length) {
    const titles = suppressedBundles
      .map((bundle) => String(bundle?.title || '社区预设').trim())
      .filter(Boolean)
      .slice(0, 2);
    notices.push(`本轮未运行完整预设${titles.length ? `《${titles.join('》《')}》` : ''}：它会超过当前成套运行范围。系统没有执行半套规则，请在预设设置中精简或调整运行预算后再试。`);
  }
  const hasStructuredInteraction = ['sceneStatus', 'characterStatus', 'relationshipStatus', 'nextCharacter']
    .some((key) => String(panels?.[key] || '').trim());
  if (!hasStructuredInteraction) {
    notices.push('本轮未生成结构化交互信息；正文已保留，但人物、关系与场景不会据此自动补写。下一轮将以角色卡、世界书和已确认事实重新校正。');
  }
  return notices.join('\n');
}

function consistencyConflictDetail(consistency) {
  if (!consistency || consistency.valid) return '';
  const conflicts = Array.isArray(consistency.conflicts) ? consistency.conflicts : [];
  if (!conflicts.length) return '';
  return conflicts
    .map((entry) => `硬事实「${entry.fact || entry.id || '未知'}」与正文片段「${entry.matched || ''}」冲突`)
    .join('；');
}

function skippedLifecycle(event, reason) {
  return {
    envelopes: [],
    report: {
      event: String(event || ''),
      skipped: true,
      reason: String(reason || '')
    }
  };
}

function applyConsistencyNotice(panels, consistency) {
  if (!panels || typeof panels !== 'object') return panels;
  if (!consistency || consistency.valid) return panels;
  const detail = consistencyConflictDetail(consistency);
  if (!detail) return panels;
  const existing = String(panels.runtimeNotice || '').trim();
  const notice = `叙事一致性校验未通过：${detail}。已回滚本轮记忆更新，下一轮将基于已确认硬事实重新生成。`;
  return {
    ...panels,
    runtimeNotice: existing ? `${existing}\n${notice}` : notice
  };
}

function summarizePromptModuleRuntime(sections = {}) {
  const requested = Array.isArray(sections?.promptModules) ? sections.promptModules.length : 0;
  const retained = Array.isArray(sections?.retainedPromptModuleIds)
    ? sections.retainedPromptModuleIds.length
    : 0;
  const suppressedBundles = Array.isArray(sections?.communityPresetIntegrity?.finalSuppressed)
    ? sections.communityPresetIntegrity.finalSuppressed
    : [];
  return {
    requested,
    retained,
    suppressedBundleCount: suppressedBundles.length,
    status: suppressedBundles.length
      ? 'suppressed-for-integrity'
      : retained < requested ? 'budget-reduced' : 'complete'
  };
}

async function emitStreamPhase(onPhase, phase) {
  if (typeof onPhase !== 'function') return;
  try {
    await onPhase(phase);
  } catch {
    // UI transport notifications must never interrupt persistence of a completed turn.
  }
}

function appendUsageLedgerEntry(session, { taskKey, messageId = '', usage, routing }) {
  if (!session || !isPlainObject(usage)) return;
  if (!Array.isArray(session.usageLedger)) session.usageLedger = [];
  const callId = String(usage.callId || routing?.callId || `call-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  if (session.usageLedger.some((entry) => entry?.callId === callId)) return;

  session.usageLedger.push({
    callId,
    messageId: String(messageId || ''),
    taskKey: String(taskKey || usage.taskKey || 'chat'),
    createdAt: new Date().toISOString(),
    requestedProviderId: String(usage.requestedProviderId || routing?.requestedProviderId || ''),
    providerId: String(usage.providerId || routing?.providerId || ''),
    model: String(usage.model || routing?.model || ''),
    fallbackUsed: usage.fallbackUsed === true || routing?.fallbackUsed === true,
    attempts: Array.isArray(routing?.attempts) ? routing.attempts.map((attempt) => ({ ...attempt })) : [],
    durationMs: normalizeTokenCount(usage.durationMs ?? routing?.durationMs, 0),
    promptTokens: normalizeTokenCount(usage.promptTokens, 0),
    completionTokens: normalizeTokenCount(usage.completionTokens, 0),
    totalTokens: normalizeTokenCount(usage.totalTokens, 0),
    injectedCards: normalizeTokenCount(usage.injectedCards, 0),
    promptModules: normalizeTokenCount(usage.promptModules, 0),
    estimated: usage.estimated !== false,
    status: 'success'
  });
}

function linkUsageLedgerEntry(session, callId, messageId) {
  if (!Array.isArray(session?.usageLedger) || !callId || !messageId) return;
  const entry = session.usageLedger.find((item) => item?.callId === callId);
  if (entry) entry.messageId = String(messageId);
}

function estimateMessageTokens(messages) {
  const text = (Array.isArray(messages) ? messages : [])
    .map((message) => String(message?.content || ''))
    .join('\n');
  return estimateTokens(text);
}

function normalizeTokenCount(value, fallback) {
  const number = Number(value);
  if (Number.isFinite(number) && number >= 0) return Math.ceil(number);
  return Math.max(0, Math.ceil(Number(fallback) || 0));
}

function hasNumericUsage(usage) {
  return Boolean(usage) && [
    usage.prompt_tokens,
    usage.promptTokens,
    usage.completion_tokens,
    usage.completionTokens,
    usage.total_tokens,
    usage.totalTokens
  ].some((value) => Number.isFinite(Number(value)));
}

function findMessageIndex(session, messageId) {
  const index = (session.messages || []).findIndex((message) => message.id === messageId);
  if (index < 0) throw new Error('MESSAGE_NOT_FOUND');
  return index;
}

function normalizeSwipes(swipes, fallbackContent) {
  const values = Array.isArray(swipes) ? swipes.map((item) => String(item || '')).filter(Boolean) : [];
  const fallback = String(fallbackContent || '');
  if (fallback && !values.includes(fallback)) values.push(fallback);
  return values;
}

function parseAssistantOutput(rawContent) {
  const turnFrameParsed = extractNarrativeTurnFrame(rawContent);
  const mvuParsed = extractMvuPatchEnvelope(turnFrameParsed.content);
  const actionParsed = extractActionEnvelope(mvuParsed.content);
  const reply = extractRecommendedActions(actionParsed.content);
  const presentation = parseRoleplayResponse(reply.content);
  reply.content = presentation.content;
  if (!reply.recommendedActions.length && presentation.recommendedActions.length) {
    reply.recommendedActions = presentation.recommendedActions;
  }
  if (!reply.recommendedActionPresentation && presentation.recommendedActionPresentation) {
    reply.recommendedActionPresentation = presentation.recommendedActionPresentation;
  }
  if (!String(reply.content || '').trim()) throw new Error('PROVIDER_EMPTY_RESPONSE');
  return {
    reply,
    speaker: presentation.speaker || extractSpeaker(actionParsed.content),
    roleplayPanels: presentation.panels,
    actionEnvelope: actionParsed.envelope,
    actionError: actionParsed.error,
    mvuEnvelope: mvuParsed.envelope,
    mvuError: mvuParsed.error,
    turnFrame: turnFrameParsed.frame,
    turnFrameError: turnFrameParsed.error
  };
}

function applyAssistantMvuUpdate(session, parsedOutput) {
  const parsedError = parsedOutput?.mvuError;
  const macroOps = parseMacroVariableWrites(parsedOutput?.reply?.content || '');
  const hasEnvelope = Boolean(parsedOutput?.mvuEnvelope);
  if (!hasEnvelope && !macroOps.length) {
    return { patches: [], error: parsedError ? serializeMvuError(parsedError) : null };
  }

  const memory = session.memory || (session.memory = {});
  const current = normalizeMvuSnapshot(memory.lightFrontendState);
  if (!current.enabled) {
    return {
      patches: [],
      error: { code: 'MVU_RUNTIME_DISABLED', detail: '当前会话未启用轻前端 MVU 状态。' }
    };
  }
  if (!memory.lightFrontendBaseline || typeof memory.lightFrontendBaseline !== 'object') {
    memory.lightFrontendBaseline = structuredClone(current);
  }

  // 合并显式 MVU envelope 与正文里的 setvar/addvar 宏操作
  const baseEnvelope = hasEnvelope
    ? structuredClone(parsedOutput.mvuEnvelope)
    : {
        spec: MVU_PATCH_SPEC,
        expectedRevision: current.revision,
        summary: 'setvar/addvar 宏写入',
        operations: []
      };
  baseEnvelope.operations = [...(baseEnvelope.operations || []), ...macroOps];

  try {
    // 开启乐观锁冲突自动恢复：模型生成期间的基线过期不应丢弃本轮实际发生的变量变化
    const applied = applyMvuPatchEnvelope(current, baseEnvelope, { recoverRevisionConflict: true });
    memory.lightFrontendState = structuredClone(applied.state);
    memory.lightFrontendReplayErrors = [];
    return { patches: [applied.envelope], error: null };
  } catch (error) {
    return { patches: [], error: serializeMvuError(error) };
  }
}

function applySessionLifecycle(session, lightFrontend, event) {
  const memory = session.memory || (session.memory = {});
  const current = normalizeMvuSnapshot(memory.lightFrontendState);
  const result = executeDeclarativeLifecycle({
    runtime: lightFrontend || {},
    event,
    currentState: current
  });
  if (result.report.status === 'applied') {
    memory.lightFrontendState = structuredClone(result.state);
  }
  memory.lightFrontendLifecycleReports = [
    ...(Array.isArray(memory.lightFrontendLifecycleReports) ? memory.lightFrontendLifecycleReports : []),
    result.report
  ].slice(-50);
  return result;
}

function serializeMvuError(error) {
  return {
    code: String(error?.code || error?.message || 'MVU_PATCH_FAILED'),
    detail: String(error?.detail || error?.message || '')
  };
}

function mergeActionEnvelopes(left, right) {
  if (!left && !right) return null;
  if (!left) return structuredClone(right);
  if (!right) return structuredClone(left);
  return {
    spec: left.spec || right.spec || 'lra.action/v1',
    id: left.id || right.id,
    actorId: right.actorId || left.actorId || 'narrator',
    summary: [left.summary, right.summary].filter(Boolean).join('；').slice(0, 240),
    baseRevision: null,
    actions: [
      ...(Array.isArray(left.actions) ? structuredClone(left.actions) : []),
      ...(Array.isArray(right.actions) ? structuredClone(right.actions) : [])
    ].slice(0, 20)
  };
}

function createHiddenBlockStreamFilter(onToken) {
  let buffer = '';
  let emitted = '';
  const emit = async (value) => {
    if (value) await onToken?.(value);
  };
  return {
    push: async (chunk) => {
      buffer += String(chunk || '');
      const visible = parseRoleplayResponse(buffer).content;
      if (visible.startsWith(emitted)) {
        await emit(visible.slice(emitted.length));
        emitted = visible;
      }
    },
    end: async () => {
      const visible = parseRoleplayResponse(buffer).content;
      if (visible.startsWith(emitted)) await emit(visible.slice(emitted.length));
      buffer = '';
      emitted = '';
    },
    // 当前已流出的可见文本（含未结束的隐藏块剥离结果），供中止时留存 partial 回合
    getVisibleText: () => emitted
  };
}

function normalizeSwipeMetadata(message, swipes) {
  const metadata = Array.isArray(message?.swipeMetadata)
    ? message.swipeMetadata.map(normalizeSwipeMetadataEntry)
    : [];
  while (metadata.length < swipes.length) metadata.push(emptySwipeMetadata());
  const activeIndex = Number(message?.activeSwipeIndex || 0);
  if (metadata[activeIndex]
    && !metadata[activeIndex].actionEnvelope
    && !metadata[activeIndex].mvuPatches?.length
    && !metadata[activeIndex].worldBookActivation
    && (message?.actionEnvelope || message?.mvuPatches?.length || message?.worldBookActivation)) {
    metadata[activeIndex] = metadataFromMessage(message);
  }
  return metadata.slice(0, swipes.length);
}

function normalizeSwipeMetadataEntry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptySwipeMetadata();
  return {
    actionEnvelope: value.actionEnvelope ? structuredClone(value.actionEnvelope) : null,
    actionError: value.actionError ? structuredClone(value.actionError) : null,
    mvuPatches: Array.isArray(value.mvuPatches) ? structuredClone(value.mvuPatches) : [],
    mvuError: value.mvuError ? structuredClone(value.mvuError) : null,
    adjudication: value.adjudication ? structuredClone(value.adjudication) : null,
    recommendedActions: Array.isArray(value.recommendedActions) ? structuredClone(value.recommendedActions) : [],
    recommendedActionOptions: Array.isArray(value.recommendedActionOptions) ? structuredClone(value.recommendedActionOptions) : [],
    recommendedActionPresentation: value.recommendedActionPresentation ? structuredClone(value.recommendedActionPresentation) : null,
    decisionNode: value.decisionNode ? structuredClone(value.decisionNode) : null,
    turnFrame: value.turnFrame ? structuredClone(value.turnFrame) : null,
    turnFrameError: value.turnFrameError ? structuredClone(value.turnFrameError) : null,
    narrativeConsistency: value.narrativeConsistency ? structuredClone(value.narrativeConsistency) : null,
    roleplayPanels: value.roleplayPanels ? structuredClone(value.roleplayPanels) : null,
    worldBookActivation: value.worldBookActivation ? structuredClone(value.worldBookActivation) : null,
    speaker: value.speaker ? String(value.speaker).slice(0, 30) : ''
  };
}

function metadataFromMessage(message) {
  return normalizeSwipeMetadataEntry({
    actionEnvelope: message?.actionEnvelope,
    actionError: message?.actionError,
    mvuPatches: message?.mvuPatches,
    mvuError: message?.mvuError,
    adjudication: message?.adjudication,
    recommendedActions: message?.recommendedActions,
    recommendedActionOptions: message?.recommendedActionOptions,
    recommendedActionPresentation: message?.recommendedActionPresentation,
    decisionNode: message?.decisionNode,
    turnFrame: message?.turnFrame,
    turnFrameError: message?.turnFrameError,
    narrativeConsistency: message?.narrativeConsistency,
    roleplayPanels: message?.roleplayPanels,
    worldBookActivation: message?.worldBookActivation,
    speaker: message?.speaker
  });
}

function emptySwipeMetadata() {
  return {
    actionEnvelope: null,
    actionError: null,
    mvuPatches: [],
    mvuError: null,
    adjudication: null,
    recommendedActions: [],
    recommendedActionOptions: [],
    recommendedActionPresentation: null,
    decisionNode: null,
    turnFrame: null,
    turnFrameError: null,
    narrativeConsistency: null,
    roleplayPanels: null,
    worldBookActivation: null,
    speaker: ''
  };
}

function applySwipeMetadata(message, metadata) {
  clearMessageWorldUpdate(message);
  const normalized = normalizeSwipeMetadataEntry(metadata);
  if (normalized.actionEnvelope) message.actionEnvelope = normalized.actionEnvelope;
  if (normalized.actionError) message.actionError = normalized.actionError;
  if (normalized.mvuPatches.length) message.mvuPatches = normalized.mvuPatches;
  if (normalized.mvuError) message.mvuError = normalized.mvuError;
  if (normalized.adjudication) message.adjudication = normalized.adjudication;
  if (normalized.recommendedActions.length) message.recommendedActions = normalized.recommendedActions;
  else delete message.recommendedActions;
  if (normalized.recommendedActionOptions.length) message.recommendedActionOptions = normalized.recommendedActionOptions;
  else delete message.recommendedActionOptions;
  if (normalized.recommendedActionPresentation) message.recommendedActionPresentation = normalized.recommendedActionPresentation;
  else delete message.recommendedActionPresentation;
  if (normalized.decisionNode) message.decisionNode = normalized.decisionNode;
  else delete message.decisionNode;
  if (normalized.turnFrame) message.turnFrame = normalized.turnFrame;
  else delete message.turnFrame;
  if (normalized.turnFrameError) message.turnFrameError = normalized.turnFrameError;
  else delete message.turnFrameError;
  if (normalized.narrativeConsistency) message.narrativeConsistency = normalized.narrativeConsistency;
  else delete message.narrativeConsistency;
  if (normalized.roleplayPanels) message.roleplayPanels = normalized.roleplayPanels;
  if (normalized.worldBookActivation) message.worldBookActivation = normalized.worldBookActivation;
  if (normalized.speaker) message.speaker = normalized.speaker;
}

function clearMessageWorldUpdate(message) {
  delete message.actionEnvelope;
  delete message.actionError;
  delete message.mvuPatches;
  delete message.mvuError;
  delete message.adjudication;
  delete message.recommendedActionOptions;
  delete message.recommendedActionPresentation;
  delete message.decisionNode;
  delete message.turnFrame;
  delete message.turnFrameError;
  delete message.narrativeConsistency;
  delete message.roleplayPanels;
  delete message.worldBookActivation;
  delete message.speaker;
}

function buildContinuationRetrievalQuery(messages, fallback = '') {
  const source = Array.isArray(messages) ? messages : [];
  const latestUser = findLatestMeaningfulUserMessage(source);
  const latestAssistant = [...source].reverse().find((message) => (
    String(message?.role || '').toLowerCase() === 'assistant'
    && String(message?.content || '').trim()
  ));
  return [latestUser?.content, latestAssistant?.content]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join('\n\n') || String(fallback || '').trim();
}

function resolveRecommendationPlan(modelActions, memory, {
  userMessage,
  assistantContent,
  recentMessages = [],
  generationType = 'normal',
  roleplayMode = 'dm',
  characterCard = null,
  groupMembers = [],
  turnFrame = null,
  recommendationSource = ''
} = {}) {
  const resolved = Array.isArray(modelActions)
    ? modelActions.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  const userText = String(userMessage?.content || userMessage || '').trim();
  if (/(?:不要|无需|不需要).{0,8}(?:选项|建议|行动卡)/u.test(userText)) return emptyRecommendationPlan(resolved);
  if (String(roleplayMode || 'dm') === 'commentary' && generationType !== 'continue') return emptyRecommendationPlan(resolved);
  const authoredActions = resolved
    .filter((action) => !/^\s*(?:选项|行动)?\s*4?\s*[:：.、)）-]?\s*自定义(?:行动|回答|输入)?[。.!！]?\s*$/u.test(action))
    .slice(0, 3);
  // 模型、角色卡与社区预设给出的选项拥有候选优先级，但不能绕过当前决策
  // 节点、世界有效性、跨回合语义去重和策略多样性。所有来源统一进入 Planner，
  // 避免同一套模板只替换名词后在连续回合反复出现。
  const planned = planRecommendedActions({
    modelActions: authoredActions,
    assistantContent,
    recentMessages,
    memory,
    userMessage,
    characterCard,
    groupMembers,
    turnFrame,
    allowUngroundedModelActions: /^community-(?:choice|action)-block$/u.test(recommendationSource),
    maxActions: 3
  });
  if (!Array.isArray(planned.actions) || planned.actions.length < 2) return emptyRecommendationPlan();
  return {
    ...planned,
    presentation: {
      source: recommendationSource || (authoredActions.length >= 2 ? 'model-recommended-actions' : 'grounded-decision-fallback'),
      title: resolveFallbackActionTitle(recentMessages),
      hint: ''
    }
  };
}

function resolveFallbackActionTitle(recentMessages = []) {
  const declaresTianjiChoices = (Array.isArray(recentMessages) ? recentMessages : [])
    .some((message) => /(?:天机选项|天机抉择)/u.test(String(message?.content || '')));
  return declaresTianjiChoices ? '天机选项' : '下一步行动';
}

function emptyRecommendationPlan(actions = [], presentation = null) {
  return {
    actions: Array.isArray(actions) ? actions : [],
    actionOptions: [],
    decision: null,
    presentation
  };
}

function recordPromptRuntime(session, assembled = {}) {
  if (!session || !isPlainObject(assembled?.sections)) return;
  const integrity = assembled.sections.communityPresetIntegrity || {};
  const suppressed = [
    ...(Array.isArray(integrity.preflightSuppressed) ? integrity.preflightSuppressed : []),
    ...(Array.isArray(integrity.finalSuppressed) ? integrity.finalSuppressed : [])
  ].filter((item) => item?.suppressed || item?.key);
  session.memory = isPlainObject(session.memory) ? session.memory : {};
  session.memory.promptRuntime = {
    updatedAt: new Date().toISOString(),
    tokenEstimate: Number(assembled.tokenEstimate || 0),
    retainedPromptModuleIds: Array.isArray(assembled.sections.retainedPromptModuleIds)
      ? [...assembled.sections.retainedPromptModuleIds] : [],
    omittedPromptModuleIds: Array.isArray(assembled.sections.omittedPromptModuleIds)
      ? [...assembled.sections.omittedPromptModuleIds] : [],
    communityPresetIntegrity: {
      status: suppressed.length ? 'suppressed-for-integrity' : 'complete',
      suppressedBundles: suppressed.map((item) => ({
        title: String(item.title || '社区预设'),
        reason: String(item.reason || '完整性保护')
      }))
    }
  };
}

function isJourneySetupContent(content) {
  return /^\s*\[\s*命途设定\s*[：:]?/u.test(String(content || ''));
}

function extractRecommendedActions(rawContent) {
  const content = String(rawContent || '');
  const matches = Array.from(content.matchAll(/<recommended_actions\b[^>]*>\s*([\s\S]*?)\s*<\/recommended_actions\s*>/ig));
  const taggedActions = matches.flatMap((match) => parseRecommendedActions(match[1]));
  let cleanContent = content.replace(/<recommended_actions\b[^>]*>[\s\S]*?<\/recommended_actions\s*>/ig, '\n').trim();
  const legacyChoices = extractLegacyRecommendedActions(cleanContent);
  cleanContent = legacyChoices.content;
  const speakerMatch = cleanContent.match(/^【([^】]+)】\s*/);
  if (speakerMatch) {
    cleanContent = cleanContent.slice(speakerMatch[0].length).trim();
  }
  return {
    content: cleanContent,
    recommendedActions: sanitizeRecommendedActions([...taggedActions, ...legacyChoices.actions]),
    recommendedActionPresentation: legacyChoices.presentation
      || (taggedActions.length >= 2
        ? { source: 'model-recommended-actions', title: '', hint: '' }
        : null)
  };
}

function extractSpeaker(rawContent) {
  const content = String(rawContent || '').trim();
  const match = content.match(/^【([^】]+)】\s*/);
  return match ? match[1].trim().slice(0, 30) : '';
}

function parseRecommendedActions(value) {
  try {
    const parsed = JSON.parse(String(value || '').trim());
    if (!Array.isArray(parsed)) return [];
    return sanitizeRecommendedActions(parsed);
  } catch {
    return sanitizeRecommendedActions(String(value || '')
      .split('\n')
      .map((line) => line.replace(/^[-*\d.、\s]+/, '').trim()));
  }
}

function extractLegacyRecommendedActions(source) {
  const lines = String(source || '').split(/\r?\n/);
  const headingPattern = /^\s*(?:>\s*)?[【\[]\s*(?:(?:天机|互动|剧情|行动|抉择|下一步)\s*)?(?:选项|行动)\s*(?:[：:][^】\]]*)?[】\]]\s*$/u;
  const optionPattern = /^\s*(?:[-*•·]\s*)?(?:(?:选项|行动)\s*)?(?:[A-FＡ-Ｆ]|\d{1,2})\s*(?:[:：.、)）-]\s*)(.+?)\s*$/iu;
  const modelHeadingPattern = /^\s*(?:#{1,6}\s*)?(?:\*\*|__)?\s*推荐(?:动作|行动|选项)\s*(?:[（(][^）)]{0,80}[）)])?\s*(?:\*\*|__)?\s*[：:]?\s*$/u;
  const modelOptionPattern = /^\s*[-*•·]\s+(.+?)\s*$/u;
  const headingIndex = lines.findIndex((line) => headingPattern.test(line) || modelHeadingPattern.test(line));
  if (headingIndex < 0) return { content: String(source || ''), actions: [], presentation: null };
  const modelRecommendation = modelHeadingPattern.test(lines[headingIndex]);

  const actions = [];
  let cursor = headingIndex + 1;
  while (cursor < lines.length) {
    const line = lines[cursor];
    if (!line.trim()) {
      cursor += 1;
      continue;
    }
    const match = line.match(optionPattern)
      || line.match(modelOptionPattern);
    if (!match) break;
    actions.push(match[1]);
    cursor += 1;
  }

  const normalizedActions = sanitizeRecommendedActions(actions);
  if (normalizedActions.length < 2) return { content: String(source || ''), actions: [], presentation: null };
  let blockStart = headingIndex;
  while (blockStart > 0 && !lines[blockStart - 1].trim()) blockStart -= 1;
  if (blockStart > 0 && /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/u.test(lines[blockStart - 1])) blockStart -= 1;
  return {
    content: [...lines.slice(0, blockStart), ...lines.slice(cursor)]
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
    actions: normalizedActions,
    presentation: modelRecommendation
      ? { source: 'model-recommendation-block', title: '', hint: '' }
      : parseLegacyChoicePresentation(lines[headingIndex])
  };
}

function parseLegacyChoicePresentation(line) {
  const heading = String(line || '').replace(/^\s*>\s*/u, '').trim();
  const inner = heading.replace(/^[【\[]\s*/u, '').replace(/\s*[】\]]$/u, '').trim();
  const separator = inner.search(/[：:]/u);
  const rawTitle = (separator >= 0 ? inner.slice(0, separator) : inner).trim();
  const hint = separator >= 0 ? inner.slice(separator + 1).trim() : '';
  return {
    source: 'community-choice-block',
    title: rawTitle || '天机选项',
    hint
  };
}

function sanitizeRecommendedActions(values = []) {
  const protocolLeak = /(?:<\/?(?:think|analysis|plot|normal_status|relationship_status|special_status|NextCharacterPanel|recommended_actions)\b|recommended_actions|Ira-actions|正文前(?:注释|格式)|天机选项块|step\s*\d+|--?>|《end》|<\/think>)/i;
  const instructionLeak = /(?:如果稳定变化需要输出|结束需要|输出格式|格式为|正文前|正文后|以下标签|x\s*3)/i;
  const actions = Array.from(new Set((Array.isArray(values) ? values : [values])
    .map((item) => String(item || '').replace(/\s+/g, ' ').trim())
    .filter((item) => item.length >= 2 && item.length <= 120)
    .filter((item) => !protocolLeak.test(item) && !instructionLeak.test(item))
    .filter((item) => !/^[;；<>{}\[\]()\/\\|=_-]+/.test(item))
    .filter((item) => /[\p{L}\p{N}]/u.test(item))));
  return actions.length >= 2 ? actions.slice(0, 4) : [];
}

function buildCanonicalSourceDigest(config, messages, maxChars = 6500) {
  const activeConfig = config && typeof config === 'object' ? config : {};
  const character = activeConfig.characterCard && typeof activeConfig.characterCard === 'object'
    ? activeConfig.characterCard
    : {};
  const transcript = (Array.isArray(messages) ? messages : [])
    .map((message) => String(message?.content || ''))
    .join('\n')
    .slice(-14000);
  const characterDigest = [
    character.name ? `名称：${character.name}` : '',
    character.role ? `身份：${character.role}` : '',
    character.description ? `描述：${String(character.description).slice(0, 1500)}` : '',
    character.personality ? `性格：${String(character.personality).slice(0, 900)}` : '',
    character.scenario ? `场景：${String(character.scenario).slice(0, 1200)}` : '',
    character.firstMessage ? `开场：${String(character.firstMessage).slice(0, 1000)}` : ''
  ].filter(Boolean).join('\n');
  const worldBook = (Array.isArray(activeConfig.worldBook) ? activeConfig.worldBook : [])
    .filter((entry) => entry && entry.enabled !== false)
    .map((entry, index) => ({
      entry,
      index,
      score: scoreCanonicalWorldBookEntry(entry, transcript)
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, 12)
    .map(({ entry }) => {
      const title = String(entry.title || entry.name || '未命名世界书条目').trim();
      return `【${title}】${String(entry.content || '').trim().slice(0, 850)}`;
    });
  return [`【角色卡】\n${characterDigest}`, worldBook.length ? `【已启用世界书摘录】\n${worldBook.join('\n')}` : '']
    .filter(Boolean)
    .join('\n\n')
    .slice(0, maxChars);
}

function scoreCanonicalWorldBookEntry(entry, transcript) {
  const keywords = [
    entry?.title,
    ...(Array.isArray(entry?.keywords) ? entry.keywords : []),
    ...(Array.isArray(entry?.secondaryKeywords) ? entry.secondaryKeywords : [])
  ].map((value) => String(value || '').trim()).filter((value) => value.length >= 2);
  const matchScore = keywords.reduce(
    (score, keyword) => score + (transcript.includes(keyword) ? 400 : 0),
    0
  );
  return matchScore + (entry?.constant ? 180 : 0) + Number(entry?.priority || 0);
}

function chunkText(text) {
  const value = String(text || '');
  const chunks = value.match(/[\s\S]{1,24}/g);
  return chunks || [];
}
