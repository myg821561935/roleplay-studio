import { APP_VERSION, RELEASE_CHANNEL } from '../server/releaseInfo.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { migrateData } from '../server/data/migrations.js';
import { exportCharacterCardPng } from '../server/character/characterCardExport.js';
import { extractCharacterCardImage } from '../server/character/characterCardImport.js';

test('GET /api/state returns config and session', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, { url: '/api/state' });
  const payload = response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.session.id, 'main');
  assert.equal(Array.isArray(payload.config.promptModules), true);
  assert.equal(payload.config.characterCard.name, '未命名主角');
  assert.equal(payload.session.authoring.spec, 'lra.authoring-ledger/v1');
  assert.equal(payload.session.settings.activeAgentProfileId, 'story-director');
});

test('POST /api/sessions/:id/prompt-preview exposes the assembled local request without calling a provider', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  const response = await request(app, {
    method: 'POST',
    url: '/api/sessions/main/prompt-preview',
    headers: { 'content-type': 'application/json' },
    body: { content: '我先观察门外的动静。' }
  });
  const payload = response.json();

  assert.equal(response.status, 200);
  assert.ok(payload.tokenEstimate > 0);
  assert.ok(payload.promptStudio.changes.some(row => row.source === '当前输入'));
  assert.ok(Array.isArray(payload.promptStudio.blocks));
  assert.ok(Array.isArray(payload.promptStudio.modules));
  assert.equal(payload.promptStudio.integrity.status, 'complete');
  assert.equal(payload.request.messages.at(-1).content, '我先观察门外的动静。');
});

test('GET /api/sessions/:id/knowledge-graph exposes a bounded local projection and audit', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  await request(app, { url: '/api/state' });

  const graphResponse = await request(app, { url: '/api/sessions/main/knowledge-graph?depth=2' });
  const mutationResponse = await request(app, { url: '/api/sessions/main/knowledge-graph/mutations' });

  assert.equal(graphResponse.status, 200);
  assert.equal(graphResponse.json().graph.storage, 'sqlite');
  assert.equal(graphResponse.json().graph.schemaVersion, 1);
  assert.equal(graphResponse.json().graph.view, 'player');
  assert.equal(mutationResponse.status, 200);
  assert.ok(mutationResponse.json().mutations.length >= 1);
});

test('GET /api/sessions/:id/health returns a read-only session health report', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, { url: '/api/sessions/main/health' });
  const payload = response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.health.spec, 'lra.session-health/v1');
  assert.equal(payload.health.sessionId, 'main');
  assert.equal(Array.isArray(payload.health.checks), true);
  assert.equal(payload.health.checks.some((item) => item.id === 'session-config-boundary'), true);
});

test('reference repair API previews, fingerprints, backs up, and repairs orphan bindings without deleting content', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  await request(app, {
    method: 'POST',
    url: '/api/sessions/import',
    headers: { 'content-type': 'application/json' },
    body: {
      id: 'orphan-session',
      session: {
        title: '旧存档',
        storyProjectId: 'missing-project',
        basePackId: 'missing-pack',
        messages: [{ id: 'm1', role: 'assistant', content: '正文保留' }],
        config: {
          contentPackId: 'missing-pack',
          characterCard: { name: '阿月', description: '角色内容保留' },
          worldBook: [{ id: 'w1', content: '世界内容保留' }],
          promptModules: [{ id: 'p1', text: 'Prompt 保留' }]
        },
        memory: {
          resourcePackId: 'missing-pack',
          ruleSystem: { contentPackId: 'missing-pack', rules: [{ id: 'r1' }] },
          factCards: [{ id: 'f1', text: '事实保留' }]
        }
      }
    }
  });

  const previewResponse = await request(app, { url: '/api/reference-repairs/orphans' });
  const plan = previewResponse.json().plan;
  const unconfirmedResponse = await request(app, {
    method: 'POST',
    url: '/api/reference-repairs/orphans/repair',
    headers: { 'content-type': 'application/json' },
    body: { expectedPlanId: plan.planId }
  });
  const staleResponse = await request(app, {
    method: 'POST',
    url: '/api/reference-repairs/orphans/repair',
    headers: { 'content-type': 'application/json' },
    body: { expectedPlanId: 'stale-plan', confirmRepair: true }
  });
  const repairResponse = await request(app, {
    method: 'POST',
    url: '/api/reference-repairs/orphans/repair',
    headers: { 'content-type': 'application/json' },
    body: { expectedPlanId: plan.planId, confirmRepair: true }
  });
  const repaired = (await request(app, {
    url: '/api/state?sessionId=orphan-session'
  })).json().session;
  const finalPlan = (await request(app, { url: '/api/reference-repairs/orphans' })).json().plan;

  assert.equal(previewResponse.status, 200);
  assert.equal(plan.summary.sessionUpdates, 1);
  assert.equal(plan.summary.referenceChanges, 5);
  assert.equal(unconfirmedResponse.status, 409);
  assert.equal(unconfirmedResponse.json().error, 'REFERENCE_REPAIR_CONFIRMATION_REQUIRED');
  assert.equal(staleResponse.status, 409);
  assert.equal(staleResponse.json().error, 'REFERENCE_REPAIR_PLAN_CHANGED');
  assert.equal(repairResponse.status, 200);
  assert.ok(repairResponse.json().backup.id);
  assert.deepEqual(repairResponse.json().repairedSessionIds, ['orphan-session']);
  assert.equal(repaired.storyProjectId, '');
  assert.equal(repaired.basePackId, '');
  assert.equal(repaired.config.contentPackId, '');
  assert.equal(repaired.memory.resourcePackId, '');
  assert.equal(repaired.memory.ruleSystem.contentPackId, '');
  assert.equal(repaired.config.characterCard.description, '角色内容保留');
  assert.equal(repaired.config.worldBook[0].content, '世界内容保留');
  assert.equal(repaired.config.promptModules[0].text, 'Prompt 保留');
  assert.equal(repaired.memory.factCards[0].text, '事实保留');
  assert.equal(repaired.messages[0].content, '正文保留');
  assert.equal(repaired.provenance.bindingHistory.at(-1).reason, 'historical-reference-repair');
  assert.equal(finalPlan.requiresConfirmation, false);
  assert.equal(finalPlan.summary.referenceChanges, 0);
});

test('session config migration API materializes only missing session-owned empty config', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  await request(app, {
    method: 'POST',
    url: '/api/sessions/import',
    headers: { 'content-type': 'application/json' },
    body: {
      id: 'legacy-config-session',
      session: {
        title: '旧配置存档',
        messages: [{ id: 'm1', role: 'assistant', content: '正文保留' }],
        config: {
          characterCard: { name: '阿月', description: '角色内容保留' },
          worldBook: [{ id: 'w1', content: '世界内容保留' }],
          promptModules: [{ id: 'p1', text: 'Prompt 保留' }]
        },
        memory: { factCards: [{ id: 'f1', text: '事实保留' }] }
      }
    }
  });

  const previewResponse = await request(app, { url: '/api/session-config-migrations/incomplete' });
  const plan = previewResponse.json().plan;
  const unconfirmedResponse = await request(app, {
    method: 'POST',
    url: '/api/session-config-migrations/incomplete/migrate',
    headers: { 'content-type': 'application/json' },
    body: { expectedPlanId: plan.planId }
  });
  const staleResponse = await request(app, {
    method: 'POST',
    url: '/api/session-config-migrations/incomplete/migrate',
    headers: { 'content-type': 'application/json' },
    body: { expectedPlanId: 'stale-plan', confirmMigration: true }
  });
  const migrationResponse = await request(app, {
    method: 'POST',
    url: '/api/session-config-migrations/incomplete/migrate',
    headers: { 'content-type': 'application/json' },
    body: { expectedPlanId: plan.planId, confirmMigration: true }
  });
  const migrated = (await request(app, {
    url: '/api/state?sessionId=legacy-config-session'
  })).json().session;
  const finalPlan = (await request(app, {
    url: '/api/session-config-migrations/incomplete'
  })).json().plan;

  assert.equal(previewResponse.status, 200);
  assert.equal(plan.summary.sessionUpdates, 1);
  assert.equal(plan.summary.fieldChanges, 2);
  assert.equal(plan.summary.manualReviewSessions, 0);
  assert.equal(unconfirmedResponse.status, 409);
  assert.equal(unconfirmedResponse.json().error, 'SESSION_CONFIG_MIGRATION_CONFIRMATION_REQUIRED');
  assert.equal(staleResponse.status, 409);
  assert.equal(staleResponse.json().error, 'SESSION_CONFIG_MIGRATION_PLAN_CHANGED');
  assert.equal(migrationResponse.status, 200);
  assert.ok(migrationResponse.json().backup.id);
  assert.deepEqual(migrationResponse.json().migratedSessionIds, ['legacy-config-session']);
  assert.deepEqual(migrated.config.persona, {});
  assert.deepEqual(migrated.config.lightFrontend, {});
  assert.equal(migrated.config.characterCard.description, '角色内容保留');
  assert.equal(migrated.config.worldBook[0].content, '世界内容保留');
  assert.equal(migrated.config.promptModules[0].text, 'Prompt 保留');
  assert.equal(migrated.memory.factCards[0].text, '事实保留');
  assert.equal(migrated.messages[0].content, '正文保留');
  assert.equal(migrated.provenance.configMigrationHistory.at(-1).reason, 'materialize-session-owned-config');
  assert.equal(finalPlan.summary.incompleteSessions, 0);
});

test('light frontend MVU API applies revisioned declarative patches', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const first = await request(app, {
    method: 'PATCH',
    url: '/api/sessions/main/light-frontend/mvu',
    headers: { 'content-type': 'application/json' },
    body: {
      expectedRevision: 0,
      operations: [
        { op: 'set', path: 'relationships.shen', value: 10 },
        { op: 'increment', path: 'clues', value: 1 }
      ]
    }
  });
  const conflict = await request(app, {
    method: 'PATCH',
    url: '/api/sessions/main/light-frontend/mvu',
    headers: { 'content-type': 'application/json' },
    body: {
      expectedRevision: 0,
      operations: [{ op: 'increment', path: 'clues', value: 1 }]
    }
  });

  assert.equal(first.status, 200);
  assert.deepEqual(first.json().mvu, {
    enabled: true,
    values: { chat: { relationships: { shen: 10 }, clues: 1 }, global: {} },
    revision: 1
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.json().error, 'MVU_REVISION_CONFLICT');
});

test('third-party scripts observe locally by default and strict mode keeps hash-bound execution audit', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  const initialRule = {
    id: 'community-status-script',
    scriptName: '社区状态面板',
    findRegex: '<status>([\\s\\S]*?)</status>',
    replaceString: '<script>document.body.textContent = "ready"</script>',
    placement: [1],
    markdownOnly: true
  };

  const applyResponse = await request(app, {
    method: 'POST',
    url: '/api/sessions/main/regex-runtime',
    headers: { 'content-type': 'application/json' },
    body: { rules: [initialRule], replace: true }
  });
  const appliedRule = applyResponse.json().session.config.lightFrontend.regexTransforms[0];
  const unreviewedExecution = await request(app, {
    method: 'POST',
    url: '/api/sessions/main/script-executions',
    headers: { 'content-type': 'application/json' },
    body: {
      scriptId: appliedRule.id,
      contentHash: appliedRule.contentHash,
      status: 'launched',
      messageId: 'message-before-review'
    }
  });
  const probeWithoutAcknowledgement = await request(app, {
    method: 'PUT',
    url: '/api/sessions/main/script-policy',
    headers: { 'content-type': 'application/json' },
    body: { executionMode: 'compatibility-probe' }
  });
  const probeModeResponse = await request(app, {
    method: 'PUT',
    url: '/api/sessions/main/script-policy',
    headers: { 'content-type': 'application/json' },
    body: { executionMode: 'compatibility-probe', acknowledgeDeveloperRisk: true }
  });
  const probeExecution = await request(app, {
    method: 'POST',
    url: '/api/sessions/main/script-executions',
    headers: { 'content-type': 'application/json' },
    body: {
      scriptId: appliedRule.id,
      contentHash: appliedRule.contentHash,
      status: 'loaded',
      messageId: 'message-compatibility-probe'
    }
  });
  const strictModeResponse = await request(app, {
    method: 'PUT',
    url: '/api/sessions/main/script-policy',
    headers: { 'content-type': 'application/json' },
    body: { executionMode: 'review-required' }
  });
  const strictExecution = await request(app, {
    method: 'POST',
    url: '/api/sessions/main/script-executions',
    headers: { 'content-type': 'application/json' },
    body: {
      scriptId: appliedRule.id,
      contentHash: appliedRule.contentHash,
      status: 'launched',
      messageId: 'message-strict-before-review'
    }
  });
  const reviewResponse = await request(app, {
    method: 'PUT',
    url: '/api/sessions/main/script-reviews',
    headers: { 'content-type': 'application/json' },
    body: {
      scriptId: appliedRule.id,
      decision: 'approved',
      reviewer: 'http-test'
    }
  });
  const reviewed = reviewResponse.json();
  const executionResponse = await request(app, {
    method: 'POST',
    url: '/api/sessions/main/script-executions',
    headers: { 'content-type': 'application/json' },
    body: {
      scriptId: appliedRule.id,
      contentHash: appliedRule.contentHash,
      status: 'launched',
      messageId: 'message-after-review'
    }
  });
  const auditResponse = await request(app, {
    url: '/api/sessions/main/script-executions'
  });

  assert.equal(applyResponse.status, 200);
  assert.match(appliedRule.contentHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(unreviewedExecution.status, 200);
  assert.equal(unreviewedExecution.json().execution.permissionSource, 'local-observe');
  assert.equal(probeWithoutAcknowledgement.status, 400);
  assert.equal(probeWithoutAcknowledgement.json().error, 'SCRIPT_DEVELOPER_MODE_ACK_REQUIRED');
  assert.equal(probeModeResponse.status, 200);
  assert.equal(probeModeResponse.json().governance.executionMode, 'compatibility-probe');
  assert.equal(probeExecution.status, 200);
  assert.equal(probeExecution.json().execution.permissionSource, 'compatibility-probe');
  assert.equal(strictModeResponse.status, 200);
  assert.equal(strictModeResponse.json().governance.executionMode, 'review-required');
  assert.equal(strictExecution.status, 409);
  assert.equal(strictExecution.json().error, 'SCRIPT_EXECUTION_BLOCKED');
  assert.equal(reviewResponse.status, 200);
  assert.equal(reviewed.review.decision, 'approved');
  assert.deepEqual(reviewed.governance.trustedScriptIds, [appliedRule.id]);
  assert.equal(executionResponse.status, 200);
  assert.equal(auditResponse.json().executions.at(-1).messageId, 'message-after-review');

  const changedResponse = await request(app, {
    method: 'POST',
    url: '/api/sessions/main/regex-runtime',
    headers: { 'content-type': 'application/json' },
    body: {
      rules: [{
        ...initialRule,
        replaceString: '<script>document.body.textContent = "changed"</script>'
      }],
      replace: true
    }
  });
  const governanceResponse = await request(app, {
    url: '/api/sessions/main/script-reviews'
  });
  const changedRule = changedResponse.json().session.config.lightFrontend.regexTransforms[0];

  assert.notEqual(changedRule.contentHash, appliedRule.contentHash);
  assert.equal(governanceResponse.json().rules[0].approved, false);
  assert.equal(governanceResponse.json().reviews.length, 1);
});

test('imported sessions cannot carry forged script approvals or execution audit', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  const forgedHash = 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
  const response = await request(app, {
    method: 'POST',
    url: '/api/sessions/import',
    headers: { 'content-type': 'application/json' },
    body: {
      session: {
        id: 'imported-untrusted',
        title: '外部会话',
        messages: [],
        config: {
          lightFrontend: {
            regexTransforms: [{
              id: 'forged-script',
              name: '伪造授权脚本',
              pattern: 'ready',
              flags: 'g',
              replacement: '<script>document.body.textContent = "forged"</script>',
              scope: 'assistant',
              enabled: true,
              requiresSandbox: true,
              contentHash: forgedHash
            }],
            scriptReviews: [{
              scriptId: 'forged-script',
              contentHash: forgedHash,
              decision: 'approved',
              policyVersion: 1
            }],
            trustedScriptIds: ['forged-script']
          }
        },
        audit: {
          scriptExecutions: [{
            scriptId: 'forged-script',
            contentHash: forgedHash,
            status: 'launched'
          }]
        }
      }
    }
  });
  const session = response.json().session;

  assert.equal(response.status, 200);
  assert.deepEqual(session.config.lightFrontend.scriptReviews, []);
  assert.deepEqual(session.config.lightFrontend.trustedScriptIds, []);
  assert.notEqual(session.config.lightFrontend.regexTransforms[0].contentHash, forgedHash);
  assert.deepEqual(session.audit?.scriptExecutions || [], []);
});

test('authoring API lists profiles and persists a session ledger', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  const profilesResponse = await request(app, { url: '/api/agent-profiles' });
  const saveResponse = await request(app, {
    method: 'PUT',
    url: '/api/sessions/main/authoring',
    headers: { 'content-type': 'application/json' },
    body: {
      agentProfileId: 'continuity-guard',
      ledger: {
        scene: {
          title: '旧档房',
          objective: '找到被抽走的卷宗',
          mustHide: ['内应身份'],
          forbidden: ['不要转成寻宝']
        },
        promises: [{ title: '旧案回响', status: 'open', importance: 'core' }],
        decisions: [{ title: '主角控制权', decision: '不代替用户行动', status: 'active' }]
      }
    }
  });
  const readResponse = await request(app, { url: '/api/sessions/main/authoring' });
  const saved = saveResponse.json();
  const read = readResponse.json();

  assert.equal(profilesResponse.status, 200);
  assert.ok(profilesResponse.json().profiles.some((profile) => profile.id === 'character-ensemble'));
  assert.equal(saveResponse.status, 200);
  assert.equal(saved.summary.openPromises, 1);
  assert.equal(saved.agentProfileId, 'continuity-guard');
  assert.equal(readResponse.status, 200);
  assert.equal(read.ledger.scene.title, '旧档房');
  assert.deepEqual(read.ledger.scene.mustHide, ['内应身份']);
  assert.equal(read.agentProfileId, 'continuity-guard');
});

