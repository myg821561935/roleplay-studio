import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createComposerController,
  getComposerAvailability,
  shouldSubmitChatInput
} from '../public/modules/composer.js';

function dataAttributeToProperty(attribute) {
  return attribute.replace(/^data-/, '').replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

function matchesSelector(element, selector) {
  if (selector.startsWith('#')) return element.id === selector.slice(1);
  if (selector.startsWith('.')) return element.classList.contains(selector.slice(1));
  if (selector.startsWith('[data-')) {
    const attribute = selector.slice(1, -1).split('=')[0];
    return Object.hasOwn(element.dataset, dataAttributeToProperty(attribute));
  }
  return element.tagName === selector.toUpperCase();
}

function descendantsOf(element) {
  return element.children.flatMap((child) => [child, ...descendantsOf(child)]);
}

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(value) {
    this.values.add(value);
  }

  remove(value) {
    this.values.delete(value);
  }

  contains(value) {
    return this.values.has(value);
  }

  toggle(value, force) {
    if (force) this.add(value);
    else this.remove(value);
  }
}

class FakeElement {
  constructor(tagName = 'div', id = '') {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.classList = new FakeClassList();
    this.className = '';
    this.style = {};
    this.listeners = new Map();
    this.attributes = new Map();
    this.value = '';
    this.textContent = '';
    this.title = '';
    this.disabled = false;
    this.hidden = false;
    this.scrollHeight = 0;
    this.focusCount = 0;
    this.requestSubmitCount = 0;
    this.closeCount = 0;
    this.showModalCount = 0;
    this.onclick = null;
    this.open = false;
  }

  append(...nodes) {
    nodes.forEach((node) => {
      node.parentElement = this;
      this.children.push(node);
    });
  }

  replaceChildren(...nodes) {
    this.children = [];
    this.append(...nodes);
  }

  querySelector(selector) {
    return descendantsOf(this).find((element) => matchesSelector(element, selector)) || null;
  }

