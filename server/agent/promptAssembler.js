import { renderAgreementGuard } from './agreementGuard.js';
import { resolveProtagonistIdentity, replaceProtagonistPlaceholders, renderProtagonistIdentity } from './protagonistIdentity.js';
import { buildSceneContinuity, renderSceneContinuity, renderExplicitTurnBoundary } from './sceneContinuity.js';
import { inspectNarrativeQuality, renderQualityGuidance } from './narrativeQuality.js';
import { inspectSourceConflicts } from './sourceConflicts.js';
import { adaptPacingToCard } from './pacingCompatibility.js';
import { resolveNarrationPerspective, renderNarrationPerspective, inspectNarrationDrift } from './narrationPerspective.js';
import { resolveEnhancements } from './enhancements.js';
import { createPromptChangeRecorder } from './promptChanges.js';
import { resolvePromptExecutionMode, renderFaithfulCharacter, faithfulControlPrompt, renderSourceExecutionPriority, enforceFaithfulPromptBudget, compactFaithfulMemory, budgetWholeWorldBookEntries } from './faithfulPrompt.js';
import { buildGraphContextForActivation } from '../memory/graphGuidedRetrieval.js';
import {
  collectWorldBookCharacterNames,
  resolveCharacterContentMode
} from '../character/characterContentMode.js';

import { estimateTokens } from './token.js';
import { buildResponseContractPrompt, normalizeResponseLengthMode } from './responseContract.js';
import { normalizeFactCards } from './factCards.js';
import {
  activateWorldBookEntries,
  finalizeWorldBookActivation
} from './worldBookActivator.js';
import { expandMacros } from './macroEngine.js';
import { buildNarrativeControlPrompt, resolveNarrativeContext } from './narrativeControl.js';
import { buildPsychologicalProgressionPrompt } from './psychologicalProgression.js';
import { buildRoleplayModePrompt, normalizeRoleplayMode } from './roleplayMode.js';
import {
  buildCompactCastIndex,
  buildInteractionControlPrompt
} from './interactionContract.js';
import { buildActionProtocolPrompt } from '../simulation/actionProtocol.js';
import { renderSimulationPrompt } from '../simulation/npcSimulation.js';
import { renderCardRuntimePrompt } from './cardRuntime.js';
import { buildAgentProfilePrompt, normalizeAgentProfileId } from '../authoring/agentProfiles.js';
import { renderAuthoringLedgerPrompt } from '../authoring/authoringLedger.js';
import { buildNarrativeEnsemblePrompt } from './narrativeEnsemble.js';
import {
  buildSceneAffordanceSnapshot,
  renderSceneAffordancePrompt
} from './sceneAffordancePlanner.js';
import { buildMvuPatchPrompt } from '../compat/mvuProtocol.js';
import { applyPromptTransforms } from '../compat/lightFrontendRuntime.js';
import { applyConditionalDirectives } from '../compat/conditionalDirective.js';
import {
  filterNarrativeContextMessages,
  renderNarrativeHardFactsPrompt,
  renderNarrativeRepairPrompt
} from '../memory/narrativeRepair.js';
import {
  budgetWorldBookEntries,
  compareWorldBookBudgetPriority,
  compilePlayableWorldBook
} from '../resources/playableResourceCompiler.js';
import {
  compactWorldStateForPrompt,
  compilePromptModulesForRuntime,
  enforcePromptMessageBudget,
  limitTextToTokenBudget,
  promptModuleRuntimePriority,
  selectRecentMessagesForPrompt
} from './promptBudget.js';
import {
  describeWorldBookPositionCompatibility,
  normalizeWorldBookPosition
} from './worldBookPosition.js';

