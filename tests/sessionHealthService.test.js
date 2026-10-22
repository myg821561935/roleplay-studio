import test from 'node:test';
import assert from 'node:assert/strict';

import { inspectSessionHealth } from '../server/services/sessionHealthService.js';

const BUILT_IN_PACK = {
  id: 'xuanhuan',
  characterCard: {
    name: '原生主角',
    description: '原生描述',
    personality: '原生性格',
    scenario: '原生场景',
    firstMessage: '原生开场'
  },
  worldBook: [{
    id: 'native-world',
    type: 'world-premise',
    title: '原生世界',
    keywords: ['原生'],
    content: '原生世界规则'
  }],
  promptModules: [{
    id: 'native-prompt',
    title: '原生 Prompt',
    content: '遵循原生剧本'
  }]
};

test('golden journey: an independent custom session stays healthy without native leakage', () => {
  const session = createSession();
  const report = inspectSessionHealth(session, createContext());

  assert.equal(report.spec, 'lra.session-health/v1');
  assert.equal(report.status, 'healthy');
  assert.deepEqual(report.summary, { errors: 0, warnings: 0, passes: 7, total: 7 });
});

test('golden journey: native content and rule identity leaking into a custom session are blocked', () => {
  const session = createSession({
    config: {
      ...createConfig(),
      characterCard: structuredClone(BUILT_IN_PACK.characterCard),
      worldBook: structuredClone(BUILT_IN_PACK.worldBook),
      promptModules: structuredClone(BUILT_IN_PACK.promptModules)
    },
    memory: {
      resourcePackId: 'custom-story',
      ruleSystem: { contentPackId: 'xuanhuan' }
    }
  });
  const report = inspectSessionHealth(session, createContext());
  const boundary = report.checks.find((item) => item.id === 'builtin-content-boundary');

  assert.equal(report.status, 'blocked');
  assert.equal(boundary.status, 'error');
  assert.match(boundary.detail, /原生素材包 xuanhuan/);
  assert.match(boundary.detail, /世界书 1、Prompt 1、角色卡 1/);
});

test('golden journey: explicit base inheritance permits matching native content', () => {
  const session = createSession({
    config: {
      ...createConfig(),
      characterCard: structuredClone(BUILT_IN_PACK.characterCard),
      worldBook: structuredClone(BUILT_IN_PACK.worldBook),
      promptModules: structuredClone(BUILT_IN_PACK.promptModules)
    }
  });
  const context = createContext({
    currentPack: {
      id: 'custom-story',
      custom: true,
      resourceManifest: { baseInheritanceMode: 'genre' }
    }
  });
  const report = inspectSessionHealth(session, context);

  assert.equal(report.checks.find((item) => item.id === 'builtin-content-boundary').status, 'pass');
});

test('golden journey: a 118-module preset is a management warning rather than an import failure', () => {
  const promptModules = Array.from({ length: 118 }, (_, index) => ({
    id: `module-${index}`,
    title: `模块 ${index}`,
    content: `规则 ${index}`,
    enabled: index < 3
  }));
  const session = createSession({ config: { ...createConfig(), promptModules } });
  const report = inspectSessionHealth(session, createContext());
  const prompt = report.checks.find((item) => item.id === 'prompt-stack');

  assert.equal(report.status, 'warning');
  assert.equal(prompt.status, 'warning');
  assert.match(prompt.detail, /共 118 个模块/);
  assert.doesNotMatch(prompt.title, /导入失败/);
});

test('golden journey: a third-party script enters local observation with an audit action', () => {
  const session = createSession({
    config: {
      ...createConfig(),
      lightFrontend: {
        regexTransforms: [{
          id: 'community-panel',
          name: '社区面板',
          pattern: '<panel>([\\s\\S]*?)</panel>',
          replacement: '<script>document.body.textContent = "ready"</script>',
          requiresSandbox: true,
          enabled: true
        }]
      }
    }
  });
  const report = inspectSessionHealth(session, createContext());
  const scripts = report.checks.find((item) => item.id === 'script-governance');

  assert.equal(scripts.status, 'warning');
  assert.deepEqual(scripts.action, {
    kind: 'open-script-audit',
    scriptIds: ['community-panel']
  });
  assert.match(scripts.title, /本地观察模式运行/);
  assert.match(scripts.detail, /无网络、无父页面权限的沙箱中运行并记录/);
});

