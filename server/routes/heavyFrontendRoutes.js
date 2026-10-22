import crypto from 'node:crypto';
import { writeJson } from '../lib/http.js';
import {
  ApiError,
  getHeader,
  readRequestBuffer,
  validateMutatingRequest
} from './http.js';
import {
  HEAVY_FRONTEND_RUNTIME_HEADERS,
  HeavyFrontendError
} from '../heavyFrontend/heavyFrontendRuntimeService.js';

const IMPORT_MAX_BYTES = 96 * 1024 * 1024;
const CHAT_MAX_BYTES = 16 * 1024 * 1024;
const SNAPSHOT_MAX_BYTES = 20 * 1024 * 1024;
const RUNTIME_COOKIE = 'lra_heavy_session';

export async function handleHeavyFrontendApiRoutes({ req, res, url, service }) {
  if (req.method === 'GET' && url.pathname === '/api/heavy-frontends') {
    writeJson(res, 200, {
      spec: 'lra.heavy-frontend-catalog/v1',
      packages: await service.listPackages()
    });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/heavy-frontends/import') {
    validateMutatingRequest(req);
    const body = await readBoundedJson(req, IMPORT_MAX_BYTES);
    writeJson(res, 200, await callService(() => service.importPackage(body)));
    return true;
  }

  const reviewRoute = matchPath(url.pathname, /^\/api\/heavy-frontends\/([^/]+)\/review$/);
  if (reviewRoute && req.method === 'POST') {
    validateMutatingRequest(req);
    const body = await readBoundedJson(req, 64 * 1024);
    writeJson(res, 200, await callService(() => service.reviewPackage(reviewRoute[0], body)));
    return true;
  }

  const launchRoute = matchPath(url.pathname, /^\/api\/heavy-frontends\/([^/]+)\/launch$/);
  if (launchRoute && req.method === 'POST') {
    validateMutatingRequest(req);
    const body = await readBoundedJson(req, 64 * 1024);
    const parentOrigin = resolveParentOrigin(req);
    const result = await callService(() => service.createLaunch(launchRoute[0], {
      ...body,
      parentOrigin
    }));
    const port = resolveLocalPort(req, parentOrigin);
    const origin = `http://${result.instance.expectedHostname}${port ? `:${port}` : ''}`;
    const filePath = result.instance.id
      ? `/heavy-runtime/instances/${encodeURIComponent(result.instance.id)}/cap/${encodeURIComponent(result.launchToken)}/files/${encodePathSegmented(
        (await service.getPackage(result.instance.packageId))?.currentRevision?.entryPath || 'index.html'
      )}`
      : '';
    writeJson(res, 200, {
      instance: result.instance,
      bridgeNonce: result.bridgeNonce,
      runtimeOrigin: origin,
      launchUrl: `${origin}${filePath}`
    });
    return true;
  }

  const auditRoute = matchPath(url.pathname, /^\/api\/heavy-frontends\/([^/]+)\/audits$/);
  if (auditRoute && req.method === 'GET') {
    writeJson(res, 200, {
      audits: await service.listAudits({
        packageId: auditRoute[0],
        limit: url.searchParams.get('limit')
      })
    });
    return true;
  }

  const runtimeStatusRoute = matchPath(url.pathname, /^\/api\/heavy-frontends\/runtime-sessions\/([^/]+)$/);
  if (runtimeStatusRoute && req.method === 'GET') {
    const runtimeSessionId = runtimeStatusRoute[0];
    const instance = findRuntimeInstance(service, runtimeSessionId);
    writeJson(res, 200, { instance: service.getPublicInstance(instance.id) });
    return true;
  }

  const snapshotRoute = matchPath(url.pathname, /^\/api\/heavy-frontends\/runtime-sessions\/([^/]+)\/snapshot$/);
  if (snapshotRoute && req.method === 'POST') {
    validateMutatingRequest(req);
    const body = await readBoundedJson(req, SNAPSHOT_MAX_BYTES);
    writeJson(res, 200, await callService(() => service.saveSnapshot(snapshotRoute[0], body.payload)));
    return true;
  }
  if (snapshotRoute && req.method === 'GET') {
    writeJson(res, 200, await callService(() => service.getSnapshot(snapshotRoute[0])));
    return true;
  }

  const closeRoute = matchPath(url.pathname, /^\/api\/heavy-frontends\/runtime-sessions\/([^/]+)\/close$/);
  if (closeRoute && req.method === 'POST') {
    validateMutatingRequest(req);
    await readBoundedJson(req, 16 * 1024);
    writeJson(res, 200, await callService(() => service.closeRuntime(closeRoute[0])));
    return true;
  }

  return false;
}

