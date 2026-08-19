import {
  expandLightFrontendQuickReply,
  getLightFrontendQuickReplies
} from './lightFrontend.js';

const RECOMMENDED_ACTION_SELECTOR = [
  '.recommendation-button',
  '.recommendation-custom-input',
  '.recommendation-custom-submit',
  '.immersive-option-item[data-immersive-option-action]'
].join(', ');

export function buildRecommendedActionFallback(action) {
  const text = String(action || '').trim().replace(/[。！？!?]+$/, '');
  if (!text) return '';
  if (/^(?:我|吾|在下|本官|朕|臣|贫道|贫僧)/.test(text)) return `${text}。`;
  return `我${text}。`;
}

export function decodeImmersiveAction(value, documentObject = globalThis.document) {
  let decoded = String(value || '');
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // Keep malformed imported escapes intact and still decode safe HTML entities.
  }
  const textarea = documentObject?.createElement?.('textarea');
  if (!textarea) return decoded.trim();
  textarea.innerHTML = decoded;
  return String(textarea.value || '').trim();
}

export function isSilentQuickReply(reply = {}) {
  if (reply.showInChat === false || reply.hiddenFromChat === true) return true;
  const label = String(reply.label || '').trim();
  const content = String(reply.content || '').trim();
  return /^继续推进(?:剧情)?$/u.test(label)
    || /^[（(]?\s*请继续推进剧情\s*[）)]?[。.]?$/u.test(content);
}

export function buildLightFrontendContext(state = {}) {
  const memory = state.session?.memory || {};
  const worldState = memory.worldState || {};
  return {
    user: state.config?.persona?.name || '我',
    char: state.config?.characterCard?.name || '',
    scene: memory.narrativeState?.activeArc || worldState.activeArc || '',
    location: worldState.location?.current || worldState.location || '',
    time: worldState.time || worldState.date || '',
    persona: state.config?.persona || {},
    character: state.config?.characterCard || {},
    mvu: memory.lightFrontendState || state.config?.lightFrontend?.mvu || {}
  };
}

