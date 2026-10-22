import { createHash, randomUUID } from 'node:crypto';

export const SCRIPT_GOVERNANCE_POLICY_VERSION = 1;
export const SCRIPT_EXECUTION_MODES = Object.freeze({
  LOCAL_OBSERVE: 'local-observe',
  COMPATIBILITY_PROBE: 'compatibility-probe',
  REVIEW_REQUIRED: 'review-required'
});

const MAX_SCRIPT_REVIEWS = 128;
const MAX_SCRIPT_EXECUTIONS = 500;
const MAX_REVIEW_NOTE_LENGTH = 500;
const SCRIPT_DECISIONS = new Set(['approved', 'rejected', 'revoked']);
const EXECUTION_STATUSES = new Set(['launched', 'loaded', 'failed', 'blocked']);

export class ScriptGovernanceError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export function computeScriptContentHash(rule = {}) {
  const canonical = {
    id: cleanScriptId(rule.id),
    pattern: String(rule.pattern || ''),
    flags: String(rule.flags || ''),
    replacement: String(rule.replacement || ''),
    scope: String(rule.scope || 'assistant'),
    markdownOnly: rule.markdownOnly === true,
    promptOnly: rule.promptOnly === true,
    runOnEdit: rule.runOnEdit === true,
    minDepth: normalizeOptionalNumber(rule.minDepth),
    maxDepth: normalizeOptionalNumber(rule.maxDepth),
    trimStrings: Array.isArray(rule.trimStrings)
      ? rule.trimStrings.map((item) => String(item || '')).slice(0, 24)
      : []
  };
  return `sha256:${createHash('sha256').update(JSON.stringify(canonical)).digest('hex')}`;
}

export function attachScriptContentHashes(rules = []) {
  return (Array.isArray(rules) ? rules : []).map((rule) => {
    if (!isPlainObject(rule) || rule.requiresSandbox !== true) return rule;
    return {
      ...rule,
      contentHash: computeScriptContentHash(rule)
    };
  });
}

export function applyScriptReview(session, input = {}, { now = new Date() } = {}) {
  const lightFrontend = getLightFrontend(session, { create: true });
  const scriptId = cleanScriptId(input.scriptId);
  const decision = String(input.decision || '').trim().toLowerCase();
  if (!scriptId) throw new ScriptGovernanceError('SCRIPT_ID_REQUIRED');
  if (!SCRIPT_DECISIONS.has(decision)) throw new ScriptGovernanceError('SCRIPT_REVIEW_DECISION_INVALID');

  const rule = findSandboxRule(lightFrontend, scriptId);
  if (!rule) throw new ScriptGovernanceError('SCRIPT_RULE_NOT_FOUND');

  const contentHash = computeScriptContentHash(rule);
  rule.contentHash = contentHash;
  const risk = assessServerScriptRisk(rule.replacement);
  const review = {
    reviewId: randomUUID(),
    scriptId,
    contentHash,
    decision,
    reviewer: cleanReviewer(input.reviewer),
    note: String(input.note || '').trim().slice(0, MAX_REVIEW_NOTE_LENGTH),
    riskLevel: risk.level,
    risks: risk.risks,
    reviewedAt: toIsoString(now),
    policyVersion: SCRIPT_GOVERNANCE_POLICY_VERSION
  };

  lightFrontend.scriptReviews = [
    ...normalizeScriptReviews(lightFrontend.scriptReviews),
    review
  ].slice(-MAX_SCRIPT_REVIEWS);
  lightFrontend.trustedScriptIds = deriveApprovedScriptIds(lightFrontend);
  session.updatedAt = toIsoString(now);
  return review;
}

export function isScriptRuleApproved(lightFrontend, rule) {
  if (!isPlainObject(rule) || rule.requiresSandbox !== true) return false;
  const scriptId = cleanScriptId(rule.id);
  if (!scriptId) return false;
  const contentHash = computeScriptContentHash(rule);
  const latest = findLatestReview(normalizeScriptReviews(lightFrontend?.scriptReviews), scriptId);
  return Boolean(
    latest
    && latest.decision === 'approved'
    && latest.contentHash === contentHash
    && latest.policyVersion === SCRIPT_GOVERNANCE_POLICY_VERSION
  );
}

