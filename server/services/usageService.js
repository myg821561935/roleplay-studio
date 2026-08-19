export function summarizeSessionUsage(session = {}) {
  const rows = usageRowsFromSession(session);
  return buildUsageSummary({
    scope: 'session',
    sessionId: String(session.id || 'main'),
    rows
  });
}

export function summarizeAllUsage(sessions = []) {
  const rows = sessions.flatMap((session) => usageRowsFromSession(session));
  const summary = buildUsageSummary({
    scope: 'all',
    sessionId: '',
    rows
  });
  summary.bySession = aggregateBySession(sessions);
  return summary;
}

function usageRowsFromSession(session = {}) {
  const sessionId = String(session.id || 'main');
  const messages = Array.isArray(session.messages) ? session.messages : [];
  const ledger = Array.isArray(session.usageLedger) ? session.usageLedger : [];
  const ledgerRows = ledger
    .filter((entry) => isPlainObject(entry))
    .map((entry, index) => normalizeLedgerRow({ sessionId, entry, index }));
  const ledgerMessageIds = new Set(ledgerRows.map((row) => row.messageId).filter(Boolean));
  const legacyMessageRows = messages
    .filter((message) => message?.role === 'assistant' && isPlainObject(message.usage))
    .filter((message) => !ledgerMessageIds.has(String(message.id || '')))
    .map((message, index) => normalizeUsageRow({ sessionId, message, index }));
  return [...legacyMessageRows, ...ledgerRows];
}

function normalizeUsageRow({ sessionId, message, index }) {
  const usage = message.usage || {};
  const promptTokens = normalizeTokenNumber(usage.promptTokens ?? usage.prompt_tokens);
  const completionTokens = normalizeTokenNumber(usage.completionTokens ?? usage.completion_tokens);
  const totalTokens = normalizeTokenNumber(usage.totalTokens ?? usage.total_tokens, promptTokens + completionTokens);
  return {
    sessionId,
    callId: String(usage.callId || ''),
    messageId: String(message.id || `assistant-${index}`),
    createdAt: String(message.createdAt || ''),
    taskKey: String(usage.taskKey || 'chat'),
    requestedProviderId: String(usage.requestedProviderId || usage.providerId || usage.provider_id || ''),
    providerId: String(usage.providerId || usage.provider_id || ''),
    model: String(usage.model || ''),
    fallbackUsed: usage.fallbackUsed === true,
    durationMs: normalizeTokenNumber(usage.durationMs),
    promptTokens,
    completionTokens,
    totalTokens,
    injectedCards: normalizeTokenNumber(usage.injectedCards),
    estimated: usage.estimated !== false
  };
}

function normalizeLedgerRow({ sessionId, entry, index }) {
  const promptTokens = normalizeTokenNumber(entry.promptTokens ?? entry.prompt_tokens);
  const completionTokens = normalizeTokenNumber(entry.completionTokens ?? entry.completion_tokens);
  const totalTokens = normalizeTokenNumber(entry.totalTokens ?? entry.total_tokens, promptTokens + completionTokens);
  return {
    sessionId,
    callId: String(entry.callId || `ledger-${index}`),
    messageId: String(entry.messageId || ''),
    createdAt: String(entry.createdAt || ''),
    taskKey: String(entry.taskKey || 'chat'),
    requestedProviderId: String(entry.requestedProviderId || entry.providerId || ''),
    providerId: String(entry.providerId || ''),
    model: String(entry.model || ''),
    fallbackUsed: entry.fallbackUsed === true,
    durationMs: normalizeTokenNumber(entry.durationMs),
    promptTokens,
    completionTokens,
    totalTokens,
    injectedCards: normalizeTokenNumber(entry.injectedCards),
    estimated: entry.estimated !== false
  };
}

function buildUsageSummary({ scope, sessionId, rows }) {
  const totals = rows.reduce((acc, row) => {
    acc.calls += 1;
    acc.promptTokens += row.promptTokens;
    acc.completionTokens += row.completionTokens;
    acc.totalTokens += row.totalTokens;
    if (row.estimated) acc.estimatedCalls += 1;
    else acc.providerReportedCalls += 1;
    return acc;
  }, createEmptyTotals());

  return {
    scope,
    sessionId,
    generatedAt: new Date().toISOString(),
    totals,
    byProvider: aggregateByProvider(rows),
    byTask: aggregateByTask(rows),
    recent: rows.slice().sort(compareRecentUsage).slice(0, 20)
  };
}

function aggregateByTask(rows) {
  const groups = new Map();
  for (const row of rows) {
    const taskKey = row.taskKey || 'chat';
    if (!groups.has(taskKey)) {
      groups.set(taskKey, {
        taskKey,
        calls: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        fallbackCalls: 0
      });
    }
    const group = groups.get(taskKey);
    group.calls += 1;
    group.promptTokens += row.promptTokens;
    group.completionTokens += row.completionTokens;
    group.totalTokens += row.totalTokens;
    if (row.fallbackUsed) group.fallbackCalls += 1;
  }
  return Array.from(groups.values()).sort((a, b) => b.totalTokens - a.totalTokens || b.calls - a.calls);
}

function aggregateByProvider(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.providerId || 'unknown'}\n${row.model || 'unknown'}`;
    if (!groups.has(key)) {
      groups.set(key, {
        providerId: row.providerId || 'unknown',
        model: row.model || 'unknown',
        calls: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        estimatedCalls: 0,
        providerReportedCalls: 0
      });
    }
    const group = groups.get(key);
    group.calls += 1;
    group.promptTokens += row.promptTokens;
    group.completionTokens += row.completionTokens;
    group.totalTokens += row.totalTokens;
    if (row.estimated) group.estimatedCalls += 1;
    else group.providerReportedCalls += 1;
  }
  return Array.from(groups.values()).sort((a, b) => b.totalTokens - a.totalTokens || b.calls - a.calls);
}

function compareRecentUsage(a, b) {
  const at = Date.parse(a.createdAt || '') || 0;
  const bt = Date.parse(b.createdAt || '') || 0;
  if (bt !== at) return bt - at;
  return String(b.messageId).localeCompare(String(a.messageId));
}

function aggregateBySession(sessions = []) {
  const groups = new Map();
  for (const session of sessions) {
    if (!isPlainObject(session)) continue;
    const sessionId = String(session.id || 'main');
    const title = String(session.title || '');
    const rows = usageRowsFromSession(session);
    const totals = rows.reduce((acc, row) => {
      acc.calls += 1;
      acc.promptTokens += row.promptTokens;
      acc.completionTokens += row.completionTokens;
      acc.totalTokens += row.totalTokens;
      return acc;
    }, { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 });
    if (!groups.has(sessionId)) {
      groups.set(sessionId, { sessionId, title, ...totals });
    } else {
      const existing = groups.get(sessionId);
      existing.calls += totals.calls;
      existing.promptTokens += totals.promptTokens;
      existing.completionTokens += totals.completionTokens;
      existing.totalTokens += totals.totalTokens;
      if (!existing.title && title) existing.title = title;
    }
  }
  return Array.from(groups.values()).sort((a, b) => b.totalTokens - a.totalTokens || b.calls - a.calls);
}

function createEmptyTotals() {
  return {
    calls: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    estimatedCalls: 0,
    providerReportedCalls: 0
  };
}

function normalizeTokenNumber(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return Math.floor(number);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
