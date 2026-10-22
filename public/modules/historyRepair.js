export function createHistoryRepairController({ container, documentObject = globalThis.document, apiRequest, getCurrentSessionId, onOpenCopy = () => {} }) {
  if (!container) return { render() {} };
  let sessionId, plan, busy = false, copy = null, error = '', epoch = 0;
  const element = (tag, text = '') => { const el = documentObject.createElement(tag); el.textContent = text; return el; };
  const name = element('input'); name.type = 'text'; name.placeholder = '已确认的玩家角色姓名'; name.setAttribute('aria-label', '修复使用的玩家角色姓名');
  const budget = element('input'); budget.type = 'number'; budget.placeholder = '留空沿用当前预算'; budget.setAttribute('aria-label', '修复副本上下文预算'); budget.min = '1000'; budget.max = '1000000';
  const preview = element('button', '预览历史人称修复'); preview.type = 'button';
  const apply = element('button', '按预览创建修复副本'); apply.type = 'button';
  const open = element('button', '打开修复副本'); open.type = 'button';
  const review = element('div'); review.className = 'history-repair-review'; const status = element('p'); status.setAttribute('role', 'status');
  const detail = element('details'); detail.append(element('summary', '历史人称修复（先预览，再创建副本）'), element('p', '只提出旁白中的人称替换，逐条检查后创建独立副本。引号、代码或标签不完整的消息会跳过。原存档保留。'), name, budget, preview, review, apply, open, status);
  container.append(detail);
  const reset = () => { epoch++; plan = null; copy = null; error = ''; };
  name.addEventListener('input', () => { reset(); render(); });
  budget.addEventListener('input', () => { copy = null; render(); });
  async function run(kind) {
    if (busy || (kind === 'apply' && !plan)) return;
    busy = true; error = ''; const requestedId = getCurrentSessionId(), requestEpoch = epoch;
    render();
    try {
      const body = kind === 'preview' ? { playerName: name.value } : { playerName: plan.playerName, sourceHash: plan.sourceHash, ...(budget.value ? { maxPromptTokens: Number(budget.value) } : {}) };
      const payload = await apiRequest(`/api/sessions/${encodeURIComponent(requestedId)}/history-repair/${kind}`, { method: 'POST', body });
      if (requestedId !== getCurrentSessionId() || requestEpoch !== epoch) return;
      if (kind === 'preview') { plan = payload.plan; copy = null; } else copy = payload.copy;
    } catch (e) { if (requestedId === getCurrentSessionId() && requestEpoch === epoch) { error = e.message || String(e); if (kind === 'apply') plan = null; } }
    finally { busy = false; render(); }
  }
  preview.addEventListener('click', () => { void run('preview'); });
  apply.addEventListener('click', () => { void run('apply'); });
  open.addEventListener('click', () => { if (copy) void onOpenCopy(copy.id); });
  function render() {
    if (sessionId !== getCurrentSessionId()) { sessionId = getCurrentSessionId(); reset(); name.value = ''; budget.value = ''; }
    name.disabled = budget.disabled = preview.disabled = busy;
    apply.hidden = !plan || !plan.changes?.length || Boolean(copy); apply.disabled = busy;
    open.hidden = !copy; review.replaceChildren();
    if (plan) {
      review.append(element('p', `${plan.changes.length} 条消息待修改；${plan.skipped.length} 条跳过。`));
      for (const change of plan.changes) { const row = element('details'); row.append(element('summary', `消息 ${change.messageId} · ${change.edits.length} 处替换`), element('p', '修改前'), element('pre', change.before), element('p', '修改后'), element('pre', change.after)); review.append(row); }
      for (const skipped of plan.skipped) review.append(element('p', `跳过 ${skipped.messageId || ''}：${skipped.reason || skipped.skipped || ''}`));
    }
    status.textContent = error || (busy ? '正在处理…' : copy ? `已创建：${copy.title}` : '');
  }
  return { render };
}
