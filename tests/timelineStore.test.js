import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ensureTimeline,
  forkTimeline,
  switchTimelineBranch,
  renameTimelineBranch,
  deleteTimelineBranch,
  compareTimelineBranches,
  listTimelineBranches
} from '../server/agent/timelineStore.js';
import { ensureEventLog, appendSessionEvents, deriveMessages } from '../server/agent/sessionEventLog.js';

function message(id, role, content) {
  return { id, role, content, createdAt: '2026-08-20T10:00:00.000Z' };
}

// 带 2 回合消息的会话（先 ensureEventLog 建立日志基线）
function createSession(messages) {
  const session = { id: 's', messages: messages.map((m) => ({ ...m })) };
  ensureEventLog(session);
  ensureTimeline(session);
  return session;
}

const TWO_ROUNDS = [
  message('u1', 'user', '第一回合'),
  message('a1', 'assistant', '回应一'),
  message('u2', 'user', '第二回合'),
  message('a2', 'assistant', '回应二')
];

// —— 迁移 ——

test('ensureTimeline migrates legacy sessions to a single root branch', () => {
  const session = { id: 's', messages: [] };
  ensureEventLog(session);
  ensureTimeline(session);

  assert.equal(session.timeline.activeBranchId, 'root');
  assert.equal(session.timeline.branches.length, 1);
  assert.equal(session.timeline.branches[0].id, 'root');
  assert.equal(session.timeline.branches[0].eventLog, null, '活跃分支日志在 session.eventLog');

  // 幂等
  ensureTimeline(session);
  assert.equal(session.timeline.branches.length, 1);
});

test('ensureTimeline requires an event log (integration contract)', () => {
  const session = { id: 's', messages: [message('u1', 'user', 'hi')] };
  assert.throws(() => ensureTimeline(session), /TIMELINE_REQUIRES_EVENT_LOG/);
});

// —— fork ——

test('fork seeds a branch whose projection equals the snapshot prefix', () => {
  const session = createSession(TWO_ROUNDS);
  const { branchId } = forkTimeline(session, { messageId: 'a1' });

  // 活跃分支不受影响
  assert.equal(session.timeline.activeBranchId, 'root');
  assert.equal(session.messages.length, 4);

  const branch = session.timeline.branches.find((b) => b.id === branchId);
  assert.ok(branch, '新分支应在列表中');
  assert.deepEqual(branch.forkPoint, { messageId: 'a1', messageCount: 2 });
  assert.equal(branch.parentBranchId, 'root');
  // 种子投影 ≡ 快照前缀
  assert.deepEqual(
    deriveMessages(branch.eventLog).map((m) => m.id),
    ['u1', 'a1']
  );
});

test('fork with switchTo switches immediately', () => {
  const session = createSession(TWO_ROUNDS);
  const { branchId } = forkTimeline(session, { messageId: 'a1', switchTo: true });

  assert.equal(session.timeline.activeBranchId, branchId);
  assert.deepEqual(session.messages.map((m) => m.id), ['u1', 'a1']);
});

test('fork rejects unknown messages and empty sessions', () => {
  const session = createSession(TWO_ROUNDS);
  assert.throws(() => forkTimeline(session, { messageId: 'nope' }), /FORK_MESSAGE_NOT_FOUND/);

  const empty = createSession([]);
  assert.throws(() => forkTimeline(empty, { messageId: 'u1' }), /FORK_MESSAGE_NOT_FOUND/);
});

// —— switch：往返无损 ——

