import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAppStateRequestPaths,
  createAppStateController
} from '../public/modules/appState.js';

function jsonResponse(payload, { ok = true, jsonError = null } = {}) {
  return {
    ok,
    json: async () => {
      if (jsonError) throw jsonError;
      return payload;
    }
  };
}

function createPayloads(sessionId = 'story-a') {
  return {
    state: {
      config: { providers: {}, characterCard: {}, worldBook: [], promptModules: [] },
      session: {
        id: sessionId,
        settings: {
          theme: 'xianxia-scroll',
          backgroundImage: '/stage.png',
          backgroundFit: 'portrait',
          visualContentPack: 'xianxia'
        },
        memory: { resourcePackId: 'xianxia' },
        messages: []
      }
    },
    sessions: {
      sessions: [sessionId],
      sessionSummaries: [{ id: sessionId, messageCount: 0 }]
    },
    storyProjects: { projects: [{ id: 'project-a' }] },
    assets: { assets: [{ id: 'asset-a' }] },
    prologue: { genres: { xianxia: { title: '仙侠开局' } } },
    resources: { resources: [{ id: 'resource-a' }] },
    resourcePacks: { packs: [{ id: 'resource-pack-a', custom: true }] },
    packCompatibilityOverview: {
      spec: 'lra.pack-compatibility-overview/v1',
      contractVersion: 2,
      packs: [{
        packId: 'resource-pack-a',
        status: 'script-review-required',
        label: '脚本待逐项审核',
        canStartNewStory: false,
        action: 'review-scripts',
        scriptCount: 2
      }],
      summary: { total: 1, attention: 1 }
    },
    adapters: { adapters: [{ id: 'adapter-a' }] },
    contentPacks: {
      contentPacks: [
        { id: 'xianxia' },
        { id: 'resource-pack-a', custom: true }
      ]
    },
    plugins: { plugins: [{ id: 'plugin-a' }] },
    simulation: { snapshot: { revision: 7 } },
    health: { health: { spec: 'lra.session-health/v1', status: 'healthy', checks: [] } }
  };
}

function createHarness(overrides = {}) {
  const current = overrides.current || { id: 'story-a' };
  const state = overrides.state || {
    session: { id: 'initial', settings: {}, memory: {}, messages: [] },
    contentPacks: []
  };
  const els = {
    refreshState: { disabled: false },
    appStatus: {},
    contentPackSelect: { value: 'old-pack', dataset: { userSelected: 'true' } },
    randomProtagonistGenre: { value: 'lingyi' }
  };
  const calls = {
    assets: [],
    backgrounds: [],
    contentOptions: 0,
    fullRenderers: [],
    launcher: 0,
    launcherVisibility: 0,
    presets: [],
    sessionOptions: [],
    simulation: [],
    startup: [],
    statuses: [],
    sessionChanges: [],
    themes: [],
    usage: []
  };
  const payloads = overrides.payloads || createPayloads(current.id);
  const paths = buildAppStateRequestPaths(current.id);
  const byPath = new Map(Object.entries(paths).map(([key, path]) => [
    path,
    jsonResponse(payloads[key])
  ]));
  const fetchImpl = overrides.fetchImpl || (async (path) => {
    if (!byPath.has(path)) throw new Error(`unexpected request: ${path}`);
    return byPath.get(path);
  });
  const controller = createAppStateController({
    state,
    els,
    fetchImpl,
    getCurrentSessionId: () => current.id,
    getOpeningGenreIds: () => ['xuanhuan', 'lingyi', 'xianxia'],
    getAppliedContentPackId: () => state.session?.memory?.resourcePackId || '',
    loadTheme: () => 'eye-care',
    applyTheme: (theme) => calls.themes.push(theme),
    applyBackgroundImage: (...args) => calls.backgrounds.push(args),
    applyDirectorSimulationSnapshot: (snapshot) => calls.simulation.push(snapshot),
    renderSessionSelect: (sessions, summaries) => calls.sessionOptions.push({ sessions, summaries }),
    setAssets: (assets) => calls.assets.push(assets),
    renderContentPackOptions: () => {
      calls.contentOptions += 1;
    },
    getFullRenderers: () => [
      () => calls.fullRenderers.push('first'),
      () => calls.fullRenderers.push('second')
    ],
    renderStoryLauncher: () => {
      calls.launcher += 1;
    },
    initializeStoryLauncherVisibility: () => {
      calls.launcherVisibility += 1;
    },
    loadContentPackCharacterPresets: async (...args) => {
      calls.presets.push(args);
      return [];
    },
    loadUsageStats: overrides.loadUsageStats || ((...args) => calls.usage.push(args)),
    setStatus: (_element, text, tone) => calls.statuses.push([text, tone]),
    onSessionChanged: (context) => calls.sessionChanges.push(context),
    renderProviderPresetOptions: () => calls.startup.push('provider-presets'),
    renderProviderModelOptions: (model) => calls.startup.push(`provider-model:${model}`),
    bindEvents: () => calls.startup.push('bind-events'),
    activateInitialWorkspace: () => calls.startup.push('initial-workspace'),
    loadImportSources: async () => calls.startup.push('import-sources'),
    loadReleaseState: async () => calls.startup.push('release-state'),
    startUsagePolling: () => calls.startup.push('usage-polling')
  });
  return { calls, controller, current, els, state };
}

