import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { JsonStore } from '../server/lib/jsonStore.js';
import { ConfigService } from '../server/config/configService.js';
import { SessionService } from '../server/services/sessionService.js';
import { AgentService } from '../server/services/agentService.js';
import { deriveMessages } from '../server/agent/sessionEventLog.js';

// p2-02b 集成测试：AgentService 时间线方法走真实 SessionService 落盘，
// 核心契约 = 每分支 shadow 等价 + 切换后对话/编辑正常 + 磁盘往返无损。

async function createHarness({ providerClient = createEchoProviderClient() } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'timeline-agent-'));
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

async function assertShadowEquivalence(sessionService, sessionId = 'main') {
  const saved = await sessionService.getSession(sessionId);
  assert.deepEqual(
    deriveMessages(saved.eventLog),
    saved.messages,
    '活跃分支日志投影应与 messages 深相等'
  );
  return saved;
}

test('fork + switch + chat on branch: every branch keeps shadow equivalence', async () => {
  const { service, sessionService } = await createHarness();

  // root 上两轮对话
  await service.sendMessage({ sessionId: 'main', content: '第一回合。' });
  await service.sendMessage({ sessionId: 'main', content: '第二回合。' });
  const rootSession = await assertShadowEquivalence(sessionService);
  assert.equal(rootSession.messages.length, 4);

  // 在第一回合的回应处 fork（不切换）
  const firstAssistantId = (await sessionService.getSession('main')).messages[1].id;
  const forked = await service.forkTimelineAtMessage({
    sessionId: 'main',
    messageId: firstAssistantId,
    label: '魔道线'
  });
  assert.equal(forked.session.timeline.activeBranchId, 'root', '不切换时活跃分支不变');
  assert.equal(forked.branch.label, '魔道线');
  assert.equal(forked.branch.messageCount, 2);

  // 切到分支
  const switched = await service.switchTimeline({ sessionId: 'main', branchId: forked.branchId });
  assert.equal(switched.switched, true);
  const onBranch = await assertShadowEquivalence(sessionService);
  assert.equal(onBranch.messages.length, 2, '切到分支后 messages 是快照前缀');

  // 分支上继续对话
  await service.sendMessage({ sessionId: 'main', content: '魔道线推进。' });
  const branchSession = await assertShadowEquivalence(sessionService);
  assert.equal(branchSession.messages.length, 4);
  assert.equal(branchSession.messages[3].content, '回应：魔道线推进。');

  // 切回 root：完整恢复且日志无损
  await service.switchTimeline({ sessionId: 'main', branchId: 'root' });
  const backToRoot = await assertShadowEquivalence(sessionService);
  assert.equal(backToRoot.messages.length, 4);
  assert.equal(backToRoot.messages[3].content, '回应：第二回合。');

  // 分支视图：两条分支各自的消息数
  const timeline = await service.getTimeline({ sessionId: 'main' });
  assert.equal(timeline.branches.length, 2);
  const rootView = timeline.branches.find((b) => b.id === 'root');
  const branchView = timeline.branches.find((b) => b.id === forked.branchId);
  assert.equal(rootView.messageCount, 4);
  assert.equal(branchView.messageCount, 4);
  assert.equal(rootView.isActive, true);
  assert.equal(branchView.isActive, false);
});

test('edit and regenerate work on the active branch without leaking into others', async () => {
  const { service, sessionService } = await createHarness();
  await service.sendMessage({ sessionId: 'main', content: '第一回合。' });
  await service.sendMessage({ sessionId: 'main', content: '第二回合。' });

  const mid = await sessionService.getSession('main');
  const firstAssistantId = mid.messages[1].id;
  const forked = await service.forkTimelineAtMessage({
    sessionId: 'main',
    messageId: firstAssistantId,
    switchTo: true
  });

  // 分支上重生成第一条回应（swipe）
  await service.regenerateAssistantMessage({ sessionId: 'main', messageId: firstAssistantId });
  await assertShadowEquivalence(sessionService);
  const onBranch = await sessionService.getSession('main');
  assert.equal(onBranch.messages.length, 2, '分支上重生成不截断快照前的消息');
  assert.ok(onBranch.messages[1].swipes.length >= 2);

  // 切回 root：root 不受分支上的重生成影响（swipe 数保持 fork 时的 1 条初始值）
  await service.switchTimeline({ sessionId: 'main', branchId: 'root' });
  const rootSession = await assertShadowEquivalence(sessionService);
  assert.equal(rootSession.messages.length, 4);
  assert.equal(rootSession.messages[1].id, firstAssistantId);
  assert.equal(rootSession.messages[1].swipes.length, 1, 'root 不含分支上新增的 swipe');
});

