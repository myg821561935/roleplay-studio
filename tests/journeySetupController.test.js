import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createJourneySetupController,
  getSetupRandomContext
} from '../public/modules/journeySetup.js';

function createClassList(node) {
  const values = new Set();
  return {
    values,
    add(...names) {
      names.forEach((name) => values.add(name));
    },
    remove(...names) {
      names.forEach((name) => values.delete(name));
    },
    toggle(name, enabled) {
      if (enabled === undefined) {
        if (values.has(name)) values.delete(name);
        else values.add(name);
        return values.has(name);
      }
      if (enabled) values.add(name);
      else values.delete(name);
      return enabled;
    },
    contains(name) {
      return values.has(name) || String(node.className || '').split(/\s+/).includes(name);
    }
  };
}

function matchesSelector(node, selector) {
  if (selector.startsWith('.')) return node.classList.contains(selector.slice(1));
  if (selector === '[data-destiny-card]:checked') {
    return Object.hasOwn(node.dataset, 'destinyCard') && node.checked === true;
  }
  if (selector === '[data-setup-field]') {
    return Object.hasOwn(node.dataset, 'setupField');
  }
  return false;
}

function createNode(tagName = 'div', documentObject) {
  const children = [];
  const attributes = {};
  const listeners = {};
  const node = {
    tagName,
    children,
    attributes,
    listeners,
    dataset: {},
    className: '',
    textContent: '',
    title: '',
    value: '',
    checked: false,
    hidden: false,
    parentNode: null,
    append(...nodes) {
      nodes.forEach((child) => {
        if (child && typeof child === 'object') child.parentNode = node;
        children.push(child);
      });
    },
    setAttribute(name, value) {
      attributes[name] = String(value);
    },
    addEventListener(type, listener) {
      listeners[type] = listener;
    },
    querySelectorAll(selector) {
      const matches = [];
      const visit = (current) => {
        current.children?.forEach((child) => {
          if (!child || typeof child !== 'object') return;
          if (matchesSelector(child, selector)) matches.push(child);
          visit(child);
        });
      };
      visit(node);
      return matches;
    },
    querySelector(selector) {
      return node.querySelectorAll(selector)[0] || null;
    },
    focus() {
      documentObject.activeElement = node;
    },
    remove() {
      if (!node.parentNode) return;
      const index = node.parentNode.children.indexOf(node);
      if (index >= 0) node.parentNode.children.splice(index, 1);
      node.parentNode = null;
    }
  };
  node.classList = createClassList(node);
  return node;
}

function createDocument() {
  const documentObject = {
    activeElement: null,
    listeners: {},
    createElement(tagName) {
      return createNode(tagName, documentObject);
    },
    createTextNode(text) {
      const node = createNode('#text', documentObject);
      node.textContent = text;
      return node;
    },
    addEventListener(type, listener) {
      documentObject.listeners[type] = listener;
    },
    removeEventListener(type, listener) {
      if (documentObject.listeners[type] === listener) delete documentObject.listeners[type];
    }
  };
  documentObject.body = createNode('body', documentObject);
  return documentObject;
}

function findNode(root, predicate) {
  if (predicate(root)) return root;
  for (const child of root.children || []) {
    if (!child || typeof child !== 'object') continue;
    const match = findNode(child, predicate);
    if (match) return match;
  }
  return null;
}

test('setup random context trims current field values', () => {
  const inputs = new Map([
    ['name', { value: '  沈砚  ' }],
    ['role', { value: '巡夜人' }],
    ['empty', { value: '   ' }]
  ]);

  assert.deepEqual(getSetupRandomContext(inputs), {
    name: '沈砚',
    role: '巡夜人',
    empty: ''
  });
  assert.deepEqual(getSetupRandomContext(null), {});
});