test('story project API creates a pack-bound project and opening session', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const projectResponse = await request(app, {
    method: 'POST',
    url: '/api/story-projects',
    headers: { 'content-type': 'application/json' },
    body: { basePackId: 'xianxia', title: '太虚问道' }
  });
  const project = projectResponse.json().project;
  const sessionResponse = await request(app, {
    method: 'POST',
    url: `/api/story-projects/${encodeURIComponent(project.id)}/sessions`,
    headers: { 'content-type': 'application/json' },
    body: {}
  });
  const sessionPayload = sessionResponse.json();
  const state = (await request(app, {
    url: `/api/state?sessionId=${encodeURIComponent(sessionPayload.session.id)}`
  })).json();
  const projects = (await request(app, { url: '/api/story-projects' })).json().projects;
  const sessions = (await request(app, { url: '/api/sessions' })).json();

  assert.equal(projectResponse.status, 200);
  assert.equal(sessionResponse.status, 200);
  assert.equal(project.basePackId, 'xianxia');
  assert.equal(sessionPayload.session.storyProjectId, project.id);
  assert.equal(sessionPayload.session.basePackId, 'xianxia');
  assert.equal(sessionPayload.session.settings.visualContentPack, 'xianxia');
  assert.equal(state.config.characterCard.extensions.contentPack, 'xianxia');
  assert.equal(state.session.memory.ruleSystem.contentPackId, 'xianxia');
  assert.equal(projects[0].activeSessionId, sessionPayload.session.id);
  assert.equal(projects[0].sessionCount, 1);
  assert.ok(sessions.sessions.includes(sessionPayload.session.id));
  assert.equal(sessions.sessionSummaries[0].storyProjectId, project.id);
});

test('story project API rejects an unknown base content pack', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'POST',
    url: '/api/story-projects',
    headers: { 'content-type': 'application/json' },
    body: { basePackId: 'missing-pack' }
  });

  assert.equal(response.status, 404);
  assert.equal(response.json().error, 'CONTENT_PACK_NOT_FOUND');
});

test('story project API previews deletion, backs up, and detaches its preserved session', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  const created = (await request(app, {
    method: 'POST',
    url: '/api/story-projects',
    headers: { 'content-type': 'application/json' },
    body: { basePackId: 'xianxia', title: '旧题名' }
  })).json().project;
  const session = (await request(app, {
    method: 'POST',
    url: `/api/story-projects/${encodeURIComponent(created.id)}/sessions`,
    headers: { 'content-type': 'application/json' },
    body: {}
  })).json().session;
  const updatedResponse = await request(app, {
    method: 'PUT',
    url: `/api/story-projects/${encodeURIComponent(created.id)}`,
    headers: { 'content-type': 'application/json' },
    body: { title: '太虚问道 · 新卷', description: '书架说明' }
  });
  const impactResponse = await request(app, {
    url: `/api/story-projects/${encodeURIComponent(created.id)}/deletion-impact`
  });
  const unconfirmedResponse = await request(app, {
    method: 'DELETE',
    url: `/api/story-projects/${encodeURIComponent(created.id)}`,
    headers: { 'content-type': 'application/json' },
    body: {}
  });
  const deleteResponse = await request(app, {
    method: 'DELETE',
    url: `/api/story-projects/${encodeURIComponent(created.id)}`,
    headers: { 'content-type': 'application/json' },
    body: { confirmDetach: true }
  });
  const readAfterDelete = await request(app, {
    url: `/api/story-projects/${encodeURIComponent(created.id)}`
  });
  const sessions = (await request(app, { url: '/api/sessions' })).json().sessions;
  const detachedState = (await request(app, {
    url: `/api/state?sessionId=${encodeURIComponent(session.id)}`
  })).json().session;

  assert.equal(updatedResponse.status, 200);
  assert.equal(updatedResponse.json().summary.title, '太虚问道 · 新卷');
  assert.equal(impactResponse.status, 200);
  assert.deepEqual(impactResponse.json().impact.sessions.map((item) => item.id), [session.id]);
  assert.equal(unconfirmedResponse.status, 409);
  assert.equal(unconfirmedResponse.json().error, 'CONTENT_DELETE_CONFIRMATION_REQUIRED');
  assert.equal(deleteResponse.status, 200);
  assert.deepEqual(deleteResponse.json().preservedSessionIds, [session.id]);
  assert.ok(deleteResponse.json().backup.id);
  assert.equal(readAfterDelete.status, 404);
  assert.ok(sessions.includes(session.id));
  assert.equal(detachedState.storyProjectId, '');
  assert.equal(detachedState.basePackId, 'xianxia');
  assert.equal(detachedState.provenance.bindingHistory.at(-1).reason, 'story-project-deleted');
});

test('story project API can delete its linked running sessions after backup', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  const project = (await request(app, {
    method: 'POST',
    url: '/api/story-projects',
    headers: { 'content-type': 'application/json' },
    body: { basePackId: 'xianxia', title: '待删除故事' }
  })).json().project;
  const session = (await request(app, {
    method: 'POST',
    url: `/api/story-projects/${encodeURIComponent(project.id)}/sessions`,
    headers: { 'content-type': 'application/json' },
    body: {}
  })).json().session;

  const response = await request(app, {
    method: 'DELETE',
    url: `/api/story-projects/${encodeURIComponent(project.id)}`,
    headers: { 'content-type': 'application/json' },
    body: { confirmDelete: true, deleteSessions: true }
  });
  const sessions = (await request(app, { url: '/api/sessions' })).json().sessions;

  assert.equal(response.status, 200);
  assert.ok(response.json().backup.id);
  assert.deepEqual(response.json().deletedSessionIds, [session.id]);
  assert.deepEqual(response.json().preservedSessionIds, []);
  assert.equal(sessions.includes(session.id), false);
});

test('PUT /api/character-card saves character card', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'PUT',
    url: '/api/character-card',
    headers: { 'content-type': 'application/json' },
    body: {
      characterCard: {
        name: '沈观澜',
        role: '游侠',
        description: '初入江湖的刀客。',
        personality: '沉稳，重诺。',
        scenario: '正在调查镇武司旧案。',
        firstMessage: '夜雨打在刀鞘上。',
        exampleDialog: ['用户：你是谁？', '沈观澜：过路人。'],
        tags: ['武侠'],
        enabled: true
      }
    }
  });
  const payload = response.json();
  const state = (await request(app, { url: '/api/state' })).json();

  assert.equal(response.status, 200);
  assert.equal(payload.characterCard.name, '沈观澜');
  assert.equal(state.config.characterCard.name, '沈观澜');
});

test('PUT /api/character-card rejects non-object payload', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'PUT',
    url: '/api/character-card',
    headers: { 'content-type': 'application/json' },
    body: { characterCard: [] }
  });
  const payload = response.json();

  assert.equal(response.status, 400);
  assert.deepEqual(payload, { error: 'INVALID_CHARACTER_CARD' });
});

test('PUT /api/character-presets/apply replaces the complete session bundle atomically', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  const headers = { 'content-type': 'application/json' };
  const bundle = {
    characterCard: { name: '望舒', description: '收藏角色' },
    worldBook: [{ id: 'lore-1', title: '望舒仙市', content: '仙市规则' }],
    promptModules: [{ id: 'prompt-1', title: '因果约束', content: '保持因果一致。', enabled: true }]
  };

  const applied = await request(app, {
    method: 'PUT',
    url: '/api/character-presets/apply',
    headers,
    body: { sessionId: 'main', ...bundle }
  });
  const stateAfterApply = (await request(app, { url: '/api/state?sessionId=main' })).json();

  assert.equal(applied.status, 200);
  assert.deepEqual(applied.json(), bundle);
  assert.deepEqual(stateAfterApply.config.characterCard, bundle.characterCard);
  assert.deepEqual(stateAfterApply.config.worldBook, bundle.worldBook);
  assert.deepEqual(stateAfterApply.config.promptModules, bundle.promptModules);

  const rejected = await request(app, {
    method: 'PUT',
    url: '/api/character-presets/apply',
    headers,
    body: {
      sessionId: 'main',
      characterCard: { name: '不应写入' },
      worldBook: { invalid: true },
      promptModules: []
    }
  });
  const stateAfterReject = (await request(app, { url: '/api/state?sessionId=main' })).json();

  assert.equal(rejected.status, 400);
  assert.deepEqual(rejected.json(), { error: 'INVALID_WORLD_BOOK' });
  assert.deepEqual(stateAfterReject.config.characterCard, bundle.characterCard);
  assert.deepEqual(stateAfterReject.config.worldBook, bundle.worldBook);
  assert.deepEqual(stateAfterReject.config.promptModules, bundle.promptModules);
});

test('POST /api/character-card/import saves Character Card V2 and imports character book', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'POST',
    url: '/api/character-card/import',
    headers: { 'content-type': 'application/json' },
    body: {
      fileName: 'shen.json',
      mimeType: 'application/json',
      data: JSON.stringify(createV2CardPayload())
    }
  });
  const payload = response.json();
  const state = (await request(app, { url: '/api/state' })).json();

  assert.equal(response.status, 200);
  assert.equal(payload.characterCard.name, '沈观澜');
  assert.equal(payload.worldBook.length, 1);
  assert.ok(payload.worldBook.find((entry) => entry.title === '镇武司暗线'));
});

test('preset creation routes use UUID-backed ids', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const characterResponse = await request(app, {
    method: 'POST',
    url: '/api/character-presets',
    headers: { 'content-type': 'application/json' },
    body: { name: '夜雨刀客' }
  });
  const promptResponse = await request(app, {
    method: 'POST',
    url: '/api/prompt-presets',
    headers: { 'content-type': 'application/json' },
    body: { name: '叙事预设', promptModules: [] }
  });

  assert.equal(characterResponse.status, 200);
  assert.equal(promptResponse.status, 200);
  assert.match(characterResponse.json().preset.id, /^preset-[0-9a-f-]{36}$/);
  assert.match(promptResponse.json().preset.id, /^prompt-preset-[0-9a-f-]{36}$/);
});

test('POST /api/prompt-presets rejects non-array prompt modules', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'POST',
    url: '/api/prompt-presets',
    headers: { 'content-type': 'application/json' },
    body: {
      name: '无效预设',
      promptModules: { id: 'not-an-array' }
    }
  });

  assert.equal(response.status, 400);
  assert.deepEqual(response.json(), { error: 'INVALID_PROMPT_MODULES' });
});

test('POST /api/prompt-presets/apply updates only the selected session config', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  const presetResponse = await request(app, {
    method: 'POST',
    url: '/api/prompt-presets',
    headers: { 'content-type': 'application/json' },
    body: {
      name: '会话专属预设',
      promptModules: [{
        id: 'session-preset-only',
        title: '会话专属规则',
        content: '只应用到目标会话。',
        enabled: true
      }]
    }
  });
  const presetId = presetResponse.json().preset.id;
  const createResponse = await request(app, {
    method: 'POST',
    url: '/api/sessions',
    headers: { 'content-type': 'application/json' },
    body: {
      id: 'prompt_preset_target',
      title: 'Prompt 预设目标',
      packId: 'lingyi'
    }
  });
  const applyResponse = await request(app, {
    method: 'POST',
    url: '/api/prompt-presets/apply',
    headers: { 'content-type': 'application/json' },
    body: {
      id: presetId,
      sessionId: 'prompt_preset_target'
    }
  });
  const targetState = (await request(app, {
    url: '/api/state?sessionId=prompt_preset_target'
  })).json();
  const mainState = (await request(app, { url: '/api/state?sessionId=main' })).json();

  assert.equal(presetResponse.status, 200);
  assert.equal(createResponse.status, 200);
  assert.equal(applyResponse.status, 200);
  assert.equal(applyResponse.json().promptModules[0].id, 'session-preset-only');
  assert.equal(targetState.config.promptModules[0].id, 'session-preset-only');
  assert.equal(mainState.config.promptModules.some((module) => module.id === 'session-preset-only'), false);
});

test('prompt template routes assess, preview and idempotently apply to the selected session', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  const createResponse = await request(app, {
    method: 'POST',
    url: '/api/sessions',
    headers: { 'content-type': 'application/json' },
    body: { id: 'template_target', title: '模板目标', packId: 'lingyi' }
  });
  const catalogResponse = await request(app, {
    url: '/api/prompt-templates?sessionId=template_target'
  });
  const previewResponse = await request(app, {
    method: 'POST',
    url: '/api/prompt-templates/preview',
    headers: { 'content-type': 'application/json' },
    body: {
      sessionId: 'template_target',
      templateId: 'role-fidelity',
      parameters: { strictness: 'strict' },
      mode: 'append'
    }
  });
  const firstApply = await request(app, {
    method: 'POST',
    url: '/api/prompt-templates/apply',
    headers: { 'content-type': 'application/json' },
    body: {
      sessionId: 'template_target',
      templateId: 'role-fidelity',
      parameters: { strictness: 'strict' },
      mode: 'append'
    }
  });
  const secondApply = await request(app, {
    method: 'POST',
    url: '/api/prompt-templates/apply',
    headers: { 'content-type': 'application/json' },
    body: {
      sessionId: 'template_target',
      templateId: 'role-fidelity',
      parameters: { strictness: 'balanced' },
      mode: 'append'
    }
  });
  const state = (await request(app, { url: '/api/state?sessionId=template_target' })).json();

  assert.equal(createResponse.status, 200);
  assert.equal(catalogResponse.status, 200);
  assert.equal(catalogResponse.json().spec, 'narrative-engine.prompt-template/v1');
  assert.ok(catalogResponse.json().templates.length >= 6);
  assert.equal(previewResponse.status, 200);
  assert.equal(previewResponse.json().changes.added, 1);
  assert.equal(firstApply.status, 200);
  assert.equal(secondApply.status, 200);
  assert.equal(secondApply.json().preview.changes.updated, 1);
  assert.equal(state.config.promptModules.filter((module) => module.id === 'prompt-template:role-fidelity:anchor').length, 1);
});

test('prompt template preview rejects unknown templates without changing state', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  const before = (await request(app, { url: '/api/state' })).json().config.promptModules;
  const response = await request(app, {
    method: 'POST',
    url: '/api/prompt-templates/preview',
    headers: { 'content-type': 'application/json' },
    body: { sessionId: 'main', templateId: 'does-not-exist' }
  });
  const after = (await request(app, { url: '/api/state' })).json().config.promptModules;

  assert.equal(response.status, 404);
  assert.deepEqual(response.json(), { error: 'PROMPT_TEMPLATE_NOT_FOUND' });
  assert.deepEqual(after, before);
});

test('POST /api/import/preview parses Character Card V2 without saving state', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'POST',
    url: '/api/import/preview',
    headers: { 'content-type': 'application/json' },
    body: {
      fileName: 'shen.json',
      mimeType: 'application/json',
      data: JSON.stringify(createV2CardPayload())
    }
  });
  const payload = response.json();
  const state = (await request(app, { url: '/api/state' })).json();

  assert.equal(response.status, 200);
  assert.equal(payload.preview.kind, 'character-card');
  assert.equal(payload.preview.summary.characterName, '沈观澜');
  assert.equal(payload.preview.summary.worldBookCount, 1);
  assert.equal(payload.preview.inspection.adapter.id, 'character-card-v2');
  assert.equal(payload.preview.inspection.resources.length, 2);
  assert.equal(payload.preview.inspection.dimensions.length, 5);
  assert.equal(payload.preview.inspection.verdict, 'recommended');
  assert.ok(payload.preview.inspection.estimatedTokens > 0);
  assert.equal(state.config.characterCard.name, '未命名主角');
});

test('POST /api/import/commit can store a resource without changing active creative config', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'POST',
    url: '/api/import/commit',
    headers: { 'content-type': 'application/json' },
    body: {
      payload: {
        fileName: 'shen.json',
        mimeType: 'application/json',
        data: JSON.stringify(createV2CardPayload())
      },
      source: { site: 'local-file', fileName: 'shen.json' },
      applyToActiveConfig: false
    }
  });
  const payload = response.json();
  const state = (await request(app, { url: '/api/state' })).json();
  const library = (await request(app, { url: '/api/resource-library/resources' })).json();

  assert.equal(response.status, 200);
  assert.equal(payload.applyMode, 'library-only');
  assert.equal(payload.libraryResources.length, 2);
  assert.equal(library.resources.length, 2);
  assert.equal(state.config.characterCard.name, '未命名主角');
});

test('character-card import preserves other session-scoped configuration', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  const regexResponse = await request(app, {
    method: 'POST',
    url: '/api/sessions/main/regex-runtime',
    headers: { 'content-type': 'application/json' },
    body: {
      rules: [{
        id: 'preserved-script',
        scriptName: '保留的状态脚本',
        findRegex: '<status>([\\s\\S]*?)</status>',
        replaceString: '<script>document.body.textContent = "status"</script>',
        markdownOnly: true
      }],
      replace: true
    }
  });
  const importResponse = await request(app, {
    method: 'POST',
    url: '/api/import/commit',
    headers: { 'content-type': 'application/json' },
    body: {
      payload: {
        fileName: 'shen.json',
        mimeType: 'application/json',
        data: JSON.stringify(createV2CardPayload())
      },
      source: { site: 'local-file', fileName: 'shen.json' },
      applyToActiveConfig: true,
      sessionId: 'main'
    }
  });
  const state = (await request(app, { url: '/api/state?sessionId=main' })).json();

  assert.equal(regexResponse.status, 200);
  assert.equal(importResponse.status, 200);
  assert.equal(state.config.characterCard.name, '沈观澜');
  assert.equal(state.session.config.characterCard.name, '沈观澜');
  assert.equal(state.session.config.lightFrontend.regexTransforms[0].id, 'preserved-script');
  assert.equal(state.config.lightFrontend.regexTransforms[0].id, 'preserved-script');
  assert.equal(typeof state.session.config.persona, 'object');
});

