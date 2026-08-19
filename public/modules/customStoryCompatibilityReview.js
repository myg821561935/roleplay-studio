import { createCompatibilityDifferencesNotice } from './customStoryCompatibilityDifferences.js';

export function createCustomStoryCompatibilityReview(value = {}) {
  return {
    fingerprint: String(value.fingerprint || ''),
    approvedScriptHashes: Array.from(new Set(
      (Array.isArray(value.approvedScriptHashes) ? value.approvedScriptHashes : [])
        .map((hash) => String(hash || ''))
        .filter(Boolean)
    )),
    acknowledgeCompatibility: value.acknowledgeCompatibility === true
  };
}

export function createCustomStoryApprovalController({
  state,
  element,
  getReadiness,
  persistDraft,
  renderReadiness,
  invalidateInspection,
  confirmAction = (message) => globalThis.confirm?.(message) === true,
  documentObject = globalThis.document
} = {}) {
  function bindEvents() {
    element?.addEventListener('click', (event) => {
      if (event.target.closest('[data-story-compatibility-ack]')) {
        acknowledgeCompatibility();
        return;
      }
      if (event.target.closest('[data-story-compatibility-retry]')) {
        invalidateInspection();
        persistDraft();
        renderReadiness();
      }
    });
  }

  function render(readiness, composition = {}) {
    if (!element) return;
    const review = readiness.compatibilityReview;
    const rules = Array.isArray(review?.rules) ? review.rules : [];
    const sourceRuntimeBlocked = Boolean(review?.sourceRuntimeBlocked || readiness.sourceRuntimeBlocked);
    const requiresDecision = rules.length > 0 || Boolean(review?.requiresCompatibilityAcknowledgement);
    element.replaceChildren();

    if (composition.status === 'error' && readiness.canInspect) {
      element.className = 'story-custom-approvals is-error';
      const title = createElement('strong', '兼容预检未完成');
      const copy = createElement('p', '未取得最新预检结果前不会创建剧本。');
      const retry = createButton('重新预检');
      retry.dataset.storyCompatibilityRetry = 'true';
      element.append(title, copy, retry);
      return;
    }
    if (!requiresDecision) {
      element.className = 'story-custom-approvals is-hidden';
      return;
    }

    const saved = createCustomStoryCompatibilityReview(state.customStoryDraft.compatibilityReview);
    const matches = saved.fingerprint === review.fingerprint;
    const allApproved = !readiness.compatibilityAcknowledgementPending;
    element.className = `story-custom-approvals ${allApproved ? 'is-complete' : 'is-pending'}`;
    element.append(createHeading(allApproved));

    if (sourceRuntimeBlocked) {
      element.append(createSafeDerivativeNotice(review));
    }
    if (Array.isArray(review?.differences) && review.differences.length) {
      element.append(createCompatibilityDifferencesNotice(review.differences, documentObject));
    }

    if (rules.length) {
      const list = createElement('div');
      list.className = 'story-custom-approval-list';
      rules.forEach((rule) => list.append(createScriptCard(rule)));
      element.append(list);
    }
    if (review.requiresCompatibilityAcknowledgement) {
      element.append(createCompatibilityAcknowledgement(review, matches && saved.acknowledgeCompatibility));
    }
  }

  function createSafeDerivativeNotice(review) {
    const wrapper = createElement('div');
    wrapper.className = 'story-custom-compatibility-blockers';
    wrapper.append(
      createElement('strong', '原资源不能直接运行，可创建安全派生版'),
      createElement('p', '以下源运行时能力不会进入派生剧本；角色、世界书和 Prompt 会继续保留。若资源本身是完整网页，请改走独立重前端导入。')
    );
    const blockers = Array.isArray(review?.blockers) ? review.blockers : [];
    if (blockers.length) {
      const list = createElement('ul');
      blockers.forEach((item) => {
        const row = createElement('li');
        row.append(
          createElement('strong', String(item.label || item.id || '未知能力')),
          createElement('span', String(item.impact || item.recommendation || '当前运行时不支持'))
        );
        list.append(row);
      });
      wrapper.append(list);
    }
    return wrapper;
  }

  function createHeading(allApproved) {
    const heading = createElement('div');
    heading.className = 'story-custom-approval-heading';
    heading.append(
      createElement('strong', allApproved ? '兼容审查已完成' : '创建前兼容审查'),
      createElement('span', '所有第三方脚本均已纳入安全隔离沙箱运行，无需手动审批。')
    );
    return heading;
  }

  function createScriptCard(rule) {
    const hash = String(rule.contentHash || '');
    const sourceText = String(rule.source || '');
    const card = createElement('article');
    card.className = `story-custom-approval-card is-approved`;
    const copy = createElement('div');
    const meta = createElement('small', `隔离运行 · ${hash ? `${hash.slice(0, 18)}…` : '缺少内容哈希'}`);
    const risks = createElement(
      'p',
      '检测到第三方脚本。将在 Web Worker 隔离沙箱中安全执行，不会访问敏感数据。'
    );
    const details = createElement('details');
    details.className = 'story-custom-script-source';
    const pattern = createElement('small', `匹配：${String(rule.pattern || '未声明')} · 作用域：${String(rule.scope || 'assistant')}`);
    const source = createElement('pre', sourceText || '未提供脚本正文');
    details.append(createElement('summary', '查看沙箱执行内容'), pattern, source);
    copy.append(createElement('strong', String(rule.name || rule.scriptId || '未命名第三方脚本')), meta, risks, details);
    card.append(copy);
    return card;
  }

  function createCompatibilityAcknowledgement(review, acknowledged) {
    const counts = review.counts || {};
    const row = createElement('div');
    row.className = `story-custom-compatibility-ack ${acknowledged ? 'is-approved' : 'is-pending'}`;
    const sourceRuntimeBlocked = Boolean(review?.sourceRuntimeBlocked || Number(counts.missing || 0) > 0);
    const copy = [
      Number(counts.missing || 0) ? `禁用 ${Number(counts.missing)} 项源运行时能力` : '',
      Number(counts.degraded || 0) ? `降级 ${Number(counts.degraded)}` : '',
      Number(counts.review || 0) && !review.rules?.length ? `待转换 ${Number(counts.review)}` : ''
    ].filter(Boolean).join(' · ') || '存在需确认的兼容处理';
    const button = createButton(
      acknowledged
        ? (sourceRuntimeBlocked ? '已确认安全派生版' : '已确认安全处理')
        : (sourceRuntimeBlocked ? '确认创建安全派生版' : '确认禁用 / 降级处理')
    );
    button.disabled = acknowledged;
    button.dataset.storyCompatibilityAck = 'true';
    row.append(createElement('span', copy), button);
    return row;
  }

  function approveScript(contentHash) {
    // 废弃手动审批
  }

  function acknowledgeCompatibility() {
    const readiness = getReadiness();
    const review = readiness.compatibilityReview;
    if (!review?.fingerprint || !review.requiresCompatibilityAcknowledgement) return;
    const counts = review.counts || {};
    const sourceRuntimeBlocked = Boolean(review.sourceRuntimeBlocked || Number(counts.missing || 0) > 0);
    if (!confirmAction(
      sourceRuntimeBlocked
        ? `确认创建安全派生版？\n\n将禁用 ${Number(counts.missing || 0)} 项源运行时能力并保留可安全运行的角色、世界书和 Prompt。原资源保持只读，禁用项写入本地组装记录。`
        : `确认按安全兼容策略创建？\n\n降级能力 ${Number(counts.degraded || 0)} 项。未知第三方代码仍保持禁用，并记录到本地审计。`
    )) return;
    const current = createCustomStoryCompatibilityReview(state.customStoryDraft.compatibilityReview);
    state.customStoryDraft.compatibilityReview = createCustomStoryCompatibilityReview({
      fingerprint: review.fingerprint,
      approvedScriptHashes: current.fingerprint === review.fingerprint ? current.approvedScriptHashes : [],
      acknowledgeCompatibility: true
    });
    persistDraft();
    renderReadiness();
  }

  function createElement(tagName, text = '') {
    const node = documentObject.createElement(tagName);
    if (text) node.textContent = text;
    return node;
  }

  function createButton(label) {
    const button = createElement('button', label);
    button.type = 'button';
    return button;
  }

  function riskLabel(level) {
    return { high: '高风险', medium: '中风险', low: '低风险' }[level] || '待人工判断';
  }

  return { bindEvents, render };
}
