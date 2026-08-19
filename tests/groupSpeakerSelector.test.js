import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SPEAKER_ACTIVATION_STRATEGIES,
  normalizeActivationStrategy,
  readTalkativeness,
  selectGroupSpeaker
} from '../server/agent/groupSpeakerSelector.js';

const CARD = { name: '沈孤鸿' };

function members(list) {
  return list.map(([name, talkativeness]) => ({ name, talkativeness, enabled: true }));
}

test('manual target speaker wins across all strategies and validates against roster', () => {
  const group = members([['阿紫', 0.3], ['萧远', 0.7]]);
  for (const activationStrategy of SPEAKER_ACTIVATION_STRATEGIES) {
    const result = selectGroupSpeaker({ groupMembers: group, characterCard: CARD, targetSpeaker: '萧远', activationStrategy });
    assert.deepEqual(result, { speaker: '萧远', reason: 'manual' });
  }

  // 名单外名字（含别名匹配）：不作为 manual 生效，回落策略选择
  const aliased = [
    { name: '柳姑娘', enabled: true, extensions: { aliases: ['柳如烟', '烟儿'] } }
  ];
  assert.deepEqual(
    selectGroupSpeaker({ groupMembers: aliased, characterCard: CARD, targetSpeaker: '柳如烟' }),
    { speaker: '柳如烟', reason: 'manual' }
  );
  assert.equal(
    selectGroupSpeaker({ groupMembers: group, characterCard: CARD, targetSpeaker: '路人甲', rng: () => 0 }).reason,
    'weighted'
  );
  // 主卡名也可手动指定
  assert.deepEqual(
    selectGroupSpeaker({ groupMembers: group, characterCard: CARD, targetSpeaker: '沈孤鸿' }),
    { speaker: '沈孤鸿', reason: 'manual' }
  );
});

test('manual strategy without explicit target defers to the main card', () => {
  const group = members([['阿紫', 0.5], ['萧远', 0.5]]);
  assert.deepEqual(
    selectGroupSpeaker({ groupMembers: group, characterCard: CARD, activationStrategy: 'manual' }),
    { speaker: '沈孤鸿', reason: 'fallback' }
  );
  assert.deepEqual(
    selectGroupSpeaker({ groupMembers: group, characterCard: null, activationStrategy: 'manual' }),
    { speaker: '', reason: 'fallback' }
  );
});

test('empty roster falls back to the character card name', () => {
  assert.deepEqual(
    selectGroupSpeaker({ groupMembers: [], characterCard: CARD }),
    { speaker: '沈孤鸿', reason: 'fallback' }
  );
  // 禁用或无名的成员同样视为无群聊
  assert.deepEqual(
    selectGroupSpeaker({ groupMembers: [{ name: '', enabled: true }, { name: '阿紫', enabled: false }], characterCard: CARD }),
    { speaker: '沈孤鸿', reason: 'fallback' }
  );
  assert.deepEqual(
    selectGroupSpeaker({ groupMembers: null, characterCard: null }),
    { speaker: '', reason: 'fallback' }
  );
});

test('talkativeness weighting follows injected rng deterministically', () => {
  const group = members([['阿紫', 0.1], ['萧远', 0.9]]);
  // roll=0.05 → 落在阿紫的 0.1 区间；roll=0.99 → 落在萧远的区间
  assert.equal(selectGroupSpeaker({ groupMembers: group, characterCard: CARD, rng: () => 0.05 }).speaker, '阿紫');
  assert.equal(selectGroupSpeaker({ groupMembers: group, characterCard: CARD, rng: () => 0.99 }).speaker, '萧远');
  // roll=0 边界：第一个成员
  assert.equal(selectGroupSpeaker({ groupMembers: group, characterCard: CARD, rng: () => 0 }).speaker, '阿紫');
  // 同等权重各半
  const even = members([['甲', 0.5], ['乙', 0.5]]);
  assert.equal(selectGroupSpeaker({ groupMembers: even, characterCard: CARD, rng: () => 0.49 }).speaker, '甲');
  assert.equal(selectGroupSpeaker({ groupMembers: even, characterCard: CARD, rng: () => 0.51 }).speaker, '乙');
});

