import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ScriptGovernanceError,
  appendScriptExecutionAudit,
  applyScriptReview,
  attachScriptContentHashes,
  computeScriptContentHash,
  getScriptGovernanceSnapshot,
  isScriptRuleApproved,
  setScriptExecutionMode
} from '../server/security/scriptGovernance.js';

test('script approval is bound to the current executable content hash', () => {
  const rule = createRule();
  const session = createSession(rule);
  session.config.lightFrontend.regexTransforms = attachScriptContentHashes([rule]);

  const review = applyScriptReview(session, {
    scriptId: rule.id,
    decision: 'approved',
    reviewer: 'reviewer-a'
  }, { now: new Date('2026-07-30T10:00:00.000Z') });

  const currentRule = session.config.lightFrontend.regexTransforms[0];
  assert.equal(review.contentHash, currentRule.contentHash);
  assert.equal(isScriptRuleApproved(session.config.lightFrontend, currentRule), true);
  assert.deepEqual(session.config.lightFrontend.trustedScriptIds, ['status-script']);

  currentRule.replacement = '<script>window.changed = true</script>';
  currentRule.contentHash = computeScriptContentHash(currentRule);

  const snapshot = getScriptGovernanceSnapshot(session);
  assert.equal(snapshot.rules[0].approved, false);
  assert.equal(snapshot.rules[0].latestReview.contentHash, review.contentHash);
});

test('local observation executes hash-bound scripts until explicitly rejected, while strict mode requires approval', () => {
  const rule = createRule();
  const session = createSession(rule);
  session.config.lightFrontend.regexTransforms = attachScriptContentHashes([rule]);
  const currentRule = session.config.lightFrontend.regexTransforms[0];

  const observed = appendScriptExecutionAudit(session, {
    scriptId: rule.id,
    contentHash: currentRule.contentHash,
    status: 'launched'
  });
  assert.equal(observed.executionMode, 'local-observe');
  assert.equal(observed.permissionSource, 'local-observe');

  setScriptExecutionMode(session, { executionMode: 'review-required' });
  assert.throws(
    () => appendScriptExecutionAudit(session, {
      scriptId: rule.id,
      contentHash: currentRule.contentHash,
      status: 'launched'
    }),
    (error) => error instanceof ScriptGovernanceError && error.code === 'SCRIPT_EXECUTION_BLOCKED'
  );

  applyScriptReview(session, {
    scriptId: rule.id,
    decision: 'approved'
  });

  assert.throws(
    () => appendScriptExecutionAudit(session, {
      scriptId: rule.id,
      contentHash: 'sha256:deadbeef',
      status: 'launched'
    }),
    (error) => error instanceof ScriptGovernanceError && error.code === 'SCRIPT_CONTENT_HASH_MISMATCH'
  );

  const execution = appendScriptExecutionAudit(session, {
    scriptId: rule.id,
    contentHash: currentRule.contentHash,
    status: 'launched',
    messageId: 'message-1'
  }, { now: new Date('2026-07-30T10:01:00.000Z') });

  assert.equal(execution.status, 'launched');
  assert.equal(session.audit.scriptExecutions.length, 2);
  assert.equal(session.audit.scriptExecutions.at(-1).messageId, 'message-1');

  setScriptExecutionMode(session, { executionMode: 'local-observe' });
  applyScriptReview(session, { scriptId: rule.id, decision: 'rejected' });
  assert.throws(
    () => appendScriptExecutionAudit(session, {
      scriptId: rule.id,
      contentHash: currentRule.contentHash,
      status: 'launched'
    }),
    (error) => error instanceof ScriptGovernanceError && error.code === 'SCRIPT_EXECUTION_BLOCKED'
  );
});

test('development compatibility probe requires explicit acknowledgement, audits its source, and still honors rejection', () => {
  const rule = createRule();
  const session = createSession(rule);
  session.config.lightFrontend.regexTransforms = attachScriptContentHashes([rule]);
  const currentRule = session.config.lightFrontend.regexTransforms[0];

  assert.throws(
    () => setScriptExecutionMode(session, { executionMode: 'compatibility-probe' }),
    (error) => error instanceof ScriptGovernanceError && error.code === 'SCRIPT_DEVELOPER_MODE_ACK_REQUIRED'
  );

  setScriptExecutionMode(session, {
    executionMode: 'compatibility-probe',
    acknowledgeDeveloperRisk: true
  });
  const execution = appendScriptExecutionAudit(session, {
    scriptId: rule.id,
    contentHash: currentRule.contentHash,
    status: 'loaded'
  });
  assert.equal(execution.executionMode, 'compatibility-probe');
  assert.equal(execution.permissionSource, 'compatibility-probe');

  applyScriptReview(session, { scriptId: rule.id, decision: 'rejected' });
  assert.throws(
    () => appendScriptExecutionAudit(session, {
      scriptId: rule.id,
      contentHash: currentRule.contentHash,
      status: 'launched'
    }),
    (error) => error instanceof ScriptGovernanceError && error.code === 'SCRIPT_EXECUTION_BLOCKED'
  );
});

function createRule() {
  return {
    id: 'status-script',
    name: '状态面板脚本',
    pattern: '<status>([\\s\\S]*?)</status>',
    flags: 'g',
    replacement: '<script>document.body.textContent = "ok"</script>',
    scope: 'assistant',
    enabled: true,
    requiresSandbox: true
  };
}

function createSession(rule) {
  return {
    id: 'main',
    config: {
      lightFrontend: {
        regexTransforms: [rule]
      }
    }
  };
}
