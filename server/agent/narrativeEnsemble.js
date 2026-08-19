const WEEKDAY_VALUES = Object.freeze({
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 7,
  天: 7
});

const FUTURE_APPOINTMENT_PATTERN = /(?:周|星期)[一二三四五六日天]|下周|下月|明天|后天|改日|届时|预约|约定|会合|赴约|见面|到访/u;
const CONTINUATION_ONLY_PATTERN = /^(?:[（(]?\s*)?(?:请)?(?:继续(?:推进剧情|推进|生成|续写)?|续写|往下写)(?:\s*[）)]?[。.!！]?)$/u;

/**
 * A read-only turn planner for ensemble stories. It deliberately does not
 * choose the next NPC; it only prevents a remembered relationship or a
 * future appointment from impersonating the player's present objective.
 */
export function buildNarrativeEnsemblePrompt({ memory, messages, userMessage = '' } = {}) {
  const plan = resolveNarrativeEnsemble({ memory, messages, userMessage });
  const lines = [
    '# 群像与时间调度契约 v1',
    '角色卡、世界书与已经确认的会话事实共同决定可用人物；它们声明人物存在和边界，不等于必须让某一人立刻登场。',
    '先结算玩家当前明确行动及同场因果。不得为了“推进主线”而凭空制造私讯、偶遇、目击、回忆、物件提示或环境暗示，把玩家拉向某个既有角色。'
  ];

  if (plan.currentAction) {
    lines.push(`本轮最近真实玩家行动：${plan.currentAction}。仅当该行动明确指向某人物时，才可将该人物作为本轮焦点。`);
  }

  if (plan.futureAppointments.length) {
    lines.push(
      `尚未到期的背景约定：${plan.futureAppointments.map(renderAppointment).join('；')}。`,
      '这些约定必须保持连续，但在到期前不是本轮待办，也不是“未回复就必须立刻处理”的问题。除非玩家主动联系、询问、前往，或角色已在同场且有独立的现实因果，否则不得再次让其发送消息、出现、被窥视、触发回忆或以天气/物件暗示催促。'
    );
  }

  if (plan.focusCooldown) {
    lines.push(
      `焦点冷却：${plan.focusCooldown.name} 已在最近 ${plan.focusCooldown.windowSize} 个叙事回合中被提及 ${plan.focusCooldown.mentionCount} 次。`,
      `除非玩家本轮明确点名${plan.focusCooldown.name}，或其约定已到期/正在同场发生，本轮不得让${plan.focusCooldown.name}重新占据叙事焦点；应优先呈现玩家所在地点的独立反馈、已在场角色的自然反应，或把选择权交还玩家。`
    );
  }

  if (plan.continuationStreak >= 2) {
    lines.push(
      `连续推进已达 ${plan.continuationStreak} 次。不得继续围绕同一块告示、同一句传闻、同一物件或未证实线索原地扩写。`,
      '本轮只能选择一个有事实依据的新节拍：当前地点的可见后果、已登记且可达人物的自然互动，或模拟时钟已到期的事件。完成一个节拍后必须停在玩家可回应的局面；不得替玩家做决定，也不得为凑节奏凭空制造人物。'
    );
  }

  if (plan.availableCast.length) {
    lines.push(
      `已登记人物索引：${plan.availableCast.map((item) => `${item.name}${item.role ? `（${item.role}）` : ''}`).join('；')}。`,
      '可在人物、地点和事件之间自然轮换，但不得为了“均衡出场”强行安排陌生人物相遇；未登场人物仍需由角色卡/世界书的触发条件和当前因果决定。'
    );
  }

  return {
    prompt: lines.join('\n'),
    report: plan
  };
}

export function resolveNarrativeEnsemble({ memory, messages, userMessage = '' } = {}) {
  const safeMemory = isRecord(memory) ? memory : {};
  const worldState = isRecord(safeMemory.worldState) ? safeMemory.worldState : {};
  const protagonistName = stringValue(worldState.protagonist?.name);
  const availableCast = collectCast(safeMemory, worldState, protagonistName);
  const currentAction = resolveLatestPlayerAction(messages, userMessage);
  const futureAppointments = collectFutureAppointments(safeMemory, worldState, protagonistName);
  const focusCooldown = resolveFocusCooldown({
    messages,
    cast: availableCast,
    protagonistName,
    currentAction,
    futureAppointments
  });
  const continuationStreak = resolveContinuationStreak(messages, userMessage);

  return {
    availableCast,
    currentAction,
    futureAppointments,
    focusCooldown,
    continuationStreak
  };
}

