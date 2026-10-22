import { estimateTokens } from './token.js';
import { enforcePromptMessageBudget, limitTextToTokenBudget } from './promptBudget.js';

export function resolvePromptExecutionMode(options = {}, characterCard = {}, modules = []) {
  if (['faithful', 'enhanced'].includes(options.promptExecutionMode)) return options.promptExecutionMode;
  const ext = characterCard?.extensions || {};
  return characterCard?.sourceSpec || characterCard?.raw || ext.tavern_helper || ext.regex_scripts || ext.world || ext.chub
    || modules.some(m => m?.enabled !== false && m?.extensions?.sillyTavernPreset)
    ? 'faithful' : 'enhanced';
}

export function renderFaithfulCharacter(card, { includeOpening = false, includeExamples = true, contentMode = {} } = {}) {
  if (!card || card.enabled === false) return '';
  const fields = [['姓名', card.name], ['身份', card.role], ['描述', card.description], ['性格', card.personality],
    ['当前情境', card.scenario], ['角色系统提示', card.systemPrompt], ['语言风格', card.speechStyle || card.extensions?.speech],
    ['目标', card.goals], ['已知与盲区', card.knowledge || card.extensions?.knowledge], ['关系', card.relationships]];
  const generated = new Set(card.extensions?.local_roleplay_agent?.enrichment?.generatedFields || []);
  if (generated.has('personality')) fields.splice(fields.findIndex(([k]) => k === '性格'), 1);
  if (generated.has('scenario')) fields.splice(fields.findIndex(([k]) => k === '当前情境'), 1);
  if (includeOpening) fields.push(['开场语', card.firstMessage]);
  if (includeExamples && !generated.has('exampleDialog') && card.exampleDialog?.length) fields.push(['示例对话', card.exampleDialog.join('\n')]);
  return [contentMode.kind === 'scenario-container' ? '# 多角色场景卡\n根卡是场景容器。NPC 的性格分别取自自己的世界书人物条目，不能套用根卡或其他 NPC。' : '# 角色卡', ...fields.filter(([, v]) => v).map(([k, v]) => `${k}：${typeof v === 'string' ? v : JSON.stringify(v)}`)].join('\n');
}

export function faithfulControlPrompt(mode = 'dm') {
  return ['# 角色与互动边界',
    '沿用角色卡、世界书和所选预设的语言、文风与正文格式；人物只使用其已知信息。已确认的剧情保持连续，摘要与推测不得改写原设定。',
    mode === 'director' ? '按玩家明确的共创意图推进，重大选择仍交给玩家。' : '玩家控制自己的台词、内心和选择。结算玩家已经明确的行动，不擅自追加决定。',
    '根据当前互动自然收束；短对白可以简短，行动要给出实质后果，不反复添加同一悬念的前置条件。故事正文不夹带创作过程或内部分析；预设定义的独立辅助区块与正文分开，不作为已发生的剧情。',
    '状态表、选项与辅助区块遵循角色卡及已启用预设的明确要求；两者均未要求时，不额外添加。'].join('\n');
}

export function renderSourceExecutionPriority() {
  return [
    '玩家本轮明确的行动范围和禁止事项优先于预设的通用代写许可；通用许可不能扩展为玩家未授权的台词、内心或决定。',
    '行动限制约束正文实际发生的行为，不取消角色卡或已启用预设要求的状态表、选项和独立辅助区块。选项是待玩家选择的可能行动，不表示已经执行。',
    '事实与文风分开处理：回应涉及世界书规则时，保留相关条件、消耗和限制，不为了润色而替换或新增规则；正文格式及辅助区块格式按各自来源执行。'
  ].join('\n');
}

// Every block is atomic. Original instructions and minimum conversational context
// survive together, or the caller receives a useful budget error before generation.
export function enforceFaithfulPromptBudget(messages, { maxTokens } = {}) {
  const source = messages.map(m => ({ ...m }));
  const cost = list => estimateTokens(list.map(m => `${m.role}: ${m.content}`).join('\n'));
  const omitted = [];
  const kept = [...source];
  const budget = Number(maxTokens) > 0 ? Math.floor(Number(maxTokens)) : Infinity;
  // Shed generated supplements before sacrificing any conversation turn.
  for (const message of source.filter(m => m._promptOptional === true)) {
    if (cost(kept) <= budget) break;
    const index = kept.indexOf(message);
    if (index >= 0) omitted.push(...kept.splice(index, 1));
  }
  const olderTurns = [...new Set(kept.filter(m => m._promptKind === 'history').map(m => m._promptTurnId))];
  for (const turn of olderTurns) {
    if (cost(kept) <= budget) break;
    for (let i = kept.length - 1; i >= 0; i--) {
      if (kept[i]._promptKind === 'history' && kept[i]._promptTurnId === turn) omitted.push(...kept.splice(i, 1));
    }
  }
  const requiredTokens = cost(kept);
  if (requiredTokens > budget) {
    const error = new Error(`完整保留原卡与预设需要至少 ${requiredTokens} 个估算上下文 token，当前上限为 ${budget}。请在会话设置提高上下文预算，或精简已启用的预设与世界书；本轮未发送给模型。`);
    error.code = 'PROMPT_BUDGET_INSUFFICIENT';
    error.requiredTokens = requiredTokens;
    throw error;
  }
  const result = enforcePromptMessageBudget(kept, {});
  const omittedInspection = enforcePromptMessageBudget(omitted, {}).messageInspection;
  result.report = { ...result.report, maxTokens: Number.isFinite(budget) ? budget : null,
    beforeTokens: cost(source), afterTokens: requiredTokens,
    omittedKinds: omitted.reduce((counts, m) => ({ ...counts, [m._promptKind]: (counts[m._promptKind] || 0) + 1 }), {}),
    optionalTokensRemoved: cost(omitted.filter(m => m._promptOptional)),
    omittedMessageInspection: omittedInspection.map((m, i) => ({ ...m, status: 'evicted-by-budget', evictionReason: omitted[i]?._promptOptional ? '预算不足，优先移除可选 Agent 补充' : '为完整原卡和预设保留空间' })) };
  return result;
}

export function compactFaithfulMemory(sections) {
  return sections.filter(Boolean).map(s => {
    // State was already compacted structurally. Cutting its serialized form
    // creates invalid JSON and loses the distinction between absent and false.
    if (s.startsWith('# 结构化世界状态\n')) return s;
    return limitTextToTokenBudget(s, 200);
  }).join('\n\n');
}

export function budgetWholeWorldBookEntries(entries, { maxTokens } = {}) {
  const selected = [];
  const omitted = [];
  let usedTokens = 0;
  const cap = Math.max(0, Number(maxTokens) || 0);
  for (const entry of entries) {
    const tokens = estimateTokens(String(entry.content || ''));
    if (usedTokens + tokens <= cap) { selected.push(entry); usedTokens += tokens; }
    else omitted.push(entry.id);
  }
  return { entries: selected, report: { maxTokens: cap, maxEntryTokens: null, usedTokens,
    selectedCount: selected.length, omittedCount: omitted.length, omittedIds: omitted, truncatedCount: 0 } };
}
