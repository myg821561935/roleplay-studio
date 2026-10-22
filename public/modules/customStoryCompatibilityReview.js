import { createCompatibilityDifferencesNotice } from './customStoryCompatibilityDifferences.js';
import {
  findCurrentScriptReview,
  normalizeScriptExecutionMode,
  normalizeScriptReviews
} from './customStoryCompatibilityReviewState.js';
import {
  createCustomStoryScriptControls,
  getScriptRiskLabel
} from './customStoryCompatibilityScriptControls.js';
import {
  createCompatibilityAcknowledgement,
  createCompatibilityHeading,
  createSafeDerivativeNotice
} from './customStoryCompatibilityNotices.js';
export function createCustomStoryCompatibilityReview(value = {}) {
  return {
    fingerprint: String(value.fingerprint || ''),
    // 审批必须同时绑定脚本 ID、内容哈希、结论和人工说明。旧版仅保存 hash
    // 的数据不再自动视为批准，避免内容升级后静默恢复执行。
    scriptReviews: normalizeScriptReviews(value.scriptReviews),
    executionMode: normalizeScriptExecutionMode(value.executionMode),
    acknowledgeCompatibility: value.acknowledgeCompatibility === true,
    ...(value.acknowledgeDeveloperRisk === true ? { acknowledgeDeveloperRisk: true } : {})
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
  promptAction = (message, value = '') => globalThis.prompt?.(message, value),
  documentObject = globalThis.document
} = {}) {
  const scriptControls = createCustomStoryScriptControls({ createElement, createButton });

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
        return;
      }
      const scriptButton = event.target.closest('[data-story-script-review]');
      if (scriptButton) {
        reviewScript(scriptButton.dataset.storyScriptReview, scriptButton.dataset.storyScriptDecision);
        return;
      }
      if (event.target.closest('[data-story-execution-mode]')) {
        toggleExecutionMode(event.target.closest('[data-story-execution-mode]').dataset.storyExecutionMode);
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
    const strictReview = saved.executionMode === 'review-required';
    const allReviewed = !strictReview || !readiness.pendingScriptRules?.length;
    const complete = allReviewed && !readiness.compatibilityAcknowledgementPending;
    element.className = `story-custom-approvals ${complete ? 'is-complete' : 'is-pending'}`;
    element.append(createCompatibilityHeading(complete, { createElement }));
    if (rules.length) element.append(scriptControls.createExecutionModeNotice(saved.executionMode, rules.length));

    if (sourceRuntimeBlocked) {
      element.append(createSafeDerivativeNotice(review, { createElement }));
    }
    if (Array.isArray(review?.differences) && review.differences.length) {
      element.append(createCompatibilityDifferencesNotice(review.differences, documentObject));
    }

    if (rules.length) {
      const list = createElement('div');
      list.className = 'story-custom-approval-list';
      rules.forEach((rule) => list.append(scriptControls.createScriptCard(rule, findCurrentScriptReview(saved, rule, matches))));
      element.append(list);
    }
    if (review.requiresCompatibilityAcknowledgement) {
      element.append(createCompatibilityAcknowledgement(review, matches && saved.acknowledgeCompatibility, {
        createElement,
        createButton
      }));
    }
  }
  function reviewScript(scriptId, decision) {
    const readiness = getReadiness();
    const rule = (readiness.compatibilityReview?.rules || []).find((item) => String(item.scriptId || '') === String(scriptId || ''));
    if (!rule?.contentHash || !['approved', 'rejected'].includes(String(decision))) return;
    const actionLabel = decision === 'approved' ? '批准受控运行' : '保持禁用';
    if (!confirmAction(`确认${actionLabel}《${rule.name || rule.scriptId}》？\n\n内容哈希：${rule.contentHash}\n风险：${getScriptRiskLabel(rule.riskLevel)}\n\n此结论仅对该内容哈希有效。`)) return;
    const note = promptAction('填写审核说明（至少 8 个字符，会保存在本地审计记录中）', '已核对脚本来源、内容哈希与风险说明。');
    if (note === null || String(note || '').trim().length < 8) return;
    const current = createCustomStoryCompatibilityReview(state.customStoryDraft.compatibilityReview);
    const reviews = current.fingerprint === readiness.compatibilityReview.fingerprint
      ? current.scriptReviews.filter((item) => item.scriptId !== String(scriptId))
      : [];
    reviews.push({
      scriptId: String(scriptId),
      contentHash: String(rule.contentHash),
      decision,
      note: String(note).trim()
    });
    state.customStoryDraft.compatibilityReview = createCustomStoryCompatibilityReview({
      fingerprint: readiness.compatibilityReview.fingerprint,
      scriptReviews: reviews,
      executionMode: current.executionMode,
      acknowledgeCompatibility: current.fingerprint === readiness.compatibilityReview.fingerprint
        ? current.acknowledgeCompatibility
        : false,
      acknowledgeDeveloperRisk: current.fingerprint === readiness.compatibilityReview.fingerprint
        ? current.acknowledgeDeveloperRisk
        : false
    });
    persistDraft();
    renderReadiness();
  }

  function toggleExecutionMode(requestedMode) {
    const readiness = getReadiness();
    const review = readiness.compatibilityReview;
    if (!review?.fingerprint) return;
    const current = createCustomStoryCompatibilityReview(state.customStoryDraft.compatibilityReview);
    const executionMode = ['local-observe', 'compatibility-probe', 'review-required'].includes(requestedMode)
      ? requestedMode
      : current.executionMode === 'review-required' ? 'local-observe' : 'review-required';
    const message = executionMode === 'compatibility-probe'
      ? '启用开发兼容探针？\n\n它会在隔离 iframe 中开放外部资源、网络、表单、嵌套页面与 Worker，用于本地验证酒馆角色卡。第三方内容可能读取受限渲染上下文并上传到网络；不会获得主页面、存档、Provider 密钥或本机命令权限。'
      : executionMode === 'local-observe'
        ? '启用本地探索运行？脚本仍仅在无网络、无宿主数据权限的隔离沙箱执行，启动与错误会记录到本地审计。'
        : '切换为严格逐项审批？未逐项授权的脚本将不再执行。';
    if (!confirmAction(message)) return;
    state.customStoryDraft.compatibilityReview = createCustomStoryCompatibilityReview({
      fingerprint: review.fingerprint,
      scriptReviews: current.fingerprint === review.fingerprint ? current.scriptReviews : [],
      executionMode,
      acknowledgeCompatibility: current.fingerprint === review.fingerprint
        ? current.acknowledgeCompatibility
        : false,
      acknowledgeDeveloperRisk: executionMode === 'compatibility-probe'
    });
    persistDraft();
    renderReadiness();
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
        : `确认按安全兼容策略创建？\n\n降级能力 ${Number(counts.degraded || 0)} 项。可隔离脚本会以本地观察模式运行并记录；无法隔离的未知代码仍保持禁用。`
    )) return;
    const current = createCustomStoryCompatibilityReview(state.customStoryDraft.compatibilityReview);
    state.customStoryDraft.compatibilityReview = createCustomStoryCompatibilityReview({
      fingerprint: review.fingerprint,
      scriptReviews: current.fingerprint === review.fingerprint ? current.scriptReviews : [],
      executionMode: current.executionMode,
      acknowledgeCompatibility: true,
      acknowledgeDeveloperRisk: current.fingerprint === review.fingerprint
        ? current.acknowledgeDeveloperRisk
        : false
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

  return { bindEvents, render };
}