test('journey setup controller owns rendering, pane navigation, randomization and submission', async () => {
  const documentObject = createDocument();
  const windowObject = {
    requestAnimationFrame(callback) {
      callback();
    },
    setTimeout(callback) {
      callback();
    }
  };
  const starts = [];
  const state = {
    config: {
      characterCard: {
        name: '旧角色',
        role: '旧身份'
      }
    }
  };
  const controller = createJourneySetupController({
    state,
    inferPrologueGenreFromTemplate: () => 'xianxia',
    getOpeningGenreOption: () => ({ title: '太虚仙侠', hint: '因果与问道' }),
    getCurrentStoryPresentation: () => ({ sourceLabel: '内置内容包' }),
    canRandomizeSetupField: () => true,
    buildJourneyWorldbookSnapshot: () => ({
      entries: [{
        title: '宗门铁律',
        type: '规则',
        constant: true,
        depth: 4,
        content: '誓约必有代价。'
      }],
      total: 2,
      publicTotal: 1,
      hiddenTotal: 1
    }),
    generateSetupFieldValue: (_genre, key) => `随机-${key}`,
    createCharacterPortraitImage: () => null,
    startJourney: async (...args) => starts.push(args),
    documentObject,
    windowObject
  });
  const template = {
    title: '命途开启',
    subtitle: '太虚卷宗',
    tagline: '问道先问心',
    buttonText: '[ 开启第一幕 ]',
    fields: {
      name: { label: '姓名', placeholder: '输入姓名' },
      role: { label: '身份', placeholder: '输入身份' }
    },
    tabs: {
      rules: { label: '世界规则', content: '【因果】誓约必须付出代价。' }
    },
    destinyCards: {
      label: '命途',
      hint: '最多选择一项',
      maxSelections: 1,
      cards: [{
        id: 'oath',
        title: '旧誓',
        content: '背负一段未完因果',
        defaultSelected: true
      }]
    }
  };

  controller.renderSetupPanel(template);

  assert.equal(documentObject.body.children.length, 1);
  const overlay = documentObject.body.children[0];
  assert.equal(overlay.attributes.role, 'dialog');
  assert.equal(overlay.querySelectorAll('.epic-tab-btn').length, 3);
  assert.equal(overlay.querySelectorAll('.epic-tab-pane')[0].hidden, false);
  assert.match(findNode(overlay, (node) => node.classList.contains('epic-dossier-worldbook')).children[0].children[1].textContent, /公开 1 · 隐藏 1/);

  const nextButton = findNode(overlay, (node) => node.textContent === '下一步 →');
  await nextButton.listeners.click();
  assert.equal(overlay.querySelectorAll('.epic-tab-pane')[1].hidden, false);

  const randomButton = findNode(overlay, (node) => node.classList.contains('epic-random-all'));
  await randomButton.listeners.click();
  const setupInputs = overlay.querySelectorAll('[data-setup-field]');
  assert.deepEqual(setupInputs.map((input) => input.value), ['随机-name', '随机-role']);

  await nextButton.listeners.click();
  assert.equal(overlay.querySelectorAll('.epic-tab-pane')[2].hidden, false);
  const sealButton = findNode(overlay, (node) => node.classList.contains('epic-seal-btn'));
  await sealButton.listeners.click();

  assert.equal(documentObject.body.children.length, 0);
  assert.equal(starts.length, 1);
  assert.deepEqual(starts[0][0], { name: '随机-name', role: '随机-role' });
  assert.deepEqual(starts[0][2], [{
    id: 'oath',
    title: '旧誓',
    content: '背负一段未完因果'
  }]);
  assert.deepEqual(starts[0][3], { autoSend: true });
});

