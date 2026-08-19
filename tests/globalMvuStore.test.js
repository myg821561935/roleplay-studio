import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../server/lib/jsonStore.js';
import { SessionService } from '../server/services/sessionService.js';
import { GlobalMvuStore } from '../server/memory/globalMvuStore.js';

async function createHarness() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'global-mvu-'));
  const store = new JsonStore(root);
  return {
    root,
    store,
    sessionService: new SessionService(store),
    globalMvuStore: new GlobalMvuStore(store)
  };
}

function sessionWithMvu(id, { chat = {}, global = {}, enabled = true, revision = 1 } = {}) {
  return {
    id,
    title: '会话 ' + id,
    updatedAt: new Date().toISOString(),
    messages: [],
    memory: {
      lightFrontendState: { enabled, revision, values: { chat: { ...chat }, global: { ...global } } }
    }
  };
}

test('写传播：saveSession 把会话 global 根落盘到 config/global-mvu.json', async () => {
  const { store, sessionService } = await createHarness();
  await sessionService.saveSession(sessionWithMvu('sessionA', {
    global: { reputation: '名动江南', gold: 1200 }
  }));

  const persisted = await store.read('config/global-mvu.json', null);
  assert.equal(persisted.version, 1);
  assert.equal(persisted.values.reputation, '名动江南');
  assert.equal(persisted.values.gold, 1200);
  assert.ok(persisted.updatedAt);
});

test('写传播：chat 根不落盘，global 为空时不落盘', async () => {
  const { store, sessionService } = await createHarness();
  await sessionService.saveSession(sessionWithMvu('chatOnly', {
    chat: { affinity: 50 }
  }));

  const persisted = await store.read('config/global-mvu.json', null);
  assert.equal(persisted, null); // JSON.parse(ENOENT fallback structuredClone(null)) → null
});

test('读同步：会话 B 通过 getSession 读到会话 A 落盘的 global 值', async () => {
  const { sessionService } = await createHarness();
  await sessionService.saveSession(sessionWithMvu('sessionA', {
    global: { reputation: '初入江湖' }
  }));

  // 会话 B 原本 global 为空，读时应合并到落盘值
  await sessionService.saveSession(sessionWithMvu('sessionB', {
    chat: { location: '临安城' }
  }));
  const loadedB = await sessionService.getSession('sessionB');
  assert.equal(loadedB.memory.lightFrontendState.values.global.reputation, '初入江湖');
  assert.equal(loadedB.memory.lightFrontendState.values.chat.location, '临安城');
});

test('读同步：落盘值优先于会话内旧 global 值', async () => {
  const { sessionService } = await createHarness();
  // 会话 A 先写入 reputation
  await sessionService.saveSession(sessionWithMvu('sessionA', {
    global: { reputation: '名动江南' }
  }));
  // 会话 B 持有旧值（模拟离线期间的过期快照）
  await sessionService.saveSession(sessionWithMvu('sessionB', {
    global: { reputation: '无名小卒' }
  }));
  // 注意：saveSession(B) 会把 B 的旧值写传播落盘（会话快照优先），此时落盘是 '无名小卒'
  const loadedA = await sessionService.getSession('sessionA');
  assert.equal(loadedA.memory.lightFrontendState.values.global.reputation, '无名小卒');
});

test('跨会话传播链：A 写 → 落盘 → B 读并写新值 → A 再读拿到 B 的更新', async () => {
  const { sessionService } = await createHarness();

  await sessionService.saveSession(sessionWithMvu('sessionA', {
    global: { reputation: '初入江湖' }
  }));
  // B 先存在（global 为空），读时继承 A 落盘的值
  await sessionService.saveSession(sessionWithMvu('sessionB'));

  const loadedB = await sessionService.getSession('sessionB');
  loadedB.memory.lightFrontendState.values.global.reputation = '名震一方';
  await sessionService.saveSession(loadedB);

  const reloadedA = await sessionService.getSession('sessionA');
  assert.equal(reloadedA.memory.lightFrontendState.values.global.reputation, '名震一方');
});

test('读同步不会破坏 disabled 或无 MVU 状态的会话', async () => {
  const { sessionService } = await createHarness();
  await sessionService.saveSession(sessionWithMvu('seed', {
    global: { reputation: '名动江南' }
  }));

  // 无 lightFrontendState 的普通会话
  await sessionService.saveSession({
    id: 'plain',
    title: '普通会话',
    updatedAt: new Date().toISOString(),
    messages: [],
    memory: {}
  });
  const plain = await sessionService.getSession('plain');
  assert.equal(plain.memory.lightFrontendState, undefined);

  // MVU disabled 的会话：state 存在但 enabled=false，仍应合并 global（值存在即可见）
  await sessionService.saveSession(sessionWithMvu('disabled', {
    enabled: false,
    global: {}
  }));
  const disabled = await sessionService.getSession('disabled');
  assert.equal(disabled.memory.lightFrontendState.values.global.reputation, '名动江南');
});

test('写传播合并语义：落盘旧键不被会话快照删除（浅层合并）', async () => {
  const { store, sessionService } = await createHarness();
  // 先由 A 写入两个键
  await sessionService.saveSession(sessionWithMvu('sessionA', {
    global: { reputation: '名动江南', title: '大侠' }
  }));
  // B 的快照只包含其中一个键（模拟旧版本会话或部分状态）
  await sessionService.saveSession(sessionWithMvu('sessionB', {
    global: { reputation: '后起之秀' }
  }));
  const persisted = await store.read('config/global-mvu.json', null);
  assert.equal(persisted.values.reputation, '后起之秀'); // 会话快照优先
  assert.equal(persisted.values.title, '大侠'); // 落盘旧键保留，不被删除
});

