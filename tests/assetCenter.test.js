import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAssetCatalog,
  filterAssetCatalog,
  paginateAssetCatalog
} from '../public/modules/assetCenter.js';

test('asset center builds a unified catalog for resources and content packs', () => {
  const catalog = buildAssetCatalog([
    {
      id: 'character-1',
      kind: 'character',
      title: '谢停云',
      summary: '问剑入山的年轻修士。',
      tags: ['仙侠'],
      collections: ['问道主线'],
      favorite: true,
      diagnostics: { score: 91, estimatedTokens: 1800 },
      source: { community: '类脑社区', author: '测试作者' },
      revision: {
        headId: 'revision-2',
        number: 2,
        count: 2,
        securityReview: { required: true }
      },
      payload: { role: '问剑人' },
      updatedAt: '2026-07-20T08:00:00.000Z'
    },
    {
      id: 'worldbook-1',
      kind: 'worldbook',
      title: '太虚山门录',
      diagnostics: { score: 86, estimatedTokens: 4200 },
      source: { site: 'local-file' },
      payload: { entries: [{ title: '山门戒律', content: '不可妄开天门。' }] }
    }
  ], [{
    id: 'xianxia',
    title: '太虚仙侠内容包',
    description: '大道争锋，仙途渺茫。',
    characterCount: 4,
    worldBookCount: 48,
    manifest: { version: '1.0.0' }
  }]);

  assert.deepEqual(catalog.map((item) => item.kind), ['character', 'worldbook', 'pack']);
  assert.equal(catalog[0].sourceLabel, '类脑社区');
  assert.equal(catalog[0].favorite, true);
  assert.equal(catalog[0].revisionCount, 2);
  assert.equal(catalog[0].securityReviewRequired, true);
  assert.equal(catalog[2].diagnostics.stats.entryCount, 48);
  assert.equal(catalog[2].diagnostics.stats.characterCount, 4);
  assert.equal(catalog[2].compatibilityAudit.status, 'native');
});

test('asset center reads authoritative content-pack counts used by the bookshelf', () => {
  const [pack] = buildAssetCatalog([], [{
    id: 'zishi',
    title: '子时 v1.1',
    counts: { worldBook: 96, characterPresets: 1, promptModules: 226 }
  }]);

  assert.equal(pack.diagnostics.stats.entryCount, 96);
  assert.equal(pack.diagnostics.stats.characterCount, 1);
});

test('asset center filters collections, source and kind while keeping favorites first', () => {
  const catalog = buildAssetCatalog([
    {
      id: 'prompt-1',
      kind: 'prompt',
      title: '沉浸叙事预设',
      collections: ['待整理'],
      favorite: false,
      diagnostics: { score: 93 },
      source: { site: '本地素材' },
      updatedAt: '2026-07-20T10:00:00.000Z'
    },
    {
      id: 'character-1',
      kind: 'character',
      title: '谢停云',
      tags: ['仙侠'],
      collections: ['问道主线'],
      favorite: true,
      diagnostics: { score: 82 },
      source: { community: '类脑社区' },
      updatedAt: '2026-07-19T10:00:00.000Z'
    }
  ]);

  assert.deepEqual(filterAssetCatalog(catalog, { kind: 'all', sort: 'updated' }).map((item) => item.id), ['character-1', 'prompt-1']);
  assert.deepEqual(filterAssetCatalog(catalog, { kind: 'character', query: '问道' }).map((item) => item.id), ['character-1']);
  assert.deepEqual(filterAssetCatalog(catalog, { source: '本地素材', query: '待整理' }).map((item) => item.id), ['prompt-1']);
  assert.deepEqual(filterAssetCatalog(catalog, { genre: 'xianxia' }).map((item) => item.id), ['character-1']);
  assert.equal(catalog.find((item) => item.id === 'character-1').genre, 'xianxia');
});