test('state request paths encode the active session boundary', () => {
  const paths = buildAppStateRequestPaths('story/一');
  assert.equal(paths.state, '/api/state?sessionId=story%2F%E4%B8%80');
  assert.equal(paths.simulation, '/api/sessions/story%2F%E4%B8%80/simulation?view=director');
  assert.equal(paths.health, '/api/sessions/story%2F%E4%B8%80/health');
  assert.equal(paths.packCompatibilityOverview, '/api/resource-library/packs/compatibility-overview');
  assert.equal(Object.keys(paths).length, 13);
});

test('state loading applies the core session and all available optional catalogs', async () => {
  const harness = createHarness();

  assert.deepEqual(await harness.controller.loadState(), {
    status: 'ready',
    sessionId: 'story-a'
  });

  assert.equal(harness.state.session.id, 'story-a');
  assert.deepEqual(harness.state.sessionSummaries, [{ id: 'story-a', messageCount: 0 }]);
  assert.deepEqual(harness.state.storyProjects, [{ id: 'project-a' }]);
  assert.deepEqual(harness.state.resourceLibrary, [{ id: 'resource-a' }]);
  assert.equal(harness.state.resourcePacks[0].id, 'resource-pack-a');
  assert.equal(harness.state.resourcePacks[0].compatibilityAudit.status, 'script-review-required');
  assert.equal(harness.state.resourcePacks[0].compatibilityAudit.scriptCount, 2);
  assert.deepEqual(harness.state.resourceAdapters, [{ id: 'adapter-a' }]);
  assert.equal(harness.state.contentPacks[0].id, 'xianxia');
  assert.equal(harness.state.contentPacks[0].compatibilityAudit.status, 'native');
  assert.equal(harness.state.contentPacks[1].compatibilityAudit.status, 'script-review-required');
  assert.equal(harness.state.resourcePackCompatibilityOverview.contractVersion, 2);
  assert.deepEqual(harness.state.plugins, [{ id: 'plugin-a' }]);
  assert.equal(harness.state.sessionHealth.status, 'healthy');
  assert.equal(harness.state.prologueTemplate.genres.xianxia.title, '仙侠开局');
  assert.deepEqual(harness.calls.simulation, [{ revision: 7 }]);
  assert.deepEqual(harness.calls.sessionOptions, [{
    sessions: ['story-a'],
    summaries: [{ id: 'story-a', messageCount: 0 }]
  }]);
  assert.deepEqual(harness.calls.assets, [[{ id: 'asset-a' }]]);
  assert.equal(harness.calls.contentOptions, 1);
  assert.deepEqual(harness.calls.fullRenderers, ['first', 'second']);
  assert.equal(harness.calls.launcher, 1);
  assert.equal(harness.calls.launcherVisibility, 1);
  assert.deepEqual(harness.calls.presets, [['xianxia', { silent: true }]]);
  assert.deepEqual(harness.calls.usage, [[{ silent: true }]]);
  assert.deepEqual(harness.calls.statuses.at(-1), ['工作台已就绪', 'ok']);
  assert.equal(harness.els.refreshState.disabled, false);
  assert.deepEqual(harness.calls.themes, []);
  assert.deepEqual(harness.calls.backgrounds, [['/stage.png', 'portrait']]);
});

