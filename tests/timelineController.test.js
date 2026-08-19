import test from 'node:test';
import assert from 'node:assert/strict';

import { createTimelineController } from '../public/modules/timeline.js';

function dataAttributeToProperty(attribute) {
  return attribute.replace(/^data-/, '').replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

function matchesSelector(element, selector) {
  if (!selector.startsWith('[data-')) return false;
  const attribute = selector.slice(1, -1).split('=')[0];
  return Object.hasOwn(element.dataset, dataAttributeToProperty(attribute));
}

function findByClassName(root, className) {
  return descendantsOf(root).filter((element) => String(element.className).split(' ').includes(className));
}

function descendantsOf(element) {
  return element.children.flatMap((child) => [child, ...descendantsOf(child)]);
}

class FakeElement {
  constructor({ text = '' } = {}) {
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.listeners = new Map();
    this.attributes = new Map();
    this.className = '';
    this.hidden = false;
    this.textContent = text;
    this.style = {};
    this.title = '';
    this.type = '';
  }

  append(...nodes) {
    nodes.forEach((node) => {
      node.parentElement = this;
      this.children.push(node);
    });
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (matchesSelector(current, selector)) return current;
      current = current.parentElement;
    }
    return null;
  }

  querySelectorAll(selector) {
    const selectors = selector.split(',').map((part) => part.trim());
    return descendantsOf(this).filter((element) => selectors.some((part) => matchesSelector(element, part)));
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
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
}

function createHarness({
  timelinePayload = { branches: [], activeBranchId: 'root' },
  mutationPayload = { session: { id: 'story/session', messages: [] } },
  apiError = null,
  promptValues = [],
  confirmValues = []
} = {}) {
  const requests = [];
  const statuses = [];
  const replaceCalls = [];
  const state = {
    chatStreaming: false,
    conversationActionPending: false,
    session: {
      id: 'story/session',
      timeline: { activeBranchId: 'root' },
      messages: []
    }
  };
  const els = {
    appStatus: { name: 'app' },
    sessionStatus: { name: 'session' },
    timelineBranchList: new FakeElement(),
    timelineCompareResult: new FakeElement(),
    timelineRefresh: new FakeElement()
  };
  let promptIndex = 0;
  let confirmIndex = 0;

  const controller = createTimelineController({
    state,
    els,
    documentObject: { createElement: () => new FakeElement() },
    apiRequest: async (path, options = {}) => {
      requests.push([path, options]);
      if (apiError) throw apiError;
      if (options.method) return mutationPayload;
      return timelinePayload;
    },
    getCurrentSessionId: () => state.session.id,
    replaceSession: (session) => {
      replaceCalls.push(session);
      state.session = session;
      return session;
    },
    renderMessages: () => {},
    refreshInspector: () => {},
    setStatus: (element, message, tone) => statuses.push({ element: element.name, message, tone }),
    promptUser: () => promptValues[promptIndex++],
    confirmUser: () => confirmValues[confirmIndex++]
  });

  return {
    controller, els, requests, statuses, replaceCalls, state,
    apiRequest: undefined
  };
}

test('bindEvents wires branch list click and refresh button', () => {
  const harness = createHarness();
  harness.controller.bindEvents();
  assert.equal(harness.els.timelineBranchList.listeners.get('click').length, 1);
  assert.equal(harness.els.timelineRefresh.listeners.get('click').length, 1);
});

test('loadTimeline fetches the timeline endpoint and renders branches with hierarchy', async () => {
  const harness = createHarness({
    timelinePayload: {
      branches: [
        { id: 'root', label: '主线', messageCount: 4, isActive: true, isRoot: true, lastMessagePreview: '主线最新' },
        { id: 'b1', label: '支线一', messageCount: 2, isActive: false, parentBranchId: 'root', childCount: 0, lastMessagePreview: '支线一最新' }
      ],
      activeBranchId: 'root'
    }
  });
  const payload = await harness.controller.loadTimeline();
  assert.equal(payload.activeBranchId, 'root');
  assert.deepEqual(harness.requests, [['/api/sessions/story%2Fsession/timeline', {}]]);

  const rows = harness.els.timelineBranchList.children;
  assert.equal(rows.length, 2);
  assert.equal(rows[1].style.marginLeft, '14px');
  const rootName = findByClassName(rows[0], 'timeline-branch-name')[0];
  assert.ok(rootName.textContent.includes('主线'));
  const activeSwitch = rows[0].querySelector('[data-timeline-switch]');
  assert.equal(activeSwitch.dataset.timelineSwitch, 'root');
  const renameTool = rows[1].querySelector('[data-timeline-rename]');
  assert.equal(renameTool.dataset.timelineRename, 'b1');
  const compareTool = rows[1].querySelector('[data-timeline-compare]');
  assert.equal(compareTool.dataset.timelineCompare, 'b1');
  const deleteTool = rows[1].querySelector('[data-timeline-delete]');
  assert.equal(deleteTool.dataset.timelineDelete, 'b1');
  // active root 分支不提供对比/删除入口
  assert.equal(rows[0].querySelector('[data-timeline-compare]'), null);
  assert.equal(rows[0].querySelector('[data-timeline-delete]'), null);
});

test('forkFromMessage posts the fork contract and refreshes session views', async () => {
  const harness = createHarness();
  await harness.controller.forkFromMessage('user/2', { label: '新支线', switchTo: true });

  assert.deepEqual(harness.requests, [
    ['/api/sessions/story%2Fsession/timeline/fork', {
      method: 'POST',
      body: { messageId: 'user/2', label: '新支线', switchTo: true }
    }],
    ['/api/sessions/story%2Fsession/timeline', {}]
  ]);
  assert.equal(harness.replaceCalls.length, 1);
});

test('forkFromMessageDialog collects label and switch choice before forking', async () => {
  const harness = createHarness({
    promptValues: ['梦境线'],
    confirmValues: [true]
  });
  await harness.controller.forkFromMessageDialog({ id: 'assistant/3' });

  assert.deepEqual(harness.requests[0], ['/api/sessions/story%2Fsession/timeline/fork', {
    method: 'POST',
    body: { messageId: 'assistant/3', label: '梦境线', switchTo: true }
  }]);
});

test('switchBranch posts the switch contract', async () => {
  const harness = createHarness();
  await harness.controller.switchBranch('b2');

  assert.deepEqual(harness.requests[0], ['/api/sessions/story%2Fsession/timeline/switch', {
    method: 'POST',
    body: { branchId: 'b2' }
  }]);
});

test('renameBranch prompts and patches the branch label', async () => {
  const harness = createHarness({ promptValues: ['复仇线'] });
  await harness.controller.renameBranch('b1');

  assert.deepEqual(harness.requests[0], ['/api/sessions/story%2Fsession/timeline/branches/b1', {
    method: 'PATCH',
    body: { label: '复仇线' }
  }]);
});

test('deleteBranch requires confirmation and sends DELETE with empty body', async () => {
  const harness = createHarness({ confirmValues: [true] });
  await harness.controller.deleteBranch('b1');

  assert.deepEqual(harness.requests[0], ['/api/sessions/story%2Fsession/timeline/branches/b1', {
    method: 'DELETE',
    body: {}
  }]);
});

test('deleteBranch aborts when the user cancels confirmation', async () => {
  const harness = createHarness({ confirmValues: [false] });
  await harness.controller.deleteBranch('b1');
  assert.deepEqual(harness.requests, []);
});

test('compareWithActive renders the two-column compare view', async () => {
  const harness = createHarness({
    timelinePayload: {
      branches: [],
      activeBranchId: 'root',
      forkMessage: { id: 'user/1', content: '在山道遇到伏兵' },
      forkIndex: 3,
      left: { label: '主线', messageCount: 6, tail: [{ role: 'user', content: '主线消息' }] },
      right: { label: '支线', messageCount: 2, tail: [{ role: 'assistant', content: '支线消息' }] }
    }
  });
  await harness.controller.compareWithActive('b1');

  assert.equal(harness.requests[0][0], '/api/sessions/story%2Fsession/timeline/compare?leftId=root&rightId=b1');
  const box = harness.els.timelineCompareResult;
  assert.equal(box.hidden, false);
  const header = box.children.find((child) => child.className === 'timeline-compare-header');
  assert.ok(header.textContent.includes('在山道遇到伏兵'));
  const columns = descendantsOf(box).filter((element) => element.className === 'timeline-compare-column');
  assert.equal(columns.length, 2);
  const messages = descendantsOf(box).filter((element) => String(element.className).startsWith('timeline-compare-message'));
  assert.equal(messages.length, 2);
});

test('timeline click delegation dispatches switch requests through the branch list', async () => {
  const harness = createHarness();
  harness.controller.bindEvents();

  const row = new FakeElement();
  row.dataset.branchId = 'b1';
  const nameButton = new FakeElement();
  nameButton.dataset.timelineSwitch = 'b1';
  row.append(nameButton);
  harness.els.timelineBranchList.append(row);

  await harness.els.timelineBranchList.emit('click', nameButton);

  assert.equal(harness.requests[0][0], '/api/sessions/story%2Fsession/timeline/switch');
  assert.deepEqual(harness.requests[0][1], { method: 'POST', body: { branchId: 'b1' } });
});

test('busy guard blocks timeline mutations while streaming', async () => {
  const harness = createHarness();
  harness.state.chatStreaming = true;
  await harness.controller.forkFromMessage('user/1', { label: 'x', switchTo: false });
  await harness.controller.switchBranch('b1');

  assert.deepEqual(harness.requests, []);
  const busyStatuses = harness.statuses.filter((status) => status.tone === 'busy');
  assert.ok(busyStatuses.length >= 2);
});

test('timeline errors surface a humanized status message', async () => {
  const harness = createHarness({ apiError: new Error('BRANCH_NOT_FOUND') });
  await harness.controller.switchBranch('missing');
  const errorStatuses = harness.statuses.filter((status) => status.tone === 'error');
  assert.equal(errorStatuses.length, 1);
  assert.ok(errorStatuses[0].message.includes('切换分支失败'));
});
