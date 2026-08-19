import {
  formatTokenCount,
  normalizeTokenNumber
} from './utils.js';

export const USAGE_REFRESH_INTERVAL_MS = 30000;

export function formatUsageTask(taskKey) {
  return ({
    chat: '叙事对话',
    rewrite: '文本改写',
    fact: '事实提取',
    summary: '记忆总结'
  })[String(taskKey || '')] || String(taskKey || '其他任务');
}

export function getAssistantUsageRows(messages = []) {
  return (Array.isArray(messages) ? messages : [])
    .filter((message) => message?.role === 'assistant' && message.usage)
    .map((message) => ({
      providerId: String(message.usage.providerId || ''),
      model: String(message.usage.model || ''),
      promptTokens: normalizeTokenNumber(message.usage.promptTokens),
      completionTokens: normalizeTokenNumber(message.usage.completionTokens),
      totalTokens: normalizeTokenNumber(message.usage.totalTokens),
      injectedCards: normalizeTokenNumber(message.usage.injectedCards),
      estimated: message.usage.estimated !== false
    }));
}

export function summarizeUsageFromMessages(messages = [], sessionId = 'main') {
  const rows = getAssistantUsageRows(messages).map((row, index) => ({
    ...row,
    sessionId,
    messageId: `local-${index}`,
    createdAt: ''
  })).reverse();
  const totals = rows.reduce((acc, row) => {
    acc.calls += 1;
    acc.promptTokens += row.promptTokens;
    acc.completionTokens += row.completionTokens;
    acc.totalTokens += row.totalTokens;
    if (row.estimated) acc.estimatedCalls += 1;
    else acc.providerReportedCalls += 1;
    return acc;
  }, {
    calls: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    estimatedCalls: 0,
    providerReportedCalls: 0
  });
  return {
    scope: 'session',
    sessionId,
    totals,
    byTask: [],
    byProvider: [],
    recent: rows.slice(0, 20)
  };
}

