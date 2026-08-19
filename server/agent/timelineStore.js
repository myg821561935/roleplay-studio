// 时间线分支内核（p2-02，建立在 p2-01 事件日志之上）：
// - 分支 = 事件日志的快照种子：fork 用 legacy.imported 携带 messages[0..i] 快照起步
// - 活跃分支的日志只存在于 session.eventLog（单一拷贝不变式）：
//   切走时回填进分支记录，切回时取出装入 session.eventLog
// - 本模块为纯函数：不触锁、不触记忆重建、不落盘（由 AgentService 编排）
//
// session.timeline = {
//   activeBranchId: 'root',
//   branches: [{ id, label, parentBranchId, forkPoint, createdAt, updatedAt, eventLog }]
// }

import { deriveMessages } from './sessionEventLog.js';

const MAX_BRANCH_LABEL_LENGTH = 40;
const MAX_COMPARE_MESSAGES = 50;

function now() {
  return new Date().toISOString();
}

function createId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
}

function cloneValue(value) {
  if (value === null || typeof value !== 'object') return value;
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
}

function normalizeBranch(branch) {
  if (!branch || typeof branch !== 'object') return null;
  const id = String(branch.id || '').trim();
  if (!id) return null;
  const forkPoint = branch.forkPoint && typeof branch.forkPoint === 'object'
    ? {
      messageId: String(branch.forkPoint.messageId || ''),
      messageCount: Number(branch.forkPoint.messageCount) || 0
    }
    : null;
  return {
    id,
    label: String(branch.label || '').trim().slice(0, MAX_BRANCH_LABEL_LENGTH) || `分支 ${id.slice(-4)}`,
    parentBranchId: branch.parentBranchId ? String(branch.parentBranchId) : null,
    forkPoint,
    createdAt: branch.createdAt || now(),
    updatedAt: branch.updatedAt || branch.createdAt || now(),
    // 活跃分支在记录里必须无日志（日志在 session.eventLog）；非活跃分支冻结保存
    eventLog: Array.isArray(branch.eventLog) ? branch.eventLog : null
  };
}

// —— 迁移：旧会话（无 timeline）合成为单根分支 ——

export function ensureTimeline(session) {
  if (!session || typeof session !== 'object') return session;
  if (!Array.isArray(session.eventLog)) {
    throw new Error('TIMELINE_REQUIRES_EVENT_LOG');
  }
  if (!session.timeline || typeof session.timeline !== 'object'
    || !Array.isArray(session.timeline.branches)) {
    session.timeline = {
      activeBranchId: 'root',
      branches: [{
        id: 'root',
        label: '主线',
        parentBranchId: null,
        forkPoint: null,
        createdAt: now(),
        updatedAt: now(),
        eventLog: null
      }]
    };
  } else {
    session.timeline.branches = session.timeline.branches
      .map(normalizeBranch)
      .filter(Boolean);
    const activeId = String(session.timeline.activeBranchId || '');
    const hasActive = session.timeline.branches.some((b) => b.id === activeId);
    session.timeline.activeBranchId = hasActive ? activeId : 'root';
  }
  return session;
}

function findBranch(session, branchId) {
  const id = String(branchId || '').trim();
  return session.timeline.branches.find((b) => b.id === id) || null;
}

// —— fork：在 messageId 处创建分支（不改变活跃分支） ——

export function forkTimeline(session, { messageId, label = '', switchTo = false } = {}) {
  ensureTimeline(session);
  const messages = Array.isArray(session.messages) ? session.messages : [];
  const index = messages.findIndex((m) => String(m?.id || '') === String(messageId || ''));
  if (index < 0) throw new Error('FORK_MESSAGE_NOT_FOUND');

  const nowIso = now();
  const branchId = createId('branch');
  const forkPoint = { messageId: String(messages[index].id), messageCount: index + 1 };
  const branch = {
    id: branchId,
    label: String(label || '').trim().slice(0, MAX_BRANCH_LABEL_LENGTH) || `分支 ${session.timeline.branches.length}`,
    parentBranchId: session.timeline.activeBranchId,
    forkPoint,
    createdAt: nowIso,
    updatedAt: nowIso,
    // 快照种子：messages[0..index] 整体作为日志起点（legacy.imported 语义）
    eventLog: [{
      id: createId('evt'),
      seq: 1,
      type: 'legacy.imported',
      at: nowIso,
      payload: { messages: cloneValue(messages.slice(0, index + 1)) }
    }]
  };
  session.timeline.branches.push(branch);

  if (switchTo) {
    switchTimelineBranch(session, branchId);
  }
  return { session, branchId };
}

// —— switch：活跃分支日志回填记录，目标分支日志装入 eventLog ——

