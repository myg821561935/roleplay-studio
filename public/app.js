import { renderSafeMarkdown } from './markdown.js';
import { createChatController, isProviderConfigured } from './modules/chat.js';
import {
  createInspectorController,
  createInspectorTabSelectSync,
  createWorldbookController
} from './modules/inspector.js';
import { createMcpController } from './modules/mcp.js';
import { createReaderChromeController } from './modules/readerChromeController.js';
import { createVoiceController, createVoiceDictationController, createMessagePlaybackController } from './modules/voice.js';
import { createAssetCenterController } from './modules/assetCenter.js';
import { createAuthoringController } from './modules/authoring.js';
import { extractRoleplayPresentation, splitCharacterStatus } from './modules/roleplayResponse.js';
import {
  createStoryCatalogController,
  loadStoryCatalogPreferences,
  resolveStoryStageBackground
} from './modules/storyCatalog.js';
import {
  getLightFrontendPanels,
  resolveLightFrontendPanel
} from './modules/lightFrontend.js';
import { createScriptGovernanceController } from './modules/scriptGovernance.js';
import { createPackCompatibilityManager } from './modules/packCompatibility.js';
import { createProviderSettingsController } from './modules/providerSettings.js';
import { createSessionSettingsController } from './modules/sessionSettings.js';
import { createMediaGenerationController } from './modules/mediaGeneration.js';
import {
  createReleaseDataController,
  formatBytes
} from './modules/releaseData.js';
import {
  CONTENT_PACK_VISUAL_PRESETS,
  STORY_PACK_PRESENTATION,
  createVisualStageController,
  loadThemePreference
} from './modules/visualStage.js';
import { createWorkspaceController } from './modules/workspace.js';
import { createSessionController, getSessionDisplayTitle } from './modules/session.js';
import { createAssetLibraryController } from './modules/assetLibrary.js';
import {
  createStoryOpeningController,
  createStoryOpeningRandomizer,
  getOpeningGenreOption,
  openingGenreIds
} from './modules/storyOpening.js';
import { createJourneySetupController } from './modules/journeySetup.js';
import { createJourneyDraftController } from './modules/journeyDraft.js';
import { createWorldSimulationController } from './modules/worldSimulation.js';
import { createFactCardsController } from './modules/factCards.js';
import { createComposerController } from './modules/composer.js';
import { createMessageActionsController } from './modules/messageActions.js';
import { createConversationStreamController } from './modules/conversationStream.js';
import { createMessagePresentationController } from './modules/messagePresentation.js';
import { createConversationActionsController } from './modules/conversationActions.js';
import {
  createCustomStoryBuilderController,
  loadCustomStoryDraft
} from './modules/customStoryBuilder.js';
import { createResourceImportController } from './modules/resourceImport.js';
import {
  createResourceWorkbenchController,
  resourceKindLabel
} from './modules/resourceWorkbench.js';
import { createPluginRegistryController } from './modules/pluginRegistry.js';
import { createContentPackController } from './modules/contentPack.js';
import { createImmersiveDossierToolkit } from './modules/immersiveDossier.js';
import { createImmersiveLedgerController } from './modules/immersiveLedgers.js';
import { createImmersiveSidebarController } from './modules/immersiveSidebar.js';
import {
  collectSelectedPromptResourceIds,
  groupPromptResources
} from './modules/presetLibrary.js';
import {
  escapeHtmlText,
  prettyJson,
  formatTokenCount,
  humanizeApiError,
  truncateText
} from './modules/utils.js';
import { createUsageInspectorController } from './modules/usageInspector.js';
import { createMemoryInspectorController } from './modules/memoryInspector.js';
import { createWorldbookWorkspaceController } from './modules/worldbookWorkspace.js';
import { createPresetWorkspaceController } from './modules/presetWorkspace.js';
import { createPromptStudioController } from './modules/promptStudio.js';
import { createPromptTemplateCenterController } from './modules/promptTemplateCenter.js';
import { createPersonaWorkspaceController } from './modules/personaWorkspace.js';
import { createAuthorNoteWorkspaceController } from './modules/authorNoteWorkspace.js';
import { createModuleHelpController } from './modules/moduleHelp.js';
import { createOpeningWorkflowController } from './modules/openingWorkflow.js';
import { createSessionStateCoordinator } from './modules/sessionState.js';
import { createAppStateController } from './modules/appState.js';
import { createAppEventsController } from './modules/appEvents.js';
import { createDomElements } from './modules/domElements.js';
import { createVectorMemoryController } from './modules/vectorMemory.js';
import { createMacroTemplatesController } from './modules/macroTemplates.js';
import { createTimelineController } from './modules/timeline.js';
import { createSessionHealthController } from './modules/sessionHealth.js';
import { createGroupMembersController } from './modules/groupMembers.js';
import { createCharacterCardController } from './modules/characterCard.js';
import { CHARACTER_PRESETS } from './modules/characterPresets.js';
import { createProtagonistGenerator } from './modules/protagonistGenerator.js';
import { createApiRequest } from './modules/apiClient.js';
import { createHeavyFrontendRuntimeController } from './modules/heavyFrontendRuntime.js';
import { createCharacterPresentation } from './modules/characterPresentation.js';
import { downloadJsonFile, inferMimeType } from './modules/browserFiles.js';
import {
  createCharacterCardTemplate,
  createWorldBookEntryTemplate
} from './modules/editorDefaults.js';
import {
  formatTime,
  parseJsonFromTextarea,
  setStatus
} from './modules/uiPrimitives.js';
import { createDisplayPreferencesController } from './modules/displayPreferences.js';

const {
  canRandomizeSetupField,
  composeInventory,
  generateSetupFieldValue,
  generateSetupName,
  getScopedSetupFieldValues,
  rollFromPool
} = createStoryOpeningRandomizer();