test('binary import upload previews and commits a PNG card without returning its embedded payload', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  const png = exportCharacterCardPng({
    name: '九渊行者',
    role: '边境散修',
    description: '在十二国之间求生的修行者。',
    scenario: '渊息升腾，边境封锁。',
    firstMessage: '城门税吏敲了敲桌面。',
    tags: ['玄幻', '动态世界']
  }, [{
    id: 'border-market',
    title: '边境墟市',
    keywords: ['墟市'],
    content: '墟市物价受边境封锁与当前渊候影响。',
    enabled: true
  }]);

  const uploadResponse = await request(app, {
    method: 'POST',
    url: '/api/import/upload?fileName=jiuyuan.png&mimeType=image%2Fpng',
    headers: { 'content-type': 'image/png' },
    body: png
  });
  const uploaded = uploadResponse.json();

  assert.equal(uploadResponse.status, 200);
  assert.equal(uploaded.upload.size, png.length);
  assert.equal(uploaded.preview.kind, 'character-card');
  assert.equal(uploaded.preview.summary.characterName, '九渊行者');
  assert.equal(uploaded.preview.importData, undefined);

  const commitResponse = await request(app, {
    method: 'POST',
    url: '/api/import/commit',
    headers: { 'content-type': 'application/json' },
    body: {
      payload: { uploadId: uploaded.upload.uploadId },
      source: { site: 'local-file', fileName: 'jiuyuan.png' },
      applyToActiveConfig: false
    }
  });
  const committed = commitResponse.json();

  assert.equal(commitResponse.status, 200);
  assert.equal(committed.libraryResources.length, 2);
  assert.ok(committed.libraryResources.find((item) => item.kind === 'character'));
  assert.ok(committed.libraryResources.find((item) => item.kind === 'worldbook'));

  const expiredResponse = await request(app, {
    method: 'POST',
    url: '/api/import/commit',
    headers: { 'content-type': 'application/json' },
    body: { payload: { uploadId: uploaded.upload.uploadId } }
  });
  assert.equal(expiredResponse.status, 410);
  assert.equal(expiredResponse.json().error, 'IMPORT_UPLOAD_EXPIRED');
});

test('POST /api/import/commit stores SillyTavern prompt presets without executing helper scripts', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  const preset = {
    name: '社区叙事预设',
    settings: { max_context: 32768, max_completion_tokens: 4096, temperature: 0.8 },
    prompts: [
      {
        id: 'main',
        name: '主提示',
        enabled: true,
        role: 'system',
        content: '保持人物边界与长篇连续性。',
        position: { type: 'relative' }
      },
      {
        id: 'post-history',
        name: '历史后约束',
        enabled: true,
        role: 'user',
        content: '延续当前冲突，不解释系统规则。',
        position: { type: 'in_chat', depth: 1, order: 3 }
      }
    ],
    extensions: {
      tavern_helper: { scripts: [{ id: 'runtime-hook' }] }
    }
  };

  const previewResponse = await request(app, {
    method: 'POST',
    url: '/api/import/preview',
    headers: { 'content-type': 'application/json' },
    body: {
      payload: {
        fileName: 'community-preset.json',
        mimeType: 'application/json',
        data: JSON.stringify(preset)
      },
      source: { site: '类脑社区', fileName: 'community-preset.json' }
    }
  });
  const commitResponse = await request(app, {
    method: 'POST',
    url: '/api/import/commit',
    headers: { 'content-type': 'application/json' },
    body: {
      payload: {
        fileName: 'community-preset.json',
        mimeType: 'application/json',
        data: JSON.stringify(preset)
      },
      source: { site: '类脑社区', fileName: 'community-preset.json' },
      applyToActiveConfig: true
    }
  });
  const preview = previewResponse.json().preview;
  const committed = commitResponse.json();
  const state = (await request(app, { url: '/api/state' })).json();

  assert.equal(previewResponse.status, 200);
  assert.equal(preview.kind, 'prompt-preset');
  assert.equal(preview.inspection.adapter.id, 'sillytavern-prompt-preset');
  assert.equal(preview.inspection.communityCompatibility.readyToPlay, false);
  assert.equal(commitResponse.status, 200);
  assert.equal(committed.applyMode, 'prompt-library');
  assert.equal(committed.promptModuleCount, 2);
  assert.equal(committed.generationSettings.maxContext, 32768);
  assert.equal(committed.libraryResources.length, 1);
  assert.equal(committed.libraryResources[0].kind, 'prompt-bundle');
  assert.equal(committed.libraryResources[0].payload.promptModules[1].position, 'in_chat');
  assert.equal(
    committed.libraryResources[0].payload.dependencySignals.tavern_helper.execution,
    'disabled'
  );
  assert.equal(
    committed.libraryResources[0].payload.promptModules[0].extensions.sillyTavernPreset.dependencySignals,
    undefined
  );
  assert.equal(state.config.promptModules.some((item) => item.title === '主提示'), false);
});

test('PNG character import persists its portrait through the session, library and custom story pack', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  const png = exportCharacterCardPng({
    name: '谢停云',
    role: '问剑人',
    description: '负剑入山的年轻修士。',
    personality: '克制，敏锐。',
    scenario: '正在追查失踪的同门。',
    firstMessage: '山门外的雪没有停。',
    tags: ['仙侠']
  });
  const expectedPortrait = extractCharacterCardImage({
    fileName: 'xie-tingyun.png',
    mimeType: 'image/png',
    data: png.toString('base64'),
    encoding: 'base64'
  }).bytes;

  const committed = await request(app, {
    method: 'POST',
    url: '/api/import/commit',
    headers: { 'content-type': 'application/json' },
    body: {
      payload: {
        fileName: 'xie-tingyun.png',
        mimeType: 'image/png',
        data: png.toString('base64'),
        encoding: 'base64'
      },
      sessionId: 'main'
    }
  });
  const committedPayload = committed.json();
  const portrait = committedPayload.characterCard.portrait;
  const state = (await request(app, { url: '/api/state?sessionId=main' })).json();
  const portraitResponse = await request(app, { url: portrait.url });
  const resources = (await request(app, { url: '/api/resource-library/resources' })).json().resources;
  const characterResource = resources.find((item) => item.kind === 'character');
  const packResponse = await request(app, {
    method: 'POST',
    url: '/api/resource-library/packs',
    headers: { 'content-type': 'application/json' },
    body: {
      title: '雪夜问剑',
      basePackId: 'xianxia',
      characterResourceId: characterResource.id,
      worldBookResourceIds: [],
      useCharacterPortraitAsBackground: true
    }
  });
  const pack = packResponse.json().pack;
  const projectResponse = await request(app, {
    method: 'POST',
    url: '/api/story-projects',
    headers: { 'content-type': 'application/json' },
    body: { basePackId: pack.id, title: '雪夜问剑' }
  });
  const project = projectResponse.json().project;
  const sessionResponse = await request(app, {
    method: 'POST',
    url: `/api/story-projects/${encodeURIComponent(project.id)}/sessions`,
    headers: { 'content-type': 'application/json' },
    body: {}
  });

  assert.equal(committed.status, 200);
  assert.match(portrait.assetId, /^[a-f0-9]{64}$/);
  assert.equal(portrait.width, 256);
  assert.equal(portrait.height, 256);
  assert.equal(state.config.characterCard.portrait.url, portrait.url);
  assert.equal(characterResource.payload.portrait.url, portrait.url);
  assert.equal(portraitResponse.status, 200);
  assert.equal(portraitResponse.headers['content-type'], 'image/png');
  assert.deepEqual(portraitResponse.buffer, expectedPortrait);
  assert.ok(portraitResponse.buffer.length < png.length);
  assert.equal(packResponse.status, 200);
  assert.equal(pack.characterCard.portrait.url, portrait.url);
  assert.equal(pack.stageBackground.url, portrait.url);
  assert.equal(pack.stageBackground.fit, 'portrait');
  assert.equal(sessionResponse.status, 200);
  assert.equal(sessionResponse.json().session.settings.backgroundImage, portrait.url);
  assert.equal(sessionResponse.json().session.settings.backgroundFit, 'portrait');
});

test('GET /api/import-sources lists online material sources', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, { url: '/api/import-sources' });
  const payload = response.json();

  assert.equal(response.status, 200);
  assert.ok(payload.sources.find((source) => source.id === 'chub'));
  assert.ok(payload.sources.find((source) => source.id === 'aicharactercards'));
});

test('GET /api/import-sources/search searches source cards with injected fetch', async () => {
  const app = createApp({
    rootDir: await createTestRoot(),
    fetchImpl: async (url) => {
      const requestUrl = new URL(String(url));
      assert.equal(requestUrl.hostname, 'gateway.chub.ai');
      assert.equal(requestUrl.searchParams.get('search'), 'wuxia');
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({
          results: [{
            name: '沈观澜',
            fullPath: 'liufeng/shen-guanlan',
            nTokens: 2048,
            topics: ['wuxia'],
            max_res_url: 'https://avatars.charhub.io/characters/liufeng/shen-guanlan/chara_card_v2.png'
          }]
        })
      };
    }
  });

  const response = await request(app, { url: '/api/import-sources/search?source=chub&kind=characters&q=wuxia' });
  const payload = response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.source.id, 'chub');
  assert.equal(payload.items[0].title, '沈观澜');
  assert.equal(payload.items[0].downloadable, true);
});

test('POST /api/import-sources/download previews downloaded PNG cards', async () => {
  const png = createPngWithTextChunk(
    'Chara',
    Buffer.from(JSON.stringify(createV2CardPayload()), 'utf8').toString('base64')
  );
  const app = createApp({
    rootDir: await createTestRoot(),
    fetchImpl: async (url) => {
      assert.equal(String(url), 'https://avatars.charhub.io/characters/liufeng/shen-guanlan/chara_card_v2.png');
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'image/png' },
        arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength)
      };
    }
  });

  const response = await request(app, {
    method: 'POST',
    url: '/api/import-sources/download',
    headers: { 'content-type': 'application/json' },
    body: {
      source: 'chub',
      downloadUrl: 'https://avatars.charhub.io/characters/liufeng/shen-guanlan/chara_card_v2.png',
      fileName: 'shen-guanlan.png'
    }
  });
  const payload = response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.preview.kind, 'character-card');
  assert.equal(payload.preview.summary.characterName, '沈观澜');
  assert.equal(payload.payload.mimeType, 'image/png');
});

test('POST /api/import/commit saves standalone world book import', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'POST',
    url: '/api/import/commit',
    headers: { 'content-type': 'application/json' },
    body: {
      payload: {
        fileName: 'world.json',
        mimeType: 'application/json',
        data: JSON.stringify({
          entries: {
            '1': {
              comment: '听雨楼',
              key: ['听雨楼'],
              content: '听雨楼贩卖秘密。',
              enabled: true
            }
          }
        })
      }
    }
  });
  const payload = response.json();
  const imported = payload.worldBook.entries.filter((entry) => entry.source === 'sillytavern-worldbook');

  assert.equal(response.status, 200);
  assert.equal(payload.preview.kind, 'world-book');
  assert.equal(imported.length, 1);
  assert.equal(imported[0].title, '听雨楼');
  assert.equal(payload.libraryResources.length, 1);
  const library = (await request(app, { url: '/api/resource-library/resources' })).json();
  assert.equal(library.resources.length, 1);
  assert.equal(library.resources[0].title, '导入的世界书');
});

test('v0.2 resource library deduplicates imports and composes an applicable custom pack', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  const importBody = {
    payload: {
      fileName: 'shen.json',
      mimeType: 'application/json',
      data: JSON.stringify(createV2CardPayload())
    },
    source: {
      adapterId: 'liunao-community-generic',
      site: '类脑社区',
      author: '社区作者',
      fileName: 'shen.json'
    }
  };
  const firstImport = await request(app, {
    method: 'POST',
    url: '/api/import/commit',
    headers: { 'content-type': 'application/json' },
    body: importBody
  });
  const secondImport = await request(app, {
    method: 'POST',
    url: '/api/import/commit',
    headers: { 'content-type': 'application/json' },
    body: importBody
  });
  const firstPayload = firstImport.json();
  const resources = (await request(app, { url: '/api/resource-library/resources' })).json().resources;
  const character = resources.find((item) => item.kind === 'character');
  const worldBook = resources.find((item) => item.kind === 'worldbook');

  assert.equal(firstImport.status, 200);
  assert.equal(firstPayload.preview.inspection.adapter.id, 'liunao-community-generic');
  assert.equal(secondImport.json().libraryResources.every((item) => item.importStatus === 'duplicate'), true);
  assert.equal(resources.length, 2);
  assert.equal(character.source.site, '类脑社区');

  const createPackResponse = await request(app, {
    method: 'POST',
    url: '/api/resource-library/packs',
    headers: { 'content-type': 'application/json' },
    body: {
      title: '听雨仙途',
      basePackId: 'xianxia',
      characterResourceId: character.id,
      worldBookResourceIds: [worldBook.id]
    }
  });
  const createdPack = createPackResponse.json().pack;
  assert.equal(createPackResponse.status, 200);
  assert.equal(createdPack.characterCard.name, '沈观澜');
  assert.equal(createdPack.visualPackId, 'xianxia');

  const listedPacks = (await request(app, { url: '/api/content-packs' })).json().contentPacks;
  assert.ok(listedPacks.find((pack) => pack.id === createdPack.id && pack.custom === true));

  const applyResponse = await request(app, {
    method: 'POST',
    url: `/api/content-packs/${createdPack.id}/apply`,
    headers: { 'content-type': 'application/json' },
    body: { sessionId: 'main' }
  });
  const applied = applyResponse.json();
  assert.equal(applyResponse.status, 200);
  assert.equal(applied.appliedPack.visualPackId, 'xianxia');
  assert.equal(applied.characterCard.name, '沈观澜');
  assert.equal(applied.session.memory.resourcePackId, createdPack.id);
  assert.equal(applied.session.memory.ruleSystem.contentPackId, createdPack.id);
  assert.ok(applied.worldBook.find((entry) => entry.title === '镇武司暗线'));
  assert.equal((await request(app, { url: '/api/state' })).json().config.characterCard.name, '沈观澜');
});

test('PATCH /api/resource-library/resources/:id updates asset center metadata', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  await request(app, {
    method: 'POST',
    url: '/api/import/commit',
    headers: { 'content-type': 'application/json' },
    body: {
      payload: {
        fileName: 'shen.json',
        mimeType: 'application/json',
        data: JSON.stringify(createV2CardPayload())
      },
      source: { site: '类脑社区', author: '社区作者' },
      applyToActiveConfig: false
    }
  });
  const resources = (await request(app, { url: '/api/resource-library/resources' })).json().resources;
  const character = resources.find((item) => item.kind === 'character');

  const response = await request(app, {
    method: 'PATCH',
    url: `/api/resource-library/resources/${encodeURIComponent(character.id)}`,
    headers: { 'content-type': 'application/json' },
    body: {
      title: '听雨刀客',
      tags: ['武侠', '旧案'],
      collections: ['英雄群像'],
      favorite: true
    }
  });
  const updated = response.json().resource;
  const search = (await request(app, { url: '/api/resource-library/resources?query=英雄群像' })).json().resources;

  assert.equal(response.status, 200);
  assert.equal(updated.title, '听雨刀客');
  assert.equal(updated.favorite, true);
  assert.deepEqual(updated.collections, ['英雄群像']);
  assert.equal(search[0].id, character.id);
});

test('PATCH /api/resource-library/resources/:id/content manages world books and prompt presets', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  await request(app, {
    method: 'POST',
    url: '/api/import/commit',
    headers: { 'content-type': 'application/json' },
    body: {
      payload: {
        fileName: 'shen.json',
        mimeType: 'application/json',
        data: JSON.stringify(createV2CardPayload())
      },
      source: { site: 'local-file' },
      applyToActiveConfig: false
    }
  });
  const resources = (await request(app, { url: '/api/resource-library/resources' })).json().resources;
  const worldBook = resources.find((item) => item.kind === 'worldbook');
  const character = resources.find((item) => item.kind === 'character');
  const worldBookResponse = await request(app, {
    method: 'PATCH',
    url: `/api/resource-library/resources/${encodeURIComponent(worldBook.id)}/content`,
    headers: { 'content-type': 'application/json' },
    body: {
      payload: {
        entries: [{
          id: 'lore-revised',
          title: '修订设定',
          keywords: ['修订'],
          content: '这是素材中心保存后的世界书内容。',
          enabled: true
        }]
      }
    }
  });
  const promptCreated = await request(app, {
    method: 'POST',
    url: '/api/resource-library/resources/prompt',
    headers: { 'content-type': 'application/json' },
    body: {
      title: '叙事约束',
      content: '保持角色视角。',
      enabled: true,
      source: { site: 'local-file' }
    }
  });
  const prompt = promptCreated.json().resources[0];
  const promptResponse = await request(app, {
    method: 'PATCH',
    url: `/api/resource-library/resources/${encodeURIComponent(prompt.id)}/content`,
    headers: { 'content-type': 'application/json' },
    body: {
      title: '叙事约束 · 修订',
      payload: {
        ...prompt.payload,
        role: 'system',
        content: '保持角色视角，不替用户决定行动。',
        enabled: true
      }
    }
  });
  const unsupported = await request(app, {
    method: 'PATCH',
    url: `/api/resource-library/resources/${encodeURIComponent(character.id)}/content`,
    headers: { 'content-type': 'application/json' },
    body: { payload: character.payload }
  });

  assert.equal(worldBookResponse.status, 200);
  assert.equal(worldBookResponse.json().resource.payload.entries[0].title, '修订设定');
  assert.equal(promptResponse.status, 200);
  assert.equal(promptResponse.json().resource.title, '叙事约束 · 修订');
  assert.equal(promptResponse.json().resource.payload.content.includes('不替用户决定行动'), true);
  assert.equal(unsupported.status, 400);
  assert.equal(unsupported.json().error, 'RESOURCE_CONTENT_KIND_UNSUPPORTED');
});

