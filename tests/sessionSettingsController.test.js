import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createSessionSettingsController,
  normalizeNarrativeMode,
  normalizeRoleplayMode,
  normalizeResponseLength
} from '../public/modules/sessionSettings.js';

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  toggle(value, force) {
    if (force === false) this.values.delete(value);
    else if (force === true) this.values.add(value);
    else if (this.values.has(value)) this.values.delete(value);
    else this.values.add(value);
  }

  contains(value) {
    return this.values.has(value);
  }
}

class FakeElement {
  constructor(name, tagName = 'div') {
    this.name = name;
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.listeners = new Map();
    this.classList = new FakeClassList();
    this.dataset = {};
    this.attributes = new Map();
    this.value = '';
    this.textContent = '';
    this.disabled = false;
    this._innerHTML = '';
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    if (!value) this.children = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }

  append(...nodes) {
    this.children.push(...nodes);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }
}

function createHarness({ apiRequest = async () => ({}) } = {}) {
  const createElement = (name, tagName = 'div') => new FakeElement(name, tagName);
  const narrativeModeButtons = ['free', 'stable', 'strict'].map((mode) => {
    const button = createElement(mode, 'button');
    button.dataset.narrativeMode = mode;
    return button;
  });
  const els = {
    appStatus: createElement('appStatus'),
    sessionProvider: createElement('sessionProvider', 'select'),
    sessionResponseLength: createElement('sessionResponseLength', 'select'),
    sessionRoleplayMode: createElement('sessionRoleplayMode', 'select'),
    sessionPromptIntegrity: createElement('sessionPromptIntegrity'),
    sessionSettingsStatus: createElement('sessionSettingsStatus'),
    saveSessionSettings: createElement('saveSessionSettings', 'button'),
    narrativeModeButtons
  };
  const state = {
    config: {
      providers: {
        activeProviderId: 'primary',
        providers: [
          { id: 'primary', model: 'model-a' },
          { id: 'backup', model: 'model-b' }
        ]
      }
    },
    session: {
      id: 'story/one',
      settings: {
        providerId: 'backup',
        narrativeMode: 'strict',
        authorNote: '保留作者注记',
        theme: 'ink'
      }
    }
  };
  const requests = [];
  const replacements = [];
  const statuses = [];
  let currentSessionId = 'story/one';
  const controller = createSessionSettingsController({
    state,
    els,
    apiRequest: async (...args) => {
      requests.push(args);
      return apiRequest(...args);
    },
    getSessionId: () => currentSessionId,
    replaceSession: (session, options) => {
      replacements.push({ session, options });
      if (session) state.session = session;
    },
    setStatus: (element, message, tone) => {
      statuses.push({ element: element?.name, message, tone });
    },
    humanizeApiError: (error) => `友好错误：${error.message}`,
    documentObject: {
      createElement: (tagName) => createElement(tagName, tagName)
    }
  });

  return {
    controller,
    els,
    state,
    requests,
    replacements,
    statuses,
    setSessionId: (sessionId) => {
      currentSessionId = sessionId;
    }
  };
}

test('session settings render provider choices and normalized narrative mode', () => {
  const { controller, els, state, statuses } = createHarness();
  controller.renderSessionSettings();

  assert.deepEqual(els.sessionProvider.children.map((option) => option.value), ['', 'primary', 'backup']);
  assert.deepEqual(els.sessionProvider.children.map((option) => option.textContent), [
    '跟随全局：primary',
    'primary · model-a',
    'backup · model-b'
  ]);
  assert.equal(els.sessionProvider.value, 'backup');
  assert.deepEqual(statuses.at(-1), {
    element: 'sessionSettingsStatus',
    message: 'backup · model-b',
    tone: ''
  });
  assert.equal(els.narrativeModeButtons[2].classList.contains('active'), true);
  assert.equal(els.narrativeModeButtons[2].attributes.get('aria-pressed'), 'true');

  state.session.settings.providerId = 'missing';
  state.session.settings.narrativeMode = 'unexpected';
  controller.renderSessionSettings();
  assert.equal(els.sessionProvider.value, '');
  assert.equal(statuses.at(-1).message, '跟随全局：primary');
  assert.equal(els.narrativeModeButtons[1].classList.contains('active'), true);
  assert.equal(normalizeNarrativeMode('unexpected'), 'stable');
  assert.equal(els.sessionResponseLength.value, 'balanced');
  assert.equal(normalizeResponseLength('unexpected'), 'balanced');
  assert.equal(els.sessionRoleplayMode.value, 'dm');
  assert.equal(normalizeRoleplayMode('unexpected'), 'dm');
});