test('timeline operations persist across disk round-trips', async () => {
  const { service, sessionService } = await createHarness();
  await service.sendMessage({ sessionId: 'main', content: '第一回合。' });
  await service.sendMessage({ sessionId: 'main', content: '第二回合。' });

  const mid = await sessionService.getSession('main');
  const forked = await service.forkTimelineAtMessage({
    sessionId: 'main',
    messageId: mid.messages[1].id,
    label: '试炼线'
  });
  await service.switchTimeline({ sessionId: 'main', branchId: forked.branchId });
  await service.sendMessage({ sessionId: 'main', content: '试炼线推进。' });

  // 磁盘往返：分支结构 + 非活跃 root 日志 + 活跃分支投影全部无损
  const saved = await sessionService.getSession('main');
  assert.equal(saved.timeline.branches.length, 2);
  assert.equal(saved.timeline.activeBranchId, forked.branchId);
  const rootBranch = saved.timeline.branches.find((b) => b.id === 'root');
  assert.ok(rootBranch.eventLog, '切走后 root 日志冻结在分支记录里');
  assert.deepEqual(deriveMessages(rootBranch.eventLog).map((m) => m.content).slice(-1), ['回应：第二回合。']);
  await assertShadowEquivalence(sessionService);

  // rename / delete 持久化
  await service.renameTimelineBranchLabel({ sessionId: 'main', branchId: forked.branchId, label: '改名后的试炼线' });
  const renamed = await sessionService.getSession('main');
  assert.equal(renamed.timeline.branches.find((b) => b.id === forked.branchId).label, '改名后的试炼线');

  // 从分支再 fork 一个叶子后删除它
  const leaf = await service.forkTimelineAtMessage({
    sessionId: 'main',
    messageId: saved.messages[1].id
  });
  await service.removeTimelineBranch({ sessionId: 'main', branchId: leaf.branchId });
  const afterDelete = await sessionService.getSession('main');
  assert.equal(afterDelete.timeline.branches.length, 2);
});

test('memory rebuilds per branch on switch', async () => {
  const { service, sessionService } = await createHarness();
  await service.sendMessage({ sessionId: 'main', content: '第一回合。' });
  await service.sendMessage({ sessionId: 'main', content: '第二回合。' });

  const mid = await sessionService.getSession('main');
  const forked = await service.forkTimelineAtMessage({
    sessionId: 'main',
    messageId: mid.messages[1].id,
    switchTo: true
  });
  // 分支上推进两轮后再切回 root
  await service.sendMessage({ sessionId: 'main', content: '魔道线独有推进。' });
  await service.switchTimeline({ sessionId: 'main', branchId: 'root' });

  const rootSession = await sessionService.getSession('main');
  // root 记忆按 root 消息重建：分支 episode 只能以 superseded（软失效审计）存在，
  // 活跃（confirmed）episodes 不含分支消息
  const episodes = rootSession.memory?.episodicMemory?.episodes || [];
  const confirmed = episodes.filter((e) => e.status === 'confirmed');
  assert.equal(
    confirmed.some((e) => String(e.summary || '').includes('魔道线独有推进')),
    false,
    'root 活跃记忆不应包含分支消息'
  );
  await assertShadowEquivalence(sessionService);

  // 切回分支：分支记忆含独有消息
  await service.switchTimeline({ sessionId: 'main', branchId: forked.branchId });
  const branchSession = await sessionService.getSession('main');
  assert.equal(JSON.stringify(branchSession.memory || {}).includes('魔道线独有推进'), true);
});

test('compare returns divergent tails for real sessions', async () => {
  const { service, sessionService } = await createHarness();
  await service.sendMessage({ sessionId: 'main', content: '第一回合。' });
  await service.sendMessage({ sessionId: 'main', content: '第二回合。' });

  const mid = await sessionService.getSession('main');
  const forked = await service.forkTimelineAtMessage({
    sessionId: 'main',
    messageId: mid.messages[1].id,
    switchTo: true
  });
  await service.sendMessage({ sessionId: 'main', content: '魔道线推进。' });
  await service.switchTimeline({ sessionId: 'main', branchId: 'root' });

  const result = await service.compareTimeline({
    sessionId: 'main',
    leftBranchId: 'root',
    rightBranchId: forked.branchId
  });
  assert.equal(result.forkIndex, 2);
  assert.equal(result.left.tail.length, 2);
  assert.equal(result.right.tail.length, 2);
  assert.match(result.right.tail.at(-1).content, /魔道线推进/);
});

test('legacy sessions migrate transparently on first timeline access', async () => {
  const { store, service, sessionService } = await createHarness();
  // 直接落盘一个无 eventLog 的旧会话
  await store.write('sessions/legacy.json', {
    id: 'legacy',
    title: '旧会话',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    messages: [
      { id: 'u1', role: 'user', content: '旧消息', createdAt: '2026-08-01T00:00:00.000Z' }
    ],
    usageLedger: [],
    settings: {}
  });

  const timeline = await service.getTimeline({ sessionId: 'legacy' });
  assert.equal(timeline.branches.length, 1);
  assert.equal(timeline.branches[0].id, 'root');
  assert.equal(timeline.activeBranchId, 'root');

  // fork 直接可用
  const forked = await service.forkTimelineAtMessage({ sessionId: 'legacy', messageId: 'u1' });
  assert.equal(forked.branch.messageCount, 1);
  await service.switchTimeline({ sessionId: 'legacy', branchId: forked.branchId });
  await assertShadowEquivalence(sessionService, 'legacy');
});
