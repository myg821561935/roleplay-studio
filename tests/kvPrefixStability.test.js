import test from 'node:test';
import assert from 'node:assert/strict';
import { assemblePrompt } from '../server/agent/promptAssembler.js';

test('KV Cache prefix stability: core-system prefix remains 100% byte-identical across turns despite worldState and memory drift', () => {
  const characterCard = {
    name: '沈观澜',
    role: '天剑门执剑长老',
    description: '面容清冷，深藏不露',
    personality: '沉稳寡言，重情重义'
  };

  const persona = {
    name: '李青',
    description: '初入江湖的外门弟子',
    enabled: true
  };

  const coreMemory = {
    personaView: '深知李青重情重义但涉世未深，视其为关门弟子',
    activeCommitments: ['答应李青在找到密档前绝不独自涉险'],
    coreDirectives: ['查明师门惨案真相']
  };

  // Turn 1 的状态与检索
  const memoryTurn1 = {
    worldState: { location: '山门前', timeline: '清晨', tension: '平静' },
    rollingSummary: '两人刚刚抵达山门。',
    knowledgeGraph: { entities: [{ name: '天剑门' }] },
    coreMemory
  };

  const promptTurn1 = assemblePrompt({
    characterCard,
    persona,
    messages: [
      { role: 'user', content: '师尊，前面就是山门了。' }
    ],
    memory: memoryTurn1,
    vectorHits: [{ text: '天剑门位于云峰之巅', similarity: 0.85 }]
  });

  // Turn 2 的状态产生漂移（地点变更、总结更新、检索命中不同、世界状态变动）
  const memoryTurn2 = {
    worldState: { location: '藏经阁废墟', timeline: '正午', tension: '杀机四伏' },
    rollingSummary: '进入山门后发现藏经阁已被洗劫，二人戒备中。',
    knowledgeGraph: { entities: [{ name: '藏经阁' }, { name: '魔教黑衣人' }] },
    coreMemory
  };

  const promptTurn2 = assemblePrompt({
    characterCard,
    persona,
    messages: [
      { role: 'user', content: '师尊，前面就是山门了。' },
      { role: 'assistant', content: '小心为上，此地有血腥味。' },
      { role: 'user', content: '藏经阁的门锁被劈开了！' }
    ],
    memory: memoryTurn2,
    vectorHits: [{ text: '三年前曾有黑衣人夜探藏经阁', similarity: 0.92 }]
  });

  // Zone 1 现在由连续的 core-system 与 character-anchor 两条消息组成；
  // worldState、记忆与检索从第三条 dynamic-context-tail 才开始变化。
  const stablePrefix = (prompt) => prompt.messages
    .slice(0, 2)
    .map((message) => `${message.role}: ${message.content}`)
    .join('\n');
  const prefix1 = stablePrefix(promptTurn1);
  const prefix2 = stablePrefix(promptTurn2);

  assert.equal(promptTurn1.messages[0].role, 'system');
  assert.equal(promptTurn1.messages[1].role, 'system');
  assert.equal(promptTurn2.messages[0].role, 'system');
  assert.equal(promptTurn2.messages[1].role, 'system');

  assert.ok(prefix1.length > 200, 'Zone 1 prefix must contain substantial prompt content');
  assert.equal(prefix1, prefix2, 'Zone 1 immutable prefix must remain 100% identical for KV Cache prefix reuse');

  // 断言 Core Memory 在 Zone 1 稳定前缀中成功常驻渲染
  assert.match(prefix1, /# 角色核心认知与羁绊 \(Core Memory\)/);
  assert.match(prefix1, /深知李青重情重义但涉世未深/);
  assert.match(prefix1, /答应李青在找到密档前绝不独自涉险/);

  // 断言动态变化的世界状态与记忆在后部正确渲染
  const fullPrompt1Text = promptTurn1.messages.map((m) => m.content).join('\n');
  const fullPrompt2Text = promptTurn2.messages.map((m) => m.content).join('\n');

  assert.match(fullPrompt1Text, /山门前/);
  assert.match(fullPrompt2Text, /藏经阁废墟/);
});