test('POST /api/resource-library/resources/:id/tag-registry resolves sidecar ids as an audited revision', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  const tagId = '31f7b74e-9828-4cd2-b7ac-3d93840d471c';
  await request(app, {
    method: 'POST',
    url: '/api/import/commit',
    headers: { 'content-type': 'application/json' },
    body: {
      payload: {
        fileName: 'private-filter-world.json',
        mimeType: 'application/json',
        data: JSON.stringify({
          entries: [{
            uid: 11,
            comment: '仅限武侠角色',
            content: '门派只接待武林中人。',
            character_filter: { tags: [tagId], isExclude: false }
          }]
        })
      },
      source: { site: 'local-file' },
      applyToActiveConfig: false
    }
  });
  const resources = (await request(app, { url: '/api/resource-library/resources' })).json().resources;
  const worldBook = resources.find((item) => item.kind === 'worldbook');
  const response = await request(app, {
    method: 'POST',
    url: `/api/resource-library/resources/${encodeURIComponent(worldBook.id)}/tag-registry`,
    headers: { 'content-type': 'application/json' },
    body: {
      registryDocument: { settings: { tags: [{ id: tagId, name: '武侠' }] } }
    }
  });
  const revisions = await request(app, {
    url: `/api/resource-library/resources/${encodeURIComponent(worldBook.id)}/revisions`
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.json().report.appliedMappings, [{ id: tagId, name: '武侠' }]);
  const filter = response.json().resource.payload.entries[0].extensions.character_filter;
  assert.deepEqual(filter.tags, [tagId]);
  assert.deepEqual(filter.tagNames, ['武侠']);
  assert.deepEqual(filter.unresolvedTagIds, []);
  assert.equal(revisions.json().revisions[0].changeType, 'tag-registry-mapping');
});

test('resource revision endpoints list history and roll back without changing resource identity', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  await request(app, {
    method: 'POST',
    url: '/api/import/commit',
    headers: { 'content-type': 'application/json' },
    body: {
      payload: {
        fileName: 'shen.json',
        mimeType: 'application/json',
        data: JSON.stringify(createV2CardPayload())
      },
      source: { site: 'local-file' },
      applyToActiveConfig: false
    }
  });
  const resources = (await request(app, { url: '/api/resource-library/resources' })).json().resources;
  const worldBook = resources.find((item) => item.kind === 'worldbook');
  const originalTitle = worldBook.payload.entries[0].title;

  const updateResponse = await request(app, {
    method: 'PATCH',
    url: `/api/resource-library/resources/${encodeURIComponent(worldBook.id)}/content`,
    headers: { 'content-type': 'application/json' },
    body: {
      payload: {
        entries: [{
          id: 'revision-http-test',
          title: 'HTTP 修订设定',
          keywords: ['修订'],
          content: '用于验证素材修订接口。',
          enabled: true
        }]
      }
    }
  });
  const historyResponse = await request(app, {
    url: `/api/resource-library/resources/${encodeURIComponent(worldBook.id)}/revisions`
  });
  const history = historyResponse.json();
  const originalRevision = history.revisions.find((item) => item.number === 1);

  const rollbackResponse = await request(app, {
    method: 'POST',
    url: `/api/resource-library/resources/${encodeURIComponent(worldBook.id)}/revisions/${encodeURIComponent(originalRevision.id)}/rollback`,
    headers: { 'content-type': 'application/json' },
    body: {}
  });
  const rollbackHistory = (await request(app, {
    url: `/api/resource-library/resources/${encodeURIComponent(worldBook.id)}/revisions`
  })).json();

  assert.equal(updateResponse.status, 200);
  assert.equal(updateResponse.json().resource.id, worldBook.id);
  assert.equal(updateResponse.json().resource.revision.number, 2);
  assert.equal(historyResponse.status, 200);
  assert.equal(history.revisions.length, 2);
  assert.equal(history.revisions[0].current, true);
  assert.ok(originalRevision?.id);
  assert.equal(rollbackResponse.status, 200);
  assert.equal(rollbackResponse.json().resource.id, worldBook.id);
  assert.equal(rollbackResponse.json().resource.payload.entries[0].title, originalTitle);
  assert.equal(rollbackResponse.json().resource.revision.number, 3);
  assert.equal(rollbackResponse.json().resource.revision.restoredFromRevisionId, originalRevision.id);
  assert.equal(rollbackHistory.revisions.length, 3);
  assert.equal(rollbackHistory.revisions[0].current, true);
});

test('POST /api/resource-library/resources/:id/reevaluate refreshes legacy diagnostics', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  await request(app, {
    method: 'POST',
    url: '/api/import/commit',
    headers: { 'content-type': 'application/json' },
    body: {
      payload: {
        fileName: 'shen.json',
        mimeType: 'application/json',
        data: JSON.stringify(createV2CardPayload())
      },
      source: { site: '类脑社区', author: '社区作者' },
      applyToActiveConfig: false
    }
  });
  const resources = (await request(app, { url: '/api/resource-library/resources' })).json().resources;
  const character = resources.find((item) => item.kind === 'character');

  const response = await request(app, {
    method: 'POST',
    url: `/api/resource-library/resources/${encodeURIComponent(character.id)}/reevaluate`,
    headers: { 'content-type': 'application/json' },
    body: {}
  });

  assert.equal(response.status, 200);
  assert.equal(response.json().resource.id, character.id);
  assert.ok(response.json().resource.diagnostics.score > 0);
  assert.ok(response.json().resource.diagnostics.communityCompatibility);
  assert.equal(response.json().resource.payload.extensions.local_roleplay_agent.enrichment.version, 2);
});

test('PATCH /api/resource-library/resources/:id rejects non-object metadata', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  const response = await request(app, {
    method: 'PATCH',
    url: '/api/resource-library/resources/missing',
    headers: { 'content-type': 'application/json' },
    body: null
  });

  assert.equal(response.status, 400);
  assert.equal(response.json().error, 'RESOURCE_METADATA_INVALID');
});

test('resource library batch endpoints organize, export and remove selected assets', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  await request(app, {
    method: 'POST',
    url: '/api/import/commit',
    headers: { 'content-type': 'application/json' },
    body: {
      payload: {
        fileName: 'shen.json',
        mimeType: 'application/json',
        data: JSON.stringify(createV2CardPayload())
      },
      source: { site: '类脑社区', author: '社区作者' },
      applyToActiveConfig: false
    }
  });
  const resources = (await request(app, { url: '/api/resource-library/resources' })).json().resources;
  const resourceIds = resources.map((item) => item.id);

  const organizeResponse = await request(app, {
    method: 'PATCH',
    url: '/api/resource-library/resources',
    headers: { 'content-type': 'application/json' },
    body: { resourceIds, tags: ['候选'], collections: ['新剧本'], mode: 'merge' }
  });
  const exportResponse = await request(app, {
    method: 'POST',
    url: '/api/resource-library/resources/export',
    headers: { 'content-type': 'application/json' },
    body: { resourceIds }
  });
  const deleteResponse = await request(app, {
    method: 'DELETE',
    url: '/api/resource-library/resources',
    headers: { 'content-type': 'application/json' },
    body: { resourceIds: [resourceIds[0]] }
  });

  assert.equal(organizeResponse.status, 200);
  assert.equal(organizeResponse.json().updated.length, resourceIds.length);
  assert.deepEqual(organizeResponse.json().updated[0].collections, ['新剧本']);
  assert.equal(exportResponse.status, 200);
  assert.equal(exportResponse.json().bundle.schema, 'local-roleplay-agent.asset-bundle/v1');
  assert.equal(exportResponse.json().bundle.resources.length, resourceIds.length);
  assert.equal(deleteResponse.status, 200);
  assert.deepEqual(deleteResponse.json().removed, [resourceIds[0]]);
});

test('custom story composition endpoint previews conflicts and creates an original baseline pack', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  const original = {
    title: '九州残卷',
    worldBookMergeMode: 'smart',
    customBaseline: {
      worldName: '九州残卷',
      genre: '低魔武侠',
      premise: '九州诸侯割据，盐路与驿道决定江湖门派的兴衰。',
      proseStyle: '重对白潜台词和行动后果。',
      hardRules: '伤势、路引和钱粮持续有效。',
      visualPackId: 'yingxiongzhi'
    }
  };
  const inspectionResponse = await request(app, {
    method: 'POST',
    url: '/api/resource-library/packs/inspect',
    headers: { 'content-type': 'application/json' },
    body: original
  });
  const createResponse = await request(app, {
    method: 'POST',
    url: '/api/resource-library/packs',
    headers: { 'content-type': 'application/json' },
    body: original
  });
  const pack = createResponse.json().pack;
  const projectResponse = await request(app, {
    method: 'POST',
    url: '/api/story-projects',
    headers: { 'content-type': 'application/json' },
    body: { basePackId: pack.id, title: '九州残卷 · 第一卷' }
  });

  assert.equal(inspectionResponse.status, 200);
  assert.equal(inspectionResponse.json().composition.summary.finalEntries, 2);
  assert.equal(createResponse.status, 200);
  assert.equal(pack.resourceManifest.basePackId, '');
  assert.equal(pack.visualPackId, 'yingxiongzhi');
  assert.equal(projectResponse.status, 200);
  assert.equal(projectResponse.json().project.basePackId, pack.id);
});

test('custom story composition API blocks the source runtime and records an approved safe derivative', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  const preset = {
    name: '需宿主的社区预设',
    settings: { max_context: 32768, max_completion_tokens: 4096 },
    prompts: [{
      id: 'main',
      name: '主提示',
      enabled: true,
      role: 'system',
      content: '静态 Prompt 可以安全保留。',
      position: { type: 'relative' }
    }],
    extensions: {
      tavern_helper: { scripts: [{ id: 'host-only-hook' }] }
    }
  };
  const importResponse = await request(app, {
    method: 'POST',
    url: '/api/import/commit',
    headers: { 'content-type': 'application/json' },
    body: {
      payload: {
        fileName: 'host-runtime-preset.json',
        mimeType: 'application/json',
        data: JSON.stringify(preset)
      },
      source: { site: 'local-file', fileName: 'host-runtime-preset.json' },
      applyToActiveConfig: false
    }
  });
  const imported = importResponse.json();
  assert.equal(importResponse.status, 200);
  assert.equal(imported.libraryResources.length, 1);
  const input = {
    title: '安全派生接口测试卷',
    promptResourceIds: [imported.libraryResources[0].id],
    customBaseline: {
      worldName: '安全派生接口测试卷',
      premise: '验证服务端组装门禁不能被客户端绕过。'
    }
  };
  const inspectionResponse = await request(app, {
    method: 'POST',
    url: '/api/resource-library/packs/inspect',
    headers: { 'content-type': 'application/json' },
    body: input
  });
  const review = inspectionResponse.json().composition.compatibilityReview;
  const unapprovedResponse = await request(app, {
    method: 'POST',
    url: '/api/resource-library/packs',
    headers: { 'content-type': 'application/json' },
    body: input
  });
  const approvedResponse = await request(app, {
    method: 'POST',
    url: '/api/resource-library/packs',
    headers: { 'content-type': 'application/json' },
    body: {
      ...input,
      compatibilityReview: {
        fingerprint: review.fingerprint,
        approvedScriptHashes: [],
        executionMode: 'local-observe',
        acknowledgeCompatibility: true
      }
    }
  });
  assert.equal(approvedResponse.status, 200);
  const approvedPack = approvedResponse.json().pack;
  const record = approvedPack.resourceManifest.composition.compatibilityReview;
  const project = (await request(app, {
    method: 'POST',
    url: '/api/story-projects',
    headers: { 'content-type': 'application/json' },
    body: { basePackId: approvedPack.id, title: '安全派生接口测试卷' }
  })).json().project;
  const session = (await request(app, {
    method: 'POST',
    url: `/api/story-projects/${encodeURIComponent(project.id)}/sessions`,
    headers: { 'content-type': 'application/json' },
    body: {}
  })).json().session;
  const healthResponse = await request(app, {
    url: `/api/sessions/${encodeURIComponent(session.id)}/health`
  });
  const compatibilityHealth = healthResponse.json().health.checks
    .find((item) => item.id === 'resource-compatibility');

  assert.equal(inspectionResponse.status, 200);
  assert.equal(review.contractVersion, 2);
  assert.equal(review.sourceRuntimeBlocked, true);
  assert.equal(review.safeDerivativeAvailable, true);
  assert.ok(review.blockers.some((item) => item.id === 'tavern-helper'));
  assert.equal(unapprovedResponse.status, 409);
  assert.equal(unapprovedResponse.json().error, 'RESOURCE_PACK_REVIEW_REQUIRED');
  assert.equal(approvedResponse.status, 200);
  assert.equal(record.contractVersion, 2);
  assert.equal(record.status, 'safe-derivative-local-observe');
  assert.ok(record.disabledCapabilities.some((item) => item.id === 'tavern-helper'));
  assert.equal(healthResponse.status, 200);
  assert.equal(compatibilityHealth.status, 'warning');
  assert.match(compatibilityHealth.title, /安全派生版/);
  assert.ok(compatibilityHealth.evidence.some((item) => /酒馆助手运行时/u.test(item)));
});

test('legacy compatibility upgrade creates a new pack without migrating its project or session', async () => {
  const rootDir = await createTestRoot();
  const app = createApp({ rootDir });
  const sourcePack = (await request(app, {
    method: 'POST',
    url: '/api/resource-library/packs',
    headers: { 'content-type': 'application/json' },
    body: {
      title: '历史原创卷',
      customBaseline: {
        worldName: '历史原创卷',
        genre: '悬疑',
        premise: '失踪档案在十年后重新出现。',
        proseStyle: '重视证据链。'
      }
    }
  })).json().pack;
  const project = (await request(app, {
    method: 'POST',
    url: '/api/story-projects',
    headers: { 'content-type': 'application/json' },
    body: { basePackId: sourcePack.id, title: '历史原创卷' }
  })).json().project;
  const session = (await request(app, {
    method: 'POST',
    url: `/api/story-projects/${encodeURIComponent(project.id)}/sessions`,
    headers: { 'content-type': 'application/json' },
    body: {}
  })).json().session;
  const sourcePath = path.join(rootDir, 'data', 'library', 'packs', `${sourcePack.id}.json`);
  const legacy = JSON.parse(await readFile(sourcePath, 'utf8'));
  delete legacy.resourceManifest.composition.compatibilityReview;
  delete legacy.resourceManifest.customBaseline;
  await writeFile(sourcePath, `${JSON.stringify(legacy, null, 2)}\n`, 'utf8');

  const overviewBefore = await request(app, {
    url: '/api/resource-library/packs/compatibility-overview'
  });
  const sourceOverview = overviewBefore.json().packs.find((item) => item.packId === sourcePack.id);

  const blockedProjectResponse = await request(app, {
    method: 'POST',
    url: '/api/story-projects',
    headers: { 'content-type': 'application/json' },
    body: { basePackId: sourcePack.id, title: '不应创建的新故事' }
  });
  const blockedSessionResponse = await request(app, {
    method: 'POST',
    url: `/api/story-projects/${encodeURIComponent(project.id)}/sessions`,
    headers: { 'content-type': 'application/json' },
    body: {}
  });
  const blockedApplyResponse = await request(app, {
    method: 'POST',
    url: `/api/content-packs/${encodeURIComponent(sourcePack.id)}/apply`,
    headers: { 'content-type': 'application/json' },
    body: { sessionId: 'main' }
  });

  const previewResponse = await request(app, {
    url: `/api/resource-library/packs/${encodeURIComponent(sourcePack.id)}/compatibility-upgrade`
  });
  const preview = previewResponse.json().preview;
  const createResponse = await request(app, {
    method: 'POST',
    url: `/api/resource-library/packs/${encodeURIComponent(sourcePack.id)}/compatibility-upgrade`,
    headers: { 'content-type': 'application/json' },
    body: {
      compatibilityReview: {
        fingerprint: preview.compatibilityReview.fingerprint,
        approvedScriptHashes: [],
        acknowledgeCompatibility: preview.compatibilityReview.requiresCompatibilityAcknowledgement
      }
    }
  });
  const upgraded = createResponse.json().pack;
  const upgradedProjectResponse = await request(app, {
    method: 'POST',
    url: '/api/story-projects',
    headers: { 'content-type': 'application/json' },
    body: { basePackId: upgraded.id, title: '兼容新版故事' }
  });
  const storedSource = JSON.parse(await readFile(sourcePath, 'utf8'));
  const projects = (await request(app, { url: '/api/story-projects' })).json().projects;
  const storedSession = (await request(app, {
    url: `/api/state?sessionId=${encodeURIComponent(session.id)}`
  })).json().session;

  assert.equal(previewResponse.status, 200);
  assert.equal(overviewBefore.status, 200);
  assert.equal(overviewBefore.json().spec, 'lra.pack-compatibility-overview/v1');
  assert.equal(sourceOverview.status, 'upgrade-available');
  assert.equal(sourceOverview.canStartNewStory, false);
  assert.equal(blockedProjectResponse.status, 409);
  assert.equal(blockedProjectResponse.json().error, 'CONTENT_PACK_COMPATIBILITY_REVIEW_REQUIRED');
  assert.equal(blockedSessionResponse.status, 409);
  assert.equal(blockedSessionResponse.json().error, 'CONTENT_PACK_COMPATIBILITY_REVIEW_REQUIRED');
  assert.equal(blockedApplyResponse.status, 409);
  assert.equal(blockedApplyResponse.json().error, 'CONTENT_PACK_COMPATIBILITY_REVIEW_REQUIRED');
  assert.equal(preview.rebuildable, true);
  assert.equal(preview.assemblyInput.customBaseline.worldName, '历史原创卷');
  assert.equal(createResponse.status, 200);
  assert.equal(upgradedProjectResponse.status, 200);
  assert.notEqual(upgraded.id, sourcePack.id);
  assert.equal(upgraded.resourceManifest.compatibilityUpgrade.sourcePackId, sourcePack.id);
  assert.equal(upgraded.resourceManifest.compatibilityUpgrade.contractVersion, 2);
  assert.equal(storedSource.resourceManifest.composition.compatibilityReview, undefined);
  assert.equal(projects.find((item) => item.id === project.id).basePackId, sourcePack.id);
  assert.equal(storedSession.basePackId, sourcePack.id);
  assert.ok(upgraded.worldBook.some((item) => /失踪档案/u.test(item.content)));
});