export function assemblePrompt({
  promptModules,
  characterCard,
  worldBook,
  memory,
  authoring,
  messages,
  userMessage,
  persona,
  groupMembers,
  targetSpeaker,
  templates,
  customArrays,
  vectorHits,
  memoryContext,
  lightFrontend,
  activationContext = {},
  options = {}
}) {
  const safePromptModules = Array.isArray(promptModules) ? promptModules : [];
  const executionMode = resolvePromptExecutionMode(options, characterCard, safePromptModules);
  const faithful = executionMode === 'faithful';
  const preserveSources = faithful || resolvePromptExecutionMode({ promptExecutionMode: 'auto' }, characterCard, safePromptModules) === 'faithful';
  const enhancements = resolveEnhancements(options, executionMode);
  const changes = createPromptChangeRecorder(options.inspectPromptChanges === true);
  if (!enhancements.memoryRecall) { memoryContext = null; vectorHits = []; }
  const budgetEntries = preserveSources ? budgetWholeWorldBookEntries : budgetWorldBookEntries;
  const sourceWorldBook = Array.isArray(worldBook) ? worldBook : [];
  const requestedPromptTokens = Number(options.maxPromptTokens);
  const maxPromptTokens = Number.isFinite(requestedPromptTokens) && requestedPromptTokens > 0
    ? Math.floor(requestedPromptTokens)
    : null;
  const playableWorldBook = compilePlayableWorldBook(sourceWorldBook);
  // 应用 @@if 条件指令：根据当前 MVU 状态过滤条件为假的世界书条目，剥离 @@if 前缀
  const conditionalResult = applyConditionalDirectives(playableWorldBook.entries, memory?.lightFrontendState || {});
  const safeWorldBook = conditionalResult.entries;
  const characterContentMode = resolveCharacterContentMode(characterCard, safeWorldBook);
  const safeMessages = filterNarrativeContextMessages(messages, memory);
  const promptUserName = resolvePromptUserName(persona, memory);
  const promptCharacterName = resolvePromptCharacterName(characterCard, memory, characterContentMode);
  const recentPairs = Number(options.recentPairs ?? 8);
  const maxInjectedCards = Number(options.maxInjectedCards ?? 15);
  const maxRecursionDepth = Number(options.maxRecursionDepth ?? 1);
  const memoryCards = normalizeFactCards(enhancements.memoryRecall && Array.isArray(memory?.memoryCards) ? memory.memoryCards : []);
  const staticGraphTerms = enhancements.memoryRecall ? buildWorldBookActivationTerms(memory, targetSpeaker) : '';
  const queryGraphTerms = buildGraphContextForActivation(memoryContext?.graphExpansion);
  const worldBookActivationTerms = [staticGraphTerms, queryGraphTerms].filter(Boolean).join('\n');
  const worldBookActivation = activateWorldBookEntries({
    worldBook: safeWorldBook,
    memoryCards,
    messages: safeMessages,
    userMessage,
    maxCards: maxInjectedCards,
    maxRecursionDepth,
    defaultScanDepth: Number(options.worldBookScanDepth ?? recentPairs * 2),
    minActivations: Number(options.worldBookMinActivations ?? 0),
    minActivationsDepthMax: Number(options.worldBookMinActivationsDepthMax ?? 0),
    includeNames: options.worldBookIncludeNames !== false,
    caseSensitive: options.worldBookCaseSensitive === true,
    matchWholeWords: options.worldBookMatchWholeWords === true,
    userName: promptUserName,
    characterName: promptCharacterName,
    generationType: activationContext.generationType,
    characterCard,
    persona,
    groupMembers,
    targetSpeaker,
    additionalScanText: worldBookActivationTerms,
    seed: activationContext.seed ?? options.worldBookActivationSeed ?? ''
  });
  const activeCards = worldBookActivation.entries;
  // 常驻条目按作者声明的优先级与插入顺序进入预算，不能让导入数组的偶然顺序
  // 抢占世界法则、世界观等更靠前的事实源。
  const constantCards = activeCards
    .filter((card) => card.constant === true)
    .sort(compareWorldBookBudgetPriority);
  const triggeredCards = activeCards.filter((card) => card.constant !== true);
  // 用户显式配置优先；否则回退到角色卡 character_book.token_budget（SillyTavern V2 规范），
  // 让卡片作者声明的世界书预算生效；最后才使用系统默认 6000。
  const cardWorldBookBudget = resolveCardWorldBookTokenBudget(characterCard);
  const requestedWorldBookTokens = Number(
    options.maxWorldBookTokens ?? cardWorldBookBudget ?? 6000
  );
  const totalWorldBookCap = !preserveSources && maxPromptTokens ? Math.max(600, Math.floor(maxPromptTokens * 0.3)) : null;
  const configuredWorldBookTokens = Number.isFinite(requestedWorldBookTokens) && requestedWorldBookTokens > 0
    ? Math.floor(requestedWorldBookTokens)
    : 6000;
  const faithfulWorldBookTokens = preserveSources && options.maxWorldBookTokens == null && cardWorldBookBudget == null
    ? Math.max(1, activeCards.reduce((sum, card) => sum + estimateTokens(String(card.content || '')), 0)) : null;
  const maxWorldBookTokens = faithfulWorldBookTokens ?? (totalWorldBookCap
    ? Math.min(configuredWorldBookTokens, totalWorldBookCap)
    : configuredWorldBookTokens);
  const coreConstantCards = constantCards.filter(isCoreWorldBookAnchor);
  const supplementalConstantCards = constantCards.filter((card) => !isCoreWorldBookAnchor(card));
  const constantEntryTokens = Number(
    options.maxConstantWorldBookEntryTokens ?? Math.max(240, Math.floor(maxWorldBookTokens * 0.23))
  );
  const triggeredReserve = !preserveSources && triggeredCards.length
    ? Math.max(1, Math.floor(maxWorldBookTokens * 0.45))
    : 0;
  const coreConstantCap = preserveSources ? maxWorldBookTokens : Math.max(
    1,
    Math.min(Math.floor(maxWorldBookTokens * 0.65), maxWorldBookTokens - triggeredReserve)
  );
  // A card's world model and protagonist constraints must survive before
  // presentation/style entries. Community books frequently mark everything as
  // constant with the same priority, so array order cannot decide this.
  const coreConstantBudget = budgetEntries(coreConstantCards, {
    maxTokens: coreConstantCap,
    maxEntryTokens: constantEntryTokens
  });
  const supplementalConstantCap = Math.max(
    0,
    maxWorldBookTokens - coreConstantBudget.report.usedTokens - triggeredReserve
  );
  const supplementalConstantBudget = supplementalConstantCap > 0
    ? budgetEntries(supplementalConstantCards, {
      maxTokens: supplementalConstantCap,
      maxEntryTokens: constantEntryTokens
    })
    : emptyWorldBookBudget(supplementalConstantCards, constantEntryTokens);
  const constantBudget = {
    entries: [...coreConstantBudget.entries, ...supplementalConstantBudget.entries],
    report: {
      maxTokens: maxWorldBookTokens,
      maxEntryTokens: constantEntryTokens,
      usedTokens: coreConstantBudget.report.usedTokens + supplementalConstantBudget.report.usedTokens,
      selectedCount: coreConstantBudget.report.selectedCount + supplementalConstantBudget.report.selectedCount,
      omittedCount: coreConstantBudget.report.omittedCount + supplementalConstantBudget.report.omittedCount,
      omittedIds: [...coreConstantBudget.report.omittedIds, ...supplementalConstantBudget.report.omittedIds],
      truncatedCount: coreConstantBudget.report.truncatedCount + supplementalConstantBudget.report.truncatedCount,
      core: coreConstantBudget.report,
      supplemental: supplementalConstantBudget.report
    }
  };
  const triggeredBudget = budgetEntries(triggeredCards, {
    maxTokens: Math.max(1, maxWorldBookTokens - constantBudget.report.usedTokens),
    maxEntryTokens: Number(options.maxWorldBookEntryTokens ?? Math.max(320, Math.floor(maxWorldBookTokens * 0.3)))
  });
  const worldBookAnchorKeys = new Set([
    ...triggeredBudget.entries,
    ...constantBudget.entries
  ].map(worldBookCardKey));
  // 本轮直接/递归触发的条目优先于常驻背景进入最终预算，避免角色条目被整组背景挤出。
  const injectedCards = [...triggeredBudget.entries, ...constantBudget.entries];
  const worldBookBudget = {
    maxTokens: maxWorldBookTokens,
    usedTokens: constantBudget.report.usedTokens + triggeredBudget.report.usedTokens,
    constant: constantBudget.report,
    triggered: triggeredBudget.report,
    playableCompilation: playableWorldBook.report
  };
  const renderablePromptModules = getRenderablePromptModules(safePromptModules)
    .sort(comparePromptModuleSequence);
  const hasCommunityPresetBundle = renderablePromptModules.some((module) => (
    Boolean(module?.extensions?.sillyTavernPreset?.presetTitle)
  ));
  const promptModuleBudget = !preserveSources && maxPromptTokens
    ? Math.max(800, Math.floor(maxPromptTokens * 0.3))
    : null;
  const preflightCommunityBundles = inspectCommunityPresetBundles(renderablePromptModules, {
    maxModules: !preserveSources && hasCommunityPresetBundle ? Number(options.maxCommunityPromptModules ?? 18) : null,
    maxTokens: promptModuleBudget
  });
  const suppressedCommunityBundleKeys = new Set(preflightCommunityBundles
    .filter((bundle) => bundle.suppressed)
    .map((bundle) => bundle.key));
  // 完整性检查必须先于模块选择。否则一个注定不能完整运行的社区预设会先
  // 抢占模块/令牌名额，再被过滤掉，导致合法模块没有机会进入最终请求。
  const eligiblePromptModules = renderablePromptModules
    .filter((module) => !suppressedCommunityBundleKeys.has(communityPresetBundleKey(module)));
  const runtimeCommunityCompilation = compilePromptModulesWithBundleIntegrity(eligiblePromptModules, {
    preserveSourceModules: preserveSources,
    worldBook: safeWorldBook,
    maxTokens: promptModuleBudget,
    maxModules: !preserveSources && hasCommunityPresetBundle
      ? Number(options.maxCommunityPromptModules ?? 18)
      : null
  });
  const promptModuleCompilation = runtimeCommunityCompilation.compilation;
  const renderedPromptModules = promptModuleCompilation.modules;
  for (const source of safePromptModules) {
    const compiled = renderedPromptModules.find(m => m.id === source.id);
    changes.record('预设筛选与编译', source.name || source.id, source.content, compiled?.content || '', compiled ? '' : '未进入宏展开：检查开关、完整性和预算状态。');
  }
  for (const source of sourceWorldBook) {
    const selected = injectedCards.find(card => card.id === source.id);
    changes.record('世界书激活与预算', source.title || source.id, source.content, selected?.content || '', selected ? '本轮选中' : '本轮未选中；不代表资源被删除。');
  }
  const communityPresetBundles = [
    ...preflightCommunityBundles,
    ...runtimeCommunityCompilation.suppressedBundles
  ];
  const coherentCommunityBundleKeys = new Set(communityPresetBundles
    .filter((bundle) => bundle.coherenceSensitive)
    .map((bundle) => bundle.key));
  const narrativeContext = resolveNarrativeContext({ memory, mode: options.narrativeMode });
  const narrativeControlPrompt = buildNarrativeControlPrompt({ memory, mode: narrativeContext.mode });
  const narrativeEnsemble = buildNarrativeEnsemblePrompt({
    memory,
    messages: safeMessages,
    userMessage
  });
  const roleplayMode = normalizeRoleplayMode(options.roleplayMode);
  const roleplayModePrompt = buildRoleplayModePrompt(roleplayMode);
  const interactionControl = buildInteractionControlPrompt({
    roleplayMode,
    generationType: activationContext.generationType,
    promptModules: renderedPromptModules,
    messages: safeMessages
  });
  const rawSimulationPrompt = renderSimulationPrompt(memory, { targetSpeaker });
  const simulationPrompt = maxPromptTokens
    ? limitTextToTokenBudget(rawSimulationPrompt, Math.max(480, Math.floor(maxPromptTokens * 0.14)))
    : rawSimulationPrompt;
  const rawCardRuntimePrompt = renderCardRuntimePrompt(memory);
  const cardRuntimePrompt = maxPromptTokens
    ? limitTextToTokenBudget(rawCardRuntimePrompt, Math.max(180, Math.floor(maxPromptTokens * 0.06)))
    : rawCardRuntimePrompt;
  const actionProtocolPrompt = buildActionProtocolPrompt({ memory, targetSpeaker });
  const mvuPatchPrompt = buildMvuPatchPrompt({ memory });
  const agentProfileId = normalizeAgentProfileId(options.activeAgentProfileId);
  const agentProfilePrompt = buildAgentProfilePrompt(agentProfileId);
  const authoringLedgerPrompt = renderAuthoringLedgerPrompt(authoring);
  const defaultPromptLayer = renderDefaultPromptLayerContract({
    characterCard,
    worldBook: safeWorldBook,
    roleplayMode,
    contentMode: characterContentMode,
    protagonistName: memory?.worldState?.protagonist?.name
  });
  const closedLoopPrompt = renderSolvedQuestionClosurePrompt(memory);

  // 宏展开上下文
  const promptVariables = {};
  const promptVariableAudit = [];
  const macroContext = {
    user: promptUserName,
    characterCard,
    persona,
    groupMembers,
    messages: safeMessages,
    userMessage,
    worldBook: safeWorldBook,
    templates,
    customArrays,
    lightFrontendState: memory?.lightFrontendState || {},
    messageVariables: memory?.messageVariables || {},
    promptVariables,
    originalSystemPrompt: faithful ? faithfulControlPrompt(roleplayMode) : defaultPromptLayer || ''
  };
  const regexContext = {
    user: macroContext.user,
    char: characterCard?.name || '',
    characterCard,
    persona,
    lightFrontendState: macroContext.lightFrontendState
  };
  const regexTransforms = Array.isArray(lightFrontend?.regexTransforms)
    ? lightFrontend.regexTransforms
    : [];

  // SillyTavern 预设中的 setvar/getvar 在本轮临时作用域内按顺序执行；不持久化、不执行脚本。
  const expandedPromptModules = [...renderedPromptModules]
    .sort(comparePromptModuleSequence)
    .map((module) => ({
      ...module,
      content: changes.record('宏展开', `预设：${module.name || module.id}`, module.content, expandMacros(
        options.resolvePacingConflicts === false ? module.content : changes.record('原卡节奏适配', `节奏规则：${module.name || module.id}`, module.content, adaptPacingToCard(module.content, characterCard)), {
        ...macroContext,
        allowVariableWrites: true,
        promptVariableAudit
      }))
    }))
    // setvar/trim/comment-only modules still participate in the ordered macro pass,
    // but after they have written their temporary values they must not become empty
    // provider messages or consume one of the final prompt placements.
    .filter((module) => String(module.content || '').trim());
  const narrationPerspective = resolveNarrationPerspective(expandedPromptModules);
  const promptPlacement = organizePromptModules(expandedPromptModules);

  const cardsByDepth = new Map();
  injectedCards.forEach((card) => {
    const pos = normalizeWorldBookPosition(card.position);
    // `position` 决定世界书的插入语义；只有 at_depth/in_chat 条目才允许
    // depth 进入对话历史。为兼容旧的本地世界书，未声明 position 但声明了
    // depth 的条目仍按历史深度处理。Author's Note Bottom（数值 3）属于
    // after_character，不能因为数值形式被错误塞进历史。
    const hasExplicitPosition = card.position !== undefined && card.position !== null && String(card.position).trim() !== '';
    const useHistoryDepth = pos === 'at_depth'
      || (!hasExplicitPosition && Number(card.depth ?? card.scanDepth ?? card.scan_depth) > 0);
    const depth = useHistoryDepth
      ? normalizeDepth(card.depth ?? card.scanDepth ?? card.scan_depth)
      : 0;
    const depthKey = useHistoryDepth ? `depth:${depth}` : 0;
    if (!cardsByDepth.has(depthKey)) cardsByDepth.set(depthKey, []);
    // 对世界书条目内容展开宏
    cardsByDepth.get(depthKey).push({ ...card, content: changes.record('宏展开', `世界书：${card.title}`, card.content, expandMacros(card.content, macroContext)) });
  });

  const topCards = cardsByDepth.get(0) || [];
  cardsByDepth.delete(0);

  // SillyTavern position 语义：
  // - before_character: 角色卡之前渲染（合并进 core-system 前段）
  // - after_character: 角色卡之后渲染（默认独立常驻世界书）
  // - before_eff: 扩展模块/预设提示词之前渲染
  // - after_eff: 扩展模块/预设提示词之后渲染
  const beforeCharCards = topCards.filter((card) => normalizeWorldBookPosition(card.position) === 'before_character');
  const beforeEffCards = topCards.filter((card) => normalizeWorldBookPosition(card.position) === 'before_eff');
  const afterEffCards = topCards.filter((card) => normalizeWorldBookPosition(card.position) === 'after_eff');
  const afterCharCards = topCards.filter((card) => {
    const pos = normalizeWorldBookPosition(card.position);
    return pos !== 'before_character' && pos !== 'before_eff' && pos !== 'after_eff';
  });

  const beforeCharCardsText = beforeCharCards.length
    ? ['# 世界书（角色定义前）', ...beforeCharCards.map(c => `## ${c.title}\n${c.content}`)].join('\n\n')
    : '';
  const topCardsText = afterCharCards.length
    ? ['# 常驻世界书和记忆', ...afterCharCards.map(c => `## ${c.title}\n${c.content}`)].join('\n\n')
    : '';
  const beforeEffCardsText = beforeEffCards.length
    ? ['# 世界书（扩展效果前）', ...beforeEffCards.map(c => `## ${c.title}\n${c.content}`)].join('\n\n')
    : '';
  const afterEffCardsText = afterEffCards.length
    ? ['# 世界书（扩展效果后）', ...afterEffCards.map(c => `## ${c.title}\n${c.content}`)].join('\n\n')
    : '';

  // 对角色卡展开宏；可读取本轮预设已声明的临时变量。
  const expandedCharacterCard = expandCharacterCard(characterCard, macroContext);
  for (const key of ['name', 'description', 'personality', 'scenario', 'systemPrompt', 'postHistoryInstructions', 'exampleDialog']) {
    changes.record('宏展开', `角色卡：${key}`, JSON.stringify(characterCard?.[key] ?? ''), JSON.stringify(expandedCharacterCard?.[key] ?? ''));
  }
  const expandedPersona = expandPersona(persona, macroContext);
  const expandedGroupMembers = expandGroupMembers(groupMembers, macroContext);
  const castIndex = buildCompactCastIndex({
    characterCard: expandedCharacterCard,
    protagonist: memory?.worldState?.protagonist,
    groupMembers: expandedGroupMembers,
    worldBook: safeWorldBook,
    contentMode: characterContentMode,
    maxCharacters: Number(options.maxCastIndexCharacters ?? 16)
  });
  const psychologicalProgression = buildPsychologicalProgressionPrompt({
    characterCard: expandedCharacterCard,
    activeCards: injectedCards,
    memory
  });
  const worldStateCompilation = compactWorldStateForPrompt(memory?.worldState, {
    maxTokens: maxPromptTokens ? Math.max(320, Math.floor(maxPromptTokens * 0.09)) : null
  });
  const rollingSummary = maxPromptTokens
    ? limitTextToTokenBudget(memory?.rollingSummary, Math.max(160, Math.floor(maxPromptTokens * 0.05)))
    : memory?.rollingSummary;

  const coreSystemSections = faithful ? [faithfulControlPrompt(roleplayMode), beforeCharCardsText].filter(Boolean) : [
    defaultPromptLayer,
    !preserveSources && enhancements.plotGuidance ? narrativeControlPrompt : '',
    roleplayModePrompt,
    !preserveSources && enhancements.plotGuidance ? agentProfilePrompt : '',
    !preserveSources && enhancements.plotGuidance ? authoringLedgerPrompt : '',
    beforeCharCardsText
  ].filter(Boolean);

  const characterAnchorSections = preserveSources ? [renderFaithfulCharacter(expandedCharacterCard, { includeExamples: false, includeOpening: safeMessages.length === 0, contentMode: characterContentMode }), renderGroupMembers(expandedGroupMembers), renderPersona(expandedPersona), enhancements.memoryRecall ? renderCoreMemory(memory?.episodicMemory?.coreMemory || memory?.coreMemory) : ''].filter(Boolean) : [
    limitTextToTokenBudget(
      renderCharacterCard(expandedCharacterCard, {
        includeOpening: safeMessages.length === 0,
        contentMode: characterContentMode
      }),
      maxPromptTokens ? Math.max(480, Math.floor(maxPromptTokens * 0.14)) : null
    ),
    renderGroupMembers(expandedGroupMembers),
    renderPersona(expandedPersona),
    enhancements.memoryRecall ? renderCoreMemory(memory?.episodicMemory?.coreMemory || memory?.coreMemory) : '',
    renderCharacterPerformanceContract(expandedCharacterCard, expandedGroupMembers, {
      contentMode: characterContentMode,
      activeCards: injectedCards
    })
  ].filter(Boolean);

  const dynamicContextTailSections = !enhancements.memoryRecall ? [] : faithful ? [compactFaithfulMemory([renderWorldState(worldStateCompilation.worldState), renderRollingSummary(rollingSummary), renderNarrativeHardFactsPrompt(memory), renderEpisodicMemory(memoryContext), renderVectorMemory(vectorHits)])].filter(Boolean) : [
    renderWorldState(worldStateCompilation.worldState),
    renderNarrativeRepairPrompt(memory),
    closedLoopPrompt,
    limitTextToTokenBudget(renderKnowledgeGraph(memory?.knowledgeGraph, memoryContext?.graphExpansion), maxPromptTokens ? 320 : null),
    renderRollingSummary(rollingSummary),
    limitTextToTokenBudget(renderEpisodicMemory(memoryContext), maxPromptTokens ? 480 : null),
    renderVectorMemory(vectorHits),
    enhancements.npcSimulation ? simulationPrompt : '',
    cardRuntimePrompt
  ].filter(Boolean);

  if (enhancements.npcSimulation && (faithful || !enhancements.memoryRecall) && options.agentEnhancements?.npcSimulation === true) dynamicContextTailSections.push(simulationPrompt);

  const interactionProtocolSections = faithful ? [] : [
    renderSpeakerInstruction({ groupMembers, targetSpeaker, characterCard }),
    renderRoleplayPresentationContract(),
    enhancements.actionSuggestions ? renderRecommendationInstruction({
      characterCard: expandedCharacterCard,
      groupMembers: expandedGroupMembers,
      memory,
      worldState: worldStateCompilation?.worldState,
      characterContentMode,
      userMessage
    }) : '',
    actionProtocolPrompt,
    mvuPatchPrompt
  ].filter(Boolean);

  if (faithful && enhancements.actionSuggestions) interactionProtocolSections.push(renderRecommendationInstruction({ characterCard: expandedCharacterCard, groupMembers, memory, worldState: worldStateCompilation.worldState, characterContentMode, userMessage }));
  const historyCompilation = selectRecentMessagesForPrompt(safeMessages, {
    maxMessages: recentPairs * 2,
    maxTokens: preserveSources ? null : maxPromptTokens ? Math.max(640, Math.floor(maxPromptTokens * 0.18)) : null,
    minCompleteTurns: 2
  });
  const recentMessageSource = historyCompilation.messages;
  const regexAudit = [];
  const recentMessages = recentMessageSource
    .map((message, index) => {
      const transformed = applyPromptTransforms(String(message.content || ''), regexTransforms, {
        role: normalizePromptRole(message.role),
        context: regexContext,
        depth: recentMessageSource.length - index
      });
      return {
        role: message.role,
        content: (() => {
          if (message.role === 'user' && String(message.content || '').trim() && !transformed.trim()) {
            regexAudit.push({ messageId: message.id, reason: 'preserved-user-action-after-empty-transform' });
            return String(message.content);
          }
          return message.speaker ? `[${message.speaker}] ${transformed}` : transformed;
        })(),
        _promptTurnId: message._promptTurnId,
        _promptKind: message._promptAnchor === 'latest-user'
          ? 'history-user-anchor'
          : message._promptProtected ? 'history-recent' : 'history'
      };
    });

  // 对最新用户消息展开宏
  const macroExpandedUserMessage = expandMacros(String(userMessage || ''), { ...macroContext, userMessage: undefined });
  let expandedUserMessage = applyPromptTransforms(
    macroExpandedUserMessage,
    regexTransforms,
    { role: 'user', context: regexContext, depth: 0 }
  );
  if (macroExpandedUserMessage.trim() && !expandedUserMessage.trim()) {
    expandedUserMessage = macroExpandedUserMessage;
    regexAudit.push({ reason: 'preserved-current-user-action-after-empty-transform' });
  }
  changes.record('宏与正则', '当前输入', userMessage, expandedUserMessage);
  recentMessages.forEach((m, i) => changes.record('正则', `历史消息：${recentMessageSource[i]?.id || i}`, recentMessageSource[i]?.content, m.content));
  const historyWithUser = [...recentMessages, { role: 'user', content: expandedUserMessage, _promptKind: 'current-user' }];
  const totalHistory = historyWithUser.length;

  const injections = [];
  let injectionSequence = 0;
  for (const [depthKey, cards] of cardsByDepth.entries()) {
    const depth = Number(String(depthKey).replace('depth:', ''));
    for (const card of cards) {
      const text = [`# 触发的世界书与记忆 (Depth ${depth})`, `## ${card.title}\n${card.content}`].join('\n\n');
      let insertIndex = totalHistory - depth;
      if (insertIndex < 0) insertIndex = 0;
      insertIndex = Math.min(insertIndex, totalHistory);
      injections.push({
        index: insertIndex,
        order: 0,
        sequence: injectionSequence++,
        message: {
          role: normalizePromptRole(card.role === 1 ? 'user' : card.role === 2 ? 'assistant' : card.role),
          content: text,
          _promptKind: cards.some((card) => worldBookAnchorKeys.has(worldBookCardKey(card)))
            ? 'worldbook-anchor'
            : 'worldbook',
          _promptDepth: depth,
          _promptTrigger: cards.map((card) => String(card.title || '')).filter(Boolean).join('、')
        }
      });
    }
  }

  promptPlacement.inChatModules.forEach((module, moduleIndex) => {
    const depth = normalizeDepth(module.depth);
    let insertIndex = totalHistory - depth;
    if (insertIndex < 0) insertIndex = 0;
    insertIndex = Math.min(insertIndex, totalHistory);
    injections.push({
      index: insertIndex,
      order: normalizePromptOrder(module.order),
      sequence: injectionSequence++,
      message: {
        role: normalizePromptRole(module.role),
        content: String(module.content || '').trim(),
        _promptKind: promptMessageKind(module, 'preset-in-chat', moduleIndex, promptPlacement.inChatModules.length),
        _promptPriority: promptModuleRuntimePriority(module, moduleIndex, promptPlacement.inChatModules.length),
        _promptModuleId: module.id,
        _promptBundleKey: communityPresetBundleKey(module),
        _promptIntegrityGroup: promptIntegrityGroup(module, coherentCommunityBundleKeys),
        _promptDepth: depth,
        _promptTrigger: describePromptModuleTrigger(module)
      }
    });
  });

  // SillyTavern V2/V3 角色卡级 depth_prompt：将 prompt 插入到对话历史指定深度
  const cardDepthPrompt = resolveCardDepthPrompt(expandedCharacterCard, macroContext);
  if (cardDepthPrompt) {
    const depth = normalizeDepth(cardDepthPrompt.depth);
    let insertIndex = totalHistory - depth;
    if (insertIndex < 0) insertIndex = 0;
    insertIndex = Math.min(insertIndex, totalHistory);
    injections.push({
      index: insertIndex,
      order: 0,
      sequence: injectionSequence++,
      message: {
        role: normalizePromptRole(cardDepthPrompt.role || 'system'),
        content: cardDepthPrompt.prompt,
        _promptKind: 'character-depth-prompt',
        _promptDepth: depth
      }
    });
  }

  injections.sort((a, b) => (
    a.index - b.index
    || a.order - b.order
    || a.sequence - b.sequence
  ));

  const interleavedHistory = [];
  let currentHistoryIndex = 0;

  for (const injection of injections) {
    while (currentHistoryIndex < injection.index) {
      interleavedHistory.push(historyWithUser[currentHistoryIndex]);
      currentHistoryIndex++;
    }
    interleavedHistory.push(injection.message);
  }

  while (currentHistoryIndex < totalHistory) {
    interleavedHistory.push(historyWithUser[currentHistoryIndex]);
    currentHistoryIndex++;
  }

  const finalUserIndex = interleavedHistory.findIndex(m => m._promptKind === 'current-user');
  const finalUserMessage = interleavedHistory[finalUserIndex];
  const afterUserInjections = interleavedHistory.splice(finalUserIndex);
  afterUserInjections.shift();

  const assembledMessages = [
    ...(coreSystemSections.length ? [{
      role: 'system',
      content: coreSystemSections.join('\n\n'),
      _promptKind: 'core-system'
    }] : []),
    ...(characterAnchorSections.length ? [{
      role: 'system',
      content: characterAnchorSections.join('\n\n'),
      _promptKind: 'character-anchor'
    }] : []),
    ...(dynamicContextTailSections.length ? [{
      role: 'system',
      content: dynamicContextTailSections.join('\n\n'),
      _promptKind: 'dynamic-context-tail',
      _promptOptional: true
    }] : []),
    ...(renderAgreementGuard(memory, userMessage) ? [{ role: 'system', content: renderAgreementGuard(memory, userMessage), _promptKind: 'agreement-guard' }] : []),
    ...(interactionProtocolSections.length ? [{
      role: 'system',
      content: interactionProtocolSections.join('\n\n'),
      _promptKind: 'interaction-contract'
    }] : []),
    ...(topCardsText ? [{
      role: 'system',
      content: topCardsText,
      _promptKind: afterCharCards.some((card) => worldBookAnchorKeys.has(worldBookCardKey(card)))
        ? 'worldbook-anchor'
        : 'worldbook',
      _promptDepth: 0,
      _promptTrigger: afterCharCards.map((card) => String(card.title || '')).filter(Boolean).join('、')
    }] : []),
    ...(beforeEffCardsText ? [{
      role: 'system',
      content: beforeEffCardsText,
      _promptKind: 'worldbook-before-eff',
      _promptDepth: 0,
      _promptTrigger: beforeEffCards.map((card) => String(card.title || '')).filter(Boolean).join('、')
    }] : []),
    ...promptPlacement.systemModules.map((module, index) => ({
      role: 'system',
      content: renderPromptModule(module),
      _promptKind: promptMessageKind(module, 'preset-system', index, promptPlacement.systemModules.length),
      _promptPriority: promptModuleRuntimePriority(module, index, promptPlacement.systemModules.length),
      _promptModuleId: module.id,
      _promptBundleKey: communityPresetBundleKey(module),
      _promptIntegrityGroup: promptIntegrityGroup(module, coherentCommunityBundleKeys),
      _promptDepth: normalizeDepth(module.depth),
      _promptTrigger: describePromptModuleTrigger(module)
    })),
    ...(afterEffCardsText ? [{
      role: 'system',
      content: afterEffCardsText,
      _promptKind: 'worldbook-after-eff',
      _promptDepth: 0,
      _promptTrigger: afterEffCards.map((card) => String(card.title || '')).filter(Boolean).join('、')
    }] : []),
    ...promptPlacement.relativeMessages.map((module, index) => ({
      role: normalizePromptRole(module.role),
      content: String(module.content || '').trim(),
      _promptKind: promptMessageKind(module, 'preset-relative', index, promptPlacement.relativeMessages.length),
      _promptPriority: promptModuleRuntimePriority(module, index, promptPlacement.relativeMessages.length),
      _promptModuleId: module.id,
      _promptBundleKey: communityPresetBundleKey(module),
      _promptIntegrityGroup: promptIntegrityGroup(module, coherentCommunityBundleKeys),
      _promptDepth: normalizeDepth(module.depth),
      _promptTrigger: describePromptModuleTrigger(module)
    })),
    ...interleavedHistory
  ];

  if (expandedCharacterCard && expandedCharacterCard.enabled !== false && expandedCharacterCard.postHistoryInstructions) {
    assembledMessages.push({
      role: 'system',
      content: expandMacros(expandedCharacterCard.postHistoryInstructions, macroContext),
      _promptKind: 'character-anchor'
    });
  }

  if (preserveSources && enhancements.plotGuidance) assembledMessages.splice(1, 0, { role: 'system', content: [narrativeControlPrompt, agentProfilePrompt, authoringLedgerPrompt].filter(Boolean).join('\n\n'), _promptKind: 'agent-plot-guidance', _promptOptional: true });
  if (!faithful && castIndex.prompt) {
    assembledMessages.push({
      role: 'system',
      content: castIndex.prompt,
      _promptKind: 'cast-index', _promptOptional: true
    });
  }

  const responseLengthMode = normalizeResponseLengthMode(options.responseLength);
  if (!enhancements.plotGuidance) assembledMessages.push({ role: 'system', _promptKind: 'response-contract', content: `篇幅偏好：${responseLengthMode === 'compact' ? '简短回应' : responseLengthMode === 'long' ? '较详细的连续场景' : '适中的对话和叙述'}。按原卡风格自然收束，不为凑字数补写玩家决定。` });
  if (enhancements.plotGuidance) {
    assembledMessages.push({
      role: 'system',
      _promptOptional: true,
      content: narrativeEnsemble.prompt,
      _promptKind: 'interaction-contract'
    });
    assembledMessages.push({
      role: 'system',
      _promptOptional: true,
      content: interactionControl.prompt,
      _promptKind: 'interaction-contract'
    });
    assembledMessages.push({
      role: 'system',
      content: enhancements.actionSuggestions ? renderNarrativeTurnFrameContract() : renderNarrativeTurnFrameContract().replace('正文和 <recommended_actions> 之后', '正文之后'),
      _promptKind: 'interaction-contract'
    });
    assembledMessages.push({
      role: 'system',
      content: buildResponseContractPrompt(responseLengthMode, {
        generationType: activationContext.generationType,
        roleplayMode
      }),
      _promptKind: 'response-contract'
    });
  }

  const characterSourcePriority = renderCharacterSourcePriorityAnchor(expandedCharacterCard, {
    contentMode: characterContentMode
  });
  if (characterSourcePriority) {
    assembledMessages.push({ role: 'system', content: characterSourcePriority, _promptKind: 'character-anchor' });
  }

  if (enhancements.plotGuidance && psychologicalProgression.prompt) {
    assembledMessages.push({
      role: 'system',
      content: psychologicalProgression.prompt,
      _promptKind: 'psychological-progression-contract', _promptOptional: true
    });
  }

  const authorNote = expandMacros(String(options.authorNote || '').trim(), macroContext);
  if (authorNote) {
    assembledMessages.push({ role: 'system', content: `# 作者注释\n${authorNote}`, _promptKind: 'author-note' });
  }

  const hardFactsTail = renderNarrativeHardFactsPrompt(memory);
  if (enhancements.memoryRecall && !faithful && hardFactsTail) {
    assembledMessages.push({
      role: 'system',
      content: hardFactsTail,
      _promptKind: 'hard-facts-tail'
    });
  }

  const continuationAnchor = renderContinuationAnchor(recentMessages, finalUserMessage, faithful || !enhancements.actionSuggestions);
  if (continuationAnchor) {
    assembledMessages.push({
      role: 'system',
      content: continuationAnchor,
      _promptKind: 'continuation-anchor'
    });
  }

  if (finalUserMessage) {
    assembledMessages.push({ role: 'system', _promptKind: 'character-anchor', content: [
      '# 本轮演绎校准',
      renderNarrationPerspective(narrationPerspective, promptUserName),
      renderExplicitTurnBoundary(userMessage),
      renderSourceExecutionPriority(),
      '历史回复只提供已发生的事实，不是必须模仿的文风范本。正文人称、视角和格式遵循当前原卡与已启用预设；即使旧回复写错，也从本轮纠正，不重置剧情。',
      '从玩家本轮动作的反馈开始，已完成的观察和询问要得到回应；不要重新等待玩家做已经声明的事。对方不知道或不愿回答时，用符合其性格与所知的反应呈现。',
      '避免再次复述上一轮的环境开场、相同神态和比喻；优先写出这次行动引起的具体变化。不要为求新奇杜撰与设定冲突的秘密。',
      roleplayMode === 'director' ? '仅在玩家明确授权的共创范围内补写主角行为。' : '玩家未给出具体台词时，可概述其已声明的询问，不擅自增添自我介绍、承诺、情绪、内心或下一步行动。'
    ].filter(Boolean).join('\n') });
    assembledMessages.push(finalUserMessage);
  }

  assembledMessages.push(...afterUserInjections);
  if (preserveSources) {
    const exampleText = expandedCharacterCard?.extensions?.local_roleplay_agent?.enrichment?.generatedFields?.includes('exampleDialog')
      ? '' : (expandedCharacterCard?.exampleDialog || []).join('\n');
    const exampleInjections = assembledMessages.filter(m => ['worldbook-before-eff', 'worldbook-after-eff'].includes(m._promptKind));
    for (const message of exampleInjections) assembledMessages.splice(assembledMessages.indexOf(message), 1);
    const anchor = assembledMessages.findIndex(m => m._promptKind === 'character-anchor');
    assembledMessages.splice(anchor + 1, 0,
      ...exampleInjections.filter(m => m._promptKind === 'worldbook-before-eff'),
      ...(exampleText ? [{ role: 'system', content: `# 原卡示例对话\n${exampleText}`, _promptKind: 'character-examples' }] : []),
      ...exampleInjections.filter(m => m._promptKind === 'worldbook-after-eff'));
  }
  const lastAssistantIndex = safeMessages.findLastIndex(m => m.role === 'assistant');
  const qualityAudit = options.repairAudit || (lastAssistantIndex >= 0 ? inspectNarrativeQuality({ content: safeMessages[lastAssistantIndex].content, userMessage: [...safeMessages.slice(0, lastAssistantIndex)].reverse().find(m => m.role === 'user')?.content || '', messages: safeMessages.slice(0, lastAssistantIndex), playerName: promptUserName }) : { status: 'no-signal', issues: [] });
  const qualityGuidance = renderQualityGuidance(qualityAudit);
  if (qualityGuidance) assembledMessages.splice(Math.max(0, assembledMessages.length - 1), 0, { role: 'system', content: qualityGuidance, _promptKind: 'quality-guidance', _promptOptional: !options.repairAudit });
  const protagonistIdentity = resolveProtagonistIdentity(persona, memory);
  const sceneContinuity = buildSceneContinuity({ messages: safeMessages, memory, worldBook: safeWorldBook, persona });
  const continuityGuidance = renderSceneContinuity(sceneContinuity);
  const calibrationIndex = assembledMessages.findLastIndex(message => message.content.startsWith('# 本轮演绎校准'));
  assembledMessages.splice(calibrationIndex >= 0 ? calibrationIndex : Math.max(0, assembledMessages.length - 1), 0,
    { role: 'system', content: renderProtagonistIdentity(protagonistIdentity), _promptKind: 'protagonist-identity' },
    ...(continuityGuidance ? [{ role: 'system', content: continuityGuidance, _promptKind: 'scene-continuity' }] : []));
  for (const message of assembledMessages) {
    const before = message.content;
    message.content = replaceProtagonistPlaceholders(before, protagonistIdentity);
    if (before !== message.content) changes.record('主角身份', message._promptKind || message.role, before, message.content);
  }
  const sourceConflicts = inspectSourceConflicts({ modules: expandedPromptModules, characterCard: expandedCharacterCard, messages: recentMessages });
  const initialPromptBudgetCompilation = (preserveSources ? enforceFaithfulPromptBudget : enforcePromptMessageBudget)(assembledMessages, { maxTokens: maxPromptTokens });
  const integrityCompilation = removeIncompleteCommunityPresetBundles(
    initialPromptBudgetCompilation,
    expandedPromptModules
  );
  const promptBudgetCompilation = integrityCompilation.compilation;
  const budgetedMessages = promptBudgetCompilation.messages;
  const finalPromptText = budgetedMessages.map((message) => String(message.content || '')).join('\n');
  const retainedInjectedCardIds = injectedCards
    .filter((card) => finalPromptText.includes(`## ${card.title}`))
    .map((card) => card.id);
  const retainedInjectedCardIdSet = new Set(retainedInjectedCardIds);
  const finalizedWorldBookActivation = finalizeWorldBookActivation(
    worldBookActivation.snapshot,
    retainedInjectedCardIds
  );
  if (options.inspectPromptChanges === true) {
    changes.record('装配与预算', '预算前 → 最终请求（完整消息顺序）', JSON.stringify(assembledMessages.map(({ role, content }) => ({ role, content })), null, 2), JSON.stringify(budgetedMessages, null, 2));
    for (const kind of ['core-system', 'dynamic-context-tail', 'interaction-contract', 'response-contract']) {
      const content = assembledMessages.filter(m => m._promptKind === kind).map(m => m.content).join('\n\n');
      if (content) changes.record('系统追加', kind, '', content, '装配阶段内容；是否进入最终请求请结合预算记录。');
    }
  }
  const tokenEstimate = estimateTokens(budgetedMessages.map((message) => `${message.role}: ${message.content}`).join('\n'));
  return {
    messages: budgetedMessages,
    tokenEstimate,
    injectedCards,
    sections: {
      executionMode,
      protagonistIdentity,
      sceneContinuity,
      preserveSources,
      narrationPerspective,
      enhancements,
      regexAudit,
      promptModules: renderedPromptModules.map((module) => module.id),
      promptPlacement: {
        system: promptPlacement.systemModules.map((module) => module.id),
        relative: promptPlacement.relativeMessages.map((module) => module.id),
        inChat: promptPlacement.inChatModules.map((module) => module.id)
      },
      hasCharacterCard: Boolean(characterCard?.enabled !== false && String(characterCard?.name || '').trim()),
      characterContentMode: characterContentMode.kind,
      hasCharacterSourcePriority: Boolean(characterSourcePriority),
      hasWorldState: Boolean(memory?.worldState),
      hasKnowledgeGraph: Boolean(memory?.knowledgeGraph?.edges?.length),
      hasRollingSummary: Boolean(memory?.rollingSummary),
      memoryRetrieval: memoryContext?.audit || {
        episodicCount: 0,
        summaryCount: 0,
        vectorCount: Array.isArray(vectorHits) ? vectorHits.length : 0,
        graphRevision: Number(memory?.knowledgeGraph?.revision || 0)
      },
      narrativeMode: narrativeContext.mode,
      roleplayMode,
      interactionContract: interactionControl.report,
      castIndex: {
        count: castIndex.entries.length,
        names: castIndex.entries.map((entry) => entry.name),
        omittedCount: castIndex.omittedCount
      },
      narrativeGenre: narrativeContext.genre,
      narrativeArc: narrativeContext.activeArc,
      narrativeEnsemble: narrativeEnsemble.report,
      psychologicalProgression: psychologicalProgression.report,
      agentProfileId,
      hasAuthoringLedger: Boolean(authoringLedgerPrompt),
      responseLengthMode,
      promptModuleBudget: promptModuleCompilation.report,
      communityPresetIntegrity: {
        preflightSuppressed: communityPresetBundles.filter((bundle) => bundle.suppressed),
        finalSuppressed: integrityCompilation.suppressedBundles
      },
      promptStudio: { qualityAudit, sourceConflicts, factSources: memoryCards.map(c => ({ id: c.id, title: c.title, origin: c.extensions?.provenance?.origin || c.source, reviewStatus: c.extensions?.reviewStatus || 'unverified' })), budgetAccounting: promptBudgetCompilation.report, changes: changes.rows, enhancements, narrationDrift: inspectNarrationDrift(narrationPerspective, recentMessages), ...buildPromptStudioSnapshot({
        messageInspection: promptBudgetCompilation.messageInspection,
        omittedMessageInspection: promptBudgetCompilation.report.omittedMessageInspection,
        promptModules: safePromptModules,
        promptModuleCompilation: promptModuleCompilation.report,
        preflightCommunityBundles: communityPresetBundles,
        finalSuppressedBundles: integrityCompilation.suppressedBundles,
        promptBudget: promptBudgetCompilation.report,
        worldBookActivation: finalizedWorldBookActivation
      }) },
      worldBookPositionCompatibility: injectedCards
        .map(describeWorldBookPositionCompatibility)
        .filter(Boolean),
      promptVariableWrites: {
        appliedCount: promptVariableAudit.length,
        unresolvedCount: expandedPromptModules.reduce((count, module) => (
          count + (String(module.content || '').match(/\{\{\s*(setvar|addvar|incvar|decvar)\s*::/gi) || []).length
        ), 0)
      },
      worldStateBudget: worldStateCompilation.report,
      historyBudget: historyCompilation.report,
      totalPromptBudget: promptBudgetCompilation.report,
      retainedPromptModuleIds: promptBudgetCompilation.report.retainedPromptModuleIds,
      omittedPromptModuleIds: promptBudgetCompilation.report.omittedPromptModuleIds,
      simulationRevision: Number(memory?.simulation?.revision || 0),
      simulationActorCount: Array.isArray(memory?.simulation?.actors) ? memory.simulation.actors.length : 0,
      cardRuntime: {
        enabled: memory?.cardRuntime?.enabled === true,
        actorCount: Array.isArray(memory?.cardRuntime?.actors) ? memory.cardRuntime.actors.length : 0,
        openThreadCount: Array.isArray(memory?.cardRuntime?.openThreads) ? memory.cardRuntime.openThreads.length : 0
      },
      injectedCardIds: injectedCards.map((card) => card.id),
      retainedInjectedCardIds,
      omittedInjectedCardIds: injectedCards
        .map((card) => card.id)
        .filter((id) => !retainedInjectedCardIdSet.has(id)),
      worldBookActivation: finalizedWorldBookActivation,
      worldBookBudget,
      promptRegexTransforms: regexTransforms
        .filter((rule) => rule?.enabled !== false && rule?.promptOnly === true)
        .map((rule) => rule.id)
    }
  };
}

function renderKnowledgeGraph(graph, graphExpansion = null) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  if (!edges.length) return '';
  const nodeName = (node) => node?.name || node?.label || node?.id || '';
  const names = new Map(nodes.map((node) => [node.id, nodeName(node)]));

  const relevantIds = new Set();
  if (graphExpansion?.seedNodeIds?.length) {
    graphExpansion.seedNodeIds.forEach((id) => relevantIds.add(id));
  }
  if (graphExpansion?.relatedEntities?.length) {
    graphExpansion.relatedEntities.forEach((entity) => {
      if (entity.id) relevantIds.add(entity.id);
    });
  }

  const edgeSourceId = (edge) => edge.sourceId || edge.source || edge.from || '';
  const edgeTargetId = (edge) => edge.targetId || edge.target || edge.to || '';

  const isRelevantEdge = (edge) => {
    if (!relevantIds.size) return true;
    return relevantIds.has(edgeSourceId(edge)) || relevantIds.has(edgeTargetId(edge));
  };

  const actionableTypes = new Set(['TRUSTS', 'HOSTILE_TO', 'OWES', 'KNOWS_SECRET', 'INTERACTED_WITH']);
  const priorityEdges = edges
    .filter((edge) => edge.status !== 'superseded')
    .filter(isRelevantEdge)
    .sort((left, right) => {
      const leftActionable = actionableTypes.has(left.type) ? 1 : 0;
      const rightActionable = actionableTypes.has(right.type) ? 1 : 0;
      if (leftActionable !== rightActionable) return rightActionable - leftActionable;
      const leftConf = Number(left.confidence ?? 0.5);
      const rightConf = Number(right.confidence ?? 0.5);
      return rightConf - leftConf;
    });

  if (!priorityEdges.length) return '';

  const lines = [
    '# 当前场景关系子图',
    '以下关系来自已校验的本地知识图谱。角色卡和世界书仍具有最高事实优先级；不得凭空改写。'
  ];
  priorityEdges.slice(0, 18).forEach((edge) => {
    const sourceId = edgeSourceId(edge);
    const targetId = edgeTargetId(edge);
    const source = names.get(sourceId) || sourceId;
    const target = names.get(targetId) || targetId;
    const label = edge.label || edge.type || '关联';
    lines.push(`- ${source} → ${target}：${label}`);
  });
  return lines.join('\n');
}

function renderEpisodicMemory(memoryContext) {
  const episodes = Array.isArray(memoryContext?.episodicHits) ? memoryContext.episodicHits : [];
  const summaries = Array.isArray(memoryContext?.summaryHits) ? memoryContext.summaryHits : [];
  const decisions = Array.isArray(memoryContext?.decisionRecords) ? memoryContext.decisionRecords : [];
  if (!episodes.length && !summaries.length && !decisions.length) return '';
  const lines = [
    '# 召回的长期情节记忆',
    '这些内容是带来源的历史剧情摘要，不是模型思维链。若与角色卡、世界书或当前正文冲突，以更高权威且有直接证据的来源为准。'
  ];
  summaries.slice(0, 6).forEach((summary) => {
    const level = summary.summaryLevel === 'arc'
      ? '故事弧'
      : summary.summaryLevel === 'chapter' ? '章节' : '场景';
    const evidence = Array.isArray(summary.sourceMessageIds) && summary.sourceMessageIds.length
      ? ` [证据:${summary.sourceMessageIds.join(',')}]`
      : '';
    lines.push(`- ${level}摘要·${summary.title || '未命名'}：${summary.summary}${evidence}`);
  });
  episodes.slice(0, 6).forEach((episode) => {
    const evidence = Array.isArray(episode.sourceMessageIds) && episode.sourceMessageIds.length
      ? ` [证据:${episode.sourceMessageIds.join(',')}]`
      : '';
    const scene = episode.scene ? `（${episode.scene}）` : '';
    lines.push(`- ${episode.title || '历史片段'}${scene}：${episode.summary}${evidence}`);
  });
  decisions.slice(-4).forEach((record) => {
    const evidence = Array.isArray(record.evidenceMessageIds) && record.evidenceMessageIds.length
      ? ` [证据:${record.evidenceMessageIds.join(',')}]`
      : '';
    lines.push(`- 已确认决策：${record.decision}${record.policy ? `；规则：${record.policy}` : ''}${evidence}`);
  });
  return lines.join('\n');
}

function expandCharacterCard(card, ctx) {
  if (!card) return card;
  const fields = [
    'name',
    'role',
    'description',
    'personality',
    'scenario',
    'firstMessage',
    'systemPrompt',
    'postHistoryInstructions',
    'speechStyle',
    'knowledge',
    'goals',
    'relationships'
  ];
  const expanded = { ...card };
  fields.forEach((f) => {
    if (typeof expanded[f] === 'string') expanded[f] = expandMacros(expanded[f], ctx);
  });
  if (Array.isArray(expanded.alternateGreetings)) {
    expanded.alternateGreetings = expanded.alternateGreetings.map((g) => expandMacros(String(g || ''), ctx));
  }
  if (Array.isArray(expanded.exampleDialog)) {
    expanded.exampleDialog = expanded.exampleDialog.map((d) => expandMacros(String(d || ''), ctx));
  }
  if (expanded.extensions && typeof expanded.extensions === 'object') {
    expanded.extensions = Object.fromEntries(Object.entries(expanded.extensions).map(([key, value]) => [
      key,
      typeof value === 'string' ? expandMacros(value, ctx) : value
    ]));
  }
  return expanded;
}

function resolveCardDepthPrompt(card, ctx) {
  if (!card) return null;
  const raw = card.depthPrompt || card.depth_prompt || card.extensions?.depthPrompt || card.extensions?.depth_prompt;
  if (!raw) return null;
  if (typeof raw === 'string') {
    const text = expandMacros(raw, ctx);
    return text ? { depth: 4, prompt: text, role: 'system' } : null;
  }
  if (typeof raw === 'object') {
    const promptText = expandMacros(String(raw.prompt || raw.content || raw.text || ''), ctx);
    if (!promptText) return null;
    const depth = Number(raw.depth ?? raw.depthValue ?? 4);
    return {
      depth: Number.isFinite(depth) && depth >= 0 ? Math.floor(depth) : 4,
      prompt: promptText,
      role: String(raw.role || 'system')
    };
  }
  return null;
}

function resolveCardWorldBookTokenBudget(card) {
  if (!card) return null;
  const local = card.extensions?.local_roleplay_agent;
  if (!local || typeof local !== 'object') return null;
  const meta = local.worldBook;
  if (!meta || typeof meta !== 'object') return null;
  const raw = Number(meta.tokenBudget);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : null;
}

function expandPersona(persona, ctx) {
  if (!persona) return persona;
  const fields = ['name', 'description', 'background', 'personality'];
  const expanded = { ...persona };
  fields.forEach((f) => {
    if (typeof expanded[f] === 'string') expanded[f] = expandMacros(expanded[f], ctx);
  });
  return expanded;
}

function expandGroupMembers(groupMembers, ctx) {
  if (!Array.isArray(groupMembers)) return groupMembers;
  const fields = ['name', 'role', 'description', 'personality', 'systemPrompt', 'speechStyle', 'knowledge', 'goals', 'relationships'];
  return groupMembers.map((m) => {
    if (!m) return m;
    const expanded = { ...m };
    fields.forEach((f) => {
      if (typeof expanded[f] === 'string') expanded[f] = expandMacros(expanded[f], ctx);
    });
    if (Array.isArray(expanded.exampleDialog)) {
      expanded.exampleDialog = expanded.exampleDialog.map((dialog) => expandMacros(String(dialog || ''), ctx));
    }
    return expanded;
  });
}

function worldBookCardKey(card) {
  const id = String(card?.id || '').trim();
  if (id) return `id:${id}`;
  return `title:${String(card?.title || card?.name || '').trim()}`;
}

function renderCharacterCard(card, { includeOpening = false, contentMode = { kind: 'character' } } = {}) {
  if (!card || card.enabled === false) return '';
  if (contentMode.kind === 'scenario-container') {
    const generatedFields = new Set(
      card.extensions?.local_roleplay_agent?.enrichment?.generatedFields || []
    );
    const lines = [
      '# 多角色场景卡',
      `场景包：${card.name || '未命名场景'}`,
      '定位：该根卡是承载多名 NPC、世界规则与开局的场景容器，不是可直接发言的单一角色。',
      'NPC 的身份、外貌、性格、境界、关系和语言风格必须分别取自当前触发的世界书人物条目；禁止把根卡字段或任一 NPC 的字段复制给其他人物。'
    ];
    if (card.description && !generatedFields.has('description')) lines.push(`场景说明：${card.description}`);
    // 场景容器的顶层 scenario 在社区多角色卡中经常只是某一名 NPC 的遗留字段。
    // 开局应由 firstMessage 与已触发世界书共同确定，不能把该字段提升为全局事实。
    if (includeOpening && card.firstMessage) {
      lines.push(`开场语：${limitTextToTokenBudget(card.firstMessage, 320)}`);
    }
    if (card.systemPrompt) lines.push(`场景系统提示：${card.systemPrompt}`);
    if (Array.isArray(card.tags) && card.tags.length) lines.push(`标签：${card.tags.join('、')}`);
    return lines.join('\n');
  }
  const lines = [
    '# 角色卡',
    `姓名：${card.name || '未命名主角'}${card.nickname ? `（又称：${card.nickname}）` : ''}`,
    `身份：${card.role || ''}`,
    `描述：${card.description || ''}`,
    `性格：${card.personality || ''}`,
    `当前情境：${card.scenario || ''}`
  ];
  if (includeOpening && card.firstMessage) {
    lines.push(`开场语：${limitTextToTokenBudget(card.firstMessage, 320)}`);
  }
  if (card.systemPrompt) lines.push(`角色系统提示：${card.systemPrompt}`);
  if (Array.isArray(card.exampleDialog) && card.exampleDialog.length) {
    lines.push(`示例对话：\n${limitTextToTokenBudget(card.exampleDialog.join('\n'), 320)}`);
  }
  const speechStyle = firstProfileValue(card.speechStyle, card.extensions?.speech, card.extensions?.speechStyle, card.extensions?.speech_style);
  if (speechStyle) lines.push(`语言风格：${speechStyle}`);
  const goals = firstProfileValue(card.goals, card.extensions?.goals);
  if (goals) lines.push(`当前目标：${goals}`);
  const knowledge = firstProfileValue(card.knowledge, card.extensions?.knowledge, card.extensions?.knownInformation);
  if (knowledge) lines.push(`已知与盲区：${knowledge}`);
  const relationships = firstProfileValue(card.relationships, card.extensions?.relationships);
  if (relationships) lines.push(`关系边界：${relationships}`);
  if (Array.isArray(card.tags) && card.tags.length) lines.push(`标签：${card.tags.join('、')}`);
  return lines.filter((line) => !line.endsWith('：')).join('\n');
}

function renderPersona(persona) {
  if (!persona || persona.enabled !== true) return '';
  const lines = ['# 用户人设'];
  if (persona.name) lines.push(`姓名：${persona.name}`);
  if (persona.description) lines.push(`描述：${persona.description}`);
  if (persona.background) lines.push(`背景：${persona.background}`);
  if (persona.personality) lines.push(`性格：${persona.personality}`);
  return lines.length > 1 ? lines.join('\n') : '';
}

function renderCoreMemory(coreMemory) {
  if (!coreMemory || typeof coreMemory !== 'object') return '';
  const lines = [];
  if (coreMemory.personaView && typeof coreMemory.personaView === 'string' && coreMemory.personaView.trim()) {
    lines.push(`对玩家认知：${coreMemory.personaView.trim()}`);
  }
  if (Array.isArray(coreMemory.activeCommitments) && coreMemory.activeCommitments.length) {
    lines.push(`核心承诺与羁绊：\n${coreMemory.activeCommitments.map((c) => `- ${c}`).join('\n')}`);
  }
  if (Array.isArray(coreMemory.coreDirectives) && coreMemory.coreDirectives.length) {
    lines.push(`终极执念与首要动机：\n${coreMemory.coreDirectives.map((d) => `- ${d}`).join('\n')}`);
  }
  if (!lines.length) return '';
  return ['# 角色核心认知与羁绊 (Core Memory)', ...lines].join('\n');
}

function renderContinuationAnchor(recentMessages = [], finalUserMessage = null, faithful = false) {
  const instruction = String(finalUserMessage?.content || '');
  if (!/玩家请求继续推进|一个新的世界反馈节拍/u.test(instruction)) return '';
  const previousAssistant = [...(Array.isArray(recentMessages) ? recentMessages : [])]
    .reverse()
    .find((message) => String(message?.role || '').toLowerCase() === 'assistant');
  const frontier = compactContinuationFrontier(previousAssistant?.content);
  const lines = [
    '# 继续推进落点锚定',
    '“继续推进”不是空白输入，也不是重述上一轮。应在既有事实之后写出自然承接的实质进展。',
    '不得复述、改写、重演或重新确认已经写出的动作、对白、线索、状态和已结束的选项卡；不得替玩家补写行动、发言或决定。'
  ];
  if (frontier) lines.push(`上一轮正文最后已确认的落点：${frontier}`);
  lines.push(faithful ? '从这一落点之后开始，在需要玩家作决定时自然收束。原卡未要求时不附加行动卡。' : '本轮正文必须从这一落点之后开始；若场景形成了真实未决节点，给出一张且仅一张与该节点对应的行动卡，并把决定权交还玩家。');
  return lines.join('\n');
}

function compactContinuationFrontier(value) {
  const source = String(value || '')
    .replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!source) return '';
  const truncated = source.length > 620;
  const tail = source.slice(-620);
  const sentenceBoundary = tail.search(/[。！？!?]/u);
  // 只有在确实截断了前文时，才丢弃可能被截成半句的开头。短正文必须
  // 保留完整的已确认事实，否则“新发现”会在继续推进时失去锚点。
  return (truncated && sentenceBoundary >= 0 ? tail.slice(sentenceBoundary + 1) : tail)
    .trim()
    .slice(0, 460);
}

