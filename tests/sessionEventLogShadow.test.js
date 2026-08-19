import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { JsonStore } from '../server/lib/jsonStore.js';
import { ConfigService } from '../server/config/configService.js';
import { SessionService } from '../server/services/sessionService.js';
import { AgentService } from '../server/services/agentService.js';
import { deriveMessages, summarizeEventLog } from '../server/agent/sessionEventLog.js';

// p2-01d 影子模式等价测试：走 agentService 真实写入路径，
// 每条路径 save 后断言 deriveMessages(eventLog) ≡ session.messages。
// messages 仍是唯一事实源，eventLog 是并行投影。

async function createHarness({ providerClient = createEchoProviderClient() } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'event-log-shadow-'));
  const store = new JsonStore(root);
  const configService = new ConfigService(store);
  const sessionService = new SessionService(store);
  await configService.saveProviders({
    activeProviderId: 'fake',
    providers: [createFakeProvider()]
  });
  return {
    store,
    sessionService,
    service: new AgentService({ configService, sessionService, providerClient })
  };
}

function createFakeProvider(overrides = {}) {
  return {
    id: 'fake',
    kind: 'openai-compatible',
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'secret',
    model: 'fake-model',
    temperature: 0.9,
    maxTokens: 2000,
    headers: {},
    ...overrides
  };
}

function createEchoProviderClient() {
  return {
    complete: async ({ messages }) => ({
      content: `回应：${messages.at(-1).content}`,
      raw: { fake: true }
    })
  };
}

async function reloadAndAssert(sessionService, sessionId = 'main') {
  const saved = await sessionService.getSession(sessionId);
  const derived = deriveMessages(saved.eventLog);
  assert.deepEqual(
    derived.map((m) => `${m.id}:${m.role}:${m.content}`),
    saved.messages.map((m) => `${m.id}:${m.role}:${m.content}`),
    '事件日志投影应与 messages 深相等'
  );
  return saved;
}

// ---- 路径 1：sendMessage（push user + assistant）----

test('shadow equivalence holds after sendMessage', async () => {
  const { service, sessionService } = await createHarness();
  await service.sendMessage({ sessionId: 'main', content: '第一回合。' });
  await service.sendMessage({ sessionId: 'main', content: '第二回合。' });

  const saved = await reloadAndAssert(sessionService);
  assert.equal(saved.messages.length, 4);
  const summary = summarizeEventLog(saved.eventLog);
  assert.equal(summary.byType['message.created'], 4);
});

// ---- 路径 2：sendMessageStream 完成（echo client 走 complete 回退分支）----

test('shadow equivalence holds after sendMessageStream completes', async () => {
  const { service, sessionService } = await createHarness();
  const events = [];
  await service.sendMessageStream({
    sessionId: 'main',
    content: '夜探沈府。',
    onToken: (content) => events.push(content),
    onPhase: () => {}
  });

  const saved = await reloadAndAssert(sessionService);
  assert.equal(saved.messages.length, 2);
  assert.ok(events.length > 0, 'echo 回退分支应模拟 token 流');
});

// ---- 路径 3：sendMessageStream 中止留存（push user + aborted assistant）----

test('shadow equivalence holds when an aborted partial turn is retained', async () => {
  const { service, sessionService } = await createHarness({
    providerClient: {
      stream: async ({ onToken }) => {
        await onToken('夜色沉沉，沈观澜立于');
        await onToken('檐下，指尖轻叩剑鞘');
        const abortError = new Error('This operation was aborted');
        abortError.name = 'AbortError';
        throw abortError;
      }
    }
  });

  await assert.rejects(
    () => service.sendMessageStream({ sessionId: 'main', content: '夜探沈府。', signal: new AbortController().signal }),
    (error) => error.code === 'GENERATION_ABORTED' && error.partialMessage?.aborted === true
  );

  const saved = await reloadAndAssert(sessionService);
  assert.equal(saved.messages.length, 2);
  assert.equal(saved.messages[1].aborted, true);
});

// ---- 路径 4：editMessage assistant 分支（swipes 变异 + 截断）----

test('shadow equivalence holds after editing an assistant message', async () => {
  const { service, sessionService } = await createHarness();
  const first = await service.sendMessage({ sessionId: 'main', content: '第一回合。' });
  await service.sendMessage({ sessionId: 'main', content: '第二回合。' });

  const assistantId = first.reply.id;
  await service.editMessage({ sessionId: 'main', messageId: assistantId, content: '修改后的回应一。' });

  const saved = await reloadAndAssert(sessionService);
  // 截断语义：edit 掉后面的回合，只留 user + edited assistant
  assert.equal(saved.messages.length, 2);
  assert.equal(saved.messages[1].content, '修改后的回应一。');
  const summary = summarizeEventLog(saved.eventLog);
  assert.equal(summary.byType['messages.truncated'], 1);
  assert.ok(summary.byType['message.updated'] >= 1);
});

