import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNarrativeEnsemblePrompt,
  resolveNarrativeEnsemble
} from '../server/agent/narrativeEnsemble.js';

function fixture(overrides = {}) {
  return {
    memory: {
      simulation: { calendar: { weekdayNumber: 1 } },
      characterRegistry: {
        records: [
          { name: '刘一', kind: 'protagonist', profile: { role: '主角' } },
          { name: '周媛', kind: 'discovered-npc', profile: { role: '人力资源总监' } },
          { name: '沈悦', kind: 'source-npc', profile: { role: '大学教师' } }
        ]
      },
      worldState: {
        protagonist: { name: '刘一' },
        characters: [{ name: '周媛', role: '人力资源总监', encountered: true }],
        obligations: [{
          from: '刘一',
          to: '周媛',
          type: '周五到访约定',
          details: '刘一已确认周五下班后到访，周媛在 B2 会合。'
        }],
        flags: { nextGuideDate: '周五（已确认）' }
      }
    },
    messages: [
      { role: 'assistant', content: '周媛发来一条消息。' },
      { role: 'assistant', content: '刘一想起周媛周五的约定。' },
      { role: 'assistant', content: '周媛的消息还亮在屏幕上。' },
      { role: 'assistant', content: '街面上人来人往。' },
      { role: 'user', content: '继续附近逛逛' }
    ],
    userMessage: '',
    ...overrides
  };
}

test('future weekday appointment remains background and starts a repeated-focus cooldown', () => {
  const result = buildNarrativeEnsemblePrompt(fixture());

  assert.match(result.prompt, /周媛的周五（约 4 个世界日后）/);
  assert.match(result.prompt, /不是本轮待办/);
  assert.match(result.prompt, /不得再次让其发送消息、出现、被窥视、触发回忆/);
  assert.match(result.prompt, /焦点冷却：周媛 已在最近 4 个叙事回合中被提及 3 次/);
  assert.match(result.prompt, /沈悦（大学教师）/);
  assert.equal(result.report.focusCooldown.name, '周媛');
});

test('player naming a character lifts that character cooldown without erasing the future appointment', () => {
  const plan = resolveNarrativeEnsemble(fixture({ userMessage: '我给周媛回消息，确认周五的时间。' }));

  assert.equal(plan.focusCooldown, null);
  assert.equal(plan.futureAppointments[0].person, '周媛');
  assert.equal(plan.futureAppointments[0].daysUntil, 4);
});

test('same-day appointment is not treated as a far-future background constraint', () => {
  const plan = resolveNarrativeEnsemble(fixture({
    memory: {
      ...fixture().memory,
      simulation: { calendar: { weekdayNumber: 5 } }
    }
  }));

  assert.equal(plan.futureAppointments.length, 0);
});

test('repeated continuation turns demand one grounded new beat instead of recycling a clue', () => {
  const result = buildNarrativeEnsemblePrompt(fixture({
    messages: [
      { role: 'user', content: '我先在门厅等着。' },
      { role: 'assistant', content: '门厅的钟声响了一次。' },
      { role: 'user', kind: 'continuation', hiddenFromChat: true, content: '（请继续推进剧情）' },
      { role: 'assistant', content: '走廊尽头的灯闪了闪。' },
      { role: 'user', kind: 'continuation', hiddenFromChat: true, content: '（请继续推进剧情）' },
      { role: 'assistant', content: '门厅仍然安静。' }
    ]
  }));

  assert.equal(result.report.continuationStreak, 2);
  assert.match(result.prompt, /连续推进已达 2 次/);
  assert.match(result.prompt, /不得继续围绕同一块告示/);
  assert.match(result.prompt, /完成一个节拍后必须停在玩家可回应的局面/);
});
