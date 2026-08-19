import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STORY_CATALOG_CATEGORY_KEY,
  STORY_CATALOG_VIEW_KEY,
  createStoryCatalogController,
  formatStoryDate,
  loadStoryCatalogPreferences,
  resolveStoryStageBackground,
  selectMostRecentSessionSummary
} from '../public/modules/storyCatalog.js';
import { createCharacterPresentation } from '../public/modules/characterPresentation.js';
import { getStoryPackVisualId } from '../public/modules/storyLauncher.js';

test('unknown and unbound custom stories use the neutral visual preset', () => {
  assert.equal(getStoryPackVisualId({ id: 'custom-unknown', custom: true }), 'neutral');
  assert.equal(getStoryPackVisualId('missing-pack', []), 'neutral');
});

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(...values) {
    values.forEach((value) => this.values.add(value));
  }

  remove(...values) {
    values.forEach((value) => this.values.delete(value));
  }

  toggle(value, force) {
    const active = force === undefined ? !this.values.has(value) : Boolean(force);
    if (active) this.values.add(value);
    else this.values.delete(value);
    return active;
  }

  contains(value) {
    return this.values.has(value);
  }
}

class FakeStyle {
  constructor() {
    this.values = new Map();
  }

  setProperty(name, value) {
    this.values.set(name, value);
  }

  getPropertyValue(name) {
    return this.values.get(name) || '';
  }
}

