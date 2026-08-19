import { summarizeStoryProject } from './storyProjectService.js';

const DELETION_IMPACT_SPEC = 'lra.content-deletion-impact/v1';
const BINDING_HISTORY_SPEC = 'lra.binding-history/v1';
const MAX_BINDING_HISTORY = 20;

export class ContentLifecycleService {
  constructor({
    sessionService,
    storyProjectService,
    resourceLibraryService,
    backupService,
    now = () => new Date()
  } = {}) {
    if (!sessionService) throw new TypeError('sessionService is required');
    if (!storyProjectService) throw new TypeError('storyProjectService is required');
    if (!resourceLibraryService) throw new TypeError('resourceLibraryService is required');
    if (!backupService) throw new TypeError('backupService is required');
    this.sessionService = sessionService;
    this.storyProjectService = storyProjectService;
    this.resourceLibraryService = resourceLibraryService;
    this.backupService = backupService;
    this.now = now;
  }

  async inspectProjectDeletion(projectId) {
    const project = await this.storyProjectService.getProject(projectId);
    if (!project) return null;
    const sessionContext = await this.loadSessionContext();
    const declaredIds = new Set(project.sessionIds || []);
    const sessions = sessionContext.sessions.filter((session) => (
      declaredIds.has(session.id) || String(session.storyProjectId || '').trim() === project.id
    ));
    const foundIds = new Set(sessions.map((session) => session.id));
    const missingSessionIds = [...declaredIds].filter((sessionId) => !foundIds.has(sessionId));
    return createImpact({
      kind: 'story-project',
      target: summarizeProjectTarget(project),
      sessions,
      projects: [],
      missingSessionIds
    });
  }

  async deleteProject(projectId, {
    confirmDetach = false,
    confirmDelete = false,
    deleteSessions = false
  } = {}) {
    const impact = await this.inspectProjectDeletion(projectId);
    if (!impact) return null;
    requireConfirmation(impact, deleteSessions ? confirmDelete : confirmDetach);
    const backup = await this.backupService.createBackup({
      reason: `before-story-project-delete:${impact.target.id}`,
      includePaths: lifecycleBackupPaths({
        projectIds: [impact.target.id],
        sessionIds: impact.sessions.map((session) => session.id)
      })
    });
    const detachedSessionIds = [];
    const deletedSessionIds = [];
    if (deleteSessions) {
      for (const summary of impact.sessions) {
        const deleted = await this.sessionService.deleteSession(summary.id);
        if (deleted) deletedSessionIds.push(summary.id);
      }
    } else {
      const detachedAt = this.now().toISOString();
      for (const summary of impact.sessions) {
        const session = await this.sessionService.getSession(summary.id);
        await this.sessionService.saveSession(detachSessionFromProject(session, impact.target, detachedAt));
        detachedSessionIds.push(summary.id);
      }
    }
    const removed = await this.storyProjectService.deleteProject(impact.target.id);
    if (!removed) throw lifecycleError('STORY_PROJECT_NOT_FOUND');
    return {
      ok: true,
      backup,
      detachedSessionIds,
      deletedSessionIds,
      missingSessionIds: impact.missingSessionIds,
      preservedSessionIds: deleteSessions ? [] : detachedSessionIds
    };
  }

  async inspectPackDeletion(packId) {
    const pack = await this.resourceLibraryService.getPack(packId);
    if (!pack) return null;
    const [projects, sessionContext] = await Promise.all([
      this.storyProjectService.listProjects(),
      this.loadSessionContext()
    ]);
    const impactedProjects = projects.filter((project) => project.basePackId === pack.id);
    const impactedProjectIds = new Set(impactedProjects.map((project) => project.id));
    const declaredSessionIds = new Set(impactedProjects.flatMap((project) => project.sessionIds || []));
    const sessions = sessionContext.sessions.filter((session) => (
      sessionReferencesPack(session, pack.id)
      || impactedProjectIds.has(String(session.storyProjectId || '').trim())
      || declaredSessionIds.has(session.id)
    ));
    const foundIds = new Set(sessions.map((session) => session.id));
    const missingSessionIds = [...declaredSessionIds].filter((sessionId) => !foundIds.has(sessionId));
    return createImpact({
      kind: 'content-pack',
      target: summarizePackTarget(pack),
      sessions,
      projects: impactedProjects,
      missingSessionIds
    });
  }