// Local exploration and the explicit development compatibility probe widen
// *readiness*, not host authority. A current explicit rejection or revocation
// always wins, so users retain an immediate stop control while testing.
export function isScriptRuleExecutable(lightFrontend, rule) {
  if (!isPlainObject(rule) || rule.requiresSandbox !== true) return false;
  const scriptId = cleanScriptId(rule.id);
  if (!scriptId) return false;
  const contentHash = computeScriptContentHash(rule);
  const latest = findLatestReview(normalizeScriptReviews(lightFrontend?.scriptReviews), scriptId);
  if (latest?.contentHash === contentHash
    && latest.policyVersion === SCRIPT_GOVERNANCE_POLICY_VERSION
    && ['rejected', 'revoked'].includes(latest.decision)) {
    return false;
  }
  return [
    SCRIPT_EXECUTION_MODES.LOCAL_OBSERVE,
    SCRIPT_EXECUTION_MODES.COMPATIBILITY_PROBE
  ].includes(getScriptExecutionMode(lightFrontend))
    || isScriptRuleApproved(lightFrontend, rule);
}

export function getScriptExecutionMode(lightFrontend) {
  return normalizeScriptExecutionMode(lightFrontend?.scriptExecutionMode);
}

export function setScriptExecutionMode(session, input = {}, { now = new Date() } = {}) {
  const lightFrontend = getLightFrontend(session, { create: true });
  const mode = normalizeScriptExecutionMode(input.executionMode, { fallback: '' });
  if (!mode) throw new ScriptGovernanceError('SCRIPT_EXECUTION_MODE_INVALID');
  if (mode === SCRIPT_EXECUTION_MODES.COMPATIBILITY_PROBE
    && input.acknowledgeDeveloperRisk !== true) {
    throw new ScriptGovernanceError('SCRIPT_DEVELOPER_MODE_ACK_REQUIRED');
  }
  lightFrontend.scriptExecutionMode = mode;
  session.updatedAt = toIsoString(now);
  return mode;
}

export function appendScriptExecutionAudit(session, input = {}, { now = new Date() } = {}) {
  const lightFrontend = getLightFrontend(session);
  const scriptId = cleanScriptId(input.scriptId);
  if (!scriptId) throw new ScriptGovernanceError('SCRIPT_ID_REQUIRED');
  const rule = findSandboxRule(lightFrontend, scriptId);
  if (!rule) throw new ScriptGovernanceError('SCRIPT_RULE_NOT_FOUND');

  const contentHash = computeScriptContentHash(rule);
  if (String(input.contentHash || '') !== contentHash) {
    throw new ScriptGovernanceError('SCRIPT_CONTENT_HASH_MISMATCH');
  }

  const status = String(input.status || 'launched').trim().toLowerCase();
  if (!EXECUTION_STATUSES.has(status)) {
    throw new ScriptGovernanceError('SCRIPT_EXECUTION_STATUS_INVALID');
  }
  if (status !== 'blocked' && !isScriptRuleExecutable(lightFrontend, rule)) {
    throw new ScriptGovernanceError('SCRIPT_EXECUTION_BLOCKED');
  }

  const occurredAt = toIsoString(now);
  const record = {
    executionId: randomUUID(),
    scriptId,
    contentHash,
    status,
    sessionId: String(session.id || ''),
    messageId: String(input.messageId || '').trim().slice(0, 120),
    errorCode: String(input.errorCode || '').trim().slice(0, 120),
    durationMs: normalizeDuration(input.durationMs),
    executionMode: getScriptExecutionMode(lightFrontend),
    permissionSource: resolvePermissionSource(lightFrontend, rule),
    occurredAt,
    policyVersion: SCRIPT_GOVERNANCE_POLICY_VERSION
  };

  if (!isPlainObject(session.audit)) session.audit = {};
  session.audit.scriptExecutions = [
    ...normalizeScriptExecutions(session.audit.scriptExecutions),
    record
  ].slice(-MAX_SCRIPT_EXECUTIONS);
  session.updatedAt = occurredAt;
  return record;
}

