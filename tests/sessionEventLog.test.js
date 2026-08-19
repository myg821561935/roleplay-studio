import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { JsonStore } from '../server/lib/jsonStore.js';
import { SessionService } from '../server/services/sessionService.js';
import {
  ensureEventLog,
  appendSessionEvents,
  deriveMessages,
  summarizeEventLog
} from '../server/agent/sessionEventLog.js';

function message(id, role, content, extras = {}) {
  return { id, role, content, createdAt: '2026-08-20T10:00:00.000Z', ...extras };
}

async function createStore() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'event-log-'));
  return new JsonStore(root);
}

// ---- 迁移与基线 ----

test('ensureEventLog migrates legacy sessions with a single imported event', () => {
  const session = {
    id: 'legacy',
    messages: [message('u1', 'user', '第一回合'), message('a1', 'assistant', '回应一')]
  };
  ensureEventLog(session);
  assert.equal(session.eventLog.length, 1);
  assert.equal(session.eventLog[0].type, 'legacy.imported');
  assert.equal(session.eventLog[0].seq, 1);
  assert.deepEqual(deriveMessages(session.eventLog).map((m) => m.id), ['u1', 'a1']);
});

test('ensureEventLog keeps an empty log for empty sessions and is idempotent', () => {
  const session = { id: 'empty', messages: [] };
  ensureEventLog(session);
  assert.equal(session.eventLog.length, 0);

  ensureEventLog(session);
  assert.equal(session.eventLog.length, 0);
});

// ---- diff 形状 ----

test('appended messages produce message.created events', () => {
  const session = { id: 's', messages: [message('u1', 'user', 'hi')] };
  ensureEventLog(session);
  session.messages.push(message('a1', 'assistant', 'hello', { swipes: ['hello'] }));
  appendSessionEvents(session);

  const summary = summarizeEventLog(session.eventLog);
  assert.equal(summary.byType['message.created'], 1);
  assert.deepEqual(deriveMessages(session.eventLog).map((m) => m.id), ['u1', 'a1']);
});

test('in-place mutation produces message.updated with only the changed fields', () => {
  const session = { id: 's', messages: [message('u1', 'user', 'hi'), message('a1', 'assistant', 'hello')] };
  ensureEventLog(session);
  session.messages[1].content = 'edited';
  session.messages[1].bookmarked = true;
  appendSessionEvents(session);

  const update = session.eventLog.find((e) => e.type === 'message.updated');
  assert.ok(update, '应生成 message.updated 事件');
  assert.equal(update.payload.messageId, 'a1');
  assert.deepEqual(Object.keys(update.payload.patch).sort(), ['bookmarked', 'content']);
  assert.equal(update.payload.patch.content, 'edited');

  const derived = deriveMessages(session.eventLog);
  assert.equal(derived[1].content, 'edited');
  assert.equal(derived[1].bookmarked, true);
});

test('truncation produces messages.truncated and keeps the removed events recoverable', () => {
  const session = {
    id: 's',
    messages: [message('u1', 'user', 'hi'), message('a1', 'assistant', 'hello'), message('u2', 'user', 'again')]
  };
  ensureEventLog(session);
  session.messages = session.messages.slice(0, 1); // edit 截断
  appendSessionEvents(session);

  const truncated = session.eventLog.find((e) => e.type === 'messages.truncated');
  assert.ok(truncated, '应生成截断事件');
  assert.equal(truncated.payload.toLength, 1);
  // 投影到当前状态：只剩一条
  assert.deepEqual(deriveMessages(session.eventLog).map((m) => m.id), ['u1']);
});

test('truncate-then-repush with the same id (regenerate shape) yields updated with full patch', () => {
  // 真实 regenerate：assistantMessage 对象复用同 id，content 换新 swipe，长度不变
  const session = {
    id: 's',
    messages: [message('u1', 'user', 'hi'), message('a1', 'assistant', 'old')]
  };
  ensureEventLog(session);
  const repushed = message('a1', 'assistant', 'new', { swipes: ['old', 'new'], activeSwipeIndex: 1 });
  session.messages = [session.messages[0], repushed];
  appendSessionEvents(session);

  const types = session.eventLog.map((e) => e.type);
  assert.deepEqual(types, ['legacy.imported', 'message.updated']);
  const derived = deriveMessages(session.eventLog);
  assert.deepEqual(derived.map((m) => m.id), ['u1', 'a1']);
  assert.equal(derived[1].content, 'new');
  assert.deepEqual(derived[1].swipes, ['old', 'new']);
});

test('truncate-then-repush with a different id yields truncated + created', () => {
  const session = {
    id: 's',
    messages: [message('u1', 'user', 'hi'), message('a1', 'assistant', 'old')]
  };
  ensureEventLog(session);
  session.messages = session.messages.slice(0, 1);
  session.messages.push(message('a2', 'assistant', 'new')); // 不同 id
  appendSessionEvents(session);

  const types = session.eventLog.map((e) => e.type);
  assert.deepEqual(types, ['legacy.imported', 'messages.truncated', 'message.created']);
  assert.deepEqual(deriveMessages(session.eventLog).map((m) => m.id), ['u1', 'a2']);
});

