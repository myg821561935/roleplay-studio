import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLightFrontendContext,
  buildRecommendedActionFallback,
  createConversationActionsController,
  decodeImmersiveAction,
  isSilentQuickReply
} from '../public/modules/conversationActions.js';

function dataAttributeToProperty(attribute) {
  return attribute.replace(/^data-/, '').replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

function matchesSelector(element, selector) {
  if (selector.startsWith('.')) {
    const className = selector.slice(1).split('[')[0];
    if (!String(element.className || '').split(/\s+/).includes(className)) return false;
    const dataSelector = selector.match(/(\[data-[^\]]+\])/u)?.[1];
    return dataSelector ? matchesSelector(element, dataSelector) : true;
  }
  if (selector.startsWith('[data-')) {
    const match = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/u);
    if (!match) return false;
    const property = dataAttributeToProperty(match[1]);
    if (!Object.hasOwn(element.dataset, property)) return false;
    return match[2] === undefined || String(element.dataset[property]) === match[2];
  }
  return element.tagName === selector.toUpperCase();
}

function descendantsOf(element) {
  return element.children.flatMap((child) => [child, ...descendantsOf(child)]);
}

class FakeClassList {
  constructor(owner) {
    this.owner = owner;
  }

  add(value) {
    const values = new Set(String(this.owner.className || '').split(/\s+/).filter(Boolean));
    values.add(value);
    this.owner.className = [...values].join(' ');
  }

  remove(value) {
    this.owner.className = String(this.owner.className || '')
      .split(/\s+/)
      .filter((item) => item && item !== value)
      .join(' ');
  }

  contains(value) {
    return String(this.owner.className || '').split(/\s+/).includes(value);
  }
}

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.listeners = new Map();
    this.attributes = new Map();
    this.className = '';
    this.classList = new FakeClassList(this);
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.textContent = '';
    this.title = '';
    this.focusCount = 0;
    this._innerHTML = '';
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    if (!value) this.children = [];
    if (this.tagName === 'TEXTAREA') {
      this.value = String(value)
        .replaceAll('&amp;', '&')
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&quot;', '"');
    }
  }

  get innerHTML() {
    return this._innerHTML;
  }

  append(...nodes) {
    nodes.forEach((node) => {
      node.parentElement = this;
      this.children.push(node);
    });
  }

  querySelector(selector) {
    return descendantsOf(this).find((element) => matchesSelector(element, selector)) || null;
  }

  querySelectorAll(selector) {
    const selectors = selector.split(',').map((part) => part.trim());
    return descendantsOf(this).filter((element) => selectors.some((part) => matchesSelector(element, part)));
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (matchesSelector(current, selector)) return current;
      current = current.parentElement;
    }
    return null;
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  async emit(type, target = this) {
    for (const handler of this.listeners.get(type) || []) {
      await handler({ target, currentTarget: this });
    }
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  focus() {
    this.focusCount += 1;
  }
}

function createHarness({
  apiRequest = async () => ({}),
  importedReplies = [],
  sendMessage = async () => {}
} = {}) {
  const documentObject = {
    createElement: (tagName) => new FakeElement(tagName)
  };
  const els = {
    addQuickReply: new FakeElement('button'),
    saveQuickReplies: new FakeElement('button'),
    quickRepliesBar: new FakeElement('div'),
    quickRepliesEditor: new FakeElement('div'),
    quickRepliesStatus: { name: 'quickRepliesStatus' },
    sessionStatus: { name: 'sessionStatus' },
    messages: new FakeElement('div'),
    chatInput: new FakeElement('textarea')
  };
  const state = {
    chatStreaming: false,
    conversationActionPending: false,
    config: {
      persona: { name: '顾怀砚' },
      characterCard: { name: '陆无咎' },
      quickReplies: [
        { label: '继续推进', content: '请继续推进剧情', enabled: true },
        { label: '停用', content: '不会显示', enabled: false }
      ],
      lightFrontend: { mvu: { legacy: true } }
    },
    session: {
      id: 'story/session',
      memory: {
        narrativeState: { activeArc: '雨夜旧案' },
        worldState: { location: { current: '落雁城' }, time: '子时' },
        lightFrontendState: { clue: 2 }
      }
    }
  };
  const requests = [];
  const statuses = [];
  const composerValues = [];
  let inspectorRefreshes = 0;
  let sidebarRefreshes = 0;
  let composerSyncs = 0;
  let messageSyncs = 0;
  let replacements = 0;
  let sends = 0;

  const controller = createConversationActionsController({
    state,
    els,
    apiRequest: async (...args) => {
      requests.push(args);
      return apiRequest(...args);
    },
    getSessionId: () => state.session.id,
    replaceSession: (session) => {
      replacements += 1;
      state.session = session;
    },
    refreshInspector: () => { inspectorRefreshes += 1; },
    refreshImmersiveSidebar: () => { sidebarRefreshes += 1; },
    setComposerInputValue: (value, options) => composerValues.push({ value, options }),
    syncComposerState: () => { composerSyncs += 1; },
    syncMessageActionState: () => { messageSyncs += 1; },
    sendMessage: async () => {
      sends += 1;
      return sendMessage();
    },
    setStatus: (element, message, tone) => statuses.push({ element: element.name, message, tone }),
    humanizeApiError: (error) => error.message,
    documentObject,
    getImportedQuickReplies: () => importedReplies,
    expandImportedQuickReply: (reply, context) => (
      String(reply.content || '').replace('{{char}}', context.char)
    )
  });

  return {
    controller,
    els,
    state,
    requests,
    statuses,
    composerValues,
    counts: () => ({
      composerSyncs,
      inspectorRefreshes,
      messageSyncs,
      replacements,
      sends,
      sidebarRefreshes
    })
  };
}

