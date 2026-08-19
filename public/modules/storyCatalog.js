import {
  STORY_CATEGORY_LABELS,
  filterStoryPacks,
  getStoryPackCategories as resolveStoryPackCategories,
  getStoryPackVisualId as resolveStoryPackVisualId
} from './storyLauncher.js';
import {
  getPackCompatibilityAudit,
  isPackStartBlocked
} from './packCompatibility.js';
import { createStoryPackCardView } from './storyPackCard.js';
import { createStoryProjectLibraryViewController } from './storyProjectLibraryView.js';
import { createStoryDeletionController } from './storyDeletion.js';

export const STORY_CATALOG_VIEW_KEY = 'localRoleplayStoryCatalogView';
export const STORY_CATALOG_CATEGORY_KEY = 'localRoleplayStoryCatalogCategory';

export function loadStoryCatalogPreferences(storage = globalThis.localStorage) {
  try {
    return {
      view: storage?.getItem(STORY_CATALOG_VIEW_KEY) === 'list' ? 'list' : 'grid',
      category: STORY_CATEGORY_LABELS[storage?.getItem(STORY_CATALOG_CATEGORY_KEY)]
        ? storage.getItem(STORY_CATALOG_CATEGORY_KEY)
        : 'all'
    };
  } catch {
    return { view: 'grid', category: 'all' };
  }
}

export function selectMostRecentSessionSummary(summaries = []) {
  const items = Array.isArray(summaries) ? summaries : [];
  return items.find((item) => Number(item.messageCount) > 0)
    || items.find((item) => item.storyProjectId)
    || items.find((item) => item.id !== 'main')
    || null;
}

export function formatStoryDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

export function resolveStoryStageBackground(pack, getCharacterPortraitUrl = () => '') {
  const stage = pack?.stageBackground;
  const url = getCharacterPortraitUrl(stage);
  if (!url || stage?.source !== 'character-portrait') return null;
  return {
    url,
    fit: 'portrait',
    source: 'character-portrait',
    label: String(stage.label || `${pack.characterName || '角色'}立绘`)
  };
}

