import test from 'node:test';
import assert from 'node:assert/strict';
import { selectGroupSpeaker } from '../server/agent/groupSpeakerSelector.js';

test('group speaker selector honors activation strategy', () => {
  const groupMembers = [
    { name: '韩立', talkativeness: 0.8, enabled: true },
    { name: '南宫婉', talkativeness: 0.2, enabled: true },
    { name: '厉飞雨', talkativeness: 0.5, enabled: true }
  ];

  // 1. list-order 顺序轮转
  const round1 = selectGroupSpeaker({
    groupMembers,
    characterCard: { name: '韩立' },
    messages: [],
    activationStrategy: 'list-order'
  });
  assert.equal(round1.speaker, '韩立');

  const round2 = selectGroupSpeaker({
    groupMembers,
    characterCard: { name: '韩立' },
    messages: [{ role: 'assistant', speaker: '韩立', content: '我先来。' }],
    activationStrategy: 'list-order'
  });
  assert.equal(round2.speaker, '南宫婉');

  const round3 = selectGroupSpeaker({
    groupMembers,
    characterCard: { name: '韩立' },
    messages: [{ role: 'assistant', speaker: '南宫婉', content: '道友请留步。' }],
    activationStrategy: 'list-order'
  });
  assert.equal(round3.speaker, '厉飞雨');

  // 2. manual 仅手动指定
  const manualNone = selectGroupSpeaker({
    groupMembers,
    characterCard: { name: '韩立' },
    messages: [],
    activationStrategy: 'manual'
  });
  assert.equal(manualNone.reason, 'fallback');

  const manualChosen = selectGroupSpeaker({
    groupMembers,
    characterCard: { name: '韩立' },
    targetSpeaker: '厉飞雨',
    messages: [],
    activationStrategy: 'manual'
  });
  assert.equal(manualChosen.speaker, '厉飞雨');
  assert.equal(manualChosen.reason, 'manual');
});