test('optional endpoint and JSON failures degrade without blocking the core session', async () => {
  const current = { id: 'story-a' };
  const payloads = createPayloads(current.id);
  const paths = buildAppStateRequestPaths(current.id);
  const fetchImpl = async (path) => {
    if (path === paths.sessions) {
      return jsonResponse(null, { jsonError: new Error('bad sessions json') });
    }
    if (path === paths.storyProjects) return jsonResponse(null, { ok: false });
    if (path === paths.resources) {
      return jsonResponse(null, { jsonError: new Error('bad resources json') });
    }
    const key = Object.entries(paths).find(([, candidate]) => candidate === path)?.[0];
    return jsonResponse(payloads[key]);
  };
  const state = {
    session: { id: 'old', settings: {}, memory: {}, messages: [] },
    resourceLibrary: [{ id: 'cached-resource' }]
  };
  const harness = createHarness({ current, fetchImpl, payloads, state });

  const result = await harness.controller.loadState();

  assert.equal(result.status, 'ready');
  assert.deepEqual(harness.state.sessionSummaries, []);
  assert.deepEqual(harness.state.storyProjects, []);
  assert.deepEqual(harness.state.resourceLibrary, [{ id: 'cached-resource' }]);
  assert.deepEqual(harness.calls.sessionOptions, [{ sessions: [], summaries: [] }]);
  assert.deepEqual(harness.calls.statuses.at(-1), ['工作台已就绪', 'ok']);
});

test('unbound sessions do not load a system character preset as an implicit default', async () => {
  const payloads = createPayloads('blank-story');
  payloads.state.session.memory = {};
  payloads.state.session.settings = {};
  const harness = createHarness({ payloads, current: { id: 'blank-story' } });

  assert.equal((await harness.controller.loadState()).status, 'ready');
  assert.deepEqual(harness.calls.presets, []);
});

test('a failed core state response does not render a partial workspace', async () => {
  const current = { id: 'story-a' };
  const paths = buildAppStateRequestPaths(current.id);
  const fetchImpl = async (path) => (
    path === paths.state ? jsonResponse({}, { ok: false }) : jsonResponse({})
  );
  const harness = createHarness({ current, fetchImpl });

  const result = await harness.controller.loadState();

  assert.equal(result.status, 'error');
  assert.deepEqual(harness.calls.fullRenderers, []);
  assert.equal(harness.calls.contentOptions, 0);
  assert.match(harness.calls.statuses.at(-1)[0], /Failed to load state/);
  assert.equal(harness.calls.statuses.at(-1)[1], 'error');
  assert.equal(harness.els.refreshState.disabled, false);
});

