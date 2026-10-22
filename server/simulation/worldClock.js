import { currentNarrativeClauses } from '../lib/narrativeEvidence.js';
import { deriveCalendarContext } from './calendarEngine.js';

export const DEFAULT_WORLD_CLOCK = Object.freeze({
  day: 1,
  timeOfDay: '清晨',
  season: '春',
  turnCount: 0,
  weather: '晴朗',
  ambientLighting: '晨光熹微'
});

const TIME_OF_DAY_SEQUENCE = ['清晨', '正午', '傍晚', '深夜'];

const LIGHTING_BY_TIME = Object.freeze({
  清晨: '晨光熹微',
  正午: '烈日当头',
  傍晚: '昏黄晚霞',
  深夜: '冷月如霜'
});

export function normalizeWorldClock(clock = {}) {
  const safe = clock && typeof clock === 'object' ? clock : {};
  const timeOfDay = typeof safe.timeOfDay === 'string' && safe.timeOfDay.trim()
    ? safe.timeOfDay.trim()
    : '清晨';
  return {
    day: Math.max(1, Number.isFinite(Number(safe.day)) ? Math.floor(Number(safe.day)) : 1),
    timeOfDay,
    season: typeof safe.season === 'string' && safe.season.trim()
      ? safe.season.trim()
      : '春',
    turnCount: Math.max(0, Number.isFinite(Number(safe.turnCount)) ? Math.floor(Number(safe.turnCount)) : 0),
    weather: typeof safe.weather === 'string' && safe.weather.trim()
      ? safe.weather.trim()
      : '晴朗',
    ambientLighting: typeof safe.ambientLighting === 'string' && safe.ambientLighting.trim()
      ? safe.ambientLighting.trim()
      : (LIGHTING_BY_TIME[timeOfDay] || '天光清亮')
  };
}

export function projectWorldClock(currentClock = {}, simulation) {
  const clock = normalizeWorldClock(currentClock);
  if (!simulation?.clock) return clock;
  const calendar = deriveCalendarContext({ clock: simulation.clock, calendar: simulation.systems?.calendar });
  return {
    ...clock,
    day: simulation.clock.day,
    minuteOfDay: simulation.clock.minuteOfDay,
    label: calendar.label,
    timeOfDay: calendar.period.label,
    season: calendar.season?.label || clock.season,
    ambientLighting: LIGHTING_BY_TIME[calendar.period.label] || '天光清亮'
  };
}

export function advanceWorldClock(currentClock = {}, proseCue = '', { allowAmbientAdvance = true, simulation } = {}) {
  const clock = normalizeWorldClock(currentClock);
  const text = currentNarrativeClauses(proseCue).join('。');

  let newDay = clock.day;
  let newTimeOfDay = clock.timeOfDay;
  const newTurnCount = clock.turnCount + 1;
  let newWeather = clock.weather;

  // 1. 检查文本中是否有显式时间跃迁提示
  if (simulation?.clock) {
    const projected = projectWorldClock(clock, simulation);
    newDay = projected.day;
    newTimeOfDay = projected.timeOfDay;
  } else if (/(?:次日|第二天|翌日|过了一夜|一夜过去)/u.test(text)) {
    newDay += 1;
    newTimeOfDay = '清晨';
  } else if (/(?:三日后|三天后|数日后)/u.test(text)) {
    newDay += 3;
    newTimeOfDay = '正午';
  } else if (/(?:入夜|天色渐暗|夜幕降临|深夜|子时)/u.test(text)) {
    newTimeOfDay = '深夜';
  } else if (/(?:傍晚|黄昏|日落|夕阳)/u.test(text)) {
    newTimeOfDay = '傍晚';
  } else if (/(?:正午|午后|晌午)/u.test(text)) {
    newTimeOfDay = '正午';
  } else if (allowAmbientAdvance && newTurnCount % 2 === 0) {
    // 默认按轮次微步推进时间时段（每 2 轮前进一步）
    const currentIndex = TIME_OF_DAY_SEQUENCE.indexOf(clock.timeOfDay);
    const nextIndex = (currentIndex >= 0 ? currentIndex + 1 : 0) % TIME_OF_DAY_SEQUENCE.length;
    newTimeOfDay = TIME_OF_DAY_SEQUENCE[nextIndex];
    if (nextIndex === 0) {
      newDay += 1;
    }
  }

  // 2. 检查天气动态演进
  if (/(?:暴雨|大雨|狂风骤雨|雷鸣|电闪雷鸣|倾盆大雨)/u.test(text)) {
    newWeather = '暴风雨';
  } else if (/(?:微雨|细雨|小雨|烟雨|蒙蒙细雨|雨势)/u.test(text)) {
    newWeather = '微雨';
  } else if (/(?:浓雾|大雾|迷雾|晨雾|雾气弥漫)/u.test(text)) {
    newWeather = '浓雾';
  } else if (/(?:飞雪|大雪|飘雪|风雪|冰封)/u.test(text)) {
    newWeather = '飞雪';
  } else if (/(?:晴朗|晴空|阳光|万里无云|天朗气清)/u.test(text)) {
    newWeather = '晴朗';
  }

  // 3. 计算光影氛围
  let newLighting = LIGHTING_BY_TIME[newTimeOfDay] || '天光清亮';
  if (newWeather === '暴风雨') {
    newLighting = newTimeOfDay === '深夜' ? '电闪雷鸣的漆黑夜色' : '乌云压顶的阴暗天色';
  } else if (newWeather === '浓雾') {
    newLighting = '白茫茫的晦暗晨光';
  } else if (newWeather === '飞雪' && newTimeOfDay === '深夜') {
    newLighting = '雪色反光的冷冽寒夜';
  }

  return {
    ...(simulation?.clock ? projectWorldClock(clock, simulation) : {}),
    day: newDay,
    timeOfDay: newTimeOfDay,
    season: clock.season,
    turnCount: newTurnCount,
    weather: newWeather,
    ambientLighting: newLighting
  };
}