export function createStoryCatalogController({
  state = {},
  els = {},
  apiRequest = async () => ({}),
  getContentPackVisualPreset = () => ({ packId: 'neutral', backgroundImage: '' }),
  getCharacterPortraitUrl = () => '',
  createCharacterPortraitImage = () => null,
  storyPackPresentation = {},
  visualPackIds,
  selectSession = () => {},
  closeStoryLauncher = () => {},
  loadState = async () => {},
  linkContentPackVisuals = async () => {},
  renderMessages = () => {},
  openDerivedStoryBuilder = () => {},
  onReviewPackCompatibility = async () => null,
  setStatus = () => {},
  humanizeApiError = (error) => error?.message || String(error),
  storage = globalThis.localStorage,
  confirmAction = (message) => globalThis.confirm?.(message) === true,
  documentObject = globalThis.document,
  setTimeoutImpl = globalThis.setTimeout
} = {}) {
  let eventsBound = false;
  let storyEditTarget = null;
  const knownVisualPackIds = visualPackIds instanceof Set ? visualPackIds : undefined;

  function persistPreference(key, value) {
    try {
      storage?.setItem(key, value);
    } catch {
      // The in-memory selection remains active when storage is unavailable.
    }
  }

  function getStoryPackVisualId(packOrId) {
    return resolveStoryPackVisualId(packOrId, state.contentPacks, knownVisualPackIds);
  }

  function getStoryPackCategories(pack) {
    return resolveStoryPackCategories(pack, {
      packs: state.contentPacks,
      visualPackIds: knownVisualPackIds
    });
  }

  function getStoryStageBackground(pack) {
    return resolveStoryStageBackground(pack, getCharacterPortraitUrl);
  }

  function openStoryEditDialog(kind, id) {
    const collection = kind === 'pack' ? state.contentPacks : state.storyProjects;
    const item = (collection || []).find((entry) => entry.id === id);
    if (!item || !els.storyEditDialog) return;
    storyEditTarget = { kind, id };
    if (els.storyEditDialogTitle) {
      els.storyEditDialogTitle.textContent = kind === 'pack' ? '编辑剧本' : '编辑故事';
    }
    if (els.storyEditTitle) els.storyEditTitle.value = item.title || '';
    if (els.storyEditDescription) els.storyEditDescription.value = item.description || '';
    setStatus(els.storyEditStatus, kind === 'pack'
      ? '只修改本地剧本的名称和说明，不改动角色卡、世界书与已有存档。'
      : '修改书架中的故事名称和说明，不改动会话内容。');
    if (!els.storyEditDialog.open) els.storyEditDialog.showModal();
    setTimeoutImpl?.(() => els.storyEditTitle?.focus(), 0);
  }

  function closeStoryEditDialog() {
    storyEditTarget = null;
    if (els.storyEditDialog?.open) els.storyEditDialog.close();
  }

  async function saveStoryEdit() {
    if (!storyEditTarget) return null;
    const title = String(els.storyEditTitle?.value || '').trim();
    const description = String(els.storyEditDescription?.value || '').trim();
    if (!title) {
      setStatus(els.storyEditStatus, '名称不能为空。', 'error');
      return null;
    }
    const { kind, id } = storyEditTarget;
    setStatus(els.storyEditStatus, '正在保存...', 'busy');
    try {
      let result;
      if (kind === 'project') {
        const payload = await apiRequest(`/api/story-projects/${encodeURIComponent(id)}`, {
          method: 'PUT',
          body: { title, description }
        });
        state.storyProjects = (state.storyProjects || []).map((project) => (
          project.id === id ? payload.summary : project
        ));
        renderStoryProjects();
        result = payload.summary;
      } else {
        await apiRequest(`/api/resource-library/packs/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: { title, description, sessionTitle: title }
        });
        const payload = await apiRequest('/api/content-packs');
        state.contentPacks = payload.contentPacks || [];
        renderStoryCatalogFilters();
        renderStoryPackGrid();
        result = state.contentPacks.find((pack) => pack.id === id) || null;
      }
      closeStoryEditDialog();
      setStatus(els.storyLauncherStatus, `已保存《${title}》。`, 'ok');
      return result;
    } catch (error) {
      setStatus(els.storyEditStatus, `保存失败：${humanizeApiError(error)}`, 'error');
      return null;
    }
  }

  const {
    deleteContinueStory,
    deleteStoryPack,
    deleteStoryProject
  } = createStoryDeletionController({
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
  });

  function renderStoryCatalogFilters() {
    if (!els.storyCategoryFilter) return;
    const packs = Array.isArray(state.contentPacks) ? state.contentPacks : [];
    const categories = ['all', 'xuanhuan', 'xianxia', 'lingyi', 'mingmo', 'yingxiongzhi', 'custom']
      .map((id) => ({
        id,
        label: STORY_CATEGORY_LABELS[id],
        count: id === 'all'
          ? packs.length
          : packs.filter((pack) => getStoryPackCategories(pack).includes(id)).length
      }))
      .filter((item) => item.id === 'all' || item.count > 0);
    if (!categories.some((item) => item.id === state.storyCatalogCategory)) {
      state.storyCatalogCategory = 'all';
    }
    els.storyCategoryFilter.replaceChildren?.();
    if (typeof els.storyCategoryFilter.replaceChildren !== 'function') {
      els.storyCategoryFilter.textContent = '';
    }
    categories.forEach((category) => {
      const button = documentObject.createElement('button');
      button.type = 'button';
      button.className = 'story-category-button';
      button.dataset.storyCategory = category.id;
      const active = category.id === state.storyCatalogCategory;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
      const label = documentObject.createElement('span');
      label.textContent = category.label;
      const count = documentObject.createElement('small');
      count.textContent = String(category.count);
      button.append(label, count);
      els.storyCategoryFilter.append(button);
    });
    (els.storyViewButtons || []).forEach((button) => {
      const active = button.dataset.storyView === state.storyCatalogView;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function setStoryCatalogCategory(category) {
    state.storyCatalogCategory = STORY_CATEGORY_LABELS[category] ? category : 'all';
    persistPreference(STORY_CATALOG_CATEGORY_KEY, state.storyCatalogCategory);
    renderStoryCatalogFilters();
    renderStoryPackGrid();
  }

  function setStoryCatalogView(view) {
    state.storyCatalogView = view === 'list' ? 'list' : 'grid';
    persistPreference(STORY_CATALOG_VIEW_KEY, state.storyCatalogView);
    renderStoryCatalogFilters();
    renderStoryPackGrid();
  }

  function getMostRecentSessionSummary() {
    return selectMostRecentSessionSummary(state.sessionSummaries);
  }

  function renderStoryContinuePanel() {
    if (!els.storyContinuePanel) return;
    const summary = getMostRecentSessionSummary();
    els.storyContinuePanel.hidden = !summary;
    if (!summary) return;
    const pack = (state.contentPacks || [])
      .find((item) => item.id === (summary.packId || summary.basePackId));
    const packTitle = pack?.title || summary.packId || '旧版会话';
    const visual = getContentPackVisualPreset(getStoryPackVisualId(pack || summary.packId));
    const stageBackground = getStoryStageBackground(pack);
    const bgUrl = stageBackground?.url || visual.backgroundImage || '/assets/xianxia-stage.png';

    const coverElem = typeof els.storyContinuePanel?.querySelector === 'function'
      ? els.storyContinuePanel.querySelector('.continue-cover-img')
      : null;
    if (coverElem) {
      coverElem.style.backgroundImage = `url("${bgUrl}")`;
    }

    if (els.storyContinueTitle) els.storyContinueTitle.textContent = summary.title || packTitle || summary.id;

    const chapterElem = typeof els.storyContinuePanel?.querySelector === 'function'
      ? els.storyContinuePanel.querySelector('#story-continue-chapter')
      : null;
    if (chapterElem) {
      chapterElem.textContent = summary.lastChapter || summary.sceneTitle || '继续上次进度';
    }

    const percentElem = typeof els.storyContinuePanel?.querySelector === 'function'
      ? els.storyContinuePanel.querySelector('#story-continue-percent')
      : null;
    if (percentElem) {
      const msgCount = Number(summary.messageCount || 1);
      const computedPercent = Math.min(95, Math.max(15, msgCount * 8));
      percentElem.textContent = `${computedPercent}%`;
    }

    if (els.storyContinueMeta) {
      els.storyContinueMeta.textContent = [
        packTitle,
        `${Number(summary.messageCount || 0)} 条消息`,
        summary.updatedAt ? formatStoryDate(summary.updatedAt) : ''
      ].filter(Boolean).join(' · ');
    }

    if (els.continueLastStory) {
      els.continueLastStory.dataset.sessionId = summary.id;
    }
    if (els.deleteContinueStory) {
      els.deleteContinueStory.dataset.sessionId = summary.id;
      els.deleteContinueStory.hidden = summary.id === 'main';
    }
  }

  function renderStoryProjects() {
    if (!els.storyProjectList) return;
    const projects = Array.isArray(state.storyProjects) ? state.storyProjects : [];
    if (els.storyProjectCount) {
      els.storyProjectCount.textContent = String(projects.length);
    }
    els.storyProjectList.replaceChildren?.();
    if (typeof els.storyProjectList.replaceChildren !== 'function') {
      els.storyProjectList.textContent = '';
    }
    if (!projects.length) {
      const empty = documentObject.createElement('div');
      empty.className = 'story-project-empty';
      empty.textContent = '暂无存档记录，开局后将自动沉淀卷宗。';
      els.storyProjectList.append(empty);
      return;
    }
    const fragment = documentObject.createDocumentFragment();
    projects.forEach((project) => {
      const pack = (state.contentPacks || []).find((item) => item.id === project.basePackId);
      const detached = project.lifecycleState === 'detached' || project.detached === true;
      const visual = getContentPackVisualPreset(getStoryPackVisualId(pack || project.basePackId));
      const bgUrl = visual.backgroundImage || '/assets/xianxia-stage.png';

      const canOpen = project.canOpen !== false && (!detached || Boolean(project.activeSessionId));
      const titleText = detached
        ? (project.activeSessionId ? '继续已有独立存档' : '原剧本素材已移除，不能创建新卷')
        : (project.activeSessionId ? '继续故事' : '开启新卷');

      const item = documentObject.createElement('article');
      item.className = 'story-project-item';
      item.classList.toggle('is-detached', detached);
      item.dataset.openStoryProject = project.id;
      item.title = titleText;
      item.disabled = !canOpen;

      // 缩略图
      const thumb = documentObject.createElement('div');
      thumb.className = 'story-project-thumb';
      thumb.style.backgroundImage = `url("${bgUrl}")`;

      // 头部信息
      const header = documentObject.createElement('div');
      header.className = 'story-project-header';
      const title = documentObject.createElement('strong');
      title.className = 'story-project-name';
      title.textContent = project.title || '未命名故事';
      const statusSpan = documentObject.createElement('span');
      statusSpan.className = 'story-project-status';
      statusSpan.textContent = detached ? '素材已解绑' : (project.status || '连载中');
      header.append(title, statusSpan);

      // 文字信息
      const copy = documentObject.createElement('div');
      copy.className = 'story-project-copy';

      const chapter = documentObject.createElement('span');
      chapter.className = 'story-project-chapter';
      chapter.textContent = project.currentChapter || '尚未记录章节';

      const time = documentObject.createElement('span');
      time.className = 'story-project-time';
      time.textContent = formatStoryDate(project.updatedAt) || '时间未记录';

      copy.append(header, chapter, time);

      // 右侧操作
      const actions = documentObject.createElement('div');
      actions.className = 'story-project-actions';

      const editButton = documentObject.createElement('button');
      editButton.type = 'button';
      editButton.className = 'story-project-more-btn';
      editButton.dataset.editStoryProject = project.id;
      editButton.textContent = '编辑';
      editButton.title = `编辑《${project.title || '未命名故事'}》`;
      editButton.setAttribute('aria-label', editButton.title);

      const deleteButton = documentObject.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'story-project-delete-btn';
      deleteButton.dataset.deleteStoryProject = project.id;
      deleteButton.textContent = '删除';
      deleteButton.title = `删除《${project.title || '未命名故事'}》`;
      deleteButton.setAttribute('aria-label', deleteButton.title);

      actions.append(editButton, deleteButton);

      item.append(thumb, copy, actions);
      fragment.append(item);
    });
    els.storyProjectList.append(fragment);
  }

  const storyProjectLibraryView = createStoryProjectLibraryViewController({
    els,
    renderStoryProjects,
    setTimeoutImpl
  });

  function renderStoryPackGrid() {
    if (!els.storyPackGrid) return;
    const query = String(els.storyPackSearch?.value || '').trim().toLowerCase();
    const category = state.storyCatalogCategory || 'all';
    const packs = filterStoryPacks(state.contentPacks, {
      category,
      query,
      visualPackIds: knownVisualPackIds
    });
    els.storyPackGrid.classList.toggle('is-list-view', state.storyCatalogView === 'list');
    els.storyPackGrid.dataset.view = state.storyCatalogView;
    els.storyPackGrid.replaceChildren?.();
    if (typeof els.storyPackGrid.replaceChildren !== 'function') {
      els.storyPackGrid.textContent = '';
    }
    if (!packs.length) {
      const empty = documentObject.createElement('div');
      empty.className = 'story-launcher-empty';
      empty.textContent = query || category !== 'all'
        ? '当前筛选下没有匹配的剧本。'
        : '尚未安装内容包。';
      els.storyPackGrid.append(empty);
      return;
    }

    const fragment = documentObject.createDocumentFragment();
    packs.forEach((pack) => fragment.append(createStoryPackCard(pack)));
    els.storyPackGrid.append(fragment);
  }

  function createStoryPackCard(pack) {
    return createStoryPackCardView(pack, {
      documentObject,
      getStoryPackVisualId,
      getContentPackVisualPreset,
      storyPackPresentation,
      getStoryStageBackground,
      createCharacterPortraitImage
    });
  }

  function setStoryLauncherBackground(packOrId) {
    if (!els.storyLauncher) return;
    const pack = typeof packOrId === 'object'
      ? packOrId
      : (state.contentPacks || []).find((item) => item.id === packOrId);
    const visual = getContentPackVisualPreset(getStoryPackVisualId(pack || packOrId));
    const stageBackground = getStoryStageBackground(pack);
    const backgroundImage = stageBackground?.url || visual.backgroundImage;
    els.storyLauncher.style.setProperty('--story-launcher-bg', `url("${backgroundImage}")`);
    els.storyLauncher.classList.toggle('has-character-stage', Boolean(stageBackground));
  }

  function previewStoryPackFromEvent(event) {
    const card = event.target.closest('[data-story-pack-card]');
    if (card) setStoryLauncherBackground(card.dataset.storyPackCard);
  }

  async function createAndOpenStoryProject(pack, { title = '', description = '' } = {}) {
    const projectPayload = await apiRequest('/api/story-projects', {
      method: 'POST',
      body: {
        basePackId: pack.id,
        title: title || pack.sessionTitle || pack.title,
        description: description || pack.description || ''
      }
    });
    const sessionPayload = await apiRequest(
      `/api/story-projects/${encodeURIComponent(projectPayload.project.id)}/sessions`,
      {
        method: 'POST',
        body: {}
      }
    );
    selectSession(sessionPayload.session.id);
    closeStoryLauncher();
    await loadState();
    const visualPackId = sessionPayload.visualPackId || getStoryPackVisualId(pack);
    const stageBackground = getStoryStageBackground(pack);
    await linkContentPackVisuals(visualPackId, {
      persist: true,
      backgroundImage: stageBackground?.url,
      backgroundFit: stageBackground?.fit,
      backgroundSource: stageBackground?.source
    });
    renderMessages();
    return {
      project: projectPayload.project,
      session: sessionPayload.session,
      visualPackId
    };
  }

  async function startStoryFromPack(packId, trigger) {
    const pack = (state.contentPacks || []).find((item) => item.id === packId);
    if (!pack) {
      setStatus(els.storyLauncherStatus, '找不到所选剧本，请刷新书架。', 'error');
      return null;
    }
    if (isPackStartBlocked(pack)) {
      const audit = getPackCompatibilityAudit(pack);
      setStatus(
        els.storyLauncherStatus,
        audit.canStartNewStory
          ? '这个内容包的依赖不完整，暂时不能新开故事。'
          : `${audit.label}：${audit.reason}`,
        'error'
      );
      return null;
    }
    if (trigger) trigger.disabled = true;
    setStatus(
      els.storyLauncherStatus,
      `正在为《${pack.title || pack.id}》建立独立故事工程...`,
      'busy'
    );
    try {
      const result = await createAndOpenStoryProject(pack);
      setStatus(els.appStatus, `已建立《${pack.title || pack.id}》，请从封面进入主角塑成。`, 'ok');
      return result;
    } catch (error) {
      setStatus(els.storyLauncherStatus, `开局失败：${humanizeApiError(error)}`, 'error');
      return null;
    } finally {
      if (trigger) trigger.disabled = false;
    }
  }

  async function openStorySession(sessionId, visualPackId = '') {
    if (!sessionId) return null;
    selectSession(sessionId);
    closeStoryLauncher();
    await loadState();
    if (visualPackId && !state.session?.settings?.backgroundImage) {
      await linkContentPackVisuals(visualPackId, { persist: true });
      renderMessages();
    }
    return state.session || null;
  }

  async function continueLastStory() {
    const sessionId = els.continueLastStory?.dataset.sessionId
      || getMostRecentSessionSummary()?.id;
    return openStorySession(sessionId);
  }

  async function continueStoryProject(projectId) {
    const project = (state.storyProjects || []).find((item) => item.id === projectId);
    if (!project) return null;
    if (project.activeSessionId) {
      return openStorySession(project.activeSessionId);
    }
    if (project.lifecycleState === 'detached'
      || project.lifecycle?.state === 'detached'
      || project.canCreateSession === false) {
      setStatus(els.storyLauncherStatus, '这个故事的原剧本素材已移除；已有存档仍可继续，但不能创建新卷。', 'error');
      return null;
    }
    setStatus(els.storyLauncherStatus, `正在为《${project.title}》创建第一卷...`, 'busy');
    try {
      const payload = await apiRequest(
        `/api/story-projects/${encodeURIComponent(project.id)}/sessions`,
        {
          method: 'POST',
          body: {}
        }
      );
      return openStorySession(payload.session.id, payload.visualPackId);
    } catch (error) {
      setStatus(els.storyLauncherStatus, `创建存档失败：${humanizeApiError(error)}`, 'error');
      return null;
    }
  }

  function handleStoryPackClick(event) {
    const compatibility = event.target.closest('[data-review-story-pack-compatibility]');
    if (compatibility) {
      const pack = (state.contentPacks || [])
        .find((item) => item.id === compatibility.dataset.reviewStoryPackCompatibility);
      if (!pack) return;
      void onReviewPackCompatibility(pack, {
        reportStatus: (message, tone) => setStatus(els.storyLauncherStatus, message, tone)
      });
      return;
    }
    const edit = event.target.closest('[data-edit-story-pack]');
    if (edit) {
      openStoryEditDialog('pack', edit.dataset.editStoryPack);
      return;
    }
    const remove = event.target.closest('[data-delete-story-pack]');
    if (remove) {
      void deleteStoryPack(remove.dataset.deleteStoryPack);
      return;
    }
    const derive = event.target.closest('[data-derive-story-pack]');
    if (derive) {
      openDerivedStoryBuilder(derive.dataset.deriveStoryPack);
      return;
    }
    const action = event.target.closest('[data-start-story-pack]');
    if (action) void startStoryFromPack(action.dataset.startStoryPack, action);
  }

  function handleStoryProjectClick(event) {
    const edit = event.target.closest('[data-edit-story-project]');
    if (edit) {
      openStoryEditDialog('project', edit.dataset.editStoryProject);
      return;
    }
    const remove = event.target.closest('[data-delete-story-project]');
    if (remove) {
      void deleteStoryProject(remove.dataset.deleteStoryProject);
      return;
    }
    const action = event.target.closest('[data-open-story-session]');
    if (action) {
      void openStorySession(action.dataset.openStorySession);
      return;
    }
    const projectAction = event.target.closest('[data-open-story-project]');
    if (projectAction) void continueStoryProject(projectAction.dataset.openStoryProject);
  }

  function bindEvents() {
    if (eventsBound) return;
    eventsBound = true;
    els.continueLastStory?.addEventListener('click', () => {
      void continueLastStory();
    });
    els.deleteContinueStory?.addEventListener('click', () => {
      void deleteContinueStory();
    });
    els.storyPackSearch?.addEventListener('input', renderStoryPackGrid);
    els.storyCategoryFilter?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-story-category]');
      if (button) setStoryCatalogCategory(button.dataset.storyCategory);
    });
    (els.storyViewButtons || []).forEach((button) => {
      button.addEventListener('click', () => setStoryCatalogView(button.dataset.storyView));
    });
    els.storyEditDialog?.addEventListener('click', (event) => {
      if (event.target === els.storyEditDialog) closeStoryEditDialog();
    });
    els.closeStoryEditDialog?.addEventListener('click', closeStoryEditDialog);
    els.cancelStoryEdit?.addEventListener('click', closeStoryEditDialog);
    els.storyEditForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      void saveStoryEdit();
    });
    els.storyPackGrid?.addEventListener('click', handleStoryPackClick);
    els.storyPackGrid?.addEventListener('pointerover', previewStoryPackFromEvent);
    els.storyPackGrid?.addEventListener('focusin', previewStoryPackFromEvent);
    els.storyProjectList?.addEventListener('click', handleStoryProjectClick);
    storyProjectLibraryView.bindEvents();
  }

  return {
    bindEvents,
    closeStoryEditDialog,
    continueLastStory,
    continueStoryProject,
    createAndOpenStoryProject,
    deleteContinueStory,
    createStoryPackCard,
    deleteStoryPack,
    deleteStoryProject,
    getMostRecentSessionSummary,
    getStoryEditTarget: () => storyEditTarget,
    getStoryPackCategories,
    getStoryPackVisualId,
    openStoryEditDialog,
    openStorySession,
    renderStoryCatalogFilters,
    renderStoryContinuePanel,
    renderStoryPackGrid,
    renderStoryProjects,
    saveStoryEdit,
    setAllStoriesView: storyProjectLibraryView.setActive,
    setStoryCatalogCategory,
    setStoryCatalogView,
    setStoryLauncherBackground,
    startStoryFromPack
  };
}