class FakeElement {
  constructor(tagName = 'div', { fragment = false } = {}) {
    this.tagName = tagName.toUpperCase();
    this.isFragment = fragment;
    this.children = [];
    this.listeners = new Map();
    this.dataset = {};
    this.attributes = new Map();
    this.classList = new FakeClassList();
    this.style = new FakeStyle();
    this.className = '';
    this.textContent = '';
    this.value = '';
    this.title = '';
    this.hidden = false;
    this.disabled = false;
    this.open = false;
    this.focused = false;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  append(...children) {
    children.forEach((child) => {
      if (child?.isFragment) this.children.push(...child.children);
      else this.children.push(child);
    });
  }

  replaceChildren(...children) {
    this.children = [];
    this.textContent = '';
    this.append(...children);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  showModal() {
    this.open = true;
  }

  close() {
    this.open = false;
  }

  focus() {
    this.focused = true;
  }
}

function createFakeDocument() {
  return {
    createElement: (tagName) => new FakeElement(tagName),
    createTextNode: (text) => {
      const node = new FakeElement('#text');
      node.textContent = String(text);
      return node;
    },
    createDocumentFragment: () => new FakeElement('#fragment', { fragment: true })
  };
}

function findNode(root, predicate) {
  if (predicate(root)) return root;
  for (const child of root?.children || []) {
    const found = findNode(child, predicate);
    if (found) return found;
  }
  return null;
}

function createHarness(options = {}) {
  const builtinPack = {
    id: 'xuanhuan',
    title: '玄荒行纪',
    description: '荒原与宗门',
    version: '1.2.0',
    visualPackId: 'xuanhuan',
    counts: { worldBook: 8, characterPresets: 3, promptModules: 2 }
  };
  const customPack = {
    id: 'custom-pack',
    title: '月下山门',
    description: '本地派生剧本',
    custom: true,
    compatibilityAudit: {
      status: 'audited',
      label: 'v2 已审核',
      tone: 'ok',
      reason: '组装记录符合当前酒馆兼容契约。',
      canStartNewStory: true,
      action: 'none'
    },
    basePackId: 'xianxia',
    visualPackId: 'xianxia',
    characterName: '沈观澜',
    characterPortrait: {
      url: '/api/character-images/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png'
    },
    stageBackground: {
      url: '/api/character-images/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png',
      source: 'character-portrait',
      label: '沈观澜立绘'
    }
  };
  const state = {
    contentPacks: [builtinPack, customPack],
    storyProjects: [{
      id: 'project-1',
      title: '旧卷',
      description: '第一卷',
      basePackId: 'xuanhuan',
      basePackTitle: '玄荒行纪',
      sessionCount: 1,
      activeSessionId: 'session-active',
      updatedAt: '2026-07-31T08:00:00.000Z'
    }],
    sessionSummaries: [{
      id: 'session-active',
      title: '旧卷存档',
      packId: 'xuanhuan',
      messageCount: 4,
      updatedAt: '2026-07-31T08:00:00.000Z'
    }],
    storyCatalogView: 'grid',
    storyCatalogCategory: 'all',
    session: { id: 'main', settings: {} }
  };
  const els = {
    storyCategoryFilter: new FakeElement(),
    storyViewButtons: [new FakeElement('button'), new FakeElement('button')],
    storyPackGrid: new FakeElement(),
    storyPackSearch: new FakeElement('input'),
    storyProjectList: new FakeElement(),
    storyProjectCount: new FakeElement(),
    viewAllStoriesBtn: new FakeElement('button'),
    viewAllStoriesLabel: new FakeElement('span'),
    storyContinuePanel: new FakeElement(),
    storyContinueTitle: new FakeElement(),
    storyContinueMeta: new FakeElement(),
    continueLastStory: new FakeElement('button'),
    storyLauncher: new FakeElement(),
    storyLauncherStatus: new FakeElement(),
    appStatus: new FakeElement(),
    storyEditDialog: new FakeElement('dialog'),
    storyEditDialogTitle: new FakeElement(),
    storyEditTitle: new FakeElement('input'),
    storyEditDescription: new FakeElement('textarea'),
    storyEditStatus: new FakeElement(),
    storyEditForm: new FakeElement('form'),
    closeStoryEditDialog: new FakeElement('button'),
    cancelStoryEdit: new FakeElement('button')
  };
  els.storyViewButtons[0].dataset.storyView = 'grid';
  els.storyViewButtons[1].dataset.storyView = 'list';

  const requests = [];
  const statuses = [];
  const selectedSessions = [];
  const visualLinks = [];
  const derivedPacks = [];
  const reviewedPacks = [];
  const storageValues = new Map();
  let closeCount = 0;
  let loadCount = 0;
  let renderCount = 0;

  const apiRequest = options.apiRequest || (async (path, requestOptions = {}) => {
    requests.push([path, requestOptions]);
    if (path === '/api/story-projects') {
      return { project: { id: 'project-new', title: requestOptions.body.title } };
    }
    if (path === '/api/story-projects/project-new/sessions') {
      return {
        session: { id: 'session-new', settings: {} },
        visualPackId: 'xianxia'
      };
    }
    return {};
  });
  const documentObject = createFakeDocument();
  const characterPresentation = createCharacterPresentation({ documentObject });

  const controller = createStoryCatalogController({
    state,
    els,
    apiRequest: async (...args) => {
      if (options.apiRequest) requests.push(args);
      return apiRequest(...args);
    },
    getContentPackVisualPreset: (packId) => ({
      packId: packId || 'xuanhuan',
      backgroundImage: `/assets/${packId || 'xuanhuan'}-stage.png`
    }),
    getCharacterPortraitUrl: characterPresentation.getCharacterPortraitUrl,
    createCharacterPortraitImage: characterPresentation.createCharacterPortraitImage,
    storyPackPresentation: {
      xuanhuan: { badge: '玄荒', accent: '#c88a45' },
      xianxia: { badge: '仙侠', accent: '#77aacc' }
    },
    visualPackIds: new Set(['xuanhuan', 'xianxia']),
    selectSession: (sessionId) => selectedSessions.push(sessionId),
    closeStoryLauncher: () => {
      closeCount += 1;
    },
    loadState: async () => {
      loadCount += 1;
      state.session = { id: selectedSessions.at(-1), settings: {} };
    },
    linkContentPackVisuals: async (...args) => {
      visualLinks.push(args);
    },
    renderMessages: () => {
      renderCount += 1;
    },
    openDerivedStoryBuilder: (packId) => derivedPacks.push(packId),
    onReviewPackCompatibility: async (pack, options) => {
      reviewedPacks.push({ pack, options });
      return { kind: 'review-opened' };
    },
    setStatus: (element, message, tone) => statuses.push({ element, message, tone }),
    humanizeApiError: (error) => error.message,
    storage: {
      getItem: (key) => storageValues.get(key) || null,
      setItem: (key, value) => storageValues.set(key, value)
    },
    confirmAction: options.confirmAction || (() => true),
    documentObject,
    setTimeoutImpl: (callback) => callback()
  });

  return {
    builtinPack,
    controller,
    customPack,
    derivedPacks,
    reviewedPacks,
    els,
    get closeCount() {
      return closeCount;
    },
    get loadCount() {
      return loadCount;
    },
    get renderCount() {
      return renderCount;
    },
    requests,
    selectedSessions,
    state,
    statuses,
    storageValues,
    visualLinks
  };
}

test('story catalog preferences normalize local storage and fail closed', () => {
  const values = new Map([
    [STORY_CATALOG_VIEW_KEY, 'list'],
    [STORY_CATALOG_CATEGORY_KEY, 'xianxia']
  ]);
  assert.deepEqual(loadStoryCatalogPreferences({
    getItem: (key) => values.get(key)
  }), {
    view: 'list',
    category: 'xianxia'
  });
  assert.deepEqual(loadStoryCatalogPreferences({
    getItem: () => {
      throw new Error('storage denied');
    }
  }), {
    view: 'grid',
    category: 'all'
  });
});

test('recent-session selection prioritizes conversations, projects, then non-main sessions', () => {
  assert.equal(selectMostRecentSessionSummary([
    { id: 'main' },
    { id: 'legacy' },
    { id: 'project', storyProjectId: 'p1' },
    { id: 'active', messageCount: 2 }
  ]).id, 'active');
  assert.equal(selectMostRecentSessionSummary([
    { id: 'main' },
    { id: 'project', storyProjectId: 'p1' }
  ]).id, 'project');
  assert.equal(selectMostRecentSessionSummary([{ id: 'main' }]), null);
  assert.equal(formatStoryDate('not-a-date'), '');
});

test('story stage backgrounds only accept resolved character portraits', () => {
  const resolvePortrait = (stage) => stage?.assetId ? `/api/assets/${stage.assetId}/content` : '';
  assert.deepEqual(resolveStoryStageBackground({
    characterName: '沈砚',
    stageBackground: {
      assetId: 'portrait-1',
      source: 'character-portrait'
    }
  }, resolvePortrait), {
    url: '/api/assets/portrait-1/content',
    fit: 'portrait',
    source: 'character-portrait',
    label: '沈砚立绘'
  });
  assert.equal(resolveStoryStageBackground({
    stageBackground: {
      assetId: 'background-1',
      source: 'uploaded-background'
    }
  }, resolvePortrait), null);
  assert.equal(resolveStoryStageBackground({
    stageBackground: {
      source: 'character-portrait'
    }
  }, resolvePortrait), null);
});

test('catalog filters and view selection render counts and persist normalized preferences', () => {
  const harness = createHarness();
  harness.controller.renderStoryCatalogFilters();

  const categoryIds = harness.els.storyCategoryFilter.children
    .map((button) => button.dataset.storyCategory);
  assert.deepEqual(categoryIds, ['all', 'xuanhuan', 'xianxia', 'custom']);
  assert.equal(harness.els.storyCategoryFilter.children[0].children[1].textContent, '2');

  harness.controller.setStoryCatalogView('list');
  harness.controller.setStoryCatalogCategory('unknown');

  assert.equal(harness.state.storyCatalogView, 'list');
  assert.equal(harness.state.storyCatalogCategory, 'all');
  assert.equal(harness.storageValues.get(STORY_CATALOG_VIEW_KEY), 'list');
  assert.equal(harness.storageValues.get(STORY_CATALOG_CATEGORY_KEY), 'all');
  assert.equal(harness.els.storyPackGrid.dataset.view, 'list');
});

test('story cards distinguish built-in, custom, blocked, and character-stage packs', () => {
  const harness = createHarness();
  const customCard = harness.controller.createStoryPackCard(harness.customPack);
  const builtinCard = harness.controller.createStoryPackCard({
    ...harness.builtinPack,
    compatibility: { compatible: false, blockingCount: 2 }
  });

  assert.equal(customCard.dataset.storyPackCard, 'custom-pack');
  assert.equal(customCard.classList.contains('has-character-stage'), true);
  assert.match(customCard.style.getPropertyValue('--story-card-image'), /character-images/);
  assert.equal(
    findNode(customCard, (node) => node.className === 'story-card-badge').textContent,
    '我的剧本'
  );
  assert.equal(
    findNode(customCard, (node) => node.dataset?.deleteStoryPack === 'custom-pack').textContent,
    '删除'
  );
  assert.equal(
    findNode(customCard, (node) => String(node.className).includes('story-card-compatibility')).textContent,
    'v2 已审核'
  );
  const blockedAction = findNode(
    builtinCard,
    (node) => node.dataset?.startStoryPack === harness.builtinPack.id
  );
  assert.equal(blockedAction.disabled, true);
  assert.equal(blockedAction.textContent, '依赖不完整，暂不可开局');
});

test('historical custom story cards make compatibility review the visible primary action', async () => {
  const harness = createHarness();
  const legacyPack = {
    ...harness.customPack,
    id: 'custom-legacy',
    compatibilityAudit: {
      status: 'upgrade-available',
      label: '需要 v2 复审',
      tone: 'warning',
      reason: '历史包缺少当前契约审计。',
      canStartNewStory: false,
      action: 'upgrade'
    }
  };
  harness.state.contentPacks.push(legacyPack);
  const card = harness.controller.createStoryPackCard(legacyPack);
  const review = findNode(card, (node) => node.dataset?.reviewStoryPackCompatibility === legacyPack.id);

  assert.equal(findNode(card, (node) => node.dataset?.startStoryPack === legacyPack.id), null);
  assert.equal(review.disabled, false);
  assert.equal(review.textContent, '生成兼容新版');
  assert.equal(await harness.controller.startStoryFromPack(legacyPack.id), null);
  assert.deepEqual(harness.requests, []);
  assert.match(harness.statuses.at(-1).message, /历史包缺少当前契约审计/);
});

test('script-review cards route their primary action into the compatibility review flow', async () => {
  const harness = createHarness();
  const reviewPack = {
    ...harness.customPack,
    id: 'custom-script-review',
    compatibilityAudit: {
      status: 'script-review-required',
      label: '脚本待逐项审核',
      tone: 'review',
      reason: '必须查看第三方脚本源码，并按当前内容哈希逐项批准。',
      canStartNewStory: false,
      action: 'review-scripts'
    }
  };
  harness.state.contentPacks.push(reviewPack);
  harness.controller.renderStoryPackGrid();
  harness.controller.bindEvents();
  const review = findNode(
    harness.els.storyPackGrid,
    (node) => node.dataset?.reviewStoryPackCompatibility === reviewPack.id
  );

  assert.equal(review.disabled, false);
  assert.equal(review.textContent, '逐项审核后新建对话');
  harness.els.storyPackGrid.listeners.get('click')[0]({
    target: {
      closest: (selector) => (
        selector === '[data-review-story-pack-compatibility]' ? review : null
      )
    }
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(harness.reviewedPacks.length, 1);
  assert.equal(harness.reviewedPacks[0].pack.id, reviewPack.id);
});

test('continue panel and project shelf render the selected local state', () => {
  const harness = createHarness();

  harness.controller.renderStoryContinuePanel();
  harness.controller.renderStoryProjects();

  assert.equal(harness.els.storyContinuePanel.hidden, false);
  assert.equal(harness.els.storyContinueTitle.textContent, '旧卷存档');
  assert.match(harness.els.storyContinueMeta.textContent, /玄荒行纪 · 4 条消息/);
  assert.equal(harness.els.continueLastStory.dataset.sessionId, 'session-active');
  assert.equal(harness.els.storyProjectCount.textContent, '1');
  const projectItem = findNode(
    harness.els.storyProjectList,
    (node) => node.dataset?.openStoryProject === 'project-1'
  );
  assert.equal(projectItem.title, '继续故事');
  assert.deepEqual(
    projectItem.children.map((node) => node.className),
    ['story-project-thumb', 'story-project-copy', 'story-project-actions']
  );
  assert.equal(
    findNode(projectItem, (node) => node.dataset?.editStoryProject === 'project-1').textContent,
    '编辑'
  );
  assert.equal(
    findNode(projectItem, (node) => node.dataset?.deleteStoryProject === 'project-1').textContent,
    '删除'
  );
});

test('view-all stories toggles a full project-library view and can return to the catalog', () => {
  const harness = createHarness();
  harness.controller.bindEvents();
  const click = harness.els.viewAllStoriesBtn.listeners.get('click')[0];

  click();
  assert.equal(harness.els.storyLauncher.classList.contains('is-project-library-view'), true);
  assert.equal(harness.els.viewAllStoriesBtn.attributes.get('aria-pressed'), 'true');
  assert.equal(harness.els.viewAllStoriesLabel.textContent, '返回剧本目录');
  assert.equal(harness.els.storyProjectList.children[0].focused, true);

  click();
  assert.equal(harness.els.storyLauncher.classList.contains('is-project-library-view'), false);
  assert.equal(harness.els.viewAllStoriesBtn.attributes.get('aria-pressed'), 'false');
  assert.equal(harness.els.viewAllStoriesLabel.textContent, '查看全部故事');
});

test('project delete action remains visible and delegates to the protected deletion flow', async () => {
  const harness = createHarness({
    apiRequest: async (path) => (
      path.endsWith('/deletion-impact')
        ? { impact: { sessions: [], missingSessionIds: [] } }
        : { backup: { id: 'backup-project' } }
    )
  });
  harness.controller.renderStoryProjects();
  harness.controller.bindEvents();
  const deleteButton = findNode(
    harness.els.storyProjectList,
    (node) => node.dataset?.deleteStoryProject === 'project-1'
  );
  const click = harness.els.storyProjectList.listeners.get('click')[0];

  click({
    target: {
      closest: (selector) => selector === '[data-delete-story-project]' ? deleteButton : null
    }
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(harness.requests, [
    ['/api/story-projects/project-1/deletion-impact'],
    ['/api/story-projects/project-1', {
      method: 'DELETE',
      body: { confirmDelete: true, deleteSessions: true }
    }]
  ]);
  assert.deepEqual(harness.state.storyProjects, []);
});

test('project editing uses the exact API contract and replaces the shelf summary', async () => {
  const updated = {
    id: 'project-1',
    title: '新卷名',
    description: '新说明',
    basePackId: 'xuanhuan',
    sessionCount: 1
  };
  const harness = createHarness({
    apiRequest: async () => ({ summary: updated })
  });
  harness.controller.openStoryEditDialog('project', 'project-1');
  harness.els.storyEditTitle.value = ' 新卷名 ';
  harness.els.storyEditDescription.value = '新说明';

  const result = await harness.controller.saveStoryEdit();

  assert.deepEqual(harness.requests, [[
    '/api/story-projects/project-1',
    {
      method: 'PUT',
      body: { title: '新卷名', description: '新说明' }
    }
  ]]);
  assert.deepEqual(result, updated);
  assert.deepEqual(harness.state.storyProjects, [updated]);
  assert.equal(harness.controller.getStoryEditTarget(), null);
  assert.equal(harness.els.storyEditDialog.open, false);
});

test('custom-pack editing refreshes the authoritative content-pack catalog', async () => {
  const refreshedPack = {
    id: 'custom-pack',
    title: '改名后的山门',
    custom: true,
    visualPackId: 'xianxia'
  };
  const harness = createHarness({
    apiRequest: async (path) => (
      path === '/api/content-packs' ? { contentPacks: [refreshedPack] } : {}
    )
  });
  harness.controller.openStoryEditDialog('pack', 'custom-pack');
  harness.els.storyEditTitle.value = '改名后的山门';
  harness.els.storyEditDescription.value = '更新说明';

  const result = await harness.controller.saveStoryEdit();

  assert.deepEqual(harness.requests, [
    [
      '/api/resource-library/packs/custom-pack',
      {
        method: 'PATCH',
        body: {
          title: '改名后的山门',
          description: '更新说明',
          sessionTitle: '改名后的山门'
        }
      }
    ],
    ['/api/content-packs']
  ]);
  assert.deepEqual(result, refreshedPack);
  assert.deepEqual(harness.state.contentPacks, [refreshedPack]);
});

test('deleting shelf projects removes linked progress after backup while pack removal still detaches', async () => {
  const confirmations = [];
  const harness = createHarness({
    apiRequest: async (path) => {
      if (path === '/api/story-projects/project-1/deletion-impact') {
        return {
          impact: {
            sessions: [{ id: 'session-active' }],
            projects: [],
            missingSessionIds: []
          }
        };
      }
      if (path === '/api/resource-library/packs/custom-pack/deletion-impact') {
        return {
          impact: {
            sessions: [{ id: 'session-custom' }],
            projects: [{ id: 'project-custom' }],
            missingSessionIds: []
          }
        };
      }
      if (path === '/api/story-projects/project-1') {
        return { backup: { id: 'backup-safe' }, deletedSessionIds: ['session-active'] };
      }
      return { backup: { id: 'backup-safe' }, detachedProjects: [] };
    },
    confirmAction: (message) => {
      confirmations.push(message);
      return true;
    }
  });

  assert.equal(await harness.controller.deleteStoryProject('project-1'), true);
  assert.equal(await harness.controller.deleteStoryPack('custom-pack'), true);

  assert.match(confirmations[0], /同时删除 1 个运行进度及其消息/);
  assert.match(confirmations[0], /自动创建本地安全备份/);
  assert.match(confirmations[1], /影响范围：1 个故事、1 个会话/);
  assert.match(confirmations[1], /角色卡、世界书原素材和消息都会保留/);
  assert.deepEqual(harness.state.storyProjects, []);
  assert.deepEqual(harness.state.contentPacks.map((pack) => pack.id), ['xuanhuan']);
  assert.deepEqual(harness.requests, [
    ['/api/story-projects/project-1/deletion-impact'],
    ['/api/story-projects/project-1', {
      method: 'DELETE',
      body: { confirmDelete: true, deleteSessions: true }
    }],
    ['/api/resource-library/packs/custom-pack/deletion-impact'],
    ['/api/resource-library/packs/custom-pack', {
      method: 'DELETE',
      body: { confirmDetach: true }
    }]
  ]);
});

test('continue card can delete a previously detached running session and falls back safely', async () => {
  const confirmations = [];
  const harness = createHarness({
    apiRequest: async () => ({ deleted: true, id: 'session-active' }),
    confirmAction: (message) => {
      confirmations.push(message);
      return true;
    }
  });
  harness.state.session = { id: 'session-active', settings: {} };
  harness.controller.renderStoryContinuePanel();

  assert.equal(await harness.controller.deleteContinueStory(), true);
  assert.match(confirmations[0], /删除当前运行进度/);
  assert.deepEqual(harness.requests[0], [
    '/api/sessions/session-active',
    { method: 'DELETE' }
  ]);
  assert.deepEqual(harness.selectedSessions, ['main']);
  assert.equal(harness.state.sessionSummaries.length, 0);
});

test('detached story projects keep existing sessions available but cannot create a new volume', async () => {
  const harness = createHarness();
  const project = harness.state.storyProjects[0];
  project.lifecycleState = 'detached';
  project.canCreateSession = false;

  harness.controller.renderStoryProjects();
  const open = findNode(
    harness.els.storyProjectList,
    (node) => node.dataset?.openStoryProject === 'project-1'
  );
  assert.equal(open.disabled, false);
  assert.equal(open.title, '继续已有独立存档');
  assert.match(
    findNode(open, (node) => node.className === 'story-project-status').textContent,
    /素材已解绑/
  );

  project.activeSessionId = '';
  harness.controller.renderStoryProjects();
  const disabledOpen = findNode(
    harness.els.storyProjectList,
    (node) => node.dataset?.openStoryProject === 'project-1'
  );
  assert.equal(disabledOpen.disabled, true);
  assert.equal(disabledOpen.title, '原剧本素材已移除，不能创建新卷');
  assert.equal(await harness.controller.continueStoryProject('project-1'), null);
  assert.deepEqual(harness.requests, []);
  assert.match(harness.statuses.at(-1).message, /不能创建新卷/);
});

test('new story creation owns project, session, visual, and navigation sequencing', async () => {
  const harness = createHarness();

  const result = await harness.controller.createAndOpenStoryProject(
    harness.customPack,
    { title: '新故事' }
  );

  assert.deepEqual(harness.requests, [
    [
      '/api/story-projects',
      {
        method: 'POST',
        body: {
          basePackId: 'custom-pack',
          title: '新故事',
          description: '本地派生剧本'
        }
      }
    ],
    [
      '/api/story-projects/project-new/sessions',
      {
        method: 'POST',
        body: {}
      }
    ]
  ]);
  assert.deepEqual(harness.selectedSessions, ['session-new']);
  assert.equal(harness.closeCount, 1);
  assert.equal(harness.loadCount, 1);
  assert.equal(harness.renderCount, 1);
  assert.deepEqual(harness.visualLinks, [[
    'xianxia',
    {
      persist: true,
      backgroundImage: harness.customPack.stageBackground.url,
      backgroundFit: 'portrait',
      backgroundSource: 'character-portrait'
    }
  ]]);
  assert.equal(result.session.id, 'session-new');
});

test('continuing a project reuses an active session or creates the first volume', async () => {
  const active = createHarness();
  await active.controller.continueStoryProject('project-1');
  assert.deepEqual(active.selectedSessions, ['session-active']);
  assert.deepEqual(active.requests, []);

  const fresh = createHarness({
    apiRequest: async () => ({
      session: { id: 'session-first' },
      visualPackId: 'xuanhuan'
    })
  });
  fresh.state.storyProjects[0].activeSessionId = '';
  await fresh.controller.continueStoryProject('project-1');
  assert.deepEqual(fresh.requests, [[
    '/api/story-projects/project-1/sessions',
    {
      method: 'POST',
      body: {}
    }
  ]]);
  assert.deepEqual(fresh.selectedSessions, ['session-first']);
  assert.deepEqual(fresh.visualLinks, [['xuanhuan', { persist: true }]]);
});

test('catalog event binding is idempotent and delegates derived-pack actions', () => {
  const harness = createHarness();
  harness.controller.bindEvents();
  harness.controller.bindEvents();

  assert.equal(harness.els.storyPackSearch.listeners.get('input').length, 1);
  assert.equal(harness.els.storyPackGrid.listeners.get('click').length, 1);
  assert.equal(harness.els.storyProjectList.listeners.get('click').length, 1);

  const click = harness.els.storyPackGrid.listeners.get('click')[0];
  click({
    target: {
      closest: (selector) => (
        selector === '[data-derive-story-pack]'
          ? { dataset: { deriveStoryPack: 'xuanhuan' } }
          : null
      )
    }
  });
  assert.deepEqual(harness.derivedPacks, ['xuanhuan']);
});
