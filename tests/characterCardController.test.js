import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCharacterCardController,
  formatCharacterOverviewValue,
  getCharacterCompatibility,
  inferCharacterContentPackId
} from '../public/modules/characterCard.js';

test('character-card compatibility prefers explicit pack metadata and detects cross-genre cards', () => {
  const card = {
    name: '闻雪照',
    tags: ['仙侠', '修真'],
    extensions: { contentPack: 'xianxia' }
  };
  const knownPackIds = ['xuanhuan', 'xianxia'];

  assert.equal(inferCharacterContentPackId(card, '', knownPackIds), 'xianxia');
  assert.deepEqual(getCharacterCompatibility(card, '', {
    storyPackId: 'xuanhuan',
    knownContentPackIds: knownPackIds
  }), {
    storyPackId: 'xuanhuan',
    characterPackId: 'xianxia',
    mismatched: true
  });
});

test('character-card compatibility still recognizes bundled preset keys and tags', () => {
  assert.equal(inferCharacterContentPackId({}, 'yechenzhou'), 'xuanhuan');
  assert.equal(inferCharacterContentPackId({ tags: ['民俗调查'] }), 'lingyi');
  assert.equal(inferCharacterContentPackId({ tags: ['未知题材'] }), '');
});

test('character overview values flatten nested arrays and objects for readable display', () => {
  assert.equal(formatCharacterOverviewValue({
    身份: '巡夜人',
    资源: ['旧灯', '铜钱'],
    空值: ''
  }), '身份：巡夜人\n资源：旧灯\n铜钱');
});

test('renderCharacterOverview shows a multilingual creator notes section when card declares creator_notes_multilingual', () => {
  const created = [];
  const documentRef = {
    createElement: (tagName) => {
      const el = {
        tagName,
        className: '',
        textContent: '',
        children: [],
        append(...items) { this.children.push(...items); },
        replaceChildren() { this.children.length = 0; }
      };
      created.push(el);
      return el;
    }
  };
  const controller = createCharacterCardController({
    elements: { characterOverview: { replaceChildren() {}, append() {} } },
    getCharacterCard: () => ({
      name: '测试卡',
      creatorNotes: 'Default notes.',
      creatorNotesMultilingual: { en: 'English notes.', zh: '中文注释。' }
    }),
    documentRef
  });
  controller.renderCharacterOverview();
  // 多语言注释区块应包含语言标签与对应文本
  const langLabels = created.filter((el) => el.textContent === 'English' || el.textContent === '中文');
  assert.ok(langLabels.length >= 2, '应渲染 en 和 zh 语言标签');
  const noteTexts = created.filter((el) => el.textContent === 'English notes.' || el.textContent === '中文注释。');
  assert.equal(noteTexts.length, 2, '应渲染两种语言的注释文本');
});

test('renderCharacterOverview omits multilingual section when no creator_notes_multilingual is present', () => {
  const created = [];
  const documentRef = {
    createElement: (tagName) => {
      const el = {
        tagName,
        className: '',
        textContent: '',
        children: [],
        append(...items) { this.children.push(...items); },
        replaceChildren() { this.children.length = 0; }
      };
      created.push(el);
      return el;
    }
  };
  const controller = createCharacterCardController({
    elements: { characterOverview: { replaceChildren() {}, append() {} } },
    getCharacterCard: () => ({ name: '无多语言卡', creatorNotes: '单一注释。' }),
    documentRef
  });
  controller.renderCharacterOverview();
  const multilingualHeader = created.find((el) => el.textContent === '多语言注释');
  assert.equal(multilingualHeader, undefined, '无多语言注释时不应渲染该区块');
});

function createStubDocument(created) {
  return {
    createElement: (tagName) => {
      const el = {
        tagName,
        className: '',
        textContent: '',
        src: '',
        alt: '',
        children: [],
        listeners: {},
        append(...items) { this.children.push(...items); },
        replaceChildren() { this.children.length = 0; },
        addEventListener(type, handler) { this.listeners[type] = handler; },
        querySelector() { return null; },
        prepend(item) { this.children.unshift(item); }
      };
      created.push(el);
      return el;
    }
  };
}

