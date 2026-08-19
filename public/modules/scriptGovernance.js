import { applyLightFrontendDisplayTransforms } from './lightFrontend.js';
import { renderNarrativeMarkdown } from './narrativeText.js';
import {
  applySandboxTransforms,
  assessScriptRisk,
  mountSandboxedContent
} from './sandboxRenderer.js';

const POLICY_VERSION = 1;

export function createScriptGovernanceController({
  elements,
  getSessionId,
  setSession,
  getRuntime,
  syncRuntime,
  apiRequest,
  setStatus,
  onOpenAudit,
  confirmAction = (message) => window.confirm(message),
  humanizeError = (error) => error?.message || String(error),
  documentObject = globalThis.document
}) {
  const auditList = elements?.auditList;
  const auditEmpty = elements?.auditEmpty;
  const auditCount = elements?.auditCount;
  const auditPanel = elements?.auditPanel;
  const statusElement = elements?.status;
  const pendingExecutionAudits = [];
  let executionAuditTimer = null;

  function renderAuditPanel() {
    if (!auditList) return;
    const runtime = getRuntime() || {};
    const rules = getSandboxRules(runtime);
    const reviews = Array.isArray(runtime.scriptReviews) ? runtime.scriptReviews : [];
    const pendingCount = rules.filter((rule) => !isCurrentApproval(rule, findLatestReview(reviews, rule.id))).length;
    if (auditCount) {
      auditCount.hidden = pendingCount === 0;
      auditCount.textContent = pendingCount ? `${pendingCount} 待处理` : '';
    }

    auditList.innerHTML = '';
    if (!rules.length) {
      if (auditEmpty) auditEmpty.style.display = '';
      return;
    }
    if (auditEmpty) auditEmpty.style.display = 'none';

    for (const rule of rules.slice(0, 32)) {
      const risk = assessScriptRisk(String(rule.replacement || ''));
      const latestReview = findLatestReview(reviews, rule.id);
      const approved = isCurrentApproval(rule, latestReview);
      const stale = Boolean(latestReview && latestReview.contentHash !== rule.contentHash);
      const item = documentObject.createElement('div');
      item.className = `sandbox-audit-item sandbox-risk-${risk.level}`;
      item.dataset.ruleId = rule.id;

      const header = documentObject.createElement('div');
      header.className = 'sandbox-audit-header';
      const name = documentObject.createElement('span');
      name.className = 'sandbox-audit-name';
      name.textContent = rule.name || rule.id || '未命名规则';
      const level = documentObject.createElement('span');
      level.className = `sandbox-risk-badge sandbox-risk-${risk.level}`;
      level.textContent = risk.level === 'high' ? '高风险' : risk.level === 'medium' ? '中风险' : '低风险';
      header.append(name, level);

      const meta = documentObject.createElement('div');
      meta.className = 'sandbox-audit-meta';
      const hashLabel = rule.contentHash ? ` · ${rule.contentHash.slice(0, 20)}…` : ' · 尚未生成内容哈希';
      meta.textContent = `ID: ${rule.id}${hashLabel}${rule.scope ? ` · 作用域: ${rule.scope}` : ''}`;

      const reviewStatus = documentObject.createElement('div');
      reviewStatus.className = 'sandbox-audit-summary';
      reviewStatus.textContent = approved
        ? `已授权执行 · ${latestReview.reviewer || 'local-user'} · ${formatReviewTime(latestReview.reviewedAt)}`
        : stale
          ? '脚本内容已变化，旧审核已自动失效'
          : latestReview?.decision === 'rejected'
            ? '已拒绝执行'
            : latestReview?.decision === 'revoked'
              ? '授权已撤销'
              : '等待人工审核，当前不会执行';

      const summary = documentObject.createElement('div');
      summary.className = 'sandbox-audit-summary';
      summary.textContent = risk.summary;

      const risks = documentObject.createElement('div');
      risks.className = 'sandbox-audit-risks';
      risks.textContent = risk.risks.length ? risk.risks.join('；') : '无可识别风险';

      const actions = documentObject.createElement('div');
      actions.className = 'sandbox-audit-actions';
      if (approved) {
        actions.append(createReviewButton(documentObject, '撤销执行授权', 'ghost-button compact', () => {
          setScriptReview(rule, 'revoked', risk);
        }));
      } else {
        actions.append(
          createReviewButton(documentObject, '审核并允许', 'primary-button compact', () => {
            setScriptReview(rule, 'approved', risk);
          }),
          createReviewButton(documentObject, '拒绝', 'ghost-button compact', () => {
            setScriptReview(rule, 'rejected', risk);
          })
        );
      }

      item.append(header, meta, reviewStatus, summary, risks, actions);
      auditList.append(item);
    }
  }

  async function setScriptReview(rule, decision, risk) {
    if (decision === 'approved') {
      const accepted = confirmAction([
        `确认允许脚本「${rule.name || rule.id}」执行？`,
        `风险等级：${risk.level}`,
        risk.risks.length ? `风险：${risk.risks.join('；')}` : '未识别到明确高危行为。',
        '授权只绑定当前内容哈希；脚本内容变化后会自动失效。'
      ].join('\n'));
      if (!accepted) return;
    }

    try {
      const payload = await apiRequest(
        `/api/sessions/${encodeURIComponent(getSessionId())}/script-reviews`,
        {
          method: 'PUT',
          body: {
            scriptId: rule.id,
            decision,
            reviewer: 'local-user'
          }
        }
      );
      if (payload.session) {
        setSession(payload.session);
        syncRuntime?.(payload.session.config?.lightFrontend || {});
      }
      renderAuditPanel();
      setStatus?.(
        statusElement,
        decision === 'approved' ? '脚本已按当前内容哈希授权' : '脚本执行授权已更新',
        decision === 'approved' ? 'ok' : ''
      );
    } catch (error) {
      setStatus?.(statusElement, `脚本审核更新失败：${humanizeError(error)}`, 'error');
    }
  }

  function renderMessageContent({
    container,
    visibleContent,
    role,
    context,
    messageId = ''
  }) {
    const runtime = getRuntime() || {};
    const {
      text: sandboxedText,
      sandboxFragments,
      blockedAssessments
    } = applySandboxTransforms(
      visibleContent,
      runtime.regexTransforms,
      runtime.scriptReviews,
      { role, ...context }
    );
    const displayContent = applyLightFrontendDisplayTransforms(sandboxedText, runtime, {
      role,
      context
    });
    container.innerHTML = renderNarrativeMarkdown(displayContent, {
      role,
      speaker: context?.speaker || '',
      portraitBySpeaker: context?.portraitBySpeaker || {}
    });

    if (blockedAssessments.length) {
      const blocked = documentObject.createElement('div');
      blocked.className = 'sandbox-risk-notice sandbox-risk-high';
      const names = blockedAssessments.map((item) => item.name || item.id).filter(Boolean);
      const summary = documentObject.createElement('span');
      summary.className = 'sandbox-risk-copy';
      summary.textContent = `${blockedAssessments.length} 个第三方脚本等待审核，本次未执行${names.length ? `：${names.slice(0, 2).join('、')}${names.length > 2 ? '等' : ''}` : ''}`;
      blocked.title = blockedAssessments.map((item) => `${item.name || item.id}: ${item.summary}`).join('\n');
      blocked.append(summary);
      if (typeof onOpenAudit === 'function') {
        const openAudit = documentObject.createElement('button');
        openAudit.type = 'button';
        openAudit.className = 'ghost-button compact sandbox-review-link';
        openAudit.textContent = '查看并审核';
        openAudit.addEventListener('click', () => onOpenAudit(blockedAssessments));
        blocked.append(openAudit);
      }
      container.prepend(blocked);
    }

    for (const [placeholder, fragment] of sandboxFragments) {
      const wrapper = documentObject.createElement('div');
      wrapper.className = 'sandbox-wrapper';
      wrapper.dataset.lraSandbox = placeholder;

      const notice = documentObject.createElement('div');
      notice.className = `sandbox-risk-notice sandbox-risk-${fragment.risk.level}`;
      notice.textContent = `${fragment.risk.level === 'high' ? '⚠' : fragment.risk.level === 'medium' ? '⚡' : '✓'} ${fragment.risk.summary}`;
      notice.title = fragment.risk.risks.join('\n');
      wrapper.append(notice);

      const frameHost = documentObject.createElement('div');
      frameHost.className = 'sandbox-frame-host';
      wrapper.append(frameHost);
      const mounted = replacePlaceholder(container, placeholder, wrapper);
      if (!mounted) continue;
      mountSandboxedContent(frameHost, fragment.html, { role, ...context }, {
        onAudit: ({ status }) => recordExecution({
          scriptId: fragment.scriptId,
          contentHash: fragment.contentHash,
          status,
          messageId
        })
      });
    }
  }

  function recordExecution({ scriptId, contentHash, status, messageId }) {
    const sessionId = getSessionId();
    if (!sessionId || !scriptId || !contentHash) return;
    pendingExecutionAudits.push({
      sessionId,
      scriptId,
      contentHash,
      status,
      messageId
    });
    if (executionAuditTimer !== null) return;
    executionAuditTimer = window.setTimeout(flushExecutionAudits, 50);
  }

  function focusAuditRule(scriptId) {
    const targetId = String(scriptId || '');
    const target = Array.from(auditList?.children || [])
      .find((item) => item.dataset?.ruleId === targetId);
    target?.classList?.add('is-focused');
    (target || auditPanel)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    target?.querySelector?.('button')?.focus?.({ preventScroll: true });
  }

  function flushExecutionAudits() {
    executionAuditTimer = null;
    if (!pendingExecutionAudits.length) return;
    const sessionId = pendingExecutionAudits[0].sessionId;
    const batch = [];
    for (let index = 0; index < pendingExecutionAudits.length && batch.length < 100;) {
      if (pendingExecutionAudits[index].sessionId === sessionId) {
        batch.push(...pendingExecutionAudits.splice(index, 1));
      } else {
        index += 1;
      }
    }
    fetch(`/api/sessions/${encodeURIComponent(sessionId)}/script-executions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        executions: batch.map(({ scriptId, contentHash, status, messageId }) => ({
          scriptId,
          contentHash,
          status,
          messageId
        }))
      }),
      keepalive: true
    }).catch(() => {
      // Rendering remains available when the local service is shutting down.
    });
    if (pendingExecutionAudits.length) {
      executionAuditTimer = window.setTimeout(flushExecutionAudits, 50);
    }
  }

  return {
    renderAuditPanel,
    renderMessageContent,
    focusAuditRule,
    setScriptReview
  };
}

function getSandboxRules(runtime) {
  return (Array.isArray(runtime?.regexTransforms) ? runtime.regexTransforms : [])
    .filter((rule) => rule?.requiresSandbox === true && rule.enabled !== false);
}

function findLatestReview(reviews, scriptId) {
  for (let index = reviews.length - 1; index >= 0; index -= 1) {
    if (String(reviews[index]?.scriptId || '') === String(scriptId || '')) return reviews[index];
  }
  return null;
}

function isCurrentApproval(rule, review) {
  return Boolean(
    review
    && review.decision === 'approved'
    && review.contentHash === rule.contentHash
    && Number(review.policyVersion) === POLICY_VERSION
  );
}

function createReviewButton(documentObject, label, className, onClick) {
  const button = documentObject.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function replacePlaceholder(container, placeholder, replacement) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const index = node.textContent.indexOf(placeholder);
    if (index < 0) continue;
    const before = node.textContent.slice(0, index);
    const after = node.textContent.slice(index + placeholder.length);
    const nodes = [];
    if (before) nodes.push(document.createTextNode(before));
    nodes.push(replacement);
    if (after) nodes.push(document.createTextNode(after));
    node.replaceWith(...nodes);
    return true;
  }
  return false;
}

function formatReviewTime(value) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '时间未知';
  return new Date(timestamp).toLocaleString('zh-CN');
}
