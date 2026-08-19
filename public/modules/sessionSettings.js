import {
  NARRATIVE_MODE_LABELS,
  RESPONSE_LENGTH_LABELS,
  ROLEPLAY_MODE_LABELS,
  normalizeNarrativeMode,
  normalizeResponseLength,
  normalizeRoleplayMode
} from './sessionSettingModes.js';
import { createCardRuntimeSettingController } from './cardRuntimeSetting.js';
import { renderSessionPromptIntegrity } from './promptIntegrityIndicator.js';
export { NARRATIVE_MODES, RESPONSE_LENGTH_MODES, ROLEPLAY_MODES, normalizeNarrativeMode, normalizeResponseLength, normalizeRoleplayMode } from './sessionSettingModes.js';
export function createSessionSettingsController({
  state = {},
  els = {},
  apiRequest = async () => ({}),
  getSessionId = () => 'main',
  replaceSession = () => {},
  setStatus = () => {},
  humanizeApiError = (error) => error?.message || String(error),
  documentObject = globalThis.document
} = {}) {
  let eventsBound = false;
  let operationPending = false;
  let settingsWriteTail = Promise.resolve();
  let pendingWriteCount = 0;
  const settingsCache = new Map();
  const cardRuntimeSettingController = createCardRuntimeSettingController({
    els,
    getSettings: () => state.session?.settings || {},
    beginOperation,
    endOperation,
    saveSettingsPatch,
    renderSessionSettings,
    setStatus,
    humanizeApiError
  });
  function renderNarrativeMode(mode = state.session?.settings?.narrativeMode) {
    const narrativeMode = normalizeNarrativeMode(mode);
    (els.narrativeModeButtons || []).forEach((button) => {
      const active = button.dataset.narrativeMode === narrativeMode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }
  function renderSessionSettings() {
    if (!els.sessionProvider) return;
    const providersConfig = state.config?.providers || {};
    const providers = Array.isArray(providersConfig.providers) ? providersConfig.providers : [];
    const activeProviderId = String(providersConfig.activeProviderId || providers[0]?.id || '').trim();
    const selectedProviderId = String(state.session?.settings?.providerId || '').trim();
    const selectedProvider = providers.find((provider) => provider.id === selectedProviderId);
    els.sessionProvider.innerHTML = '';
    const followOption = documentObject.createElement('option');
    followOption.value = '';
    followOption.textContent = activeProviderId ? `跟随全局：${activeProviderId}` : '跟随全局';
    els.sessionProvider.append(followOption);
    providers.forEach((provider) => {
      const option = documentObject.createElement('option');
      option.value = provider.id;
      option.textContent = provider.model ? `${provider.id} · ${provider.model}` : provider.id;
      els.sessionProvider.append(option);
    });
    els.sessionProvider.value = selectedProvider ? selectedProviderId : '';
    const currentLabel = selectedProvider
      ? (selectedProvider.model ? `${selectedProvider.id} · ${selectedProvider.model}` : selectedProvider.id)
      : followOption.textContent;
    setStatus(els.sessionSettingsStatus, currentLabel, '');
    renderNarrativeMode();
    if (els.sessionResponseLength) {
      els.sessionResponseLength.value = normalizeResponseLength(state.session?.settings?.responseLength);
    }
    if (els.sessionRoleplayMode) {
      els.sessionRoleplayMode.value = normalizeRoleplayMode(state.session?.settings?.roleplayMode);
    }
    renderSessionPromptIntegrity({ state, element: els.sessionPromptIntegrity });
    cardRuntimeSettingController.render();
  }
  function syncOperationState() {
    if (els.saveSessionSettings) els.saveSessionSettings.disabled = operationPending;
    (els.narrativeModeButtons || []).forEach((button) => {
      button.disabled = operationPending;
    });
    if (els.sessionResponseLength) els.sessionResponseLength.disabled = operationPending;
    if (els.sessionRoleplayMode) els.sessionRoleplayMode.disabled = operationPending;
    cardRuntimeSettingController.syncOperationState(operationPending);
  }
  function beginOperation() {
    if (operationPending) {
      setStatus(els.sessionSettingsStatus, '上一项会话设置仍在保存', 'busy');
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
  function saveSettingsPatch(settingsPatch) {
    if (!settingsPatch || typeof settingsPatch !== 'object' || Array.isArray(settingsPatch)) {
      return Promise.reject(new Error('SESSION_SETTINGS_PATCH_INVALID'));
    }
    const sessionId = String(getSessionId() || 'main');
    const capturedSettings = { ...(state.session?.settings || {}) };
    pendingWriteCount += 1;

    const execute = async () => {
      const activeSessionId = String(getSessionId() || 'main');
      const currentSettings = activeSessionId === sessionId ? state.session?.settings : null;
      const settings = {
        ...capturedSettings,
        ...(settingsCache.get(sessionId) || {}),
        ...(currentSettings || {}),
        ...settingsPatch
      };
      const payload = await apiRequest('/api/session/settings', {
        method: 'PUT',
        body: { sessionId, settings }
      });
      const savedSession = payload.session || {
        ...(activeSessionId === sessionId ? state.session : {}),
        id: sessionId,
        settings
      };
      settingsCache.set(sessionId, savedSession.settings || settings);
      if (String(getSessionId() || 'main') === sessionId) {
        replaceSession(savedSession, { fallback: { ...(state.session || {}), settings } });
      }
      return savedSession;
    };

    const task = settingsWriteTail.then(execute);
    const trackedTask = task.finally(() => {
      pendingWriteCount -= 1;
    });
    settingsWriteTail = trackedTask.catch(() => {});
    return trackedTask;
  }

  async function saveSessionProvider() {
    if (!els.sessionProvider || !beginOperation()) return null;
    setStatus(els.sessionSettingsStatus, '正在保存...', 'busy');
    try {
      const session = await saveSettingsPatch({ providerId: els.sessionProvider.value });
      renderSessionSettings();
      setStatus(els.sessionSettingsStatus, '会话模型已绑定', 'ok');
      return session;
    } catch (error) {
      setStatus(els.sessionSettingsStatus, `保存失败：${humanizeApiError(error)}`, 'error');
      return null;
    } finally {
      endOperation();
    }
  }

  async function saveNarrativeMode(mode) {
    if (!beginOperation()) return null;
    const narrativeMode = normalizeNarrativeMode(mode);
    const previousMode = normalizeNarrativeMode(state.session?.settings?.narrativeMode);
    renderNarrativeMode(narrativeMode);
    try {
      const session = await saveSettingsPatch({ narrativeMode });
      renderSessionSettings();
      setStatus(els.appStatus, `已切换为${NARRATIVE_MODE_LABELS[narrativeMode]}`, 'ok');
      return session;
    } catch (error) {
      if (state.session) {
        state.session.settings = {
          ...(state.session.settings || {}),
          narrativeMode: previousMode
        };
      }
      renderSessionSettings();
      setStatus(els.appStatus, `路线模式保存失败：${humanizeApiError(error)}`, 'error');
      return null;
    } finally {
      endOperation();
    }
  }

  async function saveResponseLength(mode = els.sessionResponseLength?.value) {
    if (!beginOperation()) return null;
    const responseLength = normalizeResponseLength(mode);
    const previousLength = normalizeResponseLength(state.session?.settings?.responseLength);
    if (els.sessionResponseLength) els.sessionResponseLength.value = responseLength;
    try {
      const session = await saveSettingsPatch({ responseLength });
      renderSessionSettings();
      setStatus(els.appStatus, `已切换为${RESPONSE_LENGTH_LABELS[responseLength]}`, 'ok');
      return session;
    } catch (error) {
      if (els.sessionResponseLength) els.sessionResponseLength.value = previousLength;
      setStatus(els.appStatus, `篇幅设置保存失败：${humanizeApiError(error)}`, 'error');
      return null;
    } finally {
      endOperation();
    }
  }

  async function saveRoleplayMode(mode = els.sessionRoleplayMode?.value) {
    if (!beginOperation()) return null;
    const roleplayMode = normalizeRoleplayMode(mode);
    const previousMode = normalizeRoleplayMode(state.session?.settings?.roleplayMode);
    if (els.sessionRoleplayMode) els.sessionRoleplayMode.value = roleplayMode;
    try {
      const session = await saveSettingsPatch({ roleplayMode });
      renderSessionSettings();
      setStatus(els.appStatus, `已切换为${ROLEPLAY_MODE_LABELS[roleplayMode]}`, 'ok');
      return session;
    } catch (error) {
      if (els.sessionRoleplayMode) els.sessionRoleplayMode.value = previousMode;
      setStatus(els.appStatus, `演绎流派保存失败：${humanizeApiError(error)}`, 'error');
      return null;
    } finally {
      endOperation();
    }
  }
  function bindEvents() {
    if (eventsBound) return;
    eventsBound = true;
    els.saveSessionSettings?.addEventListener('click', () => { void saveSessionProvider(); });
    els.sessionResponseLength?.addEventListener('change', () => { void saveResponseLength(); });
    els.sessionRoleplayMode?.addEventListener('change', () => { void saveRoleplayMode(); });
    cardRuntimeSettingController.bindEvents();
    (els.narrativeModeButtons || []).forEach((button) => {
      button.addEventListener('click', () => { void saveNarrativeMode(button.dataset.narrativeMode); });
    });
  }

  return {
    bindEvents,
    isOperationPending: () => operationPending,
    isWritePending: () => pendingWriteCount > 0,
    renderSessionSettings,
    saveNarrativeMode,
    saveRoleplayMode,
    saveResponseLength,
    saveSettingsPatch,
    saveSessionProvider
  };
}
