const DEFAULT_WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const DEFAULT_PERIODS = [
  { id: 'dawn', label: '清晨', start: 5 * 60, end: (9 * 60) - 1 },
  { id: 'morning', label: '上午', start: 9 * 60, end: (11 * 60) - 1 },
  { id: 'noon', label: '午时', start: 11 * 60, end: (13 * 60) - 1 },
  { id: 'afternoon', label: '午后', start: 13 * 60, end: (18 * 60) - 1 },
  { id: 'evening', label: '傍晚', start: 18 * 60, end: (22 * 60) - 1 },
  { id: 'night', label: '夜晚', start: 22 * 60, end: (24 * 60) - 1 },
  { id: 'late-night', label: '深夜', start: 0, end: (5 * 60) - 1 }
];

export function normalizeCalendarProfile(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const week = source.week && typeof source.week === 'object' ? source.week : {};
  const hasProfile = Array.isArray(source.weekdays)
    || Array.isArray(week.labels)
    || Array.isArray(source.weekendDays)
    || Array.isArray(source.dayPeriods)
    || Array.isArray(source.periods)
    || Array.isArray(source.seasons)
    || Array.isArray(source.solarTerms)
    || Number.isFinite(Number(source.yearLength));
  if (!hasProfile) return null;

  const weekdays = normalizeWeekdays(source.weekdays || week.labels);
  return {
    weekdays,
    weekendDays: normalizeWeekendDays(source.weekendDays || week.weekendDays || week.weekend),
    periods: normalizePeriods(source.dayPeriods || source.periods),
    yearLength: clampInteger(source.yearLength, 1, 10_000, 365),
    seasons: normalizeCycleEntries(source.seasons, 'season', 12),
    solarTerms: normalizeCycleEntries(source.solarTerms, 'term', 48)
  };
}

export function deriveCalendarContext({ clock, calendar } = {}) {
  const safeClock = normalizeClock(clock);
  const profile = normalizeCalendarProfile(calendar?.profile || calendar);
  const weekdays = profile?.weekdays || DEFAULT_WEEKDAYS;
  const weekdayIndex = (safeClock.day - 1) % weekdays.length;
  const weekendDays = profile?.weekendDays || [6, 7];
  const weekdayNumber = weekdayIndex + 1;
  const isWeekend = weekendDays.includes(weekdayNumber);
  const period = resolvePeriod(safeClock.minuteOfDay, profile?.periods || DEFAULT_PERIODS);
  const yearLength = profile?.yearLength || 365;
  const dayOfYear = ((safeClock.day - 1) % yearLength) + 1;
  const season = resolveCycleEntry(profile?.seasons || [], dayOfYear, yearLength);
  const solarTerm = resolveCycleEntry(profile?.solarTerms || [], dayOfYear, yearLength);
  const dayKind = isWeekend ? '休息日' : '工作日';
  const parts = [safeClock.label, weekdays[weekdayIndex], dayKind, period.label];
  if (season?.label) parts.push(season.label);
  if (solarTerm?.label) parts.push(solarTerm.label);
  if (calendar?.dayLabel) parts.push(String(calendar.dayLabel).slice(0, 80));
  return {
    spec: 'lra.calendar-context/v1',
    label: parts.join(' · '),
    weekday: weekdays[weekdayIndex],
    weekdayNumber,
    dayKind,
    isWeekend,
    period,
    dayOfYear,
    season,
    solarTerm
  };
}

export function hasCalendarTransition(before, after) {
  if (!before || !after) return false;
  return before.weekday !== after.weekday
    || before.dayKind !== after.dayKind
    || before.period?.id !== after.period?.id
    || before.season?.id !== after.season?.id
    || before.solarTerm?.id !== after.solarTerm?.id;
}

export function formatCalendarTransition(before, after) {
  if (!before || !after) return '';
  const changed = [
    before.weekday !== after.weekday ? after.weekday : '',
    before.dayKind !== after.dayKind ? after.dayKind : '',
    before.period?.id !== after.period?.id ? after.period?.label : '',
    before.season?.id !== after.season?.id ? after.season?.label : '',
    before.solarTerm?.id !== after.solarTerm?.id ? after.solarTerm?.label : ''
  ].filter(Boolean);
  return changed.length ? `时序进入${changed.join(' · ')}` : '';
}

function normalizeWeekdays(input) {
  const labels = (Array.isArray(input) ? input : [])
    .map((item) => String(item || '').trim().slice(0, 40))
    .filter(Boolean)
    .slice(0, 14);
  return labels.length >= 2 ? labels : DEFAULT_WEEKDAYS;
}

function normalizeWeekendDays(input) {
  const days = (Array.isArray(input) ? input : [])
    .map(Number)
    .filter((item) => Number.isInteger(item) && item >= 1 && item <= 14);
  return [...new Set(days.length ? days : [6, 7])];
}

function normalizePeriods(input) {
  const periods = (Array.isArray(input) ? input : []).slice(0, 24).map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const start = parseTime(entry.start ?? entry.from ?? entry.at);
    const end = parseTime(entry.end ?? entry.to);
    const label = String(entry.label || entry.name || entry.id || '').trim().slice(0, 80);
    if (start === null || end === null || !label) return null;
    return { id: safeId(entry.id || `period-${index + 1}`), label, start, end };
  }).filter(Boolean);
  return periods.length ? periods : DEFAULT_PERIODS;
}

function normalizeCycleEntries(input, prefix, limit) {
  return (Array.isArray(input) ? input : []).slice(0, limit).map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const startDay = clampInteger(entry.startDay ?? entry.day, 1, 10_000, 0);
    const label = String(entry.label || entry.name || entry.id || '').trim().slice(0, 80);
    if (!startDay || !label) return null;
    return { id: safeId(entry.id || `${prefix}-${index + 1}`), label, startDay };
  }).filter(Boolean).sort((left, right) => left.startDay - right.startDay);
}

function resolvePeriod(minuteOfDay, periods) {
  const match = periods.find((period) => isMinuteInPeriod(minuteOfDay, period));
  return match || { id: 'unspecified', label: '当下', start: 0, end: 1439 };
}

function isMinuteInPeriod(minuteOfDay, period) {
  if (period.start <= period.end) return minuteOfDay >= period.start && minuteOfDay <= period.end;
  return minuteOfDay >= period.start || minuteOfDay <= period.end;
}

function resolveCycleEntry(entries, dayOfYear, yearLength) {
  if (!entries.length) return null;
  const valid = entries.filter((entry) => entry.startDay <= yearLength);
  if (!valid.length) return null;
  return valid.filter((entry) => entry.startDay <= dayOfYear).at(-1) || valid.at(-1);
}

function normalizeClock(clock) {
  const day = clampInteger(clock?.day, 1, 999_999, 1);
  const minuteOfDay = clampInteger(clock?.minuteOfDay ?? clock?.minute, 0, 1439, 480);
  return {
    day,
    minuteOfDay,
    label: `第${day}日 ${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(minuteOfDay % 60).padStart(2, '0')}`
  };
}

function parseTime(value) {
  if (Number.isInteger(value) && value >= 0 && value <= 1439) return value;
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return (hour * 60) + minute;
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

function safeId(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_.:\-\u4e00-\u9fff]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100) || 'calendar';
}
