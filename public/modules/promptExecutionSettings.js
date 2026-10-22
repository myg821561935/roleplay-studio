export function createPromptExecutionSettings({ state, els, saveSettingsPatch, renderSessionSettings, setStatus, humanizeApiError }) {
  const mode = els.sessionPromptExecutionMode;
  const budget = els.sessionPromptBudget;
  const enhancements = ['memoryRecall', 'npcSimulation', 'plotGuidance', 'actionSuggestions'].map(key => [key, els['enhancement' + key[0].toUpperCase() + key.slice(1)]]);
  function render() {
    if (mode) mode.value = state.session?.settings?.promptExecutionMode || 'auto';
    enhancements.forEach(([key, element]) => { if (element) element.value = typeof state.session?.settings?.agentEnhancements?.[key] === 'boolean' ? String(state.session.settings.agentEnhancements[key]) : 'auto'; });
    if (budget) budget.value = state.session?.settings?.maxPromptTokens || 8000;
  }
  async function save() {
    if (mode?.disabled || budget?.disabled) return;
    const maxPromptTokens = Number(budget?.value || state.session?.settings?.maxPromptTokens || 8000);
    if (!Number.isFinite(maxPromptTokens) || maxPromptTokens < 1000) {
      setStatus(els.sessionSettingsStatus, '请输入至少 1000 的上下文预算。', 'error'); return;
    }
    enhancements.forEach(([, element]) => { if (element) element.disabled = true; });
    if (mode) mode.disabled = true;
    if (budget) budget.disabled = true;
    try {
      const agentEnhancements = { ...(state.session?.settings?.agentEnhancements || {}) };
      enhancements.forEach(([key, element]) => { if (!element) return; if (element.value === 'auto') delete agentEnhancements[key]; else agentEnhancements[key] = element.value === 'true'; });
      await saveSettingsPatch({ agentEnhancements, promptExecutionMode: mode?.value || 'auto', maxPromptTokens: Math.floor(maxPromptTokens) });
      renderSessionSettings();
      setStatus(els.sessionSettingsStatus, '故事执行设置已保存，下轮生效', 'ok');
    } catch (error) { render(); setStatus(els.sessionSettingsStatus, humanizeApiError(error), 'error'); }
    finally { enhancements.forEach(([, element]) => { if (element) element.disabled = false; }); if (mode) mode.disabled = false; if (budget) budget.disabled = false; }
  }
  return { render, bind: () => { enhancements.forEach(([, element]) => element?.addEventListener('change', save)); mode?.addEventListener('change', save); budget?.addEventListener('change', save); } };
}
