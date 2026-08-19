import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSceneAffordanceSnapshot,
  renderSceneAffordancePrompt
} from '../server/agent/sceneAffordancePlanner.js';
import { planRecommendedActions } from '../server/agent/decisionPlanner.js';

const THREAT_MEMORY = {
  worldState: {
    protagonist: {
      name: '陆沉',
      abilities: ['狂暴元气', '破戒刀法'],
      inventory: ['百炼精钢刀']
    },
    location: {
      current: '破败古庙大殿',
      exits: ['古庙后方的雨夜密林'],
      interactables: ['正在坠落的横梁', '倾倒的供桌']
    },
    resourceLedger: [{
      resource: '蜕凡境中期',
      owner: '陆沉',
      restriction: '元气已接近失控边缘'
    }],
    obligations: [{
      obligation: '护住同行者',
      from: '陆沉',
      to: '同伴',
      status: '进行中',
      detail: '不能把同行者独自留在坍塌的大殿内'
    }]
  },
  simulation: { clock: { label: '雨夜·子时' } },
  characterRegistry: {
    currentAct: { members: [{ name: '陆沉', state: 'on-stage' }, { name: '同行者', state: 'on-stage' }] }
  }
};

test('scene affordance snapshot only exposes source-backed actors, routes, objects and abilities', () => {
  const snapshot = buildSceneAffordanceSnapshot({
    memory: THREAT_MEMORY,
    assistantContent: '大殿即将坍塌，横梁朝两人头顶砸来。'
  });

  assert.equal(snapshot.spec, 'lra.scene-affordance/v2');
  assert.equal(snapshot.location, '破败古庙大殿');
  assert.deepEqual(snapshot.routes.map((entry) => entry.label), ['古庙后方的雨夜密林']);
  assert.match(snapshot.capabilities.map((entry) => entry.label).join('\n'), /狂暴元气|破戒刀法|蜕凡境中期/);
  assert.match(snapshot.items.map((entry) => entry.label).join('\n'), /百炼精钢刀/);
  assert.match(snapshot.constraints.map((entry) => entry.label).join('\n'), /同行者/);
  assert.match(renderSceneAffordancePrompt(snapshot), /不得补造技能、装备、出口/);
});

test('decision planner turns a source-backed threat into three distinct executable strategies', () => {
  const result = planRecommendedActions({
    memory: THREAT_MEMORY,
    assistantContent: '大殿即将坍塌，两名高手的杀招同时逼近，横梁朝两人头顶砸来。'
  });

  assert.equal(result.decision.kind, 'immediate-threat');
  assert.equal(result.actions.length, 3);
  assert.match(result.actions[0], /雨夜密林/);
  assert.match(result.actions[1], /狂暴元气|破戒刀法|百炼精钢刀|蜕凡境中期/);
  assert.match(result.actions[2], /横梁|供桌/);
  assert.equal(new Set(result.actionOptions.map((option) => option.intent)).size, 3);
  assert.ok(result.actionOptions.every((option) => option.worldValid));
  assert.ok(result.actionOptions.every((option) => option.guaranteedOutcome === false));
  assert.ok(result.actionOptions.every((option) => option.groundingSources.length > 0));
  assert.equal(result.actions.some((action) => /自定义|必然成功|突破成功/u.test(action)), false);
});

test('decision planner does not invent an ability or item when the structured state has none', () => {
  const result = planRecommendedActions({
    memory: {
      worldState: {
        protagonist: { name: '旅人' },
        location: { current: '失火的仓库', exits: ['北门'] }
      }
    },
    assistantContent: '火势沿木架逼近，下一瞬就会封死过道。'
  });

  assert.equal(result.actions.length, 3);
  assert.equal(result.actions.some((action) => /法术|轻功|长剑|护盾|百炼精钢刀/u.test(action)), false);
  assert.match(result.actions.join('\n'), /北门|护住要害|拉开距离/);
});

test('accepted turn frame projects the new location and routes ahead of stale memory', () => {
  const snapshot = buildSceneAffordanceSnapshot({
    memory: {
      worldState: {
        protagonist: { name: '刘一' },
        location: {
          current: '青铜门内侧石缝旁',
          routes: ['门外地伶'],
          interactables: ['旧石缝']
        }
      }
    },
    assistantContent: [
      '石门向下沉去，露出一条幽暗隧道。',
      '刘一站在第七级台阶上，脚下的沉璧阶分出明暗两路。',
      '石壁刻字写着：“踏亮处，入旧墟；踏暗处，历残魂。”'
    ].join('\n'),
    turnFrame: {
      validation: { status: 'accepted' },
      scene: { location: '第七级台阶上', presentActors: [] },
      affordances: { routes: ['踏亮处', '踏暗处', '幽暗隧道'], interactables: ['沉璧阶'], threats: [] }
    }
  });

  assert.match(snapshot.location, /第七级台阶上/);
  assert.match(snapshot.routes.slice(0, 4).map((entry) => entry.label).join('\n'), /踏亮处|踏暗处|隧道|沉璧阶/);
  assert.equal(snapshot.routes[0].source, 'turnFrame.affordances.routes');
});

test('unstructured prose cannot displace an already confirmed scene location', () => {
  const snapshot = buildSceneAffordanceSnapshot({
    memory: { worldState: { location: { current: '青铜门后石室' } } },
    assistantContent: '她的目光仿佛站在月光下的剑锋旁，声音落入阴影深处。'
  });
  assert.equal(snapshot.location, '青铜门后石室');
  assert.equal(snapshot.routes.some((entry) => /月光|声音|阴影/.test(entry.label)), false);
});