test('custom openings without optional elements skip the third choice pane', async () => {
  const documentObject = createDocument();
  const starts = [];
  const controller = createJourneySetupController({
    state: { config: { characterCard: { name: '九渊' } } },
    inferPrologueGenreFromTemplate: () => 'xuanhuan',
    getOpeningGenreOption: () => ({ title: '玄幻', hint: '' }),
    getCurrentStoryPresentation: () => ({ sourceLabel: '角色卡原生剧本' }),
    buildJourneyWorldbookSnapshot: () => ({ entries: [], total: 3, publicTotal: 3, hiddenTotal: 0 }),
    startJourney: async (...args) => starts.push(args),
    documentObject,
    windowObject: {
      requestAnimationFrame(callback) {
        callback();
      },
      setTimeout(callback) {
        callback();
      }
    }
  });

  controller.renderSetupPanel({
    source: 'custom-pack',
    title: '九渊',
    fields: { name: { label: '称谓', defaultValue: '九渊' } },
    tabs: { world: { label: '世界观设定', content: '基础设定自动加载。' } },
    destinyCards: {
      stepLabel: '开局要素',
      counterLabel: '要素',
      maxSelections: 0,
      cards: []
    }
  });

  const overlay = documentObject.body.children[0];
  assert.equal(overlay.querySelectorAll('.epic-tab-btn').length, 2);
  assert.equal(overlay.querySelectorAll('.epic-tab-pane').length, 2);
  assert.equal(findNode(overlay, (node) => /天命|开局要素/.test(node.textContent)), null);

  const nextButton = findNode(overlay, (node) => node.textContent === '下一步 →');
  await nextButton.listeners.click();
  const sealButton = findNode(overlay, (node) => node.classList.contains('epic-seal-btn'));
  assert.equal(sealButton.hidden, false);
  await sealButton.listeners.click();
  assert.deepEqual(starts[0][2], []);
});

test('journey setup closes on Escape without starting a journey', () => {
  const documentObject = createDocument();
  const controller = createJourneySetupController({
    state: { config: {} },
    inferPrologueGenreFromTemplate: () => 'xuanhuan',
    getOpeningGenreOption: () => ({ title: '玄幻', hint: '' }),
    getCurrentStoryPresentation: () => ({ sourceLabel: '测试' }),
    documentObject,
    windowObject: {
      requestAnimationFrame(callback) {
        callback();
      },
      setTimeout(callback) {
        callback();
      }
    }
  });

  controller.renderSetupPanel({ fields: {}, tabs: {}, destinyCards: { cards: [] } });
  assert.equal(documentObject.body.children.length, 1);
  documentObject.listeners.keydown({ key: 'Escape' });
  assert.equal(documentObject.body.children.length, 0);
  assert.equal(documentObject.listeners.keydown, undefined);
});

test('journey setup renders alternate greetings and passes selected greeting', async () => {
  const documentObject = createDocument();
  const starts = [];
  const controller = createJourneySetupController({
    state: {
      config: {
        characterCard: {
          name: '苏凌雪',
          firstMessage: '初入宗门，破庙相依。',
          alternateGreetings: ['宗门大殿，天骄退婚。', '秘境争夺，并肩作战。']
        }
      }
    },
    inferPrologueGenreFromTemplate: () => 'xianxia',
    getOpeningGenreOption: () => ({ title: '仙侠', hint: '' }),
    getCurrentStoryPresentation: () => ({ sourceLabel: '类脑卡' }),
    startJourney: async (formData, tpl, destiny, options) => {
      starts.push([formData, tpl, destiny, options]);
    },
    documentObject,
    windowObject: { requestAnimationFrame: (cb) => cb(), setTimeout: (cb) => cb() }
  });

  controller.renderSetupPanel({
    title: '仙道问心',
    fields: { name: { label: '姓名', defaultValue: '天明' } },
    tabs: {},
    destinyCards: { cards: [] }
  });

  const overlay = documentObject.body.children[0];
  const greetingCards = overlay.querySelectorAll('.epic-greeting-card');
  assert.equal(greetingCards.length, 3);

  // Click on greeting 1 (宗门大殿)
  await greetingCards[1].listeners.click();
  assert.equal(greetingCards[1].classList.contains('is-selected'), true);

  const nextButton = findNode(overlay, (node) => node.textContent === '下一步 →');
  await nextButton.listeners.click();
  const sealButton = findNode(overlay, (node) => node.classList.contains('epic-seal-btn'));
  await sealButton.listeners.click();

  assert.equal(starts.length, 1);
  assert.equal(starts[0][0].selectedGreeting, '宗门大殿，天骄退婚。');
});
