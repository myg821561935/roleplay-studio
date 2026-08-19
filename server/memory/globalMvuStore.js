import { normalizeMvuSnapshot } from '../compat/mvuProtocol.js';

const GLOBAL_MVU_PATH = 'config/global-mvu.json';
const MAX_GLOBAL_STATE_BYTES = 32_000;

/**
 * 跨会话 global 根 MVU 持久化。
 *
 * 设计约束：
 * - global 根与 chat 根同存于 session.memory.lightFrontendState.values，本模块只搬运 global 子树
 * - 写传播：saveSession 时把会话内 global 快照合并落盘（会话快照优先于落盘值，浅层合并防止旧会话回写覆盖）
 * - 读同步：getSession 时把落盘 global 合并进会话（落盘值优先，保证跨会话最新值可见）
 * - 合并方向相反是刻意的：保存方拥有本会话刚写入的权威值，加载方需要接受其他会话的更新
 */
export class GlobalMvuStore {
  constructor(store) {
    this.store = store;
    this.pendingWrite = null;
  }

  async readGlobalValues() {
    const snapshot = await this.store.read(GLOBAL_MVU_PATH, { values: {} });
    const values = snapshot?.values;
    if (!values || typeof values !== 'object' || Array.isArray(values)) return {};
    return sanitizeGlobalValues(values);
  }

  // 读同步：把落盘 global 合并进会话 MVU 状态（落盘优先）
  async mergeIntoSession(session) {
    const memory = session?.memory;
    const state = memory?.lightFrontendState;
    if (!state || typeof state !== 'object') return session;
    const diskGlobal = await this.readGlobalValues();
    if (!Object.keys(diskGlobal).length) return session;

    const normalized = normalizeMvuSnapshot(state);
    const nextGlobal = { ...sanitizeGlobalValues(normalized.values?.global), ...diskGlobal };
    memory.lightFrontendState = {
      ...state,
      values: { ...normalized.values, global: nextGlobal }
    };
    return session;
  }

  // 写传播：保存会话时把 global 快照落盘（会话快照优先）
  async persistFromSession(session) {
    const state = session?.memory?.lightFrontendState;
    if (!state || typeof state !== 'object') return null;
    const normalized = normalizeMvuSnapshot(state);
    const sessionGlobal = normalized.values?.global;
    if (!sessionGlobal || !Object.keys(sessionGlobal).length) return null;

    // 串行化落盘，防止并发 saveSession 的读-改-写交错
    const previous = this.pendingWrite || Promise.resolve();
    const task = previous.catch(() => {}).then(async () => {
      const diskGlobal = await this.readGlobalValues();
      const merged = { ...diskGlobal, ...sessionGlobal };
      if (Buffer.byteLength(JSON.stringify(merged), 'utf8') > MAX_GLOBAL_STATE_BYTES) {
        throw new Error('GLOBAL_MVU_STATE_TOO_LARGE');
      }
      await this.store.write(GLOBAL_MVU_PATH, {
        version: 1,
        values: merged,
        updatedAt: new Date().toISOString()
      });
      return merged;
    });
    this.pendingWrite = task.catch(() => null);
    return task;
  }
}

// 去掉原型污染键与不可序列化值（与 lightFrontendRuntime 的 BLOCKED_KEYS 约束保持一致）
function sanitizeGlobalValues(values) {
  const clean = {};
  for (const [key, value] of Object.entries(values || {})) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) continue;
    try {
      clean[key] = JSON.parse(JSON.stringify(value ?? null));
    } catch {
      // 跳过不可序列化值
    }
  }
  return clean;
}
