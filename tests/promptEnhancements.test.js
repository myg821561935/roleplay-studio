import test from 'node:test';
import assert from 'node:assert/strict';
import { assemblePrompt } from '../server/agent/promptAssembler.js';
import { AgentService } from '../server/services/agentService.js';
import { buildPromptComparison } from '../server/agent/promptComparison.js';
const base = { characterCard: { name: '甲', sourceSpec: 'chara_card_v3', description: '向{{user}}问好' }, promptModules: [], worldBook: [], messages: [], userMessage: '等候', memory: { rollingSummary: '长期摘要唯一标记', memoryCards: [] }, options: { maxPromptTokens: 32000 } };
const text = a => a.messages.map(m => m.content).join('\n');
test('preview records actual expansion once and is absent from normal diagnostics', () => {
  const input = { ...base, promptModules: [{ id: 'counter', enabled: true, content: '{{incvar::n}}{{getvar::n}}' }] };
  const regular = assemblePrompt(input);
  const inspected = assemblePrompt({ ...input, options: { ...base.options, inspectPromptChanges: true } });
  assert.deepEqual(inspected.messages, regular.messages);
  assert.deepEqual(regular.sections.promptStudio.changes, []);
  const row = inspected.sections.promptStudio.changes.find(r => r.source === '预设：counter');
  assert.equal(row.after, '1');
  assert.equal(row.changed, true);
});
test('memory recall is independently disabled without deleting source memory or history', () => {
  const memory = structuredClone(base.memory);
  const enabled = assemblePrompt(base);
  const disabled = assemblePrompt({ ...base, options: { ...base.options, agentEnhancements: { memoryRecall: false } } });
  assert.match(text(enabled), /长期摘要唯一标记/);
  assert.doesNotMatch(text(disabled), /长期摘要唯一标记/);
  assert.match(text(disabled), /等候/);
  assert.deepEqual(base.memory, memory);
});
test('faithful mode can enable action suggestions without enabling plot guidance', () => {
  const a = assemblePrompt({ ...base, options: { ...base.options, agentEnhancements: { actionSuggestions: true, plotGuidance: false } } });
  assert.match(text(a), /推荐选项输出规则/);
  assert.doesNotMatch(text(a), /隐藏回合帧/);
});
test('enhanced mode can disable both suggestions and plot guidance', () => {
  const a = assemblePrompt({ ...base, options: { ...base.options, promptExecutionMode: 'enhanced', agentEnhancements: { actionSuggestions: false, plotGuidance: false } } });
  assert.doesNotMatch(text(a), /推荐选项输出规则|隐藏回合帧/);
});
test('disabled memory avoids both retrieval and model maintenance work', async () => {
  const session = { settings: { agentEnhancements: { memoryRecall: false } } };
  const fail = () => { throw new Error('should not call'); };
  const ctx = { memoryService: { retrieveContext: fail }, configService: { getAll: fail } };
  assert.equal((await AgentService.prototype.maybeRetrieveVectorMemory.call(ctx, { session })).vectorEnabled, false);
  assert.equal(await AgentService.prototype.runMemoryMaintenanceIfNeeded.call(ctx, { session }), false);
});
test('comparison excludes provider secrets and preserves a blocked arm', () => {
  const result = buildPromptComparison({ session: { settings: {}, messages: [] }, providers: { activeProviderId: 'x', providers: [{ id: 'x', model: 'model', apiKey: 'SECRET' }] }, content: 'same', generationType: 'normal', assemble: options => {
    if (options.promptExecutionMode === 'faithful') throw Object.assign(new Error('budget'), { code: 'PROMPT_BUDGET_INSUFFICIENT' });
    return { messages: [{ role: 'user', content: 'same' }], tokenEstimate: 2 };
  } });
  assert.doesNotMatch(JSON.stringify(result), /SECRET|apiKey/);
  assert.equal(result.variants[0].status, 'blocked');
  assert.equal(result.variants[1].status, 'ready');
});
