export function promptBudgetErrorDetail(error) {
  if (error?.code !== 'PROMPT_BUDGET_INSUFFICIENT') return '';
  const required = Number(error.requiredTokens);
  return `当前上下文预算不足${Number.isFinite(required) && required > 0 ? `，完整装入原卡和预设至少需要约 ${Math.ceil(required)} tokens` : ''}。请在会话设置提高上下文预算，或减少启用的预设与世界书。本轮尚未调用 Provider，连接测试通过与此不冲突。`;
}
