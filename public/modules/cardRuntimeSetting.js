export function createCardRuntimeSettingController({
  els = {},
  getSettings = () => ({}),
  beginOperation = () => false,
  endOperation = () => {},
  saveSettingsPatch = async () => ({}),
  renderSessionSettings = () => {},
  setStatus = () => {},
  humanizeApiError = (error) => error?.message || String(error)
} = {}) {
  function render() {
    if (els.cardRuntimeEnabled) {
      els.cardRuntimeEnabled.checked = getSettings()?.cardRuntimeEnabled !== false;
    }
  }

  function syncOperationState(operationPending) {
    if (els.cardRuntimeEnabled) els.cardRuntimeEnabled.disabled = operationPending;
  }

  async function save(enabled = els.cardRuntimeEnabled?.checked) {
    if (!beginOperation()) return null;
    const cardRuntimeEnabled = enabled !== false;
    const previousEnabled = getSettings()?.cardRuntimeEnabled !== false;
    if (els.cardRuntimeEnabled) els.cardRuntimeEnabled.checked = cardRuntimeEnabled;
    try {
      const session = await saveSettingsPatch({ cardRuntimeEnabled });
      renderSessionSettings();
      setStatus(els.appStatus, cardRuntimeEnabled ? '已启用角色卡运行化层' : '已关闭角色卡运行化层', 'ok');
      return session;
    } catch (error) {
      if (els.cardRuntimeEnabled) els.cardRuntimeEnabled.checked = previousEnabled;
      setStatus(els.appStatus, `运行化设置保存失败：${humanizeApiError(error)}`, 'error');
      return null;
    } finally {
      endOperation();
    }
  }

  function bindEvents() {
    els.cardRuntimeEnabled?.addEventListener('change', () => { void save(); });
  }

  return { bindEvents, render, save, syncOperationState };
}
