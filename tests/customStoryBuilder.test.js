import test from 'node:test';
import assert from 'node:assert/strict';

import { STORY_IMPORT_MODES } from '../public/modules/importRouting.js';
import {
  CUSTOM_STORY_BASE_PACK_ID,
  createCompatibilityUpgradeAssemblySignature,
  createCustomBaselineDraft,
  createCustomStoryBuilderController,
  createCustomStoryDraft,
  loadCustomStoryDraft
} from '../public/modules/customStoryBuilder.js';
import { groupPromptResources } from '../public/modules/presetLibrary.js';

test('custom story drafts normalize bounded fields and resource selections', () => {
  const draft = createCustomStoryDraft({
    title: '新故事'.repeat(40),
    characterResourceId: ' character-1 ',
    worldBookResourceIds: ['world-1', '', 'world-1', 'world-2'],
    promptResourceIds: ['prompt-1', null, 'prompt-1'],
    promptSelectionConfirmed: true,
    worldBookMergeMode: 'invalid',
    creationMode: STORY_IMPORT_MODES.INDEPENDENT,
    compatibilityReview: {
      fingerprint: 'sha256:review-one',
      approvedScriptHashes: ['sha256:script-one', '', 'sha256:script-one'],
      acknowledgeCompatibility: true
    },
    customBaseline: {
      worldName: '世界'.repeat(100),
      premise: '总纲'.repeat(3000)
    }
  });

  assert.equal(draft.title.length, 80);
  assert.equal(draft.characterResourceId, ' character-1 ');
  assert.deepEqual(draft.worldBookResourceIds, ['world-1', 'world-2']);
  assert.deepEqual(draft.promptResourceIds, ['prompt-1']);
  assert.equal(draft.promptSelectionConfirmed, true);
  assert.equal(draft.worldBookMergeMode, 'smart');
  assert.equal(draft.creationMode, STORY_IMPORT_MODES.INDEPENDENT);
  assert.deepEqual(draft.compatibilityReview, {
    fingerprint: 'sha256:review-one',
    scriptReviews: [],
    executionMode: 'local-observe',
    acknowledgeCompatibility: true
  });
  assert.equal(draft.customBaseline.worldName.length, 80);
  assert.equal(draft.customBaseline.premise.length, 5000);
});

test('strict custom-story mode requires a per-hash decision before a safe derivative can be created', () => {
  const state = {
    customStoryDraft: createCustomStoryDraft({
      basePackId: 'xuanhuan',
      title: '沙箱测试卷',
      compatibilityReview: { executionMode: 'review-required' }
    }),
    customStoryComposition: {
      key: 'ready',
      status: 'ready',
      report: {
        summary: { finalEntries: 1 },
        communityCompatibility: { counts: { missing: 0, review: 1, degraded: 0 } },
        compatibilityReview: {
          fingerprint: 'sha256:review-one',
          counts: { missing: 0, review: 1, degraded: 0 },
          rules: [{
            scriptId: 'runtime-widget',
            name: '运行面板',
            contentHash: 'sha256:script-one',
            riskLevel: 'high',
            risks: ['network-request']
          }],
          requiresScriptApproval: true,
          requiresCompatibilityAcknowledgement: false
        }
      },
      error: ''
    },
    contentPacks: [{
      id: 'xuanhuan',
      title: '神荒玄幻',
      counts: { worldBook: 1, promptModules: 1 },
      compatibility: { compatible: true, blockingCount: 0 }
    }],
    resourceLibrary: []
  };
  const controller = createCustomStoryBuilderController({ state, els: {} });

  const pending = controller.getCustomStoryReadiness();
  assert.equal(pending.canInspect, true);
  assert.equal(pending.canCreate, false);
  assert.equal(pending.pendingScriptRules.length, 1);
  assert.deepEqual(controller.buildCustomPackRequest().compatibilityReview, {
    fingerprint: 'sha256:review-one',
    scriptReviews: [],
    executionMode: 'review-required',
    acknowledgeCompatibility: false
  });

  state.customStoryDraft.compatibilityReview = {
    fingerprint: 'sha256:review-one',
    scriptReviews: [{
      scriptId: 'runtime-widget',
      contentHash: 'sha256:script-one',
      decision: 'approved',
      note: '已核对来源、内容哈希与网络风险。'
    }],
    executionMode: 'review-required',
    acknowledgeCompatibility: false
  };
  assert.equal(controller.getCustomStoryReadiness().canCreate, true);

  // 兼容确认仍是独立的创建门槛
  state.customStoryComposition.report.communityCompatibility.counts = { missing: 1, review: 0, degraded: 0 };
  state.customStoryComposition.report.compatibilityReview = {
    fingerprint: 'sha256:blocked-review',
    counts: { missing: 1, review: 0, degraded: 0 },
    rules: [],
    sourceRuntimeBlocked: true,
    safeDerivativeAvailable: true,
    blockers: [{ id: 'tavern-helper', label: '酒馆助手运行时' }],
    requiresScriptApproval: false,
    requiresCompatibilityAcknowledgement: true
  };
  assert.equal(controller.getCustomStoryReadiness().canCreate, false);

  state.customStoryDraft.compatibilityReview = {
    fingerprint: 'sha256:blocked-review',
    scriptReviews: [],
    acknowledgeCompatibility: true
  };
  assert.equal(controller.getCustomStoryReadiness().canCreate, true);
});

