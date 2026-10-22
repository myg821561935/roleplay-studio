import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applySandboxTransforms,
  normalizeSandboxExecutionMode
} from '../public/modules/sandboxRenderer.js';

test('sandbox transforms run unreviewed rules in local observation mode only', () => {
  const rule = createRule();
  const result = applySandboxTransforms('<status>ready</status>', [rule], [], {
    role: 'assistant'
  });

  assert.equal(result.text, 'LRA-SANDBOX-FRAGMENT-0');
  assert.equal(result.sandboxFragments.size, 1);
  assert.equal(result.blockedAssessments.length, 0);

  const strict = applySandboxTransforms('<status>ready</status>', [rule], [], {
    role: 'assistant',
    scriptExecutionMode: 'review-required'
  });
  assert.equal(strict.sandboxFragments.size, 0);
  assert.equal(strict.blockedAssessments[0].blockedReason, 'review-required');
});

test('sandbox transforms retain exact approvals and honor an explicit current-hash rejection', () => {
  const rule = createRule();
  const stale = applySandboxTransforms('<status>ready</status>', [rule], [{
    scriptId: rule.id,
    contentHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    decision: 'approved',
    policyVersion: 1
  }], { role: 'assistant' });
  const approved = applySandboxTransforms('<status>ready</status>', [rule], [{
    scriptId: rule.id,
    contentHash: rule.contentHash,
    decision: 'approved',
    policyVersion: 1
  }], { role: 'assistant' });

  assert.equal(stale.sandboxFragments.size, 1);
  assert.equal(stale.blockedAssessments.length, 0);
  assert.match(approved.text, /LRA-SANDBOX-FRAGMENT-0/);
  assert.equal(approved.sandboxFragments.size, 1);
  assert.equal(approved.sandboxFragments.get('LRA-SANDBOX-FRAGMENT-0').scriptId, rule.id);

  const rejected = applySandboxTransforms('<status>ready</status>', [rule], [{
    scriptId: rule.id,
    contentHash: rule.contentHash,
    decision: 'rejected',
    policyVersion: 1
  }], { role: 'assistant' });
  assert.equal(rejected.sandboxFragments.size, 0);
  assert.equal(rejected.blockedAssessments[0].blockedReason, 'explicitly-rejected');
});

test('development compatibility probe keeps the same rejection boundary while marking allowed fragments', () => {
  const rule = createRule();
  const probe = applySandboxTransforms('<status>ready</status>', [rule], [], {
    role: 'assistant',
    scriptExecutionMode: 'compatibility-probe'
  });
  assert.equal(probe.sandboxFragments.size, 1);
  assert.equal(normalizeSandboxExecutionMode('compatibility-probe'), 'compatibility-probe');
  assert.equal(normalizeSandboxExecutionMode('unexpected'), 'local-observe');

  const rejected = applySandboxTransforms('<status>ready</status>', [rule], [{
    scriptId: rule.id,
    contentHash: rule.contentHash,
    decision: 'revoked',
    policyVersion: 1
  }], {
    role: 'assistant',
    scriptExecutionMode: 'compatibility-probe'
  });
  assert.equal(rejected.sandboxFragments.size, 0);
  assert.equal(rejected.blockedAssessments[0].blockedReason, 'explicitly-rejected');
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
    requiresSandbox: true,
    contentHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  };
}