test('conversation action helpers preserve imported text and build the light-frontend context', () => {
  const documentObject = { createElement: (tagName) => new FakeElement(tagName) };

  assert.equal(buildRecommendedActionFallback('观察四周！'), '我观察四周。');
  assert.equal(buildRecommendedActionFallback('我拔剑？'), '我拔剑。');
  assert.equal(buildRecommendedActionFallback('  '), '');
  assert.equal(isSilentQuickReply({ label: '继续推进剧情', content: '任意' }), true);
  assert.equal(isSilentQuickReply({ content: '（请继续推进剧情）。' }), true);
  assert.equal(isSilentQuickReply({ label: '观察', content: '观察四周' }), false);
  assert.equal(decodeImmersiveAction('%E6%8B%94%E5%89%91%20%26amp%3B%20%E8%A7%82%E5%AF%9F', documentObject), '拔剑 & 观察');
  assert.equal(decodeImmersiveAction('%E0%A4%A&amp;', documentObject), '%E0%A4%A&');

  const context = buildLightFrontendContext(createHarness().state);
  assert.deepEqual({
    user: context.user,
    char: context.char,
    scene: context.scene,
    location: context.location,
    time: context.time,
    mvu: context.mvu
  }, {
    user: '顾怀砚',
    char: '陆无咎',
    scene: '雨夜旧案',
    location: '落雁城',
    time: '子时',
    mvu: { clue: 2 }
  });
});

test('quick replies keep draft actions editable and apply imported MVU patches through the exact endpoint', async () => {
  const importedReplies = [
    { source: 'card', label: '问陆无咎', content: '询问{{char}}' },
    { source: 'card', label: '线索 +1', content: '', actionType: 'mvu-patch', patch: { clue: 3 } }
  ];
  const nextSession = { id: 'story/session', memory: { lightFrontendState: { clue: 3 } } };
  const harness = createHarness({
    importedReplies,
    apiRequest: async (path) => (
      path.includes('/light-frontend/mvu') ? { session: nextSession } : { quickReplies: [] }
    )
  });

  harness.controller.renderQuickReplies();
  assert.equal(harness.els.quickRepliesBar.children.length, 3);
  assert.equal(harness.els.quickRepliesBar.children[1].textContent, '问陆无咎');
  await harness.els.quickRepliesBar.children[0].emit('click');
  assert.deepEqual(harness.composerValues.at(-1), {
    value: '请继续推进剧情',
    options: {
      pendingQuickReply: {
        content: '请继续推进剧情',
        hiddenFromChat: true
      }
    }
  });

  const result = await harness.controller.applyQuickReplyStateAction(importedReplies[1]);
  assert.equal(result.session, nextSession);
  assert.deepEqual(harness.requests.at(-1), [
    '/api/sessions/story%2Fsession/light-frontend/mvu',
    { method: 'PATCH', body: { patch: { clue: 3 } } }
  ]);
  assert.equal(harness.state.conversationActionPending, false);
  assert.deepEqual(harness.counts(), {
    composerSyncs: 2,
    inspectorRefreshes: 1,
    messageSyncs: 2,
    replacements: 1,
    sends: 0,
    sidebarRefreshes: 1
  });
});

