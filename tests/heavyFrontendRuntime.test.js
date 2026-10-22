import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';

test('heavy frontend runtime starts in local observation and serves a managed isolated gateway', async (t) => {
  const rootDir = await createTestRoot();
  const observedCalls = [];
  const providerClient = {
    complete: async ({ provider, messages }) => {
      observedCalls.push({ provider, messages });
      return { content: `托管回复：${messages.at(-1).content}`, raw: { secret: 'not-forwarded' } };
    },
    stream: async ({ provider, messages, onToken }) => {
      observedCalls.push({ provider, messages });
      await onToken('流式');
      await onToken('回复');
      return { content: '流式回复' };
    }
  };
  const app = createApp({ rootDir, providerClient });
  t.after(() => app.close?.());
  await saveProvider(app);

  const importResponse = await request(app, {
    method: 'POST',
    url: '/api/heavy-frontends/import',
    headers: mainHeaders(),
    body: createBundle('console.log("v1")')
  });
  assert.equal(importResponse.status, 200);
  const imported = importResponse.json().package;
  assert.equal(imported.currentRevision.review.status, 'local-observe');
  assert.ok(imported.currentRevision.findings.some((finding) => finding.id === 'api-credential-storage'));
  assert.ok(imported.currentRevision.findings.some((finding) => finding.id === 'remote-cors-proxy'));

  const reviewResponse = await request(app, {
    method: 'POST',
    url: `/api/heavy-frontends/${encodeURIComponent(imported.id)}/review`,
    headers: mainHeaders(),
    body: {
      decision: 'approved',
      contentHash: imported.currentRevision.contentHash,
      note: '已核对请求入口、存储与外链；仅允许托管网关。'
    }
  });
  assert.equal(reviewResponse.status, 200);
  assert.equal(reviewResponse.json().package.currentRevision.review.status, 'approved');

  const launchResponse = await request(app, {
    method: 'POST',
    url: `/api/heavy-frontends/${encodeURIComponent(imported.id)}/launch`,
    headers: mainHeaders(),
    body: { budget: { maxCalls: 3, maxOutputTokensPerCall: 2048 } }
  });
  assert.equal(launchResponse.status, 200);
  const launched = launchResponse.json();
  const launchUrl = new URL(launched.launchUrl);
  const runtimeBase = launchUrl.pathname.slice(0, launchUrl.pathname.indexOf('/files/'));
  assert.match(launchUrl.hostname, /^hf-[a-f0-9-]+\.heavy\.localhost$/);
  assert.match(runtimeBase, /\/cap\/[A-Za-z0-9_-]+$/);
  assert.equal(launchUrl.search, '');
  assert.equal(launched.instance.provider.id, 'local');
  assert.equal(launched.instance.budget.maxCalls, 3);
  assert.doesNotMatch(JSON.stringify(launched), /super-secret-key/);

  const entryResponse = await request(app, {
    url: `${launchUrl.pathname}${launchUrl.search}`,
    headers: { host: launchUrl.host }
  });
  assert.equal(entryResponse.status, 200);
  assert.match(entryResponse.headers['content-security-policy'], /connect-src 'self'/);
  assert.match(entryResponse.headers['content-security-policy'], /worker-src 'none'/);
  assert.match(entryResponse.text, /managed-by-narrative-engine/);
  assert.match(entryResponse.text, /__LRA_HEAVY_RUNTIME__/);
  assert.doesNotMatch(entryResponse.text, /super-secret-key/);
  assert.match(entryResponse.headers['set-cookie'], /^lra_heavy_session=/);

  const assetResponse = await request(app, {
    url: `${runtimeBase}/files/api-service.js`,
    headers: { host: launchUrl.host }
  });
  assert.equal(assetResponse.status, 200);
  assert.match(assetResponse.text, /jxz_apiConfig/);

  const unauthorizedGateway = await request(app, {
    method: 'POST',
    url: `/heavy-runtime/instances/${launched.instance.id}/v1/chat/completions`,
    headers: { host: launchUrl.host, 'content-type': 'application/json' },
    body: { messages: [{ role: 'user', content: '越权' }] }
  });
  assert.equal(unauthorizedGateway.status, 401);

  const gatewayResponse = await request(app, {
    method: 'POST',
    url: `${runtimeBase}/proxy?target=${encodeURIComponent(
      `http://${launchUrl.host}${runtimeBase}/v1/chat/completions`
    )}`,
    headers: {
      host: launchUrl.host,
      'content-type': 'application/json',
      authorization: 'Bearer managed-by-narrative-engine'
    },
    body: {
      model: 'attacker-selected-model',
      messages: [{ role: 'system', content: '应用自己的提示词' }, { role: 'user', content: '继续剧情' }],
      max_tokens: 999999,
      stream: false
    }
  });
  assert.equal(gatewayResponse.status, 200);
  assert.equal(gatewayResponse.json().choices[0].message.content, '托管回复：继续剧情');
  assert.equal(observedCalls[0].provider.model, 'model-a');
  assert.equal(observedCalls[0].provider.maxTokens, 2048);
  assert.equal(observedCalls[0].messages.length, 2);

  const streamResponse = await request(app, {
    method: 'POST',
    url: `${runtimeBase}/v1/chat/completions`,
    headers: { host: launchUrl.host, 'content-type': 'application/json' },
    body: { messages: [{ role: 'user', content: '流式测试' }], stream: true }
  });
  assert.equal(streamResponse.status, 200);
  assert.match(streamResponse.headers['content-type'], /text\/event-stream/);
  assert.match(streamResponse.text, /流式/);
  assert.match(streamResponse.text, /data: \[DONE\]/);

  const thirdCall = await request(app, {
    method: 'POST',
    url: `${runtimeBase}/v1/chat/completions`,
    headers: { host: launchUrl.host, 'content-type': 'application/json' },
    body: { messages: [{ role: 'user', content: '第三次调用' }], stream: false }
  });
  assert.equal(thirdCall.status, 200);
  const exhaustedCall = await request(app, {
    method: 'POST',
    url: `${runtimeBase}/v1/chat/completions`,
    headers: { host: launchUrl.host, 'content-type': 'application/json' },
    body: { messages: [{ role: 'user', content: '第四次调用' }], stream: false }
  });
  assert.equal(exhaustedCall.status, 429);
  assert.equal(exhaustedCall.json().error, 'HEAVY_FRONTEND_CALL_BUDGET_EXCEEDED');

  const externalProxy = await request(app, {
    method: 'POST',
    url: `${runtimeBase}/proxy?target=${encodeURIComponent('https://evil.example/v1/chat/completions')}`,
    headers: { host: launchUrl.host, 'content-type': 'application/json' },
    body: { messages: [{ role: 'user', content: '泄露' }] }
  });
  assert.equal(externalProxy.status, 403);
  assert.equal(externalProxy.json().error, 'HEAVY_FRONTEND_PROXY_TARGET_BLOCKED');

  const statusResponse = await request(app, {
    url: `/api/heavy-frontends/runtime-sessions/${launched.instance.runtimeSessionId}`,
    headers: { origin: 'http://127.0.0.1:5178', host: '127.0.0.1:5178' }
  });
  assert.equal(statusResponse.status, 200);
  assert.equal(statusResponse.json().instance.usage.calls, 3);

  const snapshotResponse = await request(app, {
    method: 'POST',
    url: `/api/heavy-frontends/runtime-sessions/${launched.instance.runtimeSessionId}/snapshot`,
    headers: mainHeaders(),
    body: { payload: { saveName: '测试快照', gameData: { week: 1 } } }
  });
  assert.equal(snapshotResponse.status, 200);
  assert.equal(snapshotResponse.json().snapshot.packageId, imported.id);

  const auditResponse = await request(app, {
    url: `/api/heavy-frontends/${encodeURIComponent(imported.id)}/audits`,
    headers: { origin: 'http://127.0.0.1:5178', host: '127.0.0.1:5178' }
  });
  assert.equal(auditResponse.status, 200);
  assert.ok(auditResponse.json().audits.some((entry) => entry.event === 'provider-call'));
  assert.ok(auditResponse.json().audits.some((entry) => entry.errorCode === 'HEAVY_FRONTEND_CALL_BUDGET_EXCEEDED'));
  assert.doesNotMatch(JSON.stringify(auditResponse.json()), /应用自己的提示词|继续剧情|super-secret-key/);
});

test('heavy frontend update returns to local observation, and explicit rejection blocks launch', async (t) => {
  const rootDir = await createTestRoot();
  const app = createApp({
    rootDir,
    providerClient: { complete: async () => ({ content: 'ok' }) }
  });
  t.after(() => app.close?.());
  await saveProvider(app);

  const first = (await request(app, {
    method: 'POST',
    url: '/api/heavy-frontends/import',
    headers: mainHeaders(),
    body: createBundle('console.log("v1")')
  })).json().package;
  await request(app, {
    method: 'POST',
    url: `/api/heavy-frontends/${first.id}/review`,
    headers: mainHeaders(),
    body: { decision: 'approved', contentHash: first.currentRevision.contentHash, note: '已完成测试包审核。' }
  });

  const second = (await request(app, {
    method: 'POST',
    url: '/api/heavy-frontends/import',
    headers: mainHeaders(),
    body: createBundle('console.log("v2")')
  })).json().package;
  assert.equal(second.id, first.id);
  assert.equal(second.revisions.length, 2);
  assert.equal(second.currentRevision.review.status, 'local-observe');

  const observed = await request(app, {
    method: 'POST',
    url: `/api/heavy-frontends/${first.id}/launch`,
    headers: mainHeaders(),
    body: {}
  });
  assert.equal(observed.status, 200);

  const rejected = await request(app, {
    method: 'POST',
    url: `/api/heavy-frontends/${first.id}/review`,
    headers: mainHeaders(),
    body: { decision: 'rejected', contentHash: second.currentRevision.contentHash, note: '本地测试中发现不可接受行为。' }
  });
  assert.equal(rejected.status, 200);
  const blocked = await request(app, {
    method: 'POST',
    url: `/api/heavy-frontends/${first.id}/launch`,
    headers: mainHeaders(),
    body: {}
  });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.json().error, 'HEAVY_FRONTEND_REJECTED');

  const traversal = await request(app, {
    method: 'POST',
    url: '/api/heavy-frontends/import',
    headers: mainHeaders(),
    body: {
      title: '恶意包',
      sourceName: 'evil',
      files: [{ path: '../escape.html', mimeType: 'text/html', dataBase64: base64('<p>x</p>') }]
    }
  });
  assert.equal(traversal.status, 400);
  assert.equal(traversal.json().error, 'HEAVY_FRONTEND_INVALID_PATH');
});

function createBundle(versionText) {
  return {
    title: '瀚海归义录测试包',
    sourceName: 'char_card_1',
    files: [
      {
        path: 'start-screen-noST.html',
        mimeType: 'text/html',
        dataBase64: base64('<!doctype html><html><head><script src="api-service.js"></script></head><body>重前端</body></html>')
      },
      {
        path: 'api-service.js',
        mimeType: 'text/javascript',
        dataBase64: base64(`localStorage.setItem('jxz_apiConfig', JSON.stringify({ apiKey: 'raw-key', corsProxyUrl: 'https://proxy.example/?target=' })); fetch('https://api.example/v1'); ${versionText}`)
      }
    ]
  };
}

async function saveProvider(app) {
  const response = await request(app, {
    method: 'PUT',
    url: '/api/providers',
    headers: mainHeaders(),
    body: {
      activeProviderId: 'local',
      taskProviders: { chat: 'local' },
      providers: [{
        id: 'local',
        kind: 'openai-compatible',
        baseUrl: 'https://api.example/v1',
        apiKey: 'super-secret-key',
        model: 'model-a',
        temperature: 0.8,
        maxTokens: 1024,
        headers: {}
      }]
    }
  });
  assert.equal(response.status, 200);
}

function mainHeaders() {
  return {
    host: '127.0.0.1:5178',
    origin: 'http://127.0.0.1:5178',
    'content-type': 'application/json'
  };
}

function base64(value) {
  return Buffer.from(value, 'utf8').toString('base64');
}

async function createTestRoot() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'heavy-frontend-http-'));
  await mkdir(path.join(rootDir, 'public'), { recursive: true });
  await writeFile(path.join(rootDir, 'public', 'index.html'), '<!doctype html><html><body>test</body></html>', 'utf8');
  return rootDir;
}

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
  const ended = new Promise((resolve) => { resolveEnd = resolve; });
  const res = {
    headersSent: false,
    writeHead(code, writtenHeaders = {}) {
      statusCode = code;
      responseHeaders = Object.fromEntries(Object.entries(writtenHeaders).map(([key, value]) => [key.toLowerCase(), value]));
      this.headersSent = true;
    },
    write(chunk = '') {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    },
    end(chunk = '') {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      resolveEnd();
    }
  };
  await app(req, res);
  await ended;
  const buffer = Buffer.concat(chunks);
  const text = buffer.toString('utf8');
  return {
    status: statusCode,
    headers: responseHeaders,
    buffer,
    text,
    json: () => JSON.parse(text)
  };
}
