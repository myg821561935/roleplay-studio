// 流式生成的中止管理：
// - AbortController 生命周期（begin/end scope）
// - 中止错误判定（SSE aborted 标记 / GENERATION_ABORTED / AbortError）
// - 服务端 partial 回合取回（GET /api/sessions/:id 刷新会话）
export function createStreamAbortManager({ fetchImpl = globalThis.fetch } = {}) {
  let activeAbortController = null;

  return {
    stopGeneration() {
      if (!activeAbortController) return false;
      activeAbortController.abort();
      return true;
    },
    beginScope() {
      activeAbortController = new AbortController();
      return activeAbortController.signal;
    },
    endScope() {
      activeAbortController = null;
    },
    hasActiveScope() {
      return Boolean(activeAbortController);
    }
  };
}

export function isAbortedError(error) {
  return error?.aborted === true
    || error?.code === 'GENERATION_ABORTED'
    || error?.name === 'AbortError';
}

// 服务端中止时已留存 partial 回合（SSE error 载荷含 partialMessageId）；
// 刷新会话取回该消息，失败时静默降级（保留本地流式预览，用户可手动刷新）
export async function fetchRetainedSession(fetchImpl, sessionId) {
  const response = await fetchImpl(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: 'GET' });
  if (!response.ok) throw new Error('SESSION_REFRESH_FAILED');
  const data = await response.json();
  return data?.session || data || null;
}
