import { callAnthropic, streamAnthropic } from './anthropic.js';
import { callGemini, streamGemini } from './gemini.js';
import { callOpenAICompatible, streamOpenAICompatible } from './openaiCompatible.js';

export function buildProviderClient() {
  return {
    complete: ({ provider, messages, fetchImpl, tools, signal }) => callProvider({ provider, messages, fetchImpl, tools, signal }),
    stream: ({ provider, messages, onToken, fetchImpl, signal }) => streamProvider({ provider, messages, onToken, fetchImpl, signal })
  };
}

async function callProvider({ provider, messages, fetchImpl = fetch, tools = null, signal = null }) {
  const kind = providerKind(provider);
  if (kind === 'anthropic') return callAnthropic({ provider, messages, fetchImpl, signal });
  if (kind === 'gemini') return callGemini({ provider, messages, fetchImpl, signal });
  return callOpenAICompatible({ provider, messages, fetchImpl, tools, signal });
}

async function streamProvider({ provider, messages, onToken, fetchImpl = fetch, signal = null }) {
  const kind = providerKind(provider);
  if (kind === 'anthropic') {
    return streamAnthropic({ provider, messages, onToken, fetchImpl, signal });
  }
  if (kind === 'gemini') {
    return streamGemini({ provider, messages, onToken, fetchImpl, signal });
  }
  if (kind === 'openai-compatible') {
    return streamOpenAICompatible({ provider, messages, onToken, fetchImpl, signal });
  }

  const result = await callProvider({ provider, messages, fetchImpl, signal });
  for (const token of chunkText(result.content)) {
    await onToken?.(token);
  }
  return result;
}

function providerKind(provider) {
  const kind = String(provider?.kind || 'openai-compatible').toLowerCase();
  return ['openai-compatible', 'anthropic', 'gemini'].includes(kind) ? kind : 'openai-compatible';
}

function chunkText(text) {
  const value = String(text || '');
  const chunks = [];
  for (let index = 0; index < value.length; index += 16) {
    chunks.push(value.slice(index, index + 16));
  }
  return chunks;
}
