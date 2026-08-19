import { mergePackCompatibilityOverview } from './packCompatibility.js';

export function buildAppStateRequestPaths(sessionId) {
  const safeSessionId = encodeURIComponent(String(sessionId || 'main'));
  return {
    state: `/api/state?sessionId=${safeSessionId}`,
    sessions: '/api/sessions',
    storyProjects: '/api/story-projects',
    assets: '/api/assets',
    prologue: '/prologue-template.json',
    resources: '/api/resource-library/resources',
    resourcePacks: '/api/resource-library/packs',
    packCompatibilityOverview: '/api/resource-library/packs/compatibility-overview',
    adapters: '/api/resource-library/adapters',
    contentPacks: '/api/content-packs',
    plugins: '/api/plugins',
    simulation: `/api/sessions/${safeSessionId}/simulation?view=director`,
    health: `/api/sessions/${safeSessionId}/health`
  };
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function readOptionalJson(result) {
  if (result?.status !== 'fulfilled' || !result.value?.ok) return null;
  try {
    return await result.value.json();
  } catch {
    return null;
  }
}

async function readRequiredState(result) {
  if (result?.status !== 'fulfilled' || !result.value?.ok) {
    throw new Error('Failed to load state');
  }
  const payload = await result.value.json();
  if (!isRecord(payload)) throw new Error('Invalid state payload');
  return payload;
}

export function createAppStateController({
  state = {},
  els = {},
  fetchImpl = globalThis.fetch,
  getCurrentSessionId = () => 'main',
  getOpeningGenreIds = () => [],
  getAppliedContentPackId = () => '',
  loadTheme = () => 'eye-care',
  applyTheme = () => {},
  applyBackgroundImage = () => {},
  applyDirectorSimulationSnapshot = () => {},
  renderSessionSelect = () => {},
  setAssets = () => {},
  renderContentPackOptions = () => {},
  getFullRenderers = () => [],
  renderStoryLauncher = () => {},
  initializeStoryLauncherVisibility = () => {},
  loadContentPackCharacterPresets = async () => [],
  loadUsageStats = () => {},
  setStatus = () => {},
  renderProviderPresetOptions = () => {},
  renderProviderModelOptions = () => {},
  onSessionChanged = () => {},
  bindEvents = () => {},
  activateInitialWorkspace = () => {},
  loadImportSources = () => {},
  loadReleaseState = () => {},
  startUsagePolling = () => {}
} = {}) {
  let loadVersion = 0;
  let pendingLoadCount = 0;
  let initialized = false;

  function isCurrentLoad(version, sessionId) {
    return version === loadVersion
      && String(getCurrentSessionId() || 'main') === sessionId;
  }

  function syncRefreshState() {
    if (els.refreshState) els.refreshState.disabled = pendingLoadCount > 0;
  }

  function syncSessionVisualState() {
    const openingGenreIds = getOpeningGenreIds();
    const genreIds = Array.isArray(openingGenreIds) ? openingGenreIds : [];
    const knownGenreIds = new Set(genreIds);
    const visualContentPack = state.session?.settings?.visualContentPack;
    const sessionGenre = state.session?.memory?.worldState?.flags?.genre;
    const resourcePack = state.session?.memory?.resourcePackId
      || state.session?.memory?.ruleSystem?.contentPackId;
    const knownPackIds = new Set([
      ...genreIds,
      ...(state.contentPacks || []).map((pack) => pack.id)
    ]);
    const restoredPack = knownPackIds.has(resourcePack)
      ? resourcePack
      : (knownGenreIds.has(visualContentPack)
          ? visualContentPack
          : (knownGenreIds.has(sessionGenre) ? sessionGenre : ''));

    if (els.contentPackSelect) {
      els.contentPackSelect.value = restoredPack || '';
      if (restoredPack) els.contentPackSelect.dataset.userSelected = 'true';
      else delete els.contentPackSelect.dataset.userSelected;
    }
    if (els.randomProtagonistGenre) {
      const visualGenre = knownGenreIds.has(visualContentPack)
        ? visualContentPack
        : (knownGenreIds.has(sessionGenre) ? sessionGenre : '');
      els.randomProtagonistGenre.value = visualGenre || genreIds[0] || 'xuanhuan';
    }

    applyBackgroundImage(
      state.session?.settings?.backgroundImage || '',
      state.session?.settings?.backgroundFit || 'cover'
    );
  }

  function renderAll() {
    syncSessionVisualState();
    const renderers = getFullRenderers() || [];
    renderers.forEach((render) => {
      if (typeof render === 'function') render();
    });
  }

  function resetSessionScopedUiState(previousSessionId, nextSessionId) {
    if (!previousSessionId || previousSessionId === nextSessionId) return false;
    state.pendingJourneyDraft = null;
    state.pendingQuickReply = null;
    state.targetSpeaker = '';
    state.openingError = '';
    state.immersiveSidebarTab = '';
    state.conversationActionPending = false;
    state.chatStreaming = false;
    state.chatStreamPhase = '';
    onSessionChanged({ previousSessionId, nextSessionId });
    return true;
  }

  async function loadState() {
    const version = ++loadVersion;
    const sessionId = String(getCurrentSessionId() || 'main');
    const previousSessionId = String(state.session?.id || '');
    pendingLoadCount += 1;
    syncRefreshState();

    try {
      const paths = buildAppStateRequestPaths(sessionId);
      const entries = Object.entries(paths);
      const settled = await Promise.allSettled(
        entries.map(([, path]) => fetchImpl(path))
      );
      if (!isCurrentLoad(version, sessionId)) return { status: 'stale', sessionId };

      const results = Object.fromEntries(
        entries.map(([key], index) => [key, settled[index]])
      );
      const payload = await readRequiredState(results.state);
      const [
        sessionsPayload,
        storyProjectsPayload,
        assetsPayload,
        prologuePayload,
        resourcesPayload,
        resourcePacksPayload,
        packCompatibilityOverviewPayload,
        adaptersPayload,
        contentPacksPayload,
        pluginsPayload,
        simulationPayload,
        healthPayload
      ] = await Promise.all([
        readOptionalJson(results.sessions),
        readOptionalJson(results.storyProjects),
        readOptionalJson(results.assets),
        readOptionalJson(results.prologue),
        readOptionalJson(results.resources),
        readOptionalJson(results.resourcePacks),
        readOptionalJson(results.packCompatibilityOverview),
        readOptionalJson(results.adapters),
        readOptionalJson(results.contentPacks),
        readOptionalJson(results.plugins),
        readOptionalJson(results.simulation),
        readOptionalJson(results.health)
      ]);
      if (!isCurrentLoad(version, sessionId)) return { status: 'stale', sessionId };

      Object.assign(state, payload);
      resetSessionScopedUiState(previousSessionId, String(state.session?.id || sessionId));
      if (prologuePayload) state.prologueTemplate = prologuePayload;
      state.simulationPublicSnapshot = null;
      if (simulationPayload) {
        applyDirectorSimulationSnapshot(simulationPayload.snapshot);
      }
      state.sessionHealth = healthPayload?.health || null;

      state.sessionSummaries = Array.isArray(sessionsPayload?.sessionSummaries)
        ? sessionsPayload.sessionSummaries
        : [];
      renderSessionSelect(
        Array.isArray(sessionsPayload?.sessions) ? sessionsPayload.sessions : [],
        state.sessionSummaries
      );

      state.storyProjects = Array.isArray(storyProjectsPayload?.projects)
        ? storyProjectsPayload.projects
        : [];
      if (Array.isArray(assetsPayload?.assets)) setAssets(assetsPayload.assets);
      if (Array.isArray(resourcesPayload?.resources)) state.resourceLibrary = resourcesPayload.resources;
      state.resourcePackCompatibilityOverview = packCompatibilityOverviewPayload;
      if (Array.isArray(resourcePacksPayload?.packs)) {
        state.resourcePacks = mergePackCompatibilityOverview(
          resourcePacksPayload.packs,
          packCompatibilityOverviewPayload
        );
      }
      if (Array.isArray(adaptersPayload?.adapters)) state.resourceAdapters = adaptersPayload.adapters;
      if (Array.isArray(contentPacksPayload?.contentPacks)) {
        state.contentPacks = mergePackCompatibilityOverview(
          contentPacksPayload.contentPacks,
          packCompatibilityOverviewPayload
        );
      }
      if (Array.isArray(pluginsPayload?.plugins)) state.plugins = pluginsPayload.plugins;

      renderContentPackOptions();
      renderAll();
      renderStoryLauncher();
      initializeStoryLauncherVisibility();

      const appliedPackId = String(getAppliedContentPackId() || '').trim();
      if (appliedPackId) {
        try {
          await loadContentPackCharacterPresets(appliedPackId, { silent: true });
        } catch {
          // Character presets are optional; the core session remains usable.
        }
      }
      if (!isCurrentLoad(version, sessionId)) return { status: 'stale', sessionId };

      void Promise.resolve()
        .then(() => loadUsageStats({ silent: true }))
        .catch(() => {
        // Usage metrics are optional and must not block the narrative workspace.
        });
      setStatus(els.appStatus, '工作台已就绪', 'ok');
      return { status: 'ready', sessionId };
    } catch (error) {
      if (!isCurrentLoad(version, sessionId)) return { status: 'stale', sessionId };
      setStatus(els.appStatus, `状态加载失败: ${error.message}`, 'error');
      return { status: 'error', sessionId, error };
    } finally {
      pendingLoadCount -= 1;
      syncRefreshState();
    }
  }

  function initialize() {
    if (initialized) return false;
    initialized = true;
    renderProviderPresetOptions();
    renderProviderModelOptions('custom');
    applyTheme(loadTheme());
    bindEvents();
    activateInitialWorkspace();
    void Promise.allSettled([
      Promise.resolve().then(loadImportSources),
      loadState(),
      Promise.resolve().then(loadReleaseState)
    ]);
    startUsagePolling();
    return true;
  }

  return {
    initialize,
    isInitialized: () => initialized,
    isLoading: () => pendingLoadCount > 0,
    loadState,
    renderAll,
    syncSessionVisualState
  };
}
