import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildImmersiveCharacterGroups,
  buildImmersiveRelationshipGraph,
  collectImmersiveCharacterMembers,
  renderImmersiveRelationshipGraph
} from '../public/modules/relationshipGraph.js';
import { extractCharacterPanelExcerpt } from '../public/modules/immersiveSidebar.js';

test('interactive character collection recognizes materialized status panels and prior encounters', () => {
  const members = collectImmersiveCharacterMembers({
    protagonistNames: ['刘一'],
    relationships: [
      { name: '江小鲤', role: '凌霄山庄小姐', encountered: true, relationship: '已结识' },
      { name: '苏师兄', role: '杂役院前辈', encountered: false, relationship: '间接关联，尚未见面' }
    ],
    messages: [{
      role: 'assistant',
      roleplayPanels: {
        characterStatus: '『张三·角色状态』\n身份：杂役\n『刘一·主角状态』\n身份：炉鼎体质',
        relationshipStatus: '刘一→张三：交换了西门消息'
      }
    }],
    interactiveStatus: '『江小鲤·状态』\n身份：庄主之女',
    relationshipStatus: '刘一→江小鲤：获得帮助'
  });

  assert.deepEqual(members.map((member) => member.name).sort(), ['张三', '江小鲤']);
  assert.match(extractCharacterPanelExcerpt('『江小鲤·状态』\n身份：庄主之女', '江小鲤'), /庄主之女/);
});

test('relationship graph distinguishes direct encounters, indirect links and factions', () => {
  const graph = buildImmersiveRelationshipGraph({
    protagonistName: '刘一',
    relationships: [
      { name: '江小鲤', role: '凌霄山庄小姐', encountered: true, relationship: '救命之恩' },
      { name: '苏师兄', encountered: false, status: '仅从他人口中得知，尚未见面' }
    ],
    factions: [{ name: '凌霄山庄', status: '当前所在势力' }],
    relationshipStatus: '刘一→江小鲤：信任增加'
  });

  assert.equal(graph.nodes.find((node) => node.id === '刘一').type, 'protagonist');
  assert.equal(graph.nodes.find((node) => node.id === '江小鲤').direct, true);
  assert.equal(graph.nodes.find((node) => node.id === '苏师兄').direct, false);
  assert.equal(graph.nodes.find((node) => node.id === '凌霄山庄').type, 'faction');
  assert.ok(graph.edges.some((edge) => edge.source === '刘一' && edge.target === '江小鲤'));
});

test('relationship graph consumes the server knowledge-graph projection', () => {
  const graph = buildImmersiveRelationshipGraph({
    protagonistName: '刘一',
    graphProjection: {
      nodes: [
        { id: 'c1', type: 'Character', label: '刘一', properties: { protagonist: true } },
        { id: 'c2', type: 'Character', label: '江小鲤', properties: { role: '庄主之女', encountered: true } },
        { id: 'f1', type: 'Faction', label: '凌霄山庄', properties: {} }
      ],
      edges: [
        { source: 'c1', target: 'c2', type: 'TRUSTS', label: '逐渐信任', properties: {} },
        { source: 'c2', target: 'f1', type: 'MEMBER_OF', properties: {} }
      ]
    }
  });

  assert.equal(graph.nodes.find((node) => node.id === '江小鲤').role, '庄主之女');
  assert.ok(graph.edges.some((edge) => edge.source === '江小鲤' && edge.target === '凌霄山庄'));
});

test('relationship graph and interactive roster consume canonical from-to relationship records', () => {
  const relationships = [{
    from: '刘一',
    to: '周媛',
    type: '性指导员-被指导者',
    details: '当晚互动已经结束，周媛正在送行。',
    encountered: true
  }];
  const graph = buildImmersiveRelationshipGraph({ protagonistName: '刘一', relationships });
  const members = collectImmersiveCharacterMembers({ protagonistNames: ['刘一'], relationships });

  assert.ok(graph.nodes.some((node) => node.id === '周媛' && node.direct));
  assert.ok(graph.edges.some((edge) => edge.source === '刘一' && edge.target === '周媛' && /性指导员/.test(edge.label)));
  assert.deepEqual(members.map((member) => member.name), ['周媛']);
  assert.match(members[0].relationship, /当晚互动已经结束/);
});