test('weighted selection excludes the last speaker and falls back when only they remain', () => {
  const group = members([['阿紫', 0.3], ['萧远', 0.7]]);
  const messages = [{ role: 'assistant', speaker: '阿紫' }, { role: 'user', content: '继续' }];

  // 上一位是阿紫：任何 roll 都不会选到阿紫
  for (const roll of [0, 0.3, 0.6, 0.99]) {
    assert.equal(
      selectGroupSpeaker({ groupMembers: group, characterCard: CARD, messages, rng: () => roll }).speaker,
      '萧远'
    );
  }

  // 唯一成员刚发言：回退全量（仍由其发言），reason 变为 round-robin
  const solo = members([['独白者', 0.8]]);
  assert.deepEqual(
    selectGroupSpeaker({ groupMembers: solo, characterCard: CARD, messages: [{ role: 'assistant', speaker: '独白者' }], rng: () => 0.9 }),
    { speaker: '独白者', reason: 'round-robin' }
  );

  // 上一位发言者是名单外/主卡：不剔除任何人
  const strangerLast = [{ role: 'assistant', speaker: '神秘人' }];
  assert.equal(
    selectGroupSpeaker({ groupMembers: group, characterCard: CARD, messages: strangerLast, rng: () => 0 }).speaker,
    '阿紫'
  );
});

test('list-order strategy rotates through the roster in sequence', () => {
  const group = members([['甲', 0.9], ['乙', 0.1], ['丙', 0.5]]);
  // 无历史：从首位开始
  assert.deepEqual(
    selectGroupSpeaker({ groupMembers: group, characterCard: CARD, activationStrategy: 'list-order' }),
    { speaker: '甲', reason: 'round-robin' }
  );
  // 甲之后是乙，乙之后是丙，丙之后回到甲
  const spoke = (name) => [{ role: 'assistant', speaker: name }];
  assert.equal(
    selectGroupSpeaker({ groupMembers: group, characterCard: CARD, messages: spoke('甲'), activationStrategy: 'list-order' }).speaker,
    '乙'
  );
  assert.equal(
    selectGroupSpeaker({ groupMembers: group, characterCard: CARD, messages: spoke('乙'), activationStrategy: 'list-order' }).speaker,
    '丙'
  );
  assert.equal(
    selectGroupSpeaker({ groupMembers: group, characterCard: CARD, messages: spoke('丙'), activationStrategy: 'list-order' }).speaker,
    '甲'
  );
  // 上一位是主卡/名单外：从首位重新开始
  assert.equal(
    selectGroupSpeaker({ groupMembers: group, characterCard: CARD, messages: spoke('沈孤鸿'), activationStrategy: 'list-order' }).speaker,
    '甲'
  );
});

test('invalid activation strategy falls back to talkativeness weighting', () => {
  const group = members([['阿紫', 0.2], ['萧远', 0.8]]);
  const result = selectGroupSpeaker({ groupMembers: group, characterCard: CARD, activationStrategy: '不存在的策略', rng: () => 0.99 });
  assert.equal(result.reason, 'weighted');
  assert.equal(normalizeActivationStrategy('list-order'), 'list-order');
  assert.equal(normalizeActivationStrategy('random-ish'), 'talkativeness');
  assert.deepEqual(SPEAKER_ACTIVATION_STRATEGIES, ['talkativeness', 'list-order', 'manual']);
});

test('readTalkativeness accepts top-level, extensions fallback, and clamps bad values', () => {
  assert.equal(readTalkativeness({ talkativeness: 0.8 }), 0.8);
  assert.equal(readTalkativeness({ extensions: { talkativeness: 0.25 } }), 0.25);
  assert.equal(readTalkativeness({ talkativeness: 0.7, extensions: { talkativeness: 0.2 } }), 0.7);
  // 非法/越界/零值 → 默认 0.5
  assert.equal(readTalkativeness({}), 0.5);
  assert.equal(readTalkativeness({ talkativeness: '废话' }), 0.5);
  assert.equal(readTalkativeness({ talkativeness: 0 }), 0.5);
  assert.equal(readTalkativeness({ talkativeness: -1 }), 0.5);
  assert.equal(readTalkativeness(null), 0.5);
  // >1 截断到 1（权重占比仍最高）
  assert.equal(readTalkativeness({ talkativeness: 5 }), 1);
});

test('zero-weight edge cases never return an empty speaker', () => {
  // 所有成员 talkativeness 非法 → 全部默认 0.5，仍可正常选择
  const weird = [{ name: '甲', enabled: true, talkativeness: 'NaN-ish' }, { name: '乙', enabled: true }];
  const speaker = selectGroupSpeaker({ groupMembers: weird, characterCard: CARD, rng: () => 0.7 }).speaker;
  assert.ok(['甲', '乙'].includes(speaker));

  // rng 返回非法值 → 按 roll=0 处理，选第一个候选
  assert.equal(
    selectGroupSpeaker({ groupMembers: weird, characterCard: CARD, rng: () => 'not-a-number' }).speaker,
    '甲'
  );
});
