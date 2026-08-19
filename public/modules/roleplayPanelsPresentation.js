// 角色扮演面板的呈现归一化：
// 结构信息恢复后清除陈旧的「未生成结构化交互信息」占位提示
export function normalizeRoleplayPanelsForPresentation(panels = {}, { message = {}, presentation = null } = {}) {
  const next = { ...(panels && typeof panels === 'object' ? panels : {}) };
  const staleMissingStructureNotice = '本轮未生成结构化交互信息';
  const hasRecoveredStructure = Boolean(message?.turnFrame)
    || /<turn[_-]?frame\b/i.test(String(message?.content || ''))
    || ['sceneStatus', 'characterStatus', 'relationshipStatus', 'nextCharacter']
      .some((key) => String(presentation?.panels?.[key] || '').trim());
  if (hasRecoveredStructure && String(next.runtimeNotice || '').includes(staleMissingStructureNotice)) {
    const remaining = String(next.runtimeNotice || '')
      .split(/\r?\n/u)
      .filter((line) => !line.includes(staleMissingStructureNotice))
      .join('\n')
      .trim();
    if (remaining) next.runtimeNotice = remaining;
    else delete next.runtimeNotice;
  }
  return next;
}
