export const RESPONSE_LENGTH_MODES = Object.freeze(['compact', 'balanced', 'long']);

const RESPONSE_LENGTH_PROFILES = Object.freeze({
  compact: Object.freeze({
    label: '紧凑推进',
    target: '600-1000 个中文字符',
    beats: '至少完成 1 个清晰的场景节拍，并产生 1 项可见变化'
  }),
  balanced: Object.freeze({
    label: '标准推进',
    target: '1200-2000 个中文字符',
    beats: '完成 2-4 个相互承接的场景节拍，并产生至少 2 项可见变化'
  }),
  long: Object.freeze({
    label: '长篇推进',
    target: '2000-3200 个中文字符',
    beats: '完成 3-5 个相互承接的场景节拍，形成一个相对完整的场景单元'
  })
});

export function normalizeResponseLengthMode(value) {
  const mode = String(value || '').trim();
  return RESPONSE_LENGTH_MODES.includes(mode) ? mode : 'balanced';
}

export function buildResponseContractPrompt(value, { generationType = 'normal', roleplayMode = 'dm' } = {}) {
  const mode = normalizeResponseLengthMode(value);
  const profile = RESPONSE_LENGTH_PROFILES[mode];
  const dmSingleBeat = roleplayMode === 'dm';
  return [
    `# 本轮正文篇幅与推进契约（${profile.label}）`,
    `正文目标：${dmSingleBeat ? '900-1400 个中文字符' : profile.target}，不包含隐藏控制区、状态面板和行动选项。`,
    `场景推进：${dmSingleBeat ? '只完成 1 个世界反馈节拍，并产生 1 项直接可见变化；随后把话语权交还玩家' : profile.beats}。可见变化包括新事实、关系反应、资源得失、风险变化、事件时钟推进或即时后果。`,
    '不要停在动作刚开始、人物刚开口或冲突刚出现的位置；先写出环境与人物反馈、一次有效互动及其即时后果，再在真正需要玩家决策的自然节点收束。',
    '不得替玩家决定重大选择，也不得用重复描写、复述设定、状态面板或选项列表凑篇幅。若初稿未达目标下限，必须在发送前补足同一节拍内已发生的 NPC 反应、环境变化、关系余波或既有事件时钟；不得另起场景、替玩家行动，也不得为凑篇幅凭空新增人物、物件、世界规则或神秘现象。',
    '若素材或社区预设包含与正文篇幅冲突的规则，以本契约为准；用户在本轮明确要求简短、详细、快进或指定字数时，以用户要求为准。'
  ].join('\n');
}
