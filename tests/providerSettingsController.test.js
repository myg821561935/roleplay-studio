import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CUSTOM_MODEL_VALUE,
  MASKED_PROVIDER_SECRET,
  buildProviderRoutingConfig,
  buildProviderSaveConfig,
  createProviderSettingsController,
  parseProviderHeaders
} from '../public/modules/providerSettings.js';

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
    this.value = '';
    this.textContent = '';
    this.placeholder = '';
    this.disabled = false;
    this._innerHTML = '';
  }

  get options() {
    return this.children;
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

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  async emit(type, event = {}) {
    const emittedEvent = {
      preventDefault() {},
      target: this,
      currentTarget: this,
      ...event
    };
    for (const handler of this.listeners.get(type) || []) {
      await handler(emittedEvent);
    }
  }
}

function createProviderConfig() {
  return {
    activeProviderId: 'primary',
    taskProviders: {
      chat: 'primary',
      rewrite: 'backup',
      fact: 'primary',
      summary: 'primary'
    },
    taskFallbackChains: {
      rewrite: ['primary']
    },
    fallbackChain: ['backup'],
    providers: [
      {
        id: 'primary',
        kind: 'openai-compatible',
        preset: 'custom',
        baseUrl: 'http://127.0.0.1:5195/v1',
        apiKey: MASKED_PROVIDER_SECRET,
        model: 'model-a',
        temperature: 0.7,
        maxTokens: 900,
        reasoningMode: 'disabled',
        headers: { 'x-test': '1' }
      },
      {
        id: 'backup',
        kind: 'openai-compatible',
        preset: 'custom',
        baseUrl: 'http://127.0.0.1:5196/v1',
        apiKey: MASKED_PROVIDER_SECRET,
        model: 'model-b',
        temperature: 0.5,
        maxTokens: 700,
        headers: {}
      }
    ]
  };
}

