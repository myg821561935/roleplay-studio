import { isPlainObject, normalizeProviderReasoningMode } from './utils.js';
export const CUSTOM_MODEL_VALUE = '__custom_model__';
export const MASKED_PROVIDER_SECRET = '********';

export const PROVIDER_PRESETS = [
  {
    id: 'custom',
    label: '自定义',
    kind: 'openai-compatible',
    baseUrl: '',
    model: '',
    models: [],
    headers: {}
  },
  {
    id: 'openai',
    label: 'OpenAI',
    kind: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5.4-mini',
    models: ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-4.1-mini'],
    headers: {}
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    kind: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-v4-flash',
    models: ['deepseek-v4-flash', 'deepseek-chat', 'deepseek-reasoner'],
    reasoningMode: 'auto',
    headers: {}
  },
  {
    id: 'qwen',
    label: '通义千问',
    kind: 'openai-compatible',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    models: ['qwen-plus', 'qwen-max', 'qwen-turbo', 'qwen-long'],
    headers: {}
  },
  {
    id: 'moonshot',
    label: 'Moonshot / Kimi',
    kind: 'openai-compatible',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    headers: {}
  },
  {
    id: 'siliconflow',
    label: 'SiliconFlow',
    kind: 'openai-compatible',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'deepseek-ai/DeepSeek-V3',
    models: [
      'deepseek-ai/DeepSeek-V3',
      'deepseek-ai/DeepSeek-R1',
      'Qwen/Qwen3-235B-A22B-Instruct-2507',
      'moonshotai/Kimi-K2-Instruct'
    ],
    headers: {}
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    kind: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4o-mini',
    models: [
      'openai/gpt-4o-mini',
      'anthropic/claude-sonnet-4',
      'google/gemini-2.5-flash',
      'deepseek/deepseek-chat'
    ],
    headers: {}
  },
  {
    id: 'ollama',
    label: 'Ollama 本地',
    kind: 'openai-compatible',
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen2.5:7b',
    models: ['qwen2.5:7b', 'qwen2.5:14b', 'llama3.1:8b', 'deepseek-r1:7b'],
    headers: {}
  },
  {
    id: 'lmstudio',
    label: 'LM Studio 本地',
    kind: 'openai-compatible',
    baseUrl: 'http://localhost:1234/v1',
    model: 'local-model',
    models: ['local-model', 'qwen2.5-7b-instruct', 'llama-3.1-8b-instruct', 'deepseek-r1-distill-qwen-7b'],
    headers: {}
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    kind: 'anthropic',
    baseUrl: '',
    model: 'claude-sonnet-5',
    models: ['claude-sonnet-5', 'claude-opus-4-8', 'claude-haiku-4-5-20251001', 'claude-haiku-4-5'],
    headers: {}
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    kind: 'gemini',
    baseUrl: '',
    model: 'gemini-2.5-flash',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite'],
    headers: {}
  }
];

export function parseProviderHeaders(value) {
  let headers;
  try {
    headers = JSON.parse(String(value || 'null'));
  } catch {
    throw new Error('Headers JSON 解析失败');
  }
  if (!isPlainObject(headers)) throw new Error('Headers JSON 必须是普通对象');
  return headers;
}

export function buildProviderSaveConfig(currentConfig = {}, provider = {}) {
  const providers = Array.isArray(currentConfig.providers) ? currentConfig.providers : [];
  return {
    activeProviderId: provider.id,
    taskProviders: isPlainObject(currentConfig.taskProviders)
      ? currentConfig.taskProviders
      : { chat: '', rewrite: '', fact: '', summary: '' },
    taskFallbackChains: isPlainObject(currentConfig.taskFallbackChains)
      ? currentConfig.taskFallbackChains
      : {},
    fallbackChain: Array.isArray(currentConfig.fallbackChain) ? currentConfig.fallbackChain : [],
    providers: [...providers.filter((item) => item.id !== provider.id), provider]
  };
}

export function buildProviderRoutingConfig(currentConfig = {}, selections = {}) {
  const providers = Array.isArray(currentConfig.providers) ? currentConfig.providers : [];
  const fallbackChain = (Array.isArray(selections.fallbackChain)
    ? selections.fallbackChain
    : String(selections.fallbackChain || '').split(','))
    .map((id) => String(id || '').trim())
    .filter(Boolean);
  const invalidIds = fallbackChain.filter((id) => !providers.some((provider) => provider.id === id));
  if (invalidIds.length) {
    throw new Error(`回退链中存在未知 Provider ID：${invalidIds.join(', ')}`);
  }

  return {
    activeProviderId: currentConfig.activeProviderId || providers[0]?.id || '',
    taskProviders: {
      ...(isPlainObject(currentConfig.taskProviders) ? currentConfig.taskProviders : {}),
      chat: selections.chat || '',
      fact: selections.fact || '',
      summary: selections.summary || ''
    },
    taskFallbackChains: isPlainObject(currentConfig.taskFallbackChains)
      ? currentConfig.taskFallbackChains
      : {},
    fallbackChain,
    providers
  };
}

