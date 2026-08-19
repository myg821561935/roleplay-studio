// 时间线分支面板控制器（p2-02d）：
// - 分支树视图（缩进层级）、切换/重命名/删除/对比
// - 消息工具栏「从此处分支」入口（走 messageActions 注入的回调）
// - 切换分支后由调用方 replaceSession + renderMessages 刷新对话区

import { humanizeApiError } from './utils.js';

export function createTimelineController({
  state,
  els,
  apiRequest,
  getCurrentSessionId = () => 'main',
  replaceSession = () => state.session,
  renderMessages = () => {},
  refreshInspector = () => {},
  setStatus = () => {},
  documentObject = globalThis.document,
  promptUser = (message, initialValue) => globalThis.window?.prompt?.(message, initialValue),
  confirmUser = (message) => globalThis.window?.confirm?.(message)
} = {}) {
  let pending = false;

  function createElement(tagName, className) {
    const element = documentObject.createElement(tagName);
    if (className) element.className = className;
    return element;
  }

  function isBusy() {
    return Boolean(state.chatStreaming || state.conversationActionPending || pending);
  }

  function timelineBase() {
    return `/api/sessions/${encodeURIComponent(getCurrentSessionId())}/timeline`;
  }

  async function loadTimeline() {
    if (!els.timelineBranchList) return null;
    try {
      const payload = await apiRequest(timelineBase());
      renderBranchList(payload.branches || [], payload.activeBranchId || 'root');
      return payload;
    } catch (error) {
      setStatus(els.appStatus, `时间线加载失败：${humanizeApiError(error)}`, 'error');
      return null;
    }
  }

  // —— 分支树渲染（缩进 = 层级深度） ——

  function renderBranchList(branches, activeBranchId) {
    const list = els.timelineBranchList;
    list.innerHTML = '';
    if (!branches.length) {
      const empty = createElement('div', 'empty-state');
      empty.style.padding = '12px';
      empty.textContent = '当前会话还没有分支。在消息工具栏点「分支」即可从任意位置开新线。';
      list.append(empty);
      return;
    }

    // 深度：沿 parentBranchId 链上溯（带环保护）
    const depthOf = (branch) => {
      let depth = 0;
      let cursor = branch;
      const seen = new Set();
      while (cursor?.parentBranchId && !seen.has(cursor.id)) {
        seen.add(cursor.id);
        cursor = branches.find((b) => b.id === cursor.parentBranchId);
        depth += 1;
      }
      return depth;
    };

    branches.forEach((branch) => {
      const row = createElement('div', 'timeline-branch-row' + (branch.isActive ? ' active' : ''));
      row.style.marginLeft = `${Math.min(depthOf(branch), 6) * 14}px`;
      row.dataset.branchId = branch.id;

      const main = createElement('div', 'timeline-branch-main');

      const name = createElement('button', 'timeline-branch-name' + (branch.isActive ? ' active' : ''));
      name.type = 'button';
      name.textContent = `${branch.label}（${branch.messageCount} 条）`;
      name.title = branch.isActive ? '当前活跃分支' : `切换到「${branch.label}」`;
      name.dataset.timelineSwitch = branch.id;
      main.append(name);

      if (branch.isActive) {
        const badge = createElement('span', 'timeline-branch-badge');
        badge.textContent = '当前';
        main.append(badge);
      }
      row.append(main);

      const preview = createElement('div', 'timeline-branch-preview');
      preview.textContent = branch.lastMessagePreview || '（暂无消息）';
      row.append(preview);

      const tools = createElement('div', 'timeline-branch-tools');
      tools.append(createToolButton('timelineRename', branch.id, '重命名'));

      if (!branch.isActive) {
        const compare = createToolButton('timelineCompare', branch.id, '对比');
        compare.title = '与当前活跃分支对比';
        tools.append(compare);
      }
      if (!branch.isRoot && !branch.isActive && !branch.childCount) {
        const del = createToolButton('timelineDelete', branch.id, '删除');
        del.title = '删除该分支（不可恢复）';
        tools.append(del);
      }
      row.append(tools);
      list.append(row);
    });
  }

  function createToolButton(datasetKey, branchId, label) {
    const button = createElement('button', 'ghost-button compact');
    button.type = 'button';
    button.dataset[datasetKey] = branchId;
    button.textContent = label;
    return button;
  }

  // —— 操作 ——

  async function runTimelineMutation({ path, method = 'POST', body = {}, pendingMessage, successMessage, errorPrefix }) {
    if (isBusy()) {
      setStatus(els.sessionStatus, '上一项时间线操作仍在处理中，请稍候', 'busy');
      return null;
    }
    pending = true;
    if (pendingMessage) setStatus(els.sessionStatus, pendingMessage, 'busy');
    try {
      const payload = await apiRequest(path, { method, body });
      replaceSession(payload.session, { fallback: state.session });
      renderMessages();
      refreshInspector();
      await loadTimeline();
      setStatus(els.appStatus, successMessage, 'ok');
      return payload;
    } catch (error) {
      setStatus(els.sessionStatus, `${errorPrefix}：${humanizeApiError(error)}`, 'error');
      return null;
    } finally {
      pending = false;
    }
  }

  async function forkFromMessage(messageId, { label = '', switchTo = false } = {}) {
    if (!messageId) return null;
    return runTimelineMutation({
      path: `${timelineBase()}/fork`,
      body: { messageId, label, switchTo },
      pendingMessage: '正在创建分支...',
      successMessage: switchTo ? '已创建并切换到新分支' : '分支已创建（在时间线面板查看）',
      errorPrefix: '创建分支失败'
    });
  }

  // 消息工具栏入口：命名 + 是否立即切换，然后走 fork
  async function forkFromMessageDialog(message) {
    if (!message?.id) return null;
    if (isBusy()) {
      setStatus(els.sessionStatus, '上一项操作仍在处理中，请稍候', 'busy');
      return null;
    }
    const label = promptUser('为分支命名（可留空，默认自动编号）', '');
    if (label === null || label === undefined) return null;
    const switchTo = confirmUser
      ? confirmUser('是否立即切换到新分支继续剧情？（取消则留在当前分支）')
      : false;
    return forkFromMessage(message.id, { label: String(label || '').trim(), switchTo });
  }

  async function switchBranch(branchId) {
    if (!branchId) return null;
    return runTimelineMutation({
      path: `${timelineBase()}/switch`,
      body: { branchId },
      pendingMessage: '正在切换分支...',
      successMessage: '已切换分支',
      errorPrefix: '切换分支失败'
    });
  }

  async function renameBranch(branchId) {
    const row = els.timelineBranchList?.querySelector?.(`[data-branch-id="${branchId}"]`);
    const currentLabel = row?.querySelector?.('.timeline-branch-name')?.textContent?.replace(/（\d+ 条）$/, '') || '';
    const label = promptUser('为分支命名', currentLabel);
    if (label === null || label === undefined || !String(label).trim()) return null;
    return runTimelineMutation({
      path: `${timelineBase()}/branches/${encodeURIComponent(branchId)}`,
      method: 'PATCH',
      body: { label: String(label).trim() },
      pendingMessage: '正在重命名...',
      successMessage: '分支已重命名',
      errorPrefix: '重命名失败'
    });
  }

  async function deleteBranch(branchId) {
    if (!branchId) return null;
    const row = els.timelineBranchList?.querySelector?.(`[data-branch-id="${branchId}"]`);
    const label = row?.querySelector?.('.timeline-branch-name')?.textContent?.replace(/（\d+ 条）$/, '') || '该分支';
    if (confirmUser && !confirmUser(`确定删除「${label}」？该分支的消息将不可恢复。`)) return null;
    return runTimelineMutation({
      path: `${timelineBase()}/branches/${encodeURIComponent(branchId)}`,
      method: 'DELETE',
      body: {},
      pendingMessage: '正在删除分支...',
      successMessage: '分支已删除',
      errorPrefix: '删除失败'
    });
  }

  // —— 对比视图 ——

  async function compareWithActive(branchId) {
    if (!branchId || !els.timelineCompareResult) return null;
    const activeId = state.session?.timeline?.activeBranchId || 'root';
    try {
      setStatus(els.sessionStatus, '正在对比分支...', 'busy');
      const payload = await apiRequest(`${timelineBase()}/compare?leftId=${encodeURIComponent(activeId)}&rightId=${encodeURIComponent(branchId)}`);
      renderCompareResult(payload);
      setStatus(els.sessionStatus, '', 'ok');
      return payload;
    } catch (error) {
      setStatus(els.sessionStatus, `对比失败：${humanizeApiError(error)}`, 'error');
      return null;
    }
  }

  function renderCompareResult(payload) {
    const box = els.timelineCompareResult;
    box.hidden = false;
    box.innerHTML = '';

    const header = createElement('div', 'timeline-compare-header');
    header.textContent = payload.forkMessage
      ? `分叉于「${payload.forkMessage.content || payload.forkMessage.id}」之后（第 ${payload.forkIndex} 条消息）`
      : '两分支没有共同消息';
    box.append(header);

    const grid = createElement('div', 'timeline-compare-grid');
    grid.append(renderCompareColumn(payload.left.label, payload.left.messageCount, payload.left.tail));
    grid.append(renderCompareColumn(payload.right.label, payload.right.messageCount, payload.right.tail));
    box.append(grid);

    const close = createElement('button', 'ghost-button compact');
    close.type = 'button';
    close.textContent = '关闭对比';
    close.addEventListener('click', () => {
      box.hidden = true;
      box.innerHTML = '';
    });
    box.append(close);
  }

  function renderCompareColumn(label, messageCount, tail) {
    const col = createElement('div', 'timeline-compare-column');

    const head = createElement('div', 'timeline-compare-column-head');
    head.textContent = `${label}（${messageCount} 条）`;
    col.append(head);

    if (!tail.length) {
      const empty = createElement('div', 'timeline-compare-empty');
      empty.textContent = '分叉点后暂无消息';
      col.append(empty);
      return col;
    }
    tail.forEach((message) => {
      const item = createElement('div', 'timeline-compare-message ' + (message.role === 'assistant' ? 'assistant' : 'user'));
      item.textContent = message.content || '（无内容）';
      item.title = `${message.role} · ${message.createdAt || ''}`;
      col.append(item);
    });
    return col;
  }

  // —— 事件委托 ——

  function handleTimelineClick(event) {
    const routes = [
      ['[data-timeline-switch]', 'timelineSwitch', (id) => switchBranch(id)],
      ['[data-timeline-rename]', 'timelineRename', (id) => renameBranch(id)],
      ['[data-timeline-delete]', 'timelineDelete', (id) => deleteBranch(id)],
      ['[data-timeline-compare]', 'timelineCompare', (id) => compareWithActive(id)]
    ];
    for (const [selector, datasetKey, handler] of routes) {
      const control = event.target?.closest?.(selector);
      if (!control) continue;
      void handler(control.dataset[datasetKey]);
      return;
    }
  }

  function bindEvents() {
    els.timelineBranchList?.addEventListener?.('click', handleTimelineClick);
    els.timelineRefresh?.addEventListener?.('click', () => loadTimeline());
  }

  return {
    bindEvents,
    loadTimeline,
    forkFromMessage,
    forkFromMessageDialog,
    switchBranch,
    renameBranch,
    deleteBranch,
    compareWithActive,
    renderBranchList,
    handleTimelineClick
  };
}
