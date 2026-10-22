import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createImmersiveDossierToolkit,
  mergeImmersiveFacts,
  normalizeImmersiveRecords,
  parseImmersiveStatusFields,
  resolveLatestRoleplayPanels,
  resolveLatestTurnFrame,
  splitDirectorNoteSections
} from '../public/modules/immersiveDossier.js';
import {
  resolveImmersiveQuestRecords,
  resolveImmersiveRollingSummary
} from '../public/modules/immersiveStateProjection.js';
import {
  createImmersiveSidebarController,
} from '../public/modules/immersiveSidebar.js';
import {
  excludeImmersiveStructuredWorldBookEntries,
  getImmersiveWorldSystemGroups
} from '../public/modules/immersiveWorldRules.js';
import { createImmersiveLedgerController } from '../public/modules/immersiveLedgers.js';
import {
  deriveCloseCharacterGrowth,
  deriveImmersiveGrowthTracks
} from '../public/modules/immersiveGrowthLedger.js';

// Node 测试环境缺少浏览器动画帧 API；关系图谱的物理模拟依赖它。
// 提供 no-op 占位以避免 ReferenceError，初始 tick() 仍会渲染一次。
globalThis.requestAnimationFrame ??= () => 0;
globalThis.cancelAnimationFrame ??= () => {};

function createClassList() {
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
      return values.has(name);
    }
  };
}

function createNode(tagName = 'div') {
  const children = [];
  const attributes = {};
  let html = '';
  return {
    tagName,
    children,
    attributes,
    dataset: {},
    className: '',
    classList: createClassList(),
    style: {},
    textContent: '',
    title: '',
    hidden: false,
    append(...nodes) {
      children.push(...nodes);
    },
    replaceChildren(...nodes) {
      children.length = 0;
      children.push(...nodes);
    },
    setAttribute(name, value) {
      attributes[name] = String(value);
    },
    addEventListener() {},
    get childElementCount() {
      return children.length;
    },
    set innerHTML(value) {
      html = value;
      if (value === '') children.length = 0;
    },
    get innerHTML() {
      return html;
    }
  };
}

function createEventTarget(tagName = 'div') {
  const listeners = {};
  return {
    ...createNode(tagName),
    listeners,
    addEventListener(type, listener) {
      listeners[type] = listener;
    }
  };
}

const documentObject = {
  createElement: createNode
};

function collectNodeText(node) {
  return [node?.textContent, ...(node?.children || []).map(collectNodeText)].filter(Boolean).join(' ');
}

test('immersive dossier helpers normalize status, records and director notes', () => {
  assert.deepEqual(parseImmersiveStatusFields(`
【沈砚状态】
- 身份：巡夜人
- 体力：7/10
- 身份：巡夜人
无结构正文
  `), [
    { label: '身份', value: '巡夜人' },
    { label: '体力', value: '7/10' }
  ]);
  assert.deepEqual(mergeImmersiveFacts([
    ['身份', '巡夜人'],
    ['身份', '重复值'],
    ['物品', ['铜铃', '旧钥匙']]
  ]), [
    { label: '身份', value: '巡夜人' },
    { label: '物品', value: '铜铃、旧钥匙' }
  ]);
  assert.deepEqual(normalizeImmersiveRecords([
    { title: '线索', content: '旧值' },
    { title: '线索', content: '新值', status: 'active' }
  ], '事实'), [
    { title: '线索', detail: '新值', meta: '进行中' }
  ]);

  const notes = splitDirectorNoteSections('风险分析：关系即将破裂\n规则检查：没有越权');
  assert.deepEqual(notes.map((item) => item.title), ['风险分析', '规则检查']);
});

