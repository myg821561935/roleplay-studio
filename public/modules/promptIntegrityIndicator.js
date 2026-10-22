export function renderSessionPromptIntegrity({ state = {}, element } = {}) {
  if (!element) return;
  const promptRuntime = state.session?.memory?.promptRuntime;
  const integrity = promptRuntime?.communityPresetIntegrity || {};
  const suppressed = Array.isArray(integrity.suppressedBundles) ? integrity.suppressedBundles : [];
  const protectedPreset = integrity.status === 'suppressed-for-integrity' || suppressed.length > 0;
  const hasCommunityPreset = (state.config?.promptModules || []).some((module) => (
    Boolean(module?.extensions?.sillyTavernPreset)
  ));
  const pendingVerification = hasCommunityPreset && !promptRuntime?.communityPresetIntegrity;
  element.textContent = protectedPreset
    ? '预设待调整'
    : pendingVerification ? '预设待核验' : '预设完整';
  element.classList.toggle('is-warning', protectedPreset);
  element.classList.toggle('is-pending', pendingVerification);
  element.title = protectedPreset
    ? suppressed.map((item) => `${item.title || '社区预设'}：${item.reason || '完整性保护'}`).join('；')
    : pendingVerification
      ? '尚未生成本地完整性预览；请在提示词工作室刷新预览后确认运行状态'
      : '当前社区预设未被拆分，可按完整语义运行';
  if (promptRuntime?.executionMode === 'faithful') {
    element.textContent = `原卡优先 · ${element.textContent}`;
    element.title = `上次生成：原卡优先，估算 ${promptRuntime.tokenEstimate || 0} token。${element.title}`;
  }
  if (promptRuntime?.regexAudit?.length) element.title += `；已保留 ${promptRuntime.regexAudit.length} 条被正则清空的玩家行动`;
  if (promptRuntime?.worldBookOmittedIds?.length) {
    element.textContent = '世界书待调整';
    element.classList.toggle('is-warning', true);
    element.title += `；世界书预算排除了 ${promptRuntime.worldBookOmittedIds.length} 项，请在提示词工作室检查`;
  }
}
