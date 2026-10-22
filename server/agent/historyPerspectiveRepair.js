import { createHash, randomUUID } from 'node:crypto';
import { ensureEventLog } from './sessionEventLog.js';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Conservative proposal generator, not a general linguistic rewrite engine.
// Every replacement is exposed with its original offset for review.
export function proposeNarrationEdits(content, playerName) {
  const text = String(content || '');
  if (/[<>`]/.test(text)) return { edits: [], skipped: '包含标签或代码，需人工处理' };
  const pairs = { '“': '”', '「': '」', '『': '』', '‘': '’', '"': '"' };
  const closers = new Set(Object.values(pairs));
  const stack = [], edits = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\\' && stack.length) { i++; continue; }
    if (stack.length && c === stack.at(-1)) { stack.pop(); continue; }
    if (pairs[c]) { stack.push(pairs[c]); continue; }
    if (closers.has(c)) return { edits: [], skipped: '引号不匹配，需人工处理' };
    if (stack.length || c !== '你') continue;
    // Plural and possessive idioms are not unambiguously the player character.
    if (text[i + 1] === '们' || /[和与由任随]/.test(text[i - 1] || '') || text.slice(i, i + 4) === '你来我往') continue;
    edits.push({ start: i, end: i + 1, before: c, after: playerName });
  }
  if (stack.length) return { edits: [], skipped: '引号未闭合，需人工处理' };
  return { edits, skipped: '' };
}
function applyEdits(text, edits) {
  let result = text;
  for (const edit of [...edits].reverse()) result = result.slice(0, edit.start) + edit.after + result.slice(edit.end);
  return result;
}
export function buildHistoryRepairPlan(session, playerName) {
  const name = String(playerName || '').trim();
  if (!name || name.length > 40 || /[<>\r\n]/.test(name) || ['用户', '玩家', 'user'].includes(name.toLowerCase())) throw new Error('请指定已确认的玩家角色姓名');
  if (!Array.isArray(session.messages) || new Set(session.messages.map(m => m.id)).size !== session.messages.length || session.messages.some(m => !m.id)) throw new Error('消息 ID 缺失或重复');
  const changes = [], skipped = [];
  for (const message of session.messages) {
    if (message.role !== 'assistant') continue;
    const proposal = proposeNarrationEdits(message.content, name);
    if (proposal.skipped) skipped.push({ messageId: message.id, reason: proposal.skipped });
    if (proposal.edits.length) changes.push({ messageId: message.id, before: message.content, after: applyEdits(message.content, proposal.edits), edits: proposal.edits });
  }
  return { version: 1, sourceId: session.id, sourceHash: digest(session), playerName: name, changes, skipped,
    limitations: ['仅生成旁白人称候选，不保证指代消歧或文学通顺。', '对白、标签、代码、多人和泛指场景需人工核对；不自动修改原故事。'] };
}
export function createHistoryRepairCopy(session, plan, { id = randomUUID(), now = new Date().toISOString(), maxPromptTokens } = {}) {
  if (digest(session) !== plan.sourceHash || session.id !== plan.sourceId) throw new Error('SOURCE_CHANGED');
  if (JSON.stringify(buildHistoryRepairPlan(session, plan.playerName)) !== JSON.stringify(plan)) throw new Error('REPAIR_PLAN_CHANGED');
  if (!/^[A-Za-z0-9_-]+$/.test(id) || id === session.id) throw new Error('INVALID_COPY_ID');
  if (!plan.changes.length) throw new Error('NO_REPAIR_CHANGES');
  const next = structuredClone(session);
  next.id = id; next.title = `${session.title || '故事'} · 人称修复副本`;
  next.createdAt = now; next.updatedAt = now; next.storageRevision = randomUUID();
  next.historyRepair = { sourceId: session.id, sourceHash: plan.sourceHash, playerName: plan.playerName, changedMessages: plan.changes.map(c => c.messageId), createdAt: now };
  if (maxPromptTokens !== undefined) {
    if (!Number.isSafeInteger(maxPromptTokens) || maxPromptTokens < 1000 || maxPromptTokens > 1000000) throw new Error('INVALID_PROMPT_BUDGET');
    next.historyRepair.budgetChange = { before: session.settings?.maxPromptTokens, after: maxPromptTokens };
    next.settings = { ...next.settings, maxPromptTokens };
  }
  for (const change of plan.changes) {
    const message = next.messages.find(m => m.id === change.messageId);
    const swipes = Array.isArray(message.swipes) && message.swipes.length ? [...message.swipes] : [message.content];
    const active = Number.isInteger(message.activeSwipeIndex) ? message.activeSwipeIndex : swipes.indexOf(message.content);
    if (active < 0 || swipes[active] !== message.content) throw new Error('ACTIVE_SWIPE_MISMATCH');
    swipes[active] = change.after;
    message.content = change.after; message.swipes = swipes; message.activeSwipeIndex = active; message.updatedAt = now;
  }
  // Rebuild the shadow projection, otherwise replay would resurrect old prose.
  delete next.eventLog; delete next.turnViewSnapshot;
  ensureEventLog(next);
  return next;
}
