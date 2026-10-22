import { writeJson } from '../lib/http.js';
import { ApiError } from './http.js';

export async function handleCoreMemoryRoutes({
  req,
  res,
  url,
  sessionService,
  agentService,
  validateMutatingRequest,
  readRequestJson
}) {
  if (req.method === 'GET' && url.pathname === '/api/memory/core') {
    const session = await sessionService.getSession(url.searchParams.get('sessionId') || 'main');
    writeJson(res, 200, {
      sessionId: session.id,
      coreMemory: agentService.memoryService.getCoreMemory(session)
    });
    return true;
  }

  if (req.method === 'PUT' && url.pathname === '/api/memory/core') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const patch = body.coreMemory ?? body;
    if (!isPlainObject(patch)) throw new ApiError(400, 'INVALID_CORE_MEMORY');
    const session = await sessionService.getSession(body.sessionId || 'main');
    const coreMemory = agentService.memoryService.updateCoreMemory(session, patch);
    await sessionService.saveSession(session);
    writeJson(res, 200, { sessionId: session.id, coreMemory });
    return true;
  }

  return false;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
