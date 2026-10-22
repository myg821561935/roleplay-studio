import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceWorldClock, normalizeWorldClock } from '../server/simulation/worldClock.js';

test('worldClock tracks weather and ambientLighting dynamically', () => {
  const clock = normalizeWorldClock();
  assert.equal(clock.weather, '晴朗');
  assert.equal(clock.ambientLighting, '晨光熹微');

  // 1. 剧情触发暴风雨
  const stormClock = advanceWorldClock(clock, '刹那间电闪雷鸣，倾盆大雨倾泻而下。');
  assert.equal(stormClock.weather, '暴风雨');
  assert.ok(stormClock.ambientLighting.includes('阴暗') || stormClock.ambientLighting.includes('乌云'));

  // 2. 剧情进入深夜与飞雪
  const snowNightClock = advanceWorldClock(stormClock, '夜幕降临，窗外飞雪连天，天地一片银白。');
  assert.equal(snowNightClock.timeOfDay, '深夜');
  assert.equal(snowNightClock.weather, '飞雪');
  assert.ok(snowNightClock.ambientLighting.includes('寒夜') || snowNightClock.ambientLighting.includes('冷冽'));

  // 3. 次日放晴
  const sunnyClock = advanceWorldClock(snowNightClock, '次日天朗气清，万里无云。');
  assert.equal(sunnyClock.day, 2);
  assert.equal(sunnyClock.timeOfDay, '清晨');
  assert.equal(sunnyClock.weather, '晴朗');
  assert.equal(sunnyClock.ambientLighting, '晨光熹微');
});