test('session settings distinguish pending community-preset verification from an integrity suppression', () => {
  const { controller, els, state } = createHarness();
  state.config.promptModules = [{
    id: 'community',
    extensions: { sillyTavernPreset: { presetTitle: '社区预设' } }
  }];

  controller.renderSessionSettings();
  assert.equal(els.sessionPromptIntegrity.textContent, '预设待核验');
  assert.equal(els.sessionPromptIntegrity.classList.contains('is-pending'), true);

  state.session.memory = {
    promptRuntime: {
      communityPresetIntegrity: {
        status: 'suppressed-for-integrity',
        suppressedBundles: [{ title: '社区预设', reason: '变量链不完整' }]
      }
    }
  };
  controller.renderSessionSettings();
  assert.equal(els.sessionPromptIntegrity.textContent, '预设待调整');
  assert.equal(els.sessionPromptIntegrity.classList.contains('is-warning'), true);
});

test('roleplay mode saves independently and preserves unrelated settings', async () => {
  const harness = createHarness({
    apiRequest: async (_path, options) => ({
      session: { ...harness.state.session, settings: options.body.settings }
    })
  });

  const session = await harness.controller.saveRoleplayMode('protagonist');

  assert.equal(session.settings.roleplayMode, 'protagonist');
  assert.equal(session.settings.narrativeMode, 'strict');
  assert.equal(harness.els.sessionRoleplayMode.value, 'protagonist');
  assert.equal(harness.statuses.at(-1).message, '已切换为叙事子流派');
});

test('response length saves per session and preserves unrelated settings', async () => {
  const harness = createHarness({
    apiRequest: async (_path, options) => ({
      session: {
        ...harness.state.session,
        settings: options.body.settings
      }
    })
  });
  harness.els.sessionResponseLength.value = 'long';

  const session = await harness.controller.saveResponseLength('long');

  assert.equal(session.settings.responseLength, 'long');
  assert.deepEqual(harness.requests[0][1].body.settings, {
    providerId: 'backup',
    narrativeMode: 'strict',
    authorNote: '保留作者注记',
    theme: 'ink',
    responseLength: 'long'
  });
  assert.equal(harness.els.sessionResponseLength.value, 'long');
  assert.equal(harness.statuses.at(-1).message, '已切换为长篇推进');
});

test('session provider save preserves unrelated settings and replaces the session', async () => {
  const responseSession = {
    id: 'story/one',
    settings: {
      providerId: 'primary',
      narrativeMode: 'strict',
      authorNote: '保留作者注记',
      theme: 'ink'
    }
  };
  const harness = createHarness({
    apiRequest: async () => ({ session: responseSession })
  });
  harness.controller.renderSessionSettings();
  harness.els.sessionProvider.value = 'primary';

  assert.equal(await harness.controller.saveSessionProvider(), responseSession);
  assert.equal(harness.requests[0][0], '/api/session/settings');
  assert.deepEqual(harness.requests[0][1], {
    method: 'PUT',
    body: {
      sessionId: 'story/one',
      settings: {
        providerId: 'primary',
        narrativeMode: 'strict',
        authorNote: '保留作者注记',
        theme: 'ink'
      }
    }
  });
  assert.equal(harness.replacements.length, 1);
  assert.equal(harness.state.session, responseSession);
  assert.equal(harness.els.saveSessionSettings.disabled, false);
  assert.equal(harness.statuses.at(-1).message, '会话模型已绑定');
});

test('narrative mode save is optimistic and preserves unrelated settings', async () => {
  let resolveRequest;
  const pendingRequest = new Promise((resolve) => {
    resolveRequest = resolve;
  });
  const harness = createHarness({ apiRequest: () => pendingRequest });
  harness.controller.renderSessionSettings();

  const savePromise = harness.controller.saveNarrativeMode('free');
  assert.equal(harness.controller.isOperationPending(), true);
  assert.equal(harness.els.narrativeModeButtons[0].classList.contains('active'), true);
  assert.equal(harness.els.narrativeModeButtons.every((button) => button.disabled), true);
  await Promise.resolve();
  assert.deepEqual(harness.requests[0][1].body.settings, {
    providerId: 'backup',
    narrativeMode: 'free',
    authorNote: '保留作者注记',
    theme: 'ink'
  });

  const responseSession = {
    ...harness.state.session,
    settings: { ...harness.requests[0][1].body.settings }
  };
  resolveRequest({ session: responseSession });
  assert.equal(await savePromise, responseSession);
  assert.equal(harness.controller.isOperationPending(), false);
  assert.equal(harness.els.narrativeModeButtons.every((button) => !button.disabled), true);
  assert.equal(harness.statuses.at(-1).message, '已切换为自由路线');
});