const WORLD_BOOK_TYPE_LABELS = {
  'world-premise': '世界总纲',
  geography: '地理交通',
  history: '历史年代',
  realm: '境界体系',
  rule: '规则机制',
  economy: '资源经济',
  faction: '势力组织',
  character: '人物关系',
  location: '地点场景',
  item: '物品器物',
  event: '事件危机',
  quest: '任务线索',
  campaign: '篇章与时钟',
  'story-node': '剧情节点',
  meta: '创作方法',
  other: '其他设定'
};
const storyCatalogPreferences = loadStoryCatalogPreferences();
const apiRequest = createApiRequest();
const {
  getCharacterPortraitUrl,
  createCharacterPortraitImage
} = createCharacterPresentation({ documentObject: document });

const state = {
  config: {
    providers: { activeProviderId: '', providers: [] },
    promptModules: [],
    worldBook: [],
    characterCard: {}
  },
  session: {
    id: 'main',
    messages: [],
    memory: {}
  },
  usage: null,
  targetSpeaker: '',
  immersiveSidebarTab: '',
  prologueTemplate: null,
  pendingJourneyDraft: null,
  openingError: '',
  contentPackCharacterPresets: {},
  contentPacks: [],
  sessionSummaries: [],
  storyProjects: [],
  storyLauncherInitialized: false,
  storyCatalogView: storyCatalogPreferences.view,
  storyCatalogCategory: storyCatalogPreferences.category,
  customStoryDraft: loadCustomStoryDraft(),
  customStoryStep: 'baseline',
  customStoryComposition: { key: '', status: 'idle', report: null, error: '' },
  resourceLibrary: [],
  resourcePacks: [],
  resourceAdapters: [],
  plugins: [],
  sessionHealth: null,
  simulationView: 'director',
  simulationPublicSnapshot: null,
  simulationBusy: false,
  chatStreaming: false,
  chatStreamPhase: '',
  conversationActionPending: false,
  pendingQuickReply: null
};

let currentSessionId = localStorage.getItem('localRoleplaySessionId') || 'main';

const els = createDomElements(document);
const syncInspectorTabSelect = createInspectorTabSelectSync({
  tabSelect: els.inspectorTabSelect,
  panel: els.inspectorPanel,
  workspace: els.workspace,
  documentObject: document
});

let appStateController;
const loadState = (...args) => appStateController.loadState(...args);
const renderAll = (...args) => appStateController.renderAll(...args);

const sessionStateCoordinator = createSessionStateCoordinator({
  state,
  getInspectorRenderers: () => ({
    contentStack: renderContentStack,
    authoring: () => authoringController.render(),
    memoryOverview: renderMemoryOverview,
    memoryView: () => {
      if (els.memoryView) els.memoryView.textContent = prettyJson(state.session?.memory || {});
    },
    sessionHealth: () => sessionHealthController.render(),
    ruleStatus: renderRuleStatus,
    worldSimulation: renderWorldSimulation,
    usageView: renderUsageView,
    facts: renderFacts,
    worldbookEditor: renderWorldbookEditor,
    worldbookEntries: renderWorldbookEntries,
    macroTemplates: renderMacroTemplates,
    timeline: () => timelineController.loadTimeline(),
    characterCardEditor: () => setCharacterCardEditor(
      state.config.characterCard || createCharacterCardTemplate()
    ),
    promptEditor: renderPromptEditor,
    promptTemplates: () => promptTemplateCenterController.render(),
    promptStudio: () => promptStudioController.render(),
    persona: renderPersona,
    quickReplies: renderQuickReplies,
    characterPresetFavorites: renderCharacterPresetFavorites,
    promptPresetFavorites: renderPromptPresetFavorites,
    groupMembers: renderGroupMembers,
    targetSpeakerIndicator: () => composerController.reconcileTargetSpeaker(),
    resourceWorkbench: renderResourceWorkbench
  })
});
const {
  mergeSession,
  refreshInspectorSections,
  renderInspector,
  replaceSession: updateSession
} = sessionStateCoordinator;

const workspaceController = createWorkspaceController({
  els,
  activateTab: (tab) => activateTab(tab)
});
const {
  activateWorkMode,
  loadWorkMode,
  openProviderSettings,
  scrollInspectorIntoViewOnNarrowScreens,
  setWorkspaceActiveView,
  setWorkspacePanelExpanded
} = workspaceController;
const sessionController = createSessionController({
  els,
  apiRequest,
  storage: localStorage,
  getCurrentSessionId: () => currentSessionId,
  setCurrentSessionId: (sessionId) => {
    currentSessionId = sessionId;
    localStorage.setItem('localRoleplaySessionId', currentSessionId);
  },
  loadState,
  setStatus,
  humanizeApiError
});
const {
  deleteCurrentSession,
  exportCurrentSession,
  handleImportSessionFile,
  handleNewSessionSubmit,
  openNewSessionDialog,
  renderSessionSelect
} = sessionController;


