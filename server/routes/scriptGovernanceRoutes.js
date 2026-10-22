import { writeJson } from '../lib/http.js';
import {
  ApiError,
  readRequestJson,
  validateMutatingRequest
} from './http.js';
import {
  ScriptGovernanceError,
  appendScriptExecutionAudit,
  applyScriptReview,
  getScriptGovernanceSnapshot,
  listScriptExecutionAudit,
  setScriptExecutionMode
} from '../security/scriptGovernance.js';

export async function handleScriptGovernanceRoutes({
  req,
  res,
  url,
  sessionId,
  subPath,
  sessionService
}) {
  if (!['script-reviews', 'script-executions', 'script-policy', 'trusted-scripts'].includes(subPath)) return false;

  const session = await getSession(sessionService, sessionId);

  if (subPath === 'script-reviews') {
    if (req.method === 'GET') {
      writeJson(res, 200, getScriptGovernanceSnapshot(session));
      return true;
    }
    if (req.method === 'PUT') {
      validateMutatingRequest(req);
      const body = await readRequestJson(req);
      const review = callGovernance(() => applyScriptReview(session, body));
      await sessionService.saveSession(session);
      writeJson(res, 200, {
        review,
        governance: getScriptGovernanceSnapshot(session),
        session
      });
      return true;
    }
    return false;
  }

  if (subPath === 'script-executions') {
    if (req.method === 'GET') {
      writeJson(res, 200, {
        executions: listScriptExecutionAudit(session, {
          limit: url.searchParams.get('limit')
        })
      });
      return true;
    }
    if (req.method === 'POST') {
      validateMutatingRequest(req);
      const body = await readRequestJson(req);
      const inputs = Array.isArray(body.executions) ? body.executions.slice(0, 100) : [body];
      if (!inputs.length) throw new ApiError(400, 'SCRIPT_EXECUTIONS_REQUIRED');
      const executions = inputs.map((input) => (
        callGovernance(() => appendScriptExecutionAudit(session, input))
      ));
      await sessionService.saveSession(session);
      writeJson(res, 200, {
        execution: executions.at(-1),
        executions
      });
      return true;
    }
    return false;
  }

  if (subPath === 'script-policy') {
    if (req.method === 'GET') {
      writeJson(res, 200, getScriptGovernanceSnapshot(session));
      return true;
    }
    if (req.method === 'PUT') {
      validateMutatingRequest(req);
      const body = await readRequestJson(req);
      const executionMode = callGovernance(() => setScriptExecutionMode(session, body));
      await sessionService.saveSession(session);
      writeJson(res, 200, {
        executionMode,
        governance: getScriptGovernanceSnapshot(session),
        session
      });
      return true;
    }
    return false;
  }

  // Backward-compatible endpoint. Legacy ID selections are converted into
  // hash-bound review records and are no longer authoritative by themselves.
  if (req.method === 'GET') {
    const governance = getScriptGovernanceSnapshot(session);
    writeJson(res, 200, {
      trustedScriptIds: governance.trustedScriptIds,
      reviews: governance.reviews,
      policyVersion: governance.policyVersion
    });
    return true;
  }
  if (req.method === 'PUT') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    if (!Array.isArray(body.trustedScriptIds)) {
      throw new ApiError(400, 'TRUSTED_SCRIPT_IDS_INVALID');
    }
    const requested = new Set(
      body.trustedScriptIds.map((id) => String(id || '').trim()).filter(Boolean).slice(0, 32)
    );
    const governance = getScriptGovernanceSnapshot(session);
    let latestReview = null;
    for (const rule of governance.rules) {
      const decision = requested.has(rule.scriptId) ? 'approved' : 'revoked';
      if (rule.approved === (decision === 'approved')) continue;
      latestReview = callGovernance(() => applyScriptReview(session, {
        scriptId: rule.scriptId,
        decision,
        reviewer: body.reviewer || 'local-user',
        note: body.note || 'Migrated from trusted-scripts compatibility endpoint.'
      }));
    }
    await sessionService.saveSession(session);
    const nextGovernance = getScriptGovernanceSnapshot(session);
    writeJson(res, 200, {
      trustedScriptIds: nextGovernance.trustedScriptIds,
      reviews: nextGovernance.reviews,
      review: latestReview,
      session
    });
    return true;
  }
  return false;
}

async function getSession(sessionService, sessionId) {
  try {
    return await sessionService.getSession(sessionId);
  } catch (error) {
    if (error.message === 'Invalid session id') throw new ApiError(400, 'INVALID_SESSION_ID');
    throw error;
  }
}

function callGovernance(callback) {
  try {
    return callback();
  } catch (error) {
    if (!(error instanceof ScriptGovernanceError)) throw error;
    const statusCode = error.code === 'SCRIPT_RULE_NOT_FOUND'
      ? 404
      : error.code === 'SCRIPT_REVIEW_REQUIRED' || error.code === 'SCRIPT_EXECUTION_BLOCKED' || error.code === 'SCRIPT_CONTENT_HASH_MISMATCH'
        ? 409
        : 400;
    throw new ApiError(statusCode, error.code);
  }
}