test('asset center folder filters use real favorites and collection labels', () => {
  const catalog = buildAssetCatalog([
    { id: 'favorite', kind: 'character', title: '收藏角色', favorite: true },
    { id: 'active', kind: 'worldbook', title: '在用世界书', collections: ['正在使用'] },
    { id: 'frequent', kind: 'prompt', title: '常用预设', collections: ['常用资源'] },
    { id: 'memo', kind: 'prompt', title: '灵感', collections: ['灵感备忘'] }
  ]);

  assert.deepEqual(filterAssetCatalog(catalog, { folder: 'favorite' }).map((item) => item.id), ['favorite']);
  assert.deepEqual(filterAssetCatalog(catalog, { folder: 'active' }).map((item) => item.id), ['active']);
  assert.deepEqual(filterAssetCatalog(catalog, { folder: 'frequent' }).map((item) => item.id), ['frequent']);
  assert.deepEqual(filterAssetCatalog(catalog, { folder: 'memo' }).map((item) => item.id), ['memo']);
});

test('asset center pagination clamps pages and never renders the full catalog at once', () => {
  const items = Array.from({ length: 43 }, (_, index) => ({ id: index + 1 }));
  const first = paginateAssetCatalog(items, 1, 24);
  const last = paginateAssetCatalog(items, 99, 24);

  assert.equal(first.items.length, 24);
  assert.equal(first.totalPages, 2);
  assert.equal(last.page, 2);
  assert.equal(last.items.length, 19);
  assert.deepEqual(last.items.map((item) => item.id), Array.from({ length: 19 }, (_, index) => index + 25));
});

test('asset center gives title and explicit metadata priority over generic summary wording', () => {
  const catalog = buildAssetCatalog([
    {
      id: 'character-xianzong',
      kind: 'character',
      title: '绝世仙宗',
      summary: '表面上只想过日常生活，能躺则躺。'
    },
    {
      id: 'character-explicit',
      kind: 'character',
      title: '未命名角色',
      summary: '曾在宗门中生活。',
      metadata: { genre: 'modern' }
    }
  ]);

  assert.equal(catalog.find((item) => item.id === 'character-xianzong').genre, 'xianxia');
  assert.equal(catalog.find((item) => item.id === 'character-explicit').genre, 'modern');
});

test('asset center groups same-title revisions and links companion worldbooks from one import', () => {
  const catalog = buildAssetCatalog([
    {
      id: 'character-v1',
      kind: 'character',
      title: '听雨刀客 Ver1.7',
      source: { importBatchId: 'batch-1', version: '1.7' },
      payload: { name: '沈观澜' },
      updatedAt: '2026-07-19T10:00:00.000Z'
    },
    {
      id: 'character-v2',
      kind: 'character',
      title: '听雨刀客 Ver1.8',
      source: { importBatchId: 'batch-2', version: '1.8' },
      payload: { name: '沈观澜' },
      updatedAt: '2026-07-20T10:00:00.000Z'
    },
    {
      id: 'worldbook-1',
      kind: 'worldbook',
      title: '听雨楼设定集',
      source: { importBatchId: 'batch-1' },
      payload: { entries: [] }
    }
  ]);

  const first = catalog.find((item) => item.id === 'character-v1');
  assert.equal(first.versionCount, 2);
  assert.equal(first.companionWorldbookCount, 1);
  assert.deepEqual(filterAssetCatalog(catalog, { sort: 'versions' }).slice(0, 2).map((item) => item.kind), ['character', 'character']);
});

test('asset center presents stored and legacy prompt presets as one top-level asset', () => {
  const catalog = buildAssetCatalog([
    {
      id: 'bundle-1',
      kind: 'prompt-bundle',
      title: '新预设',
      payload: { promptModules: [{ id: 'one', content: '一' }, { id: 'two', content: '二' }] }
    },
    {
      id: 'legacy-a',
      kind: 'prompt',
      title: '模块 A',
      source: { importBatchId: 'legacy-batch' },
      payload: { content: 'A', extensions: { sillyTavernPreset: { presetTitle: '旧预设' } } }
    },
    {
      id: 'legacy-b',
      kind: 'prompt',
      title: '模块 B',
      source: { importBatchId: 'legacy-batch' },
      payload: { content: 'B', extensions: { sillyTavernPreset: { presetTitle: '旧预设' } } }
    }
  ]);

  assert.equal(catalog.length, 2);
  assert.deepEqual(catalog.map((item) => item.kind), ['prompt', 'prompt']);
  assert.equal(catalog.find((item) => item.title === '新预设').resourceKind, 'prompt-bundle');
  assert.deepEqual(catalog.find((item) => item.title === '旧预设').resourceIds, ['legacy-a', 'legacy-b']);
});