test('immersive dossier unwraps legacy summaries and treats canonical quest state as authoritative', () => {
  assert.equal(resolveImmersiveRollingSummary(JSON.stringify({
    rollingSummary: '刘一已经确认井底湿泥与漆木匣有关。'
  })), '刘一已经确认井底湿泥与漆木匣有关。');
  assert.equal(resolveImmersiveRollingSummary(
    `${JSON.stringify({ rollingSummary: '第一段是长期摘要。' })} ${JSON.stringify({ sceneTitle: '第二段场景摘要' })}`
  ), '第一段是长期摘要。');

  const quests = resolveImmersiveQuestRecords({
    knowledgeGraph: {
      nodes: [
        {
          type: 'Quest',
          sourceId: 'well-rope',
          name: '帮柴翁压井轱辘',
          properties: { id: 'well-rope', title: '帮柴翁压井轱辘', objective: '修好井绳', status: 'active' }
        },
        {
          type: 'Quest',
          sourceId: 'hidden-box',
          name: '石板下的漆木匣',
          properties: { id: 'hidden-box', title: '石板下的漆木匣', objective: '查明木匣来历', status: 'active' }
        }
      ]
    },
    worldState: {
      quests: [{ id: 'well-rope', title: 'well-rope', status: 'completed', progress: 100 }]
    }
  });

  assert.deepEqual(quests, []);

  const legacyQuests = resolveImmersiveQuestRecords({
    knowledgeGraph: {
      nodes: [{
        type: 'Quest',
        sourceId: 'hidden-box',
        name: '石板下的漆木匣',
        properties: { id: 'hidden-box', title: '石板下的漆木匣', objective: '查明木匣来历', status: 'active' }
      }]
    }
  });
  assert.deepEqual(legacyQuests.map((quest) => quest.title), ['石板下的漆木匣']);
  assert.equal(legacyQuests[0].description, '查明木匣来历');
});

test('latest roleplay panels merge recovered legacy controls with materialized message data', () => {
  const extractor = (content) => ({
    content,
    panels: content === 'latest'
      ? { directorNotes: '从旧消息恢复的生成规划', sceneStatus: '旧城门' }
      : content === 'parsed'
        ? { sceneStatus: '旧城门' }
        : {}
  });
  assert.deepEqual(resolveLatestRoleplayPanels([
    { role: 'assistant', content: 'parsed' },
    { role: 'user', content: '继续' },
    { role: 'assistant', content: 'latest', roleplayPanels: { sceneStatus: '新城门' } }
  ], extractor), { directorNotes: '从旧消息恢复的生成规划', sceneStatus: '新城门' });
  assert.deepEqual(resolveLatestRoleplayPanels([
    { role: 'assistant', content: 'parsed' }
  ], extractor), { sceneStatus: '旧城门' });
});

test('latest accepted turn frame is available to situation and clue ledgers in the same turn', () => {
  const frame = {
    validation: { status: 'accepted' },
    scene: { location: '青铜门后石室', presentActors: ['地伶'] },
    decision: { focus: '是否回应地伶', actor: '地伶', requiresPlayerResponse: true, urgency: 'high' },
    evidence: [{ text: '地伶仍在门外', status: 'confirmed', source: '正文' }]
  };
  assert.equal(resolveLatestTurnFrame([
    { role: 'assistant', content: '旧消息', turnFrame: { validation: { status: 'rejected' } } },
    { role: 'assistant', content: '新消息', turnFrame: frame }
  ]), frame);
});

test('committed turn snapshot wins over stale message projections and excludes invalid turns', () => {
  const messages = [
    { id: 'a1', role: 'assistant', content: '旧消息', roleplayPanels: { sceneStatus: '旧场景' } },
    { id: 'a2', role: 'assistant', content: '冲突消息', contextExcluded: true, roleplayPanels: { sceneStatus: '错误场景' } },
    { id: 'a3', role: 'assistant', content: '半截消息', aborted: true, roleplayPanels: { sceneStatus: '半截场景' } }
  ];
  const frame = {
    validation: { status: 'accepted' },
    scene: { location: '已提交场景' },
    decision: { focus: '回应当前人物' }
  };
  const snapshot = {
    spec: 'lra.turn-view-snapshot/v1',
    turnId: 'a1',
    roleplayPanels: { sceneStatus: '已提交场景' },
    turnFrame: frame
  };

  assert.deepEqual(resolveLatestRoleplayPanels(messages, () => ({ panels: {} }), snapshot), {
    sceneStatus: '已提交场景'
  });
  assert.equal(resolveLatestTurnFrame(messages, snapshot), frame);
});