// ---- 路径 5：editMessage user 分支（截断 + 重推新 assistant）----

test('shadow equivalence holds after editing a user message and regenerating', async () => {
  const { service, sessionService } = await createHarness();
  const first = await service.sendMessage({ sessionId: 'main', content: '第一回合。' });
  await service.sendMessage({ sessionId: 'main', content: '第二回合。' });

  const userId = first.session.messages[0].id;
  await service.editMessage({ sessionId: 'main', messageId: userId, content: '改写后的第一回合。' });

  const saved = await reloadAndAssert(sessionService);
  assert.equal(saved.messages.length, 2);
  assert.equal(saved.messages[0].content, '改写后的第一回合。');
  const summary = summarizeEventLog(saved.eventLog);
  // 不同 id 的 assistant 重推：truncated + created
  assert.equal(summary.byType['messages.truncated'], 1);
  assert.ok(summary.byType['message.created'] >= 3);
});

// ---- 路径 6：switchMessageSwipe（就地变异 content/swipes）----

test('shadow equivalence holds after switching a swipe', async () => {
  const { service, sessionService } = await createHarness();
  const first = await service.sendMessage({ sessionId: 'main', content: '第一回合。' });
  const assistantId = first.reply.id;
  await service.editMessage({ sessionId: 'main', messageId: assistantId, content: '候选回应 A。' });

  await service.switchMessageSwipe({ sessionId: 'main', messageId: assistantId, swipeIndex: 0 });

  const saved = await reloadAndAssert(sessionService);
  assert.equal(saved.messages[1].swipes.length, 2);
  assert.equal(saved.messages[1].activeSwipeIndex, 0);
});

// ---- 路径 7：regenerateAssistantMessage（截断 + 同 id 重推）----

test('shadow equivalence holds after regenerating an assistant message', async () => {
  const { service, sessionService } = await createHarness();
  const first = await service.sendMessage({ sessionId: 'main', content: '第一回合。' });
  const assistantId = first.reply.id;

  await service.regenerateAssistantMessage({ sessionId: 'main', messageId: assistantId });

  const saved = await reloadAndAssert(sessionService);
  assert.equal(saved.messages.length, 2);
  // 同 id 重推：投影仍是原 id
  assert.equal(saved.messages[1].id, assistantId);
  assert.ok(Array.isArray(saved.messages[1].swipes) && saved.messages[1].swipes.length >= 2);
});

// ---- 路径 8：toggleMessageVisibility / toggleMessageBookmark（就地变异）----

test('shadow equivalence holds after visibility and bookmark toggles', async () => {
  const { service, sessionService } = await createHarness();
  const first = await service.sendMessage({ sessionId: 'main', content: '第一回合。' });
  const userId = first.session.messages[0].id;
  const assistantId = first.reply.id;

  await service.toggleMessageVisibility({ sessionId: 'main', messageId: assistantId });
  await service.toggleMessageBookmark({ sessionId: 'main', messageId: userId, label: '关键转折' });

  const saved = await reloadAndAssert(sessionService);
  assert.equal(saved.messages[1].excluded, true);
  assert.equal(saved.messages[0].bookmarked, true);
  assert.equal(saved.messages[0].bookmarkLabel, '关键转折');
});

// ---- 路径 9：continueMessage（增量并入 last assistant）----

test('shadow equivalence holds after continuing the last assistant message', async () => {
  const { service, sessionService } = await createHarness();
  await service.sendMessage({ sessionId: 'main', content: '第一回合。' });

  await service.continueMessage({ sessionId: 'main' });

  const saved = await reloadAndAssert(sessionService);
  assert.equal(saved.messages.length, 2);
  assert.match(saved.messages[1].content, /\n/);
  const summary = summarizeEventLog(saved.eventLog);
  assert.ok(summary.byType['message.updated'] >= 1);
});

// ---- 组合路径：多操作混合后投影仍一致 ----

test('shadow equivalence survives a mixed sequence of write operations', async () => {
  const { service, sessionService } = await createHarness();
  const first = await service.sendMessage({ sessionId: 'main', content: '开局。' });
  await service.sendMessage({ sessionId: 'main', content: '推进。' });
  const assistantId = first.reply.id;
  const userId = first.session.messages[0].id;

  await service.regenerateAssistantMessage({ sessionId: 'main', messageId: assistantId });
  await reloadAndAssert(sessionService);

  await service.editMessage({ sessionId: 'main', messageId: userId, content: '改写开局。' });
  await reloadAndAssert(sessionService);

  await service.toggleMessageBookmark({ sessionId: 'main', messageId: userId });
  await service.toggleMessageVisibility({ sessionId: 'main', messageId: userId });
  await reloadAndAssert(sessionService);

  await service.continueMessage({ sessionId: 'main' });
  const saved = await reloadAndAssert(sessionService);

  // 磁盘上的投影与内存 messages 全字段等价（结构化深比较）
  assert.deepEqual(deriveMessages(saved.eventLog), saved.messages);
});