test('quick reply editor add, delete and save stay inside the controller', async () => {
  const harness = createHarness({
    apiRequest: async () => ({
      quickReplies: [{ label: '观察', content: '观察四周', enabled: true }]
    })
  });
  harness.state.config.quickReplies = [
    { label: '继续推进', content: '请继续推进剧情', enabled: true }
  ];
  harness.controller.bindEvents();
  harness.controller.renderQuickRepliesEditor();

  const firstRow = harness.els.quickRepliesEditor.children[0];
  firstRow.querySelector('[data-qr-field="label"]').value = ' 观察 ';
  firstRow.querySelector('[data-qr-field="content"]').value = ' 观察四周 ';
  harness.controller.addQuickReplyRow();
  assert.equal(harness.els.quickRepliesEditor.children.length, 2);

  await harness.controller.saveQuickReplies();
  assert.deepEqual(harness.requests.at(-1), [
    '/api/quick-replies',
    {
      method: 'PUT',
      body: {
        quickReplies: [{ label: '观察', content: '观察四周', enabled: true }]
      }
    }
  ]);
  assert.deepEqual(harness.state.config.quickReplies, [
    { label: '观察', content: '观察四周', enabled: true }
  ]);
  assert.ok(harness.statuses.some(({ message, tone }) => message === '已保存' && tone === 'ok'));
});

test('recommended actions share one lock across rewrite, send and historical action controls', async () => {
  let resolveRewrite;
  const rewritePending = new Promise((resolve) => {
    resolveRewrite = resolve;
  });
  const harness = createHarness({
    apiRequest: () => rewritePending
  });
  const trigger = new FakeElement('button');

  const first = harness.controller.useRecommendedAction('观察四周', trigger);
  assert.equal(harness.state.conversationActionPending, true);
  assert.equal(trigger.classList.contains('is-expanding'), true);
  assert.equal(trigger.attributes.get('aria-busy'), 'true');

  const second = await harness.controller.useRecommendedAction('拔剑', new FakeElement('button'));
  assert.equal(second, false);
  assert.equal(harness.requests.length, 1);
  assert.ok(harness.statuses.some(({ message }) => message === '上一项对话行动仍在处理中，请稍候'));

  resolveRewrite({ text: '我按住刀柄，先观察四周。' });
  assert.equal(await first, true);
  assert.deepEqual(harness.composerValues.at(-1), {
    value: '我按住刀柄，先观察四周。',
    options: undefined
  });
  assert.equal(harness.counts().sends, 1);
  assert.equal(harness.state.conversationActionPending, false);
  assert.equal(trigger.classList.contains('is-expanding'), false);
  assert.equal(trigger.attributes.has('aria-busy'), false);
});

test('recommended action fallback still sends and chat-input rewrite restores action state', async () => {
  const fallbackHarness = createHarness({
    apiRequest: async () => {
      throw new Error('provider unavailable');
    }
  });
  assert.equal(await fallbackHarness.controller.useRecommendedAction('拔剑', new FakeElement('button')), true);
  assert.equal(fallbackHarness.composerValues.at(-1).value, '我拔剑。');
  assert.equal(fallbackHarness.counts().sends, 1);
  assert.ok(fallbackHarness.statuses.some(({ message }) => message.includes('角色化改写不可用')));

  const rewriteHarness = createHarness({
    apiRequest: async () => ({ text: '我放轻脚步，沿着墙根前行。' })
  });
  rewriteHarness.els.chatInput.value = '沿墙走';
  const payload = await rewriteHarness.controller.rewriteChatInput();
  assert.equal(payload.text, '我放轻脚步，沿着墙根前行。');
  assert.deepEqual(rewriteHarness.composerValues.at(-1), {
    value: '我放轻脚步，沿着墙根前行。',
    options: { focus: false }
  });
  assert.equal(rewriteHarness.els.chatInput.focusCount, 1);
  assert.deepEqual(rewriteHarness.requests[0], [
    '/api/rewrite',
    {
      method: 'POST',
      body: {
        sessionId: 'story/session',
        target: 'chat-input',
        text: '沿墙走',
        instruction: '更适合沉浸式角色扮演，保留用户意图，不替用户做新的核心决定。'
      }
    }
  ]);
  assert.equal(rewriteHarness.state.conversationActionPending, false);

  rewriteHarness.els.chatInput.value = ' ';
  assert.equal(await rewriteHarness.controller.rewriteChatInput(), null);
  assert.equal(rewriteHarness.els.chatInput.focusCount, 2);
});

test('custom action keeps the exact user text and bypasses recommendation rewriting', async () => {
  const harness = createHarness({
    apiRequest: async () => {
      throw new Error('custom actions must not call rewrite');
    }
  });
  const trigger = new FakeElement('div');

  assert.equal(await harness.controller.useRecommendedAction(
    '我不报身份，只问她为何认得这枚令牌。',
    trigger,
    { preserveText: true }
  ), true);

  assert.equal(harness.requests.length, 0);
  assert.equal(harness.composerValues.at(-1).value, '我不报身份，只问她为何认得这枚令牌。');
  assert.equal(harness.counts().sends, 1);
});
