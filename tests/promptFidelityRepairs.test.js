import test from 'node:test';
import assert from 'node:assert/strict';
import { expandMacros } from '../server/agent/macroEngine.js';
import { compactFaithfulMemory } from '../server/agent/faithfulPrompt.js';
import { adaptPacingToCard } from '../server/agent/pacingCompatibility.js';
import { assemblePrompt } from '../server/agent/promptAssembler.js';

test('message-state macro preserves nested values, false and zero without global state leakage', () => {
  const context = { lightFrontendState: { values: { chat: { stat_data: { trust: 0, seen: false } }, global: { stat_data: { secret: true } } } } };
  assert.deepEqual(JSON.parse(expandMacros('{{format_message_variable::stat_data}}', context)), { trust: 0, seen: false });
  assert.equal(expandMacros('{{format_message_variable::missing}}', context), 'null');
});
test('faithful memory never slices serialized state into invalid JSON', () => {
  const state = { name: '角色', events: Array.from({ length: 100 }, (_, n) => ({ n, description: '事件' })) };
  const text = compactFaithfulMemory(['# 结构化世界状态\n' + JSON.stringify(state)]);
  assert.deepEqual(JSON.parse(text.split('\n').slice(1).join('\n')), state);
});
test('slow-card adaptation is narrow and does not alter other styles or imported modules', () => {
  const rule = '在回复的结尾处，呈现一个未完成的动作、一个突发的状况或一个需要玩家做出反应的紧迫抉择，以此保持故事的张力。';
  assert.equal(adaptPacingToCard(rule, { systemPrompt: '快速推进' }), rule);
  assert.match(adaptPacingToCard(rule, { systemPrompt: '节奏缓慢' }), /不强制/);
  const module = { id: 'p', enabled: true, content: rule };
  const source = { characterCard: { name: '人物', sourceSpec: 'chara_card_v3', systemPrompt: '节奏缓慢' }, promptModules: [module], worldBook: [], memory: {}, messages: [], userMessage: '观察', options: { maxPromptTokens: 16000 } };
  const result = assemblePrompt(source);
  assert.match(result.messages.map(m => m.content).join('\n'), /不强制在每轮结尾/);
  assert.equal(module.content, rule);
  const unchanged = assemblePrompt({ ...source, options: { ...source.options, resolvePacingConflicts: false } });
  assert.ok(unchanged.messages.some(m => m.content.includes(rule)));
});
test('each new turn can activate the speaker profile from story history', () => {
  const source = { characterCard: { name: '场景', sourceSpec: 'chara_card_v3' }, promptModules: [], worldBook: [{ id: 'npc', title: '阿青', keywords: ['阿青'], content: '阿青持白骨折扇', constant: false, enabled: true }], memory: {}, messages: [], userMessage: '开始', options: { maxPromptTokens: 16000 } };
  assert.ok(!assemblePrompt(source).messages.some(m => m.content.includes('白骨折扇')));
  const later = assemblePrompt({ ...source, messages: [{ role: 'user', content: '开始' }, { role: 'assistant', content: '阿青走来。' }], userMessage: '询问她' });
  assert.ok(later.messages.some(m => m.content.includes('白骨折扇')));
});