  querySelectorAll(selector) {
    return descendantsOf(this).filter((element) => matchesSelector(element, selector));
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

  async emit(type, event = {}) {
    const payload = {
      target: event.target || this,
      currentTarget: this,
      preventDefault: event.preventDefault || (() => {}),
      ...event
    };
    for (const handler of this.listeners.get(type) || []) await handler(payload);
    if (type === 'click' && typeof this.onclick === 'function') await this.onclick(payload);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name);
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  focus() {
    this.focusCount += 1;
  }

  requestSubmit() {
    this.requestSubmitCount += 1;
  }

  close() {
    this.closeCount += 1;
  }

  showModal() {
    this.showModalCount += 1;
  }
}

function createHarness() {
  const formatAction = new FakeElement('button');
  formatAction.dataset.actionTemplate = '请修复上一轮回复的格式。';
  const stageActions = new FakeElement('div');
  stageActions.classList.add('stage-actions');
  const creationMenu = new FakeElement('details');
  creationMenu.dataset.composerMenu = '';
  const creationMenuSummary = new FakeElement('summary');
  creationMenu.append(creationMenuSummary, formatAction);
  const displayMenu = new FakeElement('details');
  displayMenu.dataset.composerMenu = '';
  displayMenu.append(new FakeElement('summary'));
  stageActions.append(creationMenu, displayMenu);
  const dialog = new FakeElement('dialog', 'speaker-picker-dialog');
  const speakerList = new FakeElement('div', 'speaker-picker-list');
  const autoButton = new FakeElement('button', 'speaker-picker-auto');
  const cancelButton = new FakeElement('button', 'speaker-picker-cancel');
  const nodesBySelector = new Map([
    ['#speaker-picker-dialog', dialog],
    ['#speaker-picker-list', speakerList],
    ['#speaker-picker-auto', autoButton],
    ['#speaker-picker-cancel', cancelButton]
  ]);
  const documentObject = new FakeElement('document');
  documentObject.createElement = (tagName) => new FakeElement(tagName);
  documentObject.querySelector = (selector) => nodesBySelector.get(selector) || null;
  const els = {
    appStatus: new FakeElement('p'),
    sessionStatus: new FakeElement('p'),
    chatForm: new FakeElement('form'),
    chatInput: new FakeElement('textarea'),
    sendMessageButton: new FakeElement('button'),
    stopGeneration: new FakeElement('button'),
    composerStatus: new FakeElement('span'),
    rewriteChatInput: new FakeElement('button'),
    continueMessage: new FakeElement('button'),
    toggleAuthorNote: new FakeElement('button'),
    toggleBackground: new FakeElement('button'),
    targetSpeakerBtn: new FakeElement('button'),
    refreshState: new FakeElement('button'),
    stageActions
  };
  const state = {
    config: {
      characterCard: { name: '沈观澜' },
      groupMembers: [{ name: '沈观澜' }, { name: '陆无咎' }]
    },
    session: { messages: [] },
    chatStreaming: false,
    pendingQuickReply: null,
    targetSpeaker: ''
  };
  const statuses = [];
  const streamingChanges = [];
  let sends = 0;
  let stops = 0;
  const controller = createComposerController({
    state,
    els,
    onSend: () => { sends += 1; },
    onStopGeneration: () => { stops += 1; },
    onStreamingChange: (streaming) => streamingChanges.push(streaming),
    setStatus: (_element, message, tone) => statuses.push({ message, tone }),
    documentObject,
    windowObject: { prompt: () => null }
  });
  return {
    autoButton,
    cancelButton,
    creationMenu,
    creationMenuSummary,
    controller,
    dialog,
    displayMenu,
    documentObject,
    els,
    formatAction,
    speakerList,
    state,
    statuses,
    streamingChanges,
    getSends: () => sends,
    getStops: () => stops
  };
}

test('composer keyboard and availability helpers reject no-op actions', () => {
  assert.equal(shouldSubmitChatInput({ key: 'Enter' }), true);
  assert.equal(shouldSubmitChatInput({ key: 'Enter', shiftKey: true }), false);
  assert.equal(shouldSubmitChatInput({ key: 'Enter', isComposing: true }), false);
  assert.equal(shouldSubmitChatInput({ key: 'Enter', keyCode: 229 }), false);

  assert.deepEqual(getComposerAvailability(), {
    actionPending: false,
    busy: false,
    canSend: false,
    canRewrite: false,
    canContinue: false,
    canRepairFormat: false,
    canTargetSpeaker: false,
    hasAssistantReply: false,
    hasInput: false,
    streaming: false
  });
  const available = getComposerAvailability({
    inputValue: '拔剑',
    messages: [{ role: 'assistant', content: '雨声渐急。' }],
    targetCandidates: ['沈观澜']
  });
  assert.equal(available.canSend, true);
  assert.equal(available.canRewrite, true);
  assert.equal(available.canContinue, true);
  assert.equal(available.canRepairFormat, true);
  assert.equal(available.canTargetSpeaker, true);

  const pending = getComposerAvailability({
    inputValue: '拔剑',
    messages: [{ role: 'assistant', content: '雨声渐急。' }],
    actionPending: true,
    targetCandidates: ['沈观澜']
  });
  assert.equal(pending.busy, true);
  assert.equal(pending.canSend, false);
  assert.equal(pending.canRewrite, false);
  assert.equal(pending.canContinue, false);
  assert.equal(pending.canRepairFormat, false);
  assert.equal(pending.canTargetSpeaker, false);
});

test('composer controller synchronizes input, resize, streaming and action state', async () => {
  const harness = createHarness();
  harness.controller.bindEvents();

  assert.equal(harness.els.sendMessageButton.disabled, true);
  assert.equal(harness.els.rewriteChatInput.disabled, true);
  assert.equal(harness.els.continueMessage.disabled, true);
  assert.equal(harness.formatAction.disabled, true);
  assert.equal(harness.els.chatInput.disabled, false);

  harness.state.pendingQuickReply = { content: '旧动作', hiddenFromChat: true };
  harness.els.chatInput.value = '拔剑';
  harness.els.chatInput.scrollHeight = 96;
  await harness.els.chatInput.emit('input');
  assert.equal(harness.state.pendingQuickReply, null);
  assert.equal(harness.els.chatInput.style.height, '96px');
  assert.equal(harness.els.sendMessageButton.disabled, false);
  assert.equal(harness.els.rewriteChatInput.disabled, false);

  await harness.els.chatInput.emit('keydown', { key: 'Enter' });
  assert.equal(harness.els.chatForm.requestSubmitCount, 1);
  await harness.els.chatForm.emit('submit');
  assert.equal(harness.getSends(), 1);

  harness.controller.setStreamingState(true, '正在生成');
  assert.equal(harness.els.sendMessageButton.disabled, true);
  assert.equal(harness.els.chatInput.disabled, false);
  assert.equal(harness.els.composerStatus.hidden, false);
  assert.equal(harness.els.refreshState.disabled, true);
  // 停止按钮仅流式期间可见，点击触发 onStopGeneration
  assert.equal(harness.els.stopGeneration.hidden, false);
  await harness.els.stopGeneration.emit('click');
  assert.equal(harness.getStops(), 1);

  harness.state.session.messages = [{ role: 'assistant', content: '雨声渐急。' }];
  harness.controller.setStreamingState(false);
  assert.equal(harness.els.stopGeneration.hidden, true);
  assert.equal(harness.els.continueMessage.disabled, false);
  assert.equal(harness.formatAction.disabled, false);
  assert.deepEqual(harness.streamingChanges, [true, false]);

  harness.state.conversationActionPending = true;
  harness.controller.syncActionState();
  assert.equal(harness.els.chatInput.disabled, true);
  assert.equal(harness.els.sendMessageButton.disabled, true);
  assert.equal(harness.els.continueMessage.disabled, true);
  assert.equal(harness.els.targetSpeakerBtn.disabled, true);
  assert.equal(harness.els.chatForm.getAttribute('aria-busy'), 'true');
  harness.state.conversationActionPending = false;
  harness.controller.syncActionState();

  harness.controller.clearInput();
  assert.equal(harness.els.chatInput.value, '');
  assert.equal(harness.els.sendMessageButton.disabled, true);
  assert.equal(harness.els.rewriteChatInput.disabled, true);
});

test('composer distinguishes finished prose from the remaining persistence phase', () => {
  const harness = createHarness();

  harness.controller.setStreamingState(true, '正文已生成，正在同步世界状态与记忆…', 'finalizing');

  assert.equal(harness.state.chatStreamPhase, 'finalizing');
  assert.equal(harness.els.composerStatus.textContent, '正文已生成 · 正在同步状态');
  assert.equal(harness.els.chatInput.placeholder, '正文已生成，正在同步状态；可先写下一步...');
  assert.equal(harness.els.sendMessageButton.title, '正文已生成，正在同步世界状态与记忆');

  harness.controller.setStreamingState(false);
  assert.equal(harness.state.chatStreamPhase, '');
  assert.equal(harness.els.composerStatus.hidden, true);
});

test('composer keeps unsent drafts scoped to the active session', () => {
  const harness = createHarness();
  harness.controller.setInputValue('第一部剧本的未发送输入', { focus: false });

  assert.equal(harness.controller.handleSessionChanged({
    previousSessionId: 'story-a',
    nextSessionId: 'story-b'
  }), true);
  assert.equal(harness.els.chatInput.value, '');

  harness.controller.setInputValue('第二部剧本的未发送输入', { focus: false });
  harness.controller.handleSessionChanged({
    previousSessionId: 'story-b',
    nextSessionId: 'story-a'
  });
  assert.equal(harness.els.chatInput.value, '第一部剧本的未发送输入');
});

test('speaker picker deduplicates candidates and replaces dialog callbacks on reopen', async () => {
  const harness = createHarness();
  harness.controller.bindEvents();

  harness.controller.pickTargetSpeaker();
  assert.equal(harness.speakerList.children.length, 2);
  assert.deepEqual(harness.controller.getTargetSpeakerCandidates(), ['沈观澜', '陆无咎']);
  assert.equal(harness.dialog.showModalCount, 1);
  const firstCancel = harness.cancelButton.onclick;

  harness.controller.pickTargetSpeaker();
  assert.equal(harness.dialog.showModalCount, 2);
  assert.notEqual(harness.cancelButton.onclick, firstCancel);
  assert.equal(harness.cancelButton.listeners.size, 0);

  await harness.speakerList.children[1].emit('click');
  assert.equal(harness.state.targetSpeaker, '陆无咎');
  assert.equal(harness.els.targetSpeakerBtn.textContent, '下轮：陆无咎');
  assert.equal(harness.dialog.closeCount, 1);

  harness.controller.pickTargetSpeaker();
  assert.equal(harness.state.targetSpeaker, '');
  assert.equal(harness.els.targetSpeakerBtn.textContent, '指定发言');
});

test('speaker targeting excludes disabled members and clears stale selections', () => {
  const harness = createHarness();
  harness.state.config.groupMembers = [
    { name: '陆无咎', enabled: false },
    { name: '苏棠', enabled: true }
  ];
  harness.state.targetSpeaker = '陆无咎';

  assert.deepEqual(harness.controller.getTargetSpeakerCandidates(), ['沈观澜', '苏棠']);
  assert.equal(harness.controller.reconcileTargetSpeaker(), '');
  assert.equal(harness.els.targetSpeakerBtn.textContent, '指定发言');

  harness.state.targetSpeaker = '苏棠';
  assert.equal(harness.controller.reconcileTargetSpeaker(), '苏棠');
  assert.equal(harness.els.targetSpeakerBtn.textContent, '下轮：苏棠');
});

test('composer action menus stay mutually exclusive and close after use or Escape', async () => {
  const harness = createHarness();
  harness.controller.bindEvents();

  harness.creationMenu.open = true;
  harness.creationMenu.setAttribute('open', '');
  harness.displayMenu.open = true;
  harness.displayMenu.setAttribute('open', '');
  await harness.creationMenu.emit('toggle');
  assert.equal(harness.creationMenu.open, true);
  assert.equal(harness.displayMenu.open, false);

  let propagationStopped = false;
  await harness.els.stageActions.emit('keydown', {
    key: 'Escape',
    stopPropagation: () => { propagationStopped = true; }
  });
  assert.equal(harness.creationMenu.open, false);
  assert.equal(harness.creationMenuSummary.focusCount, 1);
  assert.equal(propagationStopped, true);

  harness.creationMenu.open = true;
  harness.creationMenu.setAttribute('open', '');
  harness.state.session.messages = [{ role: 'assistant', content: '雨声渐急。' }];
  harness.controller.syncActionState();
  await harness.els.stageActions.emit('click', { target: harness.formatAction });
  assert.equal(harness.creationMenu.open, false);
  assert.equal(harness.els.chatInput.value, '请修复上一轮回复的格式。');

  harness.displayMenu.open = true;
  harness.displayMenu.setAttribute('open', '');
  await harness.documentObject.emit('click', { target: new FakeElement('button') });
  assert.equal(harness.displayMenu.open, false);
});