test('a late previous-session load cannot overwrite the newest session', async () => {
  const current = { id: 'story-a' };
  let resolveOldState;
  const oldStateResponse = new Promise((resolve) => {
    resolveOldState = () => resolve(jsonResponse(createPayloads('story-a').state));
  });
  const fetchImpl = async (path) => {
    if (path === '/api/state?sessionId=story-a') return oldStateResponse;
    const sessionId = path.includes('story-b') ? 'story-b' : current.id;
    const paths = buildAppStateRequestPaths(sessionId);
    const payloads = createPayloads(sessionId);
    const key = Object.entries(paths).find(([, candidate]) => candidate === path)?.[0];
    return jsonResponse(key ? payloads[key] : {});
  };
  const harness = createHarness({ current, fetchImpl });

  const oldLoad = harness.controller.loadState();
  current.id = 'story-b';
  const newLoad = harness.controller.loadState();

  assert.equal((await newLoad).status, 'ready');
  assert.equal(harness.state.session.id, 'story-b');
  assert.equal(harness.els.refreshState.disabled, true);

  resolveOldState();
  assert.equal((await oldLoad).status, 'stale');
  assert.equal(harness.state.session.id, 'story-b');
  assert.equal(harness.els.refreshState.disabled, false);
  assert.equal(harness.calls.statuses.filter(([, tone]) => tone === 'error').length, 0);
});

test('visual synchronization clears stale selections and applies explicit fallbacks', () => {
  const state = {
    session: { id: 'blank', settings: {}, memory: {}, messages: [] },
    contentPacks: []
  };
  const harness = createHarness({ state });

  harness.controller.syncSessionVisualState();

  assert.equal(harness.els.contentPackSelect.value, '');
  assert.equal(harness.els.contentPackSelect.dataset.userSelected, undefined);
  assert.equal(harness.els.randomProtagonistGenre.value, 'xuanhuan');
  assert.deepEqual(harness.calls.themes, []);
  assert.deepEqual(harness.calls.backgrounds, [['', 'cover']]);
});

test('switching sessions clears stale story UI state before the new story renders', async () => {
  const current = { id: 'story-b' };
  const payloads = createPayloads('story-b');
  const state = {
    session: { id: 'story-a', settings: {}, memory: {}, messages: [] },
    contentPacks: [],
    pendingJourneyDraft: { title: '上一部剧本的开局稿' },
    pendingQuickReply: { content: '上一部剧本的快捷回复' },
    targetSpeaker: '上一部剧本的角色',
    openingError: '上一部剧本的错误',
    immersiveSidebarTab: '角色档案',
    conversationActionPending: true,
    chatStreaming: true
  };
  const harness = createHarness({ current, payloads, state });

  assert.equal((await harness.controller.loadState()).status, 'ready');
  assert.equal(harness.state.session.id, 'story-b');
  assert.equal(harness.state.pendingJourneyDraft, null);
  assert.equal(harness.state.pendingQuickReply, null);
  assert.equal(harness.state.targetSpeaker, '');
  assert.equal(harness.state.openingError, '');
  assert.equal(harness.state.immersiveSidebarTab, '');
  assert.equal(harness.state.conversationActionPending, false);
  assert.equal(harness.state.chatStreaming, false);
  assert.deepEqual(harness.calls.sessionChanges, [{
    previousSessionId: 'story-a',
    nextSessionId: 'story-b'
  }]);
});

test('startup initialization is idempotent and preserves the required orchestration order', async () => {
  const harness = createHarness();

  assert.equal(harness.controller.initialize(), true);
  assert.equal(harness.controller.initialize(), false);

  while (harness.controller.isLoading()) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(harness.controller.isInitialized(), true);
  assert.deepEqual(harness.calls.startup, [
    'provider-presets',
    'provider-model:custom',
    'bind-events',
    'initial-workspace',
    'usage-polling',
    'import-sources',
    'release-state'
  ]);
  assert.deepEqual(harness.calls.themes, ['eye-care']);
  assert.deepEqual(harness.calls.statuses.at(-1), ['工作台已就绪', 'ok']);
});

test('an asynchronous usage metrics failure does not downgrade a ready workspace', async () => {
  const harness = createHarness({
    loadUsageStats: async () => {
      throw new Error('metrics unavailable');
    }
  });

  const result = await harness.controller.loadState();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(result.status, 'ready');
  assert.deepEqual(harness.calls.statuses.at(-1), ['工作台已就绪', 'ok']);
});