  async deletePack(packId, { confirmDetach = false } = {}) {
    const impact = await this.inspectPackDeletion(packId);
    if (!impact) return null;
    requireConfirmation(impact, confirmDetach);
    const backup = await this.backupService.createBackup({
      reason: `before-content-pack-delete:${impact.target.id}`,
      includePaths: lifecycleBackupPaths({
        packIds: [impact.target.id],
        projectIds: impact.projects.map((project) => project.id),
        sessionIds: impact.sessions.map((session) => session.id)
      })
    });
    const detachedAt = this.now().toISOString();
    const detachedProjects = [];
    const availableSessionIds = new Set(impact.sessions.map((session) => session.id));
    for (const projectSummary of impact.projects) {
      const project = await this.storyProjectService.getProject(projectSummary.id);
      if (!project) continue;
      const detached = await this.storyProjectService.saveProject(detachProjectFromPack(
        project,
        impact.target,
        detachedAt,
        availableSessionIds
      ));
      detachedProjects.push(detached);
    }
    const detachedProjectIds = new Set(detachedProjects.map((project) => project.id));
    for (const sessionSummary of impact.sessions) {
      const session = await this.sessionService.getSession(sessionSummary.id);
      await this.sessionService.saveSession(detachSessionFromPack(
        session,
        impact.target,
        detachedProjectIds,
        detachedAt
      ));
    }
    const removed = await this.resourceLibraryService.removePack(impact.target.id);
    if (!removed) throw lifecycleError('CONTENT_PACK_NOT_FOUND');
    return {
      ok: true,
      backup,
      detachedSessionIds: impact.sessions.map((session) => session.id),
      detachedProjects: detachedProjects.map(summarizeStoryProject),
      missingSessionIds: impact.missingSessionIds
    };
  }

  async loadSessionContext() {
    const ids = await this.sessionService.listSessions();
    const sessions = await Promise.all(ids.map((sessionId) => this.sessionService.getSession(sessionId)));
    return { sessions };
  }
}

function lifecycleBackupPaths({ packIds = [], projectIds = [], sessionIds = [] } = {}) {
  return [
    ...packIds.map((id) => `library/packs/${id}.json`),
    ...projectIds.map((id) => `projects/${id}.json`),
    ...sessionIds.map((id) => `sessions/${id}.json`)
  ];
}

function createImpact({ kind, target, sessions, projects, missingSessionIds }) {
  const sessionSummaries = sessions.map(summarizeSessionImpact);
  const projectSummaries = projects.map(summarizeProjectImpact);
  return {
    spec: DELETION_IMPACT_SPEC,
    kind,
    target,
    requiresConfirmation: true,
    hasDependencies: sessionSummaries.length > 0 || projectSummaries.length > 0,
    backupRequired: true,
    sessions: sessionSummaries,
    projects: projectSummaries,
    missingSessionIds: [...missingSessionIds]
  };
}

function summarizeSessionImpact(session) {
  return {
    id: session.id,
    title: String(session.title || session.id),
    messageCount: Array.isArray(session.messages) ? session.messages.length : 0,
    storyProjectId: String(session.storyProjectId || '').trim(),
    basePackId: String(session.basePackId || '').trim()
  };
}

function summarizeProjectImpact(project) {
  return {
    id: project.id,
    title: project.title,
    activeSessionId: project.activeSessionId,
    sessionCount: Array.isArray(project.sessionIds) ? project.sessionIds.length : 0
  };
}

function summarizeProjectTarget(project) {
  return {
    id: project.id,
    title: project.title,
    basePackId: project.basePackId,
    basePackTitle: project.basePackTitle,
    basePackVersion: project.basePackVersion
  };
}

function summarizePackTarget(pack) {
  return {
    id: pack.id,
    title: pack.title || pack.id,
    version: pack.manifest?.version || pack.version || '1.0.0',
    visualPackId: pack.visualPackId || ''
  };
}