test('golden journey: development compatibility probe is visible as a local-debugging warning', () => {
  const session = createSession({
    config: {
      ...createConfig(),
      lightFrontend: {
        scriptExecutionMode: 'compatibility-probe',
        regexTransforms: [{
          id: 'community-panel',
          name: '社区面板',
          pattern: '<panel>([\\s\\S]*?)</panel>',
          replacement: '<script>document.body.textContent = "ready"</script>',
          requiresSandbox: true,
          enabled: true
        }]
      }
    }
  });
  const report = inspectSessionHealth(session, createContext());
  const scripts = report.checks.find((item) => item.id === 'script-governance');

  assert.equal(scripts.status, 'warning');
  assert.match(scripts.title, /开发兼容探针/);
  assert.match(scripts.detail, /外部资源、使用网络、表单、嵌套页面与 Worker/);
  assert.match(scripts.recommendation, /仅用于本地角色卡兼容调试/);
  assert.equal(scripts.metrics.executionMode, 'compatibility-probe');
});

test('golden journey: a safe derivative exposes every disabled source capability', () => {
  const report = inspectSessionHealth(createSession(), createContext({
    currentPack: {
      id: 'custom-story',
      custom: true,
      resourceManifest: {
        baseInheritanceMode: 'none',
        composition: {
          compatibilityReview: {
            contractVersion: 2,
            status: 'safe-derivative-approved',
            acknowledgedCompatibility: true,
            sourceRuntimeBlocked: true,
            approvedScriptHashes: [],
            disabledCapabilities: [{
              id: 'tavern-helper',
              label: '酒馆助手运行时',
              impact: '事件钩子与宿主变量不会执行'
            }]
          }
        }
      }
    }
  }));
  const compatibility = report.checks.find((item) => item.id === 'resource-compatibility');

  assert.equal(report.status, 'warning');
  assert.equal(compatibility.status, 'warning');
  assert.match(compatibility.title, /安全派生版/);
  assert.match(compatibility.detail, /酒馆助手运行时/);
  assert.deepEqual(compatibility.evidence, ['酒馆助手运行时：事件钩子与宿主变量不会执行']);
  assert.equal(compatibility.metrics.disabledCount, 1);
});

test('golden journey: a legacy custom pack offers a non-destructive compatibility upgrade action', () => {
  const report = inspectSessionHealth(createSession(), createContext({
    currentPack: {
      id: 'custom-story',
      custom: true,
      resourceManifest: { baseInheritanceMode: 'none', composition: {} }
    }
  }));
  const compatibility = report.checks.find((item) => item.id === 'resource-compatibility');

  assert.equal(compatibility.status, 'warning');
  assert.deepEqual(compatibility.action, {
    kind: 'upgrade-compatibility-audit',
    packId: 'custom-story'
  });
});

test('golden journey: a blocked source runtime without exact removals fails health inspection', () => {
  const report = inspectSessionHealth(createSession(), createContext({
    currentPack: {
      id: 'custom-story',
      custom: true,
      resourceManifest: {
        baseInheritanceMode: 'none',
        composition: {
          compatibilityReview: {
            contractVersion: 2,
            status: 'approved',
            acknowledgedCompatibility: false,
            sourceRuntimeBlocked: true,
            disabledCapabilities: []
          }
        }
      }
    }
  }));
  const compatibility = report.checks.find((item) => item.id === 'resource-compatibility');

  assert.equal(report.status, 'blocked');
  assert.equal(compatibility.status, 'error');
  assert.match(compatibility.evidence.join('\n'), /安全派生确认/);
  assert.match(compatibility.evidence.join('\n'), /被禁用的源运行时能力/);
});

