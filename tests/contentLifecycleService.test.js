import test from 'node:test';
import assert from 'node:assert/strict';

import { ContentLifecycleService } from '../server/services/contentLifecycleService.js';

test('project deletion previews impact, requires confirmation, backs up, and detaches sessions first', async () => {
  const events = [];
  const sessions = new Map([
    ['session-a', {
      id: 'session-a',
      title: '第一卷',
      storyProjectId: 'project-a',
      basePackId: 'pack-a',
      messages: [{ id: 'm1', content: '保留正文' }],
      config: { contentPackId: 'pack-a', characterCard: { name: '阿月' } },
      memory: { factCards: [{ id: 'f1' }] }
    }],
    ['unrelated', { id: 'unrelated', storyProjectId: 'project-b', messages: [] }]
  ]);
  const project = {
    id: 'project-a',
    title: '月下旧卷',
    basePackId: 'pack-a',
    basePackTitle: '月下山门',
    basePackVersion: '1.2.0',
    sessionIds: ['session-a', 'missing-session']
  };
  const harness = createHarness({ sessions, projects: [project] });
  let backupPaths = [];
  harness.backupService.createBackup = async ({ reason, includePaths }) => {
    events.push(`backup:${reason}`);
    backupPaths = includePaths;
    return { id: 'backup-project' };
  };
  harness.sessionService.saveSession = async (session) => {
    events.push(`save-session:${session.id}`);
    sessions.set(session.id, structuredClone(session));
    return session;
  };
  harness.storyProjectService.deleteProject = async (projectId) => {
    events.push(`delete-project:${projectId}`);
    return project;
  };
  const service = new ContentLifecycleService(harness);

  const impact = await service.inspectProjectDeletion('project-a');
  assert.deepEqual(impact.sessions.map((session) => session.id), ['session-a']);
  assert.deepEqual(impact.missingSessionIds, ['missing-session']);
  assert.equal(impact.requiresConfirmation, true);
  await assert.rejects(
    service.deleteProject('project-a'),
    (error) => error.code === 'CONTENT_DELETE_CONFIRMATION_REQUIRED'
  );
  assert.deepEqual(events, []);

  const result = await service.deleteProject('project-a', { confirmDetach: true });
  const detached = sessions.get('session-a');
  assert.deepEqual(events, [
    'backup:before-story-project-delete:project-a',
    'save-session:session-a',
    'delete-project:project-a'
  ]);
  assert.deepEqual(backupPaths, [
    'projects/project-a.json',
    'sessions/session-a.json'
  ]);
  assert.equal(detached.storyProjectId, '');
  assert.equal(detached.basePackId, 'pack-a');
  assert.equal(detached.config.characterCard.name, '阿月');
  assert.equal(detached.messages[0].content, '保留正文');
  assert.equal(detached.provenance.bindingHistory.at(-1).reason, 'story-project-deleted');
  assert.deepEqual(result.detachedSessionIds, ['session-a']);
  assert.equal(result.backup.id, 'backup-project');
});

test('project deletion can remove linked running sessions after a recoverable backup', async () => {
  const events = [];
  const sessions = new Map([['session-a', {
    id: 'session-a',
    title: '第一卷',
    storyProjectId: 'project-a',
    messages: [{ id: 'm1', content: '待删除正文' }]
  }]]);
  const project = {
    id: 'project-a',
    title: '月下旧卷',
    basePackId: 'pack-a',
    sessionIds: ['session-a']
  };
  const harness = createHarness({ sessions, projects: [project] });
  harness.backupService.createBackup = async ({ reason }) => {
    events.push(`backup:${reason}`);
    return { id: 'backup-project-delete' };
  };
  harness.sessionService.deleteSession = async (sessionId) => {
    events.push(`delete-session:${sessionId}`);
    const session = sessions.get(sessionId);
    sessions.delete(sessionId);
    return session ? { id: sessionId, storyProjectId: session.storyProjectId } : null;
  };
  harness.storyProjectService.deleteProject = async (projectId) => {
    events.push(`delete-project:${projectId}`);
    return project;
  };

  const service = new ContentLifecycleService(harness);
  const result = await service.deleteProject('project-a', {
    confirmDelete: true,
    deleteSessions: true
  });

  assert.deepEqual(events, [
    'backup:before-story-project-delete:project-a',
    'delete-session:session-a',
    'delete-project:project-a'
  ]);
  assert.equal(sessions.has('session-a'), false);
  assert.deepEqual(result.deletedSessionIds, ['session-a']);
  assert.deepEqual(result.detachedSessionIds, []);
  assert.deepEqual(result.preservedSessionIds, []);
  assert.equal(result.backup.id, 'backup-project-delete');
});

