import { createHash } from 'node:crypto';
import { buildHistoryRepairPlan, createHistoryRepairCopy } from '../agent/historyPerspectiveRepair.js';
export class HistoryRepairService {
  constructor(sessionService) { this.sessions = sessionService; }
  async read(id) {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('INVALID_SESSION_ID');
    const session = await this.sessions.store.read(`sessions/${id}.json`, null);
    if (!session) throw new Error('SESSION_NOT_FOUND');
    return session;
  }
  async preview(id, playerName) { return buildHistoryRepairPlan(await this.read(id), playerName); }
  async apply(id, { sourceHash, playerName, maxPromptTokens } = {}) {
    return this.sessions.withWriteLock(id, async () => {
      const source = await this.read(id);
      const plan = buildHistoryRepairPlan(source, playerName);
      if (!sourceHash || sourceHash !== plan.sourceHash) throw new Error('SOURCE_CHANGED');
      // Same reviewed source + options yields the same destination, even after a lost response.
      const copyId = 'repair-' + createHash('sha256').update(JSON.stringify([id, sourceHash, playerName, maxPromptTokens ?? null])).digest('hex').slice(0, 32);
      const copy = createHistoryRepairCopy(source, plan, { id: copyId, maxPromptTokens });
      const destination = `sessions/${copyId}.json`;
      try { await this.sessions.store.createExclusive(destination, copy); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const existing = await this.sessions.store.read(destination, null);
        if (existing?.historyRepair?.sourceHash !== sourceHash || existing?.historyRepair?.sourceId !== id) throw new Error('COPY_CONFLICT');
        return { id: existing.id, title: existing.title, reused: true };
      }
      return { id: copy.id, title: copy.title, reused: false };
    });
  }
}