test('renderCharacterOverview renders V3 assets with proxied external images and safe uri filtering', () => {
  const created = [];
  const documentRef = createStubDocument(created);
  const controller = createCharacterCardController({
    elements: { characterOverview: { replaceChildren() {}, append() {} } },
    getCharacterCard: () => ({
      name: 'V3 资产卡',
      sourceSpec: 'chara_card_v3',
      assets: [
        { type: 'image', name: '立绘.png', ext: 'png', uri: 'https://example.com/portrait.png' },
        { type: 'music', name: '主题曲.mp3', ext: 'mp3', uri: 'https://example.com/theme.mp3' },
        { type: 'image', name: '危险图.png', ext: 'png', uri: 'javascript:alert(1)' },
        { type: 'image', name: '内联图.png', ext: 'png', uri: 'data:image/png;base64,AAAA' },
        { type: 'icon', name: '头像.png', ext: 'png', uri: '/assets/local-avatar.png' }
      ]
    }),
    documentRef
  });
  controller.renderCharacterOverview();

  // spec 徽章
  const specBadge = created.find((el) => el.textContent === 'V3 卡');
  assert.ok(specBadge, '应渲染 V3 卡规范徽章');

  // assets 标题
  const assetsHeader = created.find((el) => el.textContent === '卡内素材（5）');
  assert.ok(assetsHeader, '应渲染卡内素材区块标题');

  // 外链图片走代理
  const images = created.filter((el) => el.tagName === 'img');
  const proxied = images.find((el) => el.src === '/api/proxy-image?url=https%3A%2F%2Fexample.com%2Fportrait.png');
  assert.ok(proxied, '外链图片应经 /api/proxy-image 代理');
  // 同源相对路径直连
  const relative = images.find((el) => el.src === '/assets/local-avatar.png');
  assert.ok(relative, '同源相对路径图片应直接引用');
  // javascript:/data: URI 一律不生成 img
  const dangerous = images.filter((el) => el.src.includes('javascript:') || el.src.includes('data:'));
  assert.equal(dangerous.length, 0, '危险 URI 不应进入 img.src');

  // 音乐类素材无预览图，显示类型占位
  const fallbacks = created.filter((el) => el.className === 'character-asset-fallback');
  assert.equal(fallbacks.length, 3, '音乐 + 两个危险 URI 共 3 个占位');
});

test('renderCharacterOverview omits assets section when card has no assets', () => {
  const created = [];
  const documentRef = createStubDocument(created);
  const controller = createCharacterCardController({
    elements: { characterOverview: { replaceChildren() {}, append() {} } },
    getCharacterCard: () => ({ name: '普通卡' }),
    documentRef
  });
  controller.renderCharacterOverview();
  const assetsHeader = created.find((el) => String(el.textContent).startsWith('卡内素材'));
  assert.equal(assetsHeader, undefined, '无 assets 时不应渲染素材区块');
});

test('character-card controller saves editor state with the active session id', async () => {
  const editor = { value: '' };
  const saveButton = { disabled: false };
  const status = {};
  const statusUpdates = [];
  const requests = [];
  let activeCard = {};
  const controller = createCharacterCardController({
    elements: {
      characterCardEditor: editor,
      saveCharacterCard: saveButton,
      characterCardStatus: status
    },
    apiRequest: async (path, options) => {
      requests.push({ path, options });
      return { characterCard: { ...options.body.characterCard, saved: true } };
    },
    getSessionId: () => 'session-42',
    getCharacterCard: () => activeCard,
    setCharacterCard: (card) => {
      activeCard = card;
    },
    createCharacterCardTemplate: () => ({ name: '未命名主角' }),
    setStatus: (_element, text, tone) => statusUpdates.push({ text, tone }),
    documentRef: null
  });

  controller.setCharacterCardEditor({ name: '沈观澜' });
  assert.match(editor.value, /"name": "沈观澜"/);
  editor.value = JSON.stringify({ name: '闻雪照' });

  const saved = await controller.saveCharacterCard();
  assert.deepEqual(saved, { name: '闻雪照', saved: true });
  assert.deepEqual(activeCard, saved);
  assert.equal(requests[0].path, '/api/character-card');
  assert.deepEqual(requests[0].options.body, {
    sessionId: 'session-42',
    characterCard: { name: '闻雪照' }
  });
  assert.equal(saveButton.disabled, false);
  assert.deepEqual(statusUpdates.at(-1), { text: '角色卡已保存', tone: 'ok' });
});

test('character-card controller keeps invalid JSON local and does not call the API', async () => {
  let requestCount = 0;
  const statusUpdates = [];
  const controller = createCharacterCardController({
    elements: {
      characterCardEditor: { value: '{bad json' },
      saveCharacterCard: { disabled: false },
      characterCardStatus: {}
    },
    apiRequest: async () => {
      requestCount += 1;
      return {};
    },
    setStatus: (_element, text, tone) => statusUpdates.push({ text, tone }),
    documentRef: null
  });

  assert.equal(await controller.saveCharacterCard(), null);
  assert.equal(requestCount, 0);
  assert.deepEqual(statusUpdates.at(-1), {
    text: '保存失败：角色卡 JSON 解析失败',
    tone: 'error'
  });
});

