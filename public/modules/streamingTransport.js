import { createHttpError, parseJsonResponse } from './apiClient.js';
import { createSseError, parseSseEvent } from './sseProtocol.js';

async function assertStreamingResponse(response) {
  if (response.ok) return;
  const text = await response.text();
  throw createHttpError(response, text, parseJsonResponse(text));
}

export async function readSseResponse(response, {
  onToken = () => {},
  onPhase = () => {},
  onTurnReady = () => {},
  missingBodyMessage = '当前浏览器不支持流式响应',
  missingDoneMessage = '流式响应缺少完成事件'
} = {}) {
  await assertStreamingResponse(response);
  if (!response.body) throw new Error(missingBodyMessage);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let donePayload;
  let doneReceived = false;

  async function consumeEvent(eventText) {
    const event = parseSseEvent(eventText);
    if (!event) return;
    if (event.event === 'token') {
      const content = String(event.data?.content || '');
      if (content) await onToken(content);
      return;
    }
    if (event.event === 'phase') {
      const phase = String(event.data?.phase || '').trim();
      if (phase) await onPhase(phase);
      return;
    }
    if (event.event === 'turn') {
      await onTurnReady(event.data || {});
      return;
    }
    if (event.event === 'done') {
      doneReceived = true;
      donePayload = event.data;
      return;
    }
    if (event.event === 'error') throw createSseError(event.data);
  }

  async function drainCompleteEvents({ flush = false } = {}) {
    let boundary = buffer.match(/\r?\n\r?\n/);
    while (boundary) {
      const eventText = buffer.slice(0, boundary.index);
      buffer = buffer.slice(boundary.index + boundary[0].length);
      if (eventText.trim()) await consumeEvent(eventText);
      boundary = buffer.match(/\r?\n\r?\n/);
    }
    if (flush && buffer.trim()) {
      const eventText = buffer;
      buffer = '';
      await consumeEvent(eventText);
    }
  }

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      await drainCompleteEvents();
    }
    buffer += decoder.decode();
    await drainCompleteEvents({ flush: true });
  } finally {
    await reader.cancel().catch(() => {});
  }

  if (!doneReceived) throw new Error(missingDoneMessage);
  return donePayload || {};
}
