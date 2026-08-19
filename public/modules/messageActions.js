const MESSAGE_ACTION_SELECTOR = [
  '[data-edit-message]',
  '[data-regenerate-message]',
  '[data-toggle-visibility]',
  '[data-swipe-prev]',
  '[data-swipe-next]',
  '[data-toggle-bookmark]',
  '[data-fork-timeline]',
  '[data-speak-message]'
].join(', ');

export function getSwipeTargetIndex(message, delta) {
  const swipes = Array.isArray(message?.swipes) ? message.swipes : [];
  if (swipes.length <= 1) return -1;
  const currentIndex = Number(message.activeSwipeIndex || 0);
  if (!Number.isInteger(currentIndex) || currentIndex < 0 || currentIndex >= swipes.length) return -1;
  const nextIndex = (currentIndex + Number(delta || 0) + swipes.length) % swipes.length;
  return nextIndex === currentIndex ? -1 : nextIndex;
}

export function createMessageActionsController({
  state = {},
  els = {},
  apiRequest = async () => ({}),
  getCurrentSessionId = () => 'main',
  replaceSession = () => state.session,
  renderMessages = () => {},
  refreshInspector = () => {},
  setStatus = () => {},
  humanizeApiError = (error) => error?.message || String(error),
  decodeImmersiveAction = (value) => value,
  onRecommendedAction = () => {},
  onSpeakMessage = () => {},
  onForkTimeline = () => {},
  promptUser = (message, initialValue) => globalThis.window?.prompt?.(message, initialValue)
} = {}) {
  let actionPending = false;
  let eventsBound = false;

  function findMessage(messageId) {
    return (Array.isArray(state.session?.messages) ? state.session.messages : [])
      .find((message) => message.id === messageId);
  }

  function isBusy() {
    return Boolean(state.chatStreaming || state.conversationActionPending || actionPending);
  }

  function syncActionState() {
    const busy = isBusy();
    els.messages?.querySelectorAll?.(MESSAGE_ACTION_SELECTOR).forEach((button) => {
      button.disabled = busy;
      if (busy) button.setAttribute?.('aria-busy', 'true');
      else button.removeAttribute?.('aria-busy');
    });
    return busy;
  }

  function reportBusy() {
    setStatus(
      els.sessionStatus,
      state.chatStreaming
        ? '旁白仍在生成，请等待本轮完成后再修改历史消息'
        : state.conversationActionPending
          ? '另一项对话行动仍在处理中，请稍候'
          : '上一项消息操作仍在处理中',
      'busy'
    );
  }

  function requestPrompt(message, initialValue, errorPrefix) {
    try {
      return promptUser(message, initialValue);
    } catch (error) {
      setStatus(els.sessionStatus, `${errorPrefix}：${humanizeApiError(error)}`, 'error');
      return undefined;
    }
  }

  async function runMutation({
    path,
    method = 'POST',
    body = {},
    pendingMessage,
    successMessage,
    errorPrefix,
    successElement = els.appStatus,
    errorElement = els.sessionStatus
  }) {
    if (isBusy()) {
      reportBusy();
      return null;
    }

    actionPending = true;
    syncActionState();
    if (pendingMessage) setStatus(els.sessionStatus, pendingMessage, 'busy');
    try {
      const payload = await apiRequest(path, {
        method,
        body: {
          sessionId: getCurrentSessionId(),
          ...body
        }
      });
      replaceSession(payload.session, { fallback: state.session });
      renderMessages();
      refreshInspector();
      setStatus(successElement, successMessage, 'ok');
      return payload;
    } catch (error) {
      setStatus(errorElement, `${errorPrefix}：${humanizeApiError(error)}`, 'error');
      return null;
    } finally {
      actionPending = false;
      syncActionState();
    }
  }

  async function editMessage(messageId) {
    const message = findMessage(messageId);
    if (!message) return null;
    if (isBusy()) {
      reportBusy();
      return null;
    }

    const content = requestPrompt('编辑消息', message.content || '', '无法打开消息编辑框');
    if (content === null || content === undefined) return null;
    if (!String(content).trim()) {
      setStatus(els.sessionStatus, '消息内容不能为空', 'error');
      return null;
    }

    const regeneratesReply = message.role === 'user';
    return runMutation({
      path: `/api/messages/${encodeURIComponent(messageId)}`,
      method: 'PATCH',
      body: { content },
      pendingMessage: regeneratesReply ? '正在编辑并重生成后续回复...' : '正在编辑旁白回复...',
      successMessage: regeneratesReply ? '消息已编辑并重生成' : '旁白回复已编辑',
      errorPrefix: '编辑失败'
    });
  }

  async function regenerateMessage(messageId) {
    const message = findMessage(messageId);
    if (!message || message.role !== 'assistant') return null;
    return runMutation({
      path: `/api/messages/${encodeURIComponent(messageId)}/regenerate`,
      pendingMessage: '正在重生成...',
      successMessage: '已生成新的 Swipe',
      errorPrefix: '重生成失败'
    });
  }

  async function toggleMessageVisibility(messageId) {
    if (!findMessage(messageId)) return null;
    return runMutation({
      path: `/api/messages/${encodeURIComponent(messageId)}/visibility`,
      successMessage: '消息可见性已切换',
      errorPrefix: '切换失败',
      errorElement: els.appStatus
    });
  }

  async function switchMessageSwipe(messageId, delta) {
    const message = findMessage(messageId);
    const swipeIndex = getSwipeTargetIndex(message, delta);
    if (swipeIndex < 0) return null;
    return runMutation({
      path: `/api/messages/${encodeURIComponent(messageId)}/swipe`,
      body: { swipeIndex },
      successMessage: `已切换到分支 ${swipeIndex + 1}/${message.swipes.length}`,
      errorPrefix: '切换分支失败',
      errorElement: els.appStatus
    });
  }

  async function toggleMessageBookmark(messageId) {
    const message = findMessage(messageId);
    if (!message) return null;
    if (isBusy()) {
      reportBusy();
      return null;
    }

    const label = message.bookmarked
      ? ''
      : requestPrompt('为该书签命名（可留空）', message.bookmarkLabel || '', '无法打开书签命名框');
    if (label === null || label === undefined) return null;
    return runMutation({
      path: `/api/messages/${encodeURIComponent(messageId)}/bookmark`,
      body: { label },
      successMessage: message.bookmarked ? '已取消书签' : '已加书签',
      errorPrefix: '书签操作失败',
      errorElement: els.appStatus
    });
  }

  // 从该消息处创建时间线分支：实际流程由 timeline 控制器接管（含命名与切换确认）
  function forkTimelineAt(messageId) {
    if (!findMessage(messageId)) return null;
    if (isBusy()) {
      reportBusy();
      return null;
    }
    return onForkTimeline(findMessage(messageId));
  }

  function handleMessageClick(event) {
    const customActionSubmit = event.target?.closest?.('[data-custom-action-submit]');
    if (customActionSubmit) {
      submitCustomAction(customActionSubmit);
      return;
    }

    const immersiveOption = event.target?.closest?.('[data-immersive-option-action]');
    if (immersiveOption) {
      if (isBusy()) reportBusy();
      else onRecommendedAction(
        decodeImmersiveAction(immersiveOption.dataset.immersiveOptionAction),
        immersiveOption
      );
      return;
    }

    const recommendation = event.target?.closest?.('[data-recommended-action]');
    if (recommendation) {
      if (isBusy()) reportBusy();
      else onRecommendedAction(recommendation.dataset.recommendedAction, recommendation);
      return;
    }

    const routes = [
      ['[data-edit-message]', 'editMessage', editMessage],
      ['[data-regenerate-message]', 'regenerateMessage', regenerateMessage],
      ['[data-toggle-visibility]', 'toggleVisibility', toggleMessageVisibility],
      ['[data-swipe-prev]', 'swipePrev', (id) => switchMessageSwipe(id, -1)],
      ['[data-swipe-next]', 'swipeNext', (id) => switchMessageSwipe(id, 1)],
      ['[data-toggle-bookmark]', 'toggleBookmark', toggleMessageBookmark],
      // 从此消息处创建时间线分支
      ['[data-fork-timeline]', 'forkTimeline', forkTimelineAt],
      // 朗读是本地播放操作：不占 actionPending、不阻断流式生成
      ['[data-speak-message]', 'speakMessage', (id) => onSpeakMessage(findMessage(id))]
    ];
    for (const [selector, datasetKey, handler] of routes) {
      const control = event.target?.closest?.(selector);
      if (!control) continue;
      void handler(control.dataset[datasetKey]);
      return;
    }
  }

  function submitCustomAction(control) {
    if (isBusy()) {
      reportBusy();
      return false;
    }
    const row = control?.closest?.('[data-custom-action-row]');
    const input = row?.querySelector?.('[data-custom-action-input]');
    const text = String(input?.value || '').trim();
    if (!text) {
      setStatus(els.sessionStatus, '请先写下你自己的回答或行动', 'error');
      input?.focus?.();
      return false;
    }
    onRecommendedAction(text, row || control, {
      source: 'custom-input',
      preserveText: true
    });
    return true;
  }

  function handleMessageKeydown(event) {
    const input = event.target?.closest?.('[data-custom-action-input]');
    if (!input || event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault?.();
    submitCustomAction(input);
  }

  function bindEvents() {
    if (eventsBound) return;
    eventsBound = true;
    els.messages?.addEventListener('click', handleMessageClick);
    els.messages?.addEventListener('keydown', handleMessageKeydown);
    syncActionState();
  }

  return {
    bindEvents,
    editMessage,
    findMessage,
    forkTimelineAt,
    handleMessageClick,
    handleMessageKeydown,
    isBusy,
    regenerateMessage,
    switchMessageSwipe,
    syncActionState,
    submitCustomAction,
    toggleMessageBookmark,
    toggleMessageVisibility
  };
}

// 朗读路由处理（导出便于测试）：按 ID 查找消息并回调，busy 态不阻断本地播放
export function resolveSpeakAction({ findMessage, onSpeakMessage }) {
  return (messageId) => {
    const message = findMessage(messageId);
    if (message) onSpeakMessage(message);
  };
}