test('switch away and back restores messages exactly (round-trip)', () => {
  const session = createSession(TWO_ROUNDS);
  // 活跃分支继续追加一轮（日志积累增量事件）
  session.messages.push(message('u3', 'user', '第三回合'), message('a3', 'assistant', '回应三'));
  appendSessionEvents(session);

  const { branchId } = forkTimeline(session, { messageId: 'a1' });

  // 切走：root 日志回填记录，messages 换轨到分支
  switchTimelineBranch(session, branchId);
  assert.deepEqual(session.messages.map((m) => m.id), ['u1', 'a1']);
  const rootBranch = session.timeline.branches.find((b) => b.id === 'root');
  assert.ok(rootBranch.eventLog, 'root 日志应回填到分支记录');
  assert.deepEqual(deriveMessages(rootBranch.eventLog).map((m) => m.id), ['u1', 'a1', 'u2', 'a2', 'u3', 'a3']);

  // 分支上继续对话（新事件进分支日志）
  session.messages.push(message('u2b', 'user', '分支线提问'));
  appendSessionEvents(session);

  // 切回：root 完整恢复（含第三回合），分支日志冻结
  switchTimelineBranch(session, 'root');
  assert.deepEqual(session.messages.map((m) => m.id), ['u1', 'a1', 'u2', 'a2', 'u3', 'a3']);
  const forkedBranch = session.timeline.branches.find((b) => b.id === branchId);
  assert.deepEqual(deriveMessages(forkedBranch.eventLog).map((m) => m.id), ['u1', 'a1', 'u2b']);

  // 再切回分支：分支线也完整恢复
  switchTimelineBranch(session, branchId);
  assert.deepEqual(session.messages.map((m) => m.id), ['u1', 'a1', 'u2b']);
});

test('switching to the current branch is a no-op', () => {
  const session = createSession(TWO_ROUNDS);
  const { switched } = switchTimelineBranch(session, 'root');
  assert.equal(switched, false);
  assert.equal(session.messages.length, 4);
});

test('switch rejects unknown branches', () => {
  const session = createSession(TWO_ROUNDS);
  assert.throws(() => switchTimelineBranch(session, 'ghost'), /BRANCH_NOT_FOUND/);
});

// —— 多级 fork ——

test('multi-level forks keep every lineage isolated', () => {
  const session = createSession(TWO_ROUNDS);
  const level1 = forkTimeline(session, { messageId: 'a1' }).branchId;

  // 先切到 level1 再从它 fork level2
  switchTimelineBranch(session, level1);
  session.messages.push(message('ub', 'user', '一级分支追加'));
  appendSessionEvents(session);
  const level2 = forkTimeline(session, { messageId: 'ub', label: '二级' }).branchId;
  switchTimelineBranch(session, level2);

  session.messages.push(message('uc', 'user', '二级分支追加'));
  appendSessionEvents(session);

  switchTimelineBranch(session, level1);
  assert.deepEqual(session.messages.map((m) => m.id), ['u1', 'a1', 'ub']);
  const l2 = session.timeline.branches.find((b) => b.id === level2);
  assert.equal(l2.parentBranchId, level1);
  assert.deepEqual(deriveMessages(l2.eventLog).map((m) => m.id), ['u1', 'a1', 'ub', 'uc']);
});

// —— rename / delete ——

test('rename updates the label with normalization', () => {
  const session = createSession(TWO_ROUNDS);
  const { branchId } = forkTimeline(session, { messageId: 'a1', label: '  试炼线  ' });
  renameTimelineBranch(session, branchId, '魔道线');
  const branch = session.timeline.branches.find((b) => b.id === branchId);
  assert.equal(branch.label, '魔道线');

  // 空 label 回退为原 label
  renameTimelineBranch(session, branchId, '   ');
  assert.equal(branch.label, '魔道线');
});

test('delete guards: root / active / with-children are rejected', () => {
  const session = createSession(TWO_ROUNDS);
  const level1 = forkTimeline(session, { messageId: 'a1' }).branchId;
  switchTimelineBranch(session, level1);
  session.messages.push(message('ub', 'user', '一级追加'));
  appendSessionEvents(session);
  const level2 = forkTimeline(session, { messageId: 'ub' }).branchId;

  assert.throws(() => deleteTimelineBranch(session, 'root'), /CANNOT_DELETE_ROOT_BRANCH/);
  assert.throws(() => deleteTimelineBranch(session, level1), /CANNOT_DELETE_ACTIVE_BRANCH/);

  // 切走后：level1 非活跃但有子分支，仍拒绝
  switchTimelineBranch(session, 'root');
  assert.throws(() => deleteTimelineBranch(session, level1), /BRANCH_HAS_CHILDREN/);

  // 删除叶子分支成功
  deleteTimelineBranch(session, level2);
  assert.equal(session.timeline.branches.some((b) => b.id === level2), false);
  assert.throws(() => deleteTimelineBranch(session, 'ghost'), /BRANCH_NOT_FOUND/);
});

