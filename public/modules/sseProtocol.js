// SSE 协议层：事件块解析与流式状态文案，
// 与 UI 无关，供 conversationStream 消费
export function parseSseEvent(text) {
  const lines = String(text || '').split(/\r?\n/);
  let event = '';
  const dataLines = [];

  lines.forEach((line) => {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  });
  if (!event) return null;

  const dataText = dataLines.join('\n');
  if (!dataText) return { event, data: undefined };
  try {
    return { event, data: JSON.parse(dataText) };
  } catch {
    return { event, data: undefined };
  }
}

// 由 SSE error 载荷构造错误对象：
// 服务端留存了 partial 回合时透出 aborted 标记与消息 ID，供调用方刷新会话展示
export function createSseError(data) {
  const error = new Error(data?.detail || data?.error || 'STREAM_ERROR');
  error.code = data?.error;
  if (data?.aborted === true) {
    error.aborted = true;
    error.partialMessageId = String(data?.partialMessageId || '');
  }
  return error;
}

export function originalOpeningStatus(pendingDraft) {
  return pendingDraft ? '正在依据设定生成第一幕...' : '故事正在续写...';
}