const inspectorController = createInspectorController({
  panel: els.inspectorPanel,
  tabSelect: els.inspectorTabSelect,
  syncTabSelect: syncInspectorTabSelect,
  activateResourceView: (...args) => resourceWorkbenchController.activateResourceView(...args),
  openAdvancedTool: openProviderSettings,
  onGroupChange: (group) => activateWorkMode(group === 'debug' ? 'debug' : 'settings', {
    activateDefaultTab: false
  })
});
const usageInspectorController = createUsageInspectorController({
  state,
  els,
  apiRequest,
  getCurrentSessionId: () => currentSessionId,
  setStatus,
  humanizeApiError,
  formatTime,
  documentObject: document,
  visibilityDocument: document
});
const {
  bindEvents: bindUsageInspectorEvents,
  loadUsageStats,
  renderUsageView,
  startPolling: startUsagePolling
} = usageInspectorController;
const memoryInspectorController = createMemoryInspectorController({
  state,
  els,
  documentObject: document
});
const {
  renderMemoryOverview,
  renderRuleStatus
} = memoryInspectorController;
const authoringController = createAuthoringController({
  state,
  els,
  apiRequest,
  getSessionId: () => currentSessionId,
  setStatus,
  getSessionId: () => currentSessionId,
  replaceSession: updateSession
});
const worldbookController = createWorldbookController({
  state,
  els,
  typeLabels: WORLD_BOOK_TYPE_LABELS,
  prettyJson,
  setStatus,
  confirmAction: (message) => confirm(message)
});
const worldbookWorkspaceController = createWorldbookWorkspaceController({
  state,
  els,
  apiRequest,
  getCurrentSessionId: () => currentSessionId,
  setStatus,
  humanizeApiError,
  prettyJson,
  createEntryTemplate: createWorldBookEntryTemplate,
  worldbookController,
  confirmAction: (message) => confirm(message),
  downloadJsonFile,
  documentObject: document
});
const {
  bindEvents: bindWorldbookWorkspaceEvents,
  renderWorldbookEditor,
  setWorldbookDraft,
  renderWorldbookEntries
} = worldbookWorkspaceController;
const presetWorkspaceController = createPresetWorkspaceController({
  state,
  els,
  apiRequest,
  getCurrentSessionId: () => currentSessionId,
  setStatus,
  humanizeApiError,
  prettyJson,
  setWorldbookDraft,
  getResources: () => state.resourceLibrary,
  confirmAction: (message) => confirm(message),
  promptAction: (message, defaultValue) => prompt(message, defaultValue),
  documentObject: document
});
const { bindEvents: bindPresetWorkspaceEvents, renderPromptEditor, renderPromptPresetFavorites, setPromptDraft } = presetWorkspaceController;
const promptStudioController = createPromptStudioController({
  state, els, apiRequest, getCurrentSessionId: () => currentSessionId, getPreviewContent: () => els.chatInput?.value || '',
  setStatus, humanizeApiError, promptAction: prompt, onIntegrityChange: () => renderSessionSettings(), onOpenCopy: async (id) => { currentSessionId = id; localStorage.setItem('localRoleplaySessionId', id); await loadState(); }, documentObject: document
});
const promptTemplateCenterController = createPromptTemplateCenterController({
  state,
  els,
  apiRequest,
  getCurrentSessionId: () => currentSessionId,
  setStatus,
  humanizeApiError,
  escapeHtmlText,
  setPromptDraft,
  confirmAction: (message) => confirm(message)
});
const {
  bindEvents: bindPromptTemplateCenterEvents
} = promptTemplateCenterController;
const personaWorkspaceController = createPersonaWorkspaceController({
  state,
  els,
  apiRequest,
  getCurrentSessionId: () => currentSessionId,
  setStatus,
  humanizeApiError
});
const {
  bindEvents: bindPersonaWorkspaceEvents,
  renderPersona
} = personaWorkspaceController;
const mcpController = createMcpController({ els, apiRequest, setStatus, escapeHtmlText });
let composerController;
let conversationStreamController;
let conversationActionsController;
let messageActionsController;
let customStoryBuilderController;
let packCompatibilityManager;
let storyOpeningController;
let journeyDraftController;
let openStoryLauncherFn = null;
let journeySetupController;
const voiceController = createVoiceController({
  state,
  els,
  setStatus,
  escapeHtmlText,
  humanizeApiError,
  insertIntoChat: (text) => composerController?.insertText(text)
});
// 聊天输入区语音听写：录音→停止→自动转写→插入输入框
const voiceDictationController = createVoiceDictationController({
  els,
  state,
  setStatus,
  insertIntoChat: (text) => composerController?.insertText(text)
});
// 消息级 TTS 朗读：朗读可见正文，同一时刻仅一条音频
const messagePlaybackController = createMessagePlaybackController({
  els,
  setStatus,
  resolveMessageSpeechText: (message) => {
    if (!message || message.role === 'user') return String(message?.content || '');
    const presentation = extractRoleplayPresentation(message.content);
    return presentation?.content || String(message.content || '');
  }
});
const vectorMemoryController = createVectorMemoryController({
  state,
  els,
  apiRequest,
  setStatus,
  getSessionId: () => currentSessionId
});
const {
  renderVectorMemoryPanel,
  saveVectorMemory,
  rebuildVectorIndex,
  testVectorSearch
} = vectorMemoryController;
const macroTemplatesController = createMacroTemplatesController({
  state,
  els,
  apiRequest,
  setStatus
});
const {
  renderMacroTemplates,
  addMacroTemplateRow,
  saveMacroTemplates,
  testMacroExpand,
  clearMacroTest
} = macroTemplatesController;
const groupMembersController = createGroupMembersController({
  state,
  els,
  apiRequest,
  getSessionId: () => currentSessionId,
  setStatus,
  humanizeApiError,
  onMembersChanged: () => composerController?.reconcileTargetSpeaker(),
  documentObject: document
});
const {
  bindEvents: bindGroupMembersEvents,
  renderGroupMembers
} = groupMembersController;
let contentPackController;
const characterCardController = createCharacterCardController({
  elements: els,
  apiRequest,
  setStatus,
  humanizeError: humanizeApiError,
  getSessionId: () => currentSessionId,
  getCharacterCard: () => state.config?.characterCard || {},
  setCharacterCard: (characterCard) => {
    state.config.characterCard = characterCard;
  },
  getCharacterPresets: () => state.config?.characterPresets || [],
  setCharacterPresets: (characterPresets) => {
    state.config.characterPresets = characterPresets;
  },
  getResources: () => state.resourceLibrary,
  getWorldBook: () => state.config?.worldBook || [],
  setWorldBook: (worldBook) => {
    state.config.worldBook = worldBook;
    if (els.worldbookEditor) els.worldbookEditor.value = prettyJson(worldBook);
  },
  getPromptModules: () => state.config?.promptModules || [],
  setPromptModules: (promptModules) => {
    state.config.promptModules = promptModules;
    if (els.promptEditor) els.promptEditor.value = prettyJson(promptModules);
  },
  getDynamicPresets: () => state.contentPackCharacterPresets,
  getStaticPresets: () => CHARACTER_PRESETS,
  getKnownContentPackIds: () => [
    ...openingGenreIds(),
    ...(state.contentPacks || []).map((pack) => pack.id)
  ],
  getAppliedContentPackId: (...args) => contentPackController.getAppliedContentPackId(...args),
  getContentPackTitle: (...args) => contentPackController.getContentPackTitle(...args),
  getContentPackGenreTitle: (packId) => getOpeningGenreOption(packId).title,
  createCharacterCardTemplate,
  createCharacterPortraitImage,
  promptAction: (message, defaultValue) => prompt(message, defaultValue),
  confirmAction: (message) => confirm(message)
});
const {
  bindEvents: bindCharacterCardEvents,
  loadContentPackCharacterPresets,
  renderCharacterPresetFavorites,
  setCharacterCardEditor
} = characterCardController;
const scriptGovernanceController = createScriptGovernanceController({
  elements: {
    auditPanel: els.sandboxAuditPanel,
    auditList: els.sandboxAuditList,
    auditEmpty: els.sandboxAuditEmpty,
    auditCount: els.sandboxAuditCount,
    status: els.sessionSettingsStatus
  },
  getSessionId: () => state.session?.id || currentSessionId || 'main',
  setSession: (session) => updateSession(session, { fallback: state.session }),
  getRuntime: () => state.session?.config?.lightFrontend || state.config?.lightFrontend || {},
  syncRuntime: (runtime) => {
    state.config.lightFrontend = runtime;
  },
  apiRequest,
  setStatus,
  onOpenAudit: openScriptAudit,
  confirmAction: (message) => confirm(message),
  humanizeError: humanizeApiError
});
const sessionHealthController = createSessionHealthController({
  state,
  els,
  apiRequest,
  getSessionId: () => currentSessionId,
  setStatus,
  humanizeError: humanizeApiError,
  onOpenScriptAudit: openScriptAudit,
  onCompatibilityUpgradeCreated: () => resourceWorkbenchController.loadResourceLibrary({ announce: false }),
  confirmAction: (message) => confirm(message),
  documentObject: document
});

