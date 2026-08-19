import { getEnabledGroupMemberNames } from './groupMembers.js';
import { createComposerActionMenusController } from './composerActionMenus.js';

export function shouldSubmitChatInput(event = {}) {
  return event.key === 'Enter'
    && !event.shiftKey
    && !event.isComposing
    && event.keyCode !== 229;
}

export function getComposerAvailability({
  inputValue = '',
  messages = [],
  streaming = false,
  actionPending = false,
  targetCandidates = [],
  targetSpeaker = ''
} = {}) {
  const hasInput = Boolean(String(inputValue || '').trim());
  const lastMessage = Array.isArray(messages) ? messages[messages.length - 1] : null;
  const hasAssistantReply = lastMessage?.role === 'assistant';
  const busy = Boolean(streaming || actionPending);

  return {
    actionPending: Boolean(actionPending),
    busy,
    canSend: hasInput && !busy,
    canRewrite: hasInput && !busy,
    canContinue: hasAssistantReply && !busy,
    canRepairFormat: hasAssistantReply && !busy,
    canTargetSpeaker: (Boolean(targetSpeaker) || targetCandidates.length > 0) && !actionPending,
    hasAssistantReply,
    hasInput,
    streaming
  };
}

export function createComposerController({
  state = {},
  els = {},
  onSend = () => {},
  onContinue = () => {},
  onRewrite = () => {},
  onStopGeneration = () => {},
  onVoiceDictation = () => {},
  onToggleAuthorNote = () => {},
  onToggleBackground = () => {},
  onOpenTab = () => {},
  onScrollLatest = () => {},
  onStreamingChange = () => {},
  setStatus = () => {},
  documentObject = globalThis.document,
  windowObject = globalThis.window
} = {}) {
  let eventsBound = false;
  const sessionDrafts = new Map();
  const actionMenus = createComposerActionMenusController({
    root: els.stageActions,
    documentObject,
    windowObject
  });

  function getTargetSpeakerCandidates() {
    const mainName = String(state.config?.characterCard?.name || '').trim();
    return [...new Set([
      mainName,
      ...getEnabledGroupMemberNames(state.config?.groupMembers)
    ].filter(Boolean))];
  }

  function getAvailability() {
    return getComposerAvailability({
      inputValue: els.chatInput?.value,
      messages: state.session?.messages,
      streaming: Boolean(state.chatStreaming),
      actionPending: Boolean(state.conversationActionPending),
      targetCandidates: getTargetSpeakerCandidates(),
      targetSpeaker: state.targetSpeaker
    });
  }

  function resizeInput() {
    if (!els.chatInput) return;
    els.chatInput.style.height = 'auto';
    els.chatInput.style.height = `${Math.min(Number(els.chatInput.scrollHeight) || 0, 160)}px`;
  }

  function syncActionState() {
    const availability = getAvailability();
    const streamFinalizing = availability.streaming && state.chatStreamPhase === 'finalizing';
    const formatAction = els.stageActions?.querySelector?.('[data-action-template]');

    if (els.chatForm) {
      els.chatForm.classList.toggle('is-streaming', availability.streaming);
      els.chatForm.classList.toggle('is-action-pending', availability.actionPending);
      els.chatForm.setAttribute('aria-busy', String(availability.busy));
    }
    if (els.sendMessageButton) {
      els.sendMessageButton.disabled = !availability.canSend;
      els.sendMessageButton.title = availability.actionPending
        ? '上一项对话行动仍在处理中'
        : streamFinalizing
        ? '正文已生成，正在同步世界状态与记忆'
        : availability.streaming
        ? '旁白生成中，可先输入下一步'
        : (availability.hasInput ? '发送' : '请输入内容后发送');
    }
    // 停止按钮：仅流式生成期间可见，点击中止并保留已生成正文
    if (els.stopGeneration) {
      els.stopGeneration.hidden = !availability.streaming;
    }
    // 语音听写按钮：行动处理期间禁用（录音与流式可并存，转写结果落输入框）
    if (els.voiceDictation) {
      els.voiceDictation.disabled = availability.actionPending;
    }
    if (els.rewriteChatInput) {
      els.rewriteChatInput.disabled = !availability.canRewrite;
      els.rewriteChatInput.title = availability.actionPending
        ? '上一项对话行动仍在处理中'
        : availability.hasInput ? '润色当前输入' : '请先输入要润色的内容';
    }
    if (els.continueMessage) {
      els.continueMessage.disabled = !availability.canContinue;
      els.continueMessage.title = availability.hasAssistantReply ? '续写上一条旁白回复' : '需要先有一条旁白回复';
    }
    if (formatAction) {
      formatAction.disabled = !availability.canRepairFormat;
      formatAction.title = availability.hasAssistantReply ? '修复上一条旁白回复的格式' : '需要先有一条旁白回复';
    }
    if (els.targetSpeakerBtn) {
      els.targetSpeakerBtn.disabled = !availability.canTargetSpeaker;
      els.targetSpeakerBtn.title = availability.canTargetSpeaker ? '指定下一轮发言者' : '请先设置角色或群聊成员';
    }
    if (els.composerStatus) {
      els.composerStatus.hidden = !availability.busy;
      els.composerStatus.textContent = availability.actionPending
        ? '正在处理对话行动'
        : streamFinalizing ? '正文已生成 · 正在同步状态'
        : availability.streaming ? '旁白生成中 · 可继续起草' : '';
    }
    if (els.chatInput) {
      els.chatInput.disabled = availability.actionPending;
      els.chatInput.placeholder = availability.actionPending
        ? '正在处理当前行动...'
        : streamFinalizing
        ? '正文已生成，正在同步状态；可先写下一步...'
        : availability.streaming
        ? '旁白生成中，可先写下一步...'
        : '输入角色行动或旁白指令...';
    }
    if (els.refreshState) els.refreshState.disabled = availability.busy;

    return availability;
  }

  function handleInput() {
    const value = String(els.chatInput?.value || '').trim();
    if (state.pendingQuickReply?.content !== value) state.pendingQuickReply = null;
    resizeInput();
    syncActionState();
  }

  function setInputValue(value, { pendingQuickReply = null, focus = true } = {}) {
    if (!els.chatInput) return;
    els.chatInput.value = String(value ?? '');
    state.pendingQuickReply = pendingQuickReply;
    resizeInput();
    syncActionState();
    if (focus) els.chatInput.focus();
  }

  function insertText(value) {
    const text = String(value || '').trim();
    if (!text || !els.chatInput) return;
    const current = String(els.chatInput.value || '').trimEnd();
    setInputValue(current ? `${current}\n${text}` : text);
  }

  function clearInput({ focus = false } = {}) {
    setInputValue('', { focus });
  }

  function handleSessionChanged({ previousSessionId, nextSessionId } = {}) {
    const previousId = String(previousSessionId || '').trim();
    const nextId = String(nextSessionId || '').trim();
    if (!previousId || !nextId || previousId === nextId) return false;

    sessionDrafts.set(previousId, String(els.chatInput?.value || ''));
    if (els.chatInput) els.chatInput.value = sessionDrafts.get(nextId) || '';
    resizeInput();
    syncActionState();
    return true;
  }

  function renderTargetSpeakerIndicator() {
    if (!els.targetSpeakerBtn) return;
    if (state.targetSpeaker) {
      els.targetSpeakerBtn.textContent = `下轮：${state.targetSpeaker}`;
      els.targetSpeakerBtn.classList.add('active');
    } else {
      els.targetSpeakerBtn.textContent = '指定发言';
      els.targetSpeakerBtn.classList.remove('active');
    }
    syncActionState();
  }

  function reconcileTargetSpeaker() {
    const targetSpeaker = String(state.targetSpeaker || '').trim();
    if (targetSpeaker && !getTargetSpeakerCandidates().includes(targetSpeaker)) {
      state.targetSpeaker = '';
    }
    renderTargetSpeakerIndicator();
    return state.targetSpeaker;
  }

  function selectTargetSpeaker(name, dialog) {
    state.targetSpeaker = name;
    renderTargetSpeakerIndicator();
    setStatus(els.appStatus, `下轮发言：${name}`, 'ok');
    dialog?.close?.();
  }

  function pickTargetSpeaker() {
    const candidates = getTargetSpeakerCandidates();
    if (!candidates.length) {
      setStatus(els.appStatus, '请先在角色卡或群聊成员中设置角色', 'error');
      return;
    }
    if (state.targetSpeaker) {
      state.targetSpeaker = '';
      renderTargetSpeakerIndicator();
      setStatus(els.appStatus, '已清除指定发言', 'ok');
      return;
    }

    const dialog = documentObject?.querySelector?.('#speaker-picker-dialog');
    const list = documentObject?.querySelector?.('#speaker-picker-list');
    if (!dialog || !list) {
      const fallback = windowObject?.prompt?.('选择本轮发言者：', '');
      const name = String(fallback || '').trim();
      if (candidates.includes(name)) selectTargetSpeaker(name);
      return;
    }

    list.replaceChildren();
    candidates.forEach((name) => {
      const button = documentObject.createElement('button');
      button.type = 'button';
      button.className = 'ghost-button';
      button.dataset.speaker = name;
      button.style.textAlign = 'left';
      button.textContent = name;
      button.addEventListener('click', () => selectTargetSpeaker(name, dialog));
      list.append(button);
    });

    const autoButton = documentObject.querySelector('#speaker-picker-auto');
    const cancelButton = documentObject.querySelector('#speaker-picker-cancel');
    if (autoButton) {
      autoButton.onclick = () => {
        state.targetSpeaker = '';
        renderTargetSpeakerIndicator();
        dialog.close();
      };
    }
    if (cancelButton) cancelButton.onclick = () => dialog.close();
    dialog.showModal();
  }

  function setStreamingState(streaming, statusMessage, phase = '') {
    state.chatStreaming = Boolean(streaming);
    state.chatStreamPhase = state.chatStreaming ? String(phase || '') : '';
    syncActionState();
    onStreamingChange(state.chatStreaming);
    if (streaming && statusMessage) setStatus(els.sessionStatus, statusMessage, 'busy');
  }

  function bindEvents() {
    if (eventsBound) return;
    eventsBound = true;

    els.chatForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      if (getAvailability().canSend) void onSend();
    });
    els.chatInput?.addEventListener('keydown', (event) => {
      if (!shouldSubmitChatInput(event)) return;
      event.preventDefault();
      if (getAvailability().canSend) els.chatForm?.requestSubmit();
    });
    els.chatInput?.addEventListener('input', handleInput);
    els.rewriteChatInput?.addEventListener('click', () => {
      if (getAvailability().canRewrite) void onRewrite();
    });
    els.continueMessage?.addEventListener('click', () => {
      if (getAvailability().canContinue) void onContinue();
    });
    els.stopGeneration?.addEventListener('click', () => {
      onStopGeneration();
    });
    els.voiceDictation?.addEventListener('click', () => {
      onVoiceDictation();
    });
    els.toggleAuthorNote?.addEventListener('click', onToggleAuthorNote);
    els.toggleBackground?.addEventListener('click', onToggleBackground);
    els.targetSpeakerBtn?.addEventListener('click', pickTargetSpeaker);
    els.stageActions?.addEventListener('click', (event) => {
      const tabShortcut = event.target.closest('[data-tab-shortcut]');
      if (tabShortcut) {
        onOpenTab(tabShortcut.dataset.tabShortcut);
        return;
      }
      const actionTemplate = event.target.closest('[data-action-template]');
      if (actionTemplate && !actionTemplate.disabled) {
        const content = String(actionTemplate.dataset.actionTemplate || '').trim();
        if (content) {
          setInputValue(content, {
            pendingQuickReply: { content, hiddenFromChat: false }
          });
        }
        return;
      }
      if (event.target.closest('[data-scroll-bottom]')) onScrollLatest();
    });
    actionMenus.bindEvents();

    resizeInput();
    renderTargetSpeakerIndicator();
  }

  return {
    bindEvents,
    clearInput,
    getAvailability,
    getTargetSpeakerCandidates,
    handleInput,
    handleSessionChanged,
    insertText,
    pickTargetSpeaker,
    reconcileTargetSpeaker,
    renderTargetSpeakerIndicator,
    resizeInput,
    setInputValue,
    setStreamingState,
    syncActionState
  };
}
