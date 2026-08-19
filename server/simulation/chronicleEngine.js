import { ACTION_PROTOCOL_SPEC } from './actionProtocol.js';
import { deriveCalendarContext } from './calendarEngine.js';
import { isContinuationSignal } from '../agent/interactionContract.js';

export const DEFAULT_TURN_ADVANCE_MINUTES = 10;

const AUTO_CLOCK_ACTION_ID = 'chronicle-clock';
const AUTO_TIMELINE_ACTION_ID = 'chronicle-timeline';

/**
 * Produce the deterministic, user-visible part of a turn's world evolution.
 * This deliberately runs without an LLM: the model receives the settled clock,
 * schedules and due events, then narrates within that already-auditable state.
 */
export function buildTurnChroniclePlan({ memory, userMessage, generationType = 'normal' } = {}) {
  if (String(generationType || 'normal') === 'continue'
    || userMessage?.kind === 'continuation'
    || isContinuationSignal(userMessage?.content)) return null;
  const simulation = memory?.simulation;
  if (!simulation || simulation.settings?.chronicleEnabled === false) return null;

  const start = normalizeClock(simulation.clock);
  const duration = inferTurnDuration({
    content: userMessage?.content,
    defaultMinutes: resolveDefaultMinutes(simulation.settings?.autoAdvanceMinutes),
    start
  });
  if (!duration) return null;

  const startAbsolute = toAbsoluteMinute(start);
  const endAbsolute = startAbsolute + duration.minutes;
  const end = fromAbsoluteMinute(endAbsolute);
  const calendar = simulation.systems?.calendar;
  const startCalendar = deriveCalendarContext({ clock: start, calendar });
  const endCalendar = deriveCalendarContext({ clock: end, calendar });
  const timelineUpdate = resolveDueTimelineEvents(memory?.worldState?.timeline, {
    startAbsolute,
    endAbsolute,
    triggeredAt: endCalendar.label
  });
  const reference = safeId(userMessage?.id || `${start.day}-${start.minuteOfDay}`);
  const actions = [{
    id: `${AUTO_CLOCK_ACTION_ID}-${reference}`,
    type: 'clock.advance',
    minutes: duration.minutes,
    reason: `本回合${duration.reason}`.slice(0, 300),
    visibility: 'public'
  }];
  if (timelineUpdate.triggered.length) {
    actions.push({
      id: `${AUTO_TIMELINE_ACTION_ID}-${reference}`,
      type: 'state.set',
      path: 'timeline',
      value: timelineUpdate.timeline,
      reason: `到时事件：${timelineUpdate.triggered.map((item) => item.title).join('、')}`.slice(0, 300),
      visibility: 'public'
    });
  }

  return {
    envelope: {
      spec: ACTION_PROTOCOL_SPEC,
      id: `chronicle-${reference}`,
      actorId: 'world-clock',
      summary: `回合时间：${startCalendar.label} → ${endCalendar.label}`,
      baseRevision: safeRevision(simulation.revision),
      actions
    },
    metadata: {
      minutes: duration.minutes,
      reason: duration.reason,
      start: startCalendar.label,
      end: endCalendar.label,
      triggeredEvents: timelineUpdate.triggered.map((item) => item.title)
    }
  };
}

export function combineChronicleActionEnvelope({ chronicleEnvelope, modelEnvelope, acceptedModelActions = [] } = {}) {
  if (!chronicleEnvelope) return modelEnvelope ? structuredClone(modelEnvelope) : null;
  const chronicle = structuredClone(chronicleEnvelope);
  const modelActions = Array.isArray(acceptedModelActions) ? acceptedModelActions : [];
  return {
    spec: ACTION_PROTOCOL_SPEC,
    id: chronicle.id,
    actorId: chronicle.actorId,
    summary: [chronicle.summary, modelEnvelope?.summary].filter(Boolean).join('；').slice(0, 240),
    baseRevision: chronicle.baseRevision,
    actions: [...chronicle.actions, ...structuredClone(modelActions)]
  };
}

