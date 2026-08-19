import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCustomStoryApprovalController,
  createCustomStoryCompatibilityReview
} from '../public/modules/customStoryCompatibilityReview.js';

test('compatibility review normalizes duplicate script hashes', () => {
  assert.deepEqual(createCustomStoryCompatibilityReview({
    fingerprint: 'sha256:review',
    approvedScriptHashes: ['sha256:script', '', 'sha256:script'],
    acknowledgeCompatibility: true
  }), {
    fingerprint: 'sha256:review',
    approvedScriptHashes: ['sha256:script'],
    acknowledgeCompatibility: true
  });
});

test('third-party scripts render their isolated sandbox source without manual approval', () => {
  const element = new FakeElement('div');
  const state = {
    customStoryDraft: { compatibilityReview: createCustomStoryCompatibilityReview() }
  };
  let rendered = 0;
  const readiness = {
    canInspect: true,
    compatibilityReview: {
      fingerprint: 'sha256:review',
      counts: { missing: 0, review: 1, degraded: 0 },
      rules: [{
        scriptId: 'panel-script',
        name: '动态面板',
        contentHash: 'sha256:script',
        scope: 'assistant',
        pattern: '<panel>',
        source: '<script>renderPanel()</script>',
        riskLevel: 'medium',
        risks: ['executable-browser-content']
      }],
      requiresScriptApproval: true,
      requiresCompatibilityAcknowledgement: false
    },
    pendingScriptRules: [],
    compatibilityAcknowledgementPending: false
  };
  const controller = createCustomStoryApprovalController({
    state,
    element,
    getReadiness: () => readiness,
    persistDraft: () => {},
    renderReadiness: () => { rendered += 1; },
    invalidateInspection: () => {},
    confirmAction: () => true,
    documentObject: { createElement: (tagName) => new FakeElement(tagName) }
  });

  controller.render(readiness, { status: 'ready' });
  controller.bindEvents();
  const source = element.find((node) => node.tagName === 'pre');
  // 沙箱模型：脚本在 Web Worker 隔离沙箱中执行，无需手动审批按钮
  const approve = element.find((node) => node.dataset.storyScriptApproveHash !== undefined);
  assert.equal(approve, null);
  assert.equal(source.textContent, '<script>renderPanel()</script>');
  assert.equal(element.className, 'story-custom-approvals is-complete');
  // 渲染不产生任何审批副作用，也不会改动已保存的兼容审查
  assert.equal(rendered, 0);
  assert.deepEqual(state.customStoryDraft.compatibilityReview.approvedScriptHashes, []);
});

test('blocked source runtime renders exact removals before approving a safe derivative', () => {
  const element = new FakeElement('div');
  const state = {
    customStoryDraft: { compatibilityReview: createCustomStoryCompatibilityReview() }
  };
  const readiness = {
    canInspect: true,
    sourceRuntimeBlocked: true,
    compatibilityReview: {
      fingerprint: 'sha256:blocked',
      counts: { missing: 1, review: 0, degraded: 0 },
      sourceRuntimeBlocked: true,
      safeDerivativeAvailable: true,
      blockers: [{
        id: 'custom-html-ui',
        label: 'HTML / CSS 交互面板',
        impact: '完整网页必须改走独立重前端导入。'
      }],
      rules: [],
      requiresScriptApproval: false,
      requiresCompatibilityAcknowledgement: true
    },
    pendingScriptRules: [],
    compatibilityAcknowledgementPending: true
  };
  let persisted = 0;
  let rendered = 0;
  const controller = createCustomStoryApprovalController({
    state,
    element,
    getReadiness: () => readiness,
    persistDraft: () => { persisted += 1; },
    renderReadiness: () => { rendered += 1; },
    invalidateInspection: () => {},
    confirmAction: () => true,
    documentObject: { createElement: (tagName) => new FakeElement(tagName) }
  });

  controller.render(readiness, { status: 'ready' });
  controller.bindEvents();
  const acknowledgement = element.find((node) => node.dataset.storyCompatibilityAck !== undefined);

  assert.equal(element.className, 'story-custom-approvals is-pending');
  assert.ok(element.find((node) => node.textContent === '原资源不能直接运行，可创建安全派生版'));
  assert.ok(element.find((node) => node.textContent === 'HTML / CSS 交互面板'));
  assert.equal(acknowledgement.textContent, '确认创建安全派生版');
  element.dispatchClick(acknowledgement);
  assert.equal(state.customStoryDraft.compatibilityReview.acknowledgeCompatibility, true);
  assert.equal(state.customStoryDraft.compatibilityReview.fingerprint, 'sha256:blocked');
  assert.equal(persisted, 1);
  assert.equal(rendered, 1);
});

test('safe degradation renders exact Character Filter tag differences before acknowledgement', () => {
  const element = new FakeElement('div');
  const state = {
    customStoryDraft: { compatibilityReview: createCustomStoryCompatibilityReview() }
  };
  const readiness = {
    canInspect: true,
    compatibilityReview: {
      fingerprint: 'sha256:tag-difference',
      counts: { missing: 0, review: 0, degraded: 1 },
      differences: [{
        id: 'worldbook-character-filter-tag-registry',
        label: 'Character Filter 标签注册表',
        impact: '发现 1 个无法解析的私有标签 ID。',
        recommendation: '导入原 Tag Registry。',
        evidence: ['仅限武侠角色：31f7b74e-9828-4cd2-b7ac-3d93840d471c']
      }],
      rules: [],
      requiresScriptApproval: false,
      requiresCompatibilityAcknowledgement: true
    },
    pendingScriptRules: [],
    compatibilityAcknowledgementPending: true
  };
  const controller = createCustomStoryApprovalController({
    state,
    element,
    getReadiness: () => readiness,
    persistDraft: () => {},
    renderReadiness: () => {},
    invalidateInspection: () => {},
    confirmAction: () => true,
    documentObject: { createElement: (tagName) => new FakeElement(tagName) }
  });

  controller.render(readiness, { status: 'ready' });

  assert.ok(element.find((node) => node.textContent === '创建前需确认的兼容差异'));
  assert.ok(element.find((node) => node.textContent === 'Character Filter 标签注册表'));
  assert.ok(element.find((node) => node.textContent.includes('仅限武侠角色：31f7b74e')));
});

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.dataset = {};
    this.className = '';
    this.textContent = '';
    this.disabled = false;
    this.listeners = new Map();
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = [...children];
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  dispatchClick(target) {
    this.listeners.get('click')?.({ target });
  }

  closest(selector) {
    if (selector === '[data-story-script-approve-hash]' && this.dataset.storyScriptApproveHash !== undefined) return this;
    if (selector === '[data-story-compatibility-ack]' && this.dataset.storyCompatibilityAck !== undefined) return this;
    if (selector === '[data-story-compatibility-retry]' && this.dataset.storyCompatibilityRetry !== undefined) return this;
    return null;
  }

  find(predicate) {
    if (predicate(this)) return this;
    for (const child of this.children) {
      const match = child?.find?.(predicate);
      if (match) return match;
    }
    return null;
  }
}