export async function handleHeavyFrontendRuntimeRoute({ req, res, url, service }) {
  const route = matchRuntimePath(url.pathname);
  if (!route) return false;

  const hostname = parseHostname(getHeader(req, 'host'));
  const launchToken = route.kind === 'file' ? String(url.searchParams.get('launchToken') || '') : '';
  const cookieToken = readCookie(req, RUNTIME_COOKIE);
  const authorization = callServiceSync(() => service.authorizeRuntime(route.instanceId, {
    hostname,
    launchToken,
    capabilityToken: route.capabilityToken,
    cookieToken
  }));
  const { instance, setCookie } = authorization;
  const commonHeaders = {
    ...HEAVY_FRONTEND_RUNTIME_HEADERS,
    ...(setCookie ? {
      'set-cookie': `${RUNTIME_COOKIE}=${encodeURIComponent(route.capabilityToken || launchToken)}; HttpOnly; SameSite=Strict; Path=/heavy-runtime/instances/${encodeURIComponent(instance.id)}; Max-Age=43200`
    } : {})
  };

  if (route.kind === 'file' && req.method === 'GET') {
    const file = await callService(() => service.readRuntimeFile(instance, route.filePath));
    res.writeHead(200, {
      ...commonHeaders,
      'content-type': file.contentType,
      'content-length': file.body.length,
      'cache-control': file.isEntry ? 'no-store' : 'private, max-age=31536000, immutable'
    });
    res.end(file.body);
    return true;
  }

  const gatewayPath = route.kind === 'proxy'
    ? resolveProxyTarget(url, instance, route.capabilityToken)
    : route.gatewayPath;

  if (gatewayPath === 'models' && req.method === 'GET') {
    writeRuntimeJson(res, 200, {
      object: 'list',
      data: [{
        id: instance.provider.model,
        object: 'model',
        created: 0,
        owned_by: 'roleplay-studio'
      }]
    }, commonHeaders);
    return true;
  }

  if (gatewayPath === 'chat/completions' && req.method === 'POST') {
    const body = await readBoundedJson(req, CHAT_MAX_BYTES);
    if (body.stream === true) {
      await streamCompletion({ req, res, service, instance, body, headers: commonHeaders });
    } else {
      const result = await callService(() => service.completeChat(instance, body));
      writeRuntimeJson(res, 200, buildCompletionPayload(result), commonHeaders);
    }
    return true;
  }

  throw new ApiError(404, 'HEAVY_FRONTEND_RUNTIME_ROUTE_NOT_FOUND');
}