function openScriptAudit(assessments = []) {
  activateWorkMode('debug', { activateDefaultTab: false });
  setWorkspacePanelExpanded('inspector', true, { syncActiveView: true });
  if (els.sandboxAuditPanel) els.sandboxAuditPanel.open = true;
  scriptGovernanceController.renderAuditPanel();
  const targetId = String(assessments[0]?.id || '');
  requestAnimationFrame(() => {
    scriptGovernanceController.focusAuditRule(targetId);
  });
}
const providerSettingsController = createProviderSettingsController({
  state,
  els,
  apiRequest,
  reloadState: () => loadState(),
  prettyJson,
  setStatus,
  humanizeApiError,
  documentObject: document
});
const {
  bindEvents: bindProviderSettingsEvents,
  renderProviderForm,
  renderProviderRoutingOptions,
  renderProviderModelOptions,
  renderProviderPresetOptions
} = providerSettingsController;
const sessionSettingsController = createSessionSettingsController({
  state,
  els,
  apiRequest,
  getSessionId: () => currentSessionId,
  replaceSession: updateSession,
  setStatus,
  humanizeApiError,
  documentObject: document
});
const {
  bindEvents: bindSessionSettingsEvents,
  renderSessionSettings,
  saveSettingsPatch
} = sessionSettingsController;
const authorNoteWorkspaceController = createAuthorNoteWorkspaceController({
  state,
  els,
  getCurrentSessionId: () => currentSessionId,
  saveSettingsPatch,
  setStatus,
  humanizeApiError
});
const {
  bindEvents: bindAuthorNoteWorkspaceEvents,
  renderAuthorNoteSettings,
  toggleAuthorNotePanel
} = authorNoteWorkspaceController;
const moduleHelpController = createModuleHelpController({
  documentObject: document,
  windowObject: window
});
const {
  bindEvents: bindModuleHelpEvents,
  closeModuleHint
} = moduleHelpController;
const releaseDataController = createReleaseDataController({
  els,
  apiRequest,
  reloadAppState: () => loadState(),
  setStatus,
  humanizeApiError,
  confirmAction: (message) => confirm(message),
  documentObject: document
});
const {
  bindEvents: bindReleaseDataEvents,
  loadReleaseState
} = releaseDataController;
const visualStageController = createVisualStageController({
  state,
  els,
  getCharacterPortraitUrl,
  saveSettingsPatch,
  setStatus,
  humanizeApiError
});
const {
  applyBackgroundImage,
  applyBackgroundUrl,
  applyTheme,
  backgroundUrlsMatch,
  clearBackgroundImage,
  getBackgroundLabelForUrl,
  normalizeTheme,
  renderBackgroundPresets,
  saveReadingMode,
  setBackgroundImage,
  toggleBackgroundPanel,
  updateBackgroundModeUi
} = visualStageController;
const openingWorkflowController = createOpeningWorkflowController({
  state,
  els,
  visualPresets: CONTENT_PACK_VISUAL_PRESETS,
  getOpeningGenreIds: openingGenreIds,
  getOpeningGenreOption,
  getCurrentSessionId: () => currentSessionId,
  getAppliedContentPackId: (...args) => contentPackController?.getAppliedContentPackId(...args) || '',
  getContentPackTitle: (...args) => contentPackController?.getContentPackTitle(...args) || String(args[1] || args[0] || ''),
  setOpeningGenre: (...args) => contentPackController?.setOpeningGenre(...args),
  applyContentPack: (...args) => contentPackController?.applyContentPack(...args),
  renderSetupPanel: (...args) => journeySetupController?.renderSetupPanel(...args),
  buildJourneyDraft: (...args) => journeyDraftController?.buildJourneyDraft(...args),
  setComposerInputValue: (...args) => composerController?.setInputValue(...args),
  sendMessage: (...args) => conversationStreamController?.sendMessage(...args),
  renderMessages: () => renderMessages(),
  applyBackgroundImage,
  saveSettingsPatch,
  mergeSession,
  setStatus,
  openProviderSettings,
  openStoryLauncher: () => openStoryLauncherFn?.(),
  backgroundUrlsMatch,
  documentObject: document
});
const {
  createOpeningErrorPanel,
  getBackgroundContentPackId,
  getContentPackVisualPreset,
  getCurrentStoryPresentation,
  inferPrologueGenreFromTemplate,
  linkContentPackVisuals,
  renderOpeningWorkflow,
  resolvePrologueTemplate,
  startGuidedJourney,
  startJourney
} = openingWorkflowController;
const mediaGenerationController = createMediaGenerationController({
  els,
  apiRequest,
  setBackgroundImage,
  setStatus,
  humanizeApiError,
  documentObject: document
});
const {
  bindEvents: bindMediaGenerationEvents
} = mediaGenerationController;
const immersiveDossierToolkit = createImmersiveDossierToolkit({
  documentObject: document,
  extractRoleplayPresentation
});
const immersiveLedgerController = createImmersiveLedgerController({
  state,
  els,
  dossier: immersiveDossierToolkit,
  resolvePrologueTemplate,
  getCurrentStoryPresentation,
  splitCharacterStatus,
  extractRoleplayPresentation,
  truncateText,
  documentObject: document
});
const immersiveSidebarController = createImmersiveSidebarController({
  state,
  els,
  dossier: immersiveDossierToolkit,
  ledgers: immersiveLedgerController,
  resolvePrologueTemplate,
  getCurrentStoryPresentation,
  getLightFrontendPanels,
  resolveLightFrontendPanel,
  getLightFrontendContext: (...args) => conversationActionsController?.getLightFrontendContext(...args) || {},
  renderSafeMarkdown,
  splitCharacterStatus,
  extractRoleplayPresentation,
  createCharacterPortraitImage,
  getCharacterPortraitUrl,
  openCharacterManagement: () => {
    activateWorkMode('settings', { activateDefaultTab: false });
    activateTab('character');
    const groupSection = els.groupMembersList?.closest?.('details');
    if (groupSection) groupSection.open = true;
    scrollInspectorIntoViewOnNarrowScreens();
  },
  truncateText,
  documentObject: document
});
const {
  bindEvents: bindImmersiveSidebarEvents,
  renderImmersiveSidebar,
  selectImmersiveSidebarTab
} = immersiveSidebarController;
let resourceImportController;
let assetCenterController;
contentPackController = createContentPackController({
  state,
  els,
  apiRequest,
  setStatus,
  humanizeApiError,
  getCurrentSessionId: () => currentSessionId,
  updateSession,
  getOpeningGenreIds: openingGenreIds,
  getOpeningGenreOption,
  loadContentPackCharacterPresets,
  getStoryStageBackground: (pack) => resolveStoryStageBackground(pack, getCharacterPortraitUrl),
  linkContentPackVisuals,
  renderAll,
  renderImmersiveSidebar,
  renderMessages,
  renderResourcePackBuilder: (...args) => resourceWorkbenchController.renderResourcePackBuilder(...args),
  getBackgroundContentPackId,
  getBackgroundLabelForUrl
});
const {
  applyContentPack,
  bindEvents: bindContentPackEvents,
  getAppliedContentPackId,
  getContentPackTitle,
  renderContentPackOptions,
  renderContentStack,
  setContentPackPreviewStatus,
  setOpeningGenre
} = contentPackController;
const pluginRegistryController = createPluginRegistryController({
  state,
  els,
  apiRequest,
  setStatus,
  humanizeApiError,
  refreshRegistry: (...args) => resourceWorkbenchController.loadResourceLibrary(...args),
  confirmAction: (message) => confirm(message)
});
const {
  bindEvents: bindPluginRegistryEvents,
  renderAdapterRegistry,
  renderPluginRegistry
} = pluginRegistryController;
const resourceWorkbenchController = createResourceWorkbenchController({
  state,
  els,
  apiRequest,
  setStatus,
  humanizeApiError,
  formatTime,
  formatTokenCount,
  createCharacterPortraitImage,
  getContentPackTitle,
  applyContentPack,
  renderContentPackOptions,
  renderPluginRegistry,
  renderAdapterRegistry,
  getAssetCenterController: () => assetCenterController,
  previewImportSourceItem: (...args) => resourceImportController.previewImportSourceItem(...args),
  onReviewPackCompatibility: (...args) => packCompatibilityManager?.act(...args)
});
const {
  activateResourceView,
  bindEvents: bindResourceWorkbenchEvents,
  loadImportSources,
  loadResourceLibrary,
  renderImportSourceOptions,
  renderResourcePackBuilder,
  renderResourceWorkbench,
  setResourceFlowStep,
  sourceLabel
} = resourceWorkbenchController;
const storyCatalogController = createStoryCatalogController({
  state,
  els,
  apiRequest,
  getContentPackVisualPreset,
  getCharacterPortraitUrl,
  createCharacterPortraitImage,
  storyPackPresentation: STORY_PACK_PRESENTATION,
  visualPackIds: new Set(Object.keys(CONTENT_PACK_VISUAL_PRESETS)),
  selectSession: (sessionId) => {
    currentSessionId = sessionId;
    localStorage.setItem('localRoleplaySessionId', currentSessionId);
  },
  closeStoryLauncher: (...args) => storyOpeningController?.closeStoryLauncher(...args),
  loadState: () => loadState(),
  linkContentPackVisuals,
  renderMessages,
  openDerivedStoryBuilder: (...args) => customStoryBuilderController?.openDerivedStoryBuilder(...args),
  onReviewPackCompatibility: (...args) => packCompatibilityManager?.act(...args),
  setStatus,
  humanizeApiError,
  storage: localStorage,
  confirmAction: (message) => window.confirm(message),
  documentObject: document,
  setTimeoutImpl: window.setTimeout.bind(window)
});
const {
  bindEvents: bindStoryCatalogEvents,
  createAndOpenStoryProject,
  getMostRecentSessionSummary,
  getStoryPackVisualId,
  renderStoryCatalogFilters,
  renderStoryContinuePanel,
  renderStoryPackGrid,
  renderStoryProjects,
  setStoryLauncherBackground
} = storyCatalogController;