export function switchTimelineBranch(session, branchId) {
  ensureTimeline(session);
  const target = findBranch(session, branchId);
  if (!target) throw new Error('BRANCH_NOT_FOUND');
  if (target.id === session.timeline.activeBranchId) return { session, switched: false };

  // 回填当前活跃分支的日志（含 messages 与投影的最新状态）
  const current = findBranch(session, session.timeline.activeBranchId);
  if (current) {
    current.eventLog = cloneValue(session.eventLog || []);
    current.updatedAt = now();
  }

  // 装入目标分支日志并重放投影 → messages
  session.eventLog = cloneValue(target.eventLog || []);
  target.eventLog = null;
  target.updatedAt = now();
  session.timeline.activeBranchId = target.id;
  session.messages = deriveMessages(session.eventLog);
  return { session, switched: true };
}

// —— rename / delete ——

export function renameTimelineBranch(session, branchId, label) {
  ensureTimeline(session);
  const branch = findBranch(session, branchId);
  if (!branch) throw new Error('BRANCH_NOT_FOUND');
  branch.label = String(label || '').trim().slice(0, MAX_BRANCH_LABEL_LENGTH) || branch.label;
  branch.updatedAt = now();
  return { session };
}

export function deleteTimelineBranch(session, branchId) {
  ensureTimeline(session);
  const branch = findBranch(session, branchId);
  if (!branch) throw new Error('BRANCH_NOT_FOUND');
  if (branch.id === 'root') throw new Error('CANNOT_DELETE_ROOT_BRANCH');
  if (branch.id === session.timeline.activeBranchId) throw new Error('CANNOT_DELETE_ACTIVE_BRANCH');
  if (session.timeline.branches.some((b) => b.parentBranchId === branch.id)) {
    throw new Error('BRANCH_HAS_CHILDREN');
  }
  session.timeline.branches = session.timeline.branches.filter((b) => b.id !== branch.id);
  return { session };
}

// —— compare：按消息 id 序列的最长公共前缀定位分叉点 ——

export function compareTimelineBranches(session, leftId, rightId) {
  ensureTimeline(session);
  const left = findBranch(session, leftId);
  const right = findBranch(session, rightId);
  if (!left || !right) throw new Error('BRANCH_NOT_FOUND');

  const leftMessages = projectBranch(session, left);
  const rightMessages = projectBranch(session, right);

  const shared = Math.min(leftMessages.length, rightMessages.length);
  let forkAt = shared;
  for (let i = 0; i < shared; i += 1) {
    if (String(leftMessages[i]?.id || '') !== String(rightMessages[i]?.id || '')) {
      forkAt = i;
      break;
    }
  }

  return {
    forkIndex: forkAt,
    forkMessage: forkAt > 0 ? summarizeMessage(leftMessages[forkAt - 1]) : null,
    left: {
      branchId: left.id,
      label: left.label,
      messageCount: leftMessages.length,
      tail: leftMessages.slice(forkAt, forkAt + MAX_COMPARE_MESSAGES).map(summarizeMessage)
    },
    right: {
      branchId: right.id,
      label: right.label,
      messageCount: rightMessages.length,
      tail: rightMessages.slice(forkAt, forkAt + MAX_COMPARE_MESSAGES).map(summarizeMessage)
    }
  };
}

// 活跃分支从 session.eventLog 投影；非活跃分支从自身冻结日志投影
function projectBranch(session, branch) {
  if (branch.id === session.timeline.activeBranchId) {
    return deriveMessages(session.eventLog);
  }
  return deriveMessages(branch.eventLog || []);
}

function summarizeMessage(message) {
  return {
    id: String(message?.id || ''),
    role: String(message?.role || ''),
    content: String(message?.content || '').replace(/\s+/g, ' ').trim().slice(0, 120),
    createdAt: message?.createdAt || ''
  };
}

// —— 分支树视图（路由用） ——

export function listTimelineBranches(session) {
  ensureTimeline(session);
  const activeId = session.timeline.activeBranchId;
  const messages = Array.isArray(session.messages) ? session.messages : [];
  return session.timeline.branches.map((branch) => {
    const projected = projectBranch(session, branch);
    const lastMessage = projected.at(-1);
    return {
      id: branch.id,
      label: branch.label,
      parentBranchId: branch.parentBranchId,
      forkPoint: branch.forkPoint,
      createdAt: branch.createdAt,
      updatedAt: branch.updatedAt,
      isActive: branch.id === activeId,
      isRoot: branch.id === 'root',
      messageCount: projected.length,
      lastMessagePreview: lastMessage
        ? String(lastMessage.content || '').replace(/\s+/g, ' ').trim().slice(0, 120)
        : '',
      childCount: session.timeline.branches.filter((b) => b.parentBranchId === branch.id).length
    };
  });
}
