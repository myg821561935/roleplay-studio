const INFLUENCE_MARKER = /(?:催眠|暗示|洗脑|认知植入|人格改写|精神控制)/iu;
const COMPLIANCE_MARKER = /(?:服从|指令|控制|无条件相信|绝对权威|必须执行)/iu;
const STAGE_PATTERN = /(?:催眠(?:等级|阶段)?|心智(?:影响|阶段)|影响等级)\s*(?:为|:|：)?\s*(Lv\.?\s*\d{1,2}|\d{1,2}\s*级)/iu;

/**
 * Converts imported mind-influence rules into an execution contract without
 * altering the source card. A rule can constrain what a character accepts as
 * real while their personality, habits, and attachments still make the path
 * to acting on it visible and gradual.
 */
export function buildPsychologicalProgressionPrompt({
  characterCard,
  activeCards = [],
  memory
} = {}) {
  const sourceText = collectSourceText(characterCard, activeCards);
  if (!INFLUENCE_MARKER.test(sourceText) || !COMPLIANCE_MARKER.test(sourceText)) {
    return {
      prompt: '',
      report: { applies: false, knownStage: '' }
    };
  }

  const knownStage = findKnownInfluenceStage(memory?.worldState);
  const stageLine = knownStage
    ? `当前世界状态已明确记录影响等级为「${knownStage}」；只能在这一等级允许的范围内描写。`
    : '当前世界状态没有明确记录影响等级；按初始影响处理，不能自行写成深度习惯化或人格终局。';

  return {
    prompt: [
      '# 心智渐变与本心冲突契约',
      stageLine,
      '资源中的认知影响可以让角色把限定规则或身份视为现实，但不等于原有人格、伦理感、职业身份、关系牵挂、羞耻感与自我保护本能立即消失。',
      '冲突应表现为“被改写的认知”和“原有本心”之间的拉扯：角色可以在规则框架内迟疑、质问、拖延、回避、辩解，或在事后试图重新解释自己的行为。若资源规定某项明确指令必须执行，外在动作仍不得被写成心悦诚服或人格已被抹除。',
      '每回合最多推进一个可观察的心理节拍：①本能抗拒与自我保护；②寻找合理解释；③局部失衡、停顿或自我矛盾；④只有在已记录的反复触发和明确状态证据下，才允许出现更深的习惯化。不得仅凭题材、一次接触或一句命令跨越多个节拍。',
      '本轮如涉及受影响角色，至少写出一项来自其原有人格的反应，以及一项与之冲突的选择或代价；未明确受影响的事业、亲友、社会风险和长期目标仍持续产生后果。',
      '旁白不得替人物宣布“本心已消失”“人格改写完毕”“完全自愿”等终局判断；也不得替用户扩张指令、制造未被用户选择的越界行动。'
    ].join('\n'),
    report: { applies: true, knownStage }
  };
}

function collectSourceText(characterCard = {}, activeCards = []) {
  const cardFields = [
    characterCard?.name,
    characterCard?.description,
    characterCard?.personality,
    characterCard?.scenario,
    characterCard?.systemPrompt,
    characterCard?.postHistoryInstructions,
    characterCard?.creatorNotes,
    ...(Array.isArray(characterCard?.exampleDialog) ? characterCard.exampleDialog : [])
  ];
  const worldBookFields = (Array.isArray(activeCards) ? activeCards : []).flatMap((card) => [
    card?.title,
    card?.content,
    card?.comment
  ]);
  return [...cardFields, ...worldBookFields].filter(Boolean).join('\n');
}

function findKnownInfluenceStage(value, depth = 0) {
  if (depth > 5 || value === null || value === undefined) return '';
  if (typeof value === 'string') {
    const match = value.match(STAGE_PATTERN);
    return match ? match[1].replace(/\s+/g, '').replace(/^lv\.?/iu, 'Lv.') : '';
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const stage = findKnownInfluenceStage(entry, depth + 1);
      if (stage) return stage;
    }
    return '';
  }
  if (typeof value === 'object') {
    for (const entry of Object.values(value)) {
      const stage = findKnownInfluenceStage(entry, depth + 1);
      if (stage) return stage;
    }
  }
  return '';
}
