import test from 'node:test';
import assert from 'node:assert/strict';

import { STORY_IMPORT_MODES } from '../public/modules/importRouting.js';
import { getCommunityCompatibilitySafetyText } from '../public/modules/importCompatibility.js';
import {
  createResourceImportController,
  getImportActionLabel,
  isPackageImportKind,
  matchesExpectedImportKind,
  sanitizeImportFileName,
  summarizeImportCommitResult
} from '../public/modules/resourceImport.js';

function createEventTarget(overrides = {}) {
  const listeners = new Map();
  return {
    dataset: {},
    disabled: false,
    value: '',
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    listener(type) {
      return listeners.get(type);
    },
    ...overrides
  };
}

function createMinimalElements() {
  return {
    characterCardImport: createEventTarget(),
    pluginManifestImport: createEventTarget(),
    confirmImport: createEventTarget(),
    cancelImport: createEventTarget(),
    closeImportReview: createEventTarget(),
    importApplyCurrent: createEventTarget({ checked: false }),
    importReviewDialog: createEventTarget({ open: false, dataset: {} }),
    importPreview: { innerHTML: '' },
    importApplyOption: { hidden: false },
    importReviewKicker: { textContent: '' },
    importReviewTitle: { textContent: '' },
    storyImportFile: createEventTarget(),
    characterCardStatus: {},
    storyCustomStatus: {},
    storyLauncherStatus: {},
    sourceStatus: {},
    resourceLibraryStatus: {},
    appStatus: {},
    resourceViewButtons: []
  };
}

test('resource import kind matching keeps each picker inside its declared boundary', () => {
  assert.equal(matchesExpectedImportKind('', 'content-pack'), true);
  assert.equal(matchesExpectedImportKind('character', 'character-card'), true);
  assert.equal(matchesExpectedImportKind('worldbook', 'world-book'), true);
  assert.equal(matchesExpectedImportKind('prompt', 'prompt-preset'), true);
  assert.equal(matchesExpectedImportKind('prompt', 'regex-preset'), true);
  assert.equal(matchesExpectedImportKind('character', 'world-book'), false);
  assert.equal(isPackageImportKind('content-pack'), true);
  assert.equal(isPackageImportKind('character-card'), false);
  assert.equal(sanitizeImportFileName('  仙侠 / 角色卡 v2  '), 'v2');
});

test('community compatibility copy reflects locally observable sandbox execution policy', () => {
  assert.match(getCommunityCompatibilitySafetyText({
    requirements: [{ status: 'supported' }],
    counts: { missing: 0 },
    acceptance: { outcome: 'full-mapping' }
  }), /默认本地观察运行并写入审计.*严格模式/);
  assert.match(getCommunityCompatibilitySafetyText({
    counts: { missing: 1 }
  }), /不能放入隔离运行时的代码仍不会执行/);
});

test('resource import action labels reflect safety, package and story routing decisions', () => {
  assert.equal(getImportActionLabel({
    canCommit: false,
    intent: 'create-story',
    kind: 'plugin-manifest'
  }), '此文件不能创建剧本');
  assert.equal(getImportActionLabel({
    canCommit: true,
    intent: 'create-story',
    kind: 'character-card',
    disposition: STORY_IMPORT_MODES.INDEPENDENT
  }), '存入并配置独立副本');
  assert.equal(getImportActionLabel({
    canCommit: true,
    intent: 'create-story',
    kind: 'content-pack'
  }), '安装并创建剧本');
  assert.equal(getImportActionLabel({
    canCommit: true,
    kind: 'regex-preset',
    summary: { regexScriptCount: 4 }
  }), '存入素材库（4 条规则）');
  assert.equal(getImportActionLabel({
    canCommit: true,
    runtimeReady: false
  }), '仅安全保存原件');
  assert.equal(getImportActionLabel({
    canCommit: true,
    applyCurrent: true
  }), '存入并载入');
  assert.equal(getImportActionLabel({
    canCommit: true,
    updateCount: 2
  }), '导入为新版本（2 份）');
});

test('resource import commit summaries preserve package and library outcomes', () => {
  assert.equal(summarizeImportCommitResult({
    applyMode: 'plugin-registry',
    installStatus: 'updated',
    plugin: { name: '安全脚本桥', version: '1.2.0' }
  }), '已更新扩展：安全脚本桥 v1.2.0');

  assert.equal(summarizeImportCommitResult({
    applyMode: 'active-config',
    importedWorldBookCount: 3,
    libraryResources: [
      { importStatus: 'created' },
      { importStatus: 'updated' },
      { importStatus: 'duplicate' }
    ]
  }), '已入库并载入：新增 1，更新 1，重复 1，世界书 3 条');

  assert.equal(summarizeImportCommitResult({}, {
    kind: 'prompt-preset',
    summary: { title: '长篇叙事', promptModuleCount: 6 }
  }), '已导入预设《长篇叙事》：6 个模块');
});

test('resource import controller owns pending state and binds all review events', () => {
  const els = createMinimalElements();
  const statuses = [];
  const controller = createResourceImportController({
    state: { contentPacks: [] },
    els,
    setStatus: (element, text, tone) => statuses.push({ element, text, tone })
  });

  controller.bindEvents();
  assert.equal(typeof els.characterCardImport.listener('change'), 'function');
  assert.equal(typeof els.pluginManifestImport.listener('change'), 'function');
  assert.equal(typeof els.confirmImport.listener('click'), 'function');
  assert.equal(typeof els.cancelImport.listener('click'), 'function');
  assert.equal(typeof els.importReviewDialog.listener('cancel'), 'function');
  assert.deepEqual(controller.getPendingImportState(), {
    payload: null,
    source: null,
    canCommit: false,
    kind: '',
    summary: {},
    intent: '',
    basePackId: '',
    disposition: STORY_IMPORT_MODES.ATTACH,
    compatibilityReview: {
      fingerprint: '',
      scriptReviews: [],
      executionMode: 'local-observe',
      acknowledgeCompatibility: false
    }
  });

  return controller.commitPendingImport().then(() => {
    assert.equal(statuses.at(-1)?.text, '没有待确认的导入内容');
    assert.equal(statuses.at(-1)?.tone, 'error');
  });
});

test('resource import controller rejects picker-kind mismatches and clears pending state', async () => {
  const input = createEventTarget({
    dataset: { assetImportKind: 'character' },
    files: [{ name: 'worldbook.json', type: 'application/json' }]
  });
  const els = {
    ...createMinimalElements(),
    characterCardImport: input
  };
  const statuses = [];
  const controller = createResourceImportController({
    state: { contentPacks: [] },
    els,
    apiRequest: async (path) => {
      assert.match(path, /^\/api\/import\/upload\?/);
      return {
        upload: { uploadId: 'upload-1' },
        preview: { kind: 'world-book' }
      };
    },
    setStatus: (element, text, tone) => statuses.push({ element, text, tone })
  });

  await controller.importCharacterCardFile(input);

  assert.equal(statuses.at(-1)?.tone, 'error');
  assert.match(statuses.at(-1)?.text || '', /所选文件不是可识别的角色卡格式/);
  assert.equal(input.value, '');
  assert.equal(input.dataset.assetImportKind, undefined);
  assert.equal(controller.getPendingImportState().payload, null);
});