test('custom story creation requires explicit approval for a safe derivative of a blocked source runtime', () => {
  const state = {
    customStoryDraft: createCustomStoryDraft({
      basePackId: 'xuanhuan',
      title: '外部运行时测试卷',
      compatibilityReview: {
        fingerprint: 'sha256:blocked-review',
        scriptReviews: [],
        acknowledgeCompatibility: false
      }
    }),
    customStoryComposition: {
      key: 'ready',
      status: 'ready',
      report: {
        summary: { finalEntries: 1 },
        communityCompatibility: { counts: { missing: 1, review: 0, degraded: 0 } },
        compatibilityReview: {
          fingerprint: 'sha256:blocked-review',
          counts: { missing: 1, review: 0, degraded: 0 },
          rules: [],
          sourceRuntimeBlocked: true,
          safeDerivativeAvailable: true,
          blockers: [{ id: 'tavern-helper', label: '酒馆助手运行时' }],
          requiresScriptApproval: false,
          requiresCompatibilityAcknowledgement: true
        }
      },
      error: ''
    },
    contentPacks: [{
      id: 'xuanhuan',
      title: '神荒玄幻',
      counts: { worldBook: 1, promptModules: 1 },
      compatibility: { compatible: true, blockingCount: 0 }
    }],
    resourceLibrary: []
  };
  const controller = createCustomStoryBuilderController({ state, els: {} });
  const readiness = controller.getCustomStoryReadiness();

  assert.equal(readiness.inspectionReady, true);
  assert.equal(readiness.sourceRuntimeBlocked, true);
  assert.equal(readiness.compatibilityAcknowledgementPending, true);
  assert.equal(readiness.canCreate, false);
  assert.match(readiness.guidance, /安全派生版/);

  state.customStoryDraft.compatibilityReview = {
    fingerprint: 'sha256:blocked-review',
    scriptReviews: [],
    acknowledgeCompatibility: true
  };
  const approved = controller.getCustomStoryReadiness();
  assert.equal(approved.sourceRuntimeBlocked, true);
  assert.equal(approved.compatibilityAcknowledgementPending, false);
  assert.equal(approved.canCreate, true);
  assert.match(approved.guidance, /禁用.*源运行时能力/);
});

