const DEFAULT_BASE_URL = 'https://api.anthropic.com/v1';
const DEFAULT_VERSION = '2023-06-01';

export function buildAnthropicRequest({ provider, messages, stream = false }) {
  const validated = validateAnthropicRequest({ provider, messages });
  const baseUrl = String(provider.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const system = validated.messages
    .filter((message) => message.role === 'system')
    .map((message) => String(message.content || '').trim())
    .filter(Boolean)
    .join('\n\n');
  const chatMessages = validated.messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: String(message.content || '')
    }));

  const body = {
    model: validated.model,
    max_tokens: Number(provider.maxTokens ?? 2000),
    temperature: Number(provider.temperature ?? 0.9),
    messages: chatMessages
  };
  if (system) body.system = system;
  if (stream) body.stream = true;

  return {
    url: `${baseUrl}/messages`,
    init: {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': validated.apiKey,
        'anthropic-version': String(provider.version || DEFAULT_VERSION),
        ...filterHeaders(provider.headers)
      },
      body: JSON.stringify(body)
    }
  };
}

export async function callAnthropic({ provider, messages, fetchImpl = fetch, signal = null }) {
  const { url, init } = buildAnthropicRequest({ provider, messages });
  const response = await fetchImpl(url, signal ? { ...init, signal } : init);
  return readAnthropicResponse(response);
}

export async function streamAnthropic({ provider, messages, onToken, fetchImpl = fetch, signal = null }) {
  const { url, init } = buildAnthropicRequest({ provider, messages, stream: true });
  const response = await fetchImpl(url, signal ? { ...init, signal } : init);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic stream error ${response.status}: ${text.slice(0, 240)}`);
  }
  if (!response.body?.getReader) {
    throw new Error('Anthropic stream response missing readable body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() || '';
      for (const eventText of events) {
        const token = readAnthropicStreamToken(eventText);
        if (!token) continue;
        content += token;
        await onToken?.(token);
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  return { content, raw: null };
}

function readAnthropicStreamToken(eventText) {
  const lines = String(eventText || '').split('\n');
  let eventType = '';
  for (const line of lines) {
    if (line.startsWith('event: ')) {
      eventType = line.slice(7).trim();
    } else if (line.startsWith('data: ')) {
      const data = line.slice(6).trim();
      if (!data) continue;
      try {
        const payload = JSON.parse(data);
        if (eventType === 'content_block_delta' && payload?.delta?.type === 'text_delta') {
          return payload.delta.text || '';
        }
      } catch {
        // ignore parse error
      }
    }
  }
  return '';
}

export async function readAnthropicResponse(response) {
  const text = await response.text();
  const payload = parseJson(text, response.status);
  if (!response.ok) {
    throw new Error(`Anthropic provider error ${response.status}: ${JSON.stringify(payload).slice(0, 240)}`);
  }

  const content = Array.isArray(payload.content)
    ? payload.content
      .filter((part) => part?.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('')
    : '';

  if (!content) {
    throw new Error(`Anthropic response missing assistant content: ${JSON.stringify(payload).slice(0, 240)}`);
  }

  return { content, raw: payload };
}

function validateAnthropicRequest({ provider, messages }) {
  if (!provider || typeof provider !== 'object' || Array.isArray(provider)) {
    throw new Error('provider must be an object');
  }
  if (!Array.isArray(messages)) throw new Error('messages must be an array');
  return {
    apiKey: requireNonEmptyString(provider.apiKey, 'Provider apiKey is required'),
    model: requireNonEmptyString(provider.model, 'Provider model is required'),
    messages
  };
}

function requireNonEmptyString(value, message) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(message);
  return value.trim();
}

function filterHeaders(headers = {}) {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return {};
  const reserved = new Set(['content-type', 'x-api-key', 'anthropic-version']);
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !reserved.has(name.toLowerCase())));
}

function parseJson(text, status) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Anthropic provider returned non-JSON response ${status}: ${text.slice(0, 160)}`);
  }
}