customStoryBuilderController = createCustomStoryBuilderController({
  state,
  els,
  apiRequest,
  loadResourceLibrary,
  getAppliedContentPackId,
  getStoryPackVisualId,
  getCharacterPortraitUrl,
  formatTokenCount,
  humanizeApiError,
  setStatus,
  collectSelectedPromptResourceIds,
  groupPromptResources,
  importCharacterCardFile: (...args) => resourceImportController.importCharacterCardFile(...args),
  createAndOpenStoryProject
});
const {
  bindEvents: bindCustomStoryBuilderEvents,
  createStoryFromCommittedImport,
  getCompanionWorldBooks,
  invalidateCustomStoryInspection,
  openCustomStoryDialog,
  openDerivedStoryBuilder,
  persistCustomStoryDraft,
  renderCustomStoryBuilder,
  renderStoryImportBaseOptions,
  stageStoryResourcesFromCommittedImport
} = customStoryBuilderController;

packCompatibilityManager = createPackCompatibilityManager({
  apiRequest,
  onRefresh: async () => {
    await resourceWorkbenchController.loadResourceLibrary({ announce: false });
    renderStoryCatalogFilters();
    renderStoryPackGrid();
  },
  onOpenScriptReview: (preview) => customStoryBuilderController.openCompatibilityUpgradeReview(preview),
  confirmAction: (message) => window.confirm(message),
  humanizeError: humanizeApiError
});