test('historical compatibility review creates a new pack through the dedicated upgrade contract', async () => {
  const requests = [];
  const opened = [];
  const state = {
    customStoryDraft: createCustomStoryDraft({
      basePackId: CUSTOM_STORY_BASE_PACK_ID,
      title: '旧卷 · 兼容复审版',
      promptSelectionConfirmed: true,
      compatibilityReview: {
        fingerprint: 'sha256:upgrade-review',
        scriptReviews: [],
        acknowledgeCompatibility: false
      },
      customBaseline: {
        worldName: '旧卷世界',
        premise: '这是从历史剧本恢复出的世界总纲。'
      }
    }),
    customStoryComposition: {
      key: 'ready',
      status: 'ready',
      report: {
        summary: { finalEntries: 1 },
        communityCompatibility: { counts: { missing: 0, review: 0, degraded: 0 } },
        compatibilityReview: {
          fingerprint: 'sha256:upgrade-review',
          rules: [],
          requiresScriptApproval: false,
          requiresCompatibilityAcknowledgement: false
        }
      },
      error: ''
    },
    contentPacks: [],
    resourceLibrary: []
  };
  const controller = createCustomStoryBuilderController({
    state,
    els: {
      storyCustomTitle: { value: '旧卷 · 兼容复审版' },
      storyCustomCreate: { disabled: false, textContent: '' },
      storyCustomStatus: {},
      appStatus: {}
    },
    apiRequest: async (path, options) => {
      requests.push([path, options]);
      return { pack: { id: 'custom-upgraded', title: '旧卷 · 兼容复审版' } };
    },
    createAndOpenStoryProject: async (pack, options) => {
      opened.push([pack, options]);
      return { project: { title: pack.title }, session: {} };
    },
    storage: { setItem() {} },
    timerApi: { clearTimeout() {}, setTimeout() { return 1; } }
  });
  const request = controller.buildCustomPackRequest({ title: '旧卷 · 兼容复审版' });
  state.customStoryCompatibilityUpgrade = {
    sourcePackId: 'custom-legacy',
    assemblySignature: createCompatibilityUpgradeAssemblySignature(request)
  };

  await controller.createCustomStoryFromDraft();

  assert.equal(requests.length, 1);
  assert.equal(requests[0][0], '/api/resource-library/packs/custom-legacy/compatibility-upgrade');
  assert.deepEqual(requests[0][1].body, {
    title: '旧卷 · 兼容复审版',
    description: request.description,
    compatibilityReview: request.compatibilityReview
  });
  assert.equal(opened[0][0].id, 'custom-upgraded');
  assert.equal(state.customStoryCompatibilityUpgrade, null);
});

test('custom story draft loading fails closed to a clean local draft', () => {
  const saved = loadCustomStoryDraft({
    getItem: () => JSON.stringify({
      title: '本地草稿',
      worldBookResourceIds: ['world-1', 'world-1']
    })
  });
  const invalid = loadCustomStoryDraft({
    getItem: () => '{not-json'
  });

  assert.equal(saved.title, '本地草稿');
  assert.deepEqual(saved.worldBookResourceIds, ['world-1']);
  assert.deepEqual(invalid, createCustomStoryDraft());
});

test('custom story controller evaluates an imported stack and builds the composition request', () => {
  const state = {
    customStoryDraft: createCustomStoryDraft({
      basePackId: 'xuanhuan',
      title: '雁回新卷',
      characterResourceId: 'character-1',
      worldBookResourceIds: ['world-1'],
      promptResourceIds: ['prompt-1'],
      promptSelectionConfirmed: true
    }),
    customStoryStep: 'review',
    customStoryComposition: {
      key: 'ready',
      status: 'ready',
      report: { summary: { finalEntries: 1 } },
      error: ''
    },
    contentPacks: [{
      id: 'xuanhuan',
      title: '神荒玄幻',
      counts: { worldBook: 8, promptModules: 3 },
      compatibility: { compatible: true, blockingCount: 0 }
    }],
    resourceLibrary: [
      {
        id: 'character-1',
        kind: 'character',
        title: '沈观澜',
        payload: { name: '沈观澜' },
        diagnostics: { missingFields: [], warnings: [], estimatedTokens: 1200 }
      },
      {
        id: 'world-1',
        kind: 'worldbook',
        title: '雁回旧案',
        payload: { entries: [{ title: '旧案' }] },
        diagnostics: { warnings: [], estimatedTokens: 800 }
      },
      {
        id: 'prompt-1',
        kind: 'prompt',
        title: '悬疑叙事',
        diagnostics: { warnings: [], estimatedTokens: 500 }
      }
    ]
  };
  const controller = createCustomStoryBuilderController({
    state,
    els: {},
    getCharacterPortraitUrl: () => '',
    formatTokenCount: String
  });

  const readiness = controller.getCustomStoryReadiness();
  const request = controller.buildCustomPackRequest();

  assert.equal(readiness.canCreate, true);
  assert.equal(readiness.character.id, 'character-1');
  assert.equal(readiness.worldBooks.length, 1);
  assert.equal(readiness.prompts.length, 1);
  assert.equal(readiness.estimatedTokens, 2500);
  assert.equal(readiness.baseInheritanceMode, 'genre');
  assert.equal(readiness.effectiveWorldBookCount, 1);
  assert.equal(readiness.checks.find((item) => item.label === '世界设定').value, '题材框架继承 · 最终 1 条');
  assert.equal(request.basePackId, 'xuanhuan');
  assert.equal(request.baseInheritanceMode, 'genre');
  assert.deepEqual(request.worldBookResourceIds, ['world-1']);
  assert.deepEqual(request.promptResourceIds, ['prompt-1']);
});

