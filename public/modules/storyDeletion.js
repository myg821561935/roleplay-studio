export function createStoryDeletionController({
  state,
  els,
  apiRequest,
  confirmAction,
  selectSession,
  loadState,
  setStatus,
  humanizeApiError,
  getMostRecentSessionSummary,
  renderStoryProjects,
  renderStoryContinuePanel,
  renderStoryCatalogFilters,
  renderStoryPackGrid,
  setStoryLauncherBackground
}) {
  async function deleteStoryProject(projectId) {
    const project = (state.storyProjects || []).find((item) => item.id === projectId);
    if (!project) return false;
    try {
      const preview = await apiRequest(
        `/api/story-projects/${encodeURIComponent(projectId)}/deletion-impact`
      );
      const impact = preview.impact || {};
      const sessionCount = Array.isArray(impact.sessions) ? impact.sessions.length : 0;
      const missingCount = Array.isArray(impact.missingSessionIds) ? impact.missingSessionIds.length : 0;
      const sessionNote = sessionCount
        ? `\n\n将同时删除 ${sessionCount} 个运行进度及其消息。`
        : '\n\n当前没有关联会话。';
      const missingNote = missingCount
        ? `\n另有 ${missingCount} 个历史存档编号已不存在，将只保留在本地备份中。`
        : '';
      if (!confirmAction(
        `从书架删除《${project.title || '未命名故事'}》？${sessionNote}${missingNote}\n\n删除前会自动创建本地安全备份，可从备份管理中恢复。`
      )) return false;

      const result = await apiRequest(`/api/story-projects/${encodeURIComponent(projectId)}`, {
        method: 'DELETE',
        body: { confirmDelete: true, deleteSessions: true }
      });
      const deletedSessionIds = new Set(result.deletedSessionIds || []);
      state.storyProjects = (state.storyProjects || []).filter((item) => item.id !== projectId);
      state.sessionSummaries = (state.sessionSummaries || [])
        .filter((summary) => !deletedSessionIds.has(summary.id));
      if (deletedSessionIds.has(state.session?.id)) selectSession('main');
      renderStoryProjects();
      renderStoryContinuePanel();
      await loadState();
      const backupNote = result.backup?.id ? ` 本地备份：${result.backup.id}。` : '';
      setStatus(els.storyLauncherStatus, `故事及关联运行进度已删除。${backupNote}`, 'ok');
      return true;
    } catch (error) {
      setStatus(els.storyLauncherStatus, `删除失败：${humanizeApiError(error)}`, 'error');
      return false;
    }
  }

  async function deleteContinueStory() {
    const sessionId = els.deleteContinueStory?.dataset.sessionId
      || els.continueLastStory?.dataset.sessionId
      || getMostRecentSessionSummary()?.id;
    if (!sessionId || sessionId === 'main') return false;
    const summary = (state.sessionSummaries || []).find((item) => item.id === sessionId);
    const label = summary?.title || sessionId;
    if (!confirmAction(
      `删除当前运行进度《${label}》？\n\n该会话及消息将被删除；如需保留，请先从工作台导出存档。`
    )) return false;

    try {
      await apiRequest(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
      state.sessionSummaries = (state.sessionSummaries || [])
        .filter((item) => item.id !== sessionId);
      if (state.session?.id === sessionId) selectSession('main');
      renderStoryContinuePanel();
      await loadState();
      setStatus(els.storyLauncherStatus, `运行进度《${label}》已删除。`, 'ok');
      return true;
    } catch (error) {
      setStatus(els.storyLauncherStatus, `删除失败：${humanizeApiError(error)}`, 'error');
      return false;
    }
  }

  async function deleteStoryPack(packId) {
    const pack = (state.contentPacks || []).find((item) => item.id === packId && item.custom === true);
    if (!pack) return false;
    try {
      const preview = await apiRequest(
        `/api/resource-library/packs/${encodeURIComponent(packId)}/deletion-impact`
      );
      const impact = preview.impact || {};
      const projectCount = Array.isArray(impact.projects) ? impact.projects.length : 0;
      const sessionCount = Array.isArray(impact.sessions) ? impact.sessions.length : 0;
      const dependencyNote = projectCount || sessionCount
        ? `\n\n影响范围：${projectCount} 个故事、${sessionCount} 个会话。故事会标记为“素材已解绑”，会话会转为独立快照。`
        : '\n\n当前没有关联故事或会话。';
      if (!confirmAction(
        `移除本地剧本《${pack.title || pack.id}》？${dependencyNote}\n\n角色卡、世界书原素材和消息都会保留，操作前会自动创建本地安全备份。`
      )) return false;

      const result = await apiRequest(`/api/resource-library/packs/${encodeURIComponent(packId)}`, {
        method: 'DELETE',
        body: { confirmDetach: true }
      });
      state.contentPacks = (state.contentPacks || []).filter((item) => item.id !== packId);
      const detachedProjects = new Map(
        (result.detachedProjects || []).map((project) => [project.id, project])
      );
      state.storyProjects = (state.storyProjects || []).map((project) => (
        detachedProjects.get(project.id) || project
      ));
      renderStoryCatalogFilters();
      renderStoryPackGrid();
      renderStoryProjects();
      setStoryLauncherBackground(state.contentPacks[0]);
      const backupNote = result.backup?.id ? ` 本地备份：${result.backup.id}。` : '';
      setStatus(els.storyLauncherStatus, `本地剧本已移除，关联会话已转为独立快照。${backupNote}`, 'ok');
      return true;
    } catch (error) {
      setStatus(els.storyLauncherStatus, `删除失败：${humanizeApiError(error)}`, 'error');
      return false;
    }
  }

  return { deleteContinueStory, deleteStoryPack, deleteStoryProject };
}
