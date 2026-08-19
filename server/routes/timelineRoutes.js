// 时间线分支路由（p2-02c）：
// - 挂载在 /api/sessions/:sessionId/timeline/* 下
// - 写操作走 validateMutatingRequest（CSRF 守卫），错误码沿用 ApiError 风格
// - 所有操作由 AgentService 在会话锁内编排（记忆重建/索引失效/落盘）

import { writeJson } from '../lib/http.js';
import { ApiError } from './http.js';

const BRANCH_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

// 内核错误 → HTTP 状态码映射
const ERROR_STATUS_MAP = {
  FORK_MESSAGE_NOT_FOUND: 404,
  BRANCH_NOT_FOUND: 404,
  CANNOT_DELETE_ROOT_BRANCH: 409,
  CANNOT_DELETE_ACTIVE_BRANCH: 409,
  BRANCH_HAS_CHILDREN: 409
};

function toApiError(error) {
  const status = ERROR_STATUS_MAP[error?.message] || 400;
  return new ApiError(status, error?.message || 'TIMELINE_OPERATION_FAILED');
}

function requireBranchId(value) {
  const id = String(value || '').trim();
  if (!BRANCH_ID_PATTERN.test(id)) throw new ApiError(400, 'INVALID_BRANCH_ID');
  return id;
}

function requireMessageId(value) {
  const id = String(value || '').trim();
  if (!id) throw new ApiError(400, 'MISSING_MESSAGE_ID');
  return id;
}

export async function handleTimelineRoutes({
  req,
  res,
  url,
  sessionId,
  subPath,
  agentService,
  validateMutatingRequest,
  readRequestJson
}) {
  if (subPath !== 'timeline' && !subPath.startsWith('timeline/')) return false;

  const op = subPath === 'timeline' ? '' : subPath.slice('timeline/'.length);

  try {
    // GET /timeline → 分支树
    if (op === '' && req.method === 'GET') {
      writeJson(res, 200, await agentService.getTimeline({ sessionId }));
      return true;
    }

    // GET /timeline/compare?leftId=&rightId=
    if (op === 'compare' && req.method === 'GET') {
      const leftId = requireBranchId(url.searchParams.get('leftId') || url.searchParams.get('left'));
      const rightId = requireBranchId(url.searchParams.get('rightId') || url.searchParams.get('right'));
      writeJson(res, 200, await agentService.compareTimeline({
        sessionId,
        leftBranchId: leftId,
        rightBranchId: rightId
      }));
      return true;
    }

    // POST /timeline/fork { messageId, label?, switchTo? }
    if (op === 'fork' && req.method === 'POST') {
      validateMutatingRequest(req);
      const body = await readRequestJson(req);
      const messageId = requireMessageId(body.messageId);
      const result = await agentService.forkTimelineAtMessage({
        sessionId,
        messageId,
        label: typeof body.label === 'string' ? body.label : '',
        switchTo: body.switchTo === true
      });
      writeJson(res, 200, {
        branchId: result.branchId,
        branch: result.branch,
        session: result.session
      });
      return true;
    }

    // POST /timeline/switch { branchId }
    if (op === 'switch' && req.method === 'POST') {
      validateMutatingRequest(req);
      const body = await readRequestJson(req);
      const branchId = requireBranchId(body.branchId);
      const result = await agentService.switchTimeline({ sessionId, branchId });
      writeJson(res, 200, {
        switched: result.switched,
        activeBranchId: result.session.timeline.activeBranchId,
        session: result.session
      });
      return true;
    }

    // PATCH /timeline/branches/:branchId { label }
    const branchMatch = op.match(/^branches\/([^/]+)$/);
    if (branchMatch && req.method === 'PATCH') {
      validateMutatingRequest(req);
      const body = await readRequestJson(req);
      const label = String(body.label ?? '').trim();
      if (!label) throw new ApiError(400, 'MISSING_BRANCH_LABEL');
      const result = await agentService.renameTimelineBranchLabel({
        sessionId,
        branchId: requireBranchId(decodeURIComponent(branchMatch[1])),
        label
      });
      const branch = result.session.timeline.branches.find((b) => b.id === branchMatch[1]);
      writeJson(res, 200, { branch });
      return true;
    }

    // DELETE /timeline/branches/:branchId
    if (branchMatch && req.method === 'DELETE') {
      validateMutatingRequest(req);
      await agentService.removeTimelineBranch({
        sessionId,
        branchId: requireBranchId(decodeURIComponent(branchMatch[1]))
      });
      writeJson(res, 200, { deleted: true });
      return true;
    }

    return false;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error?.message === 'Invalid session id') throw new ApiError(400, 'INVALID_SESSION_ID');
    throw toApiError(error);
  }
}
