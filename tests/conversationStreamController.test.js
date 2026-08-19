import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createConversationStreamController,
  originalOpeningStatus,
  parseSseEvent,
  readSseResponse
} from '../public/modules/conversationStream.js';

class FakeClassList {
  constructor(element) {
    this.element = element;
    this.values = new Set();
  }

  setFromClassName(value) {
    this.values = new Set(String(value || '').split(/\s+/).filter(Boolean));
  }

  syncClassName() {
    this.element._className = [...this.values].join(' ');
  }

  add(...values) {
    values.forEach((value) => this.values.add(value));
    this.syncClassName();
  }

  remove(...values) {
    values.forEach((value) => this.values.delete(value));
    this.syncClassName();
  }

  contains(value) {
    return this.values.has(value);
  }
}

function descendantsOf(element) {
  return element.children.flatMap((child) => [child, ...descendantsOf(child)]);
}

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.classList = new FakeClassList(this);
    this._className = '';
    this.value = '';
    this.textContent = '';
    this.innerHTML = '';
    this.hidden = false;
    this.disabled = false;
    this.dataset = {};
    this.attributes = new Map();
    this.focusCount = 0;
  }

  set className(value) {
    this._className = String(value || '');
    this.classList.setFromClassName(this._className);
  }

  get className() {
    return this._className;
  }

  append(...nodes) {
    nodes.forEach((node) => {
      node.parentElement = this;
      this.children.push(node);
    });
  }

  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }

  querySelector(selector) {
    if (!selector.startsWith('.')) return null;
    const className = selector.slice(1);
    return descendantsOf(this).find((element) => element.classList.contains(className)) || null;
  }

  querySelectorAll(selector) {
    const classNames = selector.split(',').map((part) => part.trim().replace(/^\./, ''));
    return descendantsOf(this).filter((element) => (
      classNames.some((className) => element.classList.contains(className))
    ));
  }

  focus() {
    this.focusCount += 1;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
}

function createSseResponse(events, { status = 200, statusText = 'OK' } = {}) {
  const encoder = new TextEncoder();
  const chunks = Array.isArray(events) ? events : [events];
  const body = new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    }
  });
  return new Response(body, {
    status,
    statusText,
    headers: { 'content-type': 'text/event-stream' }
  });
}

function createHarness({
  fetchImpl,
  sessionMessages = [],
  pendingJourneyDraft = null,
  pendingQuickReply = null
} = {}) {
  const messages = new FakeElement('section');
  messages.classList.add('has-cover-page', 'has-journey-draft');
  const emptyState = new FakeElement();
  emptyState.className = 'empty-state';
  const cover = new FakeElement();
  cover.className = 'epic-cover-page';
  messages.append(emptyState, cover);

  const state = {
    chatStreaming: false,
    openingError: '',
    pendingJourneyDraft,
    pendingQuickReply,
    targetSpeaker: '沈观澜',
    session: {
      id: 'story/session',
      messages: sessionMessages,
      memory: { rollingSummary: '旧摘要' }
    }
  };
  const els = {
    appStatus: { name: 'app' },
    sessionStatus: { name: 'session' },
    chatInput: new FakeElement('textarea'),
    memoryView: new FakeElement('pre'),
    messages
  };
  const statuses = [];
  const streamingChanges = [];
  const requests = [];
  const restoredInputs = [];
  const replacedSessions = [];
  let renderCount = 0;
  let inspectorCount = 0;
  let targetRenderCount = 0;
  let captureCount = 0;
  let restoreCount = 0;

  const controller = createConversationStreamController({
    state,
    els,
    fetchImpl: async (...args) => {
      requests.push(args);
      return fetchImpl(...args);
    },
    getSessionId: () => state.session.id,
    replaceSession: (session, options) => {
      replacedSessions.push({ session, options });
      state.session = session;
      return session;
    },
    renderMessages: () => { renderCount += 1; },
    refreshInspector: () => { inspectorCount += 1; },
    setStreamingState: (streaming, message, phase) => {
      state.chatStreaming = Boolean(streaming);
      streamingChanges.push({
        streaming: Boolean(streaming),
        message,
        ...(phase ? { phase } : {})
      });
    },
    clearComposerInput: () => { els.chatInput.value = ''; },
    setComposerInputValue: (value, options) => {
      els.chatInput.value = value;
      state.pendingQuickReply = options?.pendingQuickReply || null;
      restoredInputs.push({ value, options });
    },
    renderTargetSpeakerIndicator: () => { targetRenderCount += 1; },
    captureScrollState: () => {
      captureCount += 1;
      return { followLatest: true };
    },
    restoreScrollState: () => { restoreCount += 1; },
    serializeValue: (value) => `memory:${value.rollingSummary}`,
    setStatus: (element, message, tone) => statuses.push({ element: element.name, message, tone }),
    humanizeApiError: (error) => error.message,
    documentObject: { createElement: (tagName) => new FakeElement(tagName) }
  });

  return {
    controller,
    els,
    requests,
    replacedSessions,
    restoredInputs,
    state,
    statuses,
    streamingChanges,
    counts: () => ({
      captureCount,
      inspectorCount,
      renderCount,
      restoreCount,
      targetRenderCount
    })
  };
}