// —— compare ——

test('compare finds the fork point by message-id prefix and returns both tails', () => {
  const session = createSession(TWO_ROUNDS);
  const branchId = forkTimeline(session, { messageId: 'a1', label: '魔道线' }).branchId;

  // 分支上追加独立内容
  const branch = session.timeline.branches.find((b) => b.id === branchId);
  branch.eventLog[0].payload.messages.push(message('u-x', 'user', '魔道线独有'), message('a-x', 'assistant', '魔道回应'));

  const result = compareTimelineBranches(session, 'root', branchId);
  assert.equal(result.forkIndex, 2);
  assert.equal(result.forkMessage.id, 'a1');
  assert.equal(result.left.messageCount, 4);
  assert.equal(result.right.messageCount, 4);
  assert.deepEqual(result.left.tail.map((m) => m.id), ['u2', 'a2']);
  assert.deepEqual(result.right.tail.map((m) => m.id), ['u-x', 'a-x']);
});

test('compare caps tails at 50 messages and rejects unknown branches', () => {
  const session = createSession(TWO_ROUNDS);
  const branchId = forkTimeline(session, { messageId: 'a1' }).branchId;
  const branch = session.timeline.branches.find((b) => b.id === branchId);
  for (let i = 0; i < 60; i += 1) {
    branch.eventLog[0].payload.messages.push(message(`x-${i}`, 'user', `第${i}条`));
  }

  const result = compareTimelineBranches(session, 'root', branchId);
  assert.equal(result.right.tail.length, 50);

  assert.throws(() => compareTimelineBranches(session, 'root', 'ghost'), /BRANCH_NOT_FOUND/);
});

// —— 分支树视图 ——

test('listTimelineBranches summarizes each branch with active/root flags', () => {
  const session = createSession(TWO_ROUNDS);
  const branchId = forkTimeline(session, { messageId: 'a1', label: '魔道线' }).branchId;

  const view = listTimelineBranches(session);
  assert.equal(view.length, 2);
  const root = view.find((b) => b.id === 'root');
  const forked = view.find((b) => b.id === branchId);
  assert.equal(root.isActive, true);
  assert.equal(root.isRoot, true);
  assert.equal(root.messageCount, 4);
  assert.equal(root.lastMessagePreview, '回应二');
  assert.equal(forked.isActive, false);
  assert.equal(forked.messageCount, 2);
  assert.equal(forked.childCount, 0);
  assert.equal(root.childCount, 1);
});

// —— 每分支 shadow 等价（p2-02 核心契约） ——

test('every branch projection stays equal to the messages that produced it', () => {
  const session = createSession(TWO_ROUNDS);
  // root 追加
  session.messages.push(message('u3', 'user', '第三回合'), message('a3', 'assistant', '回应三'));
  appendSessionEvents(session);

  const b1 = forkTimeline(session, { messageId: 'a1' }).branchId;
  switchTimelineBranch(session, b1);
  session.messages.push(message('ub', 'user', '分支B提问'), message('ab', 'assistant', '分支B回应'));
  appendSessionEvents(session);

  // root 上再 fork 一个 b2
  switchTimelineBranch(session, 'root');
  const b2 = forkTimeline(session, { messageId: 'u2' }).branchId;
  switchTimelineBranch(session, b2);
  session.messages.push(message('uc', 'user', '分支C提问'));
  appendSessionEvents(session);

  // 三条分支全部投影≡对应 messages 快照
  for (const branchId of ['root', b1, b2]) {
    switchTimelineBranch(session, branchId);
    assert.deepEqual(
      deriveMessages(session.eventLog),
      session.messages,
      `分支 ${branchId} 的日志投影应与 messages 深相等`
    );
    // 重复 save（no-op diff）不产生伪事件
    const before = session.eventLog.length;
    appendSessionEvents(session);
    assert.equal(session.eventLog.length, before, `分支 ${branchId} no-op save 不应追加事件`);
  }
});