export function createUsageInspectorController({
  state = {},
  els = {},
  apiRequest = async () => ({}),
  getCurrentSessionId = () => 'main',
  setStatus = () => {},
  humanizeApiError = (error) => error?.message || String(error),
  formatTime = () => '',
  documentObject = globalThis.document,
  visibilityDocument = documentObject,
  setIntervalImpl = globalThis.setInterval,
  clearIntervalImpl = globalThis.clearInterval,
  refreshIntervalMs = USAGE_REFRESH_INTERVAL_MS
} = {}) {
  let eventsBound = false;
  let refreshTimer = null;
  let loadRevision = 0;

  function createUsageMetric(label, value) {
    const item = documentObject.createElement('div');
    item.className = 'usage-metric';
    const key = documentObject.createElement('span');
    key.textContent = label;
    const number = documentObject.createElement('strong');
    number.textContent = value;
    item.append(key, number);
    return item;
  }

  function renderUsageView() {
    if (!els.usageView) return;
    const currentSessionId = String(getCurrentSessionId() || 'main');
    const usage = state.usage || summarizeUsageFromMessages(
      state.session?.messages,
      currentSessionId
    );
    els.usageView.replaceChildren?.();
    if (typeof els.usageView.replaceChildren !== 'function') {
      els.usageView.innerHTML = '';
    }

    if (!usage?.totals?.calls) {
      const empty = documentObject.createElement('div');
      empty.className = 'compact-empty';
      empty.textContent = '暂无用量记录。发送一轮消息后会显示本轮 prompt、回复和总 token。';
      els.usageView.append(empty);
      return;
    }

    const summary = documentObject.createElement('div');
    summary.className = 'usage-summary';
    summary.append(
      createUsageMetric('总量', formatTokenCount(usage.totals.totalTokens)),
      createUsageMetric('Prompt', formatTokenCount(usage.totals.promptTokens)),
      createUsageMetric('回复', formatTokenCount(usage.totals.completionTokens)),
      createUsageMetric('调用', String(usage.totals.calls))
    );

    const taskList = documentObject.createElement('div');
    taskList.className = 'usage-provider-list';
    (usage.byTask || []).forEach((row) => {
      const item = documentObject.createElement('article');
      item.className = 'usage-row';
      const title = documentObject.createElement('div');
      title.className = 'usage-row-title';
      title.textContent = `任务 · ${formatUsageTask(row.taskKey)}`;
      const detail = documentObject.createElement('div');
      detail.className = 'usage-row-detail';
      detail.textContent = [
        `调用 ${row.calls}`,
        `总 ${formatTokenCount(row.totalTokens)}`,
        row.fallbackCalls ? `回退 ${row.fallbackCalls}` : ''
      ].filter(Boolean).join(' · ');
      item.append(title, detail);
      taskList.append(item);
    });

    const sessionList = documentObject.createElement('div');
    sessionList.className = 'usage-provider-list usage-session-list';
    (usage.bySession || []).forEach((row) => {
      const item = documentObject.createElement('article');
      item.className = 'usage-row';
      const title = documentObject.createElement('div');
      title.className = 'usage-row-title';
      const label = row.title ? `${row.title}（${row.sessionId}）` : row.sessionId;
      title.textContent = `会话 · ${label}`;
      const detail = documentObject.createElement('div');
      detail.className = 'usage-row-detail';
      detail.textContent = [
        `调用 ${row.calls}`,
        `总 ${formatTokenCount(row.totalTokens)}`,
        `Prompt ${formatTokenCount(row.promptTokens)}`,
        `回复 ${formatTokenCount(row.completionTokens)}`
      ].filter(Boolean).join(' · ');
      item.append(title, detail);
      sessionList.append(item);
    });

    const providerList = documentObject.createElement('div');
    providerList.className = 'usage-provider-list';
    (usage.byProvider || []).forEach((row) => {
      const item = documentObject.createElement('article');
      item.className = 'usage-row';
      const title = documentObject.createElement('div');
      title.className = 'usage-row-title';
      title.textContent = `${row.providerId || 'provider'} · ${row.model || 'model'}`;
      const detail = documentObject.createElement('div');
      detail.className = 'usage-row-detail';
      detail.textContent = [
        `调用 ${row.calls}`,
        `总 ${formatTokenCount(row.totalTokens)}`,
        `Prompt ${formatTokenCount(row.promptTokens)}`,
        `回复 ${formatTokenCount(row.completionTokens)}`,
        row.estimatedCalls ? `估算 ${row.estimatedCalls}` : '',
        row.providerReportedCalls ? `服务商 ${row.providerReportedCalls}` : ''
      ].filter(Boolean).join(' · ');
      item.append(title, detail);
      providerList.append(item);
    });

    const list = documentObject.createElement('div');
    list.className = 'usage-list';
    (usage.recent || []).forEach((row, index) => {
      const item = documentObject.createElement('article');
      item.className = 'usage-row';
      const title = documentObject.createElement('div');
      title.className = 'usage-row-title';
      title.textContent = `${row.sessionId || currentSessionId} · ${formatUsageTask(row.taskKey)} · ${row.providerId || 'provider'} · ${row.model || 'model'}`;
      const detail = documentObject.createElement('div');
      detail.className = 'usage-row-detail';
      detail.textContent = [
        `总 ${formatTokenCount(row.totalTokens)}`,
        `Prompt ${formatTokenCount(row.promptTokens)}`,
        `回复 ${formatTokenCount(row.completionTokens)}`,
        row.injectedCards ? `注入 ${row.injectedCards} 条` : '',
        row.fallbackUsed ? `已从 ${row.requestedProviderId || '主模型'} 回退` : '',
        row.durationMs ? `${row.durationMs} ms` : '',
        row.estimated === false ? '服务商返回' : '本地估算'
      ].filter(Boolean).join(' · ');
      const turn = documentObject.createElement('span');
      turn.className = 'usage-row-turn';
      turn.textContent = `#${index + 1}`;
      item.append(title, detail, turn);
      list.append(item);
    });

    const sections = [summary];
    if (sessionList.children.length) sections.push(sessionList);
    sections.push(taskList, providerList, list);
    els.usageView.append(...sections);
  }

  async function loadUsageStats({ silent = false } = {}) {
    if (!els.usageView) return null;
    const revision = ++loadRevision;
    const scope = els.usageScope?.value || 'session';
    const sessionId = String(getCurrentSessionId() || 'main');
    const params = new URLSearchParams({ scope });
    if (scope !== 'all') params.set('sessionId', sessionId);
    if (!silent) {
      setStatus(els.usageStatus, '正在刷新用量...', 'busy');
      if (els.refreshUsage) els.refreshUsage.disabled = true;
    }
    try {
      const payload = await apiRequest(`/api/usage?${params.toString()}`);
      if (revision !== loadRevision) return null;
      state.usage = payload.usage || null;
      renderUsageView();
      const updatedAt = state.usage?.generatedAt ? formatTime(state.usage.generatedAt) : '';
      setStatus(els.usageStatus, updatedAt ? `已更新 ${updatedAt}` : '用量已更新', 'ok');
      return state.usage;
    } catch (error) {
      if (revision === loadRevision && !silent) {
        setStatus(els.usageStatus, `刷新失败：${humanizeApiError(error)}`, 'error');
      }
      return null;
    } finally {
      if (revision === loadRevision && els.refreshUsage) {
        els.refreshUsage.disabled = false;
      }
    }
  }

  function stopPolling() {
    if (refreshTimer == null) return;
    clearIntervalImpl(refreshTimer);
    refreshTimer = null;
  }

  function startPolling() {
    stopPolling();
    if (typeof setIntervalImpl !== 'function' || !(Number(refreshIntervalMs) > 0)) {
      return null;
    }
    refreshTimer = setIntervalImpl(() => {
      if (visibilityDocument?.hidden) return;
      void loadUsageStats({ silent: true });
    }, Number(refreshIntervalMs));
    return refreshTimer;
  }

  function bindEvents() {
    if (eventsBound) return;
    eventsBound = true;
    els.refreshUsage?.addEventListener('click', () => {
      void loadUsageStats();
    });
    els.usageScope?.addEventListener('change', () => {
      void loadUsageStats();
    });
  }

  return {
    bindEvents,
    loadUsageStats,
    renderUsageView,
    startPolling,
    stopPolling
  };
}