test('genre-derived custom story excludes built-in actors lore and fixed routes end to end', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  const imported = (await request(app, {
    method: 'POST',
    url: '/api/import/commit',
    headers: { 'content-type': 'application/json' },
    body: {
      payload: { fileName: 'shen.json', mimeType: 'application/json', data: JSON.stringify(createV2CardPayload()) },
      source: { site: 'local-file', fileName: 'shen.json' },
      applyToActiveConfig: false
    }
  })).json();
  const character = imported.libraryResources.find((item) => item.kind === 'character');
  const packResponse = await request(app, {
    method: 'POST',
    url: '/api/resource-library/packs',
    headers: { 'content-type': 'application/json' },
    body: {
      title: '沈观澜仙侠派生卷',
      basePackId: 'xianxia',
      baseInheritanceMode: 'genre',
      characterResourceId: character.id
    }
  });
  const pack = packResponse.json().pack;
  const project = (await request(app, {
    method: 'POST',
    url: '/api/story-projects',
    headers: { 'content-type': 'application/json' },
    body: { basePackId: pack.id, title: '沈观澜仙侠派生卷' }
  })).json().project;
  const sessionResponse = await request(app, {
    method: 'POST',
    url: `/api/story-projects/${encodeURIComponent(project.id)}/sessions`,
    headers: { 'content-type': 'application/json' },
    body: {}
  });
  const session = sessionResponse.json().session;

  assert.equal(packResponse.status, 200);
  assert.equal(sessionResponse.status, 200);
  assert.equal(pack.characterCard.name, '沈观澜');
  assert.deepEqual(pack.characterPresets, []);
  assert.deepEqual(pack.groupMembers, []);
  assert.equal(pack.worldBook.some((entry) => /闻雪照|赤松子|太虚界|断魂灯/.test(JSON.stringify(entry))), false);
  assert.equal(pack.promptModules.some((module) => module.id === 'xianxia-core-route-contract'), false);
  assert.equal(pack.promptModules.some((module) => module.id === 'world-premise'), false);
  assert.ok(pack.promptModules.some((module) => module.id === 'core-rules'));
  assert.equal(session.config.contentPackId, pack.id);
  assert.deepEqual(session.config.characterPresets, []);
  assert.deepEqual(session.config.groupMembers, []);
});

test('custom pack API edits bookshelf metadata and removes only the stored pack', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  const created = (await request(app, {
    method: 'POST',
    url: '/api/resource-library/packs',
    headers: { 'content-type': 'application/json' },
    body: {
      title: '旧剧本名',
      customBaseline: { worldName: '九州残卷', genre: '低魔武侠' }
    }
  })).json().pack;
  const updatedResponse = await request(app, {
    method: 'PATCH',
    url: `/api/resource-library/packs/${encodeURIComponent(created.id)}`,
    headers: { 'content-type': 'application/json' },
    body: { title: '九州残卷 · 新卷', description: '书架说明', sessionTitle: '九州残卷' }
  });
  const deleteResponse = await request(app, {
    method: 'DELETE',
    url: `/api/resource-library/packs/${encodeURIComponent(created.id)}`,
    headers: { 'content-type': 'application/json' },
    body: { confirmDetach: true }
  });
  const packs = (await request(app, { url: '/api/content-packs' })).json().contentPacks;

  assert.equal(updatedResponse.status, 200);
  assert.equal(updatedResponse.json().pack.title, '九州残卷 · 新卷');
  assert.equal(updatedResponse.json().pack.manifest.title, '九州残卷 · 新卷');
  assert.equal(deleteResponse.status, 200);
  assert.equal(packs.some((pack) => pack.id === created.id), false);
});

test('custom pack deletion previews dependencies and archives projects while preserving session snapshots', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  const pack = (await request(app, {
    method: 'POST',
    url: '/api/resource-library/packs',
    headers: { 'content-type': 'application/json' },
    body: {
      title: '月下山门',
      customBaseline: { worldName: '月下山门', genre: '仙侠日常' }
    }
  })).json().pack;
  const project = (await request(app, {
    method: 'POST',
    url: '/api/story-projects',
    headers: { 'content-type': 'application/json' },
    body: { basePackId: pack.id, title: '月下旧卷' }
  })).json().project;
  const session = (await request(app, {
    method: 'POST',
    url: `/api/story-projects/${encodeURIComponent(project.id)}/sessions`,
    headers: { 'content-type': 'application/json' },
    body: {}
  })).json().session;

  const impactResponse = await request(app, {
    url: `/api/resource-library/packs/${encodeURIComponent(pack.id)}/deletion-impact`
  });
  const unconfirmedResponse = await request(app, {
    method: 'DELETE',
    url: `/api/resource-library/packs/${encodeURIComponent(pack.id)}`,
    headers: { 'content-type': 'application/json' },
    body: {}
  });
  const deleteResponse = await request(app, {
    method: 'DELETE',
    url: `/api/resource-library/packs/${encodeURIComponent(pack.id)}`,
    headers: { 'content-type': 'application/json' },
    body: { confirmDetach: true }
  });
  const projects = (await request(app, { url: '/api/story-projects' })).json().projects;
  const detachedProject = projects.find((item) => item.id === project.id);
  const detachedSession = (await request(app, {
    url: `/api/state?sessionId=${encodeURIComponent(session.id)}`
  })).json().session;
  const createAnotherResponse = await request(app, {
    method: 'POST',
    url: `/api/story-projects/${encodeURIComponent(project.id)}/sessions`,
    headers: { 'content-type': 'application/json' },
    body: {}
  });

  assert.equal(impactResponse.status, 200);
  assert.deepEqual(impactResponse.json().impact.projects.map((item) => item.id), [project.id]);
  assert.deepEqual(impactResponse.json().impact.sessions.map((item) => item.id), [session.id]);
  assert.equal(unconfirmedResponse.status, 409);
  assert.equal(unconfirmedResponse.json().error, 'CONTENT_DELETE_CONFIRMATION_REQUIRED');
  assert.equal(deleteResponse.status, 200);
  assert.ok(deleteResponse.json().backup.id);
  assert.equal(detachedProject.basePackId, '');
  assert.equal(detachedProject.lifecycleState, 'detached');
  assert.equal(detachedProject.canCreateSession, false);
  assert.equal(detachedSession.storyProjectId, '');
  assert.equal(detachedSession.basePackId, '');
  assert.equal(detachedSession.config.contentPackId, '');
  assert.ok(detachedSession.config.characterCard);
  assert.ok(Array.isArray(detachedSession.config.worldBook));
  assert.equal(detachedSession.provenance.bindingHistory.at(-1).reason, 'content-pack-deleted');
  assert.equal(createAnotherResponse.status, 409);
  assert.equal(createAnotherResponse.json().error, 'STORY_PROJECT_DETACHED');
});

test('v0.2.2 plugin manifest preview installs declarative adapters and blocks executable plugins', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  const manifest = {
    spec: 'lra.plugin/v1',
    id: 'community.rain-night',
    version: '1.0.0',
    name: '雨夜适配',
    engine: '>=0.2.2 <2.0.0',
    adapters: [{
      id: 'rain-night-lore',
      label: '雨夜世界书',
      kinds: ['worldbook'],
      formats: ['json'],
      match: { previewKinds: ['world-book'], sourceIncludes: ['rain-night'] }
    }]
  };
  const preview = await request(app, {
    method: 'POST',
    url: '/api/import/preview',
    headers: { 'content-type': 'application/json' },
    body: { payload: { mimeType: 'application/json', data: JSON.stringify(manifest) } }
  });
  const committed = await request(app, {
    method: 'POST',
    url: '/api/import/commit',
    headers: { 'content-type': 'application/json' },
    body: { payload: { mimeType: 'application/json', data: JSON.stringify(manifest) } }
  });
  const plugins = (await request(app, { url: '/api/plugins' })).json();
  const adapters = (await request(app, { url: '/api/resource-library/adapters' })).json().adapters;
  const blocked = await request(app, {
    method: 'POST',
    url: '/api/import/commit',
    headers: { 'content-type': 'application/json' },
    body: { payload: { mimeType: 'application/json', data: JSON.stringify({ ...manifest, id: 'community.unsafe', script: 'run.js' }) } }
  });

  assert.equal(preview.status, 200);
  assert.equal(preview.json().preview.kind, 'plugin-manifest');
  assert.equal(preview.json().preview.inspection.adapter.id, 'lra-plugin-manifest-v1');
  assert.equal(committed.status, 200);
  assert.equal(committed.json().applyMode, 'plugin-registry');
  assert.ok(plugins.plugins.find((item) => item.id === manifest.id && item.origin === 'local'));
  assert.ok(adapters.find((item) => item.id === 'rain-night-lore'));
  assert.equal(blocked.status, 422);
});

test('v0.2.2 imports, exports and applies a versioned content pack bundle', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  const bundle = createContentPackBundlePayload();
  const preview = await request(app, {
    method: 'POST',
    url: '/api/import/preview',
    headers: { 'content-type': 'application/json' },
    body: { payload: { mimeType: 'application/json', data: JSON.stringify(bundle) } }
  });
  const committed = await request(app, {
    method: 'POST',
    url: '/api/import/commit',
    headers: { 'content-type': 'application/json' },
    body: {
      payload: { mimeType: 'application/json', fileName: 'rain-night.json', data: JSON.stringify(bundle) },
      source: { site: 'local-file', fileName: 'rain-night.json' }
    }
  });
  const installed = committed.json().pack;
  const listed = (await request(app, { url: '/api/content-packs' })).json().contentPacks;
  const exported = await request(app, { url: `/api/content-packs/${installed.id}/export` });
  const applied = await request(app, {
    method: 'POST',
    url: `/api/content-packs/${installed.id}/apply`,
    headers: { 'content-type': 'application/json' },
    body: { sessionId: 'main' }
  });

  assert.equal(preview.status, 200);
  assert.equal(preview.json().preview.inspection.adapter.id, 'lra-content-pack-v1');
  assert.equal(preview.json().preview.inspection.canImport, true);
  assert.equal(preview.json().preview.inspection.compatibilityReview.requiresScriptApproval, false);
  assert.equal(committed.status, 200);
  assert.equal(committed.json().applyMode, 'content-pack-library');
  assert.equal(committed.json().installStatus, 'created');
  assert.equal(installed.resourceManifest.composition.compatibilityReview.contractVersion, 2);
  assert.equal(installed.resourceManifest.composition.compatibilityReview.status, 'not-required');
  assert.ok(listed.find((pack) => pack.id === installed.id && pack.version === '1.1.0'));
  assert.equal(exported.status, 200);
  assert.equal(exported.json().manifest.id, 'community.rain-night');
  assert.equal(applied.status, 200);
  assert.equal(applied.json().characterCard.name, '沈观澜');
});

test('strict content-pack mode requires hash-bound review before installation', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  const bundle = createContentPackBundlePayload();
  bundle.manifest.id = 'community.reviewed-panel';
  bundle.manifest.title = '待审核面板包';
  bundle.content.lightFrontend = {
    regexTransforms: [{
      id: 'reviewed-panel-script',
      name: '待审核状态面板',
      pattern: '<state>([\\s\\S]*?)</state>',
      flags: 'g',
      replacement: '<script>document.body.dataset.state = "ready"</script>',
      scope: 'assistant',
      enabled: true,
      requiresSandbox: true
    }]
  };
  const payload = { mimeType: 'application/json', data: JSON.stringify(bundle) };
  const previewResponse = await request(app, {
    method: 'POST',
    url: '/api/import/preview',
    headers: { 'content-type': 'application/json' },
    body: { payload }
  });
  const review = previewResponse.json().preview.inspection.compatibilityReview;
  const rejected = await request(app, {
    method: 'POST',
    url: '/api/import/commit',
    headers: { 'content-type': 'application/json' },
    body: {
      payload,
      compatibilityReview: {
        fingerprint: review.fingerprint,
        executionMode: 'review-required',
        scriptReviews: [],
        acknowledgeCompatibility: review.requiresCompatibilityAcknowledgement
      }
    }
  });
  const approved = await request(app, {
    method: 'POST',
    url: '/api/import/commit',
    headers: { 'content-type': 'application/json' },
    body: {
      payload,
      compatibilityReview: {
        fingerprint: review.fingerprint,
        executionMode: 'review-required',
        scriptReviews: review.rules.map((rule) => ({
          scriptId: rule.scriptId,
          contentHash: rule.contentHash,
          decision: 'approved',
          note: '已核对脚本来源、内容哈希与运行风险。'
        })),
        acknowledgeCompatibility: review.requiresCompatibilityAcknowledgement
      }
    }
  });

  assert.equal(previewResponse.status, 200);
  assert.equal(review.requiresScriptApproval, true);
  assert.equal(review.rules.length, 1);
  assert.equal(rejected.status, 409);
  assert.equal(rejected.json().error, 'RESOURCE_PACK_SCRIPT_APPROVAL_REQUIRED');
  assert.equal(approved.status, 200);
  assert.equal(
    approved.json().pack.resourceManifest.composition.compatibilityReview.status,
    'safe-derivative-approved'
  );
  assert.ok(
    approved.json().pack.resourceManifest.composition.compatibilityReview.disabledCapabilities.length > 0
  );
  assert.deepEqual(
    approved.json().pack.lightFrontend.trustedScriptIds,
    ['reviewed-panel-script']
  );
});

test('GET /api/content-packs lists linked genre packs', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, { url: '/api/content-packs' });
  const payload = response.json();

  assert.equal(response.status, 200);
  assert.ok(payload.contentPacks.find((pack) => pack.id === 'xuanhuan'));
  const lingyi = payload.contentPacks.find((pack) => pack.id === 'lingyi');
  assert.ok(lingyi);
  assert.equal(lingyi.title, '民俗灵异内容包');
  assert.equal(lingyi.counts.promptModules >= 10, true);
  assert.equal(lingyi.counts.worldBook >= 16, true);
  assert.equal(lingyi.counts.memoryCards >= 4, true);
  assert.equal(lingyi.ruleSystem.id, 'lingyi-rule-system');
  assert.match(lingyi.ruleSystem.boundary, /不引入玄幻修炼/);
  const mingmo = payload.contentPacks.find((pack) => pack.id === 'mingmo');
  assert.ok(mingmo);
  assert.equal(mingmo.title, '明末风云内容包');
  assert.equal(mingmo.counts.promptModules >= 10, true);
  assert.equal(mingmo.counts.worldBook >= 18, true);
  assert.equal(mingmo.counts.memoryCards >= 4, true);
  assert.equal(mingmo.ruleSystem.id, 'mingmo-rule-system');
  assert.match(mingmo.ruleSystem.boundary, /银粮/);
  const yingxiongzhi = payload.contentPacks.find((pack) => pack.id === 'yingxiongzhi');
  assert.ok(yingxiongzhi);
  assert.equal(yingxiongzhi.characterName, '卢云');
  assert.equal(yingxiongzhi.counts.worldBook >= 148, true);
  assert.equal(yingxiongzhi.counts.characterPresets, 12);
});

test('GET /api/content-packs/:packId/characters exposes curated Hero presets', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, { url: '/api/content-packs/yingxiongzhi/characters' });
  const payload = response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.characterPresets.length, 12);
  assert.ok(payload.characterPresets.find((preset) => preset.characterCard.name === '卢云'));
  assert.ok(payload.characterPresets.find((preset) => preset.characterCard.name === '杨肃观'));
  assert.ok(payload.characterPresets.every((preset) => preset.characterCard.extensions.contentPack === 'yingxiongzhi'));
});

test('POST /api/content-packs/:packId/apply synchronizes prompt world character and facts', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'POST',
    url: '/api/content-packs/lingyi/apply',
    headers: { 'content-type': 'application/json' },
    body: { sessionId: 'main' }
  });
  const payload = response.json();
  const state = (await request(app, { url: '/api/state' })).json();

  assert.equal(response.status, 200);
  assert.equal(payload.appliedPack.id, 'lingyi');
  assert.ok(payload.promptModules.find((module) => module.id === 'lingyi-fear-pacing'));
  assert.ok(payload.worldBook.find((entry) => entry.id === 'location-yongan-building'));
  assert.equal(payload.characterCard.name, '陈默');
  assert.equal(payload.session.memory.worldState.protagonist.name, '陈默');
  assert.equal(payload.session.memory.ruleSystem.id, 'lingyi-rule-system');
  assert.ok(payload.session.memory.memoryCards.find((fact) => fact.id === 'fact-lingyi-current-case'));
  assert.equal(payload.session.config.contentPackId, 'lingyi');
  assert.equal(payload.session.config.characterPresets.length >= 4, true);
  assert.equal(payload.session.memory.simulation.actors.length >= 4, true);
  assert.equal(state.config.characterCard.name, '陈默');
  assert.ok(state.config.worldBook.find((entry) => entry.id === 'quest-smile-murders'));
  assert.equal(state.session.memory.worldState.flags.genre, 'lingyi');
});

