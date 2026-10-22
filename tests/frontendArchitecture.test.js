import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  createProviderOnboardingBanner,
  isProviderConfigured,
  resolveOpeningButtonText
} from '../public/modules/chat.js';
import {
  INSPECTOR_GROUPS,
  WORLD_BOOK_ENTRY_FIELDS,
  createInspectorController,
  createInspectorTabSelectSync,
  getInspectorGroupForTab
} from '../public/modules/inspector.js';
import { createMcpController } from '../public/modules/mcp.js';
import { createVoiceController } from '../public/modules/voice.js';
import { createAuthoringController } from '../public/modules/authoring.js';
import {
  STORY_CATEGORY_LABELS,
  filterStoryPacks
} from '../public/modules/storyLauncher.js';
import { createStoryCatalogController } from '../public/modules/storyCatalog.js';
import { createWorkspaceController } from '../public/modules/workspace.js';
import {
  createStoryOpeningController,
  createStoryOpeningRandomizer
} from '../public/modules/storyOpening.js';
import { createCustomStoryBuilderController } from '../public/modules/customStoryBuilder.js';
import { createResourceImportController } from '../public/modules/resourceImport.js';
import { createResourceWorkbenchController } from '../public/modules/resourceWorkbench.js';
import { createPluginRegistryController } from '../public/modules/pluginRegistry.js';
import { createAssetLibraryController } from '../public/modules/assetLibrary.js';
import { createProviderSettingsController } from '../public/modules/providerSettings.js';
import { createSessionSettingsController } from '../public/modules/sessionSettings.js';
import { createMediaGenerationController } from '../public/modules/mediaGeneration.js';
import { createReleaseDataController } from '../public/modules/releaseData.js';
import {
  createVisualStageController,
  loadThemePreference
} from '../public/modules/visualStage.js';
import {
  createSessionController,
  formatSessionOptionLabel,
  getSessionDisplayTitle
} from '../public/modules/session.js';
import { createCharacterCardController } from '../public/modules/characterCard.js';
import { createContentPackController } from '../public/modules/contentPack.js';
import { createImmersiveDossierToolkit } from '../public/modules/immersiveDossier.js';
import { createImmersiveLedgerController } from '../public/modules/immersiveLedgers.js';
import { createImmersiveSidebarController } from '../public/modules/immersiveSidebar.js';
import {
  createJourneySetupController,
  getSetupRandomContext
} from '../public/modules/journeySetup.js';
import {
  buildJourneyPrompt,
  createJourneyDraftController,
  detectJourneyOpeningGenre
} from '../public/modules/journeyDraft.js';
import {
  createWorldSimulationController,
  formatSimulationDuration,
  renderSimulationActor
} from '../public/modules/worldSimulation.js';
import { createComposerController } from '../public/modules/composer.js';
import { createMessageActionsController } from '../public/modules/messageActions.js';
import { createConversationStreamController } from '../public/modules/conversationStream.js';
import { createMessagePresentationController } from '../public/modules/messagePresentation.js';
import { createConversationActionsController } from '../public/modules/conversationActions.js';
import { createUsageInspectorController } from '../public/modules/usageInspector.js';
import { createMemoryInspectorController } from '../public/modules/memoryInspector.js';
import { createWorldbookWorkspaceController } from '../public/modules/worldbookWorkspace.js';
import { createPresetWorkspaceController } from '../public/modules/presetWorkspace.js';
import { createPersonaWorkspaceController } from '../public/modules/personaWorkspace.js';
import { createAuthorNoteWorkspaceController } from '../public/modules/authorNoteWorkspace.js';
import { createModuleHelpController } from '../public/modules/moduleHelp.js';
import { createOpeningWorkflowController } from '../public/modules/openingWorkflow.js';
import { createSessionStateCoordinator } from '../public/modules/sessionState.js';
import { createAppStateController } from '../public/modules/appState.js';
import { createAppEventsController } from '../public/modules/appEvents.js';
import { createDomElements } from '../public/modules/domElements.js';
import { createGroupMembersController } from '../public/modules/groupMembers.js';
import { createApiRequest } from '../public/modules/apiClient.js';
import { createCharacterPresentation } from '../public/modules/characterPresentation.js';
import { downloadJsonFile, inferMimeType } from '../public/modules/browserFiles.js';
import {
  createCharacterCardTemplate,
  createWorldBookEntryTemplate
} from '../public/modules/editorDefaults.js';
import { formatTime, parseJsonFromTextarea, setStatus } from '../public/modules/uiPrimitives.js';