test('interactive roster uses the session registry as the source of current act state', () => {
  const members = collectImmersiveCharacterMembers({
    protagonistNames: ['陈默'],
    registry: {
      records: [
        {
          id: 'protagonist:chenmo',
          name: '陈默',
          kind: 'protagonist',
          profile: { role: '调查者' },
          session: { encountered: true }
        },
        {
          id: 'source-npc:tangyue',
          name: '唐月',
          kind: 'source-npc',
          profile: { role: '刑警', description: '正在协助调查。' },
          session: { encountered: true, status: '检查门锁' }
        }
      ],
      currentAct: {
        members: [{
          characterId: 'source-npc:tangyue',
          name: '唐月',
          state: 'on-stage',
          status: '检查门锁'
        }]
      }
    }
  });

  assert.deepEqual(members.map((member) => member.name), ['唐月']);
  assert.equal(members[0].actState, 'on-stage');
  assert.equal(members[0].actStatus, '检查门锁');
});

test('character roster separates protagonist, current act, and declared source roles', () => {
  const groups = buildImmersiveCharacterGroups({
    protagonistNames: ['陈默'],
    registry: {
      records: [
        {
          id: 'protagonist:chenmo',
          name: '陈默',
          kind: 'protagonist',
          source: { kind: 'character-card' },
          profile: { role: '调查者' },
          session: { encountered: true }
        },
        {
          id: 'world-book:tangyue',
          name: '唐月',
          kind: 'source-npc',
          source: { kind: 'world-book' },
          profile: { role: '刑警' },
          session: { encountered: true }
        },
        {
          id: 'group-member:linwan',
          name: '林晚',
          kind: 'source-npc',
          source: { kind: 'group-member' },
          profile: { role: '房东' },
          session: { encountered: false }
        },
        {
          id: 'simulation-actor:scenario',
          name: '旧城区谜案',
          kind: 'source-npc',
          source: { kind: 'simulation-actor' },
          profile: { role: '场景容器' },
          session: { encountered: false }
        }
      ],
      currentAct: {
        members: [
          { characterId: 'protagonist:chenmo', name: '陈默', state: 'on-stage' },
          { characterId: 'world-book:tangyue', name: '唐月', state: 'on-stage', status: '检查门锁' }
        ]
      }
    }
  });

  assert.deepEqual(groups.protagonist.map((member) => member.name), ['陈默']);
  assert.deepEqual(groups.currentAct.map((member) => member.name), ['唐月']);
  assert.equal(groups.currentAct[0].rosterStatus, '当前在场');
  assert.deepEqual(groups.declared.map((member) => member.name), ['林晚']);
  assert.equal(groups.declared[0].sourceLabel, '角色卡角色');
  assert.equal(groups.declared[0].rosterStatus, '设定角色，尚未登场');
});

test('renderImmersiveRelationshipGraph renders graph and displays rich panorama on node interaction', () => {
  const elements = [];
  const createMockNode = (tagName) => {
    const listeners = new Map();
    const classList = new Set();
    const attributes = new Map();
    const children = [];
    const node = {
      tagName,
      className: '',
      innerHTML: '',
      textContent: '',
      children,
      classList: {
        add: (...names) => names.forEach(n => classList.add(n)),
        remove: (...names) => names.forEach(n => classList.delete(n)),
        toggle: (name, force) => force ? classList.add(name) : classList.delete(name),
        has: (name) => classList.has(name)
      },
      setAttribute: (k, v) => attributes.set(k, v),
      getAttribute: (k) => attributes.get(k),
      append: (...nodes) => children.push(...nodes),
      addEventListener: (type, fn) => {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      },
      dispatch: (type, event = {}) => {
        (listeners.get(type) || []).forEach(fn => fn(event));
      }
    };
    elements.push(node);
    return node;
  };

  const doc = {
    createElement: createMockNode,
    createElementNS: (_ns, tagName) => createMockNode(tagName)
  };

  const container = createMockNode('div');
  const graph = {
    nodes: [
      { id: '沈砚', label: '沈砚', type: 'protagonist', role: '巡夜人' },
      { id: '苏红药', label: '苏红药', type: 'character', role: '药师', events: ['【第 1 幕】赠与金创药'] }
    ],
    edges: [
      { source: '沈砚', target: '苏红药', label: '施恩' }
    ]
  };

  const root = renderImmersiveRelationshipGraph(container, graph, { documentObject: doc });
  assert.ok(root);
  assert.equal(container.children.length, 1);
});