storyOpeningController = createStoryOpeningController({
  state,
  els,
  renderStoryContinuePanel,
  renderStoryProjects,
  renderStoryImportBaseOptions,
  renderCustomStoryBuilder,
  renderStoryCatalogFilters,
  renderStoryPackGrid,
  getAppliedContentPackId,
  getMostRecentSessionSummary,
  setStoryLauncherBackground
});
const {
  closeStoryLauncher,
  initializeStoryLauncherVisibility,
  openStoryLauncher,
  renderStoryLauncher
} = storyOpeningController;
openStoryLauncherFn = openStoryLauncher;
journeyDraftController = createJourneyDraftController({
  state,
  chatInput: els.chatInput,
  setChatInputValue: (value) => composerController?.setInputValue(value),
  createOpeningErrorPanel,
  renderMessages,
  documentObject: document
});
const {
  buildJourneyDraft,
  buildJourneyWorldbookSnapshot,
  renderJourneyDraft
} = journeyDraftController;
const worldSimulationController = createWorldSimulationController({
  state,
  els,
  apiRequest,
  getCurrentSessionId: () => currentSessionId,
  parseJsonFromTextarea,
  setStatus,
  documentObject: document
});
const {
  advanceWorldSimulation,
  applyDirectorSimulationSnapshot,
  refreshWorldSimulation,
  renderWorldSimulation,
  saveSimulationActors,
  selectSimulationView
} = worldSimulationController;
const factCardsController = createFactCardsController({
  state,
  els,
  apiRequest,
  getCurrentSessionId: () => currentSessionId,
  replaceSession: updateSession,
  mergeSession,
  refreshInspector: renderInspector,
  applyPromotedWorldBook: (worldBook) => {
    state.config.worldBook = worldBook || state.config.worldBook;
    refreshInspectorSections(['contentStack', 'worldbookEditor', 'worldbookEntries']);
  },
  setStatus,
  documentObject: document
});
const {
  bindEvents: bindFactCardEvents,
  renderFacts
} = factCardsController;
journeySetupController = createJourneySetupController({
  state,
  inferPrologueGenreFromTemplate,
  getOpeningGenreOption,
  getCurrentStoryPresentation,
  canRandomizeSetupField,
  buildJourneyWorldbookSnapshot,
  generateSetupFieldValue,
  createCharacterPortraitImage,
  startJourney,
  documentObject: document,
  windowObject: window
});
const {
  renderSetupPanel
} = journeySetupController;
resourceImportController = createResourceImportController({
  state,
  els,
  apiRequest,
  getCurrentSessionId: () => currentSessionId,
  setStatus,
  humanizeApiError,
  inferMimeType,
  formatBytes,
  formatTokenCount,
  resourceKindLabel,
  setResourceFlowStep,
  loadState,
  loadResourceLibrary,
  activateTab,
  activateResourceView,
  renderStoryLauncher,
  openStoryLauncher,
  openCustomStoryDialog,
  createStoryFromCommittedImport,
  stageStoryResourcesFromCommittedImport,
  setAssetCenterStatus: (...args) => assetCenterController?.setStatus?.(...args),
  getSourceLabel: sourceLabel
});
const {
  bindEvents: bindResourceImportEvents,
  importCharacterCardFile
} = resourceImportController;
const assetLibraryController = createAssetLibraryController({
  state,
  els,
  apiRequest,
  getAssetCenterController: () => assetCenterController,
  closeStoryLauncher,
  openStoryLauncher,
  renderStoryPackGrid,
  getCharacterPortraitUrl,
  getCompanionWorldBooks,
  invalidateCustomStoryInspection,
  persistCustomStoryDraft,
  openCustomStoryDialog,
  activateWorkMode,
  activateTab,
  activateResourceView,
  renderResourcePackBuilder,
  downloadJsonFile,
  quickLaunchCharacterStory: (...args) => customStoryBuilderController.quickLaunchCharacterStory(...args)
});
const {
  deleteAssetFromCenter,
  deleteAssetsFromCenter,
  exportAssetsFromCenter,
  loadAssetRevisions,
  openAssetCenter,
  openAssetComposer,
  openAssetImportPicker,
  reevaluateAssetFromCenter,
  rollbackAssetRevision,
  saveAssetBatchMetadata,
  saveAssetContent,
  saveAssetMetadata,
  useAssetFromCenter,
  quickLaunchFromCenter
} = assetLibraryController;
const heavyFrontendRuntimeController = createHeavyFrontendRuntimeController({
  root: els.heavyFrontendManager,
  player: els.heavyFrontendPlayer,
  apiRequest,
  getProviders: () => state.config?.providers?.providers || [],
  setGlobalStatus: setStatus,
  documentObject: document,
  windowObject: window,
  confirmAction: (message) => window.confirm(message),
  promptAction: (message, value) => window.prompt(message, value)
});
assetCenterController = createAssetCenterController({
  root: els.assetCenter,
  getResources: () => state.resourceLibrary,
  getPacks: () => state.resourcePacks,
  onRefresh: () => loadResourceLibrary(),
  onImport: (kind) => kind === 'heavy-frontend'
    ? heavyFrontendRuntimeController.open({ promptImport: true })
    : openAssetImportPicker(kind),
  onUseAsset: useAssetFromCenter,
  onQuickLaunch: quickLaunchFromCenter,
  onOpenComposer: openAssetComposer,
  onReevaluateAsset: reevaluateAssetFromCenter,
  onLoadRevisions: loadAssetRevisions,
  onRollbackRevision: rollbackAssetRevision,
  onSaveMetadata: saveAssetMetadata,
  onSaveContent: saveAssetContent,
  onDeleteAsset: deleteAssetFromCenter,
  onBatchMetadata: saveAssetBatchMetadata,
  onExportAssets: exportAssetsFromCenter,
  onBatchDelete: deleteAssetsFromCenter,
  onReviewPackCompatibility: (...args) => packCompatibilityManager?.act(...args)
});
conversationActionsController = createConversationActionsController({
  state,
  els,
  apiRequest,
  getSessionId: () => currentSessionId,
  replaceSession: updateSession,
  refreshInspector: renderInspector,
  refreshImmersiveSidebar: renderImmersiveSidebar,
  setComposerInputValue: (...args) => composerController?.setInputValue(...args),
  syncComposerState: () => composerController?.syncActionState(),
  syncMessageActionState: () => messageActionsController?.syncActionState(),
  sendMessage: () => conversationStreamController?.sendMessage(),
  setStatus,
  humanizeApiError,
  documentObject: document
});
const {
  bindEvents: bindConversationActionEvents,
  decodeImmersiveAction,
  getLightFrontendContext,
  renderQuickReplies,
  rewriteChatInput,
  useRecommendedAction
} = conversationActionsController;
const messagePresentationController = createMessagePresentationController({
  state,
  createCharacterPortraitImage,
  formatTime,
  formatTokenCount,
  getLightFrontendContext,
  renderMessageContent: (...args) => scriptGovernanceController.renderMessageContent(...args),
  canSpeakMessages: () => isProviderConfigured(state.config?.providers),
  isMessageSpeaking: (messageId) => messagePlaybackController.isSpeaking(messageId),
  documentObject: document
});
const {
  createMessageNode
} = messagePresentationController;
const chatController = createChatController({
  state,
  els,
  getCurrentSessionId: () => currentSessionId,
  getCurrentSessionLabel: () => getSessionDisplayTitle(currentSessionId, state.sessionSummaries),
  applyBackgroundImage,
  renderImmersiveSidebar,
  renderJourneyDraft,
  setStatus,
  resolvePrologueTemplate,
  renderOpeningWorkflow,
  startGuidedJourney,
  createMessageNode,
  openProviderSettings
});
messageActionsController = createMessageActionsController({
  state,
  els,
  apiRequest,
  getCurrentSessionId: () => currentSessionId,
  replaceSession: updateSession,
  renderMessages,
  refreshInspector: renderInspector,
  setStatus,
  humanizeApiError,
  decodeImmersiveAction,
  onRecommendedAction: useRecommendedAction,
  onForkTimeline: (message) => timelineController.forkFromMessageDialog(message),
  onSpeakMessage: (message) => {
    // 朗读后重渲染消息列表，让按钮切换为「停止朗读」态
    Promise.resolve(messagePlaybackController.toggleMessage(message)).then(renderMessages);
  },
  promptUser: (message, initialValue) => window.prompt(message, initialValue)
});
const {
  bindEvents: bindMessageActionEvents,
  syncActionState: syncMessageActionState
} = messageActionsController;
const timelineController = createTimelineController({
  state,
  els,
  apiRequest,
  getCurrentSessionId: () => currentSessionId,
  replaceSession: updateSession,
  renderMessages,
  refreshInspector: renderInspector,
  setStatus,
  promptUser: (message, initialValue) => window.prompt(message, initialValue),
  confirmUser: (message) => window.confirm(message)
});
composerController = createComposerController({
  state,
  els,
  onSend: () => conversationStreamController?.sendMessage(),
  onContinue: () => conversationStreamController?.continueLastMessage(),
  onRewrite: rewriteChatInput,
  onStopGeneration: () => conversationStreamController?.stopGeneration(),
  onVoiceDictation: () => voiceDictationController.toggle(),
  onToggleAuthorNote: toggleAuthorNotePanel,
  onToggleBackground: toggleBackgroundPanel,
  onOpenTab: (tab) => {
    const mode = ['memory', 'health', 'status', 'facts', 'usage'].includes(tab) ? 'debug' : 'settings';
    activateWorkMode(mode, { activateDefaultTab: false });
    activateTab(tab);
    scrollInspectorIntoViewOnNarrowScreens();
  },
  onScrollLatest: () => chatController.scrollToLatest(),
  onStreamingChange: () => {
    syncMessageActionState();
    conversationActionsController.syncActionState();
  },
  setStatus,
  documentObject: document,
  windowObject: window
});
const {
  bindEvents: bindComposerEvents,
  clearInput: clearComposerInput,
  renderTargetSpeakerIndicator,
  setInputValue: setComposerInputValue,
  setStreamingState,
  syncActionState: syncComposerState
} = composerController;
conversationStreamController = createConversationStreamController({
  state,
  els,
  fetchImpl: fetch,
  getSessionId: () => currentSessionId,
  replaceSession: updateSession,
  renderMessages,
  refreshInspector: renderInspector,
  setStreamingState,
  clearComposerInput,
  setComposerInputValue,
  renderTargetSpeakerIndicator,
  captureScrollState: () => chatController.captureScrollState(),
  restoreScrollState: (snapshot) => chatController.restoreScrollState(snapshot),
  serializeValue: prettyJson,
  setStatus,
  humanizeApiError,
  documentObject: document
});