test('provider onboarding distinguishes usable local and remote providers', () => {
  assert.equal(isProviderConfigured({ activeProviderId: '', providers: [] }), false);
  assert.equal(isProviderConfigured({
    activeProviderId: 'local',
    providers: [{ id: 'local', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:8000/v1', model: 'qwen3' }]
  }), true);
  assert.equal(isProviderConfigured({
    activeProviderId: 'remote',
    providers: [{ id: 'remote', kind: 'openai-compatible', baseUrl: 'https://api.example.com/v1', model: 'model-name' }]
  }), false);
  assert.equal(isProviderConfigured({
    activeProviderId: 'remote',
    providers: [{ id: 'remote', kind: 'openai-compatible', baseUrl: 'https://api.example.com/v1', apiKey: '********', model: 'model-name' }]
  }), true);
  assert.equal(isProviderConfigured({
    activeProviderId: 'anthropic',
    providers: [{ id: 'anthropic', kind: 'anthropic', baseUrl: '', apiKey: '********', model: 'claude-sonnet' }]
  }), true);
  assert.equal(isProviderConfigured({
    activeProviderId: 'gemini',
    providers: [{ id: 'gemini', kind: 'gemini', baseUrl: '', apiKey: '********', model: 'gemini-pro' }]
  }), true);
  assert.equal(typeof createProviderOnboardingBanner, 'function');
});

test('opening action copy follows the active story template instead of its visual genre', () => {
  assert.equal(
    resolveOpeningButtonText({
      genre: 'xuanhuan',
      buttonText: '[ 封存当前设定 · 开始故事 ]'
    }),
    '[ 封存当前设定 · 开始故事 ]'
  );
  assert.equal(
    resolveOpeningButtonText({
      genre: 'modern',
      buttonText: '[ 查看今日委托 · 进入第一幕 ]'
    }),
    '[ 查看今日委托 · 进入第一幕 ]'
  );
  assert.equal(resolveOpeningButtonText({ genre: 'xuanhuan' }), '[ 确认当前设定 · 开始故事 ]');
});

test('inspector exposes three levels and worldbook fields have simple and advanced modes', () => {
  assert.deepEqual(Object.keys(INSPECTOR_GROUPS), ['core', 'advanced', 'debug']);
  assert.equal(getInspectorGroupForTab('worldbook'), 'core');
  assert.equal(getInspectorGroupForTab('authoring'), 'core');
  assert.equal(getInspectorGroupForTab('macro'), 'advanced');
  assert.equal(getInspectorGroupForTab('facts'), 'debug');
  assert.equal(WORLD_BOOK_ENTRY_FIELDS.length, 13);
  assert.ok(WORLD_BOOK_ENTRY_FIELDS.some((field) => field.mode === 'simple'));
  assert.ok(WORLD_BOOK_ENTRY_FIELDS.some((field) => field.mode === 'advanced'));
  assert.equal(typeof createInspectorController, 'function');
  const groupChanges = [];
  const inspector = createInspectorController({
    panel: { dataset: { inspectorGroup: 'core' }, querySelectorAll: () => [] },
    onGroupChange: (group) => groupChanges.push(group)
  });
  inspector.activateGroup('debug', { activateDefault: false, notifyMode: true });
  assert.deepEqual(groupChanges, ['debug']);
});

test('session labels favor human titles and keep message counts visible', () => {
  assert.equal(formatSessionOptionLabel('main', []), '默认会话');
  assert.equal(getSessionDisplayTitle('story-a', [{
    id: 'story-a',
    title: '雁回新卷'
  }]), '雁回新卷');
  assert.equal(formatSessionOptionLabel('story-a', [{
    id: 'story-a',
    title: '雁回新卷',
    messageCount: 12
  }]), '雁回新卷 · 12 条消息');
});

test('feature modules expose real controllers and story filtering', () => {
  assert.equal(typeof createMcpController, 'function');
  assert.equal(typeof createVoiceController, 'function');
  assert.equal(typeof createAuthoringController, 'function');
  assert.equal(STORY_CATEGORY_LABELS.xianxia, '仙侠');

  const packs = [
    { id: 'xianxia', title: '太虚仙侠', description: '仙门与因果' },
    { id: 'lingyi', title: '民俗灵异', description: '旧楼调查' }
  ];
  assert.deepEqual(filterStoryPacks(packs, { category: 'xianxia', query: '' }).map((pack) => pack.id), ['xianxia']);
  assert.deepEqual(filterStoryPacks(packs, { category: 'all', query: '调查' }).map((pack) => pack.id), ['lingyi']);
});

test('convergence controllers expose the frontend ownership boundaries', () => {
  assert.equal(typeof createWorkspaceController, 'function');
  assert.equal(typeof createStoryOpeningController, 'function');
  assert.equal(typeof createStoryOpeningRandomizer, 'function');
  assert.equal(typeof createStoryCatalogController, 'function');
  assert.equal(typeof createCustomStoryBuilderController, 'function');
  assert.equal(typeof createResourceImportController, 'function');
  assert.equal(typeof createResourceWorkbenchController, 'function');
  assert.equal(typeof createPluginRegistryController, 'function');
  assert.equal(typeof createAssetLibraryController, 'function');
  assert.equal(typeof createProviderSettingsController, 'function');
  assert.equal(typeof createSessionSettingsController, 'function');
  assert.equal(typeof createMediaGenerationController, 'function');
  assert.equal(typeof createReleaseDataController, 'function');
  assert.equal(typeof createVisualStageController, 'function');
  assert.equal(typeof createSessionController, 'function');
  assert.equal(typeof createCharacterCardController, 'function');
  assert.equal(typeof createContentPackController, 'function');
  assert.equal(typeof createImmersiveDossierToolkit, 'function');
  assert.equal(typeof createImmersiveLedgerController, 'function');
  assert.equal(typeof createImmersiveSidebarController, 'function');
  assert.equal(typeof createJourneySetupController, 'function');
  assert.equal(typeof getSetupRandomContext, 'function');
  assert.equal(typeof createJourneyDraftController, 'function');
  assert.equal(typeof buildJourneyPrompt, 'function');
  assert.equal(typeof detectJourneyOpeningGenre, 'function');
  assert.equal(typeof createWorldSimulationController, 'function');
  assert.equal(typeof formatSimulationDuration, 'function');
  assert.equal(typeof renderSimulationActor, 'function');
  assert.equal(typeof createComposerController, 'function');
  assert.equal(typeof createMessageActionsController, 'function');
  assert.equal(typeof createConversationStreamController, 'function');
  assert.equal(typeof createMessagePresentationController, 'function');
  assert.equal(typeof createConversationActionsController, 'function');
  assert.equal(typeof createUsageInspectorController, 'function');
  assert.equal(typeof createMemoryInspectorController, 'function');
  assert.equal(typeof createWorldbookWorkspaceController, 'function');
  assert.equal(typeof createPresetWorkspaceController, 'function');
  assert.equal(typeof createPersonaWorkspaceController, 'function');
  assert.equal(typeof createAuthorNoteWorkspaceController, 'function');
  assert.equal(typeof createModuleHelpController, 'function');
  assert.equal(typeof createOpeningWorkflowController, 'function');
  assert.equal(typeof createSessionStateCoordinator, 'function');
  assert.equal(typeof createAppStateController, 'function');
  assert.equal(typeof createAppEventsController, 'function');
  assert.equal(typeof createDomElements, 'function');
  assert.equal(typeof createGroupMembersController, 'function');
  assert.equal(typeof createApiRequest, 'function');
  assert.equal(typeof createCharacterPresentation, 'function');
  assert.equal(typeof createInspectorTabSelectSync, 'function');
  assert.equal(typeof loadThemePreference, 'function');
  assert.equal(typeof downloadJsonFile, 'function');
  assert.equal(typeof inferMimeType, 'function');
  assert.equal(typeof createCharacterCardTemplate, 'function');
  assert.equal(typeof createWorldBookEntryTemplate, 'function');
  assert.equal(typeof formatTime, 'function');
  assert.equal(typeof parseJsonFromTextarea, 'function');
  assert.equal(typeof setStatus, 'function');

  const visualStage = createVisualStageController({
    state: {},
    els: {},
    getCharacterPortraitUrl: () => '',
    saveSettingsPatch: async () => ({}),
    setStatus: () => {},
    humanizeApiError: String
  });
  assert.equal(typeof visualStage.backgroundUrlsMatch, 'function');
  assert.equal(typeof visualStage.getBackgroundLabelForUrl, 'function');
  assert.equal(typeof visualStage.normalizeTheme, 'function');
});

test('frontend entry imports feature modules and documents the three-step quick start', async () => {
  const app = await readFile('public/app.js', 'utf8');
  const authoring = await readFile('public/modules/authoring.js', 'utf8');
  const customStoryBuilder = await readFile('public/modules/customStoryBuilder.js', 'utf8');
  const worldBookRuntimeBudget = await readFile('public/modules/worldBookRuntimeBudget.js', 'utf8');
  const customStoryCompatibilityReview = await readFile('public/modules/customStoryCompatibilityReview.js', 'utf8');
  const storyCatalog = await readFile('public/modules/storyCatalog.js', 'utf8');
  const resourceImport = await readFile('public/modules/resourceImport.js', 'utf8');
  const resourceWorkbench = await readFile('public/modules/resourceWorkbench.js', 'utf8');
  const pluginRegistry = await readFile('public/modules/pluginRegistry.js', 'utf8');
  const contentPack = await readFile('public/modules/contentPack.js', 'utf8');
  const immersiveDossier = await readFile('public/modules/immersiveDossier.js', 'utf8');
  const immersiveLedgers = await readFile('public/modules/immersiveLedgers.js', 'utf8');
  const immersiveGrowthLedger = await readFile('public/modules/immersiveGrowthLedger.js', 'utf8');
  const immersiveMemoryLedger = await readFile('public/modules/immersiveMemoryLedger.js', 'utf8');
  const immersiveSituationLedger = await readFile('public/modules/immersiveSituationLedger.js', 'utf8');
  const immersiveTurnRecords = await readFile('public/modules/immersiveTurnRecords.js', 'utf8');
  const immersiveCharacterArchiveActions = await readFile('public/modules/immersiveCharacterArchiveActions.js', 'utf8');
  const immersiveCharacterRoster = await readFile('public/modules/immersiveCharacterRoster.js', 'utf8');
  const immersiveSidebar = await readFile('public/modules/immersiveSidebar.js', 'utf8');
  const journeySetup = await readFile('public/modules/journeySetup.js', 'utf8');
  const journeyDraft = await readFile('public/modules/journeyDraft.js', 'utf8');
  const worldSimulation = await readFile('public/modules/worldSimulation.js', 'utf8');
  const factCards = await readFile('public/modules/factCards.js', 'utf8');
  const composer = await readFile('public/modules/composer.js', 'utf8');
  const composerActionMenus = await readFile('public/modules/composerActionMenus.js', 'utf8');
  const messageActions = await readFile('public/modules/messageActions.js', 'utf8');
  const conversationStream = await readFile('public/modules/conversationStream.js', 'utf8');
  const streamingTransport = await readFile('public/modules/streamingTransport.js', 'utf8');
  const messagePresentation = await readFile('public/modules/messagePresentation.js', 'utf8');
  const agentActionCards = await readFile('public/modules/agentActionCards.js', 'utf8');
  const simulationSpaceMap = await readFile('public/modules/simulationSpaceMap.js', 'utf8');
  const conversationActions = await readFile('public/modules/conversationActions.js', 'utf8');
  const providerSettings = await readFile('public/modules/providerSettings.js', 'utf8');
  const sessionSettings = await readFile('public/modules/sessionSettings.js', 'utf8');
  const mediaGeneration = await readFile('public/modules/mediaGeneration.js', 'utf8');
  const releaseData = await readFile('public/modules/releaseData.js', 'utf8');
  const visualStageSource = await readFile('public/modules/visualStage.js', 'utf8');
  const usageInspector = await readFile('public/modules/usageInspector.js', 'utf8');
  const memoryInspector = await readFile('public/modules/memoryInspector.js', 'utf8');
  const worldbookWorkspace = await readFile('public/modules/worldbookWorkspace.js', 'utf8');
  const presetWorkspace = await readFile('public/modules/presetWorkspace.js', 'utf8');
  const presetCatalog = await readFile('public/modules/presetCatalog.js', 'utf8');
  const personaWorkspace = await readFile('public/modules/personaWorkspace.js', 'utf8');
  const authorNoteWorkspace = await readFile('public/modules/authorNoteWorkspace.js', 'utf8');
  const moduleHelp = await readFile('public/modules/moduleHelp.js', 'utf8');
  const openingWorkflow = await readFile('public/modules/openingWorkflow.js', 'utf8');
  const sessionState = await readFile('public/modules/sessionState.js', 'utf8');
  const appState = await readFile('public/modules/appState.js', 'utf8');
  const appEvents = await readFile('public/modules/appEvents.js', 'utf8');
  const domElements = await readFile('public/modules/domElements.js', 'utf8');
  const groupMembers = await readFile('public/modules/groupMembers.js', 'utf8');
  const apiClient = await readFile('public/modules/apiClient.js', 'utf8');
  const characterPresentation = await readFile('public/modules/characterPresentation.js', 'utf8');
  const browserFiles = await readFile('public/modules/browserFiles.js', 'utf8');
  const editorDefaults = await readFile('public/modules/editorDefaults.js', 'utf8');
  const uiPrimitives = await readFile('public/modules/uiPrimitives.js', 'utf8');
  const html = await readFile('public/index.html', 'utf8');
  const cssEntry = await readFile('public/styles.css', 'utf8');
  const css = (await Promise.all([
    'foundation.css',
    'asset-center.css',
    'themes.css',
    'workbench-header.css',
    'bookshelf.css',
    'workbench-shell.css',
    'immersive.css',
    'workbench.css'
  ].map((file) => readFile(`public/styles/${file}`, 'utf8')))).join('\n');
  const readme = await readFile('README.md', 'utf8');

  for (const moduleName of [
    'chat',
    'inspector',
    'mcp',
    'voice',
    'storyCatalog',
    'authoring',
    'workspace',
    'storyOpening',
    'assetLibrary',
    'providerSettings',
    'sessionSettings',
    'mediaGeneration',
    'releaseData',
    'visualStage',
    'session',
    'characterCard',
    'characterPresets',
    'protagonistGenerator',
    'customStoryBuilder',
    'resourceImport',
    'resourceWorkbench',
    'pluginRegistry',
    'contentPack',
    'immersiveDossier',
    'immersiveLedgers',
    'immersiveSidebar',
    'journeySetup',
    'journeyDraft',
    'worldSimulation',
    'factCards',
    'composer',
    'messageActions',
    'conversationStream',
    'messagePresentation',
    'conversationActions',
    'usageInspector',
    'sessionHealth',
    'memoryInspector',
    'worldbookWorkspace',
    'presetWorkspace',
    'personaWorkspace',
    'authorNoteWorkspace',
    'moduleHelp',
    'openingWorkflow',
    'sessionState',
    'appState',
    'appEvents',
    'domElements',
    'groupMembers',
    'apiClient',
    'characterPresentation',
    'browserFiles',
    'editorDefaults',
    'uiPrimitives'
  ]) {
    assert.match(app, new RegExp(`from './modules/${moduleName}\\.js'`));
  }
  assert.ok(app.split('\n').length < 1400, 'frontend entry should remain below the architecture size ceiling');
  assert.ok(usageInspector.split('\n').length < 350, 'usage inspector controller should remain bounded');
  assert.ok(memoryInspector.split('\n').length < 350, 'memory inspector controller should remain bounded');
  assert.ok(worldbookWorkspace.split('\n').length < 350, 'worldbook workspace controller should remain bounded');
  assert.ok(presetWorkspace.split('\n').length < 350, 'preset workspace controller should remain bounded');
  assert.ok(presetCatalog.split('\n').length < 250, 'built-in preset catalog should remain data-only and bounded');
  assert.ok(personaWorkspace.split('\n').length < 250, 'persona workspace controller should remain bounded');
  assert.ok(authorNoteWorkspace.split('\n').length < 200, 'author note workspace controller should remain bounded');
  assert.ok(moduleHelp.split('\n').length < 350, 'module help controller should remain bounded');
  assert.ok(openingWorkflow.split('\n').length < 350, 'opening workflow controller should remain bounded');
  assert.ok(sessionState.split('\n').length < 200, 'session state coordinator should remain bounded');
  assert.ok(appState.split('\n').length < 300, 'app state controller should remain bounded');
  assert.ok(appEvents.split('\n').length < 220, 'application event coordinator should remain bounded');
  assert.ok(domElements.split('\n').length < 150, 'DOM registry should remain declarative and bounded');
  assert.ok(groupMembers.split('\n').length < 300, 'group members controller should remain bounded');
  assert.ok(apiClient.split('\n').length < 100, 'API client should remain transport-only and bounded');
  assert.ok(characterPresentation.split('\n').length < 100, 'character presentation should remain safe and bounded');
  assert.ok(browserFiles.split('\n').length < 100, 'browser file helpers should remain bounded');
  assert.ok(editorDefaults.split('\n').length < 100, 'editor defaults should remain data-only and bounded');
  assert.ok(uiPrimitives.split('\n').length < 100, 'UI primitives should remain bounded');
  assert.match(app, /humanizeApiError,\s+truncateText\s+} from '\.\/modules\/utils\.js'/);
  assert.ok(storyCatalog.split('\n').length < 750, 'story catalog controller should remain bounded');
  assert.ok(customStoryBuilder.split('\n').length < 1500, 'custom story builder should remain a bounded feature module');
  assert.ok(worldBookRuntimeBudget.split('\n').length < 100, 'world-book runtime budget helpers should remain focused and bounded');
  assert.match(customStoryBuilder, /from '\.\/worldBookRuntimeBudget\.js'/);
  assert.ok(customStoryCompatibilityReview.split('\n').length < 250, 'custom story compatibility review should remain bounded');
  assert.match(customStoryBuilder, /from '\.\/customStoryCompatibilityReview\.js'/);
  assert.ok(resourceImport.split('\n').length < 1000, 'resource import should remain a bounded feature module');
  assert.ok(resourceWorkbench.split('\n').length < 800, 'resource workbench should remain a bounded feature module');
  assert.ok(pluginRegistry.split('\n').length < 300, 'plugin registry should remain a bounded feature module');
  assert.ok(contentPack.split('\n').length < 300, 'content pack controller should remain a bounded feature module');
  assert.ok(immersiveDossier.split('\n').length < 450, 'immersive dossier helpers should remain bounded');
  assert.ok(immersiveLedgers.split('\n').length < 400, 'immersive ledgers should remain bounded');
  assert.ok(immersiveGrowthLedger.split('\n').length < 220, 'immersive growth ledger should remain focused');
  assert.ok(immersiveMemoryLedger.split('\n').length < 140, 'immersive memory ledger should remain focused');
  assert.ok(immersiveSituationLedger.split('\n').length < 120, 'immersive situation ledger should remain focused');
  assert.ok(immersiveTurnRecords.split('\n').length < 80, 'immersive turn records should remain focused');
  assert.ok(immersiveCharacterArchiveActions.split('\n').length < 80, 'character archive actions should remain focused');
  assert.ok(immersiveCharacterRoster.split('\n').length < 100, 'character roster renderer should remain focused');
  assert.match(immersiveLedgers, /from '\.\/immersiveMemoryLedger\.js'/);
  assert.match(immersiveLedgers, /from '\.\/immersiveGrowthLedger\.js'/);
  assert.match(immersiveLedgers, /from '\.\/immersiveSituationLedger\.js'/);
  assert.match(immersiveSidebar, /from '\.\/immersiveCharacterArchiveActions\.js'/);
  assert.match(immersiveSidebar, /from '\.\/immersiveCharacterRoster\.js'/);
  assert.match(immersiveSidebar, /from '\.\/immersiveWorldRules\.js'/);
  assert.ok(immersiveSidebar.split('\n').length < 700, 'immersive sidebar orchestration should remain bounded');
  assert.ok(journeySetup.split('\n').length < 600, 'journey setup controller should remain bounded');
  assert.ok(journeyDraft.split('\n').length < 450, 'journey draft controller should remain bounded');
  assert.ok(worldSimulation.split('\n').length < 350, 'world simulation controller should remain bounded');
  assert.ok(simulationSpaceMap.split('\n').length < 120, 'simulation space map renderer should remain bounded');
  assert.match(worldSimulation, /from '\.\/simulationSpaceMap\.js'/);
  assert.ok(factCards.split('\n').length < 400, 'fact cards controller should remain bounded');
  assert.ok(composer.split('\n').length < 350, 'composer controller should remain bounded');
  assert.ok(composerActionMenus.split('\n').length < 150, 'composer action menus should remain bounded');
  assert.match(composer, /from '\.\/composerActionMenus\.js'/);
  assert.ok(messageActions.split('\n').length < 350, 'message actions controller should remain bounded');
  assert.ok(conversationStream.split('\n').length < 350, 'conversation stream controller should remain bounded');
  assert.match(conversationStream, /from '\.\/streamingActionPreview\.js'/);
  assert.match(conversationStream, /from '\.\/streamingTransport\.js'/);
  assert.ok(streamingTransport.split('\n').length < 100, 'streaming transport should remain focused and bounded');
  assert.ok(messagePresentation.split('\n').length < 320, 'message presentation controller should remain bounded');
  assert.ok(agentActionCards.split('\n').length < 60, 'agent action card renderer should remain focused and bounded');
  assert.match(messagePresentation, /from '\.\/agentActionCards\.js'/);
  assert.ok(conversationActions.split('\n').length < 450, 'conversation actions controller should remain bounded');
  assert.ok(providerSettings.split('\n').length < 520, 'provider settings controller should remain bounded');
  assert.ok(sessionSettings.split('\n').length < 250, 'session settings controller should remain bounded');
  assert.ok(mediaGeneration.split('\n').length < 200, 'media generation controller should remain bounded');
  assert.ok(releaseData.split('\n').length < 250, 'release data controller should remain bounded');
  assert.doesNotMatch(app, /function renderCustomStoryBuilder/);
  assert.doesNotMatch(app, /function renderUsageView/);
  assert.doesNotMatch(app, /async function loadUsageStats/);
  assert.doesNotMatch(app, /function startUsagePolling/);
  assert.doesNotMatch(app, /function formatUsageTask/);
  assert.doesNotMatch(app, /function getAssistantUsageRows/);
  assert.doesNotMatch(app, /let usageRefreshTimer/);
  assert.doesNotMatch(app, /function renderMemoryOverview/);
  assert.doesNotMatch(app, /function renderRuleStatus/);
  assert.doesNotMatch(app, /function getRulePathValue/);
  assert.doesNotMatch(app, /function formatRuleFieldValue/);
  assert.doesNotMatch(app, /function formatRuleRecord/);
  assert.doesNotMatch(app, /function renderGroupMembers/);
  assert.doesNotMatch(app, /function addGroupMemberRow/);
  assert.doesNotMatch(app, /async function saveGroupMembersConfig/);
  assert.doesNotMatch(app, /async function saveWorldBook/);
  assert.doesNotMatch(app, /function addWorldBookEntry/);
  assert.doesNotMatch(app, /async function testWorldbookTrigger/);
  assert.doesNotMatch(app, /function renderWorldbookTriggerResult/);
  assert.doesNotMatch(app, /function clearWorldbookTrigger/);
  assert.doesNotMatch(app, /function exportWorldbook/);
  assert.doesNotMatch(app, /async function importWorldbookFromFile/);
  assert.doesNotMatch(app, /function renderWorldbookEntries/);
  assert.doesNotMatch(app, /function editWorldbookEntry/);
  assert.doesNotMatch(app, /function deleteWorldbookEntry/);
  assert.doesNotMatch(app, /function openWorldbookEntryEditor/);
  assert.doesNotMatch(app, /function renderPromptPresetFavorites/);
  assert.doesNotMatch(app, /async function savePromptPresetFavorite/);
  assert.doesNotMatch(app, /async function applySavedPromptPreset/);
  assert.doesNotMatch(app, /async function deletePromptPresetFavorite/);
  assert.doesNotMatch(app, /function applyPromptPreset/);
  assert.doesNotMatch(app, /function applyWorldbookPreset/);
  assert.doesNotMatch(app, /async function savePromptModules/);
  assert.doesNotMatch(app, /const PROMPT_PRESETS/);
  assert.doesNotMatch(app, /const WORLDBOOK_PRESETS/);
  assert.doesNotMatch(app, /function renderPersona/);
  assert.doesNotMatch(app, /async function savePersona/);
  assert.doesNotMatch(app, /function renderAuthorNoteSettings/);
  assert.doesNotMatch(app, /function toggleAuthorNotePanel/);
  assert.doesNotMatch(app, /function updateAuthorNoteButton/);
  assert.doesNotMatch(app, /function saveAuthorNote/);
  assert.doesNotMatch(app, /const MODULE_HELP/);
  assert.doesNotMatch(app, /let moduleHintTimer/);
  assert.doesNotMatch(app, /function resolveModuleHelpKey/);
  assert.doesNotMatch(app, /function showModuleHint/);
  assert.doesNotMatch(app, /function handleModuleHelpClick/);
  assert.doesNotMatch(app, /function updateSession/);
  assert.doesNotMatch(app, /function mergeSession/);
  assert.doesNotMatch(app, /function markInspectorDirty/);
  assert.doesNotMatch(app, /function flushInspector/);
  assert.doesNotMatch(app, /function renderInspector/);
  assert.doesNotMatch(app, /async function loadState/);
  assert.doesNotMatch(app, /function renderAll/);
  assert.doesNotMatch(app, /function syncSessionVisualState/);
  assert.doesNotMatch(app, /function bindEvents\(/);
  assert.match(app, /bindEvents: \(\) => appEventsController\.bindEvents\(\)/);
  assert.doesNotMatch(app, /const els = \{/);
  assert.doesNotMatch(app, /document\.querySelector/);
  assert.match(app, /const els = createDomElements\(document\);/);
  assert.doesNotMatch(app, /async function apiRequest/);
  assert.doesNotMatch(app, /function parseJsonResponse/);
  assert.doesNotMatch(app, /function isJsonResponse/);
  assert.doesNotMatch(app, /function formatHttpError/);
  assert.match(app, /const apiRequest = createApiRequest\(\);/);
  assert.doesNotMatch(app, /function getCharacterPortraitUrl/);
  assert.doesNotMatch(app, /function createCharacterPortraitImage/);
  assert.match(app, /createCharacterPresentation\(\{ documentObject: document \}\)/);
  assert.doesNotMatch(storyCatalog, /function createCharacterPortraitImage/);
  assert.match(storyCatalog, /createCharacterPortraitImage = \(\) => null/);
  assert.doesNotMatch(app, /function downloadJsonFile/);
  assert.doesNotMatch(app, /function readFileAsDataUrl/);
  assert.doesNotMatch(app, /function inferMimeType/);
  assert.doesNotMatch(app, /function parseJsonFromTextarea/);
  assert.doesNotMatch(app, /function createWorldBookEntryTemplate/);
  assert.doesNotMatch(app, /function createCharacterCardTemplate/);
  assert.doesNotMatch(app, /function setStatus/);
  assert.doesNotMatch(app, /function normalizedNumber/);
  assert.doesNotMatch(app, /function formatTime/);
  assert.doesNotMatch(app, /function loadTheme/);
  assert.doesNotMatch(app, /function syncInspectorTabSelect/);
  assert.match(app, /const syncInspectorTabSelect = createInspectorTabSelectSync\(/);
  assert.match(app, /loadTheme: loadThemePreference/);
  assert.doesNotMatch(app, /function getCurrentContentPackSummary/);
  assert.doesNotMatch(app, /function getCurrentStoryPresentation/);
  assert.doesNotMatch(app, /function getContentPackVisualPreset/);
  assert.doesNotMatch(app, /function linkContentPackVisuals/);
  assert.doesNotMatch(app, /function renderOpeningWorkflow/);
  assert.doesNotMatch(app, /function createOpeningErrorPanel/);
  assert.doesNotMatch(app, /function startGuidedJourney/);
  assert.doesNotMatch(app, /function getCurrentPrologueGenre/);
  assert.doesNotMatch(app, /function resolvePrologueTemplate/);
  assert.doesNotMatch(app, /function inferPrologueGenreFromTemplate/);
  assert.doesNotMatch(app, /function getBoundStoryPackId/);
  assert.doesNotMatch(app, /function getBackgroundContentPackId/);
  assert.doesNotMatch(app, /async function startJourney/);
  assert.doesNotMatch(app, /function openStoryEditDialog/);
  assert.doesNotMatch(app, /async function saveStoryEdit/);
  assert.doesNotMatch(app, /async function deleteStoryProject/);
  assert.doesNotMatch(app, /async function deleteStoryPack/);
  assert.doesNotMatch(app, /function renderStoryCatalogFilters/);
  assert.doesNotMatch(app, /function renderStoryProjects/);
  assert.doesNotMatch(app, /function renderStoryPackGrid/);
  assert.doesNotMatch(app, /function createStoryPackCard/);
  assert.doesNotMatch(app, /async function createAndOpenStoryProject/);
  assert.doesNotMatch(app, /async function startStoryFromPack/);
  assert.doesNotMatch(app, /async function continueStoryProject/);
  assert.doesNotMatch(app, /async function openStorySession/);
  assert.doesNotMatch(app, /let pendingImportPayload/);
  assert.doesNotMatch(app, /function renderImportPreview/);
  assert.doesNotMatch(app, /function renderResourceWorkbench/);
  assert.doesNotMatch(app, /function searchImportSources/);
  assert.doesNotMatch(app, /renderResourcePackBaseOptions/);
  assert.doesNotMatch(app, /function renderImportSourceOptions/);
  assert.doesNotMatch(app, /function renderPluginRegistry/);
  assert.doesNotMatch(app, /function renderAdapterRegistry/);
  assert.doesNotMatch(app, /function handlePluginRegistryClick/);
  assert.doesNotMatch(app, /function renderContentPackOptions/);
  assert.doesNotMatch(app, /function handleContentPackSelectionChange/);
  assert.doesNotMatch(app, /function setOpeningGenre/);
  assert.doesNotMatch(app, /function getAppliedContentPackId/);
  assert.doesNotMatch(app, /function getContentPackTitle/);
  assert.doesNotMatch(app, /function renderContentStack/);
  assert.doesNotMatch(app, /async function applyContentPack/);
  assert.doesNotMatch(app, /function renderImmersiveSidebar/);
  assert.doesNotMatch(app, /function renderImmersiveCharacterCards/);
  assert.doesNotMatch(app, /function renderImmersiveIntelligenceLedger/);
  assert.doesNotMatch(app, /function parseImmersiveStatusFields/);
  assert.doesNotMatch(app, /function renderSetupPanel/);
  assert.doesNotMatch(app, /function appendDossierContent/);
  assert.doesNotMatch(app, /function getSetupRandomContext/);
  assert.doesNotMatch(app, /function buildJourneyWorldbookSnapshot/);
  assert.doesNotMatch(app, /function buildJourneyPrompt/);
  assert.doesNotMatch(app, /function buildJourneyDraft/);
  assert.doesNotMatch(app, /function renderJourneyDraft/);
  assert.doesNotMatch(app, /function renderWorldSimulation/);
  assert.doesNotMatch(app, /function renderSimulationActor/);
  assert.doesNotMatch(app, /async function advanceWorldSimulation/);
  assert.doesNotMatch(app, /async function saveSimulationActors/);
  assert.doesNotMatch(app, /function applyDirectorSimulationSnapshot/);
  assert.doesNotMatch(app, /function renderFacts/);
  assert.doesNotMatch(app, /async function saveFacts/);
  assert.doesNotMatch(app, /async function promoteFact/);
  assert.doesNotMatch(app, /function shouldSubmitChatInput/);
  assert.doesNotMatch(app, /function setStreamingState/);
  assert.doesNotMatch(app, /function pickTargetSpeaker/);
  assert.doesNotMatch(app, /async function editMessage/);
  assert.doesNotMatch(app, /async function regenerateMessage/);
  assert.doesNotMatch(app, /async function toggleMessageVisibility/);
  assert.doesNotMatch(app, /async function switchMessageSwipe/);
  assert.doesNotMatch(app, /async function toggleMessageBookmark/);
  assert.doesNotMatch(app, /function findMessage/);
  assert.doesNotMatch(app, /async function sendMessage/);
  assert.doesNotMatch(app, /async function continueLastMessage/);
  assert.doesNotMatch(app, /async function streamChat/);
  assert.doesNotMatch(app, /async function streamContinue/);
  assert.doesNotMatch(app, /function appendStreamingPreview/);
  assert.doesNotMatch(app, /function updateStreamingPreview/);
  assert.doesNotMatch(app, /function parseSseEvent/);
  assert.doesNotMatch(app, /function createMessageNode/);
  assert.doesNotMatch(app, /function createUsageBadge/);
  assert.doesNotMatch(app, /function createMessageTools/);
  assert.doesNotMatch(app, /function createRecommendedActionsNode/);
  assert.doesNotMatch(app, /async function useRecommendedAction/);
  assert.doesNotMatch(app, /async function rewriteChatInput/);
  assert.doesNotMatch(app, /function renderQuickRepliesBar/);
  assert.doesNotMatch(app, /function renderQuickRepliesEditor/);
  assert.doesNotMatch(app, /function getLightFrontendContext/);
  assert.doesNotMatch(app, /function renderProviderForm/);
  assert.doesNotMatch(app, /async function saveProvider/);
  assert.doesNotMatch(app, /function readProviderForm/);
  assert.doesNotMatch(app, /async function testProviderConnectionAction/);
  assert.doesNotMatch(app, /function resolveApiKeyForSave/);
  assert.doesNotMatch(app, /async function saveProviderRouting/);
  assert.doesNotMatch(app, /function getExistingProvider/);
  assert.doesNotMatch(app, /function renderSessionSettings/);
  assert.doesNotMatch(app, /async function saveSessionSettings/);
  assert.doesNotMatch(app, /async function saveNarrativeMode/);
  assert.doesNotMatch(app, /function saveSessionVisualSettings/);
  assert.doesNotMatch(app, /\/api\/session\/settings/);
  assert.doesNotMatch(app, /async function generateImageAction/);
  assert.doesNotMatch(app, /async function insertGeneratedImageAsBackground/);
  assert.doesNotMatch(app, /\/api\/image\/generate/);
  assert.doesNotMatch(app, /let lastGeneratedImageUrl/);
  assert.doesNotMatch(visualStageSource, /\/api\/session\/settings/);
  assert.doesNotMatch(app, /async function loadReleaseState/);
  assert.doesNotMatch(app, /function renderBackupOptions/);
  assert.doesNotMatch(app, /function syncBackupActions/);
  assert.doesNotMatch(app, /async function createBackupAction/);
  assert.doesNotMatch(app, /async function restoreBackupAction/);
  assert.doesNotMatch(app, /function formatBackupTime/);
  assert.doesNotMatch(app, /function formatBytes/);
  assert.match(app, /activateResourceView:\s*\(\.\.\.args\)\s*=>\s*resourceWorkbenchController\.activateResourceView\(\.\.\.args\)/);
  assert.match(app, /refreshRegistry:\s*\(\.\.\.args\)\s*=>\s*resourceWorkbenchController\.loadResourceLibrary\(\.\.\.args\)/);
  assert.match(app, /onRefresh:\s*async\s*\(\)\s*=>\s*\{[\s\S]*loadResourceLibrary\(\{ announce: false \}\);[\s\S]*renderStoryCatalogFilters\(\);[\s\S]*renderStoryPackGrid\(\);/);
  assert.match(app, /getAppliedContentPackId:\s*\(\.\.\.args\)\s*=>\s*contentPackController\.getAppliedContentPackId\(\.\.\.args\)/);
  assert.match(app, /getContentPackTitle:\s*\(\.\.\.args\)\s*=>\s*contentPackController\.getContentPackTitle\(\.\.\.args\)/);
  assert.match(app, /renderResourcePackBuilder:\s*\(\.\.\.args\)\s*=>\s*resourceWorkbenchController\.renderResourcePackBuilder\(\.\.\.args\)/);
  assert.match(customStoryBuilder, /export function createCustomStoryBuilderController/);
  assert.match(customStoryBuilder, /function renderCustomStoryBuilder/);
  assert.match(storyCatalog, /export function createStoryCatalogController/);
  assert.match(storyCatalog, /function renderStoryCatalogFilters/);
  assert.match(storyCatalog, /function renderStoryProjects/);
  assert.match(storyCatalog, /function renderStoryPackGrid/);
  assert.match(storyCatalog, /async function createAndOpenStoryProject/);
  assert.match(storyCatalog, /async function openStorySession/);
  assert.match(storyCatalog, /function bindEvents/);
  assert.match(storyCatalog, /from '\.\/storyLauncher\.js'/);
  assert.match(usageInspector, /export function createUsageInspectorController/);
  assert.match(usageInspector, /function renderUsageView/);
  assert.match(usageInspector, /async function loadUsageStats/);
  assert.match(usageInspector, /function startPolling/);
  assert.match(memoryInspector, /export function createMemoryInspectorController/);
  assert.match(memoryInspector, /function renderMemoryOverview/);
  assert.match(memoryInspector, /function renderRuleStatus/);
  assert.match(memoryInspector, /export function getRulePathValue/);
  assert.match(memoryInspector, /export function resolveCurrentLocation/);
  assert.match(memoryInspector, /export function formatRuleFieldValue/);
  assert.doesNotMatch(memoryInspector, /innerHTML\s*=/);
  assert.match(worldbookWorkspace, /export function createWorldbookWorkspaceController/);
  assert.match(worldbookWorkspace, /async function saveWorldBook/);
  assert.match(worldbookWorkspace, /function addWorldBookEntry/);
  assert.match(worldbookWorkspace, /async function testWorldbookTrigger/);
  assert.match(worldbookWorkspace, /async function importWorldbookFromFile/);
  assert.match(worldbookWorkspace, /function bindEvents/);
  assert.doesNotMatch(worldbookWorkspace, /innerHTML\s*=/);
  assert.match(app, /worldbookWorkspace:\s*bindWorldbookWorkspaceEvents/);
  assert.match(presetWorkspace, /export function createPresetWorkspaceController/);
  assert.match(presetWorkspace, /async function savePromptPresetFavorite/);
  assert.match(presetWorkspace, /async function applySavedPromptPreset/);
  assert.match(presetWorkspace, /async function savePromptModules/);
  assert.match(presetWorkspace, /function bindEvents/);
  assert.doesNotMatch(presetWorkspace, /innerHTML\s*=/);
  assert.match(presetCatalog, /export const PROMPT_PRESETS/);
  assert.match(presetCatalog, /export const WORLDBOOK_PRESETS/);
  assert.match(app, /presetWorkspace:\s*bindPresetWorkspaceEvents/);
  assert.match(personaWorkspace, /export function createPersonaWorkspaceController/);
  assert.match(personaWorkspace, /export function readPersonaDraft/);
  assert.match(personaWorkspace, /async function savePersona/);
  assert.match(personaWorkspace, /function renderPersona/);
  assert.match(personaWorkspace, /function bindEvents/);
  assert.match(app, /personaWorkspace:\s*bindPersonaWorkspaceEvents/);
  assert.match(authorNoteWorkspace, /export function createAuthorNoteWorkspaceController/);
  assert.match(authorNoteWorkspace, /function renderAuthorNoteSettings/);
  assert.match(authorNoteWorkspace, /function saveAuthorNote/);
  assert.match(authorNoteWorkspace, /function toggleAuthorNotePanel/);
  assert.match(authorNoteWorkspace, /function bindEvents/);
  assert.doesNotMatch(authorNoteWorkspace, /innerHTML\s*=/);
  assert.match(app, /authorNoteWorkspace:\s*bindAuthorNoteWorkspaceEvents/);
  assert.match(moduleHelp, /export const MODULE_HELP/);
  assert.match(moduleHelp, /export function resolveModuleHelpKey/);
  assert.match(moduleHelp, /export function createModuleHelpController/);
  assert.match(moduleHelp, /function showModuleHint/);
  assert.match(moduleHelp, /function handleModuleHelpClick/);
  assert.doesNotMatch(moduleHelp, /innerHTML\s*=/);
  assert.match(app, /moduleHelp:\s*bindModuleHelpEvents/);
  assert.match(openingWorkflow, /export function createOpeningWorkflowController/);
  assert.match(openingWorkflow, /function linkContentPackVisuals/);
  assert.match(openingWorkflow, /function renderOpeningWorkflow/);
  assert.match(openingWorkflow, /function resolvePrologueTemplate/);
  assert.match(openingWorkflow, /async function startJourney/);
  assert.doesNotMatch(openingWorkflow, /innerHTML\s*=/);
  assert.match(sessionState, /export const SESSION_INSPECTOR_SECTIONS/);
  assert.match(sessionState, /export function createSessionStateCoordinator/);
  assert.match(sessionState, /function replaceSession/);
  assert.match(sessionState, /function mergeSession/);
  assert.match(sessionState, /function flushInspector/);
  assert.match(sessionState, /queue\.slice\(index\)/);
  assert.match(appState, /export function buildAppStateRequestPaths/);
  assert.match(appState, /export function createAppStateController/);
  assert.match(appState, /async function loadState/);
  assert.match(appState, /function renderAll/);
  assert.match(appState, /function syncSessionVisualState/);
  assert.match(appState, /version === loadVersion/);
  assert.match(authoring, /replaceSession\(payload\.session, \{ fallback: state\.session \}\)/);
  assert.doesNotMatch(authoring, /state\.session\s*=/);
  assert.match(groupMembers, /export function createGroupMembersController/);
  assert.match(groupMembers, /export function getEnabledGroupMemberNames/);
  assert.match(groupMembers, /function renderGroupMembers/);
  assert.match(groupMembers, /async function saveGroupMembersConfig/);
  assert.match(groupMembers, /function bindEvents/);
  assert.doesNotMatch(groupMembers, /innerHTML\s*=/);
  assert.match(app, /groupMembers:\s*bindGroupMembersEvents/);
  assert.match(app, /usageInspector:\s*bindUsageInspectorEvents/);
  assert.match(app, /storyCatalog:\s*bindStoryCatalogEvents/);
  assert.match(resourceImport, /export function createResourceImportController/);
  assert.match(resourceImport, /function renderImportPreview/);
  assert.match(resourceWorkbench, /export function createResourceWorkbenchController/);
  assert.match(resourceWorkbench, /function renderResourceWorkbench/);
  assert.match(resourceWorkbench, /function searchImportSources/);
  assert.match(pluginRegistry, /export function createPluginRegistryController/);
  assert.match(pluginRegistry, /function renderPluginRegistry/);
  assert.match(pluginRegistry, /function renderAdapterRegistry/);
  assert.match(contentPack, /export function createContentPackController/);
  assert.match(contentPack, /async function applyContentPack/);
  assert.match(contentPack, /function renderContentStack/);
  assert.match(immersiveDossier, /export function createImmersiveDossierToolkit/);
  assert.match(immersiveLedgers, /export function createImmersiveLedgerController/);
  assert.match(immersiveGrowthLedger, /export function createImmersiveGrowthLedger/);
  assert.match(immersiveSidebar, /export function createImmersiveSidebarController/);
  assert.match(app, /getLightFrontendContext:\s*\(\.\.\.args\)\s*=>\s*conversationActionsController\?\.getLightFrontendContext\(\.\.\.args\)/);
  assert.match(app, /immersiveSidebar:\s*bindImmersiveSidebarEvents/);
  assert.match(journeySetup, /export function createJourneySetupController/);
  assert.match(journeySetup, /function renderSetupPanel/);
  assert.match(journeySetup, /function appendDossierContent/);
  assert.match(journeyDraft, /export function createJourneyDraftController/);
  assert.match(journeyDraft, /export function buildJourneyPrompt/);
  assert.match(journeyDraft, /function buildJourneyWorldbookSnapshot/);
  assert.match(journeyDraft, /function renderJourneyDraft/);
  assert.match(worldSimulation, /export function createWorldSimulationController/);
  assert.match(worldSimulation, /export function renderSimulationActor/);
  assert.match(worldSimulation, /async function advanceWorldSimulation/);
  assert.match(worldSimulation, /async function saveSimulationActors/);
  assert.match(factCards, /export function createFactCardsController/);
  assert.match(factCards, /function renderFacts/);
  assert.match(factCards, /async function saveFacts/);
  assert.match(factCards, /async function promoteFact/);
  assert.match(composer, /export function createComposerController/);
  assert.match(composer, /export function shouldSubmitChatInput/);
  assert.match(composer, /function setStreamingState/);
  assert.match(composer, /function pickTargetSpeaker/);
  assert.match(messageActions, /export function createMessageActionsController/);
  assert.match(messageActions, /export function getSwipeTargetIndex/);
  assert.match(messageActions, /function runMutation/);
  assert.match(messageActions, /function handleMessageClick/);
  assert.match(conversationStream, /export function createConversationStreamController/);
  assert.match(streamingTransport, /export async function readSseResponse/);
  assert.match(conversationStream, /function appendStreamingPreview/);
  assert.match(conversationStream, /async function sendMessage/);
  assert.match(conversationStream, /async function continueLastMessage/);
  assert.match(messagePresentation, /export function createMessagePresentationController/);
  assert.match(messagePresentation, /function createMessageNode/);
  assert.match(messagePresentation, /function createSwipeSwitcher/);
  assert.match(messagePresentation, /function createMessageTools/);
  assert.match(messagePresentation, /function createRecommendedActionsNode/);
  assert.match(conversationActions, /export function createConversationActionsController/);
  assert.match(conversationActions, /async function useRecommendedAction/);
  assert.match(conversationActions, /async function rewriteChatInput/);
  assert.match(conversationActions, /function renderQuickRepliesBar/);
  assert.match(conversationActions, /function renderQuickRepliesEditor/);
  assert.match(conversationActions, /function setActionPending/);
  assert.match(providerSettings, /export function createProviderSettingsController/);
  assert.match(providerSettings, /function renderProviderForm/);
  assert.match(providerSettings, /function readProviderForm/);
  assert.match(providerSettings, /async function saveProvider/);
  assert.match(providerSettings, /async function testProviderConnection/);
  assert.match(providerSettings, /async function saveProviderRouting/);
  assert.match(providerSettings, /function renderProviderRoutingOptions/);
  assert.match(providerSettings, /let operationPending = false/);
  assert.match(sessionSettings, /export function createSessionSettingsController/);
  assert.match(sessionSettings, /function renderSessionSettings/);
  assert.match(sessionSettings, /async function saveSessionProvider/);
  assert.match(sessionSettings, /async function saveNarrativeMode/);
  assert.match(sessionSettings, /function saveSettingsPatch/);
  assert.match(sessionSettings, /let settingsWriteTail = Promise\.resolve\(\)/);
  assert.match(sessionSettings, /let operationPending = false/);
  assert.match(app, /sessionSettings:\s*bindSessionSettingsEvents/);
  assert.match(mediaGeneration, /export function createMediaGenerationController/);
  assert.match(mediaGeneration, /export function resolveGeneratedImageSource/);
  assert.match(mediaGeneration, /async function generateImage/);
  assert.match(mediaGeneration, /async function applyGeneratedImageAsBackground/);
  assert.match(mediaGeneration, /let operationPending = false/);
  assert.doesNotMatch(mediaGeneration, /innerHTML\s*=/);
  assert.match(app, /mediaGeneration:\s*bindMediaGenerationEvents/);
  assert.match(releaseData, /export function createReleaseDataController/);
  assert.match(releaseData, /async function loadReleaseState/);
  assert.match(releaseData, /async function createBackup/);
  assert.match(releaseData, /async function restoreBackup/);
  assert.match(releaseData, /function syncBackupActions/);
  assert.match(releaseData, /let operationPending = false/);
  assert.match(app, /createMessageNode\s*\n?\s*\}\s*=\s*messagePresentationController/);
  assert.match(app, /applyPromotedWorldBook:[\s\S]*refreshInspectorSections\(\['contentStack', 'worldbookEditor', 'worldbookEntries'\]\)/);
  assert.match(app, /insertIntoChat:\s*\(text\)\s*=>\s*composerController\?\.insertText\(text\)/);
  assert.match(app, /setChatInputValue:\s*\(value\)\s*=>\s*composerController\?\.setInputValue\(value\)/);
  assert.match(app, /bindEvents:\s*bindComposerEvents/);
  assert.match(app, /bindEvents:\s*bindMessageActionEvents/);
  assert.match(app, /bindEvents:\s*bindConversationActionEvents/);
  assert.match(app, /bindEvents:\s*bindProviderSettingsEvents/);
  assert.match(app, /providerSettings:\s*bindProviderSettingsEvents/);
  assert.match(app, /bindEvents:\s*bindReleaseDataEvents/);
  assert.match(app, /releaseData:\s*bindReleaseDataEvents/);
  assert.match(app, /import \{\s*createReleaseDataController,\s*formatBytes\s*\} from '\.\/modules\/releaseData\.js';/);
  assert.match(app, /onStreamingChange:\s*\(\)\s*=>\s*\{[\s\S]*syncMessageActionState\(\);[\s\S]*conversationActionsController\.syncActionState\(\);/);
  assert.match(app, /onSend:\s*\(\)\s*=>\s*conversationStreamController\?\.sendMessage\(\)/);
  assert.match(app, /onContinue:\s*\(\)\s*=>\s*conversationStreamController\?\.continueLastMessage\(\)/);
  assert.match(conversationStream, /setComposerInputValue\(content,\s*\{\s*pendingQuickReply\s*\}/);
  assert.match(html, /data-inspector-group="core"/);
  assert.match(html, /data-inspector-group="advanced"/);
  assert.match(html, /data-inspector-group="debug"/);
  assert.match(html, /data-open-provider-section="vector-memory-panel"/);
  assert.match(html, /data-open-provider-section="mcp-panel"/);
  assert.match(html, /data-pane="authoring"/);
  assert.match(html, /id="authoring-agent-profile"/);
  assert.match(css, /\.provider-onboarding-banner\s*\{/);
  assert.match(css, /\.inspector-panel \.tab-button\[hidden\]\s*\{[\s\S]*display:\s*none\s*!important;/);
  assert.match(css, /\.wb-editor-mode-switch\s*\{/);
  assert.match(css, /\.inspector-panel\.authoring-workbench-open \.content-stack-summary/);
  assert.match(cssEntry, /@import url\('\.\/styles\/asset-center\.css'\);/);
  assert.match(cssEntry, /@import url\('\.\/styles\/bookshelf\.css'\);/);
  assert.match(cssEntry, /@import url\('\.\/styles\/immersive\.css'\);/);
  assert.match(cssEntry, /@import url\('\.\/styles\/themes\.css'\);/);
  assert.match(readme, /## 快速开始（3 步）/);
  assert.match(readme, /1\. 启动本地服务/);
  assert.match(readme, /2\. 配置 Provider/);
  assert.match(readme, /3\. 选择剧本并入局/);
});