test('custom story readiness treats several world books as one shared dynamic runtime budget', () => {
  const state = {
    customStoryDraft: createCustomStoryDraft({
      basePackId: 'xuanhuan',
      characterResourceId: 'character-1',
      worldBookResourceIds: ['world-1', 'world-2'],
      promptResourceIds: ['prompt-1'],
      promptSelectionConfirmed: true
    }),
    customStoryComposition: {
      key: 'ready',
      status: 'ready',
      report: { summary: { finalEntries: 4 } },
      error: ''
    },
    contentPacks: [{
      id: 'xuanhuan',
      title: '神荒玄幻',
      counts: { worldBook: 1, promptModules: 1 },
      compatibility: { compatible: true, blockingCount: 0 }
    }],
    resourceLibrary: [{
      id: 'character-1',
      kind: 'character',
      title: '九渊',
      payload: { name: '九渊' },
      source: { importBatchId: 'jiuyuan-stack' },
      diagnostics: { missingFields: [], warnings: [], estimatedTokens: 1200 }
    }, {
      id: 'world-1',
      kind: 'worldbook',
      title: '九渊设定集',
      payload: { entries: [{ title: '世界法则' }] },
      source: { importBatchId: 'jiuyuan-stack' },
      diagnostics: {
        warnings: [],
        estimatedTokens: 6000,
        storedPayloadEstimatedTokens: 100000,
        worldBookRuntime: { perTurnTokenCap: 6000 }
      }
    }, {
      id: 'world-2',
      kind: 'worldbook',
      title: '补充人物志',
      payload: { entries: [{ title: '人物' }] },
      source: { importBatchId: 'jiuyuan-stack' },
      diagnostics: {
        warnings: [],
        estimatedTokens: 2000,
        storedPayloadEstimatedTokens: 20000,
        worldBookRuntime: { perTurnTokenCap: 6000 }
      }
    }, {
      id: 'prompt-1',
      kind: 'prompt',
      title: '叙事预设',
      source: { importBatchId: 'jiuyuan-stack' },
      diagnostics: { warnings: [], estimatedTokens: 500 }
    }]
  };
  const controller = createCustomStoryBuilderController({ state, els: {}, formatTokenCount: String });

  const readiness = controller.getCustomStoryReadiness();

  assert.equal(readiness.worldBookStoredTokens, 120000);
  assert.equal(readiness.worldBookEstimatedTokens, 6000);
  assert.equal(readiness.estimatedTokens, 7700);
  assert.match(readiness.guidance, /动态检索/);
  assert.doesNotMatch(readiness.guidance, /压缩常驻条目/);
});

test('custom story readiness warns about low character-resource matches without blocking creation', () => {
  const state = {
    customStoryDraft: createCustomStoryDraft({
      basePackId: 'xuanhuan',
      characterResourceId: 'character-nine',
      worldBookResourceIds: ['world-modern'],
      promptResourceIds: ['prompt-generic'],
      promptSelectionConfirmed: true
    }),
    customStoryComposition: {
      key: 'ready',
      status: 'ready',
      report: { summary: { finalEntries: 1 } },
      error: ''
    },
    contentPacks: [{
      id: 'xuanhuan',
      title: '神荒玄幻',
      counts: { worldBook: 1, promptModules: 1 },
      compatibility: { compatible: true, blockingCount: 0 }
    }],
    resourceLibrary: [
      {
        id: 'character-nine',
        kind: 'character',
        title: '九渊',
        payload: {
          name: '九渊',
          description: '仙侠修真世界中的宗门弟子。',
          scenario: '探索宗门秘境并继续修炼。'
        },
        diagnostics: { missingFields: [], warnings: [] }
      },
      {
        id: 'world-modern',
        kind: 'worldbook',
        title: '现代校园设定',
        payload: {
          entries: [{ title: '手机社交', content: '现代都市大学校园与职场规则。' }]
        },
        diagnostics: { warnings: [] }
      },
      {
        id: 'prompt-generic',
        kind: 'prompt',
        title: '通用长篇叙事',
        payload: {
          content: '保持上下文连贯。',
          extensions: { sillyTavernPreset: { presetTitle: '通用长篇叙事' } }
        },
        diagnostics: { warnings: [] }
      }
    ]
  };
  const controller = createCustomStoryBuilderController({
    state,
    els: {},
    groupPromptResources,
    formatTokenCount: String
  });

  const readiness = controller.getCustomStoryReadiness();
  const matchCheck = readiness.checks.find((item) => item.label === '素材匹配');

  assert.equal(readiness.canCreate, true);
  assert.equal(readiness.needsReview, true);
  assert.equal(readiness.resourceMatching.low, 1);
  assert.equal(readiness.resourceMatching.general, 1);
  assert.equal(matchCheck.tone, 'review');
  assert.match(matchCheck.value, /通用 1.*低匹配 1/);
  assert.match(readiness.guidance, /仍可创建.*确认题材冲突/);
});