test('SSE helpers parse CRLF, chunk boundaries and a trailing completion event', async () => {
  assert.deepEqual(parseSseEvent('event: token\r\ndata: {"content":"雨"}'), {
    event: 'token',
    data: { content: '雨' }
  });
  assert.equal(parseSseEvent('data: {}'), null);
  assert.deepEqual(parseSseEvent('event: done\ndata: not-json'), {
    event: 'done',
    data: undefined
  });
  assert.equal(originalOpeningStatus(null), '故事正在续写...');
  assert.equal(originalOpeningStatus({ title: '第一幕' }), '正在依据设定生成第一幕...');

  const tokens = [];
  const phases = [];
  const payload = await readSseResponse(createSseResponse([
    'event: token\r\ndata: {"content":"雨"}\r\n',
    '\r\nevent: token\ndata: {"content":"声"}\n\n',
    'event: phase\ndata: {"phase":"finalizing"}\n\n',
    'event: done\ndata: {"session":{"id":"main"}}'
  ]), {
    onToken: async (token) => tokens.push(token),
    onPhase: async (phase) => phases.push(phase)
  });

  assert.deepEqual(tokens, ['雨', '声']);
  assert.deepEqual(phases, ['finalizing']);
  assert.deepEqual(payload, { session: { id: 'main' } });
});

test('SSE reader preserves protocol and HTTP errors and rejects missing completion', async () => {
  await assert.rejects(
    readSseResponse(createSseResponse('event: error\ndata: {"error":"NO_ACTIVE_PROVIDER"}\n\n')),
    (error) => error.code === 'NO_ACTIVE_PROVIDER'
  );
  await assert.rejects(
    readSseResponse(createSseResponse('event: token\ndata: {"content":"半句"}\n\n')),
    /流式响应缺少完成事件/
  );

  const httpResponse = new Response(JSON.stringify({
    error: 'PROVIDER_ERROR',
    detail: '模型不可用'
  }), {
    status: 502,
    statusText: 'Bad Gateway',
    headers: { 'content-type': 'application/json' }
  });
  await assert.rejects(
    readSseResponse(httpResponse),
    (error) => error.code === 'PROVIDER_ERROR' && error.status === 502 && error.message === '模型不可用'
  );

  let cancelCount = 0;
  const errorChunk = new TextEncoder().encode(
    'event: error\ndata: {"error":"BROKEN_STREAM"}\n\n'
  );
  const cancellableResponse = {
    ok: true,
    body: {
      getReader: () => ({
        read: async () => ({ value: errorChunk, done: false }),
        cancel: async () => { cancelCount += 1; }
      })
    }
  };
  await assert.rejects(
    readSseResponse(cancellableResponse),
    (error) => error.code === 'BROKEN_STREAM'
  );
  assert.equal(cancelCount, 1);
});