test('immersive sidebar controller owns tab events, merged tabs and ledger dispatch', () => {
  const immersiveRightSidebar = createNode();
  const immersiveSidebarTabs = createEventTarget();
  const immersiveSidebarClose = createEventTarget('button');
  const immersiveSidebarContent = createNode();
  const immersiveSidebarTitle = createNode();
  const immersiveSidebarBody = createNode();
  const state = {
    immersiveSidebarTab: '',
    config: { lightFrontend: {}, characterCard: {}, worldBook: [] },
    session: {
      messages: [{
        role: 'assistant',
        content: '正文',
        roleplayPanels: { directorNotes: '因果检查：保持主角自主' }
      }],
      memory: {}
    }
  };
  const memoryCalls = [];
  const dossier = createImmersiveDossierToolkit({
    documentObject,
    extractRoleplayPresentation: () => ({ content: '', panels: {} })
  });
  const controller = createImmersiveSidebarController({
    state,
    els: {
      immersiveRightSidebar,
      immersiveSidebarTabs,
      immersiveSidebarClose,
      immersiveSidebarContent,
      immersiveSidebarTitle,
      immersiveSidebarBody
    },
    dossier,
    ledgers: {
      renderImmersiveMemoryLedger: (...args) => memoryCalls.push(args)
    },
    resolvePrologueTemplate: () => ({
      genre: 'wuxia',
      tpl: {
        sidebar: { tabs: ['主角档案', '梦入神机'] },
        tabs: {}
      }
    }),
    getCurrentStoryPresentation: () => ({ title: '夜雨江湖' }),
    getLightFrontendPanels: () => [{
      id: 'community',
      title: '社区面板',
      fields: [{ label: '危机', value: '逼近' }]
    }],
    resolveLightFrontendPanel: (panel) => panel,
    getLightFrontendContext: () => ({ sessionId: 'main' }),
    extractRoleplayPresentation: () => ({ content: '', panels: {} }),
    documentObject
  });

  controller.bindEvents();
  controller.renderImmersiveSidebar();

  assert.equal(immersiveSidebarTabs.children.length, 9);
  assert.deepEqual(
    immersiveSidebarTabs.children.map((node) => node.textContent),
    ['当前态势', '决策线索', '角色档案', '人物网络', '成长轨迹', '叙事记忆', '世界规则', '导演注记', '社区面板']
  );
  assert.equal(immersiveRightSidebar.classList.contains('hidden'), false);
  assert.equal(immersiveSidebarContent.classList.contains('hidden'), true);

  immersiveSidebarTabs.listeners.click({
      target: {
      closest: () => ({ dataset: { immersiveTab: '叙事记忆' } })
      }
    });
  assert.equal(state.immersiveSidebarTab, '叙事记忆');
  assert.deepEqual(memoryCalls, [['叙事记忆', 'wuxia']]);
  assert.equal(immersiveRightSidebar.classList.contains('expanded'), true);

  immersiveSidebarClose.listeners.click();
  assert.equal(state.immersiveSidebarTab, '');
  assert.equal(immersiveSidebarContent.classList.contains('hidden'), true);
});

test('immersive sidebar renders declarative community panels through dossier helpers', () => {
  const body = createNode();
  const state = {
    immersiveSidebarTab: '社区面板',
    config: { lightFrontend: {} },
    session: { messages: [], memory: {} }
  };
  const dossier = createImmersiveDossierToolkit({ documentObject });
  const controller = createImmersiveSidebarController({
    state,
    els: {
      immersiveRightSidebar: createNode(),
      immersiveSidebarTabs: createNode(),
      immersiveSidebarContent: createNode(),
      immersiveSidebarTitle: createNode(),
      immersiveSidebarBody: body
    },
    dossier,
    resolvePrologueTemplate: () => ({ genre: 'mystery', tpl: { sidebar: { tabs: [] } } }),
    getLightFrontendPanels: () => [{
      title: '社区面板',
      subtitle: '审计面板',
      summary: '只显示声明式数据',
      fields: [{ label: '线索', value: '铜铃' }],
      items: [{ title: '待核验', detail: '查看旧宅' }]
    }],
    resolveLightFrontendPanel: (panel) => panel,
    documentObject
  });

  controller.renderImmersiveSidebar();

  assert.equal(body.children.length, 1);
  assert.match(body.children[0].className, /immersive-dossier-community/);
  assert.equal(body.children[0].children.at(-1).children.length, 2);
});