export function getScriptGovernanceSnapshot(session) {
  const lightFrontend = getLightFrontend(session);
  const reviews = normalizeScriptReviews(lightFrontend.scriptReviews);
  const executionMode = getScriptExecutionMode(lightFrontend);
  const rules = getSandboxRules(lightFrontend).map((rule) => {
    const contentHash = computeScriptContentHash(rule);
    const latestReview = findLatestReview(reviews, cleanScriptId(rule.id));
    const risk = assessServerScriptRisk(rule.replacement);
    return {
      scriptId: cleanScriptId(rule.id),
      name: String(rule.name || rule.id || '未命名脚本').slice(0, 80),
      contentHash,
      scope: String(rule.scope || 'assistant').slice(0, 40),
      pattern: String(rule.pattern || ''),
      source: String(rule.replacement || ''),
      riskLevel: risk.level,
      risks: risk.risks,
      approved: isScriptRuleApproved(lightFrontend, rule),
      executable: isScriptRuleExecutable(lightFrontend, rule),
      latestReview
    };
  });
  return {
    policyVersion: SCRIPT_GOVERNANCE_POLICY_VERSION,
    executionMode,
    rules,
    reviews,
    trustedScriptIds: rules.filter((rule) => rule.approved).map((rule) => rule.scriptId),
    executionCount: normalizeScriptExecutions(session?.audit?.scriptExecutions).length
  };
}

export function listScriptExecutionAudit(session, { limit = 100 } = {}) {
  const safeLimit = Math.min(500, Math.max(1, Math.trunc(Number(limit) || 100)));
  return normalizeScriptExecutions(session?.audit?.scriptExecutions).slice(-safeLimit);
}

export function resetScriptGovernanceForImportedSession(session) {
  const lightFrontend = getLightFrontend(session);
  if (isPlainObject(lightFrontend)) {
    lightFrontend.regexTransforms = attachScriptContentHashes(lightFrontend.regexTransforms);
    lightFrontend.scriptReviews = [];
    lightFrontend.trustedScriptIds = [];
    lightFrontend.scriptExecutionMode = SCRIPT_EXECUTION_MODES.LOCAL_OBSERVE;
  }
  if (isPlainObject(session?.audit)) {
    session.audit.scriptExecutions = [];
  }
  return session;
}

function getLightFrontend(session, { create = false } = {}) {
  if (!isPlainObject(session)) {
    if (create) throw new ScriptGovernanceError('INVALID_SESSION');
    return {};
  }
  if (!isPlainObject(session.config)) {
    if (!create) return {};
    session.config = {};
  }
  if (!isPlainObject(session.config.lightFrontend)) {
    if (!create) return {};
    session.config.lightFrontend = {};
  }
  return session.config.lightFrontend;
}

function getSandboxRules(lightFrontend) {
  return (Array.isArray(lightFrontend?.regexTransforms) ? lightFrontend.regexTransforms : [])
    .filter((rule) => isPlainObject(rule) && rule.requiresSandbox === true && rule.enabled !== false);
}

function findSandboxRule(lightFrontend, scriptId) {
  return getSandboxRules(lightFrontend).find((rule) => cleanScriptId(rule.id) === scriptId);
}

function deriveApprovedScriptIds(lightFrontend) {
  return getSandboxRules(lightFrontend)
    .filter((rule) => isScriptRuleApproved(lightFrontend, rule))
    .map((rule) => cleanScriptId(rule.id))
    .filter(Boolean)
    .slice(0, 32);
}

function findLatestReview(reviews, scriptId) {
  for (let index = reviews.length - 1; index >= 0; index -= 1) {
    if (reviews[index].scriptId === scriptId) return reviews[index];
  }
  return null;
}