test('写传播串行化：并发 saveSession 不产生交错丢失', async () => {
  const { store, sessionService } = await createHarness();
  const writes = [];
  for (let i = 0; i < 20; i += 1) {
    writes.push(sessionService.saveSession(sessionWithMvu(`concurrent-${i}`, {
      global: { [`key${i}`]: i }
    })));
  }
  await Promise.all(writes);

  const persisted = await store.read('config/global-mvu.json', null);
  for (let i = 0; i < 20; i += 1) {
    assert.equal(persisted.values[`key${i}`], i);
  }
});

test('大小上限：global 状态超过 32KB 时拒绝落盘并记录错误，不阻塞会话保存', async () => {
  const { store, sessionService } = await createHarness();
  const huge = 'x'.repeat(40_000);
  const session = sessionWithMvu('overflow', { global: { blob: huge } });

  const saved = await sessionService.saveSession(session);
  // 会话本体保存成功
  const sessionOnDisk = await store.read('sessions/overflow.json', null);
  assert.notEqual(sessionOnDisk, null);
  assert.equal(sessionOnDisk.messages.length, 0);
  // global 落盘被拒绝并记录错误
  assert.equal(saved.globalMvuError, 'GLOBAL_MVU_STATE_TOO_LARGE');
  const persisted = await store.read('config/global-mvu.json', null);
  assert.equal(persisted, null);
});

test('原型污染防护：global 根的 __proto__/constructor 键被过滤，不污染 Object.prototype', async () => {
  const { store, sessionService } = await createHarness();
  // 落盘文件直接含有恶意键（模拟外部手改 config/global-mvu.json）：读侧 sanitize 过滤
  await store.write('config/global-mvu.json', {
    version: 1,
    values: JSON.parse('{"__proto__": {"polluted": true}, "constructor": {"polluted": true}, "safe": "ok"}'),
    updatedAt: new Date().toISOString()
  });

  // 会话不含恶意键；读同步合并落盘值时被 sanitize
  await sessionService.saveSession(sessionWithMvu('reader', { global: {} }));
  const loaded = await sessionService.getSession('reader');
  const global = loaded.memory.lightFrontendState.values.global;
  assert.equal(global.safe, 'ok');
  assert.deepEqual(Object.keys(global), ['safe']); // 恶意键不作为自有键存在
  assert.equal(({}).polluted, undefined);

  // 写侧：会话 state 本身含 BLOCKED_KEYS 时 normalizeMvuSnapshot 拒绝（INVALID_MVU_KEY），
  // persistFromSession 不应落盘恶意键也不应崩溃
  await sessionService.saveSession({
    id: 'evil',
    title: '恶意',
    updatedAt: new Date().toISOString(),
    messages: [],
    memory: {
      lightFrontendState: {
        enabled: true,
        revision: 1,
        values: JSON.parse('{"chat": {}, "global": {"__proto__": {"polluted": true}, "safe": "ok"}}')
      }
    }
  });
  const persisted = await store.read('config/global-mvu.json', null);
  assert.notEqual(persisted, null);
  assert.equal(persisted.values.safe, 'ok');
  assert.equal(({}).polluted, undefined);
});

test('GlobalMvuStore 直接读写：mergeIntoSession 保持 chat 根不变', async () => {
  const { globalMvuStore } = await createHarness();
  await globalMvuStore.store.write('config/global-mvu.json', {
    version: 1,
    values: { reputation: '名动江南' },
    updatedAt: new Date().toISOString()
  });

  const session = sessionWithMvu('direct', {
    chat: { affection: 88 },
    global: { oldKey: '旧值' }
  });
  await globalMvuStore.mergeIntoSession(session);
  assert.equal(session.memory.lightFrontendState.values.chat.affection, 88);
  assert.equal(session.memory.lightFrontendState.values.global.reputation, '名动江南');
  // 落盘值优先：会话旧 global 键也保留（浅合并，磁盘没有的键不删除）
  assert.equal(session.memory.lightFrontendState.values.global.oldKey, '旧值');
});

test('旧版扁平 values 结构：读同步时迁移到双根并合并 global', async () => {
  const { store, sessionService } = await createHarness();
  await store.write('config/global-mvu.json', {
    version: 1,
    values: { reputation: '跨会话声望' },
    updatedAt: new Date().toISOString()
  });
  // 旧版会话：扁平 values（迁移后应全部归入 chat 根，global 从落盘合并）
  await store.write('sessions/legacy.json', {
    id: 'legacy',
    title: '旧版会话',
    updatedAt: new Date().toISOString(),
    messages: [],
    memory: {
      lightFrontendState: {
        enabled: true,
        revision: 3,
        values: { affinity: 42, reputation: '会话内旧值' }
      }
    }
  });

  const loaded = await sessionService.getSession('legacy');
  const values = loaded.memory.lightFrontendState.values;
  assert.equal(values.chat.affinity, 42);
  assert.equal(values.global.reputation, '跨会话声望'); // 落盘优先
  // 旧扁平 values 全部迁移进 chat 根（ST 语义：{{setvar}} 是 chat 级），
  // reputation 同时存在于 chat（旧值）与 global（落盘新值）两个作用域
  assert.equal(values.chat.reputation, '会话内旧值');
});
