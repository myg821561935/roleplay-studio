import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SessionService } from '../server/services/sessionService.js';
import { JsonStore } from '../server/lib/jsonStore.js';
import { BackgroundMaintenance } from '../server/services/backgroundMaintenance.js';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
for (const mutation of ['turn', 'edit', 'settings', 'branch', 'delete', 'recreate', 'none']) {
  test(`background memory cannot overwrite ${mutation} after its snapshot`, async t => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'maintenance-race-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const sessions = new SessionService(new JsonStore(root));
    const session = await sessions.getSession('race');
    await sessions.saveSession(session);
    const started = deferred(), release = deferred();
    const agent = { sessionService: sessions, withSessionLock: (_id, work) => work(), runMemoryMaintenanceIfNeeded: async ({ session: snapshot }) => {
      started.resolve(); await release.promise;
      snapshot.memory.rollingSummary = '背景摘要'; return true;
    } };
    const worker = new BackgroundMaintenance(agent);
    worker.schedule({ session });
    await started.promise;
    assert.notEqual(session.memory.rollingSummary, '背景摘要');
    if (mutation === 'delete' || mutation === 'recreate') await sessions.deleteSession('race');
    if (mutation !== 'none' && mutation !== 'delete') {
      const newer = await sessions.getSession('race');
      newer.title = `新版本:${mutation}`;
      if (mutation === 'turn') newer.messages.push({ id: 'new', role: 'user', content: '新行动' });
      if (mutation === 'settings') newer.settings.maxPromptTokens = 32000;
      if (mutation === 'branch') newer.memory.activeBranchId = 'other';
      await sessions.saveSession(newer);
    }
    release.resolve(); await worker.flush();
    assert.equal(worker.lastError, undefined);
    if (mutation === 'delete') assert.ok(!(await sessions.listSessions()).includes('race'));
    else {
      const result = await sessions.getSession('race');
      if (mutation === 'none') assert.equal(result.memory.rollingSummary, '背景摘要');
      else { assert.equal(result.title, `新版本:${mutation}`); assert.notEqual(result.memory.rollingSummary, '背景摘要'); }
    }
  });
}
