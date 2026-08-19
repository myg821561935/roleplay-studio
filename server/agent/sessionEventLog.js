// 会话事件日志内核（p2-01，影子模式）：
// - messages 数组仍是唯一事实源，本模块只做影子记录与投影
// - 事件 = messages 数组的一次合法转移（created/updated/truncated）
// - auto-diff：saveSession 时对比「日志投影」（= 上次保存时的状态）生成事件，写入路径零埋点
// - deriveMessages：重放事件流还原 messages（等价性由测试锁定）
//
// 基线即日志：appendSessionEvents 用 deriveMessages(log) 作为 diff 基线，
// 不依赖对象身份（saveSession 的 spread 会破坏 WeakMap 身份追踪）。
//
// p2-02 将在此基础上增加分支选择参数并翻转事实源。

const EVENT_LOG_SOFT_LIMIT = 10000;

function cloneValue(value) {
  if (value === null || typeof value !== 'object') return value;
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
}

// —— 事件构造 ——

function createEvent(seqBase, type, payload) {
  return {
    id: `evt-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`,
    seq: seqBase + 1,
    type,
    at: new Date().toISOString(),
    payload: cloneValue(payload)
  };
}

function normalizeEventLog(value) {
  return Array.isArray(value) ? value.filter((event) => event && typeof event === 'object') : [];
}

function lastSeqOf(log) {
  return log.length ? Number(log[log.length - 1].seq) || 0 : 0;
}

// —— 迁移：旧会话首次读入/保存时合成 legacy.imported 事件 ——

export function ensureEventLog(session) {
  if (!session || typeof session !== 'object') return session;
  const messages = Array.isArray(session.messages) ? session.messages : [];
  if (!Array.isArray(session.eventLog)) {
    // 未初始化：合成迁移事件（空会话得到空日志——这是合法终态，不会被重复合成）
    session.eventLog = messages.length
      ? [createEvent(0, 'legacy.imported', { messages })]
      : [];
  } else {
    session.eventLog = normalizeEventLog(session.eventLog);
  }
  return session;
}

// —— diff：messages 相对基线的转移 → 事件序列 ——

function diffMessages(baseline, current) {
  const events = [];
  const baseCount = baseline.length;
  const currCount = current.length;

  // 第一个同位 id 不匹配的位置：此后视为「截断 + 重推」
  // （覆盖 slice 截断后推回不同 id 消息的形状，避免投影叠加）
  let mismatchAt = -1;
  const shared = Math.min(baseCount, currCount);
  for (let i = 0; i < shared; i += 1) {
    if (String(baseline[i]?.id || '') !== String(current[i]?.id || '')) {
      mismatchAt = i;
      break;
    }
  }

  // 截断：current 变短，或同位 id 被替换
  const truncateTo = mismatchAt >= 0
    ? mismatchAt
    : (currCount < baseCount ? currCount : -1);
  if (truncateTo >= 0) {
    events.push({ type: 'messages.truncated', payload: { toLength: truncateTo } });
  }

  // 幸存区间（截断边界之前）逐条深比较：就地变异 → message.updated 补丁
  const stableCount = truncateTo >= 0 ? truncateTo : shared;
  for (let i = 0; i < stableCount; i += 1) {
    const before = baseline[i];
    const after = current[i];
    if (!before || !after) continue;
    const fields = diffMessageFields(before, after);
    if (fields) {
      const payload = { messageId: String(after.id), patch: fields.patch };
      // 字段删除必须显式记录：undefined 补丁值经 JSON 落盘会丢键，投影无法表达「删除」
      if (fields.deleted.length) payload.deleted = fields.deleted;
      events.push({ type: 'message.updated', payload });
    }
  }

  // 追加：截断边界之后的全部消息（新增或重推）
  for (let i = stableCount; i < currCount; i += 1) {
    events.push({ type: 'message.created', payload: { message: cloneValue(current[i]) } });
  }

  return events;
}

function diffMessageFields(before, after) {
  const patch = {};
  const deleted = [];
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  let changed = false;
  for (const key of keys) {
    const left = before?.[key];
    const right = after?.[key];
    if (!deepEqual(left, right)) {
      // 字段被 delete / 置 undefined：显式记入 deleted 列表（undefined 无法经 JSON 存活）
      if (right === undefined) deleted.push(key);
      else patch[key] = cloneValue(right);
      changed = true;
    }
  }
  return changed ? { patch, deleted } : null;
}

function deepEqual(left, right) {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') {
    return false;
  }
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left)) {
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i += 1) {
      if (!deepEqual(left[i], right[i])) return false;
    }
    return true;
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    if (!Object.hasOwn(right, key) || !deepEqual(left[key], right[key])) return false;
  }
  return true;
}

// —— 追加入口：saveSession 时调用 ——

export function appendSessionEvents(session) {
  if (!session || typeof session !== 'object') return session;
  const messages = Array.isArray(session.messages) ? session.messages : [];
  ensureEventLog(session);
  const log = normalizeEventLog(session.eventLog);

  // 基线 = 日志投影（即上次保存时的 messages 状态）
  const baseline = deriveMessages(log);
  const pending = diffMessages(baseline, messages);
  if (!pending.length) {
    session.eventLog = log;
    return session;
  }

  let seq = lastSeqOf(log);
  for (const pendingEvent of pending) {
    seq += 1;
    log.push({
      id: `evt-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`,
      seq,
      type: pendingEvent.type,
      at: new Date().toISOString(),
      payload: cloneValue(pendingEvent.payload)
    });
  }

  // 软上限压缩：超限折叠为单个 legacy.imported（状态无损，旧分支丢弃）
  if (log.length > EVENT_LOG_SOFT_LIMIT) {
    const compressed = deriveMessages(log);
    session.eventLog = [createEvent(0, 'legacy.imported', { messages: compressed })];
  } else {
    session.eventLog = log;
  }
  return session;
}

// —— 投影：重放事件流 → messages ——

export function deriveMessages(eventLog) {
  const log = normalizeEventLog(eventLog);
  let messages = [];
  for (const event of log) {
    const payload = event?.payload || {};
    switch (event?.type) {
      case 'legacy.imported':
        messages = Array.isArray(payload.messages) ? payload.messages.map((m) => cloneValue(m)) : [];
        break;
      case 'message.created':
        if (payload.message && typeof payload.message === 'object') {
          messages.push(cloneValue(payload.message));
        }
        break;
      case 'message.updated': {
        const id = String(payload.messageId || '');
        const target = messages.find((m) => String(m?.id || '') === id);
        if (target) {
          Object.assign(target, cloneValue(payload.patch || {}));
          for (const key of Array.isArray(payload.deleted) ? payload.deleted : []) {
            delete target[key];
          }
        }
        break;
      }
      case 'messages.truncated': {
        const toLength = Number(payload.toLength);
        if (Number.isInteger(toLength) && toLength >= 0) {
          messages = messages.slice(0, toLength);
        }
        break;
      }
      default:
        break;
    }
  }
  return messages;
}

// —— 摘要：调试器/检查器用 ——

export function summarizeEventLog(eventLog) {
  const log = normalizeEventLog(eventLog);
  const byType = {};
  for (const event of log) {
    byType[event.type] = (byType[event.type] || 0) + 1;
  }
  return {
    total: log.length,
    byType,
    lastSeq: lastSeqOf(log),
    softLimit: EVENT_LOG_SOFT_LIMIT
  };
}
