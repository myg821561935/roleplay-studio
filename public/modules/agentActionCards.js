import { escapeHtmlText } from './utils.js';

export function renderAgentActionCards(text) {
  if (!text) return text;
  // 解析 [System: xxx] 格式
  let parsed = text.replace(/\[System:\s*(.*?)\]/gi, (match, action) => {
    return `\n<div class="agent-action-card"><span class="action-icon">⚙️</span><div class="action-body"><span class="action-label">系统动作</span><strong class="action-name">${escapeHtmlText(action)}</strong></div></div>\n`;
  });

  // 解析单行 JSON {"action": "xxx", ...}
  parsed = parsed.replace(/^\{"action":\s*"([^"]+)"(?:,\s*"[^"]+":\s*"[^"]*")*\}\s*$/gm, (match, action) => {
    return `\n<div class="agent-action-card"><span class="action-icon">⚡</span><div class="action-body"><span class="action-label">Agent 调用</span><strong class="action-name">${escapeHtmlText(action)}</strong></div></div>\n`;
  });

  return parsed;
}