test('golden journey: prompt protocol leaking into recommended actions is detected', () => {
  const session = createSession({
    messages: [{
      id: 'assistant-1',
      role: 'assistant',
      content: '她递来一杯水。',
      recommendedActions: ['step3：编排：正文前注释 -> <plot>正文</plot>']
    }]
  });
  const report = inspectSessionHealth(session, createContext());
  const conversation = report.checks.find((item) => item.id === 'conversation-integrity');

  assert.equal(conversation.status, 'warning');
  assert.match(conversation.detail, /行动选项混入 Prompt\/协议指令/);
});

test('golden journey: reasoning-only output and broken Swipe pointers are blocked', () => {
  const session = createSession({
    messages: [{
      id: 'assistant-1',
      role: 'assistant',
      content: '<think>只有推理，没有正文</think>',
      swipes: ['另一个正文'],
      activeSwipeIndex: 0,
      swipeMetadata: []
    }]
  });
  const report = inspectSessionHealth(session, createContext());
  const conversation = report.checks.find((item) => item.id === 'conversation-integrity');

  assert.equal(report.status, 'blocked');
  assert.equal(conversation.status, 'error');
  assert.match(conversation.evidence.join('\n'), /只包含推理过程/);
  assert.match(conversation.evidence.join('\n'), /内容与当前 Swipe 不一致/);
});

test('community planing-only output is treated as reasoning without story prose', () => {
  const session = createSession({
    messages: [{
      id: 'assistant-planing',
      role: 'assistant',
      content: '<planing>规划人物入场与线索递进</planing>'
    }]
  });
  const report = inspectSessionHealth(session, createContext());
  const conversation = report.checks.find((item) => item.id === 'conversation-integrity');

  assert.equal(conversation.status, 'error');
  assert.match(conversation.evidence.join('\n'), /只包含推理过程/);
});

function createSession(overrides = {}) {
  return {
    id: 'custom-session',
    title: '自定义剧本',
    basePackId: 'custom-story',
    config: createConfig(),
    memory: {
      resourcePackId: 'custom-story',
      ruleSystem: { contentPackId: 'custom-story' }
    },
    settings: { maxPromptTokens: 8000 },
    messages: [{
      id: 'assistant-opening',
      role: 'assistant',
      content: '雨声落在窗外。',
      swipes: ['雨声落在窗外。'],
      activeSwipeIndex: 0,
      swipeMetadata: [{}]
    }],
    ...overrides
  };
}

function createConfig() {
  return {
    contentPackId: 'custom-story',
    characterCard: {
      name: '自定义角色',
      description: '自定义描述',
      personality: '自定义性格',
      scenario: '自定义场景'
    },
    worldBook: [{
      id: 'custom-world',
      type: 'world-premise',
      title: '自定义世界',
      keywords: ['自定义'],
      content: '自定义世界规则'
    }],
    promptModules: [{ id: 'custom-prompt', title: '写作约束', content: '保持人物一致。' }],
    persona: {},
    lightFrontend: {}
  };
}

function createContext(overrides = {}) {
  return {
    builtInPacks: [BUILT_IN_PACK],
    currentPack: {
      id: 'custom-story',
      custom: true,
      resourceManifest: {
        baseInheritanceMode: 'none',
        composition: {
          compatibilityReview: {
            contractVersion: 2,
            status: 'not-required',
            acknowledgedCompatibility: false,
            sourceRuntimeBlocked: false,
            disabledCapabilities: [],
            approvedScriptHashes: []
          }
        }
      }
    },
    primaryPackId: 'custom-story',
    packReferences: {
      session: 'custom-story',
      config: 'custom-story',
      memory: 'custom-story',
      rules: 'custom-story'
    },
    generatedAt: '2026-08-03T00:00:00.000Z',
    ...overrides
  };
}