function normalizeScriptReviews(value) {
  return (Array.isArray(value) ? value : [])
    .filter(isPlainObject)
    .map((review) => ({
      reviewId: String(review.reviewId || ''),
      scriptId: cleanScriptId(review.scriptId),
      contentHash: String(review.contentHash || ''),
      decision: SCRIPT_DECISIONS.has(review.decision) ? review.decision : 'rejected',
      reviewer: cleanReviewer(review.reviewer),
      note: String(review.note || '').trim().slice(0, MAX_REVIEW_NOTE_LENGTH),
      riskLevel: ['low', 'medium', 'high'].includes(review.riskLevel) ? review.riskLevel : 'high',
      risks: Array.isArray(review.risks) ? review.risks.map(String).slice(0, 20) : [],
      reviewedAt: String(review.reviewedAt || ''),
      policyVersion: Number(review.policyVersion) || 0
    }))
    .filter((review) => review.scriptId && review.contentHash)
    .slice(-MAX_SCRIPT_REVIEWS);
}

function normalizeScriptExecutions(value) {
  return (Array.isArray(value) ? value : [])
    .filter(isPlainObject)
    .map((record) => ({
      executionId: String(record.executionId || ''),
      scriptId: cleanScriptId(record.scriptId),
      contentHash: String(record.contentHash || ''),
      status: EXECUTION_STATUSES.has(record.status) ? record.status : 'failed',
      sessionId: String(record.sessionId || ''),
      messageId: String(record.messageId || ''),
      errorCode: String(record.errorCode || ''),
      durationMs: normalizeDuration(record.durationMs),
      executionMode: normalizeScriptExecutionMode(record.executionMode),
      permissionSource: ['approved', 'local-observe', 'compatibility-probe'].includes(record.permissionSource)
        ? record.permissionSource
        : 'approved',
      occurredAt: String(record.occurredAt || ''),
      policyVersion: Number(record.policyVersion) || 0
    }))
    .filter((record) => record.scriptId && record.contentHash)
    .slice(-MAX_SCRIPT_EXECUTIONS);
}

function assessServerScriptRisk(value) {
  const source = String(value || '');
  const risks = [];
  let level = 'low';
  if (/fetch\s*\(|XMLHttpRequest|new\s+WebSocket|navigator\.sendBeacon|<img[^>]+src\s*=/i.test(source)) {
    risks.push('network-request');
    level = 'high';
  }
  if (/document\.cookie|localStorage|sessionStorage/i.test(source)) {
    risks.push('browser-storage-access');
    level = 'high';
  }
  if (/eval\s*\(|new\s+Function|setTimeout\s*\(\s*['"]|setInterval\s*\(\s*['"]/i.test(source)) {
    risks.push('dynamic-code-execution');
    level = 'high';
  }
  if (/<\s*(?:script|link|iframe|object|embed)[^>]+src\s*=/i.test(source) || /https?:\/\//i.test(source)) {
    risks.push('external-resource');
    if (level !== 'high') level = 'medium';
  }
  if (/<\s*script/i.test(source) || /\son[a-z]+\s*=/i.test(source) || /javascript\s*:/i.test(source)) {
    risks.push('executable-browser-content');
    if (level === 'low') level = 'medium';
  }
  return { level, risks };
}

function cleanScriptId(value) {
  return String(value || '').trim().slice(0, 80);
}

function cleanReviewer(value) {
  return String(value || 'local-user').trim().slice(0, 80) || 'local-user';
}

function normalizeOptionalNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeScriptExecutionMode(value, { fallback = SCRIPT_EXECUTION_MODES.LOCAL_OBSERVE } = {}) {
  const normalized = String(value || '').trim().toLowerCase();
  return Object.values(SCRIPT_EXECUTION_MODES).includes(normalized) ? normalized : fallback;
}

function resolvePermissionSource(lightFrontend, rule) {
  if (isScriptRuleApproved(lightFrontend, rule)) return 'approved';
  return getScriptExecutionMode(lightFrontend) === SCRIPT_EXECUTION_MODES.COMPATIBILITY_PROBE
    ? 'compatibility-probe'
    : 'local-observe';
}

function normalizeDuration(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.min(600000, Math.trunc(number)) : 0;
}

function toIsoString(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
