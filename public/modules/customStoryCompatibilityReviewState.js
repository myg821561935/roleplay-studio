export function normalizeScriptReviews(value) {
  const latest = new Map();
  (Array.isArray(value) ? value : []).forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const scriptId = String(item.scriptId || '').trim().slice(0, 80);
    const contentHash = String(item.contentHash || '').trim().slice(0, 160);
    const decision = String(item.decision || '').trim().toLowerCase();
    const note = String(item.note || '').trim().slice(0, 500);
    if (!scriptId || !contentHash || !['approved', 'rejected'].includes(decision) || note.length < 8) return;
    latest.set(scriptId, { scriptId, contentHash, decision, note });
  });
  return [...latest.values()].slice(-128);
}

export function normalizeScriptExecutionMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  return ['local-observe', 'compatibility-probe', 'review-required'].includes(mode)
    ? mode
    : 'local-observe';
}

export function findCurrentScriptReview(review, rule, fingerprintMatches) {
  if (!fingerprintMatches) return null;
  const scriptId = String(rule?.scriptId || '');
  const contentHash = String(rule?.contentHash || '');
  return review.scriptReviews.find((item) => item.scriptId === scriptId && item.contentHash === contentHash) || null;
}

export function reviewLabel(decision) {
  return { approved: '已确认长期授权', rejected: '已确认禁用', pending: '本地观察中' }[decision] || '本地观察中';
}
