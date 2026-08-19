const RESERVED_CUSTOM_HEADERS = new Set(['authorization', 'content-type']);
const REASONING_ONLY_ERROR = 'PROVIDER_REASONING_ONLY_RESPONSE';
const EXPLICIT_REASONING_WORKFLOW_PATTERNS = [
  /<think_rules>/i,
  /思维链只做思考/,
  /思考内容以[\s\S]{0,120}<think>/i,
  /到此思考才算结束/,
  /正文创作必须在思考阶段完全结束/
];

function requireNonEmptyString(value, message) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(message);
  }
  return value.trim();
}

function filterProviderHeaders(headers = {}) {
  if (!headers || typeof headers !== 'object') {
    return {};
  }

  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => !RESERVED_CUSTOM_HEADERS.has(name.toLowerCase()))
  );
}

function validateOpenAICompatibleRequest({ provider, messages }) {
  if (!provider || typeof provider !== 'object' || Array.isArray(provider)) {
    throw new Error('provider must be an object');
  }

  return {
    baseUrl: requireNonEmptyString(provider.baseUrl, 'Provider baseUrl is required'),
    model: requireNonEmptyString(provider.model, 'Provider model is required'),
    apiKey: requireNonEmptyString(provider.apiKey, 'Provider apiKey is required'),
    messages
  };
}

