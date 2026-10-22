import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';

// p2-02c 路由测试：走完整 createApp HTTP 栈（含 CSRF 守卫与错误码映射）。
// 对话种子用 /api/sessions/import 直接注入消息（绕过 provider）。

test('timeline routes: fork → tree → switch → chat-visible messages swap', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  // 种子：u1/a1（fork 点）+ u2/a2
  await request(app, {
    method: 'POST',
    url: '/api/sessions/import',
    headers: { 'content-type': 'application/json' },
    body: {
      id: 'tl-main',
      session: {
        title: '时间线测试',
        messages: [
          { id: 'u1', role: 'user', content: '第一回合' },
          { id: 'a1', role: 'assistant', content: '回应一' },
          { id: 'u2', role: 'user', content: '第二回合' },
          { id: 'a2', role: 'assistant', content: '回应二' }
        ]
      }
    }
  });

  // GET /timeline：迁移后单根分支
  const tree = await request(app, { url: '/api/sessions/tl-main/timeline' });
  assert.equal(tree.status, 200);
  assert.equal(tree.json().activeBranchId, 'root');
  assert.equal(tree.json().branches.length, 1);
  assert.equal(tree.json().branches[0].messageCount, 4);

  // POST /timeline/fork（不切换）
  const forked = await request(app, {
    method: 'POST',
    url: '/api/sessions/tl-main/timeline/fork',
    headers: { 'content-type': 'application/json' },
    body: { messageId: 'a1', label: '魔道线' }
  });
  assert.equal(forked.status, 200);
  const branchId = forked.json().branchId;
  assert.equal(forked.json().branch.label, '魔道线');
  assert.equal(forked.json().branch.messageCount, 2);

  // fork 不改变活跃分支的消息
  const stateAfterFork = await request(app, { url: '/api/state?sessionId=tl-main' });
  assert.equal(stateAfterFork.json().session.messages.length, 4);

  // POST /timeline/switch
  const switched = await request(app, {
    method: 'POST',
    url: '/api/sessions/tl-main/timeline/switch',
    headers: { 'content-type': 'application/json' },
    body: { branchId }
  });
  assert.equal(switched.status, 200);
  assert.equal(switched.json().switched, true);
  assert.equal(switched.json().activeBranchId, branchId);

  // 切换后 state 的 messages 即分支快照
  const stateOnBranch = await request(app, { url: '/api/state?sessionId=tl-main' });
  assert.deepEqual(
    stateOnBranch.json().session.messages.map((m) => m.id),
    ['u1', 'a1']
  );

  // 树视图：root 非活跃、分支活跃
  const treeAfter = await request(app, { url: '/api/sessions/tl-main/timeline' });
  const rootView = treeAfter.json().branches.find((b) => b.id === 'root');
  const branchView = treeAfter.json().branches.find((b) => b.id === branchId);
  assert.equal(rootView.isActive, false);
  assert.equal(branchView.isActive, true);
});

test('timeline routes: PATCH rename and DELETE leaf branch with guards', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  await request(app, {
    method: 'POST',
    url: '/api/sessions/import',
    headers: { 'content-type': 'application/json' },
    body: {
      id: 'tl-guards',
      session: {
        title: '守卫测试',
        messages: [
          { id: 'u1', role: 'user', content: '问题' },
          { id: 'a1', role: 'assistant', content: '回应' }
        ]
      }
    }
  });

  const forked = await request(app, {
    method: 'POST',
    url: '/api/sessions/tl-guards/timeline/fork',
    headers: { 'content-type': 'application/json' },
    body: { messageId: 'a1' }
  });
  const branchId = forked.json().branchId;

  // PATCH rename
  const renamed = await request(app, {
    method: 'PATCH',
    url: `/api/sessions/tl-guards/timeline/branches/${branchId}`,
    headers: { 'content-type': 'application/json' },
    body: { label: '试炼线' }
  });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.json().branch.label, '试炼线');

  // PATCH 空 label → 400
  const badRename = await request(app, {
    method: 'PATCH',
    url: `/api/sessions/tl-guards/timeline/branches/${branchId}`,
    headers: { 'content-type': 'application/json' },
    body: { label: '   ' }
  });
  assert.equal(badRename.status, 400);
  assert.equal(badRename.json().error, 'MISSING_BRANCH_LABEL');

  // DELETE root → 409（DELETE 走 JSON content-type，与前端 apiRequest body:{} 约定一致）
  const delRoot = await request(app, {
    method: 'DELETE',
    url: '/api/sessions/tl-guards/timeline/branches/root',
    headers: { 'content-type': 'application/json' },
    body: {}
  });
  assert.equal(delRoot.status, 409);
  assert.equal(delRoot.json().error, 'CANNOT_DELETE_ROOT_BRANCH');

  // 未知分支 → 404
  const delGhost = await request(app, {
    method: 'DELETE',
    url: '/api/sessions/tl-guards/timeline/branches/ghost',
    headers: { 'content-type': 'application/json' },
    body: {}
  });
  assert.equal(delGhost.status, 404);
  assert.equal(delGhost.json().error, 'BRANCH_NOT_FOUND');

  // DELETE 叶子分支成功
  const deleted = await request(app, {
    method: 'DELETE',
    url: `/api/sessions/tl-guards/timeline/branches/${branchId}`,
    headers: { 'content-type': 'application/json' },
    body: {}
  });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.json().deleted, true);

  const tree = await request(app, { url: '/api/sessions/tl-guards/timeline' });
  assert.equal(tree.json().branches.length, 1);
});

