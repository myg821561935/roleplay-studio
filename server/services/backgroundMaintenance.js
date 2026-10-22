// Work on a detached snapshot. SessionService's compare-and-save rejects results
// after another turn, edit, branch switch, settings write, or deletion.
export class BackgroundMaintenance {
  constructor(agent) { this.agent = agent; this.jobs = new Map(); }
  schedule(args) {
    const id = args.session.id;
    const input = { ...args, session: structuredClone(args.session) };
    const existing = this.jobs.get(id);
    if (existing) { existing.next = input; return; }
    const job = { next: input };
    this.jobs.set(id, job);
    job.done = new Promise(resolve => setTimeout(resolve, 0)).then(async () => {
      while (job.next) {
        const current = job.next;
        job.next = null;
        const revision = current.session.storageRevision || '';
        let maintained;
        try { maintained = await this.agent.runMemoryMaintenanceIfNeeded(current); }
        catch (error) {
          current.session.memory.lastSummaryError = String(error.message || error);
          maintained = true;
        }
        if (maintained) {
          await this.agent.withSessionLock(id, () => this.agent.sessionService.saveSessionIfUnchanged(current.session, revision));
        }
      }
    }).catch(error => { job.error = error; this.lastError = String(error.message || error); })
      .finally(() => { if (this.jobs.get(id) === job) this.jobs.delete(id); });
  }
  async flush() { while (this.jobs.size) await Promise.all([...this.jobs.values()].map(j => j.done)); }
}