const appEventsController = createAppEventsController({
  els,
  documentObject: document,
  storage: localStorage,
  controllers: {
    assetCenter: assetCenterController,
    heavyFrontend: heavyFrontendRuntimeController,
    inspector: inspectorController,
    authoring: authoringController,
    mcp: mcpController,
    voice: voiceController
  },
  bindings: {
    storyCatalog: bindStoryCatalogEvents,
    customStoryBuilder: bindCustomStoryBuilderEvents,
    resourceImport: bindResourceImportEvents,
    resourceWorkbench: bindResourceWorkbenchEvents,
    pluginRegistry: bindPluginRegistryEvents,
    contentPack: bindContentPackEvents,
    immersiveSidebar: bindImmersiveSidebarEvents,
    usageInspector: bindUsageInspectorEvents,
    sessionHealth: () => sessionHealthController.bindEvents(),
    worldbookWorkspace: bindWorldbookWorkspaceEvents,
    presetWorkspace: bindPresetWorkspaceEvents,
    promptStudio: () => promptStudioController.bindEvents(),
    promptTemplateCenter: bindPromptTemplateCenterEvents,
    personaWorkspace: bindPersonaWorkspaceEvents,
    authorNoteWorkspace: bindAuthorNoteWorkspaceEvents,
    moduleHelp: bindModuleHelpEvents,
    factCards: bindFactCardEvents,
    providerSettings: bindProviderSettingsEvents,
    sessionSettings: bindSessionSettingsEvents,
    releaseData: bindReleaseDataEvents,
    mediaGeneration: bindMediaGenerationEvents,
    messageActions: bindMessageActionEvents,
    composer: bindComposerEvents,
    conversationActions: bindConversationActionEvents,
    characterCard: bindCharacterCardEvents,
    groupMembers: bindGroupMembersEvents,
    timeline: () => timelineController.bindEvents()
  },
  actions: {
    openAssetCenter,
    openStoryLauncher,
    closeStoryLauncher,
    openNewSessionDialog,
    setWorkspacePanelExpanded,
    activateWorkMode,
    setWorkspaceActiveView,
    saveVectorMemory,
    rebuildVectorIndex,
    testVectorSearch,
    loadState,
    applyBackgroundUrl,
    clearBackgroundImage,
    setBackgroundImage,
    selectSimulationView,
    advanceWorldSimulation,
    saveSimulationActors,
    closeModuleHint,
    saveReadingMode,
    addMacroTemplateRow,
    saveMacroTemplates,
    testMacroExpand,
    clearMacroTest,
    randomizeProtagonist,
    setCurrentSessionId: (sessionId) => {
      currentSessionId = sessionId;
    },
    exportCurrentSession,
    deleteCurrentSession,
    handleImportSessionFile,
    handleNewSessionSubmit
  }
});