export function createConversationActionsController({
  state = {},
  els = {},
  apiRequest = async () => ({}),
  getSessionId = () => 'main',
  replaceSession = () => state.session,
  refreshInspector = () => {},
  refreshImmersiveSidebar = () => {},
  setComposerInputValue = () => {},
  syncComposerState = () => {},
  syncMessageActionState = () => {},
  sendMessage = async () => {},
  setStatus = () => {},
  humanizeApiError = (error) => error?.message || String(error),
  documentObject = globalThis.document,
  getImportedQuickReplies = getLightFrontendQuickReplies,
  expandImportedQuickReply = expandLightFrontendQuickReply
} = {}) {
  let eventsBound = false;

  function isConversationBusy() {
    return Boolean(state.chatStreaming || state.conversationActionPending);
  }

  function reportBusy() {
    setStatus(
      els.sessionStatus,
      state.chatStreaming ? '旁白仍在生成，请等待本轮完成' : '上一项对话行动仍在处理中，请稍候',
      'busy'
    );
  }

  function syncActionButtons() {
    const mutationBusy = isConversationBusy();
    els.messages?.querySelectorAll?.(RECOMMENDED_ACTION_SELECTOR).forEach((button) => {
      button.disabled = mutationBusy;
      if (mutationBusy) button.setAttribute?.('aria-busy', 'true');
      else button.removeAttribute?.('aria-busy');
    });
    els.quickRepliesBar?.querySelectorAll?.('.quick-reply-chip').forEach((button) => {
      const stateAction = button.dataset?.conversationMutation === 'true';
      const busy = Boolean(state.conversationActionPending || (stateAction && state.chatStreaming));
      button.disabled = busy;
      if (busy) button.setAttribute?.('aria-busy', 'true');
      else button.removeAttribute?.('aria-busy');
    });
    return mutationBusy;
  }

  function syncActionState() {
    syncComposerState();
    syncMessageActionState();
    return syncActionButtons();
  }

  function setActionPending(pending) {
    state.conversationActionPending = Boolean(pending);
    syncActionState();
  }

  function getLightFrontendContext() {
    return buildLightFrontendContext(state);
  }

  function setChatInputFromQuickReply(reply = {}) {
    const content = String(reply.content || '').trim();
    if (!content) return false;
    setComposerInputValue(content, {
      pendingQuickReply: {
        content,
        hiddenFromChat: isSilentQuickReply(reply)
      }
    });
    return true;
  }

  async function applyQuickReplyStateAction(reply = {}) {
    if (isConversationBusy()) {
      reportBusy();
      return null;
    }
    setActionPending(true);
    try {
      const payload = await apiRequest(
        `/api/sessions/${encodeURIComponent(getSessionId())}/light-frontend/mvu`,
        { method: 'PATCH', body: { patch: reply.patch } }
      );
      replaceSession(payload.session, { fallback: state.session });
      refreshInspector();
      refreshImmersiveSidebar();
      setStatus(els.sessionStatus, `${reply.label || '状态动作'}已应用`, 'ok');
      return payload;
    } catch (error) {
      setStatus(els.sessionStatus, `状态动作失败：${humanizeApiError(error)}`, 'error');
      return null;
    } finally {
      setActionPending(false);
    }
  }

  function renderQuickRepliesBar() {
    if (!els.quickRepliesBar) return;
    const replies = Array.isArray(state.config?.quickReplies) ? state.config.quickReplies : [];
    const active = replies.filter((reply) => reply.enabled !== false && reply.content);
    const importedResult = getImportedQuickReplies(state.config?.lightFrontend);
    const imported = Array.isArray(importedResult) ? importedResult : [];
    els.quickRepliesBar.innerHTML = '';
    if (!active.length && !imported.length) return;

    for (const reply of [...active, ...imported]) {
      const button = documentObject.createElement('button');
      button.type = 'button';
      button.className = `quick-reply-chip${reply.source ? ' is-imported' : ''}`;
      const content = reply.source
        ? expandImportedQuickReply(reply, getLightFrontendContext())
        : reply.content;
      button.textContent = reply.label || content.slice(0, 12);
      const isStateAction = reply.actionType === 'mvu-patch';
      button.dataset.conversationMutation = String(isStateAction);
      button.title = isStateAction
        ? '来自社区轻前端：点击后执行经过白名单校验的状态更新'
        : reply.source ? `${content}\n来自社区轻前端，点击后仍可编辑` : content;
      button.addEventListener('click', () => {
        if (isStateAction) {
          void applyQuickReplyStateAction(reply);
          return;
        }
        if (state.conversationActionPending) {
          reportBusy();
          return;
        }
        setChatInputFromQuickReply({ ...reply, content });
      });
      els.quickRepliesBar.append(button);
    }
    syncActionButtons();
  }

  function createQuickReplyRow(reply, index) {
    const row = documentObject.createElement('div');
    row.className = 'quick-reply-row';

    const enabled = documentObject.createElement('input');
    enabled.type = 'checkbox';
    enabled.checked = reply.enabled !== false;
    enabled.dataset.qrField = 'enabled';
    enabled.dataset.qrIndex = index;

    const label = documentObject.createElement('input');
    label.type = 'text';
    label.className = 'form-input';
    label.value = reply.label || '';
    label.placeholder = '按钮名称';
    label.dataset.qrField = 'label';
    label.dataset.qrIndex = index;

    const content = documentObject.createElement('input');
    content.type = 'text';
    content.className = 'form-input';
    content.value = reply.content || '';
    content.placeholder = '发送内容';
    content.dataset.qrField = 'content';
    content.dataset.qrIndex = index;

    const remove = documentObject.createElement('button');
    remove.type = 'button';
    remove.className = 'ghost-button compact';
    remove.textContent = '删除';
    remove.dataset.qrField = 'delete';
    remove.dataset.qrIndex = index;

    row.append(enabled, label, content, remove);
    return row;
  }

  function renderQuickRepliesEditor() {
    if (!els.quickRepliesEditor) return;
    const replies = Array.isArray(state.config?.quickReplies) ? state.config.quickReplies : [];
    els.quickRepliesEditor.innerHTML = '';
    replies.forEach((reply, index) => {
      els.quickRepliesEditor.append(createQuickReplyRow(reply, index));
    });
  }

  function collectQuickRepliesFromEditor() {
    const rows = els.quickRepliesEditor?.querySelectorAll?.('.quick-reply-row') || [];
    return Array.from(rows, (row) => ({
      label: row.querySelector('[data-qr-field="label"]')?.value?.trim() || '',
      content: row.querySelector('[data-qr-field="content"]')?.value?.trim() || '',
      enabled: row.querySelector('[data-qr-field="enabled"]')?.checked ?? true
    }));
  }

  function addQuickReplyRow() {
    const replies = collectQuickRepliesFromEditor();
    replies.push({ label: '', content: '', enabled: true });
    state.config ||= {};
    state.config.quickReplies = replies;
    renderQuickRepliesEditor();
  }

  async function saveQuickReplies() {
    const quickReplies = collectQuickRepliesFromEditor().filter((reply) => reply.content);
    try {
      const payload = await apiRequest('/api/quick-replies', {
        method: 'PUT',
        body: { quickReplies }
      });
      state.config ||= {};
      state.config.quickReplies = payload.quickReplies;
      renderQuickReplies();
      setStatus(els.quickRepliesStatus, '已保存', 'ok');
      return payload;
    } catch (error) {
      setStatus(els.quickRepliesStatus, humanizeApiError(error), 'error');
      return null;
    }
  }

  function renderQuickReplies() {
    renderQuickRepliesBar();
    renderQuickRepliesEditor();
  }

  async function useRecommendedAction(action, trigger, options = {}) {
    const text = String(action || '').trim();
    if (!text) return false;
    if (isConversationBusy()) {
      reportBusy();
      return false;
    }

    setActionPending(true);
    trigger?.classList.add('is-expanding');
    trigger?.setAttribute('aria-busy', 'true');
    const preserveText = options?.preserveText === true;
    setStatus(
      els.sessionStatus,
      preserveText ? '正在发送你的自定义行动...' : '正在结合主角与当前场景组织行动...',
      'busy'
    );

    let expandedAction = preserveText ? text : buildRecommendedActionFallback(text);
    if (!preserveText) {
      try {
        const payload = await apiRequest('/api/rewrite', {
          method: 'POST',
          body: {
            sessionId: getSessionId(),
            target: 'recommended-action',
            text,
            instruction: '把选定意图写成当前主角在本场景中的完整行动。使用符合角色卡的语气，可加入动作、观察和明确台词；不要新增结果，不要替 NPC 回答。'
          }
        });
        expandedAction = String(payload.text || '').trim() || expandedAction;
      } catch (error) {
        setStatus(
          els.sessionStatus,
          `角色化改写不可用，已使用简洁行动：${humanizeApiError(error)}`,
          'busy'
        );
      }
    }

    setComposerInputValue(expandedAction);
    try {
      await sendMessage();
      return true;
    } finally {
      setActionPending(false);
      trigger?.classList.remove('is-expanding');
      trigger?.removeAttribute('aria-busy');
    }
  }

  async function rewriteChatInput() {
    const text = String(els.chatInput?.value || '').trim();
    if (!text) {
      setStatus(els.sessionStatus, '先输入要润色的内容', 'error');
      els.chatInput?.focus?.();
      return null;
    }
    if (isConversationBusy()) {
      reportBusy();
      return null;
    }

    setActionPending(true);
    setStatus(els.sessionStatus, '正在润色输入...', 'busy');
    try {
      const payload = await apiRequest('/api/rewrite', {
        method: 'POST',
        body: {
          sessionId: getSessionId(),
          target: 'chat-input',
          text,
          instruction: '更适合沉浸式角色扮演，保留用户意图，不替用户做新的核心决定。'
        }
      });
      setComposerInputValue(payload.text || text, { focus: false });
      setStatus(els.sessionStatus, '输入已润色，可直接发送或继续修改', 'ok');
      return payload;
    } catch (error) {
      setStatus(els.sessionStatus, `润色失败：${humanizeApiError(error)}`, 'error');
      return null;
    } finally {
      setActionPending(false);
      els.chatInput?.focus?.();
    }
  }

  function handleQuickReplyEditorClick(event) {
    const remove = event.target?.closest?.('[data-qr-field="delete"]');
    if (!remove) return;
    const index = Number(remove.dataset.qrIndex);
    if (!Number.isInteger(index)) return;
    const replies = collectQuickRepliesFromEditor();
    replies.splice(index, 1);
    state.config ||= {};
    state.config.quickReplies = replies;
    renderQuickRepliesEditor();
  }

  function bindEvents() {
    if (eventsBound) return;
    eventsBound = true;
    els.addQuickReply?.addEventListener('click', addQuickReplyRow);
    els.saveQuickReplies?.addEventListener('click', () => { void saveQuickReplies(); });
    els.quickRepliesEditor?.addEventListener('click', handleQuickReplyEditorClick);
    syncActionState();
  }

  return {
    addQuickReplyRow,
    applyQuickReplyStateAction,
    bindEvents,
    collectQuickRepliesFromEditor,
    createQuickReplyRow,
    decodeImmersiveAction: (value) => decodeImmersiveAction(value, documentObject),
    getLightFrontendContext,
    isConversationBusy,
    renderQuickReplies,
    renderQuickRepliesBar,
    renderQuickRepliesEditor,
    rewriteChatInput,
    saveQuickReplies,
    setChatInputFromQuickReply,
    syncActionState,
    useRecommendedAction
  };
}