function normalizeProviderNumber(value, fallback) {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) ? number : fallback;
}

export function createProviderSettingsController({
  state = {},
  els = {},
  apiRequest = async () => ({}),
  reloadState = async () => {},
  prettyJson = (value) => JSON.stringify(value, null, 2),
  setStatus = () => {},
  humanizeApiError = (error) => error?.message || String(error),
  documentObject = globalThis.document
} = {}) {
  let eventsBound = false;
  let operationPending = false;

  function getProviderPreset(presetId) {
    return PROVIDER_PRESETS.find((item) => item.id === presetId);
  }

  function normalizeProviderKind(kind) {
    const value = String(kind || 'openai-compatible').toLowerCase();
    return ['openai-compatible', 'anthropic', 'gemini'].includes(value)
      ? value
      : 'openai-compatible';
  }

  function resolveProviderPreset(provider) {
    const presetId = String(provider?.preset || '').trim();
    if (PROVIDER_PRESETS.some((preset) => preset.id === presetId)) return presetId;

    const baseUrl = String(provider?.baseUrl || '').replace(/\/+$/, '').toLowerCase();
    const kind = normalizeProviderKind(provider?.kind);
    const matched = PROVIDER_PRESETS.find((preset) => (
      preset.id !== 'custom'
      && preset.kind === kind
      && String(preset.baseUrl || '').replace(/\/+$/, '').toLowerCase() === baseUrl
    ));
    return matched?.id || (kind === 'anthropic' ? 'anthropic' : (kind === 'gemini' ? 'gemini' : 'custom'));
  }

  function syncProviderModelCustomField() {
    const custom = els.providerModel.value === CUSTOM_MODEL_VALUE;
    els.providerModelCustomRow.classList.toggle('is-hidden', !custom);
    if (custom && !els.providerModelCustom.value.trim()) {
      els.providerModelCustom.placeholder = 'model-name';
    }
  }

  function resolveSelectedProviderModel() {
    if (els.providerModel.value === CUSTOM_MODEL_VALUE) {
      return els.providerModelCustom.value.trim();
    }
    return els.providerModel.value.trim();
  }

  function renderProviderPresetOptions() {
    if (!els.providerPreset || els.providerPreset.options.length > 1) return;
    els.providerPreset.innerHTML = '';
    PROVIDER_PRESETS.forEach((preset) => {
      const option = documentObject.createElement('option');
      option.value = preset.id;
      option.textContent = preset.label;
      els.providerPreset.append(option);
    });
  }

  function renderProviderModelOptions(presetId, currentModel = '') {
    if (!els.providerModel) return;
    const preset = getProviderPreset(presetId);
    const modelNames = Array.isArray(preset?.models) ? preset.models : [];
    const current = String(currentModel || '').trim();
    const hasCurrent = current && modelNames.includes(current);

    els.providerModel.innerHTML = '';
    modelNames.forEach((model) => {
      const option = documentObject.createElement('option');
      option.value = model;
      option.textContent = model;
      els.providerModel.append(option);
    });

    const customOption = documentObject.createElement('option');
    customOption.value = CUSTOM_MODEL_VALUE;
    customOption.textContent = '自定义模型...';
    els.providerModel.append(customOption);

    els.providerModel.value = hasCurrent ? current : CUSTOM_MODEL_VALUE;
    els.providerModelCustom.value = hasCurrent ? '' : current;
    syncProviderModelCustomField();
  }

  function applyProviderPreset(presetId) {
    const preset = getProviderPreset(presetId);
    renderProviderModelOptions(presetId, resolveSelectedProviderModel());
    if (!preset || preset.id === 'custom') return;

    const currentId = els.providerId.value.trim();
    els.providerKind.value = preset.kind;
    if (!currentId || currentId === 'local' || PROVIDER_PRESETS.some((item) => item.id === currentId)) {
      els.providerId.value = preset.id;
    }
    els.providerBaseUrl.value = preset.baseUrl;
    renderProviderModelOptions(presetId, preset.model);
    if (els.providerReasoningMode && preset.reasoningMode) els.providerReasoningMode.value = normalizeProviderReasoningMode(preset.reasoningMode);
    els.providerHeaders.value = prettyJson(preset.headers || {});
    setStatus(els.providerStatus, `已套用 ${preset.label} 模板`, 'ok');
  }

  function getProvidersConfig() {
    return isPlainObject(state.config?.providers) ? state.config.providers : {};
  }

  function getExistingProvider(providerId = els.providerId?.value?.trim()) {
    const providersConfig = getProvidersConfig();
    const providers = Array.isArray(providersConfig.providers) ? providersConfig.providers : [];
    const id = String(providerId || 'local').trim();
    return providers.find((provider) => provider.id === id);
  }

  function resolveApiKeyForSave() {
    const inputValue = String(els.providerApiKey?.value || '').trim();
    const existing = getExistingProvider();
    if (inputValue === MASKED_PROVIDER_SECRET) {
      return existing?.apiKey ? MASKED_PROVIDER_SECRET : '';
    }
    if (inputValue) return inputValue;
    return existing?.apiKey ? MASKED_PROVIDER_SECRET : '';
  }

  function readProviderForm() {
    return {
      id: String(els.providerId?.value || '').trim() || 'local',
      kind: normalizeProviderKind(els.providerKind?.value),
      preset: String(els.providerPreset?.value || ''),
      baseUrl: String(els.providerBaseUrl?.value || '').trim(),
      apiKey: resolveApiKeyForSave(),
      model: resolveSelectedProviderModel(),
      ttsModel: String(els.providerTtsModel?.value || '').trim(),
      sttModel: String(els.providerSttModel?.value || '').trim(),
      temperature: Number(els.providerTemperature?.value || 0.9),
      maxTokens: Number(els.providerMaxTokens?.value || 2000),
      reasoningMode: normalizeProviderReasoningMode(els.providerReasoningMode?.value),
      headers: parseProviderHeaders(els.providerHeaders?.value)
    };
  }

  function renderProviderForm() {
    renderProviderPresetOptions();
    const providersConfig = getProvidersConfig();
    const providers = Array.isArray(providersConfig.providers) ? providersConfig.providers : [];
    const activeId = providersConfig.activeProviderId || providers[0]?.id || '';
    const provider = providers.find((item) => item.id === activeId) || providers[0] || {};

    if (!provider.id && !providers.length) {
      els.providerPreset.value = 'deepseek';
      applyProviderPreset('deepseek');
      els.providerApiKey.value = '';
      setStatus(
        els.providerStatus,
        '已套用 DeepSeek 模板，填入 API Key 后点“测试连接”或“保存接口”即可开始',
        ''
      );
      return;
    }

    els.providerPreset.value = resolveProviderPreset(provider);
    els.providerKind.value = normalizeProviderKind(provider.kind);
    els.providerId.value = provider.id || activeId || 'local';
    els.providerBaseUrl.value = provider.baseUrl || '';
    els.providerApiKey.value = provider.apiKey ? MASKED_PROVIDER_SECRET : '';
    els.providerTemperature.value = normalizeProviderNumber(provider.temperature, 0.9);
    els.providerMaxTokens.value = normalizeProviderNumber(provider.maxTokens, 2000);
    if (els.providerTtsModel) els.providerTtsModel.value = String(provider.ttsModel || '');
    if (els.providerSttModel) els.providerSttModel.value = String(provider.sttModel || '');
    if (els.providerReasoningMode) els.providerReasoningMode.value = normalizeProviderReasoningMode(provider.reasoningMode);
    els.providerHeaders.value = prettyJson(provider.headers || {});
    renderProviderModelOptions(els.providerPreset.value, provider.model);

    if (provider.id) setStatus(els.providerStatus, `当前：${provider.id}`, 'ok');
    else setStatus(els.providerStatus, '未配置 provider', '');
  }

  function renderProviderRoutingOptions() {
    const providersConfig = getProvidersConfig();
    const providers = Array.isArray(providersConfig.providers) ? providersConfig.providers : [];
    const taskProviders = isPlainObject(providersConfig.taskProviders) ? providersConfig.taskProviders : {};
    const activeProviderId = String(providersConfig.activeProviderId || providers[0]?.id || '').trim();
    const selects = {
      chat: els.taskProviderChat,
      fact: els.taskProviderFact,
      summary: els.taskProviderSummary
    };

    Object.entries(selects).forEach(([taskKey, select]) => {
      if (!select) return;
      select.innerHTML = '';
      const followOption = documentObject.createElement('option');
      followOption.value = '';
      followOption.textContent = activeProviderId ? `跟随全局：${activeProviderId}` : '跟随全局';
      select.append(followOption);
      providers.forEach((provider) => {
        const option = documentObject.createElement('option');
        option.value = provider.id;
        option.textContent = provider.model ? `${provider.id} · ${provider.model}` : provider.id;
        select.append(option);
      });
      select.value = providers.some((provider) => provider.id === taskProviders[taskKey])
        ? taskProviders[taskKey]
        : '';
    });
    if (els.fallbackChainInput) {
      els.fallbackChainInput.value = Array.isArray(providersConfig.fallbackChain)
        ? providersConfig.fallbackChain.join(', ')
        : '';
    }
  }

  function syncOperationState() {
    [els.saveProvider, els.testProvider, els.saveProviderRouting].forEach((button) => {
      if (button) button.disabled = operationPending;
    });
  }

  function beginOperation() {
    if (operationPending) {
      setStatus(els.providerStatus, '上一项 Provider 操作仍在处理中', 'busy');
      return false;
    }
    operationPending = true;
    syncOperationState();
    return true;
  }

  function endOperation() {
    operationPending = false;
    syncOperationState();
  }

  async function saveProvider() {
    if (!beginOperation()) return null;
    setStatus(els.providerStatus, '正在保存...', 'busy');
    try {
      const provider = readProviderForm();
      const providers = buildProviderSaveConfig(getProvidersConfig(), provider);
      await apiRequest('/api/providers', { method: 'PUT', body: providers });
      setStatus(els.providerStatus, '接口已保存', 'ok');
      setStatus(els.appStatus, 'Provider 配置已更新', 'ok');
      await reloadState();
      return providers;
    } catch (error) {
      setStatus(els.providerStatus, `保存失败：${error.message}`, 'error');
      return null;
    } finally {
      endOperation();
    }
  }

  async function testProviderConnection() {
    if (!beginOperation()) return null;
    setStatus(els.providerStatus, '正在测试...', 'busy');
    setStatus(els.providerTestResult, '正在发起最小模型请求...', 'busy');
    try {
      const provider = readProviderForm();
      const { result } = await apiRequest('/api/providers/test', {
        method: 'POST',
        body: { provider }
      });
      const preview = result.responsePreview ? ` · ${result.responsePreview}` : '';
      setStatus(els.providerStatus, '连接正常', 'ok');
      setStatus(
        els.providerTestResult,
        `${result.model || result.providerId} · ${result.latencyMs} ms${preview}`,
        'ok'
      );
      return result;
    } catch (error) {
      setStatus(els.providerStatus, '连接失败', 'error');
      setStatus(els.providerTestResult, `测试失败：${humanizeApiError(error)}`, 'error');
      return null;
    } finally {
      endOperation();
    }
  }

  async function saveProviderRouting() {
    if (!beginOperation()) return null;
    try {
      const payload = buildProviderRoutingConfig(getProvidersConfig(), {
        chat: els.taskProviderChat?.value || '',
        fact: els.taskProviderFact?.value || '',
        summary: els.taskProviderSummary?.value || '',
        fallbackChain: els.fallbackChainInput?.value || ''
      });
      await apiRequest('/api/providers', { method: 'PUT', body: payload });
      state.config ||= {};
      state.config.providers = payload;
      setStatus(els.providerStatus, '路由配置已保存', 'ok');
      return payload;
    } catch (error) {
      setStatus(els.providerStatus, `保存失败：${error.message}`, 'error');
      return null;
    } finally {
      endOperation();
    }
  }

  function bindEvents() {
    if (eventsBound) return;
    eventsBound = true;
    els.providerForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      void saveProvider();
    });
    els.testProvider?.addEventListener('click', () => { void testProviderConnection(); });
    els.saveProviderRouting?.addEventListener('click', () => { void saveProviderRouting(); });
    els.providerPreset?.addEventListener('change', () => applyProviderPreset(els.providerPreset.value));
    els.providerModel?.addEventListener('change', syncProviderModelCustomField);
  }

  return {
    applyProviderPreset,
    bindEvents,
    getExistingProvider,
    getProviderPreset,
    isOperationPending: () => operationPending,
    normalizeProviderKind,
    readProviderForm,
    renderProviderForm,
    renderProviderRoutingOptions,
    renderProviderModelOptions,
    renderProviderPresetOptions,
    resolveApiKeyForSave,
    resolveProviderPreset,
    resolveSelectedProviderModel,
    saveProvider,
    saveProviderRouting,
    syncProviderModelCustomField,
    testProviderConnection
  };
}