test('saved prompt selections require explicit reconfirmation before creating a story', () => {
  const state = {
    customStoryDraft: createCustomStoryDraft({
      basePackId: 'xuanhuan',
      promptResourceIds: ['prompt-old']
    }),
    customStoryComposition: { key: '', status: 'idle', report: null, error: '' },
    contentPacks: [{
      id: 'xuanhuan',
      title: '神荒玄幻',
      counts: { worldBook: 1, promptModules: 1 },
      compatibility: { compatible: true, blockingCount: 0 }
    }],
    resourceLibrary: [{
      id: 'prompt-old',
      kind: 'prompt',
      title: '旧角色预设',
      diagnostics: { warnings: [], estimatedTokens: 100 }
    }]
  };
  const controller = createCustomStoryBuilderController({
    state,
    els: {},
    formatTokenCount: String
  });

  const readiness = controller.getCustomStoryReadiness();

  assert.equal(readiness.canCreate, false);
  assert.equal(readiness.promptSelectionNeedsConfirmation, true);
  assert.match(readiness.guidance, /草稿保留.*重新勾选确认/);
});

test('character-only stories explain the genre-only worldbook boundary', () => {
  const state = {
    customStoryDraft: createCustomStoryDraft({
      basePackId: 'xuanhuan',
      characterResourceId: 'character-1'
    }),
    customStoryComposition: {
      key: 'ready',
      status: 'ready',
      report: { summary: { finalEntries: 0 } },
      error: ''
    },
    contentPacks: [{
      id: 'xuanhuan',
      title: '神荒玄幻',
      counts: { worldBook: 54, promptModules: 17 },
      compatibility: { compatible: true, blockingCount: 0 }
    }],
    resourceLibrary: [{
      id: 'character-1',
      kind: 'character',
      title: '流程回归角色',
      payload: { name: '流程回归角色' },
      diagnostics: { missingFields: [], warnings: [], estimatedTokens: 269 }
    }]
  };
  const controller = createCustomStoryBuilderController({
    state,
    els: {},
    getCharacterPortraitUrl: () => '',
    formatTokenCount: String
  });

  const readiness = controller.getCustomStoryReadiness();

  assert.equal(readiness.effectiveWorldBookCount, 0);
  assert.equal(readiness.checks.find((item) => item.label === '世界设定').value, '题材框架继承 · 最终 0 条');
  assert.match(readiness.guidance, /不继承基线固定剧情.*第 3 步选择世界书/);
});

