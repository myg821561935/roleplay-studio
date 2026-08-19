import test from 'node:test';
import assert from 'node:assert/strict';

import { createReaderChromeController } from '../public/modules/readerChromeController.js';

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  toggle(value, force) {
    if (force) this.values.add(value);
    else this.values.delete(value);
  }

  contains(value) {
    return this.values.has(value);
  }
}

function createButton(dataset = {}) {
  const attributes = new Map();
  return {
    attributes,
    classList: new FakeClassList(),
    dataset,
    setAttribute(name, value) {
      attributes.set(name, value);
    }
  };
}

function createHarness({ openImmersiveSidebarTab } = {}) {
  const characterButton = createButton({ readerInteraction: 'characters' });
  const relationshipButton = createButton({ readerInteraction: 'relationships' });
  const cluesButton = createButton({ readerInteraction: 'clues' });
  const statusButton = createButton({ readerInteraction: 'state' });
  const protagonistButton = createButton({ readerInteraction: 'protagonist' });
  const worldRulesButton = createButton({ readerInteraction: 'world-rules' });
  const memoryButton = createButton({ readerInteraction: 'memory' });
  const progressButton = createButton({ readerInteraction: 'progress' });
  const storyButton = createButton({ readerAction: 'open-story' });
  const backgroundButton = createButton({ readerAction: 'background' });
  const buttons = [
    characterButton, relationshipButton, cluesButton, statusButton,
    protagonistButton, worldRulesButton, memoryButton, progressButton,
    storyButton, backgroundButton
  ];
  const listeners = new Map();
  const rail = {
    dataset: {},
    addEventListener(type, listener) {
      listeners.set(type, listener);
    }
  };
  const nameEl = { textContent: '' };
  const chapterEl = { style: {}, textContent: '' };
  const tagsEl = { style: {}, textContent: '' };
  const dividerEl = { style: {} };
  const documentObject = {
    getElementById(id) {
      return {
        'reader-card-name': nameEl,
        'reader-card-chapter': chapterEl,
        'reader-card-tags': tagsEl
      }[id] || null;
    },
    querySelector(selector) {
      if (selector === '.reader-rail') return rail;
      if (selector === '.reader-card-divider') return dividerEl;
      return null;
    },
    querySelectorAll(selector) {
      return selector === '.reader-rail-btn' ? buttons : [];
    }
  };
  const calls = {
    activateTab: [],
    workModes: [],
    expanded: [],
    interactions: [],
    openStory: 0,
    background: 0,
    scroll: 0
  };
  const controller = createReaderChromeController({
    state: {
      session: { memory: { narrativeState: { activeArc: '雾中旧案' } } },
      sessionSummaries: []
    },
    els: {
      openStoryLauncher: { click: () => { calls.openStory += 1; } },
      toggleBackground: { click: () => { calls.background += 1; } }
    },
    getCurrentSessionId: () => 'session-1',
    getSessionDisplayTitle: () => '太虚阴阳界',
    getAppliedContentPackId: () => 'xianxia',
    getContentPackTitle: () => '太虚仙侠',
    activateWorkMode: (mode, options) => calls.workModes.push({ mode, options }),
    openImmersiveSidebarTab: (label) => {
      calls.interactions.push(label);
      return openImmersiveSidebarTab?.(label);
    },
    setWorkspacePanelExpanded: (...args) => calls.expanded.push(args),
    activateTab: (tab) => calls.activateTab.push(tab),
    scrollInspectorIntoViewOnNarrowScreens: () => { calls.scroll += 1; },
    documentObject
  });

  function click(button) {
    listeners.get('click')({
      target: {
        closest(selector) {
          return selector === '.reader-rail-btn' ? button : null;
        }
      }
    });
  }

  return {
    buttons: {
      backgroundButton, characterButton, cluesButton, relationshipButton,
      statusButton, protagonistButton, worldRulesButton, memoryButton,
      progressButton, storyButton
    },
    calls,
    chapterEl,
    click,
    controller,
    dividerEl,
    listeners,
    nameEl,
    rail,
    tagsEl
  };
}

test('reader rail opens current interaction information without switching the reading mode', () => {
  const harness = createHarness();
  harness.controller.bindReaderRail();
  harness.controller.bindReaderRail();

  assert.equal(harness.rail.dataset.bound, 'true');
  assert.equal(harness.listeners.size, 1);

  harness.click(harness.buttons.characterButton);

  assert.deepEqual(harness.calls.workModes, []);
  assert.deepEqual(harness.calls.interactions, ['角色档案']);
  assert.deepEqual(harness.calls.expanded, []);
  assert.deepEqual(harness.calls.activateTab, []);
  assert.equal(harness.calls.scroll, 0);
  assert.equal(harness.buttons.characterButton.classList.contains('active'), true);
  assert.equal(harness.buttons.characterButton.attributes.get('aria-current'), 'page');
  assert.equal(harness.buttons.statusButton.attributes.get('aria-current'), 'false');
});

test('reader rail clears its active state when an interaction panel is closed', () => {
  const harness = createHarness({ openImmersiveSidebarTab: () => false });
  harness.controller.bindReaderRail();

  harness.click(harness.buttons.characterButton);

  assert.equal(harness.buttons.characterButton.classList.contains('active'), false);
  assert.equal(harness.buttons.characterButton.attributes.get('aria-current'), 'false');
});

test('reader rail maps relationships, clues and current situation without changing work mode', () => {
  const harness = createHarness();
  harness.controller.bindReaderRail();

  harness.click(harness.buttons.relationshipButton);
  harness.click(harness.buttons.cluesButton);
  harness.click(harness.buttons.statusButton);
  assert.deepEqual(harness.calls.interactions, ['人物网络', '决策线索', '当前态势']);
  assert.deepEqual(harness.calls.workModes, []);
  assert.deepEqual(harness.calls.activateTab, []);
  assert.deepEqual(harness.calls.expanded, []);
  assert.equal(harness.buttons.statusButton.classList.contains('active'), true);
});

test('reader rail exposes the extended local information views through the same non-modal path', () => {
  const harness = createHarness();
  harness.controller.bindReaderRail();

  harness.click(harness.buttons.protagonistButton);
  harness.click(harness.buttons.worldRulesButton);
  harness.click(harness.buttons.memoryButton);
  harness.click(harness.buttons.progressButton);

  assert.deepEqual(harness.calls.interactions, ['成长轨迹', '世界规则', '叙事记忆', '成长轨迹']);
  assert.deepEqual(harness.calls.workModes, []);
  assert.equal(harness.buttons.progressButton.classList.contains('active'), true);
});

test('reader chrome preserves support for explicit non-navigation actions', () => {
  const harness = createHarness();
  harness.controller.bindReaderRail();

  harness.click(harness.buttons.storyButton);
  harness.click(harness.buttons.backgroundButton);
  assert.equal(harness.calls.openStory, 1);
  assert.equal(harness.calls.background, 1);
  assert.deepEqual(harness.calls.activateTab, []);
});

test('reader chrome reflects the active session title, narrative arc and content pack', () => {
  const harness = createHarness();
  harness.controller.syncReaderChrome();

  assert.equal(harness.nameEl.textContent, '太虚阴阳界');
  assert.equal(harness.chapterEl.textContent, '雾中旧案');
  assert.equal(harness.chapterEl.style.display, '');
  assert.equal(harness.dividerEl.style.display, '');
  assert.equal(harness.tagsEl.textContent, '太虚仙侠');
  assert.equal(harness.tagsEl.style.display, '');
});