test('multiple saves accumulate events and reset the baseline each time', () => {
  const session = { id: 's', messages: [] };
  ensureEventLog(session);
  session.messages.push(message('u1', 'user', 'one'));
  appendSessionEvents(session);
  session.messages.push(message('a1', 'assistant', 'reply-one'));
  appendSessionEvents(session);
  session.messages[1].content = 'reply-edited';
  appendSessionEvents(session);

  const summary = summarizeEventLog(session.eventLog);
  assert.equal(summary.byType['message.created'], 2);
  assert.equal(summary.byType['message.updated'], 1);
  assert.deepEqual(deriveMessages(session.eventLog).map((m) => m.content), ['one', 'reply-edited']);
});

test('no-op saves append nothing', () => {
  const session = { id: 's', messages: [message('u1', 'user', 'hi')] };
  ensureEventLog(session);
  appendSessionEvents(session);
  assert.equal(session.eventLog.length, 1);
});

// ---- 鲁棒性 ----

test('field deletion is recorded explicitly and survives JSON round-trip', () => {
  // 真实场景：continueMessage 里 delete lastMessage.adjudication
  const session = {
    id: 's',
    messages: [message('a1', 'assistant', 'hello', { adjudication: { status: 'accepted' }, turnFrameError: 'x' })]
  };
  ensureEventLog(session);
  delete session.messages[0].adjudication;
  delete session.messages[0].turnFrameError;
  appendSessionEvents(session);

  const update = session.eventLog.find((e) => e.type === 'message.updated');
  assert.ok(update, '应生成 message.updated 事件');
  assert.deepEqual(update.payload.deleted.sort(), ['adjudication', 'turnFrameError']);
  // undefined 补丁值不得进入事件（JSON 落盘会丢键）
  assert.equal('adjudication' in (update.payload.patch || {}), false);
  assert.equal('turnFrameError' in (update.payload.patch || {}), false);

  // JSON 往返后投影仍与 messages 深相等（删除语义不丢失）
  const persisted = JSON.parse(JSON.stringify(session));
  assert.equal('adjudication' in deriveMessages(persisted.eventLog)[0], false);
  assert.equal('turnFrameError' in deriveMessages(persisted.eventLog)[0], false);
});

test('replacement at the same index is recorded as created, keeping projection consistent', () => {
  const session = { id: 's', messages: [message('u1', 'user', 'hi')] };
  ensureEventLog(session);
  session.messages[0] = message('u2', 'user', 'replaced');
  appendSessionEvents(session);
  const derived = deriveMessages(session.eventLog);
  assert.deepEqual(derived.map((m) => m.id), ['u2']);
});

test('deriveMessages tolerates malformed events without throwing', () => {
  const derived = deriveMessages([
    null,
    { type: 'unknown.event', payload: {} },
    { type: 'message.created', payload: {} },
    { type: 'message.updated', payload: { messageId: 'missing' } },
    { type: 'messages.truncated', payload: { toLength: 'x' } }
  ]);
  assert.deepEqual(derived, []);
});

// ---- sessionService 集成（shadow 等价） ----

test('getSession migrates and saveSession shadows writes through the real service', async () => {
  const store = await createStore();
  const service = new SessionService(store);

  // 旧格式会话（无 eventLog）
  await store.write('sessions/legacy.json', {
    id: 'legacy',
    title: '旧会话',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    messages: [message('u1', 'user', '旧消息')],
    usageLedger: [],
    settings: {}
  });

  const session = await service.getSession('legacy');
  assert.equal(session.eventLog.length, 1);
  assert.equal(session.eventLog[0].type, 'legacy.imported');

  // 真实写入路径变异 + 保存
  session.messages.push(message('a1', 'assistant', '新回复'));
  await service.saveSession(session);

  const reloaded = await service.getSession('legacy');
  // shadow 等价：投影 ≡ messages
  const derived = deriveMessages(reloaded.eventLog);
  assert.deepEqual(
    derived.map((m) => `${m.id}:${m.content}`),
    reloaded.messages.map((m) => `${m.id}:${m.content}`)
  );
  const summary = summarizeEventLog(reloaded.eventLog);
  assert.equal(summary.byType['legacy.imported'], 1);
  assert.equal(summary.byType['message.created'], 1);
});

test('createSessionWithConfig produces an empty log and later writes shadow correctly', async () => {
  const store = await createStore();
  const service = new SessionService(store);

  const session = await service.createSessionWithConfig({ id: 'fresh', title: '新会话' });
  assert.equal(session.eventLog.length, 0);

  session.messages.push(message('u1', 'user', '开始'));
  await service.saveSession(session);

  const reloaded = await service.getSession('fresh');
  const derived = deriveMessages(reloaded.eventLog);
  assert.equal(derived.length, 1);
  assert.equal(derived[0].content, '开始');
  assert.deepEqual(derived, reloaded.messages);
});