function renderGroupMembers(groupMembers) {
  const members = Array.isArray(groupMembers) ? groupMembers.filter((m) => m && m.enabled !== false && String(m.name || '').trim()) : [];
  if (!members.length) return '';
  const lines = ['# 群聊参与角色'];
  members.forEach((m, idx) => {
    const segments = [`## ${m.name}`];
    if (m.role) segments.push(`身份：${m.role}`);
    if (m.description) segments.push(`描述：${m.description}`);
    if (m.personality) segments.push(`性格：${m.personality}`);
    const speechStyle = firstProfileValue(m.speechStyle, m.extensions?.speech, m.extensions?.speechStyle);
    if (speechStyle) segments.push(`语言风格：${speechStyle}`);
    if (Array.isArray(m.exampleDialog) && m.exampleDialog.length) segments.push(`示例对话：\n${m.exampleDialog.join('\n')}`);
    const knowledge = firstProfileValue(m.knowledge, m.extensions?.knowledge);
    if (knowledge) segments.push(`已知与盲区：${knowledge}`);
    const goals = firstProfileValue(m.goals, m.extensions?.goals);
    if (goals) segments.push(`当前目标：${goals}`);
    const relationships = firstProfileValue(m.relationships, m.relationship, m.extensions?.relationships);
    if (relationships) segments.push(`关系边界：${relationships}`);
    if (m.systemPrompt) segments.push(`专属指令：${m.systemPrompt}`);
    lines.push(segments.join('\n'));
  });
  lines.push('对话可由任一参与角色发起，回复正文开头请用「【角色名】」标注当前发言者。');
  return lines.join('\n\n');
}

