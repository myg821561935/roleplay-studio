import test from 'node:test';
import assert from 'node:assert/strict';
import { assemblePrompt } from '../server/agent/promptAssembler.js';
import { enforceFaithfulPromptBudget, renderFaithfulCharacter } from '../server/agent/faithfulPrompt.js';
const base = { characterCard: { name: '原卡角色', sourceSpec: 'chara_card_v3' }, promptModules: [], worldBook: [], memory: { memoryCards: [] }, messages: [], userMessage: '当下行动', options: { maxPromptTokens: 16000 } };
const text = a => a.messages.map(m => m.content).join('\n');
test('imported preset expands the full variable chain beyond 18 modules', () => {
  const modules = Array.from({ length: 25 }, (_, i) => ({ id: `m${i}`, enabled: true, content: i === 24 ? '{{getvar::voice}}最终规则' : `{{setvar::voice::语气${i}}}`, extensions: { sillyTavernPreset: { presetTitle: '完整链', sequence: i } } }));
  const a = assemblePrompt({ ...base, promptModules: modules });
  assert.equal(a.sections.executionMode, 'faithful');
  assert.match(text(a), /语气23最终规则/);
  assert.equal(a.sections.communityPresetIntegrity.preflightSuppressed.length, 0);
  assert.doesNotMatch(text(a), /必须在回复正文之后给出 3 个行动建议|网文质感|900-1400/);
});
test('long original fields retain their tails or fail before sending instead of truncating', () => {
  const card = { ...base.characterCard, description: '原文'.repeat(1200), systemPrompt: '系统尾部规则', exampleDialog: ['示例'.repeat(700) + '示例尾部规则'] };
  const a = assemblePrompt({ ...base, characterCard: card });
  assert.match(text(a), /系统尾部规则/);
  assert.match(text(a), /示例尾部规则/);
  assert.throws(() => assemblePrompt({ ...base, characterCard: card, options: { maxPromptTokens: 1000 } }), e => e.code === 'PROMPT_BUDGET_INSUFFICIENT' && e.requiredTokens > 1000);
  assert.ok(a.messages.every(m => !Object.keys(m).some(k => k.startsWith('_'))));
});
test('atomic budget evicts old history while preserving recent actions and original instructions', () => {
  const a = enforceFaithfulPromptBudget([
    { role: 'system', content: '原设定', _promptKind: 'character-anchor' },
    { role: 'user', content: '旧'.repeat(1000), _promptKind: 'history', _promptTurnId: 'old' },
    { role: 'assistant', content: '旧回应', _promptKind: 'history', _promptTurnId: 'old' },
    { role: 'user', content: '最近行动', _promptKind: 'history-recent' },
    { role: 'assistant', content: '最近结果', _promptKind: 'history-recent' }
  ], { maxTokens: 100 });
  assert.equal(a.messages.length, 3);
  assert.match(text(a), /最近行动/);
  assert.match(text(a), /最近结果/);
});
for (const promptExecutionMode of ['faithful', 'enhanced']) test(`${promptExecutionMode} current and historical player actions survive an empty regex replacement`, () => {
  const a = assemblePrompt({ ...base, options: { ...base.options, promptExecutionMode }, messages: [{ id: 'u', role: 'user', content: '先前行动' }, { role: 'assistant', content: '先前结果' }], lightFrontend: { regexTransforms: [{ enabled: true, pattern: '[\\s\\S]+', replacement: '', placement: 1, promptOnly: true }] } });
  assert.match(text(a), /先前行动/);
  assert.match(text(a), /当下行动/);
  assert.equal(a.sections.regexAudit.length, 2);
});
test('depth zero worldbook injections keep role and follow current user', () => {
  const a = assemblePrompt({ ...base, worldBook: [{ id: 'depth', title: '尾部注入', content: '真正的尾部规则', enabled: true, constant: true, position: 4, depth: 0, role: 2 }] });
  assert.equal(a.messages.at(-1).role, 'assistant');
  assert.match(a.messages.at(-1).content, /真正的尾部规则/);
  assert.ok(a.messages.findIndex(m => m.content === '当下行动') < a.messages.length - 1);
});
test('scenario containers exclude machine-generated personality and preserve authored examples', () => {
  const result = renderFaithfulCharacter({ name: '场景', personality: '自动性格', scenario: '自动开局', exampleDialog: ['作者示例'], extensions: { local_roleplay_agent: { enrichment: { generatedFields: ['personality', 'scenario'] } } } }, { contentMode: { kind: 'scenario-container' } });
  assert.doesNotMatch(result, /自动性格|自动开局/);
  assert.match(result, /作者示例/);
  assert.match(result, /NPC 的性格分别/);
});
test('faithful worldbook retains all activated entries without the legacy 6000 cap', () => {
  const entries = [{ id: 'before', title: '前置', content: '前置规则', position: 'before_char', constant: true }, { id: 'large', title: '完整规则', content: '规'.repeat(6500) + '结尾约束', constant: true }];
  const a = assemblePrompt({ ...base, worldBook: entries });
  assert.match(text(a), /前置规则/);
  assert.match(text(a), /结尾约束/);
  assert.equal(a.sections.worldBookBudget.constant.omittedCount, 0);
  assert.equal(a.sections.worldBookBudget.constant.truncatedCount, 0);
});
test('example-relative worldbook entries surround original example block', () => {
  const a = assemblePrompt({ ...base, characterCard: { ...base.characterCard, exampleDialog: ['原卡对白样例'] }, worldBook: [
    { id: 'before', title: '样例前', content: '样例之前', position: 'before_eff', constant: true },
    { id: 'after', title: '样例后', content: '样例之后', position: 'after_eff', constant: true }
  ] });
  const contents = a.messages.map(m => m.content);
  const index = marker => contents.findIndex(c => c.includes(marker));
  assert.ok(index('样例之前') < index('原卡对白样例'));
  assert.ok(index('原卡对白样例') < index('样例之后'));
});
test('a source note or comment cannot suppress an otherwise valid variable preset', () => {
  const ext = { sillyTavernPreset: { presetTitle: '说明模块回归' } };
  const a = assemblePrompt({ ...base, promptModules: [
    { id: 'note', enabled: true, content: '本占位不参与运行', extensions: ext },
    { id: 'comment', enabled: true, content: '{{// 作者注释}}', extensions: ext },
    { id: 'init', enabled: true, content: '{{setvar::voice::克制}}', extensions: ext },
    { id: 'output', enabled: true, content: '{{getvar::voice}}地回答。', extensions: ext }
  ] });
  assert.match(text(a), /克制地回答/);
  assert.equal(a.sections.communityPresetIntegrity.preflightSuppressed.length, 0);
  assert.equal(a.sections.communityPresetIntegrity.finalSuppressed.length, 0);
  assert.ok(a.sections.retainedPromptModuleIds.includes('output'));
});
test('final integrity reads inspection metadata after private API fields are stripped', () => {
  const a = assemblePrompt({ ...base, promptModules: [{ id: 'literal', enabled: true, content: '未支持模板：{{压缩相邻消息::保留}}', extensions: { sillyTavernPreset: { presetTitle: '未展开宏' } } }] });
  assert.ok(a.messages.some(m=>m.content.includes('未支持模板')));
  assert.ok(a.sections.retainedPromptModuleIds.includes('literal'));
  assert.deepEqual(a.sections.omittedPromptModuleIds, []);
  assert.equal(a.sections.communityPresetIntegrity.finalSuppressed.length, 0);
});