test('custom story controller keeps independent imports inside an original baseline', () => {
  const persisted = [];
  const state = {
    customStoryDraft: createCustomStoryDraft(),
    customStoryComposition: { key: '', status: 'idle', report: null, error: '' },
    contentPacks: [{ id: 'xuanhuan', title: '神荒玄幻', custom: false }],
    resourceLibrary: []
  };
  const controller = createCustomStoryBuilderController({
    state,
    els: {},
    storage: {
      setItem: (key, value) => persisted.push([key, JSON.parse(value)])
    },
    timerApi: {
      clearTimeout: () => {},
      setTimeout: () => 1
    },
    getStoryPackVisualId: () => 'xuanhuan'
  });

  const staged = controller.stageStoryResourcesFromCommittedImport({
    preview: {
      kind: 'character-card',
      summary: { characterName: '闻雪照', declaredGenre: '仙侠' }
    },
    libraryResources: [{
      id: 'character-x',
      kind: 'character',
      title: '闻雪照',
      payload: { name: '闻雪照', scenario: '断魂灯旧案尚未结束。' }
    }]
  }, {
    basePackId: 'xuanhuan',
    source: { fileName: 'wenxuezhao.json' },
    disposition: STORY_IMPORT_MODES.INDEPENDENT
  });

  assert.equal(staged.independentCopy, true);
  assert.equal(state.customStoryDraft.basePackId, CUSTOM_STORY_BASE_PACK_ID);
  assert.equal(state.customStoryDraft.creationMode, STORY_IMPORT_MODES.INDEPENDENT);
  assert.equal(state.customStoryDraft.characterResourceId, 'character-x');
  assert.equal(state.customStoryDraft.customBaseline.worldName, '闻雪照');
  assert.equal(state.customStoryDraft.customBaseline.visualPackId, 'neutral');
  assert.ok(persisted.length > 0);
});

test('importing a new character replaces stale prompts with prompts from the same import', () => {
  const state = {
    customStoryDraft: createCustomStoryDraft({
      basePackId: 'xuanhuan',
      characterResourceId: 'character-old',
      promptResourceIds: ['prompt-old'],
      promptSelectionConfirmed: true
    }),
    customStoryComposition: { key: '', status: 'idle', report: null, error: '' },
    contentPacks: [{ id: 'xuanhuan', title: '神荒玄幻', custom: false }],
    resourceLibrary: []
  };
  const controller = createCustomStoryBuilderController({
    state,
    els: {},
    storage: { setItem: () => {} },
    timerApi: { clearTimeout: () => {}, setTimeout: () => 1 }
  });

  controller.stageStoryResourcesFromCommittedImport({
    preview: { kind: 'character-card', summary: { characterName: '九渊' } },
    libraryResources: [
      { id: 'character-nine', kind: 'character', title: '九渊', payload: { name: '九渊' } },
      { id: 'prompt-nine', kind: 'prompt', title: '九渊同批预设' }
    ]
  }, { basePackId: 'xuanhuan' });

  assert.equal(state.customStoryDraft.characterResourceId, 'character-nine');
  assert.deepEqual(state.customStoryDraft.promptResourceIds, ['prompt-nine']);
  assert.equal(state.customStoryDraft.promptSelectionConfirmed, true);
});

test('custom baseline draft keeps the selected visual pack and safe defaults', () => {
  assert.equal(createCustomStoryDraft().basePackId, CUSTOM_STORY_BASE_PACK_ID);
  assert.deepEqual(createCustomBaselineDraft(), {
    templateId: 'blank',
    worldName: '',
    genre: '',
    premise: '',
    proseStyle: '',
    hardRules: '',
    visualPackId: 'neutral'
  });
  assert.equal(createCustomBaselineDraft({ visualPackId: 'lingyi' }).visualPackId, 'lingyi');
});

test('quickLaunchCharacterStory creates and opens an independent story from a character card directly', async () => {
  let createdPack = null;
  const state = {
    resourceLibrary: [
      { id: 'unrelated-preset', kind: 'prompt', title: '不相关文风', payload: {} },
      { id: 'char-1', kind: 'character', title: '苏凌雪', payload: { name: '苏凌雪', genre: '仙侠' } },
      { id: 'wb-1', kind: 'worldbook', title: '灵虚宗秘典', payload: { name: '灵虚宗秘典' }, source: { kind: 'character-card', id: 'char-1' } }
    ]
  };
  const controller = createCustomStoryBuilderController({
    state,
    els: {},
    apiRequest: async (url, options) => {
      if (url === '/api/resource-library/packs') {
        createdPack = options.body;
        return { pack: { id: 'pack-quick-1', ...options.body } };
      }
      return {};
    },
    createAndOpenStoryProject: async (pack) => ({ project: { title: pack.title }, session: { id: 'session-quick-1' } })
  });

  const result = await controller.quickLaunchCharacterStory('char-1');
  assert.equal(result.project.title, '苏凌雪的故事');
  assert.equal(createdPack.characterResourceId, 'char-1');
  assert.deepEqual(createdPack.promptResourceIds, []);
  assert.equal(createdPack.creationMode, STORY_IMPORT_MODES.INDEPENDENT);
});
