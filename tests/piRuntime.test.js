import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentService } from '../server/services/agentService.js';
import { runPiRuntime } from '../server/agent/runtime/piRuntime.js';

const messages = [{ role: 'system', content: '角色原文' }, { role: 'user', content: '你好' }, { role: 'system', content: '后置预设' }];
const tool = { name: 'inspect_scene', description: '查询现场', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } };
const call = { id: 'c1', name: 'inspect_scene', arguments: { name: '地伶' } };
test('real Pi preserves all original messages and transports routing/usage metadata', async () => {
  const events = [];
  const result = await runPiRuntime({ messages, onEvent: e => events.push(e.type), complete: async input => {
    assert.deepEqual(input, messages);
    return { content: '你好。', routing: { selectedProvider: 'test' }, raw: { usage: { total_tokens: 12 } } };
  } });
  assert.equal(result.content, '你好。');
  assert.equal(result.raw.usage.total_tokens, 12);
  assert.equal(result.routing.selectedProvider, 'test');
  assert.ok(events.includes('agent_start') && events.includes('agent_end'));
});
test('real Pi executes tools and preserves OpenAI call/result pairing', async () => {
  let count = 0;
  const before = structuredClone(messages);
  const result = await runPiRuntime({ messages, tools: [tool], executeTool: async input => {
    assert.deepEqual(input, call); return '门已打开';
  }, complete: async input => {
    if (++count === 1) return { content: '', toolCalls: [call] };
    assert.deepEqual(input.slice(0, messages.length), messages);
    assert.equal(input.at(-2).tool_calls[0].id, 'c1');
    assert.deepEqual(input.at(-1), { role: 'tool', tool_call_id: 'c1', content: '门已打开' });
    return { content: '地伶望向门内。' };
  } });
  assert.equal(result.runtime.rounds, 2);
  assert.deepEqual(messages, before);
});
test('Pi forwards the original provider failure and aborts before calling provider', async () => {
  const error = Object.assign(new Error('failure'), { code: 'PROVIDER_TEST_FAILURE' });
  await assert.rejects(runPiRuntime({ messages, complete: async () => { throw error; } }), e => e === error);
  const controller = new AbortController(); controller.abort();
  let called = false;
  await assert.rejects(runPiRuntime({ messages, signal: controller.signal, complete: async () => { called = true; } }));
  assert.equal(called, false);
});
test('Pi limits repeated tools to five provider calls', async () => {
  let count = 0;
  await assert.rejects(runPiRuntime({ messages, tools: [tool], executeTool: async () => 'ok', complete: async () => {
    count++; return { content: '', toolCalls: [call] };
  } }), { code: 'TOOL_ROUND_LIMIT' });
  assert.equal(count, 5);
});
test('Pi schema validation prevents executing invalid tool arguments', async () => {
  let executed = false, rounds = 0;
  await runPiRuntime({ messages, tools: [tool], executeTool: async () => { executed = true; }, complete: async input => {
    if (++rounds === 1) return { content: '', toolCalls: [{ ...call, arguments: {} }] };
    assert.equal(input.at(-1).role, 'tool');
    return { content: '需要补充人物名称。' };
  } });
  assert.equal(executed, false);
});
test('Pi does not execute tool arguments from a truncated streaming response', async () => {
  let executed = false, rounds = 0;
  await runPiRuntime({ messages, tools: [tool], executeTool: async () => { executed = true; }, complete: async () => {
    if (++rounds === 1) return { content: '', toolCalls: [call], raw: { finishReason: 'length' } };
    return { content: '请重新确认参数。', raw: { finishReason: 'stop' } };
  } });
  assert.equal(executed, false);
});
test('AgentService Pi streams tokens immediately using existing transport with no tools', async () => {
  const tokens = [];
  const service = new AgentService({ agentRuntime: 'pi', providerClient: { stream: async ({ messages: input, onToken }) => {
    assert.deepEqual(input, messages);
    await onToken('地伶'); assert.deepEqual(tokens, ['地伶']);
    await onToken('回头。'); return { content: '地伶回头。' };
  } } });
  const result = await service.completeAssistantContentStream({ provider: { id: 'test' }, messages, onToken: t => tokens.push(t) });
  assert.equal(result.runtime.kind, 'pi');
  assert.equal(tokens.join(''), result.content);
});
test('Pi streaming tools preserve visible prefixes and fallback behavior', async () => {
  let rounds = 0, executed = 0;
  const tokens = [];
  const service = new AgentService({ agentRuntime: 'pi', providerClient: { stream: async ({ provider, onToken }) => {
    if (provider.id === 'bad') throw new Error('unavailable');
    if (++rounds === 1) { await onToken('门外。'); return { content: '门外。', toolCalls: [call] }; }
    await onToken('门已打开。'); return { content: '门已打开。' };
  } }, mcpRegistry: { listAllTools: async () => [{ ...tool, toolName: tool.name, serverId: 'scene' }], callTool: async () => { executed++; return '门已打开'; } } });
  const result = await service.completeAssistantContentStream({ provider: { id: 'bad' }, fallbackChain: [{ id: 'good' }], messages, onToken: t => tokens.push(t) });
  assert.equal(executed, 1);
  assert.equal(result.content, tokens.join(''));
  assert.equal(result.content, '门外。门已打开。');
});
test('Pi cancellation after a streamed token prevents tool execution and fallback', async () => {
  const controller = new AbortController();
  let calls = 0, executed = false;
  const service = new AgentService({ agentRuntime: 'pi', providerClient: { stream: async ({ onToken }) => {
    calls++; await onToken('门外。'); return { content: '门外。', toolCalls: [call] };
  } }, mcpRegistry: { listAllTools: async () => [tool], callTool: async () => { executed = true; } } });
  await assert.rejects(service.completeAssistantContentStream({ provider: { id: 'a' }, fallbackChain: [{ id: 'b' }], messages,
    signal: controller.signal, onToken: () => controller.abort() }));
  assert.equal(calls, 1); assert.equal(executed, false);
});
