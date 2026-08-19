function call(action, ...args) {
  return typeof action === 'function' ? action(...args) : undefined;
}

function bind(element, eventName, handler) {
  if (!element || typeof element.addEventListener !== 'function') return;
  element.addEventListener(eventName, handler);
}
export function createAppEventsController({
  els = {},
  documentObject = globalThis.document,
  storage = globalThis.localStorage,
  controllers = {},
  bindings = {},
  actions = {}
} = {}) {
  if (!documentObject || typeof documentObject.addEventListener !== 'function') {
    throw new TypeError('A DOM document with event APIs is required');
  }
  let bound = false;

  function bindStoryFeatureEvents() {
    [
      bindings.storyCatalog,
      bindings.customStoryBuilder,
      bindings.resourceImport,
      bindings.resourceWorkbench,
      bindings.pluginRegistry,
      bindings.contentPack,
      bindings.immersiveSidebar
    ].forEach(call);
  }
  function bindInspectorFeatureEvents() {
    controllers.inspector?.bindEvents?.();
    [
      bindings.usageInspector,
      bindings.sessionHealth,
      bindings.worldbookWorkspace,
      bindings.presetWorkspace,
      bindings.promptStudio,
      bindings.promptTemplateCenter,
      bindings.personaWorkspace,
      bindings.authorNoteWorkspace,
      bindings.moduleHelp
    ].forEach(call);
    controllers.authoring?.bindEvents?.();
    call(bindings.factCards);
    controllers.authoring?.loadProfiles?.();
  }
  function bindProviderFeatureEvents() {
    [
      bindings.providerSettings,
      bindings.sessionSettings,
      bindings.releaseData,
      bindings.mediaGeneration
    ].forEach(call);
  }
  function bindConversationFeatureEvents() {
    controllers.mcp?.bindEvents?.();
    controllers.voice?.bindEvents?.();
    [
      bindings.messageActions,
      bindings.composer,
      bindings.conversationActions
    ].forEach(call);
  }
  function bindStoryEntryEvents() {
    bind(els.openAssetCenter, 'click', () => call(actions.openAssetCenter));
    bind(els.openStoryLauncher, 'click', () => call(actions.openStoryLauncher));
    bind(els.closeStoryLauncher, 'click', () => call(actions.closeStoryLauncher));
  }
  function bindPanelEvents() {
    bind(els.openAdvancedSession, 'click', () => {
      call(actions.closeStoryLauncher);
      call(actions.openNewSessionDialog);
    });
    bind(els.openProviderPanel, 'click', () => call(actions.setWorkspacePanelExpanded, 'provider', true));
    bind(els.toggleProviderPanel, 'click', () => call(actions.setWorkspacePanelExpanded, 'provider', false));
    bind(els.openInspectorPanel, 'click', () => call(actions.setWorkspacePanelExpanded, 'inspector', true));
    bind(els.toggleInspectorPanel, 'click', () => call(actions.setWorkspacePanelExpanded, 'inspector', false));
    bind(els.exitImmersiveMode, 'click', () => call(actions.activateWorkMode, 'creative'));
  }

  function bindNavigationEvents() {
    (els.workModeButtons || []).forEach((button) => {
      bind(button, 'click', () => call(actions.activateWorkMode, button.dataset.workMode));
    });
    (els.mobileNavButtons || []).forEach((button) => {
      bind(button, 'click', () => {
        if (button.dataset.mobileMode) {
          call(actions.activateWorkMode, button.dataset.mobileMode, { syncMobileNav: false });
        }
        if (button.dataset.mobileView === 'provider') {
          call(actions.setWorkspacePanelExpanded, 'provider', true);
        } else if (button.dataset.mobileView === 'inspector') {
          call(actions.setWorkspacePanelExpanded, 'inspector', true);
        } else {
          call(actions.setWorkspaceActiveView, 'chat');
        }
      });
    });
  }

  function bindVectorEvents() {
    bind(els.saveVectorMemory, 'click', (event) => call(actions.saveVectorMemory, event));
    bind(els.rebuildVectorIndex, 'click', (event) => call(actions.rebuildVectorIndex, event));
    bind(els.vectorSearchTest, 'click', (event) => call(actions.testVectorSearch, event));
  }

  function bindNarrativeToolEvents() {
    bind(els.refreshState, 'click', () => call(actions.loadState));
    bind(els.applyBackgroundUrl, 'click', () => call(actions.applyBackgroundUrl));
    bind(els.clearBackground, 'click', () => call(actions.clearBackgroundImage));
    bind(els.backgroundPresets, 'click', (event) => {
      const preset = event.target.closest('[data-bg-preset]');
      if (!preset) return;
      call(actions.setBackgroundImage, preset.dataset.bgPreset, {
        fit: preset.dataset.bgFit || 'cover',
        source: preset.dataset.bgSource || 'preset'
      });
    });
    bind(els.simulationViewSwitch, 'click', (event) => {
      const button = event.target.closest('[data-simulation-view]');
      if (button) call(actions.selectSimulationView, button.dataset.simulationView);
    });
    (els.simulationAdvanceButtons || []).forEach((button) => {
      bind(button, 'click', () => (
        call(actions.advanceWorldSimulation, Number(button.dataset.simulationAdvance))
      ));
    });
    bind(els.saveSimulationActors, 'click', (event) => call(actions.saveSimulationActors, event));
  }

  function bindCreatorToolEvents() {
    bind(els.themeSelect, 'change', () => call(actions.saveReadingMode, els.themeSelect.value));
    bind(els.addMacroTemplate, 'click', () => call(actions.addMacroTemplateRow));
    bind(els.saveMacroTemplates, 'click', (event) => call(actions.saveMacroTemplates, event));
    bind(els.macroTestRun, 'click', (event) => call(actions.testMacroExpand, event));
    bind(els.macroTestClear, 'click', (event) => call(actions.clearMacroTest, event));
    call(bindings.characterCard);
    call(bindings.groupMembers);
    call(bindings.timeline);
    bind(els.randomProtagonist, 'click', () => call(actions.randomizeProtagonist));
  }

  function bindSessionEvents() {
    bind(els.sessionSelect, 'change', () => {
      const sessionId = els.sessionSelect.value;
      call(actions.setCurrentSessionId, sessionId);
      storage?.setItem?.('localRoleplaySessionId', sessionId);
      call(actions.loadState);
    });
    bind(els.openNewSession, 'click', () => call(actions.openStoryLauncher));
    bind(els.exportSession, 'click', (event) => call(actions.exportCurrentSession, event));
    bind(els.importSession, 'click', () => els.importSessionFile?.click());
    bind(els.deleteSession, 'click', () => call(actions.deleteCurrentSession));
    bind(els.importSessionFile, 'change', (event) => call(actions.handleImportSessionFile, event));
    bind(els.newSessionForm, 'submit', (event) => call(actions.handleNewSessionSubmit, event));
    bind(els.newSessionCancel, 'click', () => els.newSessionDialog?.close());
  }

  function bindGlobalEvents() {
    documentObject.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (els.storyLauncher && !els.storyLauncher.classList.contains('is-hidden')) {
        call(actions.closeStoryLauncher);
        return;
      }
      call(actions.closeModuleHint);
      if (els.workspace?.dataset.workMode === 'immersive') {
        call(actions.activateWorkMode, 'creative');
      }
    });
  }

  function bindEvents() {
    if (bound) return false;
    bound = true;
    controllers.assetCenter?.bindEvents?.();
    controllers.heavyFrontend?.bindEvents?.();
    bindStoryEntryEvents();
    bindStoryFeatureEvents();
    bindPanelEvents();
    bindInspectorFeatureEvents();
    bindProviderFeatureEvents();
    bindVectorEvents();
    bindConversationFeatureEvents();
    bindNarrativeToolEvents();
    bindGlobalEvents();
    bindCreatorToolEvents();
    bindSessionEvents();
    bindNavigationEvents();
    return true;
  }

  return {
    bindEvents,
    isBound: () => bound
  };
}