async function streamCompletion({ res, service, instance, body, headers }) {
  res.writeHead(200, {
    ...headers,
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive'
  });
  const completionId = `chatcmpl-${crypto.randomUUID()}`;
  let model = instance.provider.model;
  try {
    const result = await service.completeChat(instance, body, {
      onToken: async (token) => {
        res.write(`data: ${JSON.stringify({
          id: completionId,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [{ index: 0, delta: { content: token }, finish_reason: null }]
        })}\n\n`);
      }
    });
    model = result.model;
    res.write(`data: ${JSON.stringify({
      id: completionId,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: result.usage
    })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    const mapped = mapServiceError(error);
    res.write(`data: ${JSON.stringify({ error: { code: mapped.code, message: mapped.code } })}\n\n`);
    res.end();
  }
}

function buildCompletionPayload(result) {
  return {
    id: `chatcmpl-${result.requestId}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: result.model,
    choices: [{
      index: 0,
      message: { role: 'assistant', content: result.content },
      finish_reason: 'stop'
    }],
    usage: result.usage
  };
}

function writeRuntimeJson(res, statusCode, payload, headers = {}) {
  const body = `${JSON.stringify(payload)}\n`;
  res.writeHead(statusCode, {
    ...headers,
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  });
  res.end(body);
}

async function readBoundedJson(req, maxBytes) {
  const contentType = getHeader(req, 'content-type').split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE');
  const buffer = await readRequestBuffer(req, { maxBytes });
  try {
    return JSON.parse(buffer.toString('utf8') || '{}');
  } catch {
    throw new ApiError(400, 'INVALID_JSON');
  }
}

function matchRuntimePath(pathname) {
  const match = pathname.match(/^\/heavy-runtime\/instances\/([^/]+)\/(?:cap\/([^/]+)\/)?(.+)$/);
  if (!match) return null;
  const instanceId = decodePart(match[1]);
  const capabilityToken = match[2] ? decodePart(match[2]) : '';
  const tail = match[3];
  if (tail.startsWith('files/')) {
    const rawPath = tail.slice('files/'.length);
    let filePath;
    try {
      filePath = rawPath.split('/').map((part) => decodeURIComponent(part)).join('/');
    } catch {
      throw new ApiError(400, 'HEAVY_FRONTEND_INVALID_PATH');
    }
    return { kind: 'file', instanceId, capabilityToken, filePath };
  }
  if (tail === 'v1/models') return { kind: 'gateway', instanceId, capabilityToken, gatewayPath: 'models' };
  if (tail === 'v1/chat/completions') return { kind: 'gateway', instanceId, capabilityToken, gatewayPath: 'chat/completions' };
  if (tail === 'proxy') return { kind: 'proxy', instanceId, capabilityToken };
  return { kind: 'unknown', instanceId, capabilityToken };
}

function resolveProxyTarget(url, instance, capabilityToken) {
  const target = String(url.searchParams.get('target') || '');
  let parsed;
  try {
    parsed = new URL(target, `http://${instance.expectedHostname}`);
  } catch {
    throw new ApiError(400, 'HEAVY_FRONTEND_PROXY_TARGET_INVALID');
  }
  if (parsed.hostname !== instance.expectedHostname) {
    throw new ApiError(403, 'HEAVY_FRONTEND_PROXY_TARGET_BLOCKED');
  }
  const capabilityPath = capabilityToken ? `/cap/${encodeURIComponent(capabilityToken)}` : '';
  const prefix = `/heavy-runtime/instances/${instance.id}${capabilityPath}/v1/`;
  if (!parsed.pathname.startsWith(prefix)) throw new ApiError(403, 'HEAVY_FRONTEND_PROXY_TARGET_BLOCKED');
  const targetPath = parsed.pathname.slice(prefix.length);
  if (!['models', 'chat/completions'].includes(targetPath)) {
    throw new ApiError(403, 'HEAVY_FRONTEND_PROXY_TARGET_BLOCKED');
  }
  return targetPath;
}

function findRuntimeInstance(service, runtimeSessionId) {
  service.pruneExpiredInstances();
  const instance = [...service.instances.values()].find((entry) => entry.runtimeSessionId === runtimeSessionId);
  if (!instance) throw new ApiError(404, 'HEAVY_FRONTEND_RUNTIME_NOT_FOUND');
  return instance;
}

function matchPath(pathname, pattern) {
  const match = pathname.match(pattern);
  if (!match) return null;
  return match.slice(1).map(decodePart);
}

function decodePart(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new ApiError(400, 'INVALID_PATH_ENCODING');
  }
}

function parseHostname(hostHeader) {
  const value = String(hostHeader || '').trim();
  if (!value) return '';
  if (value.startsWith('[')) return value.slice(1, value.indexOf(']'));
  return value.split(':')[0].toLowerCase();
}

function readCookie(req, name) {
  const cookie = getHeader(req, 'cookie');
  for (const item of cookie.split(';')) {
    const [key, ...rest] = item.trim().split('=');
    if (key === name) {
      try { return decodeURIComponent(rest.join('=')); } catch { return ''; }
    }
  }
  return '';
}

function resolveParentOrigin(req) {
  const origin = getHeader(req, 'origin');
  if (origin) return origin;
  const referer = getHeader(req, 'referer');
  if (referer) {
    try { return new URL(referer).origin; } catch {}
  }
  const host = getHeader(req, 'host') || '127.0.0.1:5178';
  return `http://${host}`;
}

function resolveLocalPort(req, parentOrigin) {
  try {
    const parsed = new URL(parentOrigin);
    if (parsed.port) return parsed.port;
  } catch {}
  const host = getHeader(req, 'host');
  const match = String(host || '').match(/:(\d+)$/);
  return match?.[1] || '5178';
}

function encodePathSegmented(value) {
  return String(value || '').split('/').map(encodeURIComponent).join('/');
}

async function callService(callback) {
  try {
    return await callback();
  } catch (error) {
    throw mapServiceError(error);
  }
}

function callServiceSync(callback) {
  try {
    return callback();
  } catch (error) {
    throw mapServiceError(error);
  }
}

function mapServiceError(error) {
  if (error instanceof ApiError) return error;
  if (error instanceof HeavyFrontendError) return new ApiError(error.statusCode, error.code, error.detail);
  return error;
}
