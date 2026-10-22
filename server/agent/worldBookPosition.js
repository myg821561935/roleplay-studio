/**
 * SillyTavern world-info position 的唯一归一化入口。
 *
 * 导入、宏占位符和最终提示词组装都必须依赖这一份映射，避免数字枚举在
 * 不同运行阶段产生不同含义。当前不执行 Author's Note / outlet 插槽，
 * 因此这些位置会明确降级到最接近的可表达系统位置。
 */
export function normalizeWorldBookPosition(position) {
  const value = String(position ?? '').trim().toLowerCase();
  const numericPosition = /^\d+$/u.test(value) ? Number(value) : Number.NaN;
  if (numericPosition === 0) return 'before_character';
  if (numericPosition === 1) return 'after_character';
  if (numericPosition === 4) return 'at_depth';
  if (numericPosition === 5) return 'before_eff';
  if (numericPosition === 6) return 'after_eff';
  // Author's Note / outlet 当前没有对应的可执行插槽。保留文本，并由
  // Prompt Studio 公开显示降级信息，不能伪装成已完整兼容。
  if (numericPosition === 2 || numericPosition === 3) return 'after_character';
  if (numericPosition === 7) return 'after_eff';

  if (value === 'before_char' || value === 'before_character' || value === 'before') {
    return 'before_character';
  }
  if (value === 'at_depth' || value === 'in_chat') return 'at_depth';
  if (value === 'before_eff' || value === 'before_enhance' || value === 'before_extension' || value === 'before_preset') {
    return 'before_eff';
  }
  if (value === 'after_eff' || value === 'after_enhance' || value === 'after_extension' || value === 'after_preset') {
    return 'after_eff';
  }
  return 'after_character';
}

export function describeWorldBookPositionCompatibility(card = {}) {
  const value = String(card?.position ?? '').trim();
  const position = /^\d+$/u.test(value) ? Number(value) : Number.NaN;
  if (!Number.isInteger(position) || ![2, 3, 7].includes(position)) return null;
  const details = {
    2: ['author-note-top', '当前运行时未实现酒馆 Author’s Note 顶部插槽，已安全降级到角色定义之后。'],
    3: ['author-note-bottom', '当前运行时未实现酒馆 Author’s Note 底部插槽，已安全降级到角色定义之后。'],
    7: ['outlet', '当前运行时不执行酒馆 outlet 扩展语义，已仅作为预设后系统文本保留。']
  }[position];
  return {
    id: String(card.id || ''),
    title: String(card.title || card.name || '未命名世界书'),
    sourcePosition: position,
    normalizedPosition: normalizeWorldBookPosition(position),
    status: 'degraded',
    capability: details[0],
    reason: details[1]
  };
}
