import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceWorldClock, normalizeWorldClock } from '../server/simulation/worldClock.js';
import { tickOffscreenSimulation } from '../server/simulation/offscreenSimulation.js';

test('worldClock advances step-by-step and recognizes prose cues', () => {
  const clock = normalizeWorldClock();
  assert.equal(clock.day, 1);
  assert.equal(clock.timeOfDay, '清晨');

  // 1. 常规单轮推进（两轮变一个时段）
  const clockTurn1 = advanceWorldClock(clock, '平常的一句话。');
  assert.equal(clockTurn1.turnCount, 1);
  assert.equal(clockTurn1.timeOfDay, '清晨');

  const clockTurn2 = advanceWorldClock(clockTurn1, '又过了一会儿。');
  assert.equal(clockTurn2.turnCount, 2);
  assert.equal(clockTurn2.timeOfDay, '正午');

  // 2. 文本中出现显式时间提示（如“次日”）
  const clockNextDay = advanceWorldClock(clockTurn2, '两人各自回房歇息，待到次日清晨，天光大亮。');
  assert.equal(clockNextDay.day, 2);
  assert.equal(clockNextDay.timeOfDay, '清晨');

  // 3. 文本中出现“入夜”
  const clockNight = advanceWorldClock(clockNextDay, '不知不觉间，天色渐暗，夜幕降临。');
  assert.equal(clockNight.timeOfDay, '深夜');
});

test('offscreenSimulation generates autonomous updates for off-screen NPCs', () => {
  const worldState = {
    location: '古庙大殿',
    clock: { day: 1, timeOfDay: '清晨', turnCount: 0 },
    offscreenEvents: []
  };

  const groupMembers = [
    { name: '燕十三', location: '古庙大殿', personality: '冷傲剑客' },
    { name: '慕容秋荻', location: '翠云峰山庄', directives: ['密谋调遣天尊杀手'] },
    { name: '谢晓峰', location: '神剑山庄后山', directives: ['隐姓埋名反思剑道'] }
  ];

  const result = tickOffscreenSimulation({
    worldState,
    groupMembers,
    activeActor: '燕十三',
    currentLocation: '古庙大殿',
    narrativeText: '燕十三拔剑出鞘，剑气凌厉。'
  });

  assert.ok(result.clock, 'Clock must be updated');
  assert.equal(result.offscreenEvents.length, 2, 'Should generate updates for 2 offscreen members');

  const murongEvent = result.offscreenEvents.find((e) => e.actor === '慕容秋荻');
  assert.ok(murongEvent, 'Must record event for 慕容秋荻');
  assert.equal(murongEvent.location, '翠云峰山庄');
  assert.ok(murongEvent.summary.includes('密谋调遣天尊杀手'));

  const xieEvent = result.offscreenEvents.find((e) => e.actor === '谢晓峰');
  assert.ok(xieEvent, 'Must record event for 谢晓峰');
  assert.equal(xieEvent.location, '神剑山庄后山');
});

test('offscreenSimulation does not invent off-screen events without a visible clock advance', () => {
  const result = tickOffscreenSimulation({
    worldState: { location: { name: '古庙大殿' }, clock: { day: 1, timeOfDay: '清晨', turnCount: 1 } },
    groupMembers: [{ name: '慕容秋荻', location: { name: '翠云峰山庄' }, directives: ['密谋调遣天尊杀手'] }],
    currentLocation: { name: '古庙大殿' },
    narrativeText: '她垂眸不语。',
    allowAmbientAdvance: false,
    allowOffscreenEvents: false
  });

  assert.equal(result.clock.timeOfDay, '清晨');
  assert.equal(result.offscreenEvents.length, 0);
});
