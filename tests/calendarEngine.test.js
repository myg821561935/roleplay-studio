import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveCalendarContext, formatCalendarTransition, hasCalendarTransition } from '../server/simulation/calendarEngine.js';
import { advanceSimulationClock, createSimulationState, renderSimulationPrompt } from '../server/simulation/npcSimulation.js';
import { compileStructuredWorldSystems } from '../server/resources/playableResourceCompiler.js';

const CALENDAR = {
  name: '玄历',
  era: '承平',
  profile: {
    weekdays: ['月曜', '火曜', '水曜', '木曜', '金曜', '土曜', '日曜'],
    weekendDays: [6, 7],
    dayPeriods: [
      { id: '昼', label: '昼时', start: '06:00', end: '17:59' },
      { id: '夜', label: '子夜', start: '18:00', end: '05:59' }
    ],
    yearLength: 12,
    seasons: [
      { id: 'spring', label: '春', startDay: 1 },
      { id: 'summer', label: '夏', startDay: 4 },
      { id: 'autumn', label: '秋', startDay: 7 },
      { id: 'winter', label: '冬', startDay: 10 }
    ],
    solarTerms: [
      { id: 'awakening', label: '惊蛰', startDay: 3 },
      { id: 'equinox', label: '春分', startDay: 4 }
    ]
  }
};

test('default calendar labels the noon story beat and clock consistently', () => {
  const context = deriveCalendarContext({ clock: { day: 1, minuteOfDay: 12 * 60 } });

  assert.equal(context.period.id, 'noon');
  assert.equal(context.period.label, '午时');
  assert.match(context.label, /第1日 12:00.+午时/);
});

test('calendar adapter derives a story-owned weekday, day period, season and solar term', () => {
  const context = deriveCalendarContext({
    clock: { day: 6, minuteOfDay: (19 * 60) + 20 },
    calendar: CALENDAR
  });

  assert.equal(context.weekday, '土曜');
  assert.equal(context.dayKind, '休息日');
  assert.equal(context.period.label, '子夜');
  assert.equal(context.season.label, '夏');
  assert.equal(context.solarTerm.label, '春分');
  assert.match(context.label, /土曜 · 休息日 · 子夜 · 夏 · 春分/);
});

test('calendar adapter exposes a public transition when time crosses a declared period', () => {
  const simulation = createSimulationState({
    clock: { day: 1, minuteOfDay: (17 * 60) + 55 },
    systems: { calendar: CALENDAR }
  });
  const advanced = advanceSimulationClock(simulation, { minutes: 10, reason: '调查结束' });

  assert.equal(advanced.simulation.calendar.period.label, '子夜');
  const transition = advanced.effects.find((effect) => effect.type === 'calendar.transition');
  assert.equal(transition.visibility, 'public');
  assert.match(transition.reason, /时序进入子夜/);
  assert.equal(hasCalendarTransition(transition.before, transition.after), true);
  assert.equal(formatCalendarTransition(transition.before, transition.after), '时序进入子夜');
});

test('calendar context is injected into the structured world prompt without a genre hard-code', () => {
  const simulation = createSimulationState({
    clock: { day: 6, minuteOfDay: (19 * 60) + 20 },
    systems: { calendar: CALENDAR }
  });
  const prompt = renderSimulationPrompt({ simulation });

  assert.match(prompt, /第6日 19:20 · 土曜 · 休息日 · 子夜 · 夏 · 春分/);
});

test('world book authors can opt into a safe declarative calendar profile', () => {
  const systems = compileStructuredWorldSystems([{
    id: 'calendar-profile',
    title: '玄历与时辰',
    enabled: true,
    content: '世界以玄历记日，子夜之后阴气渐盛。',
    extensions: { local_roleplay_agent: { calendarProfile: CALENDAR.profile } }
  }]);
  const context = deriveCalendarContext({
    clock: { day: 6, minuteOfDay: (19 * 60) + 20 },
    calendar: systems.calendar
  });

  assert.equal(systems.calendar.profile.weekdays[5], '土曜');
  assert.equal(context.period.label, '子夜');
});