test('pack deletion archives projects and turns affected sessions into self-contained snapshots', async () => {
  const events = [];
  const pack = {
    id: 'custom-pack',
    title: '月下山门',
    version: '2.0.0',
    visualPackId: 'xianxia'
  };
  const project = {
    id: 'project-a',
    title: '月下旧卷',
    basePackId: 'custom-pack',
    basePackTitle: '月下山门',
    basePackVersion: '2.0.0',
    visualPackId: 'xianxia',
    bindings: {},
    runtimePolicy: {},
    sessionIds: ['session-a', 'missing-session'],
    activeSessionId: 'missing-session',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z'
  };
  const sessions = new Map([['session-a', {
    id: 'session-a',
    title: '第一卷',
    storyProjectId: 'project-a',
    basePackId: 'custom-pack',
    messages: [{ id: 'm1', content: '完整剧情正文' }],
    config: {
      contentPackId: 'custom-pack',
      characterCard: { name: '阿月', description: '必须保留' },
      worldBook: [{ id: 'world-a', content: '世界设定' }],
      promptModules: [{ id: 'prompt-a', text: '叙事约束' }]
    },
    memory: {
      resourcePackId: 'custom-pack',
      factCards: [{ id: 'fact-a', text: '既有事实' }],
      ruleSystem: {
        contentPackId: 'custom-pack',
        sourceContentPackId: 'custom-pack',
        rules: [{ id: 'rule-a' }]
      },
      narrativeState: { lockedGenre: 'custom-pack', phase: '正文' },
      worldState: { flags: { genre: 'custom-pack', weather: '雨' } }
    },
    settings: { visualContentPack: 'custom-pack', backgroundImage: '/portrait.png' }
  }]]);
  const harness = createHarness({ sessions, projects: [project], packs: [pack] });
  let backupPaths = [];
  harness.backupService.createBackup = async ({ reason, includePaths }) => {
    events.push(`backup:${reason}`);
    backupPaths = includePaths;
    return { id: 'backup-pack' };
  };
  harness.storyProjectService.saveProject = async (next) => {
    events.push(`save-project:${next.id}`);
    harness.projects.set(next.id, structuredClone(next));
    return next;
  };
  harness.sessionService.saveSession = async (session) => {
    events.push(`save-session:${session.id}`);
    sessions.set(session.id, structuredClone(session));
    return session;
  };
  harness.resourceLibraryService.removePack = async (packId) => {
    events.push(`delete-pack:${packId}`);
    return true;
  };
  const service = new ContentLifecycleService(harness);

  const impact = await service.inspectPackDeletion('custom-pack');
  assert.deepEqual(impact.projects.map((item) => item.id), ['project-a']);
  assert.deepEqual(impact.sessions.map((item) => item.id), ['session-a']);
  await assert.rejects(
    service.deletePack('custom-pack'),
    (error) => error.code === 'CONTENT_DELETE_CONFIRMATION_REQUIRED'
  );
  assert.deepEqual(events, []);

  const result = await service.deletePack('custom-pack', { confirmDetach: true });
  const detachedProject = harness.projects.get('project-a');
  const detachedSession = sessions.get('session-a');
  assert.deepEqual(events, [
    'backup:before-content-pack-delete:custom-pack',
    'save-project:project-a',
    'save-session:session-a',
    'delete-pack:custom-pack'
  ]);
  assert.deepEqual(backupPaths, [
    'library/packs/custom-pack.json',
    'projects/project-a.json',
    'sessions/session-a.json'
  ]);
  assert.equal(detachedProject.basePackId, '');
  assert.equal(detachedProject.lifecycle.state, 'detached');
  assert.equal(detachedProject.lifecycle.sourcePack.id, 'custom-pack');
  assert.deepEqual(detachedProject.sessionIds, ['session-a']);
  assert.equal(detachedProject.activeSessionId, 'session-a');
  assert.equal(detachedSession.storyProjectId, '');
  assert.equal(detachedSession.basePackId, '');
  assert.equal(detachedSession.config.contentPackId, '');
  assert.equal(detachedSession.memory.resourcePackId, '');
  assert.equal(detachedSession.memory.ruleSystem.contentPackId, '');
  assert.equal(detachedSession.memory.ruleSystem.sourceContentPackId, '');
  assert.equal(detachedSession.memory.narrativeState.lockedGenre, '');
  assert.equal(detachedSession.memory.worldState.flags.genre, '');
  assert.equal(detachedSession.settings.visualContentPack, 'xianxia');
  assert.equal(detachedSession.settings.backgroundImage, '/portrait.png');
  assert.equal(detachedSession.config.characterCard.description, '必须保留');
  assert.equal(detachedSession.config.worldBook[0].content, '世界设定');
  assert.equal(detachedSession.memory.factCards[0].text, '既有事实');
  assert.equal(detachedSession.memory.ruleSystem.rules[0].id, 'rule-a');
  assert.equal(detachedSession.messages[0].content, '完整剧情正文');
  assert.equal(detachedSession.provenance.bindingHistory.at(-1).reason, 'content-pack-deleted');
  assert.equal(result.detachedProjects[0].lifecycleState, 'detached');
  assert.equal(result.detachedProjects[0].canCreateSession, false);
  assert.deepEqual(result.missingSessionIds, ['missing-session']);
  assert.equal(result.backup.id, 'backup-pack');
});

function createHarness({ sessions = new Map(), projects = [], packs = [] } = {}) {
  const projectMap = new Map(projects.map((project) => [project.id, structuredClone(project)]));
  const packMap = new Map(packs.map((pack) => [pack.id, structuredClone(pack)]));
  return {
    projects: projectMap,
    sessionService: {
      listSessions: async () => [...sessions.keys()],
      getSession: async (sessionId) => structuredClone(sessions.get(sessionId)),
      saveSession: async () => {},
      deleteSession: async (sessionId) => {
        const session = sessions.get(sessionId);
        sessions.delete(sessionId);
        return session ? { id: sessionId, storyProjectId: session.storyProjectId || '' } : null;
      }
    },
    storyProjectService: {
      listProjects: async () => [...projectMap.values()].map((project) => structuredClone(project)),
      getProject: async (projectId) => {
        const project = projectMap.get(projectId);
        return project ? structuredClone(project) : null;
      },
      saveProject: async () => {},
      deleteProject: async () => null
    },
    resourceLibraryService: {
      getPack: async (packId) => {
        const pack = packMap.get(packId);
        return pack ? structuredClone(pack) : null;
      },
      removePack: async () => false
    },
    backupService: {
      createBackup: async () => ({ id: 'backup' })
    },
    now: () => new Date('2026-08-03T12:00:00.000Z')
  };
}
