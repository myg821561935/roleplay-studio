// Pi owns the loop; the existing transport retains provider settings and wire prompts.
// No coding tools, system prompt, persistence, or compaction are installed here.
export async function runPiRuntime({ messages, tools = [], complete, executeTool, signal, onEvent }) {
  signal?.throwIfAborted();
  let Agent;
  try { ({ Agent } = await import('@earendil-works/pi-agent-core')); }
  catch (cause) {
    throw Object.assign(new Error('Pi 实验依赖未安装，请安装依赖或切回 native。', { cause }), { code: 'PI_RUNTIME_UNAVAILABLE' });
  }
  let rounds = 0, lastResult, failure;
  const original = structuredClone(messages);
  const text = blocks => blocks.filter(b => b.type === 'text').map(b => b.text).join('');
  const toWire = message => message.role === 'toolResult'
    ? { role: 'tool', tool_call_id: message.toolCallId, content: text(message.content) }
    : { role: 'assistant', content: text(message.content),
      ...(message.content.some(b => b.type === 'toolCall') ? { tool_calls: message.content.filter(b => b.type === 'toolCall').map(b => ({
        id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.arguments) }
      })) } : {}) };
  const agent = new Agent({
    initialState: {
      model: { id: 'existing-provider', provider: 'roleplay-bridge', api: 'roleplay-bridge' },
      systemPrompt: '',
      tools: tools.map(tool => ({
        name: tool.name || tool.toolName, label: tool.name || tool.toolName,
        description: tool.description || '',
        parameters: tool.inputSchema || tool.parameters || { type: 'object', properties: {} },
        execute: async (id, args, toolSignal) => {
          signal?.throwIfAborted();
          const content = await executeTool({ id, name: tool.name || tool.toolName, arguments: args }, toolSignal);
          signal?.throwIfAborted();
          return { content: [{ type: 'text', text: String(content) }], details: {} };
        }
      }))
    },
    toolExecution: 'sequential',
    convertToLlm: items => items.filter(m => m.role !== 'roleplay-start'),
    streamFn: async (_model, context) => {
      try {
        signal?.throwIfAborted();
        if (++rounds > 5) throw Object.assign(new Error('工具调用达到本轮上限，请简化操作后重试。'), { code: 'TOOL_ROUND_LIMIT' });
        lastResult = await complete([...original, ...context.messages.map(toWire)]);
        const calls = lastResult.toolCalls || [];
        const final = { role: 'assistant', api: 'roleplay-bridge', provider: 'roleplay-bridge', model: 'existing-provider', timestamp: Date.now(),
          content: [...(lastResult.content ? [{ type: 'text', text: lastResult.content }] : []), ...calls.map(call => ({ type: 'toolCall', ...call }))],
          stopReason: (lastResult.raw?.finishReason || lastResult.raw?.choices?.[0]?.finish_reason) === 'length' ? 'length' : calls.length ? 'toolUse' : 'stop',
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
        // Visible streaming is awaited by the transport callback; Pi receives the completed turn.
        return { async *[Symbol.asyncIterator]() { yield { type: 'done', reason: final.stopReason, message: final }; }, result: async () => final };
      } catch (error) { failure = error; throw error; }
    }
  });
  const abort = () => agent.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (onEvent) agent.subscribe(onEvent);
  try {
    signal?.throwIfAborted();
    await agent.prompt({ role: 'roleplay-start', content: '', timestamp: Date.now() });
    signal?.throwIfAborted();
    if (failure) throw failure;
    if (agent.state.errorMessage) throw Object.assign(new Error(agent.state.errorMessage), { code: 'PI_RUNTIME_ERROR' });
    if (!lastResult) throw new Error('PI_RUNTIME_EMPTY_RESULT');
    return { ...lastResult, runtime: { kind: 'pi', rounds } };
  } finally { signal?.removeEventListener('abort', abort); }
}