function requireConfirmation(impact, confirmed) {
  if (impact.requiresConfirmation && confirmed !== true) {
    throw lifecycleError('CONTENT_DELETE_CONFIRMATION_REQUIRED');
  }
}

function detachSessionFromProject(session, project, detachedAt) {
  const previous = captureSessionBindings(session);
  const next = structuredClone(session);
  if (String(next.storyProjectId || '').trim() === project.id) next.storyProjectId = '';
  next.provenance = appendBindingHistory(next.provenance, {
    kind: 'story-project',
    source: structuredClone(project),
    detachedAt,
    reason: 'story-project-deleted',
    previous
  });
  next.updatedAt = detachedAt;
  return next;
}

function detachProjectFromPack(project, pack, detachedAt, availableSessionIds) {
  const sessionIds = (project.sessionIds || []).filter((sessionId) => availableSessionIds.has(sessionId));
  const activeSessionId = availableSessionIds.has(project.activeSessionId)
    ? project.activeSessionId
    : sessionIds.at(-1) || '';
  return {
    ...structuredClone(project),
    basePackId: '',
    sessionIds,
    activeSessionId,
    lifecycle: {
      state: 'detached',
      detachedAt,
      reason: 'content-pack-deleted',
      sourcePack: structuredClone(pack)
    }
  };
}

function detachSessionFromPack(session, pack, detachedProjectIds, detachedAt) {
  const previous = captureSessionBindings(session);
  const next = structuredClone(session);
  if (next.basePackId === pack.id) next.basePackId = '';
  if (detachedProjectIds.has(String(next.storyProjectId || '').trim())) next.storyProjectId = '';
  if (next.config?.contentPackId === pack.id) next.config.contentPackId = '';
  if (next.memory?.resourcePackId === pack.id) next.memory.resourcePackId = '';
  if (next.memory?.ruleSystem?.contentPackId === pack.id) next.memory.ruleSystem.contentPackId = '';
  if (next.memory?.ruleSystem?.sourceContentPackId === pack.id) next.memory.ruleSystem.sourceContentPackId = '';
  if (next.memory?.narrativeState?.lockedGenre === pack.id) next.memory.narrativeState.lockedGenre = '';
  if (next.memory?.worldState?.flags?.genre === pack.id) next.memory.worldState.flags.genre = '';
  if (next.settings?.visualContentPack === pack.id) {
    next.settings.visualContentPack = pack.visualPackId && pack.visualPackId !== pack.id
      ? pack.visualPackId
      : '';
  }
  next.provenance = appendBindingHistory(next.provenance, {
    kind: 'content-pack',
    source: structuredClone(pack),
    detachedAt,
    reason: 'content-pack-deleted',
    previous
  });
  next.updatedAt = detachedAt;
  return next;
}

function captureSessionBindings(session) {
  return {
    storyProjectId: String(session.storyProjectId || '').trim(),
    basePackId: String(session.basePackId || '').trim(),
    configContentPackId: String(session.config?.contentPackId || '').trim(),
    memoryResourcePackId: String(session.memory?.resourcePackId || '').trim(),
    ruleContentPackId: String(session.memory?.ruleSystem?.contentPackId || '').trim()
  };
}

function appendBindingHistory(provenance, entry) {
  const current = provenance && typeof provenance === 'object' && !Array.isArray(provenance)
    ? structuredClone(provenance)
    : {};
  const history = Array.isArray(current.bindingHistory) ? current.bindingHistory : [];
  return {
    ...current,
    bindingHistory: [...history, {
      spec: BINDING_HISTORY_SPEC,
      ...entry
    }].slice(-MAX_BINDING_HISTORY)
  };
}

function sessionReferencesPack(session, packId) {
  return [
    session.basePackId,
    session.config?.contentPackId,
    session.memory?.resourcePackId,
    session.memory?.ruleSystem?.contentPackId,
    session.memory?.ruleSystem?.sourceContentPackId,
    session.memory?.narrativeState?.lockedGenre,
    session.memory?.worldState?.flags?.genre,
    session.settings?.visualContentPack
  ].some((value) => String(value || '').trim() === packId);
}

function lifecycleError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
