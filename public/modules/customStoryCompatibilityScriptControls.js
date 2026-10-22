import { reviewLabel } from './customStoryCompatibilityReviewState.js';

export function getScriptRiskLabel(level) {
  return { high: '高风险', medium: '中风险', low: '低风险' }[level] || '待人工判断';
}

export function createCustomStoryScriptControls({ createElement, createButton } = {}) {
  function createScriptCard(rule, scriptReview = null) {
    const hash = String(rule.contentHash || '');
    const sourceText = String(rule.source || '');
    const card = createElement('article');
    const decision = String(scriptReview?.decision || 'pending');
    card.className = `story-custom-approval-card is-${decision}`;
    const copy = createElement('div');
    const meta = createElement('small', `${reviewLabel(decision)} · ${hash ? `${hash.slice(0, 18)}…` : '缺少内容哈希'}`);
    const risks = createElement(
      'p',
      `检测到第三方脚本${rule.riskLevel ? `（${getScriptRiskLabel(rule.riskLevel)}）` : ''}。本地观察仅在无网络、无宿主权限的 iframe 沙箱中运行；“拒绝”会立即停用当前内容哈希。`
    );
    const details = createElement('details');
    details.className = 'story-custom-script-source';
    const pattern = createElement('small', `匹配：${String(rule.pattern || '未声明')} · 作用域：${String(rule.scope || 'assistant')}`);
    const source = createElement('pre', sourceText || '未提供脚本正文');
    details.append(createElement('summary', '查看沙箱执行内容'), pattern, source);
    copy.append(createElement('strong', String(rule.name || rule.scriptId || '未命名第三方脚本')), meta, risks, details);
    if (scriptReview?.note) copy.append(createElement('small', `审核说明：${scriptReview.note}`));
    const actions = createElement('div');
    actions.className = 'story-custom-script-actions';
    actions.append(
      createScriptReviewButton('批准受控运行', rule, 'approved', decision === 'approved'),
      createScriptReviewButton('保持禁用', rule, 'rejected', decision === 'rejected')
    );
    copy.append(actions);
    card.append(copy);
    return card;
  }

  function createExecutionModeNotice(executionMode, ruleCount) {
    const notice = createElement('div');
    notice.className = `story-custom-execution-mode is-${executionMode}`;
    const strict = executionMode === 'review-required';
    const compatibilityProbe = executionMode === 'compatibility-probe';
    notice.append(
      createElement('strong', strict ? '严格逐项审批' : compatibilityProbe ? '开发兼容探针' : '本地探索运行'),
      createElement('span', strict
        ? `${ruleCount} 条脚本必须逐项批准后才会运行。`
        : compatibilityProbe
          ? `${ruleCount} 条脚本可使用隔离 iframe 的外部资源、网络、表单、嵌套页面与 Worker；主页面、存档、Provider 密钥与本机命令仍不可访问，启动与错误会审计。`
          : `${ruleCount} 条脚本默认在隔离沙箱内观察运行；可逐项拒绝或切换为严格审批。`)
    );
    const actions = createElement('div');
    actions.className = 'story-custom-script-actions';
    const options = strict
      ? [['启用本地探索', 'local-observe'], ['启用开发探针', 'compatibility-probe']]
      : compatibilityProbe
        ? [['退出探针', 'local-observe'], ['切换严格审批', 'review-required']]
        : [['启用开发探针', 'compatibility-probe'], ['切换严格审批', 'review-required']];
    options.forEach(([label, mode]) => {
      const button = createButton(label);
      button.dataset.storyExecutionMode = mode;
      actions.append(button);
    });
    notice.append(actions);
    return notice;
  }

  function createScriptReviewButton(label, rule, decision, active) {
    const button = createButton(active ? `已${label}` : label);
    button.disabled = active;
    button.dataset.storyScriptReview = String(rule.scriptId || '');
    button.dataset.storyScriptDecision = decision;
    return button;
  }

  return { createScriptCard, createExecutionModeNotice };
}