function createHarness({ apiRequest = async () => ({}), reloadState = async () => {}, providersConfig = null } = {}) {
  const createElement = (name, tagName = 'div') => new FakeElement(name, tagName);
  const els = {
    providerForm: createElement('providerForm', 'form'),
    providerPreset: createElement('providerPreset', 'select'),
    providerKind: createElement('providerKind', 'select'),
    providerId: createElement('providerId', 'input'),
    providerBaseUrl: createElement('providerBaseUrl', 'input'),
    providerApiKey: createElement('providerApiKey', 'input'),
    providerModel: createElement('providerModel', 'select'),
    providerModelCustom: createElement('providerModelCustom', 'input'),
    providerModelCustomRow: createElement('providerModelCustomRow'),
    providerTemperature: createElement('providerTemperature', 'input'),
    providerMaxTokens: createElement('providerMaxTokens', 'input'),
    providerReasoningMode: createElement('providerReasoningMode', 'select'),
    providerHeaders: createElement('providerHeaders', 'textarea'),
    providerStatus: createElement('providerStatus'),
    providerTestResult: createElement('providerTestResult'),
    appStatus: createElement('appStatus'),
    saveProvider: createElement('saveProvider', 'button'),
    testProvider: createElement('testProvider', 'button'),
    saveProviderRouting: createElement('saveProviderRouting', 'button'),
    taskProviderChat: createElement('taskProviderChat', 'select'),
    taskProviderFact: createElement('taskProviderFact', 'select'),
    taskProviderSummary: createElement('taskProviderSummary', 'select'),
    fallbackChainInput: createElement('fallbackChainInput', 'input')
  };
  const state = { config: { providers: providersConfig ?? createProviderConfig() } };
  const requests = [];
  const statuses = [];
  let reloads = 0;

  const controller = createProviderSettingsController({
    state,
    els,
    apiRequest: async (...args) => {
      requests.push(args);
      return apiRequest(...args);
    },
    reloadState: async () => {
      reloads += 1;
      return reloadState();
    },
    prettyJson: (value) => JSON.stringify(value, null, 2),
    setStatus: (element, message, tone) => statuses.push({
      element: element?.name,
      message,
      tone
    }),
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
    statuses,
    getReloads: () => reloads
  };
}

test('provider config builders parse headers and preserve unrelated routing fields', () => {
  assert.deepEqual(parseProviderHeaders('{"Authorization":"Bearer local"}'), {
    Authorization: 'Bearer local'
  });
  assert.throws(() => parseProviderHeaders('{'), /Headers JSON 解析失败/);
  assert.throws(() => parseProviderHeaders('[]'), /Headers JSON 必须是普通对象/);

  const current = createProviderConfig();
  const replacement = { ...current.providers[0], model: 'model-new' };
  const saved = buildProviderSaveConfig(current, replacement);
  assert.equal(saved.activeProviderId, 'primary');
  assert.deepEqual(saved.taskProviders, current.taskProviders);
  assert.deepEqual(saved.taskFallbackChains, current.taskFallbackChains);
  assert.deepEqual(saved.fallbackChain, ['backup']);
  assert.deepEqual(saved.providers.map((provider) => provider.id), ['backup', 'primary']);
  assert.equal(saved.providers[1].model, 'model-new');

  const routed = buildProviderRoutingConfig(current, {
    chat: 'backup',
    fact: '',
    summary: 'primary',
    fallbackChain: ' backup, primary '
  });
  assert.deepEqual(routed.taskProviders, {
    chat: 'backup',
    rewrite: 'backup',
    fact: '',
    summary: 'primary'
  });
  assert.deepEqual(routed.taskFallbackChains, current.taskFallbackChains);
  assert.deepEqual(routed.fallbackChain, ['backup', 'primary']);
  assert.throws(
    () => buildProviderRoutingConfig(current, { fallbackChain: 'missing' }),
    /未知 Provider ID：missing/
  );
});

test('provider form masks only the matching provider secret', () => {
  const { controller, els } = createHarness();
  controller.renderProviderForm();

  assert.equal(els.providerId.value, 'primary');
  assert.equal(els.providerApiKey.value, MASKED_PROVIDER_SECRET);
  assert.equal(els.providerModel.value, CUSTOM_MODEL_VALUE);
  assert.equal(els.providerModelCustom.value, 'model-a');
  assert.equal(els.providerReasoningMode.value, 'disabled');
  assert.deepEqual(JSON.parse(els.providerHeaders.value), { 'x-test': '1' });

  els.providerReasoningMode.value = 'enabled';
  assert.equal(controller.readProviderForm().reasoningMode, 'enabled');

  els.providerApiKey.value = '';
  assert.equal(controller.readProviderForm().apiKey, MASKED_PROVIDER_SECRET);

  els.providerId.value = 'brand-new';
  els.providerApiKey.value = MASKED_PROVIDER_SECRET;
  assert.equal(controller.readProviderForm().apiKey, '');

  els.providerId.value = '';
  els.providerApiKey.value = '';
  assert.equal(controller.readProviderForm().id, 'local');
  assert.equal(controller.readProviderForm().apiKey, '');

  els.providerId.value = 'brand-new';
  els.providerApiKey.value = 'new-local-secret';
  assert.equal(controller.readProviderForm().apiKey, 'new-local-secret');
});

test('provider form pre-fills DeepSeek preset on first run to lower configuration barrier', () => {
  const { controller, els, statuses } = createHarness({ providersConfig: { providers: [] } });
  controller.renderProviderForm();

  assert.equal(els.providerPreset.value, 'deepseek');
  assert.equal(els.providerKind.value, 'openai-compatible');
  assert.equal(els.providerId.value, 'deepseek');
  assert.equal(els.providerBaseUrl.value, 'https://api.deepseek.com/v1');
  assert.equal(els.providerApiKey.value, '');
  assert.match(statuses.at(-1).message, /DeepSeek 模板/);
});

test('provider routing renderer owns global task selects and fallback display', () => {
  const { controller, els } = createHarness();
  controller.renderProviderRoutingOptions();

  for (const select of [
    els.taskProviderChat,
    els.taskProviderFact,
    els.taskProviderSummary
  ]) {
    assert.deepEqual(select.options.map((option) => option.value), ['', 'primary', 'backup']);
    assert.equal(select.options[0].textContent, '跟随全局：primary');
  }
  assert.equal(els.taskProviderChat.value, 'primary');
  assert.equal(els.taskProviderFact.value, 'primary');
  assert.equal(els.taskProviderSummary.value, 'primary');
  assert.equal(els.fallbackChainInput.value, 'backup');
});

test('provider save serializes operations and restores controls after reload', async () => {
  let resolveRequest;
  const pendingRequest = new Promise((resolve) => {
    resolveRequest = resolve;
  });
  const harness = createHarness({ apiRequest: () => pendingRequest });
  harness.controller.renderProviderForm();

  const savePromise = harness.controller.saveProvider();
  assert.equal(harness.controller.isOperationPending(), true);
  assert.equal(harness.els.saveProvider.disabled, true);
  assert.equal(harness.els.testProvider.disabled, true);
  assert.equal(harness.els.saveProviderRouting.disabled, true);
  assert.equal(harness.requests.length, 1);
  assert.equal(harness.requests[0][0], '/api/providers');
  assert.equal(harness.requests[0][1].method, 'PUT');
  assert.equal(harness.requests[0][1].body.providers[1].apiKey, MASKED_PROVIDER_SECRET);

  assert.equal(await harness.controller.testProviderConnection(), null);
  assert.equal(harness.requests.length, 1);
  assert.match(harness.statuses.at(-1).message, /仍在处理中/);

  resolveRequest({});
  await savePromise;
  assert.equal(harness.getReloads(), 1);
  assert.equal(harness.controller.isOperationPending(), false);
  assert.equal(harness.els.saveProvider.disabled, false);
  assert.equal(harness.els.testProvider.disabled, false);
  assert.equal(harness.els.saveProviderRouting.disabled, false);
});

test('provider connection test reports success and humanized failures', async () => {
  const success = createHarness({
    apiRequest: async () => ({
      result: {
        providerId: 'primary',
        model: 'model-a',
        latencyMs: 42,
        responsePreview: 'OK'
      }
    })
  });
  success.controller.renderProviderForm();
  const result = await success.controller.testProviderConnection();

  assert.equal(result.latencyMs, 42);
  assert.equal(success.requests[0][0], '/api/providers/test');
  assert.equal(success.requests[0][1].method, 'POST');
  assert.equal(success.requests[0][1].body.provider.id, 'primary');
  assert.deepEqual(success.statuses.at(-1), {
    element: 'providerTestResult',
    message: 'model-a · 42 ms · OK',
    tone: 'ok'
  });

  const failure = createHarness({
    apiRequest: async () => {
      throw new Error('upstream unavailable');
    }
  });
  failure.controller.renderProviderForm();
  assert.equal(await failure.controller.testProviderConnection(), null);
  assert.deepEqual(failure.statuses.at(-1), {
    element: 'providerTestResult',
    message: '测试失败：友好错误：upstream unavailable',
    tone: 'error'
  });
});

test('provider routing preserves rewrite ownership and rejects unknown fallbacks before writing', async () => {
  const harness = createHarness();
  harness.els.taskProviderChat.value = 'backup';
  harness.els.taskProviderFact.value = 'primary';
  harness.els.taskProviderSummary.value = '';
  harness.els.fallbackChainInput.value = 'backup, primary';

  const payload = await harness.controller.saveProviderRouting();
  assert.equal(harness.requests[0][0], '/api/providers');
  assert.equal(harness.requests[0][1].method, 'PUT');
  assert.deepEqual(payload.taskProviders, {
    chat: 'backup',
    rewrite: 'backup',
    fact: 'primary',
    summary: ''
  });
  assert.deepEqual(payload.taskFallbackChains, { rewrite: ['primary'] });
  assert.equal(harness.state.config.providers, payload);

  harness.els.fallbackChainInput.value = 'unknown';
  assert.equal(await harness.controller.saveProviderRouting(), null);
  assert.equal(harness.requests.length, 1);
  assert.match(harness.statuses.at(-1).message, /未知 Provider ID：unknown/);
});

test('provider event binding is idempotent', () => {
  const { controller, els } = createHarness();
  controller.bindEvents();
  controller.bindEvents();

  assert.equal(els.providerForm.listeners.get('submit').length, 1);
  assert.equal(els.testProvider.listeners.get('click').length, 1);
  assert.equal(els.saveProviderRouting.listeners.get('click').length, 1);
  assert.equal(els.providerPreset.listeners.get('change').length, 1);
  assert.equal(els.providerModel.listeners.get('change').length, 1);
});