function renderCharacterPerformanceContract(characterCard, groupMembers, {
  contentMode = { kind: 'character' },
  activeCards = []
} = {}) {
  const worldBookCharacters = contentMode.kind === 'scenario-container'
    ? collectWorldBookCharacterNames(activeCards)
    : [];
  const namedCharacters = [
    contentMode.kind === 'scenario-container' || characterCard?.enabled === false ? '' : characterCard?.name,
    ...worldBookCharacters,
    ...(Array.isArray(groupMembers) ? groupMembers.filter((member) => member?.enabled !== false).map((member) => member?.name) : [])
  ].filter(Boolean).filter((name, index, values) => values.indexOf(name) === index);
  if (!namedCharacters.length) return '';
  return [
    '# 角色演绎契约',
    `本轮可用角色：${namedCharacters.join('、')}。`,
    '角色发言必须同时受身份、性格、当前目标、关系阶段与已知信息约束；不能为了推进剧情而让所有人物使用同一种口吻。',
    '优先从“语言风格”和“示例对话”提取句长、称谓、语气、回避方式与情绪表达。只模仿风格特征，不逐句复述示例。',
    '角色只能依据其亲历、被告知或合理推断的信息行动；不知道的秘密应表现为误判、试探、追问或沉默，不得获得全知视角。',
    '旁白负责环境、动作和可观察反应；角色对白使用其自身措辞。不要解释提示词、扮演规则或以“AI助手”的口吻总结人物。',
    '关系变化必须由本轮具体事件触发，并与此前关系阶段连续，禁止无缘由地骤然亲密、忠诚或敌对。'
  ].join('\n');
}