function resolveContinuationStreak(messages = [], userMessage = '') {
  const history = Array.isArray(messages) ? messages : [];
  let streak = isContinuationSignal(userMessage) ? 1 : 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (message?.role === 'assistant') continue;
    if (message?.role !== 'user') break;
    if (!isContinuationMessage(message)) break;
    streak += 1;
  }
  return streak;
}

function isContinuationMessage(message = {}) {
  if (message?.kind === 'continuation') return true;
  if (message?.hiddenFromChat === true && isContinuationSignal(message?.content)) return true;
  return isContinuationSignal(message?.content);
}

function isContinuationSignal(value) {
  const text = String(value || '').trim();
  return /^(?:继续|继续推进|继续剧情|推进剧情|请继续|（请继续推进剧情）|\(请继续推进剧情\))。?$/u.test(text);
}

function collectCast(memory, worldState, protagonistName) {
  const rootCardName = stringValue(memory.cardRuntime?.source?.characterName, 32);
  const candidates = [
    ...(Array.isArray(memory.characterRegistry?.records) ? memory.characterRegistry.records : []).map((item) => ({
      name: item?.name,
      role: item?.profile?.role,
      priority: item?.kind === 'source-npc' ? 0 : item?.kind === 'discovered-npc' ? 1 : 2,
      source: item?.source?.kind || ''
    })),
    ...(Array.isArray(worldState.characters) ? worldState.characters : []).map((item) => ({
      name: item?.name || item?.character,
      role: item?.role || item?.identity,
      priority: item?.encountered === true ? 1 : 2,
      source: 'world-state'
    })),
    ...(Array.isArray(memory.simulation?.actors) ? memory.simulation.actors : []).map((item) => ({
      name: item?.name,
      role: item?.role,
      priority: 2,
      source: 'simulation-actor'
    }))
  ];
  const seen = new Set();
  return candidates
    .map((item) => ({
      name: stringValue(item.name, 32),
      role: stringValue(item.role, 72),
      priority: Number(item.priority) || 0,
      source: stringValue(item.source, 80)
    }))
    .filter((item) => item.name && item.name !== protagonistName)
    // Scenario-container cards are sometimes mirrored as a synthetic simulation
    // actor. They are a source bundle, not a character who can enter the scene.
    .filter((item) => !(item.name === rootCardName && rootCardName !== protagonistName
      && item.source === 'simulation-actor'))
    .filter((item) => {
      if (seen.has(item.name)) return false;
      seen.add(item.name);
      return true;
    })
    .sort((left, right) => left.priority - right.priority || left.name.localeCompare(right.name, 'zh-CN'))
    .slice(0, 12);
}

function collectFutureAppointments(memory, worldState, protagonistName) {
  const currentWeekday = Number(memory.simulation?.calendar?.weekdayNumber || 0);
  const records = [
    ...(Array.isArray(worldState.obligations) ? worldState.obligations : []),
    ...(Array.isArray(worldState.quests) ? worldState.quests : [])
  ];
  const appointments = [];
  for (const record of records) {
    const text = compactText([
      record?.title,
      record?.name,
      record?.type,
      record?.details,
      record?.status
    ].filter(Boolean).join('；'), 800);
    if (!text || !FUTURE_APPOINTMENT_PATTERN.test(text)) continue;
    const targetWeekday = findWeekday(text);
    const daysUntil = daysUntilWeekday(currentWeekday, targetWeekday);
    if (!isFutureAppointment(text, daysUntil)) continue;
    const person = selectAppointmentPerson(record, protagonistName);
    const label = targetWeekday
      ? `周${weekdayLabel(targetWeekday)}`
      : extractFutureLabel(text);
    appointments.push({
      person,
      label,
      daysUntil,
      summary: compactText(text, 160)
    });
  }
  const nextGuideDate = stringValue(worldState.flags?.nextGuideDate, 240);
  if (nextGuideDate) {
    const targetWeekday = findWeekday(nextGuideDate);
    const daysUntil = daysUntilWeekday(currentWeekday, targetWeekday);
    if (isFutureAppointment(nextGuideDate, daysUntil)) {
      appointments.push({
        person: '',
        label: targetWeekday ? `周${weekdayLabel(targetWeekday)}` : extractFutureLabel(nextGuideDate),
        daysUntil,
        summary: compactText(nextGuideDate, 160)
      });
    }
  }
  const deduped = new Map();
  for (const item of appointments) {
    const key = `${item.person}|${item.label}`;
    const previous = deduped.get(key);
    if (!previous || item.summary.length > previous.summary.length) deduped.set(key, item);
  }
  return [...deduped.values()].slice(0, 4);
}

