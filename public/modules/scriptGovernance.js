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
    const executionMode = getExecutionMode(runtime);
    const pendingCount = executionMode === 'review-required'
      ? rules.filter((rule) => !isCurrentApproval(rule, findLatestReview(reviews, rule.id))).length
      : 0;
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
    auditList.append(createExecutionModeNotice(executionMode, rules.length));

    for (const rule of rules.slice(0, 32)) {
      const risk = assessScriptRisk(String(rule.replacement || ''));
      const latestReview = findLatestReview(reviews, rule.id);
      const approved = isCurrentApproval(rule, latestReview);
      const rejected = isCurrentRejection(rule, latestReview);
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
          : rejected
            ? '已拒绝执行'
              : latestReview?.decision === 'revoked'
              ? '授权已撤销'
              : executionMode === 'compatibility-probe'
                ? '开发兼容探针：外部资源与网络仅在隔离 iframe 内开放；启动、加载与错误会记入审计'
                : executionMode === 'local-observe'
                ? '本地探索中：将在隔离沙箱执行并记录事件；可随时拒绝停用'
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
      } else if (rejected) {
        actions.append(createReviewButton(
          documentObject,
          executionMode === 'review-required' ? '审核并允许' : '恢复执行',
          'primary-button compact',
          () => setScriptReview(rule, 'approved', risk)
        ));
      } else {
        actions.append(
          createReviewButton(documentObject, executionMode === 'review-required' ? '审核并允许' : '确认长期授权', 'primary-button compact', () => {
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
        '授权只绑定当前内容哈希；脚本内容变化后会重新进入本地探索观察。'
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

  function createExecutionModeNotice(executionMode, ruleCount) {
    const notice = documentObject.createElement('div');
    notice.className = `sandbox-execution-mode sandbox-execution-mode-${executionMode}`;
    const copy = documentObject.createElement('div');
    const title = documentObject.createElement('strong');
    const description = documentObject.createElement('span');
    const strict = executionMode === 'review-required';
    const compatibilityProbe = executionMode === 'compatibility-probe';
    title.textContent = strict
      ? '严格审批模式'
      : compatibilityProbe ? '开发兼容探针' : '本地探索模式';
    description.textContent = strict
      ? `所有 ${ruleCount} 条脚本须逐项批准才会执行。`
      : compatibilityProbe
        ? `为验证酒馆兼容性，未拒绝脚本可使用子 iframe 的外部资源、网络、表单、嵌套页面与 Worker；不会获得主页面、存档、Provider 密钥或本机命令权限。所有启动、加载和错误均会审计。`
        : `未被明确拒绝的脚本可在无网络、无宿主数据权限的隔离沙箱运行；启动、加载与错误会记入本地审计。`;
    copy.append(title, description);
    const actions = documentObject.createElement('div');
    actions.className = 'sandbox-audit-actions';
    if (strict) {
      actions.append(
        createReviewButton(documentObject, '启用本地探索', 'ghost-button compact', () => setExecutionMode('local-observe')),
        createReviewButton(documentObject, '启用开发探针', 'ghost-button compact', () => setExecutionMode('compatibility-probe'))
      );
    } else if (compatibilityProbe) {
      actions.append(
        createReviewButton(documentObject, '退出探针', 'ghost-button compact', () => setExecutionMode('local-observe')),
        createReviewButton(documentObject, '切换严格审批', 'ghost-button compact', () => setExecutionMode('review-required'))
      );
    } else {
      actions.append(
        createReviewButton(documentObject, '启用开发探针', 'ghost-button compact', () => setExecutionMode('compatibility-probe')),
        createReviewButton(documentObject, '切换严格审批', 'ghost-button compact', () => setExecutionMode('review-required'))
      );
    }
    notice.append(copy, actions);
    return notice;
  }

  async function setExecutionMode(executionMode) {
    if (executionMode === 'compatibility-probe') {
      const accepted = confirmAction([
        '启用开发兼容探针？',
        '此模式会在隔离 iframe 内开放外部资源、网络、表单、嵌套页面与 Worker，用于本地验证酒馆角色卡。',
        '第三方内容可能读取受限渲染上下文并上传到网络；但不会获得主页面 DOM、存档、Provider 密钥或本机命令权限。',
        '仅用于本地调试；完成后请切回本地探索或严格审批。'
      ].join('\n'));
      if (!accepted) return;
    }
    try {
      const payload = await apiRequest(
        `/api/sessions/${encodeURIComponent(getSessionId())}/script-policy`,
        {
          method: 'PUT',
          body: {
            executionMode,
            acknowledgeDeveloperRisk: executionMode === 'compatibility-probe'
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
        executionMode === 'compatibility-probe'
          ? '开发兼容探针已启用：子 iframe 外部能力已开放，审计已开启'
          : executionMode === 'local-observe'
            ? '已启用本地探索：隔离运行与审计已开启'
            : '已切换为严格审批模式',
        'ok'
      );
    } catch (error) {
      setStatus?.(statusElement, `脚本策略更新失败：${humanizeError(error)}`, 'error');
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
      { role, ...context, scriptExecutionMode: getExecutionMode(runtime) }
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
      const rejected = blockedAssessments.filter((item) => item.blockedReason === 'explicitly-rejected').length;
      summary.textContent = rejected
        ? `${rejected} 个第三方脚本已被拒绝，本次未执行${names.length ? `：${names.slice(0, 2).join('、')}${names.length > 2 ? '等' : ''}` : ''}`
        : `${blockedAssessments.length} 个第三方脚本需要严格审批，本次未执行${names.length ? `：${names.slice(0, 2).join('、')}${names.length > 2 ? '等' : ''}` : ''}`;
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
      notice.textContent = getFragmentRiskNotice(fragment.risk, getExecutionMode(runtime));
      notice.title = fragment.risk.risks.join('\n');
      wrapper.append(notice);

      const frameHost = documentObject.createElement('div');
      frameHost.className = 'sandbox-frame-host';
      wrapper.append(frameHost);
      const mounted = replacePlaceholder(container, placeholder, wrapper);
      if (!mounted) continue;
      mountSandboxedContent(frameHost, fragment.html, { role, ...context }, {
        executionMode: getExecutionMode(runtime),
        onAudit: ({ status, errorCode }) => recordExecution({
          scriptId: fragment.scriptId,
          contentHash: fragment.contentHash,
          status,
          errorCode,
          messageId
        })
      });
    }
  }

  function recordExecution({ scriptId, contentHash, status, errorCode = '', messageId }) {
    const sessionId = getSessionId();
    if (!sessionId || !scriptId || !contentHash) return;
    pendingExecutionAudits.push({
      sessionId,
      scriptId,
      contentHash,
      status,
      errorCode,
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
        executions: batch.map(({ scriptId, contentHash, status, errorCode, messageId }) => ({
          scriptId,
          contentHash,
          status,
          errorCode,
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

function isCurrentRejection(rule, review) {
  return Boolean(
    review
    && ['rejected', 'revoked'].includes(review.decision)
    && review.contentHash === rule.contentHash
    && Number(review.policyVersion) === POLICY_VERSION
  );
}

function getExecutionMode(runtime) {
  const mode = String(runtime?.scriptExecutionMode || '').trim().toLowerCase();
  return ['local-observe', 'compatibility-probe', 'review-required'].includes(mode)
    ? mode
    : 'local-observe';
}

function getFragmentRiskNotice(risk, executionMode) {
  const prefix = risk.level === 'high' ? '⚠' : risk.level === 'medium' ? '⚡' : '✓';
  if (executionMode === 'compatibility-probe') {
    return `${prefix} 开发兼容探针已开放子 iframe 的外部资源与网络；${risk.summary}`;
  }
  return `${prefix} ${risk.summary}`;
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
