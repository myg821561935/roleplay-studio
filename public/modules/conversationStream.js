import { extractRoleplayPresentation } from './roleplayResponse.js';
import { renderNarrativeMarkdown } from './narrativeText.js';
import { buildSpeakerPortraitMap } from './characterPresentation.js';
import { renderStreamingActionPreview } from './streamingActionPreview.js';
import { readSseResponse } from './streamingTransport.js';
import { createStreamAbortManager, fetchRetainedSession, isAbortedError } from './streamAbort.js';
import { originalOpeningStatus, parseSseEvent } from './sseProtocol.js';

export { readSseResponse, originalOpeningStatus, parseSseEvent };

export function createConversationStreamController({
  state = {},
  els = {},
  fetchImpl = globalThis.fetch,
  getSessionId = () => 'main',
  replaceSession = () => state.session,
  renderMessages = () => {},
  refreshInspector = () => {},
  setStreamingState = () => {},
  clearComposerInput = () => {},
  setComposerInputValue = () => {},
  renderTargetSpeakerIndicator = () => {},
  captureScrollState = () => ({}),
  restoreScrollState = () => {},
  serializeValue = (value) => JSON.stringify(value, null, 2),
  setStatus = () => {},
  humanizeApiError = (error) => error?.message || String(error),
  documentObject = globalThis.document
} = {}) {
  function isStreaming() {
    return Boolean(state.chatStreaming);
  }

  function isCurrentSession(sessionId) {
    return String(getSessionId() || '') === String(sessionId || '');
  }

  function reportStreaming() {
    setStatus(els.sessionStatus, '旁白仍在生成，可先继续起草下一步', 'busy');
  }

  function createPreviewNode(role, content, speaker = '') {
    const article = documentObject.createElement('article');
    article.className = `message ${role}`;
    const meta = documentObject.createElement('div');
    meta.className = 'message-meta';
    const roleText = documentObject.createElement('span');
    roleText.className = 'message-role';
    roleText.textContent = role === 'user' ? '你' : '旁白';
    meta.append(roleText);
    const body = documentObject.createElement('div');
    body.className = 'message-content';
    body.innerHTML = renderNarrativeMarkdown(content, {
      role,
      speaker,
      portraitBySpeaker: buildSpeakerPortraitMap(state.config)
    });
    article.append(meta, body);
    return article;
  }

  function appendStreamingPreview(userContent) {
    const scrollState = captureScrollState();
    els.messages.querySelectorAll('.empty-state, .epic-cover-page').forEach((node) => node.remove());
    els.messages.classList.remove('has-cover-page');
    els.messages.classList.remove('has-journey-draft');

    const userNode = createPreviewNode('user', userContent);
    const assistantNode = createPreviewNode('assistant', '');
    assistantNode.classList.add('is-streaming');
    els.messages.append(userNode, assistantNode);
    restoreScrollState(scrollState);
    return {
      actionsNode: null,
      content: '',
      userNode,
      node: assistantNode,
      contentNode: assistantNode.querySelector('.message-content')
    };
  }

  function updateStreamingPreview(preview, token) {
    if (!preview?.contentNode) return;
    const scrollState = captureScrollState();
    preview.content += token;
    const presentation = extractRoleplayPresentation(preview.content);
    const visible = presentation.content || (
      presentation.protocolDetected ? '正在铺陈场景…' : preview.content
    );
    preview.contentNode.innerHTML = renderNarrativeMarkdown(visible, {
      role: 'assistant',
      speaker: presentation.speaker || '',
      portraitBySpeaker: buildSpeakerPortraitMap(state.config)
    });
    restoreScrollState(scrollState);
  }

  async function requestStream(path, body, onToken, onPhase, signal = null, onTurnReady = () => {}) {
    const response = await fetchImpl(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal
    });
    return readSseResponse(response, { onToken, onPhase, onTurnReady });
  }

  function renderMemorySnapshot() {
    if (els.memoryView) els.memoryView.textContent = serializeValue(state.session?.memory || {});
  }

  // 中止管理：停止按钮触发 abort，服务端留存 partial 回合
  const abortManager = createStreamAbortManager({ fetchImpl });

  // 中止错误处理：服务端已留存 partial 回合时刷新会话并提示，否则按普通失败处理
  async function handleAbortedStream(error, requestSessionId) {
    const retained = error?.aborted === true && error.partialMessageId;
    if (retained && isCurrentSession(requestSessionId)) {
      try {
        const session = await fetchRetainedSession(fetchImpl, requestSessionId);
        if (session) {
          replaceSession(session, {
            fallback: state.session,
            expectedSessionId: requestSessionId
          });
        }
      } catch {
        // 刷新失败时保留本地预览，用户可手动刷新
      }
    }
    if (isCurrentSession(requestSessionId)) {
      renderMessages();
      renderMemorySnapshot();
      renderTargetSpeakerIndicator();
      setStatus(els.sessionStatus, retained ? '已停止生成，已保留未完成的正文' : '已停止生成', 'busy');
    }
    return null;
  }

  async function sendMessage() {
    if (isStreaming()) {
      reportStreaming();
      return null;
    }
    const content = String(els.chatInput?.value || '').trim();
    if (!content) return null;

    const requestSessionId = String(getSessionId() || 'main');
    const targetSpeaker = state.targetSpeaker || undefined;
    const pendingQuickReply = state.pendingQuickReply;
    const hideUserMessage = Boolean(
      pendingQuickReply?.hiddenFromChat
      && pendingQuickReply.content === content
    );
    const originalDraft = state.pendingJourneyDraft;
    let committedTurnRendered = false;
    state.pendingQuickReply = null;
    setStreamingState(true, originalOpeningStatus(originalDraft));
    const signal = abortManager.beginScope();

    try {
      state.pendingJourneyDraft = null;
      clearComposerInput();
      const preview = appendStreamingPreview(content);
      if (originalDraft || hideUserMessage) preview.userNode.hidden = true;

      const payload = await requestStream('/api/chat/stream', {
        sessionId: requestSessionId,
        content,
        targetSpeaker,
        hideUserMessage
      }, (token) => updateStreamingPreview(preview, token), (phase) => {
        if (phase === 'finalizing' && isCurrentSession(requestSessionId)) {
          renderStreamingActionPreview({ preview, documentObject });
          setStreamingState(true, '正文已生成，正在同步世界状态与记忆…', 'finalizing');
        }
      }, signal, (turnPayload) => {
        if (!isCurrentSession(requestSessionId) || !turnPayload?.session) return;
        replaceSession(turnPayload.session, {
          fallback: state.session,
          expectedSessionId: requestSessionId
        });
        committedTurnRendered = true;
        renderMessages();
        renderMemorySnapshot();
        refreshInspector();
        renderTargetSpeakerIndicator();
        setStatus(els.sessionStatus, '下一步行动已就绪，正在整理长期记忆…', 'busy');
      });

      if (!isCurrentSession(requestSessionId)) return payload;
      replaceSession(payload.session, {
        fallback: state.session,
        expectedSessionId: requestSessionId
      });
      state.openingError = '';
      state.targetSpeaker = '';
      if (!committedTurnRendered) renderMessages();
      renderMemorySnapshot();
      refreshInspector();
      renderTargetSpeakerIndicator();
      setStatus(els.appStatus, '对话已更新', 'ok');
      return payload;
    } catch (error) {
      if (!isCurrentSession(requestSessionId)) return null;
      if (isAbortedError(error)) return handleAbortedStream(error, requestSessionId);
      state.pendingJourneyDraft = originalDraft;
      if (!String(els.chatInput?.value || '').trim()) {
        setComposerInputValue(content, { pendingQuickReply });
      }
      if (originalDraft) {
        state.openingError = `第一幕生成失败：${humanizeApiError(error)}`;
      }
      renderMessages();
      setStatus(els.sessionStatus, `发送失败：${humanizeApiError(error)}`, 'error');
      return null;
    } finally {
      abortManager.endScope();
      if (isCurrentSession(requestSessionId)) {
        setStreamingState(false);
        els.chatInput?.focus?.();
      }
    }
  }

  async function continueLastMessage() {
    if (isStreaming()) {
      reportStreaming();
      return null;
    }
    const messages = Array.isArray(state.session?.messages) ? state.session.messages : [];
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage.role !== 'assistant') {
      setStatus(els.sessionStatus, '最后一条消息不是旁白回复', 'error');
      return null;
    }

    const requestSessionId = String(getSessionId() || 'main');
    let committedTurnRendered = false;
    setStreamingState(true, '正在继续生成...');
    const signal = abortManager.beginScope();
    try {
      const preview = appendStreamingPreview('（继续生成）');
      preview.userNode.hidden = true;
      const payload = await requestStream('/api/chat/continue', {
        sessionId: requestSessionId
      }, (token) => updateStreamingPreview(preview, token), (phase) => {
        if (phase === 'finalizing' && isCurrentSession(requestSessionId)) {
          renderStreamingActionPreview({ preview, documentObject });
          setStreamingState(true, '正文已生成，正在同步世界状态与记忆…', 'finalizing');
        }
      }, signal, (turnPayload) => {
        if (!isCurrentSession(requestSessionId) || !turnPayload?.session) return;
        replaceSession(turnPayload.session, {
          fallback: state.session,
          expectedSessionId: requestSessionId
        });
        committedTurnRendered = true;
        renderMessages();
        renderMemorySnapshot();
        refreshInspector();
        renderTargetSpeakerIndicator();
        setStatus(els.sessionStatus, '下一步行动已就绪，正在整理长期记忆…', 'busy');
      });

      if (!isCurrentSession(requestSessionId)) return payload;
      replaceSession(payload.session, {
        fallback: state.session,
        expectedSessionId: requestSessionId
      });
      if (!committedTurnRendered) renderMessages();
      renderMemorySnapshot();
      refreshInspector();
      renderTargetSpeakerIndicator();
      setStatus(els.appStatus, '已继续生成', 'ok');
      return payload;
    } catch (error) {
      if (!isCurrentSession(requestSessionId)) return null;
      if (isAbortedError(error)) return handleAbortedStream(error, requestSessionId);
      renderMessages();
      setStatus(els.sessionStatus, `继续生成失败：${humanizeApiError(error)}`, 'error');
      return null;
    } finally {
      abortManager.endScope();
      if (isCurrentSession(requestSessionId)) setStreamingState(false);
    }
  }

  return {
    appendStreamingPreview,
    continueLastMessage,
    isStreaming,
    requestStream,
    sendMessage,
    stopGeneration: () => abortManager.stopGeneration(),
    updateStreamingPreview
  };
}
