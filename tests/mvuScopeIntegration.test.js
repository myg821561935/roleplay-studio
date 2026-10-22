import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMvuPatch } from '../server/compat/lightFrontendRuntime.js';
import { GlobalMvuStore } from '../server/memory/globalMvuStore.js';

test('mvu dual-scope separates chat and global variables', async () => {
  // 1. 模拟一个内存 Store
  const mockStorage = new Map();
  const store = {
    read: async (key, fallback) => mockStorage.has(key) ? mockStorage.get(key) : fallback,
    write: async (key, value) => { mockStorage.set(key, value); return value; }
  };
  const globalMvuStore = new GlobalMvuStore(store);

  // 2. 会话 A 初始状态
  const sessionA = {
    id: 'session-a',
    memory: {
      lightFrontendState: {
        revision: 1,
        values: {
          chat: { hp: 100, localBuff: '疾风步' },
          global: { playerLevel: 5, reputation: '游侠' }
        }
      }
    }
  };

  // 3. 在会话 A 中应用补丁：修改会话级 hp 与全局级 reputation，增加全局 unlockMap
  const patchResult = applyMvuPatch(
    sessionA.memory.lightFrontendState,
    {
      operations: [
        { op: 'set', path: 'chat.hp', value: 80 },
        { op: 'set', path: 'global.reputation', value: '名震江湖' },
        { op: 'set', path: 'global.unlocked_maps.kunlun', value: true }
      ]
    }
  );

  assert.equal(patchResult.enabled, true);
  sessionA.memory.lightFrontendState.values = patchResult.values;

  // 验证会话 A 的状态
  assert.equal(sessionA.memory.lightFrontendState.values.chat.hp, 80);
  assert.equal(sessionA.memory.lightFrontendState.values.global.reputation, '名震江湖');
  assert.equal(sessionA.memory.lightFrontendState.values.global.unlocked_maps.kunlun, true);

  // 4. 写传播：保存会话 A 时，global 状态落盘到 globalMvuStore
  await globalMvuStore.persistFromSession(sessionA);

  const diskGlobal = await globalMvuStore.readGlobalValues();
  assert.equal(diskGlobal.reputation, '名震江湖');
  assert.equal(diskGlobal.unlocked_maps?.kunlun, true);
  assert.equal(diskGlobal.hp, undefined, 'chat hp must not leak into disk global values');

  // 5. 读同步：会话 B 加载时，自动合并磁盘上的最新 global 状态，且保持自己的 chat 状态独立
  const sessionB = {
    id: 'session-b',
    memory: {
      lightFrontendState: {
        revision: 1,
        values: {
          chat: { hp: 100, localBuff: '铁壁' },
          global: { playerLevel: 5 } // 旧 global
        }
      }
    }
  };

  await globalMvuStore.mergeIntoSession(sessionB);

  // 验证会话 B：拥有会话 A 写入并落盘的 global 状态，但自身的 chat 状态完全不受影响
  assert.equal(sessionB.memory.lightFrontendState.values.chat.hp, 100, 'sessionB chat hp remains independent');
  assert.equal(sessionB.memory.lightFrontendState.values.chat.localBuff, '铁壁');
  assert.equal(sessionB.memory.lightFrontendState.values.global.reputation, '名震江湖', 'global synced to sessionB');
  assert.equal(sessionB.memory.lightFrontendState.values.global.unlocked_maps.kunlun, true, 'global synced to sessionB');
});
