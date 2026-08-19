const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

export function buildGeminiRequest({ provider, messages, stream = false }) {
  const validated = validateGeminiRequest({ provider, messages });
  const baseUrl = String(provider.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const systemText = validated.messages
    .filter((message) => message.role === 'system')
    .map((message) => String(message.content || '').trim())
    .filter(Boolean)
    .join('\n\n');
  const contents = validated.messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(message.content || '') }]
    }));

  const body = {
    contents,
    generationConfig: {
      temperature: Number(provider.temperature ?? 0.9),
      maxOutputTokens: Number(provider.maxTokens ?? 2000)
    }
  };
  if (systemText) {
    body.systemInstruction = { parts: [{ text: systemText }] };
  }

  const endpoint = stream ? ':streamGenerateContent?alt=sse&' : ':generateContent?';
  return {
    url: `${baseUrl}/models/${encodeURIComponent(validated.model)}${endpoint}key=${encodeURIComponent(validated.apiKey)}`,
    init: {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...filterHeaders(provider.headers)
      },
      body: JSON.stringify(body)
    }
  };
}

export async function callGemini({ provider, messages, fetchImpl = fetch, signal = null }) {
  const { url, init } = buildGeminiRequest({ provider, messages });
  const response = await fetchImpl(url, signal ? { ...init, signal } : init);
  return readGeminiResponse(response);
}

export async function streamGemini({ provider, messages, onToken, fetchImpl = fetch, signal = null }) {
  const { url, init } = buildGeminiRequest({ provider, messages, stream: true });
  const response = await fetchImpl(url, signal ? { ...init, signal } : init);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemini stream error ${response.status}: ${text.slice(0, 240)}`);
  }
  if (!response.body?.getReader) {
    throw new Error('Gemini stream response missing readable body');
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
        const token = readGeminiStreamToken(eventText);
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

function readGeminiStreamToken(eventText) {
  const lines = String(eventText || '').split('\n');
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    const data = line.slice(6).trim();
    if (!data || data === '[DONE]') continue;
    try {
      const payload = JSON.parse(data);
      const parts = payload?.candidates?.[0]?.content?.parts;
      if (Array.isArray(parts)) {
        return parts.map((p) => (typeof p.text === 'string' ? p.text : '')).join('');
      }
    } catch {
      // ignore parse error
    }
  }
  return '';
}

export async function readGeminiResponse(response) {
  const text = await response.text();
  const payload = parseJson(text, response.status);
  if (!response.ok) {
    throw new Error(`Gemini provider error ${response.status}: ${JSON.stringify(payload).slice(0, 240)}`);
  }

  const parts = payload?.candidates?.[0]?.content?.parts;
  const content = Array.isArray(parts)
    ? parts.map((part) => typeof part.text === 'string' ? part.text : '').join('')
    : '';

  if (!content) {
    throw new Error(`Gemini response missing assistant content: ${JSON.stringify(payload).slice(0, 240)}`);
  }

  return { content, raw: payload };
}

function validateGeminiRequest({ provider, messages }) {
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
  const reserved = new Set(['content-type']);
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !reserved.has(name.toLowerCase())));
}

function parseJson(text, status) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Gemini provider returned non-JSON response ${status}: ${text.slice(0, 160)}`);
  }
}
