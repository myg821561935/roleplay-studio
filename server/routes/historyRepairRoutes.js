import { HistoryRepairService } from '../services/historyRepairService.js';
import { ApiError, readRequestJson, validateMutatingRequest } from './http.js';
import { writeJson } from '../lib/http.js';
export async function handleHistoryRepairRoutes({ req, res, subPath, sessionId, sessionService }) {
  if (!['history-repair/preview', 'history-repair/apply'].includes(subPath) || req.method !== 'POST') return false;
  validateMutatingRequest(req);
  const body = await readRequestJson(req);
  const repair = new HistoryRepairService(sessionService);
  try {
    const result = subPath.endsWith('/preview') ? { plan: await repair.preview(sessionId, body.playerName) } : { copy: await repair.apply(sessionId, body) };
    writeJson(res, 200, result);
  } catch (error) {
    if (error.message === 'SESSION_NOT_FOUND') throw new ApiError(404, 'SESSION_NOT_FOUND');
    if (['SOURCE_CHANGED', 'COPY_CONFLICT'].includes(error.message)) throw new ApiError(409, error.message, '存档已发生变化，请重新预览。');
    if (error.code) throw error;
    throw new ApiError(400, 'HISTORY_REPAIR_INVALID', error.message);
  }
  return true;
}