test('send lifecycle streams a preview, applies the session and synchronizes composer state', async () => {
  const newSession = {
    id: 'story/session',
    messages: [
      { role: 'user', content: '推门' },
      { role: 'assistant', content: '雨声渐近。' }
    ],
    memory: { rollingSummary: '新摘要' }
  };
  const harness = createHarness({
    pendingJourneyDraft: { title: '第一幕' },
    pendingQuickReply: { content: '推门', hiddenFromChat: true },
    fetchImpl: async () => createSseResponse([
      'event: token\ndata: {"content":"雨声"}\n\n',
      'event: phase\ndata: {"phase":"finalizing"}\n\n',
      `event: done\ndata: ${JSON.stringify({ session: newSession })}\n\n`
    ])
  });
  harness.els.chatInput.value = '  推门  ';

  const payload = await harness.controller.sendMessage();

  assert.deepEqual(payload, { session: newSession });
  assert.equal(harness.requests.length, 1);
  assert.equal(harness.requests[0][0], '/api/chat/stream');
  assert.deepEqual(JSON.parse(harness.requests[0][1].body), {
    sessionId: 'story/session',
    content: '推门',
    targetSpeaker: '沈观澜',
    hideUserMessage: true
  });
  assert.deepEqual(harness.state.session, newSession);
  assert.equal(harness.state.pendingJourneyDraft, null);
  assert.equal(harness.state.targetSpeaker, '');
  assert.equal(harness.els.chatInput.value, '');
  assert.equal(harness.els.chatInput.focusCount, 1);
  assert.equal(harness.els.memoryView.textContent, 'memory:新摘要');
  assert.equal(harness.els.messages.children[0].hidden, true);
  assert.match(harness.els.messages.children[1].querySelector('.message-content').innerHTML, /雨声/);
  assert.deepEqual(harness.streamingChanges, [
    { streaming: true, message: '正在依据设定生成第一幕...' },
    { streaming: true, message: '正文已生成，正在同步世界状态与记忆…', phase: 'finalizing' },
    { streaming: false, message: undefined }
  ]);
  assert.deepEqual(harness.counts(), {
    captureCount: 2,
    inspectorCount: 0,
    renderCount: 1,
    restoreCount: 2,
    targetRenderCount: 1
  });
});

test('stream preview replaces community choice prose with one disabled native action panel', () => {
  const harness = createHarness({ fetchImpl: async () => { throw new Error('unused'); } });
  const preview = harness.controller.appendStreamingPreview('我压住气息。');

  harness.controller.updateStreamingPreview(preview, `夜深人静，神识正在靠近。\n\n> [天机选项：异状尚未收束]\n- 立刻躺回木板，假装熟睡。\n- 推开后窗，藏进灵田阴影。\n- 不躲不藏，径直开门。\n- 自定义`);

  assert.doesNotMatch(preview.contentNode.innerHTML, /天机选项|立刻躺回/u);
  const panel = preview.node.querySelector('.recommended-actions');
  assert.ok(panel);
  assert.equal(panel.dataset.actionSource, 'community-choice-block');
  assert.deepEqual(
    panel.querySelectorAll('.recommendation-button').map((button) => button.dataset.recommendedAction),
    ['立刻躺回木板，假装熟睡。', '推开后窗，藏进灵田阴影。', '不躲不藏，径直开门。']
  );
  assert.equal(panel.querySelector('.recommendation-custom-input').disabled, true);
  assert.equal(panel.querySelector('.recommendation-custom-submit').disabled, true);
});

test('preview setup failures restore the draft and input instead of leaving streaming stuck', async () => {
  const draft = { title: '第一幕' };
  const quickReply = { content: '推门', hiddenFromChat: true };
  const harness = createHarness({
    pendingJourneyDraft: draft,
    pendingQuickReply: quickReply,
    fetchImpl: async () => {
      throw new Error('fetch should not run');
    }
  });
  harness.els.chatInput.value = '推门';
  harness.els.messages.querySelectorAll = () => {
    throw new Error('preview DOM failed');
  };

  const payload = await harness.controller.sendMessage();

  assert.equal(payload, null);
  assert.equal(harness.requests.length, 0);
  assert.equal(harness.state.chatStreaming, false);
  assert.equal(harness.state.pendingJourneyDraft, draft);
  assert.equal(harness.els.chatInput.value, '推门');
  assert.deepEqual(harness.restoredInputs, [{
    value: '推门',
    options: { pendingQuickReply: quickReply }
  }]);
  assert.equal(harness.state.openingError, '第一幕生成失败：preview DOM failed');
  assert.deepEqual(harness.statuses.at(-1), {
    element: 'session',
    message: '发送失败：preview DOM failed',
    tone: 'error'
  });
  assert.deepEqual(harness.streamingChanges.map(({ streaming }) => streaming), [true, false]);
});