function renderCharacterSourcePriorityAnchor(characterCard, { contentMode = { kind: 'character' } } = {}) {
  if (!isImportedCharacterCard(characterCard)) return '';
  if (contentMode.kind === 'scenario-container') {
    return [
      '# 本轮多角色场景卡优先级',
      `当前导入内容「${characterCard.name || '未命名场景'}」是多角色剧本容器，不是名为“${characterCard.name || '该场景'}”的 NPC。`,
      '角色卡开场、已启用 Character Book / 世界书及用户已经确认的事实，是当前人物、关系、地点和剧情前提的首要依据。预设只负责通用写作方式，不能改写这些事实。',
      '每名 NPC 必须绑定自己的世界书人物条目；不得把从某一人物条目自动提取的性格、衣着、境界、目标或对白方式套到另一人物身上。',
      '事实优先级：①当前触发的人物世界书与根卡开场；②用户明确确认的事实与本轮行动；③不冲突的既有会话事实；④摘要、World State、预设补充和模型推断。',
      '若历史摘要或 World State 存在重复初遇、错误人物名、地点滞后或互斥指令，本轮必须以高优先级来源校正，不得继续传播。',
      '隐藏秘密和未公开信息只可用于导演侧约束，在剧情明确揭露前不得写成玩家已知事实。'
    ].join('\n');
  }
  return [
    '# 本轮导入角色卡优先级',
    `当前导入角色卡为「${characterCard.name || '未命名角色'}」。角色卡及当前已启用的 Character Book / 世界书，是人物身份、NPC 性格、关系、地点、故事前提、对白方式和行文风格的首要依据。`,
    '事实优先级必须按以下顺序执行：①角色卡与已启用世界书；②用户明确确认的事实与本轮行动；③不冲突的既有会话事实；④滚动摘要、World State、模型推断与预设补充。低优先级来源冲突时必须舍弃，不能保留两套互斥版本。',
    '内容包只提供通用题材规则、力量体系与格式兜底，不得用内容包自带的专属人物、地点、开局事件或固定主线替换导入卡设定。',
    '若两者冲突，人物、关系、地点、开场与叙事风格以导入角色卡和当前已启用世界书为准；不要继续与当前导入卡无关的基线剧情。',
    '保持已经在本会话中明确发生且不与角色卡、世界书冲突的事实连续；若摘要或 World State 与事实源冲突，以事实源校正当前描写，不要继续传播错误状态。',
    '角色卡或世界书中的隐藏秘密、幕后动机和未公开信息只能约束导演侧推演；在剧情明确揭露前，不得写入玩家可见正文、角色状态或主角已知事实。'
  ].join('\n');
}