test('current situation has a dedicated sidebar dispatch rather than sharing story-clue rendering', () => {
  const calls = [];
  const state = {
    immersiveSidebarTab: '当前态势',
    config: { lightFrontend: {} },
    session: { messages: [], memory: {} }
  };
  const controller = createImmersiveSidebarController({
    state,
    els: {
      immersiveRightSidebar: createNode(),
      immersiveSidebarTabs: createNode(),
      immersiveSidebarContent: createNode(),
      immersiveSidebarTitle: createNode(),
      immersiveSidebarBody: createNode()
    },
    ledgers: {
      renderImmersiveSituationLedger: (...args) => calls.push(['situation', ...args]),
      renderImmersiveIntelligenceLedger: (...args) => calls.push(['intelligence', ...args])
    },
    resolvePrologueTemplate: () => ({ genre: 'mystery', tpl: { sidebar: { tabs: [] } } }),
    documentObject
  });

  controller.renderImmersiveSidebar();

  assert.deepEqual(calls, [['situation', '当前态势', { sidebar: { tabs: [] } }, 'mystery']]);
});

test('role archive stays independent from the relationship network and exposes character management', () => {
  const body = createEventTarget();
  const state = {
    immersiveSidebarTab: '角色档案',
    config: {
      lightFrontend: {},
      characterCard: { name: '刘一' },
      groupMembers: [{ name: '江小鲤', role: '引路人', description: '熟悉旧城暗道', enabled: true }]
    },
    session: { messages: [], memory: { worldState: { protagonist: { name: '刘一' } } } }
  };
  let manageCount = 0;
  const controller = createImmersiveSidebarController({
    state,
    els: {
      immersiveRightSidebar: createNode(),
      immersiveSidebarTabs: createNode(),
      immersiveSidebarContent: createNode(),
      immersiveSidebarTitle: createNode(),
      immersiveSidebarBody: body
    },
    dossier: createImmersiveDossierToolkit({ documentObject }),
    resolvePrologueTemplate: () => ({ genre: 'mystery', tpl: { sidebar: { tabs: [] }, tabs: {} } }),
    openCharacterManagement: () => { manageCount += 1; },
    documentObject
  });

  controller.bindEvents();
  controller.renderImmersiveSidebar();

  const archiveText = collectNodeText(body);
  assert.match(archiveText, /江小鲤/);
  assert.match(archiveText, /管理角色档案/);
  body.listeners.click({
    target: {
      closest: () => ({ dataset: { immersiveCharacterAction: 'manage' } })
    }
  });
  assert.equal(manageCount, 1);
});

test('story clues and relationship forces render as separate ledgers', () => {
  const body = createNode();
  const state = {
    config: { characterCard: { name: '刘一' }, worldBook: [] },
    session: {
      messages: [],
      memory: {
        worldState: {
          protagonist: { name: '刘一' },
          quests: [{ name: '调查西门', status: 'active' }],
          relationships: [{ name: '江小鲤', relation: '青梅竹马', encountered: true }],
          factions: [{ name: '凌霄宗', relation: '所属宗门' }]
        },
        memoryCards: [{ title: '西门线索', content: '炭路脚印异常' }]
      }
    }
  };
  const dossier = createImmersiveDossierToolkit({ documentObject });
  const ledgers = createImmersiveLedgerController({
    state,
    els: { immersiveSidebarBody: body },
    dossier,
    getCurrentStoryPresentation: () => ({ title: '未尽夏', custom: true }),
    documentObject
  });

  ledgers.renderImmersiveIntelligenceLedger('决策线索', {}, 'xianxia');
  const storyText = collectNodeText(body);
  assert.match(storyText, /调查西门/);
  assert.match(storyText, /西门线索/);
  assert.doesNotMatch(storyText, /青梅竹马|凌霄宗/);

  ledgers.renderImmersiveRelationshipLedger('人物网络', {}, 'xianxia');
  const relationshipText = collectNodeText(body);
  assert.match(relationshipText, /关系人物档案/);
  assert.match(relationshipText, /查看完整角色档案/);
  assert.match(relationshipText, /江小鲤/);
  assert.match(relationshipText, /凌霄宗/);
  assert.doesNotMatch(relationshipText, /调查西门|炭路脚印异常/);
});