test('POST /api/content-packs/:packId/apply synchronizes Mingmo historical pack', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'POST',
    url: '/api/content-packs/mingmo/apply',
    headers: { 'content-type': 'application/json' },
    body: { sessionId: 'main' }
  });
  const payload = response.json();
  const state = (await request(app, { url: '/api/state' })).json();

  assert.equal(response.status, 200);
  assert.equal(payload.appliedPack.id, 'mingmo');
  assert.ok(payload.promptModules.find((module) => module.id === 'mingmo-history-pacing'));
  assert.ok(payload.worldBook.find((entry) => entry.id === 'event-chongzhen-last-years'));
  assert.equal(payload.characterCard.name, '顾怀砚');
  assert.equal(payload.session.memory.worldState.protagonist.name, '顾怀砚');
  assert.equal(payload.session.memory.ruleSystem.id, 'mingmo-rule-system');
  assert.ok(payload.session.memory.memoryCards.find((fact) => fact.id === 'fact-mingmo-current-crisis'));
  assert.equal(state.config.characterCard.name, '顾怀砚');
  assert.ok(state.config.worldBook.find((entry) => entry.id === 'quest-secret-edict'));
  assert.equal(state.session.memory.worldState.flags.genre, 'mingmo');
});

test('POST /api/content-packs/:packId/apply synchronizes Hero multi-agent pack', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'POST',
    url: '/api/content-packs/yingxiongzhi/apply',
    headers: { 'content-type': 'application/json' },
    body: { sessionId: 'main' }
  });
  const payload = response.json();
  const state = (await request(app, { url: '/api/state' })).json();

  assert.equal(response.status, 200);
  assert.equal(payload.appliedPack.id, 'yingxiongzhi');
  assert.equal(payload.characterCard.name, '卢云');
  assert.equal(payload.worldBook.filter((entry) => entry.type === 'story-node').length, 45);
  assert.ok(payload.worldBook.find((entry) => entry.extensions?.agentId === 'wu_chonghua'));
  assert.equal(payload.session.memory.ruleSystem.id, 'yingxiongzhi-rules');
  assert.equal(state.session.memory.worldState.flags.currentNode, 'E02');
  assert.equal(state.config.worldBook.length >= 148, true);
});

test('applying a content pack replaces stale session-scoped character and world book', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const createResponse = await request(app, {
    method: 'POST',
    url: '/api/sessions',
    headers: { 'content-type': 'application/json' },
    body: {
      id: 'story_pack_switch',
      title: '题材切换验证',
      packId: 'yingxiongzhi'
    }
  });
  const before = (await request(app, { url: '/api/state?sessionId=story_pack_switch' })).json();
  const applyResponse = await request(app, {
    method: 'POST',
    url: '/api/content-packs/xianxia/apply',
    headers: { 'content-type': 'application/json' },
    body: { sessionId: 'story_pack_switch' }
  });
  const payload = applyResponse.json();
  const after = (await request(app, { url: '/api/state?sessionId=story_pack_switch' })).json();

  assert.equal(createResponse.status, 200);
  assert.equal(before.config.characterCard.extensions.contentPack, 'yingxiongzhi');
  assert.ok(before.config.worldBook.find((entry) => entry.id === 'constant-yingxiongzhi-premise'));
  assert.equal(applyResponse.status, 200);
  assert.equal(payload.session.config.characterCard.extensions.contentPack, 'xianxia');
  assert.equal(after.config.characterCard.extensions.contentPack, 'xianxia');
  assert.ok(after.config.worldBook.find((entry) => entry.id === 'constant-xianxia-premise'));
  assert.equal(after.config.worldBook.some((entry) => entry.id === 'constant-yingxiongzhi-premise'), false);
  assert.equal(after.session.memory.worldState.flags.genre, 'xianxia');
});

test('POST /api/content-packs/:packId/apply rejects missing pack', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'POST',
    url: '/api/content-packs/missing/apply',
    headers: { 'content-type': 'application/json' },
    body: { sessionId: 'main' }
  });

  assert.equal(response.status, 404);
  assert.deepEqual(response.json(), { error: 'CONTENT_PACK_NOT_FOUND' });
});

test('GET /api/state returns selected session scoped config', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const createResponse = await request(app, {
    method: 'POST',
    url: '/api/sessions',
    headers: { 'content-type': 'application/json' },
    body: {
      id: 'story_lingyi',
      title: '灵异支线',
      packId: 'lingyi'
    }
  });
  const response = await request(app, { url: '/api/state?sessionId=story_lingyi' });
  const payload = response.json();

  assert.equal(createResponse.status, 200);
  assert.equal(response.status, 200);
  assert.equal(payload.session.id, 'story_lingyi');
  assert.equal(payload.config.characterCard.name, '陈默');
  assert.ok(payload.config.worldBook.find((entry) => entry.id === 'quest-smile-murders'));
  assert.ok(payload.config.promptModules.find((module) => module.id === 'lingyi-fear-pacing'));
  assert.ok(payload.config.providers);
  assert.equal(payload.session.memory.ruleSystem.id, 'lingyi-rule-system');
});

test('session scoped editors initialize config for legacy sessions', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const worldResponse = await request(app, {
    method: 'PUT',
    url: '/api/world-book',
    headers: { 'content-type': 'application/json' },
    body: {
      sessionId: 'main',
      worldBook: [{
        id: 'manual-town',
        title: '雾镇',
        keywords: ['雾镇'],
        content: '雾镇三更后无人点灯。',
        enabled: true
      }]
    }
  });
  const characterResponse = await request(app, {
    method: 'PUT',
    url: '/api/character-card',
    headers: { 'content-type': 'application/json' },
    body: {
      sessionId: 'main',
      characterCard: {
        name: '周闻灯',
        role: '守夜人',
        enabled: true
      }
    }
  });
  const promptResponse = await request(app, {
    method: 'PUT',
    url: '/api/prompt-modules',
    headers: { 'content-type': 'application/json' },
    body: {
      sessionId: 'main',
      promptModules: [{
        id: 'local-rule',
        title: '本会话规则',
        content: '保持民俗悬疑氛围。',
        enabled: true
      }]
    }
  });
  const state = (await request(app, { url: '/api/state?sessionId=main' })).json();

  assert.equal(worldResponse.status, 200);
  assert.equal(characterResponse.status, 200);
  assert.equal(promptResponse.status, 200);
  assert.equal(state.config.characterCard.name, '周闻灯');
  assert.equal(state.config.worldBook[0].title, '雾镇');
  assert.equal(state.config.promptModules[0].title, '本会话规则');
});

test('PUT /api/persona updates only the selected session and normalizes the draft', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  const createResponse = await request(app, {
    method: 'POST',
    url: '/api/sessions',
    headers: { 'content-type': 'application/json' },
    body: {
      id: 'persona_target',
      title: '人设目标会话',
      packId: 'lingyi'
    }
  });
  const response = await request(app, {
    method: 'PUT',
    url: '/api/persona',
    headers: { 'content-type': 'application/json' },
    body: {
      sessionId: 'persona_target',
      persona: {
        enabled: true,
        name: '  林渡  ',
        description: ' 走阴人 ',
        background: ' 江南 ',
        personality: ' 克制 '
      }
    }
  });
  const targetState = (await request(app, {
    url: '/api/state?sessionId=persona_target'
  })).json();
  const mainState = (await request(app, { url: '/api/state?sessionId=main' })).json();

  assert.equal(createResponse.status, 200);
  assert.equal(response.status, 200);
  assert.deepEqual(response.json().persona, {
    enabled: true,
    name: '林渡',
    description: '走阴人',
    background: '江南',
    personality: '克制'
  });
  assert.equal(targetState.config.persona.name, '林渡');
  assert.equal(targetState.session.config.persona.name, '林渡');
  assert.equal(mainState.config.persona.name === '林渡', false);
});

test('PUT /api/persona keeps the legacy global save contract when sessionId is absent', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'PUT',
    url: '/api/persona',
    headers: { 'content-type': 'application/json' },
    body: {
      persona: {
        enabled: true,
        name: '  旧版用户  ',
        description: ' 全局人设 '
      }
    }
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.json().persona, {
    enabled: true,
    name: '旧版用户',
    description: '全局人设',
    background: '',
    personality: ''
  });
});

test('PUT /api/session/settings saves per-session provider settings', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'PUT',
    url: '/api/session/settings',
    headers: { 'content-type': 'application/json' },
    body: {
      sessionId: 'main',
      settings: {
        providerId: 'scene',
        recentPairs: 12,
        maxInjectedCards: 7,
        maxPromptTokens: 12000,
        narrativeMode: 'strict',
        roleplayMode: 'director',
        responseLength: 'long',
        worldBookIncludeNames: false,
        worldBookCaseSensitive: true,
        worldBookMatchWholeWords: true,
        worldBookMinActivations: 3,
        worldBookMinActivationsDepthMax: 24,
        taskProviderOverrides: { fact: 'fact-local', unknown: 'ignored' },
        taskFallbackOverrides: { summary: ['summary-backup'], unknown: ['ignored'] },
        backgroundImage: '/assets/wuxia-stage.png',
        backgroundFit: 'portrait',
        backgroundSource: 'character-portrait',
        theme: 'default-dark',
        visualContentPack: 'yingxiongzhi'
      }
    }
  });
  const payload = response.json();
  const state = (await request(app, { url: '/api/state' })).json();

  assert.equal(response.status, 200);
  assert.equal(payload.session.settings.providerId, 'scene');
  assert.equal(payload.session.settings.recentPairs, 12);
  assert.equal(payload.session.settings.maxInjectedCards, 7);
  assert.equal(payload.session.settings.maxPromptTokens, 12000);
  assert.equal(payload.session.settings.narrativeMode, 'strict');
  assert.equal(payload.session.settings.roleplayMode, 'director');
  assert.equal(payload.session.settings.responseLength, 'long');
  assert.equal(payload.session.settings.worldBookIncludeNames, false);
  assert.equal(payload.session.settings.worldBookCaseSensitive, true);
  assert.equal(payload.session.settings.worldBookMatchWholeWords, true);
  assert.equal(payload.session.settings.worldBookMinActivations, 3);
  assert.equal(payload.session.settings.worldBookMinActivationsDepthMax, 24);
  assert.deepEqual(payload.session.settings.taskProviderOverrides, { fact: 'fact-local' });
  assert.deepEqual(payload.session.settings.taskFallbackOverrides, { summary: ['summary-backup'] });
  assert.equal(payload.session.settings.backgroundImage, '/assets/wuxia-stage.png');
  assert.equal(payload.session.settings.backgroundFit, 'portrait');
  assert.equal(payload.session.settings.backgroundSource, 'character-portrait');
  assert.equal(payload.session.settings.theme, 'default-dark');
  assert.equal(payload.session.settings.visualContentPack, 'yingxiongzhi');
  assert.equal(state.session.settings.narrativeMode, 'strict');
  assert.deepEqual(state.session.settings, payload.session.settings);
});

test('POST /api/rewrite returns a Magic Rewrite suggestion without mutating chat', async () => {
  const app = createApp({
    rootDir: await createTestRoot(),
    providerClient: {
      complete: async ({ messages }) => {
        assert.match(messages[0].content, /Magic Rewrite/);
        assert.match(messages.at(-1).content, /我推门进去/);
        return { content: '我放轻脚步，缓缓推开那扇门。', raw: { rewrite: true } };
      }
    }
  });
  await request(app, {
    method: 'PUT',
    url: '/api/providers',
    headers: { 'content-type': 'application/json' },
    body: {
      activeProviderId: 'local',
      providers: [{
        id: 'local',
        kind: 'openai-compatible',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'secret',
        model: 'rewrite-model',
        temperature: 0.5,
        maxTokens: 1024,
        headers: {}
      }]
    }
  });

  const response = await request(app, {
    method: 'POST',
    url: '/api/rewrite',
    headers: { 'content-type': 'application/json' },
    body: {
      sessionId: 'main',
      target: 'chat-input',
      text: '我推门进去',
      instruction: '更有画面感'
    }
  });
  const payload = response.json();
  const state = (await request(app, { url: '/api/state' })).json();

  assert.equal(response.status, 200);
  assert.equal(payload.text, '我放轻脚步，缓缓推开那扇门。');
  assert.equal(payload.providerId, 'local');
  assert.equal(payload.model, 'rewrite-model');
  assert.equal(state.session.messages.length, 0);
  assert.equal(state.session.usageLedger.length, 1);
  assert.equal(state.session.usageLedger[0].taskKey, 'rewrite');
});

test('GET /api/usage returns live session token usage', async () => {
  const app = createApp({
    rootDir: await createTestRoot(),
    providerClient: {
      complete: async () => ({
        content: '一段回应。',
        usage: {
          prompt_tokens: 100,
          completion_tokens: 20,
          total_tokens: 120
        }
      })
    }
  });
  await saveHttpProvider(app);
  await request(app, {
    method: 'POST',
    url: '/api/chat',
    headers: { 'content-type': 'application/json' },
    body: { sessionId: 'main', content: '开始' }
  });

  const response = await request(app, { url: '/api/usage?sessionId=main' });
  const payload = response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.usage.scope, 'session');
  assert.equal(payload.usage.sessionId, 'main');
  assert.equal(payload.usage.totals.calls, 1);
  assert.equal(payload.usage.byTask[0].taskKey, 'chat');
  assert.equal(payload.usage.totals.totalTokens, 120);
  assert.equal(payload.usage.byProvider[0].providerId, 'local');
});

test('GET /api/usage can aggregate all sessions', async () => {
  const rootDir = await createTestRoot();
  const app = createApp({
    rootDir,
    providerClient: createHttpEchoProviderClient()
  });
  await saveHttpProvider(app);
  await request(app, {
    method: 'POST',
    url: '/api/chat',
    headers: { 'content-type': 'application/json' },
    body: { sessionId: 'main', content: '主线' }
  });
  await request(app, {
    method: 'POST',
    url: '/api/sessions',
    headers: { 'content-type': 'application/json' },
    body: { id: 'side_story', title: '支线' }
  });
  await request(app, {
    method: 'POST',
    url: '/api/chat',
    headers: { 'content-type': 'application/json' },
    body: { sessionId: 'side_story', content: '支线' }
  });

  const response = await request(app, { url: '/api/usage?scope=all' });
  const payload = response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.usage.scope, 'all');
  assert.equal(payload.usage.totals.calls, 2);
  assert.deepEqual(new Set(payload.usage.recent.map((row) => row.sessionId)), new Set(['main', 'side_story']));
});

test('PUT /api/providers saves provider and GET /api/state masks apiKey and sensitive headers', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  const providerConfig = {
    activeProviderId: 'local',
    providers: [{
      id: 'local',
      kind: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'secret',
      model: 'model-a',
      temperature: 0.8,
      maxTokens: 1024,
      headers: {
        Authorization: 'Bearer secret-token',
        'x-api-key': 'header-secret',
        'x-auth-token': 'auth-secret',
        'x-request-id': 'visible-request'
      }
    }]
  };

  const saveResponse = await request(app, {
    method: 'PUT',
    url: '/api/providers',
    headers: { 'content-type': 'application/json' },
    body: providerConfig
  });
  assert.equal(saveResponse.status, 200);

  const stateResponse = await request(app, { url: '/api/state' });
  const payload = stateResponse.json();

  assert.equal(payload.config.providers.activeProviderId, 'local');
  assert.equal(payload.config.providers.providers[0].apiKey, '********');
  assert.equal(payload.config.providers.providers[0].headers.Authorization, '********');
  assert.equal(payload.config.providers.providers[0].headers['x-api-key'], '********');
  assert.equal(payload.config.providers.providers[0].headers['x-auth-token'], '********');
  assert.equal(payload.config.providers.providers[0].headers['x-request-id'], 'visible-request');
  assert.equal(payload.config.providers.providers[0].model, 'model-a');
});

test('PUT /api/providers preserves real apiKey and sensitive headers when saving masked provider config', async () => {
  const rootDir = await createTestRoot();
  const app = createApp({ rootDir });
  const providerConfig = {
    activeProviderId: 'local',
    providers: [{
      id: 'local',
      kind: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'secret',
      model: 'model-a',
      temperature: 0.8,
      maxTokens: 1024,
      headers: {
        Authorization: 'Bearer secret-token',
        'x-api-key': 'header-secret',
        'x-request-id': 'visible-request'
      }
    }]
  };

  await request(app, {
    method: 'PUT',
    url: '/api/providers',
    headers: { 'content-type': 'application/json' },
    body: providerConfig
  });
  const stateResponse = await request(app, { url: '/api/state' });
  const maskedConfig = stateResponse.json().config.providers;
  maskedConfig.providers[0].model = 'model-b';
  maskedConfig.providers[0].headers['x-request-id'] = 'next-request';

  const saveMaskedResponse = await request(app, {
    method: 'PUT',
    url: '/api/providers',
    headers: { 'content-type': 'application/json' },
    body: maskedConfig
  });
  const nextState = (await request(app, { url: '/api/state' })).json();
  const savedProviderConfig = JSON.parse(
    await readFile(path.join(rootDir, 'data', 'config', 'providers.local.json'), 'utf8')
  );

  assert.equal(saveMaskedResponse.status, 200);
  assert.equal(nextState.config.providers.providers[0].apiKey, '********');
  assert.equal(nextState.config.providers.providers[0].model, 'model-b');
  assert.equal(nextState.config.providers.providers[0].headers.Authorization, '********');
  assert.equal(nextState.config.providers.providers[0].headers['x-api-key'], '********');
  assert.equal(nextState.config.providers.providers[0].headers['x-request-id'], 'next-request');
  assert.equal(savedProviderConfig.providers[0].apiKey, 'secret');
  assert.equal(savedProviderConfig.providers[0].model, 'model-b');
  assert.equal(savedProviderConfig.providers[0].headers.Authorization, 'Bearer secret-token');
  assert.equal(savedProviderConfig.providers[0].headers['x-api-key'], 'header-secret');
  assert.equal(savedProviderConfig.providers[0].headers['x-request-id'], 'next-request');
});

