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
}