test('decision clues exclude resolved tasks, whole-prose fallback and unrelated character profiles', () => {
  const body = createNode();
  const state = {
    config: {
      characterCard: { name: '刘一' },
      worldBook: [
        { id: 'woodcutter-style', title: '柴翁_性格调色盘', content: '每次经手宗门任务都要反复核对。', enabled: true },
        { id: 'well-clue', title: '井底线索', content: '井底暗红湿泥与漆木匣存在关联。', enabled: true },
        { id: 'inactive-clue', title: '山门传闻', content: '尚未触发的旧传闻。', enabled: true }
      ]
    },
    session: {
      messages: [{
        id: 'turn-1',
        role: 'assistant',
        content: '柴翁把水桶推到刘一面前。',
        turnFrame: {
          validation: { status: 'accepted' },
          evidence: [{ text: '整段正文不应作为线索重复显示', status: 'hypothesis', source: 'accepted-prose-fallback' }]
        }
      }],
      turnViewSnapshot: {
        spec: 'lra.turn-view-snapshot/v1',
        turnId: 'turn-1',
        worldBookActivation: { activatedIds: ['well-clue'] }
      },
      memory: {
        worldState: { quests: [{ id: 'well-rope', title: 'well-rope', status: 'completed', progress: 100 }] },
        knowledgeGraph: {
          nodes: [
            { type: 'Quest', sourceId: 'well-rope', name: '帮柴翁压井轱辘', properties: { id: 'well-rope', title: '帮柴翁压井轱辘', objective: '修好井绳', status: 'active' } },
            { type: 'Quest', sourceId: 'hidden-box', name: '石板下的漆木匣', properties: { id: 'hidden-box', title: '石板下的漆木匣', objective: '查明木匣来历', status: 'active' } }
          ]
        },
        memoryCards: [{
          title: '井底出现暗红湿泥',
          content: '柴翁透露井底也有同样湿泥。',
          enabled: false,
          extensions: { stability: 'confirmed', reviewStatus: 'candidate' }
        }]
      }
    }
  };
  const ledgers = createImmersiveLedgerController({
    state,
    els: { immersiveSidebarBody: body },
    dossier: createImmersiveDossierToolkit({ documentObject }),
    getCurrentStoryPresentation: () => ({ title: '绝世仙宗', custom: false }),
    documentObject
  });

  ledgers.renderImmersiveIntelligenceLedger('决策线索', {}, 'xianxia');
  const text = collectNodeText(body);
  assert.match(text, /井底出现暗红湿泥|井底线索/);
  assert.doesNotMatch(text, /帮柴翁压井轱辘|石板下的漆木匣|整段正文不应作为线索重复显示|柴翁_性格调色盘|山门传闻/);
});