test('PUT /api/providers normalizes non-object headers to empty object', async () => {
  const rootDir = await createTestRoot();
  const app = createApp({ rootDir });

  const response = await request(app, {
    method: 'PUT',
    url: '/api/providers',
    headers: { 'content-type': 'application/json' },
    body: {
      activeProviderId: 'local',
      providers: [{
        id: 'local',
        kind: 'openai-compatible',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'secret',
        model: 'model-a',
        temperature: 0.8,
        maxTokens: 1024,
        headers: ['x-api-key', 'secret']
      }]
    }
  });
  const savedProviderConfig = JSON.parse(
    await readFile(path.join(rootDir, 'data', 'config', 'providers.local.json'), 'utf8')
  );

  assert.equal(response.status, 200);
  assert.deepEqual(savedProviderConfig.providers[0].headers, {});
});

test('GET /api/health returns ok', async () => {
  const rootDir = await createTestRoot();
  await migrateData({ rootDir });
  const app = createApp({ rootDir });

  const response = await request(app, { url: '/api/health' });
  const payload = response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(payload, {
    ok: true,
    app: 'local-roleplay-agent',
    version: APP_VERSION,
    releaseChannel: RELEASE_CHANNEL,
    dataSchemaVersion: 3,
    targetDataSchemaVersion: 3
  });
});

test('POST /api/providers/test verifies masked saved credentials without changing config', async () => {
  const rootDir = await createTestRoot();
  let testedProvider;
  const app = createApp({
    rootDir,
    providerClient: {
      complete: async ({ provider }) => {
        testedProvider = provider;
        return { content: 'OK' };
      }
    }
  });
  await saveHttpProvider(app);
  const state = (await request(app, { url: '/api/state' })).json();
  const provider = state.config.providers.providers[0];

  const response = await request(app, {
    method: 'POST',
    url: '/api/providers/test',
    headers: { 'content-type': 'application/json' },
    body: { provider }
  });
  const saved = JSON.parse(await readFile(path.join(rootDir, 'data', 'config', 'providers.local.json'), 'utf8'));

  assert.equal(response.status, 200);
  assert.equal(response.json().result.ok, true);
  assert.equal(response.json().result.responsePreview, 'OK');
  assert.equal(testedProvider.apiKey, 'secret');
  assert.equal(testedProvider.maxTokens >= 128, true);
  assert.equal(testedProvider.maxTokens <= 256, true);
  assert.equal(saved.providers[0].apiKey, 'secret');
});

test('POST /api/providers/test redacts the API key from connection errors', async () => {
  const app = createApp({
    rootDir: await createTestRoot(),
    providerClient: {
      complete: async ({ provider }) => {
        throw new Error(`upstream rejected ${provider.apiKey}`);
      }
    }
  });

  const response = await request(app, {
    method: 'POST',
    url: '/api/providers/test',
    headers: { 'content-type': 'application/json' },
    body: {
      provider: {
        id: 'test',
        kind: 'openai-compatible',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'top-secret-key',
        model: 'model-a'
      }
    }
  });

  assert.equal(response.status, 502);
  assert.equal(response.json().error, 'PROVIDER_TEST_FAILED');
  assert.doesNotMatch(response.text, /top-secret-key/);
  assert.match(response.json().detail, /\*{8}/);
});

test('unknown API route returns JSON 404', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, { url: '/api/missing' });
  const payload = response.json();

  assert.equal(response.status, 404);
  assert.deepEqual(payload, { error: 'NOT_FOUND' });
});

test('invalid JSON body returns INVALID_JSON', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'PUT',
    url: '/api/providers',
    headers: { 'content-type': 'application/json' },
    body: '{not-json'
  });
  const payload = response.json();

  assert.equal(response.status, 400);
  assert.deepEqual(payload, { error: 'INVALID_JSON' });
});

test('mutating API route rejects unsupported media type', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'PUT',
    url: '/api/providers',
    headers: { 'content-type': 'text/plain' },
    body: '{}'
  });
  const payload = response.json();

  assert.equal(response.status, 415);
  assert.deepEqual(payload, { error: 'UNSUPPORTED_MEDIA_TYPE' });
});

test('mutating API route rejects forbidden origin', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'PUT',
    url: '/api/providers',
    headers: {
      'content-type': 'application/json',
      origin: 'https://evil.example'
    },
    body: {}
  });
  const payload = response.json();

  assert.equal(response.status, 403);
  assert.deepEqual(payload, { error: 'FORBIDDEN_ORIGIN' });
});

test('MCP connect and disconnect routes reject forbidden origin', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const connectResponse = await request(app, {
    method: 'POST',
    url: '/api/mcp/servers/filesystem/connect',
    headers: {
      origin: 'https://evil.example',
      'content-type': 'application/json'
    },
    body: {}
  });
  const disconnectResponse = await request(app, {
    method: 'POST',
    url: '/api/mcp/servers/filesystem/disconnect',
    headers: {
      origin: 'https://evil.example',
      'content-type': 'application/json'
    },
    body: {}
  });

  assert.equal(connectResponse.status, 403);
  assert.deepEqual(connectResponse.json(), { error: 'FORBIDDEN_ORIGIN' });
  assert.equal(disconnectResponse.status, 403);
  assert.deepEqual(disconnectResponse.json(), { error: 'FORBIDDEN_ORIGIN' });
});

test('PUT /api/prompt-modules rejects non-array payload', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'PUT',
    url: '/api/prompt-modules',
    headers: { 'content-type': 'application/json' },
    body: { promptModules: { id: 'not-an-array' } }
  });
  const payload = response.json();

  assert.equal(response.status, 400);
  assert.deepEqual(payload, { error: 'INVALID_PROMPT_MODULES' });
});

test('PUT /api/world-book rejects non-array payload', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'PUT',
    url: '/api/world-book',
    headers: { 'content-type': 'application/json' },
    body: { worldBook: 'not-an-array' }
  });
  const payload = response.json();

  assert.equal(response.status, 400);
  assert.deepEqual(payload, { error: 'INVALID_WORLD_BOOK' });
});

test('PUT /api/persona rejects non-object payload', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'PUT',
    url: '/api/persona',
    headers: { 'content-type': 'application/json' },
    body: { persona: ['not-an-object'] }
  });

  assert.equal(response.status, 400);
  assert.deepEqual(response.json(), { error: 'INVALID_PERSONA' });
});

test('PUT /api/group-members rejects non-array payload', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'PUT',
    url: '/api/group-members',
    headers: { 'content-type': 'application/json' },
    body: { groupMembers: { name: 'not-an-array' } }
  });

  assert.equal(response.status, 400);
  assert.deepEqual(response.json(), { error: 'INVALID_GROUP_MEMBERS' });
});

test('PUT /api/group-members updates only the selected story session', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  const createResponse = await request(app, {
    method: 'POST',
    url: '/api/sessions',
    headers: { 'content-type': 'application/json' },
    body: { id: 'group_target', title: '群聊目标会话', packId: 'lingyi' }
  });
  const response = await request(app, {
    method: 'PUT',
    url: '/api/group-members',
    headers: { 'content-type': 'application/json' },
    body: {
      sessionId: 'group_target',
      groupMembers: [{ id: 'local-member', name: '本剧本成员', enabled: true }]
    }
  });
  const targetState = (await request(app, { url: '/api/state?sessionId=group_target' })).json();
  const mainState = (await request(app, { url: '/api/state?sessionId=main' })).json();

  assert.equal(createResponse.status, 200);
  assert.equal(response.status, 200);
  assert.equal(targetState.config.groupMembers[0].name, '本剧本成员');
  assert.equal(targetState.session.config.groupMembers[0].name, '本剧本成员');
  assert.equal(mainState.config.groupMembers.some((item) => item.name === '本剧本成员'), false);
});

test('POST /api/chat without active provider returns NO_ACTIVE_PROVIDER', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'POST',
    url: '/api/chat',
    headers: { 'content-type': 'application/json' },
    body: { content: '有人吗？' }
  });
  const payload = response.json();

  assert.equal(response.status, 409);
  assert.deepEqual(payload, { error: 'NO_ACTIVE_PROVIDER' });
});

test('POST /api/chat maps provider failure to PROVIDER_ERROR', async () => {
  const rootDir = await createTestRoot();
  const app = createApp({
    rootDir,
    providerClient: {
      complete: async () => {
        throw new Error('provider down');
      }
    }
  });

  await request(app, {
    method: 'PUT',
    url: '/api/providers',
    headers: { 'content-type': 'application/json' },
    body: {
      activeProviderId: 'local',
      providers: [{
        id: 'local',
        kind: 'openai-compatible',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'secret',
        model: 'model-a',
        temperature: 0.8,
        maxTokens: 1024,
        headers: {}
      }]
    }
  });

  const response = await request(app, {
    method: 'POST',
    url: '/api/chat',
    headers: { 'content-type': 'application/json' },
    body: { content: '推门进去。' }
  });
  const payload = response.json();

  assert.equal(response.status, 502);
  assert.deepEqual(payload, { error: 'PROVIDER_ERROR' });
});

test('POST /api/chat/stream returns SSE chunks and persists the turn', async () => {
  const rootDir = await createTestRoot();
  const app = createApp({
    rootDir,
    providerClient: {
      complete: async ({ messages }) => ({
        content: `流式回应：${messages.at(-1).content}`,
        raw: { fake: true }
      })
    }
  });
  await saveHttpProvider(app);

  const response = await request(app, {
    method: 'POST',
    url: '/api/chat/stream',
    headers: { 'content-type': 'application/json' },
    body: { content: '我拔刀。' }
  });
  const state = (await request(app, { url: '/api/state' })).json();

  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /^text\/event-stream/);
  assert.match(response.text, /event: token/);
  assert.match(response.text, /流式回应/);
  assert.match(response.text, /event: phase/);
  assert.match(response.text, /"phase":"finalizing"/);
  assert.match(response.text, /event: turn/);
  assert.match(response.text, /lra\.turn-view-snapshot\/v1/);
  assert.match(response.text, /event: done/);
  assert.equal(state.session.messages.length, 2);
  assert.equal(state.session.messages[1].content, '流式回应：我拔刀。');
});

test('POST /api/chat/stream reports reasoning-only output without saving an empty turn', async () => {
  const rootDir = await createTestRoot();
  const app = createApp({
    rootDir,
    providerClient: {
      stream: async () => {
        throw new Error('PROVIDER_REASONING_ONLY_RESPONSE:length');
      }
    }
  });
  await saveHttpProvider(app);

  const response = await request(app, {
    method: 'POST',
    url: '/api/chat/stream',
    headers: { 'content-type': 'application/json' },
    body: { content: '请生成开场。' }
  });
  const state = (await request(app, { url: '/api/state' })).json();

  assert.equal(response.status, 200);
  assert.match(response.text, /event: error/);
  assert.match(response.text, /PROVIDER_REASONING_ONLY_RESPONSE/);
  assert.equal(state.session.messages.length, 0);
});

test('POST /api/chat/stream retains an aborted partial turn and reports partialMessageId via SSE error', async () => {
  const rootDir = await createTestRoot();
  const app = createApp({
    rootDir,
    providerClient: {
      stream: async ({ onToken }) => {
        await onToken('夜色沉沉，更夫的梆子声由远及近');
        await onToken('，沈观澜在檐下按住了剑鞘。');
        const abortError = new Error('This operation was aborted');
        abortError.name = 'AbortError';
        throw abortError;
      }
    }
  });
  await saveHttpProvider(app);

  const response = await request(app, {
    method: 'POST',
    url: '/api/chat/stream',
    headers: { 'content-type': 'application/json' },
    body: { content: '夜探沈府。' }
  });
  const state = (await request(app, { url: '/api/state' })).json();

  assert.equal(response.status, 200);
  assert.match(response.text, /event: error/);
  assert.match(response.text, /GENERATION_ABORTED/);
  assert.match(response.text, /"aborted":true/);
  assert.match(response.text, /"partialMessageId":"assistant-/);
  // 服务端已留存 partial 回合：user + aborted assistant
  assert.equal(state.session.messages.length, 2);
  assert.equal(state.session.messages[1].aborted, true);
  assert.equal(state.session.messages[1].content, '夜色沉沉，更夫的梆子声由远及近，沈观澜在檐下按住了剑鞘。');
});

test('POST /api/chat/stream reports exhausted provider quota without saving the opening turn', async () => {
  const rootDir = await createTestRoot();
  const app = createApp({
    rootDir,
    providerClient: {
      stream: async () => {
        throw new Error('Provider error 403: insufficient_user_quota, 剩余额度: $0.000000');
      }
    }
  });
  await saveHttpProvider(app);

  const response = await request(app, {
    method: 'POST',
    url: '/api/chat/stream',
    headers: { 'content-type': 'application/json' },
    body: { content: '请生成开场。' }
  });
  const state = (await request(app, { url: '/api/state' })).json();

  assert.equal(response.status, 200);
  assert.match(response.text, /PROVIDER_QUOTA_EXHAUSTED/);
  assert.equal(state.session.messages.length, 0);
});

test('PATCH /api/messages/:messageId edits a user message and trims later history', async () => {
  const rootDir = await createTestRoot();
  const app = createApp({ rootDir, providerClient: createHttpEchoProviderClient() });
  await saveHttpProvider(app);

  const firstTurn = await request(app, {
    method: 'POST',
    url: '/api/chat',
    headers: { 'content-type': 'application/json' },
    body: { content: '我去镇武司。' }
  });
  await request(app, {
    method: 'POST',
    url: '/api/chat',
    headers: { 'content-type': 'application/json' },
    body: { content: '我继续前进。' }
  });
  const userId = firstTurn.json().session.messages[0].id;

  const response = await request(app, {
    method: 'PATCH',
    url: `/api/messages/${userId}`,
    headers: { 'content-type': 'application/json' },
    body: { sessionId: 'main', content: '我改去听雨楼。' }
  });
  const payload = response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.session.messages.length, 2);
  assert.equal(payload.session.messages[0].content, '我改去听雨楼。');
  assert.match(payload.session.messages[1].content, /回应：我改去听雨楼。/);
});

test('POST /api/messages/:messageId/regenerate stores assistant swipes', async () => {
  const rootDir = await createTestRoot();
  let turn = 0;
  const app = createApp({
    rootDir,
    providerClient: {
      complete: async ({ messages }) => {
        turn += 1;
        return { content: `第${turn}版回应：${messages.at(-1).content}`, raw: { fake: true } };
      }
    }
  });
  await saveHttpProvider(app);

  const firstTurn = await request(app, {
    method: 'POST',
    url: '/api/chat',
    headers: { 'content-type': 'application/json' },
    body: { content: '我推门进去。' }
  });
  const assistantId = firstTurn.json().reply.id;

  const response = await request(app, {
    method: 'POST',
    url: `/api/messages/${assistantId}/regenerate`,
    headers: { 'content-type': 'application/json' },
    body: { sessionId: 'main' }
  });
  const assistant = response.json().session.messages[1];

  assert.equal(response.status, 200);
  assert.equal(assistant.activeSwipeIndex, 1);
  assert.deepEqual(assistant.swipes, ['第1版回应：我推门进去。', '第2版回应：我推门进去。']);
});

test('PUT /api/memory/facts saves normalized memory facts', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'PUT',
    url: '/api/memory/facts',
    headers: { 'content-type': 'application/json' },
    body: {
      sessionId: 'main',
      facts: [{
        title: '名刀雪照',
        content: '沈观澜持有名刀雪照。',
        keywords: ['雪照'],
        type: 'item',
        enabled: false
      }]
    }
  });
  const payload = response.json();
  const state = (await request(app, { url: '/api/state' })).json();

  assert.equal(response.status, 200);
  assert.equal(payload.facts.length, 1);
  assert.equal(payload.facts[0].title, '名刀雪照');
  assert.equal(payload.facts[0].enabled, false);
  assert.equal(state.session.memory.memoryCards[0].content, '沈观澜持有名刀雪照。');
});

test('core memory and V3 character-card export are available from the active session', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  const headers = { 'content-type': 'application/json' };

  const savedCard = await request(app, {
    method: 'PUT',
    url: '/api/character-card',
    headers,
    body: {
      sessionId: 'main',
      characterCard: {
        name: '沈观澜',
        description: '谨慎的杂役弟子',
        sourceSpec: 'chara_card_v3'
      }
    }
  });
  assert.equal(savedCard.status, 200);

  const savedMemory = await request(app, {
    method: 'PUT',
    url: '/api/memory/core',
    headers,
    body: {
      sessionId: 'main',
      coreMemory: {
        personaView: '先隐忍观察，再作出选择',
        activeCommitments: ['查明石板下的秘密'],
        coreDirectives: ['不违背已确认的世界事实']
      }
    }
  });
  assert.equal(savedMemory.status, 200);
  assert.equal(savedMemory.json().coreMemory.personaView, '先隐忍观察，再作出选择');

  const exported = await request(app, { url: '/api/character-card/export-v3?sessionId=main' });
  assert.equal(exported.status, 200);
  assert.equal(exported.json().characterCard.spec, 'chara_card_v3');
  assert.equal(exported.json().characterCard.data.name, '沈观澜');
  assert.deepEqual(
    exported.json().characterCard.data.extensions.local_roleplay_agent.coreMemory.activeCommitments,
    ['查明石板下的秘密']
  );
});

test('PUT /api/memory/facts rejects non-array facts', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'PUT',
    url: '/api/memory/facts',
    headers: { 'content-type': 'application/json' },
    body: { sessionId: 'main', facts: { content: 'not-array' } }
  });

  assert.equal(response.status, 400);
  assert.deepEqual(response.json(), { error: 'INVALID_MEMORY_FACTS' });
});