function resolveFocusCooldown({ messages, cast, protagonistName, currentAction, futureAppointments }) {
  const castNames = cast.map((item) => item.name).filter(Boolean);
  if (!castNames.length) return null;
  const history = (Array.isArray(messages) ? messages : [])
    .filter((message) => String(message?.role || '').toLowerCase() === 'assistant')
    .slice(-8);
  if (history.length < 3) return null;
  const counts = castNames.map((name) => ({
    name,
    count: history.reduce((sum, message) => sum + countOccurrences(message?.content, name), 0)
  }));
  const dominant = counts.sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, 'zh-CN'))[0];
  if (!dominant || dominant.count < 3) return null;
  if (textIncludesName(currentAction, dominant.name)) return null;
  const appointment = futureAppointments.find((item) => item.person === dominant.name);
  if (appointment && Number.isInteger(appointment.daysUntil) && appointment.daysUntil <= 1) return null;
  if (dominant.name === protagonistName) return null;
  return {
    name: dominant.name,
    mentionCount: dominant.count,
    windowSize: history.length
  };
}

function resolveLatestPlayerAction(messages, userMessage) {
  const direct = String(userMessage || '').trim();
  if (direct && !CONTINUATION_ONLY_PATTERN.test(direct)) return compactText(direct, 220);
  const source = Array.isArray(messages) ? messages : [];
  for (let index = source.length - 1; index >= 0; index -= 1) {
    const message = source[index];
    if (String(message?.role || '').toLowerCase() !== 'user' || message?.hiddenFromChat === true) continue;
    const text = String(message?.content || '').trim();
    if (text && !CONTINUATION_ONLY_PATTERN.test(text)) return compactText(text, 220);
  }
  return '';
}

function isFutureAppointment(text, daysUntil) {
  if (Number.isInteger(daysUntil)) return daysUntil >= 2;
  return /下周|下月|改日|届时/u.test(text);
}

function findWeekday(text) {
  const match = String(text || '').match(/(?:周|星期)([一二三四五六日天])/u);
  return match ? WEEKDAY_VALUES[match[1]] || 0 : 0;
}

function daysUntilWeekday(currentWeekday, targetWeekday) {
  if (!currentWeekday || !targetWeekday) return null;
  const delta = (targetWeekday - currentWeekday + 7) % 7;
  return delta === 0 ? 0 : delta;
}

function weekdayLabel(value) {
  return Object.entries(WEEKDAY_VALUES).find(([, number]) => number === value)?.[0] || '';
}

function selectAppointmentPerson(record, protagonistName) {
  const from = stringValue(record?.from, 32);
  const to = stringValue(record?.to, 32);
  if (from && from !== protagonistName) return from;
  if (to && to !== protagonistName) return to;
  return '';
}

function extractFutureLabel(text) {
  const match = String(text || '').match(/(?:下周|下月|明天|后天|改日|届时)/u);
  return match?.[0] || '后续约定';
}

function renderAppointment(item) {
  const person = item.person ? `${item.person}的` : '';
  const horizon = Number.isInteger(item.daysUntil) ? `（约 ${item.daysUntil} 个世界日后）` : '';
  return `${person}${item.label}${horizon}`;
}

function countOccurrences(value, term) {
  const text = String(value || '');
  if (!term) return 0;
  let index = 0;
  let count = 0;
  while ((index = text.indexOf(term, index)) >= 0) {
    count += 1;
    index += term.length;
  }
  return count;
}

function textIncludesName(text, name) {
  return Boolean(name) && String(text || '').includes(name);
}

function stringValue(value, max = 240) {
  if (value === undefined || value === null || typeof value === 'object') return '';
  return compactText(value, max);
}

function compactText(value, max = 240) {
  const text = String(value || '').replace(/\s+/gu, ' ').trim();
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1)).trimEnd()}…` : text;
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