test('current situation, growth and memory consume immediate turn records instead of waiting for a later extraction', () => {
  const body = createNode();
  const state = {
    config: { characterCard: { name: '刘一', role: '巡夜人' }, worldBook: [] },
    session: {
      messages: [],
      memory: {
        rollingSummary: JSON.stringify({ rollingSummary: '刘一已经确认旧宅门口的异常动静。' }),
        unsummarizedTurnCount: 1,
        worldState: {
          protagonist: { name: '刘一', status: '气血 7/10', skills: ['听风辨位'] },
          location: { name: '旧宅门口' },
          quests: [{ name: '调查西门', status: 'active' }],
          relationships: [{ from: '刘一', to: '江小鲤', type: '旧识', details: '互相信任', encountered: true }],
          resourceLedger: [{ item: '铜铃', owner: '刘一', source: '旧宅' }]
        },
        eventLedger: [{
          timestamp: '2026-08-07T10:00:00.000Z',
          visibility: 'public',
          status: 'observed',
          summary: '用户行动：推开旧宅木门。回应摘要：门后传来铜铃声。'
        }],
        episodicMemory: {
          episodes: [{
            status: 'confirmed',
            visibility: 'player',
            title: '旧宅门口的铜铃声',
            summary: '刘一推开木门，确认门后有铜铃声。',
            scene: '旧宅门口'
          }]
        },
        memoryCards: []
      }
    }
  };
  const dossier = createImmersiveDossierToolkit({ documentObject });
  const ledgers = createImmersiveLedgerController({
    state,
    els: { immersiveSidebarBody: body },
    dossier,
    getCurrentStoryPresentation: () => ({ title: '夜雨江湖', custom: true }),
    documentObject
  });

  ledgers.renderImmersiveSituationLedger('当前态势', {}, 'wuxia');
  const situationText = collectNodeText(body);
  assert.match(situationText, /旧宅门口|刚刚发生|铜铃声/);
  assert.doesNotMatch(situationText, /江小鲤|旧识/);

  ledgers.renderImmersiveProgressLedger('成长', {}, 'wuxia');
  const progressText = collectNodeText(body);
  assert.match(progressText, /气血 7\/10|听风辨位|铜铃/);

  ledgers.renderImmersiveMemoryLedger('记忆', 'wuxia');
  const memoryText = collectNodeText(body);
  assert.match(memoryText, /长期记忆|刚刚写入|本幕纪事|旧宅门口的铜铃声/);
  assert.match(memoryText, /刘一已经确认旧宅门口的异常动静/);
  assert.doesNotMatch(memoryText, /rollingSummary/);
});

test('growth tracks follow card/world rules and include only close characters with recorded evidence', () => {
  const tracks = deriveImmersiveGrowthTracks({
    protagonist: { realm: '筑基初期', skills: ['听风辨位'], condition: '气血 7/10' },
    statusFields: [{ label: '声望', value: '20/100' }],
    characterCard: { description: '修士通过境界、功法与声望成长。' },
    worldBook: [{ title: '修行体系', content: '境界、功法与心魔会改变角色成长。' }]
  });
  assert.match(tracks.map((item) => item.title).join(' '), /阶段与身份|能力与技艺|状态与代价|关系与影响/);
  assert.match(tracks.map((item) => item.detail).join(' '), /筑基初期|听风辨位|气血 7\/10/);

  const closeCharacters = deriveCloseCharacterGrowth({
    protagonistName: '刘一',
    characters: [
      { name: '江小鲤', realm: '炼气后期', skills: ['水遁'], status: '负伤' },
      { name: '凌霄宗主', realm: '元婴期', status: '未登场' }
    ],
    relationships: [
      { from: '刘一', to: '江小鲤', type: '旧识', details: '彼此信任', encountered: true },
      { from: '刘一', to: '凌霄宗主', type: '敌对', details: '尚未接触', encountered: false }
    ],
    eventLedger: [{ visibility: 'public', summary: '江小鲤施展水遁救下刘一。' }]
  });
  assert.deepEqual(closeCharacters.map((item) => item.title), ['江小鲤']);
  assert.match(closeCharacters[0].detail, /炼气后期|水遁|本回合已在事件记录中出现/);

  const longStatus = '晨间在杂役院排房清扫时，刘一用扁杆撬起屋角青石板。'.repeat(20);
  const compactTracks = deriveImmersiveGrowthTracks({
    protagonist: { condition: longStatus },
    characterCard: { description: '状态与代价会影响成长。' }
  });
  assert.ok(compactTracks.find((item) => item.title === '状态与代价').detail.length < 220);
});