test('PUT /api/memory/facts rejects invalid session id', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'PUT',
    url: '/api/memory/facts',
    headers: { 'content-type': 'application/json' },
    body: { sessionId: '../bad', facts: [] }
  });

  assert.equal(response.status, 400);
  assert.deepEqual(response.json(), { error: 'INVALID_SESSION_ID' });
});

test('POST /api/memory/facts/:factId/promote creates one world book entry', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  await request(app, {
    method: 'PUT',
    url: '/api/memory/facts',
    headers: { 'content-type': 'application/json' },
    body: {
      sessionId: 'main',
      facts: [{ id: 'fact-sword', title: '名刀雪照', content: '沈观澜持有名刀雪照。', keywords: ['雪照'] }]
    }
  });

  const first = await request(app, {
    method: 'POST',
    url: '/api/memory/facts/fact-sword/promote',
    headers: { 'content-type': 'application/json' },
    body: { sessionId: 'main' }
  });
  const second = await request(app, {
    method: 'POST',
    url: '/api/memory/facts/fact-sword/promote',
    headers: { 'content-type': 'application/json' },
    body: { sessionId: 'main' }
  });
  const worldBook = second.json().worldBook.filter((entry) => entry.source === 'fact-management');

  assert.equal(first.status, 200);
  assert.equal(worldBook.length, 1);
  assert.equal(worldBook[0].title, '名刀雪照');
  assert.equal(worldBook[0].extensions.sourceFactId, 'fact-sword');
});

test('POST /api/memory/facts/:factId/promote rejects missing fact', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'POST',
    url: '/api/memory/facts/missing/promote',
    headers: { 'content-type': 'application/json' },
    body: { sessionId: 'main' }
  });

  assert.equal(response.status, 404);
  assert.deepEqual(response.json(), { error: 'MEMORY_FACT_NOT_FOUND' });
});

test('POST /api/memory/facts/:factId/promote rejects invalid session id', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'POST',
    url: '/api/memory/facts/fact-sword/promote',
    headers: { 'content-type': 'application/json' },
    body: { sessionId: '../bad' }
  });

  assert.equal(response.status, 400);
  assert.deepEqual(response.json(), { error: 'INVALID_SESSION_ID' });
});

test('static / returns the HTML page', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, { url: '/' });

  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /^text\/html/);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.match(response.text, /角色剧场/);
});

test('GET /api/proxy-image rejects forbidden origin', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    url: '/api/proxy-image?url=https://example.com/image.png',
    headers: { origin: 'https://evil.example' }
  });

  assert.equal(response.status, 403);
  assert.deepEqual(response.json(), { error: 'FORBIDDEN_ORIGIN' });
});

test('GET /api/proxy-image rejects non-https protocols', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, { url: '/api/proxy-image?url=http://example.com/image.png' });

  assert.equal(response.status, 400);
  assert.deepEqual(response.json(), { error: 'INVALID_URL' });
});

test('GET /api/proxy-image rejects private network addresses', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const targets = [
    'https://127.0.0.1/image.png',
    'https://localhost/image.png',
    'https://169.254.169.254/latest/meta-data/',
    'https://10.0.0.1/image.png',
    'https://192.168.1.1/image.png'
  ];
  for (const target of targets) {
    const response = await request(app, { url: `/api/proxy-image?url=${encodeURIComponent(target)}` });
    assert.equal(response.status, 400, `${target} should be blocked`);
    assert.deepEqual(response.json(), { error: 'INVALID_URL' });
  }
});

test('GET /api/proxy-image rejects malformed url', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, { url: '/api/proxy-image?url=not-a-url' });

  assert.equal(response.status, 400);
  assert.deepEqual(response.json(), { error: 'INVALID_URL' });
});

test('static PNG assets return image/png content type', async () => {
  const rootDir = await createTestRoot();
  await mkdir(path.join(rootDir, 'public', 'assets'), { recursive: true });
  await writeFile(path.join(rootDir, 'public', 'assets', 'wuxia-stage.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const app = createApp({ rootDir });

  const response = await request(app, { url: '/assets/wuxia-stage.png' });

  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /^image\/png/);
  assert.equal(response.headers['cache-control'], 'public, max-age=86400');
});

test('world simulation APIs keep private NPC state out of the public projection', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  const saved = await request(app, {
    method: 'PUT',
    url: '/api/sessions/main/simulation/actors',
    headers: { 'content-type': 'application/json' },
    body: {
      actors: [{
        id: 'luo-qing',
        name: '洛青',
        role: '巡夜人',
        location: '南门',
        publicKnowledge: ['城中正在宵禁'],
        privateKnowledge: ['密令来自内廷'],
        schedule: [{ at: '09:00', location: '旧档房', activity: '暗查卷宗', visibility: 'private' }],
        agenda: [{ title: '找出泄密者', visibility: 'private' }]
      }]
    }
  });
  const director = (await request(app, { url: '/api/sessions/main/simulation?view=director' })).json().snapshot;
  const publicView = (await request(app, { url: '/api/sessions/main/simulation?view=public' })).json().snapshot;

  assert.equal(saved.status, 200);
  assert.deepEqual(director.simulation.actors[0].privateKnowledge, ['密令来自内廷']);
  assert.equal(director.simulation.actors[0].schedule.length, 1);
  assert.equal(Object.hasOwn(publicView.simulation.actors[0], 'privateKnowledge'), false);
  assert.equal(publicView.simulation.actors[0].schedule.length, 0);
  assert.equal(publicView.simulation.actors[0].agenda.length, 0);
});

test('legacy content-pack sessions lazily restore their NPC roster', async () => {
  const rootDir = await createTestRoot();
  const app = createApp({ rootDir });
  await request(app, {
    method: 'POST',
    url: '/api/content-packs/lingyi/apply',
    headers: { 'content-type': 'application/json' },
    body: { sessionId: 'main' }
  });
  const sessionFile = path.join(rootDir, 'data', 'sessions', 'main.json');
  const legacySession = JSON.parse(await readFile(sessionFile, 'utf8'));
  delete legacySession.config.contentPackId;
  delete legacySession.config.characterPresets;
  legacySession.memory.simulation.actors = [];
  legacySession.memory.simulation.revision = 0;
  delete legacySession.memory.simulation.settings.rosterInitialized;
  await writeFile(sessionFile, `${JSON.stringify(legacySession, null, 2)}\n`, 'utf8');

  const response = await request(app, { url: '/api/sessions/main/simulation?view=director' });
  const payload = response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.snapshot.simulation.actors.length >= 4, true);
  assert.ok(payload.snapshot.simulation.actors.find((actor) => actor.name === '唐月'));
  assert.ok(payload.snapshot.simulation.actors.find((actor) => actor.name === '张婆婆'));
});

test('action preview is dry-run while commit and clock advance append durable ledger events', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  await request(app, {
    method: 'PUT',
    url: '/api/sessions/main/simulation/actors',
    headers: { 'content-type': 'application/json' },
    body: {
      actors: [{
        id: 'luo-qing',
        name: '洛青',
        schedule: [{ at: '09:00', location: '旧档房', activity: '暗查卷宗', visibility: 'private' }]
      }]
    }
  });

  const action = {
    actorId: 'creator',
    summary: '把密信交给主角',
    actions: [{ type: 'state.append', path: 'protagonist.inventory', value: '密信' }]
  };
  const preview = await request(app, {
    method: 'POST',
    url: '/api/sessions/main/actions/preview',
    headers: { 'content-type': 'application/json' },
    body: { envelope: action }
  });
  const afterPreview = (await request(app, { url: '/api/sessions/main/simulation' })).json().snapshot;
  const committed = await request(app, {
    method: 'POST',
    url: '/api/sessions/main/actions/commit',
    headers: { 'content-type': 'application/json' },
    body: { envelope: action }
  });
  const ledgerAfterCommit = (await request(app, { url: '/api/sessions/main/events?view=director' })).json();
  const advanced = await request(app, {
    method: 'POST',
    url: '/api/sessions/main/simulation/advance',
    headers: { 'content-type': 'application/json' },
    body: { minutes: 60, reason: '测试推进' }
  });
  const ledger = (await request(app, { url: '/api/sessions/main/events?view=director' })).json();
  assert.equal(preview.status, 200);
  assert.deepEqual(preview.json().snapshot.worldState.protagonist.inventory, ['密信']);
  assert.deepEqual(afterPreview.worldState.protagonist.inventory, []);
  assert.equal(committed.status, 200);
  assert.ok(ledgerAfterCommit.events.some((event) => event.kind === 'manual-action'));
  assert.deepEqual(committed.json().snapshot.worldState.protagonist.inventory, ['密信']);
  assert.equal(advanced.status, 200);
  assert.equal(advanced.json().snapshot.simulation.clock.label, '第1日 09:00');
  assert.equal(advanced.json().snapshot.simulation.actors[0].location, '旧档房');
  assert.ok(ledger.events.some((event) => event.kind === 'manual-action'));
  assert.ok(ledger.events.some((event) => event.kind === 'simulation-tick'));
});

test('simulation action routes reject malformed action envelopes', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  const response = await request(app, {
    method: 'POST',
    url: '/api/sessions/main/actions/commit',
    headers: { 'content-type': 'application/json' },
    body: { envelope: { actions: [] } }
  });

  assert.equal(response.status, 400);
  assert.equal(response.json().error, 'ACTION_LIST_EMPTY');
});

test('static path traversal attempt returns non-200 and does not expose files', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, { url: '/%2e%2e/secret.txt' });

  assert.notEqual(response.status, 200);
  assert.doesNotMatch(response.text, /do-not-expose/);
});

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
      responseHeaders = normalizeHeaders(writtenHeaders);
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

function normalizeHeaders(headers) {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
}

async function createTestRoot() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'agent-http-'));
  await mkdir(path.join(rootDir, 'public'), { recursive: true });
  await writeFile(
    path.join(rootDir, 'public', 'index.html'),
    '<!doctype html><html><body><h1>角色剧场</h1></body></html>',
    'utf8'
  );
  await writeFile(path.join(rootDir, 'secret.txt'), 'do-not-expose', 'utf8');
  return rootDir;
}

async function saveHttpProvider(app) {
  await request(app, {
    method: 'PUT',
    url: '/api/providers',
    headers: { 'content-type': 'application/json' },
    body: {
      activeProviderId: 'local',
      providers: [{
        id: 'local',
        kind: 'openai-compatible',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'secret',
        model: 'model-a',
        temperature: 0.8,
        maxTokens: 1024,
        headers: {}
      }]
    }
  });
}

function createHttpEchoProviderClient() {
  return {
    complete: async ({ messages }) => ({
      content: `回应：${messages.at(-1).content}`,
      raw: { fake: true }
    })
  };
}

function createV2CardPayload() {
  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: '沈观澜',
      description: '初入江湖的刀客。',
      personality: '沉稳。',
      scenario: '旧案开局。',
      first_mes: '夜雨打在刀鞘上。',
      mes_example: '',
      creator_notes: '',
      system_prompt: '',
      post_history_instructions: '',
      alternate_greetings: [],
      tags: ['武侠'],
      creator: 'liufeng',
      character_version: '1.0.0',
      extensions: {},
      character_book: {
        scan_depth: 5,
        extensions: {},
        entries: [{
          name: '镇武司暗线',
          keys: ['镇武司'],
          content: '镇武司旧案背后另有朝堂暗线。',
          enabled: true,
          insertion_order: 1,
          extensions: {}
        }]
      }
    }
  };
}

function createContentPackBundlePayload() {
  return {
    spec: 'lra.content-pack/v1',
    manifest: {
      spec: 'lra.content-pack/v1',
      id: 'community.rain-night',
      version: '1.1.0',
      title: '听雨仙途',
      description: '雨夜旧案与仙门因果。',
      engine: '>=0.2.2 <2.0.0',
      dependencies: [{ kind: 'plugin', id: 'core.character-card-v2', range: '^1.0.0', scope: 'runtime' }],
      capabilities: ['character', 'worldbook', 'prompt', 'rule-system']
    },
    content: {
      sessionTitle: '听雨楼夜话',
      visualPackId: 'xianxia',
      characterCard: { name: '沈观澜', description: '负刀问道。' },
      worldBook: [{ id: 'rain-lore', title: '听雨楼', keywords: ['听雨楼'], content: '听雨楼不问来路。', enabled: true }],
      promptModules: [{ id: 'rain-prompt', title: '雨夜文风', content: '克制叙事。', enabled: true }],
      memory: { memoryCards: [], worldState: { flags: { genre: 'xianxia' } } },
      ruleSystem: { id: 'rain-rules', title: '听雨规则', boundary: '仙侠悬案', panels: [] },
      characterPresets: []
    }
  };
}

function createPngWithTextChunk(keyword, text) {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    createChunk('tEXt', Buffer.from(`${keyword}\0${text}`, 'latin1')),
    createChunk('IEND', Buffer.alloc(0))
  ]);
}

function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  return Buffer.concat([
    length,
    Buffer.from(type, 'ascii'),
    data,
    Buffer.alloc(4)
  ]);
}


test('comparison preview freezes one session, reports both modes and never persists preview settings', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  const before = (await request(app, { url: '/api/state' })).json().session;
  const response = await request(app, { method: 'POST', url: '/api/sessions/main/prompt-preview', headers: { 'content-type': 'application/json' }, body: { content: '原地等待', compareModes: true } });
  assert.equal(response.status, 200);
  const bundle = response.json().comparison;
  assert.deepEqual(bundle.variants.map(v => v.mode), ['faithful', 'enhanced']);
  assert.ok(bundle.variants.every(v => v.status === 'ready' || v.status === 'blocked'));
  assert.equal(bundle.evaluation.status, 'not-run');
  assert.equal(bundle.reference.messages, null);
  const after = (await request(app, { url: '/api/state' })).json().session;
  assert.deepEqual(after.settings, before.settings);
  assert.deepEqual(after.messages, before.messages);
});

test('independent enhancements survive settings normalization and readback', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  const agentEnhancements = { memoryRecall: false, npcSimulation: false, plotGuidance: false, actionSuggestions: true };
  const response = await request(app, { method: 'PUT', url: '/api/session/settings', headers: { 'content-type': 'application/json' }, body: { sessionId: 'main', settings: { agentEnhancements } } });
  assert.equal(response.status, 200);
  const after = (await request(app, { url: '/api/state' })).json().session;
  assert.deepEqual(after.settings.agentEnhancements, agentEnhancements);
});

test('history repair API previews, creates an isolated readable copy and rejects a stale source', async () => {
  const rootDir = await createTestRoot();
  const app = createApp({ rootDir });
  const source = { id: 'repair-source', title: '原稿', settings: { maxPromptTokens: 8000 }, memory: {}, messages: [{ id: 'u', role: 'user', content: '我问路。' }, { id: 'a', role: 'assistant', content: '你站在桥边。“你找谁？”她问。' }] };
  await mkdir(path.join(rootDir, 'data/sessions'), { recursive: true });
  const sourcePath = path.join(rootDir, 'data/sessions/repair-source.json');
  await writeFile(sourcePath, JSON.stringify(source));
  const post = (action, body) => request(app, { method: 'POST', url: `/api/sessions/repair-source/history-repair/${action}`, headers: { 'content-type': 'application/json' }, body });
  const preview = await post('preview', { playerName: '刘一' });
  assert.equal(preview.status, 200);
  const plan = preview.json().plan;
  assert.equal(plan.changes[0].after, '刘一站在桥边。“你找谁？”她问。');
  const applied = await post('apply', { playerName: plan.playerName, sourceHash: plan.sourceHash });
  assert.equal(applied.status, 200);
  const id = applied.json().copy.id;
  const copy = JSON.parse(await readFile(path.join(rootDir, `data/sessions/${id}.json`), 'utf8'));
  assert.equal(copy.messages[1].content, plan.changes[0].after);
  assert.deepEqual(JSON.parse(await readFile(sourcePath, 'utf8')), source);
  const readable = await request(app, { url: `/api/state?sessionId=${id}` });
  assert.equal(readable.json().session.id, id);
  await writeFile(sourcePath, JSON.stringify({ ...source, title: '已改变' }));
  assert.equal((await post('apply', { playerName: plan.playerName, sourceHash: plan.sourceHash })).status, 409);
  app.close?.();
});

test('prompt budget failures preserve actionable details over HTTP and SSE without calling provider', async () => {
  const rootDir = await createTestRoot(); let calls = 0;
  const app = createApp({ rootDir, providerClient: { complete: async () => { calls++; throw new Error('must not call'); }, completeStream: async () => { calls++; throw new Error('must not call'); } } });
  await saveHttpProvider(app);
  await mkdir(path.join(rootDir, 'data/sessions'), { recursive: true });
  await writeFile(path.join(rootDir, 'data/sessions/budget.json'), JSON.stringify({ id: 'budget', settings: { maxPromptTokens: 1000, promptExecutionMode: 'faithful' }, config: { characterCard: { name: '原卡', description: '长篇设定。'.repeat(5000), sourceSpec: 'chara_card_v3' }, promptModules: [], worldBook: [] }, memory: {}, messages: [] }));
  for (const url of ['/api/chat', '/api/chat/stream']) {
    const response = await request(app, { method: 'POST', url, headers: { 'content-type': 'application/json' }, body: { sessionId: 'budget', content: '开始故事' } });
    if (url.endsWith('/stream')) { assert.match(response.text, /PROMPT_BUDGET_INSUFFICIENT/); assert.match(response.text, /尚未调用 Provider/); }
    else { assert.equal(response.status, 409); assert.equal(response.json().error, 'PROMPT_BUDGET_INSUFFICIENT'); assert.match(response.json().detail, /至少需要约/); }
  }
  assert.equal(calls, 0); app.close?.();
});
