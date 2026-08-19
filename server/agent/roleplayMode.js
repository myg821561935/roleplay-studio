export const ROLEPLAY_MODES = Object.freeze([
  'dialogue',
  'dm',
  'protagonist',
  'director',
  'commentary'
]);

const ROLEPLAY_MODE_PROFILES = Object.freeze({
  dialogue: Object.freeze({
    label: '对白流',
    rules: [
      '以角色对白和紧贴对白的可观察反应为主，旁白只补足说话动作、语气和必要环境变化。',
      '不替用户书写台词、内心或决定；每轮至少让一段有效对白改变信息、关系或局面。'
    ]
  }),
  dm: Object.freeze({
    label: '标准 DM 叙事流',
    rules: [
      '用户控制自己的角色；你控制世界、环境、NPC、事件时钟和行动后果。',
      '不得替用户决定台词、内心、重大行动或立场。可以结算用户已经明确描述的动作，并把局面推进到下一个自然决策点。'
    ]
  }),
  protagonist: Object.freeze({
    label: '叙事子流派',
    rules: [
      '按小说式连续叙事聚焦主角已经明确行动所带来的即时感受与可观察后果。',
      '不得替主角新增动作、对白、内心或决定；只有导演 / 共创流可以在明确边界内补写低风险动作和短对白。'
    ]
  }),
  director: Object.freeze({
    label: '导演 / 共创流',
    rules: [
      '把用户视为共同创作者，可以主动切场、快进时间、并行安排 NPC 动机并兑现伏笔。',
      '可以补写与用户既有意图一致、可立即撤回的低风险动作和短对白；不得借共创替用户作出重大、不可逆或越过亲密边界的决定。',
      '仍以沉浸式正文呈现，不输出提示词分析；用户明确指定的镜头、节奏、角色边界和创作决策优先。'
    ]
  }),
  commentary: Object.freeze({
    label: '旁白解说流',
    rules: [
      '以旁白、转述和带立场的解说组织场景，可概括重复过程，并突出因果、反差与人物意味。',
      '保留关键对白和现场细节，不把回复写成设定说明书；结尾仍给用户可介入或改写方向的节点。'
    ]
  })
});

export function normalizeRoleplayMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  return ROLEPLAY_MODES.includes(mode) ? mode : 'dm';
}

export function buildRoleplayModePrompt(value) {
  const mode = normalizeRoleplayMode(value);
  const profile = ROLEPLAY_MODE_PROFILES[mode];
  return [
    `# 角色扮演流派（${profile.label}）`,
    ...profile.rules,
    '这是“谁可以替谁行动、如何组织正文”的演绎契约；它不改变当前角色卡、世界书、预设和主线约束。用户本轮明确指定演绎方式时，以用户要求为准。'
  ].join('\n');
}