test('timeline routes: compare returns fork point and divergent tails', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  await request(app, {
    method: 'POST',
    url: '/api/sessions/import',
    headers: { 'content-type': 'application/json' },
    body: {
      id: 'tl-compare',
      session: {
        title: '对比测试',
        messages: [
          { id: 'u1', role: 'user', content: '第一回合' },
          { id: 'a1', role: 'assistant', content: '回应一' },
          { id: 'u2', role: 'user', content: '第二回合' },
          { id: 'a2', role: 'assistant', content: '回应二' }
        ]
      }
    }
  });

  const forked = await request(app, {
    method: 'POST',
    url: '/api/sessions/tl-compare/timeline/fork',
    headers: { 'content-type': 'application/json' },
    body: { messageId: 'a1', switchTo: true }
  });
  const branchId = forked.json().branchId;

  // 切回 root 再对比
  await request(app, {
    method: 'POST',
    url: '/api/sessions/tl-compare/timeline/switch',
    headers: { 'content-type': 'application/json' },
    body: { branchId: 'root' }
  });

  const compared = await request(app, {
    url: `/api/sessions/tl-compare/timeline/compare?leftId=root&rightId=${branchId}`
  });
  assert.equal(compared.status, 200);
  const payload = compared.json();
  assert.equal(payload.forkIndex, 2);
  assert.equal(payload.forkMessage.id, 'a1');
  assert.deepEqual(payload.left.tail.map((m) => m.id), ['u2', 'a2']);
  assert.deepEqual(payload.right.tail.map((m) => m.id), []);

  // 缺参数 → 400；未知分支 → 404
  const noParams = await request(app, { url: '/api/sessions/tl-compare/timeline/compare' });
  assert.equal(noParams.status, 400);
  assert.equal(noParams.json().error, 'INVALID_BRANCH_ID');

  const ghost = await request(app, {
    url: `/api/sessions/tl-compare/timeline/compare?leftId=root&rightId=ghost`
  });
  assert.equal(ghost.status, 404);
  assert.equal(ghost.json().error, 'BRANCH_NOT_FOUND');
});

test('timeline routes: fork with unknown message returns 404 and switch is idempotent', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  await request(app, {
    method: 'POST',
    url: '/api/sessions/import',
    headers: { 'content-type': 'application/json' },
    body: {
      id: 'tl-misc',
      session: { title: '杂项', messages: [{ id: 'u1', role: 'user', content: '问' }] }
    }
  });

  const badFork = await request(app, {
    method: 'POST',
    url: '/api/sessions/tl-misc/timeline/fork',
    headers: { 'content-type': 'application/json' },
    body: { messageId: 'ghost' }
  });
  assert.equal(badFork.status, 404);
  assert.equal(badFork.json().error, 'FORK_MESSAGE_NOT_FOUND');

  // 缺 messageId → 400
  const noId = await request(app, {
    method: 'POST',
    url: '/api/sessions/tl-misc/timeline/fork',
    headers: { 'content-type': 'application/json' },
    body: {}
  });
  assert.equal(noId.status, 400);
  assert.equal(noId.json().error, 'MISSING_MESSAGE_ID');

  // 切到当前分支 → switched=false
  const same = await request(app, {
    method: 'POST',
    url: '/api/sessions/tl-misc/timeline/switch',
    headers: { 'content-type': 'application/json' },
    body: { branchId: 'root' }
  });
  assert.equal(same.status, 200);
  assert.equal(same.json().switched, false);
});

// —— 与 httpApi.test.js 相同的请求 harness ——

async function request(app, { method = 'GET', url = '/', body, headers = {} } = {}) {
  const rawBody = body === undefined
    ? Buffer.alloc(0)
    : Buffer.isBuffer(body)
      ? body
      : typeof body === 'string'
        ? Buffer.from(body)
        : Buffer.from(JSON.stringify(body));
  const req = Readable.from(rawBody.length ? [rawBody] : []);
  req.method = method;
  req.url = url;
  req.headers = headers;

  const chunks = [];
  let statusCode = 200;
  let responseHeaders = {};
  let resolveEnd;
  const ended = new Promise((resolve) => {
    resolveEnd = resolve;
  });

  const res = {
    writeHead(code, writtenHeaders = {}) {
      statusCode = code;
      responseHeaders = writtenHeaders;
    },
    write(chunk = '') {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    },
    end(chunk = '') {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      resolveEnd();
    },
    setHeader() {},
    getHeaders() {
      return responseHeaders;
    }
  };

  const handled = await app(req, res);
  if (!handled) await ended;
  return {
    status: statusCode,
    headers: responseHeaders,
    json() {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }
  };
}

async function createTestRoot() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'timeline-http-'));
  await mkdir(path.join(rootDir, 'public'), { recursive: true });
  await writeFile(
    path.join(rootDir, 'public', 'index.html'),
    '<!doctype html><html><body><h1>角色剧场</h1></body></html>',
    'utf8'
  );
  return rootDir;
}
