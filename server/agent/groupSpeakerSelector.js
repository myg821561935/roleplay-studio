// 群聊发言者选择内核（p2-03a）：
// - 三种激活策略：talkativeness 加权随机 / list-order 顺序轮转 / manual 仅手动
// - 手动指定优先级最高；排除上一位发言者避免连发（仅加权模式）
// - 纯函数：rng 注入随机源，便于测试确定性
//
// 语义与 agentService.resolveGroupSpeaker 保持兼容：
// - 无启用成员时回落主卡名；talkativeness 非法值默认 0.5

const DEFAULT_TALKATIVENESS = 0.5;

export const SPEAKER_ACTIVATION_STRATEGIES = Object.freeze([
  'talkativeness',
  'list-order',
  'manual'
]);

export function normalizeActivationStrategy(value) {
  return SPEAKER_ACTIVATION_STRATEGIES.includes(value) ? value : 'talkativeness';
}

// 读取成员话唠度：顶层优先，兼容 extensions.talkativeness（酒馆卡导入路径）
export function readTalkativeness(member) {
  const raw = member?.talkativeness ?? member?.extensions?.talkativeness;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_TALKATIVENESS;
  return Math.min(1, value);
}

function collectEnabledMembers(groupMembers) {
  return (Array.isArray(groupMembers) ? groupMembers : [])
    .filter((member) => member && member.enabled !== false && String(member.name || '').trim());
}

function findLastSpeaker(messages) {
  return [...(Array.isArray(messages) ? messages : [])]
    .reverse()
    .find((message) => message?.role === 'assistant' && message?.speaker)?.speaker || '';
}

// 是否是合法的手动指定：主卡名或任一启用成员（含 extensions.aliases）
function isKnownSpeaker(name, enabledMembers, characterCard) {
  const target = String(name || '').trim().toLowerCase();
  if (!target) return false;
  if (target === String(characterCard?.name || '').trim().toLowerCase()) return true;
  return enabledMembers.some((member) => {
    if (member.name.toLowerCase() === target) return true;
    const aliases = Array.isArray(member.extensions?.aliases) ? member.extensions.aliases : [];
    return aliases.some((alias) => String(alias || '').trim().toLowerCase() === target);
  });
}

// 加权轮盘赌：roll ∈ [0, total)，命中第一个累计权重超过 roll 的成员
function pickWeighted(pool, roll) {
  const weights = pool.map(readTalkativeness);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return pool[0]?.name || '';

  let cursor = roll * total;
  for (let i = 0; i < pool.length; i++) {
    cursor -= weights[i];
    if (cursor <= 0) return pool[i].name;
  }
  return pool[pool.length - 1].name;
}

// 顺序轮转：从上一位发言者之后继续；无历史则从首位开始
function pickListOrder(enabledMembers, lastSpeaker, characterCard) {
  if (!lastSpeaker) return enabledMembers[0].name;
  const lastIndex = enabledMembers.findIndex((member) => member.name === lastSpeaker);
  if (lastIndex === -1) {
    // 上一位是主卡或名单外角色：从成员首位重新开始
    return enabledMembers[0].name;
  }
  return enabledMembers[(lastIndex + 1) % enabledMembers.length].name;
}

/**
 * 选择本轮群聊发言者。
 * @returns {{ speaker: string, reason: 'manual'|'weighted'|'round-robin'|'fallback' }}
 *  - manual:    显式指定且名字在候选集内
 *  - weighted:  talkativeness 加权随机（排除上一位后仍有人）
 *  - round-robin: list-order 顺序轮转，或加权模式排除上一位后只剩其本人
 *  - fallback:  无启用成员回落主卡名（或空串）
 */
export function selectGroupSpeaker({
  groupMembers = [],
  characterCard = null,
  messages = [],
  targetSpeaker = '',
  activationStrategy = 'talkativeness',
  rng = Math.random
} = {}) {
  const strategy = normalizeActivationStrategy(activationStrategy);
  const enabledMembers = collectEnabledMembers(groupMembers);
  const mainName = String(characterCard?.name || '').trim();

  // 手动指定：任何策略下都优先，且必须名单内（含主卡/别名）才生效
  const manualName = String(targetSpeaker || '').trim();
  if (manualName && isKnownSpeaker(manualName, enabledMembers, characterCard)) {
    return { speaker: manualName, reason: 'manual' };
  }

  if (!enabledMembers.length) {
    return { speaker: mainName, reason: 'fallback' };
  }

  // manual 策略未显式指定：不主动选择，交给主卡/模型自由发挥
  if (strategy === 'manual') {
    return { speaker: manualName || mainName, reason: 'fallback' };
  }

  const lastSpeaker = findLastSpeaker(messages);

  if (strategy === 'list-order') {
    return { speaker: pickListOrder(enabledMembers, lastSpeaker, characterCard), reason: 'round-robin' };
  }

  // talkativeness：排除上一位避免连发；剔除后为空（唯一成员刚发言）回退全量
  const candidates = lastSpeaker
    ? enabledMembers.filter((member) => member.name !== lastSpeaker)
    : enabledMembers;
  const pool = candidates.length ? candidates : enabledMembers;

  if (pool.length === 1) {
    return { speaker: pool[0].name, reason: 'round-robin' };
  }

  const roll = typeof rng === 'function' ? Number(rng()) : 0;
  return { speaker: pickWeighted(pool, Number.isFinite(roll) ? roll : 0), reason: 'weighted' };
}