function isImportedCharacterCard(characterCard) {
  if (!characterCard || characterCard.enabled === false) return false;
  const extensions = characterCard.extensions && typeof characterCard.extensions === 'object'
    ? characterCard.extensions
    : {};
  return Boolean(
    characterCard.sourceSpec
    || characterCard.raw
    || extensions.tavern_helper
    || extensions.regex_scripts
    || extensions.world
    || extensions.chub
  );
}

function firstProfileValue(...values) {
  for (const value of values) {
    if (Array.isArray(value) && value.length) return value.map((item) => String(item || '').trim()).filter(Boolean).join('、');
    if (value && typeof value === 'object') {
      const rendered = Object.entries(value)
        .map(([key, item]) => `${key}：${Array.isArray(item) ? item.join('、') : String(item || '').trim()}`)
        .filter((item) => !item.endsWith('：'))
        .join('；');
      if (rendered) return rendered;
    }
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function renderSpeakerInstruction({ groupMembers, targetSpeaker, characterCard }) {
  const members = Array.isArray(groupMembers) ? groupMembers.filter((m) => m && m.enabled !== false && String(m.name || '').trim()) : [];
  const hasGroup = members.length > 0;
  if (!hasGroup && !targetSpeaker) return '';
  if (targetSpeaker) {
    const isMember = members.some((m) => m.name === targetSpeaker);
    const isMain = characterCard && characterCard.name === targetSpeaker;
    if (!isMember && !isMain) return '';
    return `# 当前发言角色\n本轮请由「${targetSpeaker}」发言，回复正文以「【${targetSpeaker}】」开头，体现其身份、性格与语气。`;
  }
  return '# 发言规则\n可在每轮自然轮换发言者，回复正文以「【角色名】」开头标注当前发言者。';
}

function renderPromptModule(module) {
  if (!module || !String(module.content || '').trim()) return '';
  return `# Prompt 模块\n## ${module.title}\n${module.content}`;
}

function promptMessageKind(module, fallbackKind, index, total) {
  return promptModuleRuntimePriority(module, index, total) >= 90
    ? 'preset-critical'
    : fallbackKind;
}

function getRenderablePromptModules(promptModules = []) {
  return promptModules.filter((module) => module.enabled !== false && String(module.content || '').trim());
}

function emptyWorldBookBudget(entries = [], maxEntryTokens = 0) {
  return {
    entries: [],
    report: {
      maxTokens: 0,
      maxEntryTokens,
      usedTokens: 0,
      selectedCount: 0,
      omittedCount: Array.isArray(entries) ? entries.length : 0,
      omittedIds: (Array.isArray(entries) ? entries : []).map((entry) => entry?.id).filter(Boolean),
      truncatedCount: 0
    }
  };
}

function isCoreWorldBookAnchor(card = {}) {
  if (card?.extensions?.local_roleplay_agent?.coreAnchor === true) return true;
  if (card?.id === 'community-runtime-compatibility-contract') return true;
  const title = String(card?.title || card?.name || '').trim();
  const labels = [
    title,
    ...(Array.isArray(card?.keywords) ? card.keywords : []),
    card?.category,
    card?.comment,
    card?.extensions?.category,
    card?.extensions?.group
  ].filter(Boolean).join(' ');
  if (/(?:文风|写作|状态(?:栏|面板)?|格式|模板|样式|DLC|选开)/iu.test(labels)) return false;
  return /(?:世界(?:观|背景|设定|规则)|主角|主人公|玩家|角色(?:生成|设定)?|人物(?:生成|设定)?|规则|法则|能力|等级|境界|体系|系统|约束|禁忌|关系|势力|历法|时间)/iu.test(labels);
}

function resolvePromptUserName(persona, memory) {
  return resolveProtagonistIdentity(persona, memory).name || '用户';
}

function resolvePromptCharacterName(characterCard, memory, contentMode) {
  const cardName = String(characterCard?.name || '').trim();
  const protagonistName = String(memory?.worldState?.protagonist?.name || '').trim();
  const cardRole = String(characterCard?.role || '').trim();
  const cardActsAsPlayer = /(?:主角|主人公|玩家)/u.test(cardRole);
  if (protagonistName && (contentMode?.kind === 'scenario-container' || cardActsAsPlayer)) {
    return protagonistName;
  }
  return cardName || protagonistName || 'assistant';
}

function communityPresetBundleKey(module) {
  const preset = module?.extensions?.sillyTavernPreset;
  if (!preset?.presetTitle) return '';
  return `${String(preset.sourceFormat || 'sillytavern-preset').trim()}::${String(preset.presetTitle).trim()}`;
}

function promptIntegrityGroup(module, coherentBundleKeys = new Set()) {
  const key = communityPresetBundleKey(module);
  return key && coherentBundleKeys.has(key) ? `community-preset:${key}` : '';
}

function inspectCommunityPresetBundles(modules = [], { maxModules = null, maxTokens = null } = {}) {
  const groups = new Map();
  modules.forEach((module) => {
    const key = communityPresetBundleKey(module);
    if (!key) return;
    const current = groups.get(key) || [];
    current.push(module);
    groups.set(key, current);
  });
  return [...groups.entries()].map(([key, bundleModules]) => {
    const needsCoherence = bundleModules.some((module) => hasPromptVariableDependency(module.content));
    const estimatedTokens = bundleModules.reduce((sum, module) => sum + estimateTokens(String(module.content || '')), 0);
    const exceedsModuleLimit = Number.isFinite(maxModules) && maxModules > 0 && bundleModules.length > maxModules;
    const exceedsTokenBudget = Number.isFinite(maxTokens) && maxTokens > 0 && estimatedTokens > maxTokens;
    return {
      key,
      title: String(bundleModules[0]?.extensions?.sillyTavernPreset?.presetTitle || '').trim(),
      moduleIds: bundleModules.map((module) => module.id),
      moduleCount: bundleModules.length,
      estimatedTokens,
      coherenceSensitive: needsCoherence,
      suppressed: needsCoherence && (exceedsModuleLimit || exceedsTokenBudget),
      reason: exceedsModuleLimit
        ? 'module-limit-would-split-variable-chain'
        : exceedsTokenBudget ? 'token-budget-would-split-variable-chain' : ''
    };
  });
}

/**
 * A community preset may contain ordered setvar/getvar modules.  Selecting an
 * arbitrary subset makes the remaining modules syntactically valid yet
 * semantically wrong.  Compile once, then retry without every incomplete
 * coherence-sensitive bundle until the surviving candidates are atomic.
 */
function compilePromptModulesWithBundleIntegrity(modules = [], options = {}) {
  let candidates = Array.isArray(modules) ? [...modules] : [];
  const suppressedBundles = [];
  const suppressedKeys = new Set();
  let compilation = compilePromptModulesForRuntime(candidates, options);

  for (let attempt = 0; attempt <= candidates.length; attempt += 1) {
    const retainedIds = new Set(compilation.modules.map((module) => module.id));
    const incompleteBundles = inspectCommunityPresetBundles(candidates)
      .filter((bundle) => (
        bundle.coherenceSensitive
        && bundle.moduleIds.some((id) => !retainedIds.has(id))
        && !suppressedKeys.has(bundle.key)
      ));
    if (!incompleteBundles.length) break;

    incompleteBundles.forEach((bundle) => {
      suppressedKeys.add(bundle.key);
      suppressedBundles.push({
        ...bundle,
        suppressed: true,
        reason: 'runtime-budget-would-split-variable-chain'
      });
    });
    candidates = candidates.filter((module) => !suppressedKeys.has(communityPresetBundleKey(module)));
    compilation = compilePromptModulesForRuntime(candidates, options);
  }

  return { compilation, suppressedBundles };
}

function hasPromptVariableDependency(content) {
  return /\{\{\s*(?:setvar|addvar|incvar|decvar|getvar|globalvar|压缩相邻消息)\s*::/i.test(String(content || ''));
}

function removeIncompleteCommunityPresetBundles(compilation, renderedPromptModules = []) {
  const sensitiveBundles = inspectCommunityPresetBundles(renderedPromptModules);
  const messages = Array.isArray(compilation?.messages) ? compilation.messages : [];
  const inspection = compilation.messageInspection || [];
  const retainedIds = new Set(inspection.map(message => message.moduleId).filter(Boolean));
  const incomplete = sensitiveBundles.filter((bundle) => (
    bundle.coherenceSensitive && bundle.moduleIds.some((id) => !retainedIds.has(id))
  ));
  if (!incomplete.length) return { compilation, suppressedBundles: [] };
  const blocked = new Set(incomplete.map((bundle) => bundle.key));
  const omittedIds = incomplete.flatMap((bundle) => bundle.moduleIds);
  const keep = (_, index) => !blocked.has(String(inspection[index]?.bundleKey || ''));
  const nextMessages = messages.filter(keep);
  const report = compilation.report || {};
  return {
    compilation: {
      ...compilation,
      messages: nextMessages,
      messageInspection: inspection.filter(keep),
      report: {
        ...report,
        afterTokens: estimateTokens(nextMessages.map((message) => `${message.role}: ${message.content}`).join('\n')),
        retainedPromptModuleIds: (report.retainedPromptModuleIds || []).filter((id) => !omittedIds.includes(id)),
        omittedPromptModuleIds: [...new Set([...(report.omittedPromptModuleIds || []), ...omittedIds])],
        omittedKinds: {
          ...(report.omittedKinds || {}),
          'preset-bundle-incomplete': Number(report.omittedKinds?.['preset-bundle-incomplete'] || 0) + omittedIds.length
        }
      }
    },
    suppressedBundles: incomplete.map((bundle) => ({
      ...bundle,
      suppressed: true,
      reason: 'final-prompt-budget-would-split-variable-chain'
    }))
  };
}

function organizePromptModules(promptModules = []) {
  const ordered = [...promptModules].sort(comparePromptModuleSequence);
  const systemModules = [];
  const relativeMessages = [];
  const inChatModules = [];

  ordered.forEach((module) => {
    if (module.position === 'in_chat') {
      inChatModules.push(module);
      return;
    }
    if (normalizePromptRole(module.role) !== 'system') {
      relativeMessages.push(module);
      return;
    }
    systemModules.push(module);
  });

  return { systemModules, relativeMessages, inChatModules };
}

function comparePromptModuleSequence(left, right) {
  const leftPreset = left?.extensions?.sillyTavernPreset;
  const rightPreset = right?.extensions?.sillyTavernPreset;
  const samePreset = leftPreset
    && rightPreset
    && leftPreset.presetTitle === rightPreset.presetTitle
    && leftPreset.sourceFormat === rightPreset.sourceFormat;
  if (!samePreset) return 0;
  return normalizePromptSequence(leftPreset.sequence ?? leftPreset.originalIndex)
    - normalizePromptSequence(rightPreset.sequence ?? rightPreset.originalIndex);
}

function normalizePromptRole(role) {
  const normalized = String(role || 'system').trim().toLowerCase();
  return ['system', 'user', 'assistant'].includes(normalized) ? normalized : 'system';
}

function normalizePromptOrder(order) {
  const number = Number(order);
  return Number.isFinite(number) ? number : 0;
}

function normalizePromptSequence(sequence) {
  const number = Number(sequence);
  return Number.isFinite(number) ? number : Number.MAX_SAFE_INTEGER;
}

function renderWorldState(worldState) {
  if (!worldState) return '';
  return `# 结构化世界状态\n${JSON.stringify(worldState, null, 2)}`;
}

function renderRollingSummary(summary) {
  if (!String(summary || '').trim()) return '';
  return `# 滚动摘要\n${summary}`;
}

function renderVectorMemory(hits) {
  const safeHits = Array.isArray(hits) ? hits.filter((h) => h && h.content && typeof h.content === 'string' && h.content.trim()) : [];
  if (!safeHits.length) return '';
  const lines = ['# 相关历史片段（向量检索）'];
  safeHits.forEach((hit, idx) => {
    const role = String(hit.role || 'user');
    lines.push(`## 片段 ${idx + 1} [${role}]\n${String(hit.content).trim()}`);
  });
  lines.push('以上为基于当前输入检索到的历史相关片段，可用于参考但不要直接复制。');
  return lines.join('\n\n');
}

function normalizeDepth(depth) {
  const number = Number(depth);
  if (!Number.isFinite(number) || number < 0) return 4;
  return Math.floor(number);
}

function renderRecommendationInstruction({
  characterCard = null,
  groupMembers = [],
  memory = {},
  worldState = null,
  characterContentMode = '',
  userMessage = ''
} = {}) {
  const lines = [
    '# 推荐选项输出规则',
    '标准 DM、对白流、叙事流与导演/共创流的正常回合，必须在回复正文之后给出 3 个行动建议；自由输入由界面单独提供，不要把“自定义”作为第四个伪选项。只有用户明确要求“不要选项”、纯改写/设定任务，或没有任何可用的当前场景事实时才可省略。',
    '先依据正文收束处识别唯一的“当前决策节点”：以本轮正文结束时尚未解决、且此刻确实需要玩家表态的交互为准。明确二选一和迫在眉睫的真实危险优先；NPC 问话或命令只有在世界已经暂停等待玩家回应时才是强节点。',
    'NPC 说过话不等于玩家必须围绕 NPC 行动。玩家已经用行动拒绝、绕开或推进到新场景时，旧问话、旧请求和旧命令视为被覆盖，不得继续压过当前的新路线、新异常或可操作物件。',
    '【时效性要求】严禁回溯正文前段已经过去或已解决的旧细节（例如前文已经扫除的痕迹、已经走过的路途），必须严格以正文最后一两句话结束时的当下一刻作为行动决策落点。',
    '选项沿用原卡的题材与措辞，提供三个确实不同且当前可行的行动，不额外强加戏剧冲突。',
    '切忌使用死板干瘪的说明文（如“回应对方”、“询问边界”、“明确自己的意图”），而应直接写出带感的台词或动作。',
    '措辞取自当前人物的表达习惯，不跨题材借用示例。',
    '如果 NPC 正在等待回答，三项必须直接呈现不同情绪的台词或具体应对动作；若存在明确二选一，两项分别对应两个方向，第三项保留破局或真正不同的第三方案。',
    '选项只能操作本轮已确认存在的人物、物件、路径、能力或自身内在气息；动作可以有画面感，但不能把修辞本身改造成可交互对象。',
    '【极度严禁】绝对不要生成套路化的“案发现场”通用动作（如“查验周遭残留”、“暗中观察”、“退开半步警惕”）。如果当前剧情处于极度内在的静态过程（如打坐内视、心理斗争、修炼突破），选项必须完全针对内在的灵力运转或心理变化，切忌凭空做出物理空间上的荒谬位移与无效调查。',
    '绝对禁止用“观察周围”、“环顾四周”等无意义废话替代对当前真实决策节点的果断回应。'
  ];

  const sceneHints = buildRecommendationSceneHints({ characterCard, groupMembers, memory, worldState, characterContentMode, userMessage });
  if (sceneHints) {
    lines.push('', '# 当前场景锚点（推荐选项必须围绕以下要素生成）', sceneHints);
  }

  const affordanceMemory = worldState && typeof worldState === 'object'
    ? { ...memory, worldState }
    : memory;
  const affordancePrompt = renderSceneAffordancePrompt(buildSceneAffordanceSnapshot({ memory: affordanceMemory }));
  if (affordancePrompt) {
    lines.push('', '# 当前可行动条件（带来源的硬约束）', affordancePrompt);
  }

  lines.push(
    '', '选项应体现角色性格与当前关系态势——不同角色面对同一情境会给出不同风格的行动建议。',
    '用如下独立标签输出；标签之外仍是正常回复正文：',
    '<recommended_actions>',
    '["行动选项一", "行动选项二", "行动选项三"]',
    '</recommended_actions>'
  );
  return lines.join('\n');
}

function renderNarrativeTurnFrameContract() {
  return [
    '# 隐藏回合帧（精简机器协议）',
    '正文和 <recommended_actions> 之后输出一个 <turn_frame> JSON；它会被界面隐藏，只记录正文已公开呈现的结果，不是思维链。',
    '只需填写 scene、decision、evidence 与 stateDelta；affordances、panels 可省略。',
    '【极度严禁】`scene.summary` 和 `decision.focus` 必须被极度提炼为15字以内的最核心状态总结，绝对禁止照抄、粘贴或大段复述任何正文原话！不要在 JSON 中补造设定。',
    '权威顺序：角色卡与已启用世界书 > 用户已确认行动 > 既有已确认状态 > 本轮模型叙事。只有来源明确写为“角色卡”“世界书”“用户行动”“既有已确认状态”或“动作裁决”的事实可标 confirmed；纯正文推断和新发现一律标 hypothesis。',
    'decision 表示正文结束这一秒唯一等待玩家处理的节点。NPC 正在等待回答时 requiresPlayerResponse=true；普通建议、闲聊或已经结束的问话不能设为强节点。',
    'stateDelta 只写本轮已发生、可观察且有上述可信来源的变化；没有可信变化时 facts 为空。隐藏动机、未来计划和模型猜测不得进入 stateDelta。',
    '<turn_frame>',
    '{"scene":{"location":"","time":"","summary":"","presentActors":[]},"decision":{"kind":"direct-response|explicit-choice|immediate-threat|pending-interaction|new-discovery|navigation|open-state","focus":"","actor":"","requiresPlayerResponse":false,"urgency":"normal"},"evidence":[{"text":"","status":"confirmed|hypothesis|risk","source":""}],"stateDelta":{"summary":"","facts":[],"timeAdvanceMinutes":null}}',
    '</turn_frame>'
  ].join('\n');
}

function buildRecommendationSceneHints({ characterCard, groupMembers, memory, worldState, characterContentMode, userMessage }) {
  const hints = [];

  // 角色性格锚点（场景容器型角色卡跳过 personality，因为它不是单一角色）
  const charName = String(characterCard?.name || '').trim();
  const isScenarioContainer = characterContentMode?.kind === 'scenario-container'
    || characterContentMode === 'scenario-container';
  const personality = isScenarioContainer ? '' : String(characterCard?.personality || '').trim();
  const protagonistName = String(memory?.worldState?.protagonist?.name || '').trim();
  if (protagonistName) {
    hints.push(`玩家主角：${protagonistName}`);
  }
  if (charName && !isScenarioContainer) {
    const personalityBrief = personality.slice(0, 120);
    hints.push(`当前演绎角色：${charName}${personalityBrief ? `（性格：${personalityBrief}）` : ''}`);
  }

  // 在场角色锚点
  const currentActNames = new Set((Array.isArray(memory?.characterRegistry?.currentAct?.members)
    ? memory.characterRegistry.currentAct.members : [])
    .map((member) => String(member?.name || '').trim())
    .filter(Boolean));
  const members = (Array.isArray(groupMembers) ? groupMembers : [])
    .filter((member) => member && member.enabled !== false && String(member.name || '').trim())
    .filter((member) => !currentActNames.size || currentActNames.has(String(member.name || '').trim()));
  if (members.length > 0) {
    const memberHints = members.slice(0, 5).map((member) => {
      const name = String(member.name || '').trim();
      const role = String(member.role || member.personality || '').trim().slice(0, 40);
      return role ? `${name}（${role}）` : name;
    });
    hints.push(`在场角色：${memberHints.join('、')}`);
  }

  // 当前地点
  const location = resolveWorldStateLocation(worldState)
    || resolveWorldStateLocation(memory?.worldState);
  if (location) {
    hints.push(`当前地点：${location}`);
  }

  // 在台角色（来自 characterRegistry）
  const currentActMembers = resolveCurrentActMembers(memory);
  if (currentActMembers) {
    hints.push(`当前在台角色：${currentActMembers}`);
  }

  // 活跃线索（来自世界状态）
  const activeQuests = resolveActiveQuests(worldState || memory?.worldState);
  if (activeQuests) {
    hints.push(`活跃线索：${activeQuests}`);
  }

  // 关键事实（来自记忆）
  const keyFacts = resolveKeyFacts(memory);
  if (keyFacts) {
    hints.push(`已确认事实：${keyFacts}`);
  }

  const currentUserAction = String(userMessage || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  if (currentUserAction) {
    hints.push(`本轮玩家已明确的行动或问题：${currentUserAction}`);
  }

  return hints.length ? hints.join('\n') : '';
}

function resolveWorldStateLocation(worldState) {
  if (!worldState) return '';
  const loc = worldState.location?.current || worldState.location;
  if (typeof loc === 'string') return loc.trim();
  if (loc && typeof loc === 'object') {
    return String(loc.name || loc.title || loc.label || '').trim();
  }
  return '';
}

function resolveCurrentActMembers(memory) {
  const members = memory?.characterRegistry?.currentAct?.members;
  if (!Array.isArray(members) || !members.length) return '';
  const protagonist = String(memory?.worldState?.protagonist?.name || '').trim();
  return members
    .filter((member) => {
      const name = String(member?.name || '').trim();
      return name && name !== protagonist;
    })
    .map((member) => String(member.name || '').trim())
    .slice(0, 5)
    .join('、');
}

function buildWorldBookActivationTerms(memory, targetSpeaker) {
  const presentCharacters = Array.isArray(memory?.narrativeRepair?.canonicalFacts?.presentCharacters)
    ? memory.narrativeRepair.canonicalFacts.presentCharacters
    : [];
  const graphEntityTerms = collectGraphActivationTerms(memory?.knowledgeGraph);
  return [...new Set([
    ...String(resolveCurrentActMembers(memory) || '').split('、'),
    ...presentCharacters,
    ...graphEntityTerms,
    targetSpeaker
  ].map((value) => String(value || '').trim()).filter(Boolean))]
    .slice(0, 24)
    .join('\n');
}

function collectGraphActivationTerms(graph) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  if (!nodes.length || !edges.length) return [];

  const protagonistId = graph.protagonistId;
  const neighborIds = new Set();
  if (protagonistId) {
    edges.forEach((edge) => {
      if (edge.status === 'superseded') return;
      if (edge.sourceId === protagonistId) neighborIds.add(edge.targetId);
      if (edge.targetId === protagonistId) neighborIds.add(edge.sourceId);
    });
  }

  const relevantNodes = nodes.filter((node) => {
    if (!protagonistId) return true;
    return neighborIds.has(node.id) || node.id === protagonistId;
  });

  const terms = [];
  relevantNodes.slice(0, 16).forEach((node) => {
    const name = String(node.name || node.label || '').trim();
    if (name && name.length >= 2) terms.push(name);
    if (Array.isArray(node.aliases)) {
      node.aliases.forEach((alias) => {
        const normalized = String(alias || '').trim();
        if (normalized && normalized.length >= 2 && !terms.includes(normalized)) {
          terms.push(normalized);
        }
      });
    }
  });
  return terms;
}

function resolveActiveQuests(worldState) {
  if (!worldState) return '';
  const quests = Array.isArray(worldState.quests)
    ? worldState.quests.filter((quest) => quest && String(quest.status || '').toLowerCase() !== 'completed')
    : [];
  if (!quests.length) return '';
  return quests.slice(0, 4)
    .map((quest) => {
      const title = String(quest.title || quest.name || quest.summary || '').trim();
      return title.slice(0, 50);
    })
    .filter(Boolean)
    .join('；');
}

function resolveKeyFacts(memory) {
  const facts = memory?.facts;
  if (!Array.isArray(facts) || !facts.length) return '';
  return facts.slice(-5)
    .map((fact) => {
      const text = String(fact?.text || fact?.content || fact?.summary || (typeof fact === 'string' ? fact : '')).trim();
      return text.slice(0, 60);
    })
    .filter(Boolean)
    .join('；');
}

function renderDefaultPromptLayerContract({ characterCard, worldBook, roleplayMode, contentMode, protagonistName }) {
  const characterName = String(
    contentMode?.kind === 'scenario-container'
      ? protagonistName
      : protagonistName || characterCard?.name
  ).trim() || '当前主角';
  const worldRuleCount = (Array.isArray(worldBook) ? worldBook : [])
    .filter((entry) => entry?.enabled !== false && entry?.constant === true)
    .length;
  return [
    '# 默认保护层（不可由预设静默覆盖）',
    `主角锚点：${characterName} 的身份、已确认行动与叙事控制权必须保留。`,
    `世界锚点：角色卡、已启用世界书和已确认会话事实按优先级共同约束本轮；当前检测到 ${worldRuleCount} 条常驻世界规则。`,
    `互动锚点：当前为 ${roleplayMode === 'dm' ? '标准 DM' : '会话'} 模式，任何预设只能补充文风与静态语义，不能代替玩家作出重大行动。`,
    '兼容边界：SillyTavern 预设的静态提示词、深度、角色与宏语义可参与组装；未知 JavaScript、STScript、DOM 与 iframe 必须先审核，并只在本地受控运行时执行，绝不取得 Provider/API 密钥。'
  ].join('\n');
}

function renderSolvedQuestionClosurePrompt(memory = {}) {
  const worldState = memory?.worldState && typeof memory.worldState === 'object'
    ? memory.worldState : {};
  const resolved = [
    ...(Array.isArray(worldState.quests) ? worldState.quests : []),
    ...(Array.isArray(worldState.timeline) ? worldState.timeline : []),
    ...(Array.isArray(worldState.obligations) ? worldState.obligations : [])
  ].filter((item) => {
    const status = String(item?.status || '').toLowerCase();
    return ['resolved', 'completed', 'closed', 'triggered', 'fulfilled', 'cancelled'].includes(status);
  }).map((item) => String(item?.title || item?.details || item?.type || item?.name || '').trim())
    .filter(Boolean)
    .slice(0, 12);
  const decisions = Array.isArray(memory?.eventLedger)
    ? memory.eventLedger.slice(-20)
      .filter((event) => /(?:resolved|completed|accepted|fulfilled|已解决|已完成|已确认)/iu.test(String(event?.status || event?.summary || '')))
      .map((event) => String(event?.summary || '').trim())
      .filter(Boolean)
      .slice(-6)
    : [];
  if (!resolved.length && !decisions.length) return '';
  return [
    '# 已解决问题闭环',
    '下列事项已经得到确认、完成、触发或结算。除非出现新的证据、直接后果、到期事件或玩家主动重开，不得把它们再次写成需要玩家回答的同一个问题，也不得反复要求同样的确认。',
    ...(resolved.length ? [`已闭环事项：${resolved.join('；')}。`] : []),
    ...(decisions.length ? [`已结算记录：${decisions.join('；')}。`] : []),
    '如需再次触及，必须明确说明新增的事实或变化，而不是重复旧问题。'
  ].join('\n');
}

function describePromptModuleTrigger(module = {}) {
  const keys = Array.isArray(module.triggers)
    ? module.triggers
    : Array.isArray(module.keywords) ? module.keywords : [];
  const normalized = keys.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 4);
  if (normalized.length) return `触发：${normalized.join('、')}`;
  if (module.position === 'in_chat') return '按深度插入最近对话';
  return '静态预设模块';
}

function buildPromptStudioSnapshot({
  messageInspection = [],
  omittedMessageInspection = [],
  promptModules = [],
  promptModuleCompilation = {},
  preflightCommunityBundles = [],
  finalSuppressedBundles = [],
  promptBudget = {},
  worldBookActivation = {}
} = {}) {
  const retained = new Set(Array.isArray(promptBudget.retainedPromptModuleIds)
    ? promptBudget.retainedPromptModuleIds : []);
  const runtimeOmitted = new Set(Array.isArray(promptBudget.omittedPromptModuleIds)
    ? promptBudget.omittedPromptModuleIds : []);
  const compileOmitted = new Set(Array.isArray(promptModuleCompilation.omittedIds)
    ? promptModuleCompilation.omittedIds : []);
  const noops = new Set(Array.isArray(promptModuleCompilation.noopIds)
    ? promptModuleCompilation.noopIds : []);
  const truncations = new Set(Array.isArray(promptModuleCompilation.truncatedIds)
    ? promptModuleCompilation.truncatedIds : []);
  const suppressedKeys = new Map([
    ...preflightCommunityBundles,
    ...finalSuppressedBundles
  ].filter((bundle) => bundle?.key).map((bundle) => [bundle.key, bundle]));
  const moduleDetails = (Array.isArray(promptModules) ? promptModules : []).map((module, index) => {
    const id = String(module?.id || `module-${index + 1}`);
    const bundle = suppressedKeys.get(communityPresetBundleKey(module));
    const enabled = module?.enabled !== false;
    let status = retained.has(id) ? 'running' : 'not-running';
    let evictionReason = '';
    if (!enabled) {
      status = 'disabled';
      evictionReason = '模块已在当前会话关闭';
    } else if (!String(module?.content || '').trim() || noops.has(id)) {
      status = 'empty';
      evictionReason = '没有可发送的静态提示词内容';
    } else if (bundle?.suppressed) {
      status = 'suppressed-for-integrity';
      evictionReason = bundle.reason === 'module-limit-would-split-variable-chain'
        ? '完整性保护：模块上限会拆开变量链'
        : bundle.reason === 'runtime-budget-would-split-variable-chain'
          ? '完整性保护：运行时选择会拆开变量链'
          : bundle.reason === 'final-prompt-budget-would-split-variable-chain'
            ? '完整性保护：最终提示词预算会拆开变量链'
            : '完整性保护：令牌上限会拆开变量链';
    } else if (compileOmitted.has(id) || runtimeOmitted.has(id)) {
      status = 'evicted-by-budget';
      evictionReason = '超出当前模块或总提示词预算';
    } else if (truncations.has(id)) {
      status = 'truncated';
      evictionReason = '按当前预算保留了截断版本';
    }
    return {
      id,
      title: String(module?.title || module?.name || `未命名模块 ${index + 1}`),
      role: normalizePromptRole(module?.role),
      position: String(module?.position || 'system'),
      depth: normalizeDepth(module?.depth),
      trigger: describePromptModuleTrigger(module),
      tokenEstimate: estimateTokens(String(module?.content || '')),
      enabled,
      status,
      evictionReason,
      editable: true,
      // Imported SillyTavern blocks carry an authored sequence.  The studio
      // may still toggle/override them per session, but reordering inside the
      // bundle would silently change its static compatibility semantics.
      orderLocked: Boolean(module?.extensions?.sillyTavernPreset)
    };
  });
  return {
    blocks: [
      ...(Array.isArray(messageInspection) ? messageInspection : []),
      ...(Array.isArray(omittedMessageInspection) ? omittedMessageInspection : [])
    ].map((message) => ({
      ...message,
      title: promptStudioBlockTitle(message, moduleDetails),
      editable: Boolean(message.moduleId)
    })).sort((left, right) => Number(left.order || 0) - Number(right.order || 0)),
    modules: moduleDetails,
    integrity: {
      status: finalSuppressedBundles.length || preflightCommunityBundles.some((bundle) => bundle.suppressed)
        ? 'suppressed-for-integrity' : 'complete',
      suppressedBundles: [...suppressedKeys.values()]
        .filter((bundle) => bundle?.suppressed)
        .map((bundle) => ({
          title: String(bundle.title || '社区预设'),
          reason: String(bundle.reason || '完整性保护')
        }))
    },
    budgets: {
      total: Number(promptBudget.maxTokens || 0) || null,
      used: Number(promptBudget.afterTokens || 0),
      worldBookActivated: Array.isArray(worldBookActivation?.activeCardIds)
        ? worldBookActivation.activeCardIds.length : 0
    }
  };
}

function promptStudioBlockTitle(message = {}, modules = []) {
  const module = modules.find((item) => item.id === message.moduleId);
  if (module) return module.title;
  const labels = {
    'core-system': '默认保护层与核心契约',
    'dynamic-context-tail': '动态上下文尾部',
    'worldbook-anchor': '世界书硬锚点',
    worldbook: '触发世界书',
    'worldbook-before-eff': '世界书（扩展效果前）',
    'worldbook-after-eff': '世界书（扩展效果后）',
    'character-anchor': '角色卡硬锚点',
    'cast-index': '多人角色索引',
    'response-contract': '篇幅与节拍契约',
    'interaction-contract': '互动控制契约',
    'current-user': '当前用户输入',
    'history-user-anchor': '最近真实用户输入',
    history: '近期对话',
    'history-recent': '受保护近期对话'
  };
  return labels[message.kind] || '本地提示词区块';
}

function renderRoleplayPresentationContract() {
  return [
    '# 沉浸式呈现契约',
    '无论角色卡来自内置内容还是社区导入，角色卡与当前已启用世界书都是人物、关系、地点、世界规则和秘密边界的最高事实源；用户明确行动次之。摘要、World State、模型推断或预设补充发生冲突时必须服从事实源，不能保留两套互斥版本。',
    '用户可见正文放在 <plot> 标签中，按自然段组织场景、动作、感官与对白；不要把状态表、导演分析或 XML 标签写进正文。',
    '正文之后用 <normal_status> 记录时间、地点、在场人物和当前任务；用 <relationship_status> 只记录本轮实际发生变化的关系。',
    '用 <special_status> 分角色记录主角及本幕关键人物的当前档案。本轮实际登场、对话或与主角发生互动的每个具名人物都必须登记，并使用角色卡或世界书中的规范名称。每个角色以『角色名·状态』开头，按需包含：身份、外貌/穿着、性格、身体状况、境界/能力、物品、姿势、神情和当前目标。字段必须是“名称：内容”的单行格式，未知项写“未知”，不要编造；隐藏秘密不得写入玩家可见状态。',
    '用 <relationship_status> 记录本轮实际形成或变化的联系，优先采用“角色A→角色B：变化与依据”的格式；未见面、仅听闻的角色要明确标为间接关联。',
    '用 <NextCharacterPanel> 简短记录下一幕建议登场或退场的角色与原因。这些控制区不会显示在正文中，内容应简洁、可更新。',
    '在正文之前用 <emotion> 标签用单个英文或中文词标注当前发言角色的主要情绪（如 happy、sad、angry、neutral、微笑、愤怒、悲伤），用于驱动角色立绘表情切换。该标签不会显示在正文中。',
    '同一回复只能推进一条连续叙事，不得在后半段重新从同一起点出发、改写另一套人物或地点版本。',
    '不要输出内部推理过程。正文结尾必须留下用户可行动的局面，再按推荐选项协议给出 3 个互有差异的行动；自由输入由界面单独承接。'
  ].join('\n');
}