test('a second send is rejected while the first stream keeps the next draft intact', async () => {
  let resolveFetch;
  const responsePromise = new Promise((resolve) => {
    resolveFetch = resolve;
  });
  const harness = createHarness({
    fetchImpl: async () => responsePromise
  });
  harness.els.chatInput.value = '第一步';

  const firstSend = harness.controller.sendMessage();
  harness.els.chatInput.value = '第二步草稿';
  const secondSend = await harness.controller.sendMessage();

  assert.equal(secondSend, null);
  assert.equal(harness.requests.length, 1);
  assert.equal(harness.els.chatInput.value, '第二步草稿');
  assert.deepEqual(harness.statuses.at(-1), {
    element: 'session',
    message: '旁白仍在生成，可先继续起草下一步',
    tone: 'busy'
  });

  resolveFetch(createSseResponse(
    'event: done\ndata: {"session":{"id":"story/session","messages":[],"memory":{}}}\n\n'
  ));
  await firstSend;
  assert.equal(harness.els.chatInput.value, '第二步草稿');
  assert.equal(harness.state.chatStreaming, false);
});

test('stopGeneration returns false when no stream is active', () => {
  const harness = createHarness({ fetchImpl: async () => { throw new Error('unused'); } });
  assert.equal(harness.controller.stopGeneration(), false);
});

test('stopGeneration aborts the in-flight request and the abort signal reaches fetch', async () => {
  let observedSignal = null;
  let abortListener = null;
  const harness = createHarness({
    fetchImpl: async (path, options = {}) => {
      observedSignal = options.signal || null;
      abortListener = new Promise((resolve) => {
        observedSignal?.addEventListener('abort', () => resolve(observedSignal.reason || 'aborted'));
      });
      // 挂起直到 abort 触发
      return abortListener.then(() => {
        const abortError = new Error('The operation was aborted');
        abortError.name = 'AbortError';
        throw abortError;
      });
    }
  });
  harness.els.chatInput.value = '夜探沈府。';

  const sendPromise = harness.controller.sendMessage();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(observedSignal instanceof AbortSignal, 'fetch 应收到 abort signal');

  assert.equal(harness.controller.stopGeneration(), true);
  const payload = await sendPromise;

  assert.equal(payload, null);
  assert.equal(harness.state.chatStreaming, false);
  assert.deepEqual(harness.statuses.at(-1), {
    element: 'session',
    message: '已停止生成',
    tone: 'busy'
  });
  // 输入草稿在停止后不清空（与失败恢复语义一致）
  await new Promise((resolve) => setTimeout(resolve, 0));
});

