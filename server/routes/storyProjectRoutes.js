import { writeJson } from '../lib/http.js';
import { summarizeStoryProject } from '../services/storyProjectService.js';
import { ApiError, readRequestJson, validateMutatingRequest } from './http.js';

export async function handleStoryProjectRoutes({
  req,
  res,
  url,
  storyProjectService,
  contentLifecycleService,
  resourceLibraryService,
  sessionService,
  worldSimulationService,
  operations
}) {
  const {
    buildStoryProjectBindings,
    createSessionFromContentPack,
    resolveContentPack
  } = operations;

  if (req.method === 'GET' && url.pathname === '/api/story-projects') {
    const projects = await storyProjectService.listProjects();
    writeJson(res, 200, { projects: projects.map(summarizeStoryProject) });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/story-projects') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const pack = await resolveContentPack(resourceLibraryService, body.basePackId);
    if (!pack) throw new ApiError(404, 'CONTENT_PACK_NOT_FOUND');
    const readiness = await resourceLibraryService.inspectPackStartReadiness?.(pack.id);
    if (pack.custom === true && readiness?.canStartNewStory !== true) {
      throw new ApiError(409, 'CONTENT_PACK_COMPATIBILITY_REVIEW_REQUIRED', readiness?.status || 'unavailable');
    }
    const project = await storyProjectService.createProject({
      title: body.title || pack.sessionTitle || pack.title,
      description: body.description || pack.description,
      basePackId: pack.id,
      basePackTitle: pack.title,
      basePackVersion: pack.manifest?.version || pack.version || '1.0.0',
      visualPackId: pack.visualPackId || pack.resourceManifest?.basePackId || pack.id,
      bindings: buildStoryProjectBindings(pack),
      runtimePolicy: body.runtimePolicy
    });
    writeJson(res, 200, { project, summary: summarizeStoryProject(project) });
    return true;
  }

  const storyProjectDeletionImpactRoute = url.pathname.match(/^\/api\/story-projects\/([^/]+)\/deletion-impact$/);
  if (storyProjectDeletionImpactRoute && req.method === 'GET') {
    const impact = await contentLifecycleService.inspectProjectDeletion(
      decodeURIComponent(storyProjectDeletionImpactRoute[1])
    );
    if (!impact) throw new ApiError(404, 'STORY_PROJECT_NOT_FOUND');
    writeJson(res, 200, { impact });
    return true;
  }

  const storyProjectRoute = url.pathname.match(/^\/api\/story-projects\/([^/]+)$/);
  if (storyProjectRoute && req.method === 'GET') {
    const project = await storyProjectService.getProject(decodeURIComponent(storyProjectRoute[1]));
    if (!project) throw new ApiError(404, 'STORY_PROJECT_NOT_FOUND');
    writeJson(res, 200, { project });
    return true;
  }

  if (storyProjectRoute && req.method === 'PUT') {
    validateMutatingRequest(req);
    const projectId = decodeURIComponent(storyProjectRoute[1]);
    const current = await storyProjectService.getProject(projectId);
    if (!current) throw new ApiError(404, 'STORY_PROJECT_NOT_FOUND');
    const body = await readRequestJson(req);
    const project = await storyProjectService.saveProject({
      ...current,
      title: body.title === undefined ? current.title : body.title,
      description: body.description === undefined ? current.description : body.description
    });
    writeJson(res, 200, { project, summary: summarizeStoryProject(project) });
    return true;
  }

  if (storyProjectRoute && req.method === 'DELETE') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    let result;
    try {
      result = await contentLifecycleService.deleteProject(
        decodeURIComponent(storyProjectRoute[1]),
        {
          confirmDetach: body.confirmDetach === true,
          confirmDelete: body.confirmDelete === true,
          deleteSessions: body.deleteSessions === true
        }
      );
    } catch (error) {
      if (error.code === 'CONTENT_DELETE_CONFIRMATION_REQUIRED') {
        throw new ApiError(409, error.code);
      }
      throw error;
    }
    if (!result) throw new ApiError(404, 'STORY_PROJECT_NOT_FOUND');
    writeJson(res, 200, result);
    return true;
  }

  const storyProjectSessionRoute = url.pathname.match(/^\/api\/story-projects\/([^/]+)\/sessions$/);
  if (storyProjectSessionRoute && req.method === 'POST') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const projectId = decodeURIComponent(storyProjectSessionRoute[1]);
    const project = await storyProjectService.getProject(projectId);
    if (!project) throw new ApiError(404, 'STORY_PROJECT_NOT_FOUND');
    if (project.lifecycle?.state === 'detached' || !project.basePackId) {
      throw new ApiError(409, 'STORY_PROJECT_DETACHED');
    }
    const pack = await resolveContentPack(resourceLibraryService, project.basePackId);
    if (!pack) throw new ApiError(404, 'CONTENT_PACK_NOT_FOUND');
    const readiness = await resourceLibraryService.inspectPackStartReadiness?.(pack.id);
    if (pack.custom === true && readiness?.canStartNewStory !== true) {
      throw new ApiError(409, 'CONTENT_PACK_COMPATIBILITY_REVIEW_REQUIRED', readiness?.status || 'unavailable');
    }
    const session = await createSessionFromContentPack({
      sessionService,
      worldSimulationService,
      pack,
      body,
      project
    });
    const updatedProject = await storyProjectService.attachSession(project.id, session.id);
    writeJson(res, 200, {
      session,
      project: updatedProject,
      visualPackId: project.visualPackId || pack.visualPackId || pack.id
    });
    return true;
  }

  return false;
}
