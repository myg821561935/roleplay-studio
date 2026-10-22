import test from 'node:test';
import assert from 'node:assert/strict';
import { streamOpenAICompatible } from '../server/provider/openaiCompatible.js';
const provider = { baseUrl: 'https://example.test/v1', apiKey: 'test', model: 'test' };
test('streamed fragmented tool names and arguments assemble across CRLF byte boundaries', async () => {
  const frames = [
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'inspect', arguments: '{"x":' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: '_scene', arguments: '"雪"}' } }] }, finish_reason: 'tool_calls' }] }
  ];
  const bytes = new TextEncoder().encode(frames.map(f => `data: ${JSON.stringify(f)}\r\n\r\n`).join(''));
  let request;
  const result = await streamOpenAICompatible({ provider, messages: [], tools: [{ name: 'inspect_scene' }], fetchImpl: async (_url, init) => {
    request = JSON.parse(init.body);
    return { ok: true, body: new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += 3) c.enqueue(bytes.slice(i, i + 3)); c.close(); } }) };
  } });
  assert.equal(request.stream, true);
  assert.equal(request.tools[0].function.name, 'inspect_scene');
  assert.deepEqual(result.toolCalls, [{ id: 'c1', name: 'inspect_scene', arguments: { x: '雪' } }]);
});
test('visible tokens arrive before stream close and a final unterminated event is consumed', async () => {
  let close;
  const tokens = [];
  const result = await streamOpenAICompatible({ provider, messages: [], onToken: token => { tokens.push(token); if (token === '第一段') close(); }, fetchImpl: async () => ({ ok: true, body: new ReadableStream({ start(c) {
    const frame = content => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}`;
    close = () => { c.enqueue(new TextEncoder().encode(frame('尾段'))); c.close(); };
    c.enqueue(new TextEncoder().encode(frame('第一段') + '\n\n'));
  } }) }) });
  assert.deepEqual(tokens, ['第一段', '尾段']); assert.equal(result.content, '第一段尾段');
});