test('narrative mode failure restores the previous state and controls', async () => {
  const harness = createHarness({
    apiRequest: async () => {
      throw new Error('write failed');
    }
  });
  harness.controller.renderSessionSettings();

  assert.equal(await harness.controller.saveNarrativeMode('free'), null);
  assert.equal(harness.state.session.settings.narrativeMode, 'strict');
  assert.equal(harness.els.narrativeModeButtons[2].classList.contains('active'), true);
  assert.equal(harness.els.narrativeModeButtons.every((button) => !button.disabled), true);
  assert.deepEqual(harness.statuses.at(-1), {
    element: 'appStatus',
    message: '路线模式保存失败：友好错误：write failed',
    tone: 'error'
  });
});

test('session settings serialize provider and narrative writes', async () => {
  let resolveRequest;
  const pendingRequest = new Promise((resolve) => {
    resolveRequest = resolve;
  });
  const harness = createHarness({ apiRequest: () => pendingRequest });
  harness.controller.renderSessionSettings();

  const providerPromise = harness.controller.saveSessionProvider();
  assert.equal(await harness.controller.saveNarrativeMode('free'), null);
  assert.equal(harness.requests.length, 1);
  assert.match(harness.statuses.at(-1).message, /仍在保存/);

  resolveRequest({ session: harness.state.session });
  await providerPromise;
  assert.equal(harness.controller.isOperationPending(), false);
});

test('generic settings patches serialize and merge against the latest saved session', async () => {
  const pending = [];
  const harness = createHarness({
    apiRequest: (_path, options) => new Promise((resolve, reject) => {
      pending.push({ resolve, reject, options });
    })
  });

  const authorNotePromise = harness.controller.saveSettingsPatch({ authorNote: '新的作者注记' });
  const themePromise = harness.controller.saveSettingsPatch({ theme: 'xianxia-scroll' });
  await Promise.resolve();

  assert.equal(harness.controller.isWritePending(), true);
  assert.equal(harness.requests.length, 1);
  const firstSettings = pending[0].options.body.settings;
  pending[0].resolve({
    session: { ...harness.state.session, settings: firstSettings }
  });
  await authorNotePromise;
  await Promise.resolve();

  assert.equal(harness.requests.length, 2);
  assert.deepEqual(pending[1].options.body.settings, {
    providerId: 'backup',
    narrativeMode: 'strict',
    authorNote: '新的作者注记',
    theme: 'xianxia-scroll'
  });
  pending[1].resolve({
    session: { ...harness.state.session, settings: pending[1].options.body.settings }
  });
  await themePromise;
  assert.equal(harness.controller.isWritePending(), false);
});

test('failed settings writes do not block the queue or overwrite a switched session', async () => {
  const pending = [];
  const harness = createHarness({
    apiRequest: (_path, options) => new Promise((resolve, reject) => {
      pending.push({ resolve, reject, options });
    })
  });

  const failedPromise = harness.controller.saveSettingsPatch({ authorNote: '失败写入' });
  const queuedPromise = harness.controller.saveSettingsPatch({ theme: 'default-dark' });
  await Promise.resolve();
  pending[0].reject(new Error('disk unavailable'));
  await assert.rejects(failedPromise, /disk unavailable/);
  await Promise.resolve();
  assert.equal(harness.requests.length, 2);

  harness.setSessionId('story/two');
  harness.state.session = {
    id: 'story/two',
    settings: { providerId: '', narrativeMode: 'stable', theme: 'wuxia-scroll' }
  };
  pending[1].resolve({
    session: {
      id: 'story/one',
      settings: pending[1].options.body.settings
    }
  });
  await queuedPromise;

  assert.equal(harness.state.session.id, 'story/two');
  assert.equal(harness.state.session.settings.theme, 'wuxia-scroll');
  assert.equal(harness.replacements.length, 0);
  assert.equal(harness.controller.isWritePending(), false);
});

test('settings patch validation fails before entering the write queue', async () => {
  const harness = createHarness();
  await assert.rejects(
    harness.controller.saveSettingsPatch([]),
    /SESSION_SETTINGS_PATCH_INVALID/
  );
  assert.equal(harness.requests.length, 0);
  assert.equal(harness.controller.isWritePending(), false);
});

test('session settings event binding is idempotent', () => {
  const { controller, els } = createHarness();
  controller.bindEvents();
  controller.bindEvents();

  assert.equal(els.saveSessionSettings.listeners.get('click').length, 1);
  els.narrativeModeButtons.forEach((button) => {
    assert.equal(button.listeners.get('click').length, 1);
  });
  assert.equal(els.sessionResponseLength.listeners.get('change').length, 1);
  assert.equal(els.sessionRoleplayMode.listeners.get('change').length, 1);
});