test('world system grouping only returns populated bounded structures', () => {
  const groups = getImmersiveWorldSystemGroups({
    topology: {
      nodes: Array.from({ length: 8 }, (_, index) => ({
        name: `地点 ${index + 1}`,
        summary: `说明 ${index + 1}`,
        constant: index === 0
      }))
    },
    economy: { rules: [{ title: '银钱规则', summary: '价格随战乱波动' }] }
  }, (value, limit) => String(value).slice(0, limit));

  assert.equal(groups.length, 2);
  assert.equal(groups[0].title, '地点拓扑');
  assert.equal(groups[0].items.length, 6);
  assert.equal(groups[0].items[0].meta, '常驻');
  assert.equal(groups[1].title, '经济铁律');
});

test('world systems classify each source once and hide represented raw world-book entries', () => {
  const shared = {
    name: '笙芝_基础信息',
    summary: '角色档案与日程。',
    sourceEntryId: 'character-book-14'
  };
  const groups = getImmersiveWorldSystemGroups({
    population: { profiles: [shared] },
    factions: { entities: [{ ...shared, summary: '不应重复为势力。' }] },
    cultivation: { rules: [{ ...shared, summary: '不应重复为修行。' }] },
    economy: { rules: [{ title: '灵石价格', summary: '随供需变化', sourceEntryId: 'economy-1' }] }
  });

  assert.equal(groups.flatMap((group) => group.items).filter((item) => item.sourceEntryId === 'character-book-14').length, 1);
  assert.equal(groups.find((group) => group.title === '人物与日程')?.items[0]?.title, '笙芝_基础信息');
  assert.equal(groups.some((group) => group.title === '势力演化'), false);
  assert.equal(groups.some((group) => group.title === '修行刻度与反噬'), false);

  const remaining = excludeImmersiveStructuredWorldBookEntries([
    { id: 'character-book-14', title: '笙芝_基础信息' },
    { id: 'economy-1', title: '灵石价格' },
    { id: 'unstructured-1', title: '未结构化规则' }
  ], groups);
  assert.deepEqual(remaining.map((entry) => entry.id), ['unstructured-1']);
});

test('world system grouping repairs legacy character and protocol misclassification', () => {
  const groups = getImmersiveWorldSystemGroups({
    topology: { nodes: [{ name: '[mvu_update]变量更新规则', sourceEntryId: 'mvu-rules' }] },
    factions: { entities: [{ name: '地伶_性格调色盘', summary: '角色性格资料', sourceEntryId: 'diling-profile' }] },
    economy: { rules: [{ name: '地伶_性格调色盘', summary: '误判为经济规则', sourceEntryId: 'diling-profile' }] },
    cultivation: {
      rules: [
        { name: '地伶_性格调色盘', summary: '误判为修行规则', sourceEntryId: 'diling-profile' },
        { name: '修行体系', summary: '真实修行规则', sourceEntryId: 'cultivation-law' }
      ]
    }
  });

  assert.equal(groups.find((group) => group.title === '人物与日程')?.items[0]?.title, '地伶_性格调色盘');
  assert.equal(groups.some((group) => group.title === '地点拓扑'), false);
  assert.equal(groups.some((group) => group.title === '势力演化'), false);
  assert.equal(groups.some((group) => group.title === '经济铁律'), false);
  assert.deepEqual(groups.find((group) => group.title === '修行刻度与反噬')?.items.map((item) => item.title), ['修行体系']);
});

test('world system grouping assigns identical multi-domain summaries to their strongest semantic section', () => {
  const worldView = {
    name: '世界观',
    summary: '修仙条件是觉醒灵根，灵根决定修炼功法，并按炼气、筑基、金丹等境界逐步突破。',
    sourceEntryId: 'world-view'
  };
  const groups = getImmersiveWorldSystemGroups({
    factions: { entities: [worldView] },
    cultivation: { rules: [worldView] }
  });

  assert.equal(groups.some((group) => group.title === '势力演化'), false);
  assert.deepEqual(groups.find((group) => group.title === '修行刻度与反噬')?.items.map((item) => item.title), ['世界观']);
});