test('favorite loading keeps character, world book, and prompt modules in one session', async () => {
  const requests = [];
  const preset = {
    id: 'favorite-1',
    name: '望舒旧案',
    characterCard: { name: '闻雪照' },
    worldBook: [{ id: 'lore-1', title: '望舒仙市' }],
    promptModules: [{ id: 'prompt-1', content: '保持仙侠因果。' }]
  };
  const controller = createCharacterCardController({
    elements: {
      characterPresetFavorites: { value: preset.id },
      loadCharacterPreset: { dataset: {}, textContent: '加载' },
      characterCardStatus: {}
    },
    apiRequest: async (path, options) => {
      requests.push({ path, options });
      if (path === '/api/character-card') return { characterCard: preset.characterCard };
      if (path === '/api/world-book') return { worldBook: preset.worldBook };
      return { promptModules: preset.promptModules };
    },
    getSessionId: () => 'story-session',
    getCharacterPresets: () => [preset],
    getKnownContentPackIds: () => ['xianxia'],
    setStatus: () => {},
    documentRef: null
  });

  await controller.loadCharacterPresetFavorite();

  assert.deepEqual(requests.map(({ path, options }) => ({
    path,
    sessionId: options.body.sessionId
  })), [
    { path: '/api/character-card', sessionId: 'story-session' },
    { path: '/api/world-book', sessionId: 'story-session' },
    { path: '/api/prompt-modules', sessionId: 'story-session' }
  ]);
});

test('imported character resources appear beside built-in presets and load as editable drafts', () => {
  const groups = [];
  const statusUpdates = [];
  const presetSelect = {
    value: '',
    querySelector: (selector) => groups.find((group) => `#${group.id}` === selector) || null,
    append: (group) => groups.push(group)
  };
  const documentRef = {
    createElement: (tagName) => ({
      tagName,
      children: [],
      append(child) {
        this.children.push(child);
      },
      remove() {
        const index = groups.indexOf(this);
        if (index >= 0) groups.splice(index, 1);
      }
    })
  };
  const resources = [{
    id: 'maid-card',
    kind: 'character',
    title: '女仆之家',
    payload: { name: '女仆之家', description: '导入的角色设定' }
  }];
  const editor = { value: '' };
  const controller = createCharacterCardController({
    elements: {
      characterPresetSelect: presetSelect,
      characterCardEditor: editor,
      characterCardStatus: {},
      applyCharacterPreset: { dataset: {}, textContent: '加载预设' }
    },
    getResources: () => resources,
    getStaticPresets: () => ({}),
    getDynamicPresets: () => ({}),
    setStatus: (_element, text, tone) => statusUpdates.push({ text, tone }),
    documentRef
  });

  controller.renderCharacterPresetFavorites();
  assert.equal(groups.length, 1);
  assert.equal(groups[0].label, '已导入角色卡');
  assert.equal(groups[0].children[0].value, 'resource-character:maid-card');

  presetSelect.value = 'resource-character:maid-card';
  controller.renderCharacterPresetFavorites();
  assert.equal(presetSelect.value, 'resource-character:maid-card');
  controller.applyCharacterPreset();
  assert.match(editor.value, /"name": "女仆之家"/);
  assert.deepEqual(statusUpdates.at(-1), {
    text: '已加载资源库角色：女仆之家，请点击保存生效',
    tone: 'ok'
  });
});

test('late character preset loads cannot redraw a newer session pack', async () => {
  let sessionId = 'story-a';
  let appliedPackId = 'xuanhuan';
  let resolveOldRequest;
  const oldRequest = new Promise((resolve) => {
    resolveOldRequest = () => resolve({
      characterPresets: [
        { id: 'old-1', name: '旧一', characterCard: { name: '旧一' } },
        { id: 'old-2', name: '旧二', characterCard: { name: '旧二' } }
      ]
    });
  });
  const groups = [];
  const presetSelect = {
    querySelector: (selector) => groups.find((group) => `#${group.id}` === selector) || null,
    append: (group) => groups.push(group)
  };
  const documentRef = {
    createElement: (tagName) => ({
      tagName,
      children: [],
      append(child) {
        this.children.push(child);
      },
      remove() {
        const index = groups.indexOf(this);
        if (index >= 0) groups.splice(index, 1);
      }
    })
  };
  const controller = createCharacterCardController({
    elements: { characterPresetSelect: presetSelect },
    apiRequest: async (path) => {
      if (path.includes('xuanhuan')) return oldRequest;
      return {
        characterPresets: [
          { id: 'new-1', name: '新一', characterCard: { name: '新一' } },
          { id: 'new-2', name: '新二', characterCard: { name: '新二' } }
        ]
      };
    },
    getSessionId: () => sessionId,
    getAppliedContentPackId: () => appliedPackId,
    getDynamicPresets: () => ({}),
    getContentPackGenreTitle: (packId) => packId,
    documentRef
  });

  const oldLoad = controller.loadContentPackCharacterPresets('xuanhuan');
  sessionId = 'story-b';
  appliedPackId = 'lingyi';
  await controller.loadContentPackCharacterPresets('lingyi');

  assert.deepEqual(groups.map((group) => group.id), ['content-pack-character-group-lingyi']);
  resolveOldRequest();
  await oldLoad;
  assert.deepEqual(groups.map((group) => group.id), ['content-pack-character-group-lingyi']);
});