appStateController = createAppStateController({
  state,
  els,
  fetchImpl: fetch,
  getCurrentSessionId: () => currentSessionId,
  getOpeningGenreIds: openingGenreIds,
  getAppliedContentPackId,
  loadTheme: loadThemePreference,
  applyTheme,
  applyBackgroundImage,
  applyDirectorSimulationSnapshot,
  renderSessionSelect,
  setAssets: (assets) => {
    window.__assets = assets;
  },
  renderContentPackOptions,
  getFullRenderers: () => [
    renderProviderForm,
    renderProviderRoutingOptions,
    renderSessionSettings,
    renderAuthorNoteSettings,
    () => scriptGovernanceController.renderAuditPanel(),
    renderVectorMemoryPanel,
    () => mcpController.render(),
    () => voiceController.render(),
    renderImportSourceOptions,
    renderMessages,
    renderInspector
  ],
  renderStoryLauncher,
  initializeStoryLauncherVisibility,
  loadContentPackCharacterPresets,
  loadUsageStats,
  setStatus,
  renderProviderPresetOptions,
  renderProviderModelOptions,
  onSessionChanged: (context) => composerController?.handleSessionChanged(context),
  bindEvents: () => appEventsController.bindEvents(),
  activateInitialWorkspace: () => activateWorkMode(loadWorkMode(), { persist: false }),
  loadImportSources,
  loadReleaseState,
  startUsagePolling
});

const readerChromeController = createReaderChromeController({
  state,
  els,
  getCurrentSessionId: () => currentSessionId,
  getSessionDisplayTitle,
  getAppliedContentPackId,
  getContentPackTitle,
  activateWorkMode,
  openImmersiveSidebarTab: selectImmersiveSidebarTab,
  setWorkspacePanelExpanded,
  activateTab,
  scrollInspectorIntoViewOnNarrowScreens
});

const displayPreferencesController = createDisplayPreferencesController({
  els,
  documentObject: document,
  storage: localStorage
});

document.addEventListener('DOMContentLoaded', () => {
  displayPreferencesController.init();
  appStateController.initialize();
});

function renderMessages() {
  chatController.renderMessages();
  syncComposerState();
  syncMessageActionState();
  readerChromeController.syncReaderChrome();
}

document.addEventListener('DOMContentLoaded', () => {
  readerChromeController.bindReaderRail();
});

const protagonistGenerator = createProtagonistGenerator({
  createCharacterCardTemplate,
  generateSetupName,
  rollFromPool,
  composeInventory
});

function randomizeProtagonist() {
  const genre = els.randomProtagonistGenre?.value || 'xuanhuan';
  const characterCard = protagonistGenerator.generateProtagonistCard(genre);
  setCharacterCardEditor(characterCard);
  setStatus(els.characterCardStatus, `已随机生成：${characterCard.name}，请审核后保存`, 'ok');
}



function activateTab(tab) {
  return inspectorController.activateTab(tab);
}