export function buildOpenAICompatibleRequest({ provider, messages, stream = false, tools = null }) {
  const validated = validateOpenAICompatibleRequest({ provider, messages });
  if (!Array.isArray(validated.messages)) {
    throw new Error('messages must be an array');
  }

  const baseUrl = validated.baseUrl.replace(/\/+$/, '');
  const url = `${baseUrl}/chat/completions`;
  const body = {
    model: validated.model,
    messages: validated.messages,
    temperature: Number(provider.temperature ?? 0.9),
    max_tokens: Number(provider.maxTokens ?? 2000)
  };
  const reasoningMode = resolveDeepSeekReasoningMode(provider, validated.messages);
  if (reasoningMode !== 'auto') body.thinking = { type: reasoningMode };
  if (stream) body.stream = true;
  if (Array.isArray(tools) && tools.length) {
    body.tools = tools.map((tool) => ({
      type: 'function',
      function: {
        name: String(tool.name || tool.toolName || ''),
        description: String(tool.description || ''),
        parameters: tool.inputSchema || tool.parameters || { type: 'object', properties: {} }
      }
    }));
  }

  return {
    url,
    init: {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${validated.apiKey}`,
        ...filterProviderHeaders(provider.headers)
      },
      body: JSON.stringify(body)
    }
  };
}

export async function callOpenAICompatible({ provider, messages, fetchImpl = fetch, tools = null, signal = null }) {
  try {
    return await callOpenAICompatibleOnce({ provider, messages, fetchImpl, tools, signal });
  } catch (error) {
    if (!shouldRetryWithoutReasoning({ error, provider, messages })) throw error;
    const result = await callOpenAICompatibleOnce({
      provider: { ...provider, reasoningMode: 'disabled' },
      messages,
      fetchImpl,
      tools,
      signal
    });
    result.reasoningRecovery = { used: true, mode: 'disabled' };
    return result;
  }
}

export async function streamOpenAICompatible({ provider, messages, onToken, fetchImpl = fetch, signal = null }) {
  try {
    return await streamOpenAICompatibleOnce({ provider, messages, onToken, fetchImpl, signal });
  } catch (error) {
    if (!shouldRetryWithoutReasoning({ error, provider, messages })) throw error;
    const result = await streamOpenAICompatibleOnce({
      provider: { ...provider, reasoningMode: 'disabled' },
      messages,
      onToken,
      fetchImpl,
      signal
    });
    result.reasoningRecovery = { used: true, mode: 'disabled' };
    return result;
  }
}

async function callOpenAICompatibleOnce({ provider, messages, fetchImpl, tools, signal }) {
  const { url, init } = buildOpenAICompatibleRequest({ provider, messages, tools });
  const response = await fetchImpl(url, signal ? { ...init, signal } : init);
  return readOpenAICompatibleResponse(response);
}

async function streamOpenAICompatibleOnce({ provider, messages, onToken, fetchImpl, signal }) {
  const { url, init } = buildOpenAICompatibleRequest({ provider, messages, stream: true });
  const response = await fetchImpl(url, signal ? { ...init, signal } : init);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Provider stream error ${response.status}: ${text.slice(0, 240)}`);
  }
  if (!response.body?.getReader) {
    throw new Error('Provider stream response missing readable body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let reasoningObserved = false;
  let finishReason = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() || '';
      for (const eventText of events) {
        const delta = readStreamDelta(eventText);
        if (!delta) continue;
        if (delta.reasoningObserved) reasoningObserved = true;
        if (delta.finishReason) finishReason = delta.finishReason;
        if (!delta.content) continue;
        content += delta.content;
        await onToken?.(delta.content);
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  if (!content.trim()) {
    if (reasoningObserved) {
      throw new Error(`${REASONING_ONLY_ERROR}${finishReason ? `:${finishReason}` : ''}`);
    }
    throw new Error('PROVIDER_EMPTY_RESPONSE');
  }

  return {
    content,
    raw: { finishReason, reasoningObserved }
  };
}

function shouldRetryWithoutReasoning({ error, provider, messages }) {
  return String(error?.message || '').startsWith(REASONING_ONLY_ERROR)
    && resolveDeepSeekReasoningMode(provider, messages) === 'auto'
    && supportsDeepSeekThinkingControl(provider);
}

function resolveDeepSeekReasoningMode(provider, messages) {
  if (!supportsDeepSeekThinkingControl(provider)) return 'auto';
  const configured = normalizeReasoningMode(provider?.reasoningMode);
  if (configured !== 'auto') return configured;
  return hasExplicitReasoningWorkflow(messages) ? 'disabled' : 'auto';
}

function normalizeReasoningMode(value) {
  const mode = String(value || 'auto').trim().toLowerCase();
  return ['auto', 'enabled', 'disabled'].includes(mode) ? mode : 'auto';
}

function supportsDeepSeekThinkingControl(provider) {
  const model = String(provider?.model || '').trim().toLowerCase();
  if (!model.startsWith('deepseek-')) return false;
  try {
    return new URL(String(provider?.baseUrl || '')).hostname.toLowerCase() === 'api.deepseek.com';
  } catch {
    return false;
  }
}

function hasExplicitReasoningWorkflow(messages) {
  return (Array.isArray(messages) ? messages : []).some((message) => {
    if (String(message?.role || '').toLowerCase() !== 'system') return false;
    const content = String(message?.content || '');
    return EXPLICIT_REASONING_WORKFLOW_PATTERNS.some((pattern) => pattern.test(content));
  });
}

function readStreamDelta(eventText) {
  const lines = String(eventText || '').split('\n');
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    const data = line.slice(6).trim();
    if (!data || data === '[DONE]') continue;
    const payload = JSON.parse(data);
    const choice = payload?.choices?.[0];
    const delta = choice?.delta || {};
    return {
      content: typeof delta.content === 'string' ? delta.content : '',
      reasoningObserved: typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0,
      finishReason: String(choice?.finish_reason || '')
    };
  }
  return null;
}

export async function readOpenAICompatibleResponse(response) {
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`Provider returned non-JSON response ${response.status}: ${text.slice(0, 160)}`);
  }

  if (!response.ok) {
    throw new Error(`Provider error ${response.status}: ${JSON.stringify(payload).slice(0, 240)}`);
  }

  const choice = payload?.choices?.[0];
  const message = choice?.message || {};
  const content = typeof message.content === 'string' ? message.content : '';
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];

  // 当存在 tool_calls 时允许 content 为空（模型只请求调用工具）
  if (!content && toolCalls.length === 0) {
    if (typeof message.reasoning_content === 'string' && message.reasoning_content.length > 0) {
      throw new Error(`${REASONING_ONLY_ERROR}${choice?.finish_reason ? `:${choice.finish_reason}` : ''}`);
    }
    throw new Error(`Provider response missing assistant content: ${JSON.stringify(payload).slice(0, 240)}`);
  }

  const result = { content, raw: payload };
  if (toolCalls.length) {
    result.toolCalls = toolCalls.map((call) => ({
      id: String(call.id || ''),
      name: String(call.function?.name || call.name || ''),
      arguments: parseToolArguments(call.function?.arguments ?? call.arguments)
    }));
  }
  return result;
}

function parseToolArguments(raw) {
  if (typeof raw === 'object' && raw !== null) return raw;
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { _raw: raw };
  }
}