export function inferTurnDuration({ content, defaultMinutes = DEFAULT_TURN_ADVANCE_MINUTES, start } = {}) {
  const text = String(content || '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const explicit = explicitDuration(text, start);
  if (explicit) return explicit;
  if (/(?:睡一觉|过夜|直到天亮|次日|明日)/u.test(text)) {
    return { minutes: minutesUntilMorning(start), reason: '度过一夜' };
  }
  if (/(?:等待|等候|休息|小憩|打坐|静坐|停留)/u.test(text)) {
    return { minutes: 60, reason: '等待或休整' };
  }
  if (/(?:赶路|出发|前往|前去|返回|回到|旅行|乘车|骑马|御剑|传送)/u.test(text)) {
    return { minutes: 45, reason: '移动与抵达' };
  }
  if (/(?:调查|查找|搜查|追查|探索|巡查|观察|查看|翻找|研究|打听)/u.test(text)) {
    return { minutes: 30, reason: '调查或探索' };
  }
  if (/(?:交谈|对话|询问|商量|交涉|拜访|安慰|道谢|告别)/u.test(text)) {
    return { minutes: 10, reason: '当面互动' };
  }
  return { minutes: clampMinutes(defaultMinutes), reason: '场景自然流逝' };
}

function explicitDuration(text, start) {
  if (/(?:半小时|半个钟头)/u.test(text)) return { minutes: 30, reason: '用户明确耗时' };
  if (/(?:一刻钟|一刻)/u.test(text)) return { minutes: 15, reason: '用户明确耗时' };
  const minuteMatch = text.match(/(\d{1,4})\s*(?:分钟|分(?![\u4e00-\u9fff]))/u);
  if (minuteMatch) return { minutes: clampMinutes(Number(minuteMatch[1])), reason: '用户明确耗时' };
  const hourMatch = text.match(/(\d{1,2}(?:\.5)?)\s*(?:个)?(?:小时|钟头)/u);
  if (hourMatch) return { minutes: clampMinutes(Number(hourMatch[1]) * 60), reason: '用户明确耗时' };
  const dayMatch = text.match(/(?:等待|等候|休息|赶路|旅行|闭关|修炼|度过|花了?)\s*(\d{1,2})\s*(?:天|日)/u);
  if (dayMatch) return { minutes: clampMinutes(Number(dayMatch[1]) * 1440), reason: '用户明确耗时' };
  if (/(?:直到明早|等到明早)/u.test(text)) return { minutes: minutesUntilMorning(start), reason: '用户明确耗时' };
  return null;
}

function resolveDueTimelineEvents(timeline, { startAbsolute, endAbsolute, triggeredAt }) {
  if (!Array.isArray(timeline)) return { timeline: [], triggered: [] };
  const triggered = [];
  const next = timeline.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
    const dueAt = toDueAbsoluteMinute(entry);
    const status = String(entry.status || '').trim().toLowerCase();
    if (!dueAt || !['', 'active', 'pending', 'scheduled'].includes(status)
      || dueAt <= startAbsolute || dueAt > endAbsolute) return structuredClone(entry);
    const title = String(entry.title || entry.name || entry.event || '计划事件').trim().slice(0, 160);
    triggered.push({ title: title || '计划事件' });
    return {
      ...structuredClone(entry),
      status: 'triggered',
      triggeredAt,
      triggeredAtMinute: dueAt
    };
  });
  return { timeline: next, triggered };
}

function toDueAbsoluteMinute(entry) {
  const absolute = Number(entry.dueAbsoluteMinute);
  if (Number.isSafeInteger(absolute) && absolute >= 0) return absolute;
  const day = Number(entry.dueDay ?? entry.day);
  const dueAt = entry.dueAt && typeof entry.dueAt === 'object'
    ? (entry.dueAt.at || entry.dueAt.time)
    : entry.dueAt;
  const at = parseTime(dueAt || entry.at || entry.time);
  if (!Number.isSafeInteger(day) || day < 1 || at === null) return null;
  return ((day - 1) * 1440) + at;
}

function normalizeClock(clock) {
  const day = Number.isSafeInteger(Number(clock?.day)) ? Math.max(1, Number(clock.day)) : 1;
  const minuteOfDay = Number.isSafeInteger(Number(clock?.minuteOfDay))
    ? Math.max(0, Math.min(1439, Number(clock.minuteOfDay)))
    : 480;
  return { day, minuteOfDay, label: formatClock(day, minuteOfDay) };
}

function fromAbsoluteMinute(value) {
  const absolute = Math.max(0, Number.isSafeInteger(Number(value)) ? Number(value) : 0);
  const day = Math.floor(absolute / 1440) + 1;
  const minuteOfDay = absolute % 1440;
  return { day, minuteOfDay, label: formatClock(day, minuteOfDay) };
}

function toAbsoluteMinute(clock) {
  return ((clock.day - 1) * 1440) + clock.minuteOfDay;
}

function formatClock(day, minuteOfDay) {
  return `第${day}日 ${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(minuteOfDay % 60).padStart(2, '0')}`;
}

function minutesUntilMorning(clock) {
  const morning = 7 * 60;
  const remaining = (1440 - clock.minuteOfDay) + morning;
  return clampMinutes(remaining > 1440 ? remaining - 1440 : remaining || 480);
}

function resolveDefaultMinutes(value) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : DEFAULT_TURN_ADVANCE_MINUTES;
}

function clampMinutes(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_TURN_ADVANCE_MINUTES;
  return Math.max(1, Math.min(1440, Math.trunc(numeric)));
}

function parseTime(value) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return (hour * 60) + minute;
}

function safeRevision(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function safeId(value) {
  const normalized = String(value || '').replace(/[^A-Za-z0-9_.:\-\u4e00-\u9fff]/g, '-').slice(0, 72);
  return normalized || 'turn';
}