test('an aborted SSE error with partialMessageId refreshes the session and keeps the partial turn', async () => {
  const partialSession = {
    id: 'story/session',
    messages: [
      { role: 'user', content: '夜探沈府。' },
      { role: 'assistant', content: '夜色沉沉，更夫的梆子声由远及近', aborted: true }
    ],
    memory: { rollingSummary: '新摘要' }
  };
  const fetchCalls = [];
  const harness = createHarness({
    fetchImpl: async (path, options = {}) => {
      fetchCalls.push({ path, method: options.method || 'POST' });
      if (String(path).startsWith('/api/sessions/')) {
        return new Response(JSON.stringify({ session: partialSession }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      return createSseResponse([
        'event: token\ndata: {"content":"夜色沉沉"}\n\n',
        'event: error\ndata: {"error":"GENERATION_ABORTED","aborted":true,"partialMessageId":"assistant-123"}\n\n'
      ]);
    }
  });
  harness.els.chatInput.value = '夜探沈府。';

  const payload = await harness.controller.sendMessage();

  assert.equal(payload, null);
  // SSE 失败后追加了会话刷新请求
  const refreshCall = fetchCalls.find((call) => call.path.startsWith('/api/sessions/'));
  assert.ok(refreshCall, '应请求刷新会话以取回 partial 回合');
  assert.equal(refreshCall.method, 'GET');
  // 会话被替换为含 aborted 消息的服务端版本
  assert.deepEqual(harness.state.session.messages.at(-1), {
    role: 'assistant',
    content: '夜色沉沉，更夫的梆子声由远及近',
    aborted: true
  });
  assert.deepEqual(harness.statuses.at(-1), {
    element: 'session',
    message: '已停止生成，已保留未完成的正文',
    tone: 'busy'
  });
  assert.equal(harness.state.chatStreaming, false);
});

test('a generic SSE abort without retained partial keeps the stop-only status', async () => {
  const harness = createHarness({
    fetchImpl: async () => createSseResponse([
      'event: error\ndata: {"error":"GENERATION_ABORTED"}\n\n'
    ])
  });
  harness.els.chatInput.value = '夜探沈府。';

  const payload = await harness.controller.sendMessage();

  assert.equal(payload, null);
  assert.deepEqual(harness.statuses.at(-1), {
    element: 'session',
    message: '已停止生成',
    tone: 'busy'
  });
});

test('a completed stream from a previous session cannot overwrite the newly selected story', async () => {
  let resolveFetch;
  const responsePromise = new Promise((resolve) => {
    resolveFetch = resolve;
  });
  const harness = createHarness({ fetchImpl: async () => responsePromise });
  harness.els.chatInput.value = '第一部剧本的行动';

  const pending = harness.controller.sendMessage();
  harness.state.session = {
    id: 'story/other',
    messages: [{ role: 'assistant', content: '第二部剧本的内容' }],
    memory: { rollingSummary: '第二部摘要' }
  };
  harness.state.chatStreaming = true;

  resolveFetch(createSseResponse(
    'event: done\ndata: {"session":{"id":"story/session","messages":[],"memory":{}}}\n\n'
  ));
  await pending;

  assert.equal(harness.state.session.id, 'story/other');
  assert.equal(harness.replacedSessions.length, 0);
  assert.equal(harness.counts().renderCount, 0);
  assert.equal(harness.state.chatStreaming, true);
});

test('continue validates concurrency and last-message role before streaming', async () => {
  const harness = createHarness({
    sessionMessages: [{ role: 'user', content: '推门' }],
    fetchImpl: async () => {
      throw new Error('fetch should not run');
    }
  });

  await harness.controller.continueLastMessage();
  assert.equal(harness.requests.length, 0);
  assert.deepEqual(harness.statuses.at(-1), {
    element: 'session',
    message: '最后一条消息不是旁白回复',
    tone: 'error'
  });

  harness.state.chatStreaming = true;
  await harness.controller.continueLastMessage();
  assert.equal(harness.requests.length, 0);
  assert.deepEqual(harness.statuses.at(-1), {
    element: 'session',
    message: '旁白仍在生成，可先继续起草下一步',
    tone: 'busy'
  });
});

test('continue uses the shared SSE transport and refreshes inspector-owned state', async () => {
  const newSession = {
    id: 'story/session',
    messages: [{ role: 'assistant', content: '续写完成。' }],
    memory: {}
  };
  const harness = createHarness({
    sessionMessages: [{ role: 'assistant', content: '上一段。' }],
    fetchImpl: async () => createSseResponse(
      `event: done\ndata: ${JSON.stringify({ session: newSession })}\n\n`
    )
  });

  await harness.controller.continueLastMessage();

  assert.equal(harness.requests[0][0], '/api/chat/continue');
  assert.deepEqual(JSON.parse(harness.requests[0][1].body), {
    sessionId: 'story/session'
  });
  assert.equal(harness.els.messages.children[0].hidden, true);
  assert.deepEqual(harness.counts(), {
    captureCount: 1,
    inspectorCount: 1,
    renderCount: 1,
    restoreCount: 1,
    targetRenderCount: 0
  });
  assert.deepEqual(harness.streamingChanges.map(({ streaming }) => streaming), [true, false]);
});
