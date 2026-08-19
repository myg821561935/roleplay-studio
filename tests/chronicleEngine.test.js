import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTurnChroniclePlan, inferTurnDuration } from '../server/simulation/chronicleEngine.js';
import { ensureSimulationMemory, renderSimulationPrompt } from '../server/simulation/npcSimulation.js';
import { adjudicateActionEnvelope, replayActionHistory } from '../server/simulation/worldStateArbiter.js';
import { WorldSimulationService } from '../server/services/worldSimulationService.js';
import { ACTION_PROTOCOL_SPEC } from '../server/simulation/actionProtocol.js';

test('chronicle classifies user actions into bounded, explainable time costs', () => {
  assert.deepEqual(inferTurnDuration({ content: '我沿着血迹调查整栋楼。' }), {
    minutes: 30,
    reason: '调查或探索'
  });
  assert.deepEqual(inferTurnDuration({ content: '我等半小时再去敲门。' }), {
    minutes: 30,
    reason: '用户明确耗时'
  });
  assert.deepEqual(inferTurnDuration({ content: '我和唐月交谈。' }), {
    minutes: 10,
    reason: '当面互动'
  });
});

test('chronicle advances clock, executes NPC schedules and marks due timeline events before narration', () => {
  const memory = ensureSimulationMemory({
    worldState: {
      timeline: [{ id: 'deadline', title: '封楼前的最后通话', dueDay: 1, dueAt: '08:30', status: 'active' }]
    },
    simulation: {
      clock: { day: 1, minuteOfDay: 480 },
      actors: [{
        id: 'tangyue',
        name: '唐月',
        location: '警戒线',
        schedule: [{ at: '08:30', location: '刑警队', activity: '整理证物', visibility: 'public' }]
      }]
    }
  });

  const plan = buildTurnChroniclePlan({
    memory,
    userMessage: { id: 'user-chronicle', content: '我调查楼道里的血迹。' }
  });
  assert.match(plan.metadata.start, /^第1日 08:00 · 周一 · 工作日 · 清晨$/);
  assert.match(plan.metadata.end, /^第1日 08:30 · 周一 · 工作日 · 清晨$/);
  assert.deepEqual(plan.metadata.triggeredEvents, ['封楼前的最后通话']);

  const adjudicated = adjudicateActionEnvelope({ memory, envelope: plan.envelope });
  assert.equal(adjudicated.memory.simulation.clock.label, '第1日 08:30');
  assert.equal(adjudicated.memory.simulation.actors[0].location, '刑警队');
  assert.equal(adjudicated.memory.worldState.timeline[0].status, 'triggered');
  assert.ok(adjudicated.result.effects.some((effect) => effect.type === 'schedule.trigger'));
});

test('worldbook-declared characters, factions, and promises become bounded background dynamics', () => {
  const memory = ensureSimulationMemory({
    worldState: {
      obligations: [{ id: 'promise-1', title: '三日内交还药方', from: '林晚', to: '主角', status: 'open' }]
    }
  }, {
    worldBook: [{
      id: 'linwan-file',
      type: 'character',
      title: '人物档案：林晚',
      content: '身份：药师\n地点：城南药庐\n目标：查清药材失窃\n每天清晨会在药庐整理药材。'
    }],
    worldSystems: {
      factions: { entities: [{ id: 'medicine-guild', title: '药行公会' }] }
    }
  });

  const actor = memory.simulation.actors.find((item) => item.name === '林晚');
  assert.equal(actor.metadata.source, 'worldbook');
  assert.equal(actor.location, '城南药庐');
  assert.equal(actor.schedule[0].at, '07:00');
  assert.deepEqual(memory.worldState.worldDynamics.factions, [{
    id: 'medicine-guild', name: '药行公会', status: 'background-active'
  }]);
  assert.equal(memory.worldState.worldDynamics.promises[0].title, '三日内交还药方');
  const prompt = renderSimulationPrompt(memory);
  assert.match(prompt, /# 世界动态时钟/);
  assert.match(prompt, /林晚/);
  assert.match(prompt, /药行公会均在独立演化/);
  assert.match(prompt, /已解决或已明确答复的承诺不得被重复追问/);
});

test('a new worldbook character joins an established simulation roster without replacing existing actors', () => {
  const memory = ensureSimulationMemory({
    simulation: {
      revision: 3,
      actors: [{ id: 'protagonist', name: '沈砚', role: '主角' }],
      settings: { rosterInitialized: true }
    }
  }, {
    worldBook: [{
      id: 'linwan-file',
      type: 'npc',
      title: 'NPC：林晚',
      content: '身份：药师\n每天清晨会在药庐整理药材。'
    }]
  });

  assert.deepEqual(memory.simulation.actors.map((actor) => actor.name), ['沈砚', '林晚']);
  assert.equal(memory.simulation.actors[1].metadata.source, 'worldbook');
});

test('worldbook roster keeps declared characters and removes imported system-section impostors', () => {
  const memory = ensureSimulationMemory({
    simulation: {
      revision: 3,
      actors: [
        { id: 'protagonist', name: '刘一', role: '主角' },
        { id: 'worldbook-old-variable', name: '变量列表', metadata: { source: 'worldbook' } },
        { id: 'worldbook-old-update', name: '[mvu_update]变量更新规则', metadata: { source: 'worldbook' } }
      ],
      settings: { rosterInitialized: true }
    }
  }, {
    worldBook: [
      { id: 'diling', type: 'character', title: '地伶_基础信息', content: '身份：绝世仙宗真传弟子' },
      { id: 'variables', type: 'character', title: '变量列表', content: '角色名：变量列表' },
      { id: 'worldview', type: 'character', title: '世界观', content: '角色名：世界观' },
      { id: 'overview', type: 'npc', title: '角色速览', content: '角色名：角色速览' },
      { id: 'update', type: 'character', title: '[mvu_update]变量更新规则', content: '角色名：[mvu_update]变量更新规则' }
    ]
  });

  assert.deepEqual(memory.simulation.actors.map((actor) => actor.name), ['刘一', '地伶']);
  assert.equal(memory.simulation.actors[1].metadata.source, 'worldbook');
});

test('decision projection applies the current turn without mutating committed session memory', () => {
  const service = new WorldSimulationService({ sessionService: {} });
  const session = {
    config: { characterCard: null, groupMembers: [], characterPresets: [], worldBook: [] },
    memory: ensureSimulationMemory({ simulation: { clock: { day: 1, minuteOfDay: 480 }, revision: 0 } })
  };
  const projected = service.projectDecisionMemory({
    session,
    assistantMessage: { id: 'assistant-preview', role: 'assistant', content: '石阶尽头的门缓缓开启。' },
    actionEnvelope: {
      spec: ACTION_PROTOCOL_SPEC,
      baseRevision: 0,
      actorId: 'narrator',
      actions: [{ type: 'clock.advance', minutes: 10, reason: '本轮探索', visibility: 'public' }]
    }
  });

  assert.equal(projected.simulation.clock.label, '第1日 08:10');
  assert.equal(session.memory.simulation.clock.label, '第1日 08:00');
  assert.equal(session.memory.simulation.revision, 0);
});

test('service persists the pre-narration chronicle as one replayable turn envelope', () => {
  const service = new WorldSimulationService({ sessionService: {} });
  const session = {
    id: 'chronicle-session',
    settings: { cardRuntimeEnabled: true },
    config: {
      characterCard: { name: '陈默', scenario: '永安筒子楼的门锁刚刚响过。' },
      groupMembers: [{
        id: 'tangyue',
        name: '唐月',
        role: '刑警',
        extensions: { schedule: [{ at: '08:30', location: '刑警队', activity: '整理证物', visibility: 'public' }] }
      }],
      characterPresets: [],
      worldBook: []
    },
    memory: {
      worldState: {
        protagonist: { inventory: [] },
        timeline: [{ id: 'deadline', title: '封楼前的最后通话', dueDay: 1, dueAt: '08:30', status: 'active' }]
      },
      simulation: { clock: { day: 1, minuteOfDay: 480 } }
    },
    messages: []
  };
  service.prepareSession(session, session.config);
  service.prepareInteraction({
    session,
    userMessage: { id: 'user-1', content: '我调查楼道里的血迹。' }
  });

  // The prompt sees this settled state; applyTurn commits the same actions only once.
  assert.equal(session.memory.simulation.clock.label, '第1日 08:30');
  const assistantMessage = { id: 'assistant-1', role: 'assistant', activeSwipeIndex: 0 };
  service.applyTurn({
    session,
    userMessage: { id: 'user-1', content: '我调查楼道里的血迹。' },
    assistantMessage,
    actionEnvelope: {
      spec: ACTION_PROTOCOL_SPEC,
      baseRevision: 1,
      actorId: 'narrator',
      actions: [{
        type: 'state.append',
        path: 'protagonist.inventory',
        value: '染血钥匙',
        reason: '调查后发现钥匙',
        visibility: 'public'
      }]
    }
  });

  assert.equal(session.memory.simulation.clock.label, '第1日 08:30');
  assert.equal(session.memory.simulation.revision, 1);
  assert.equal(session.memory.worldState.timeline[0].status, 'triggered');
  assert.deepEqual(session.memory.worldState.protagonist.inventory, ['染血钥匙']);
  assert.equal(assistantMessage.chronicle.minutes, 30);
  assert.equal(assistantMessage.actionEnvelope.actions.length, 3);

  const replayed = replayActionHistory({ memory: session.memory, messages: [assistantMessage] });
  assert.equal(replayed.memory.simulation.clock.label, '第1日 08:30');
  assert.equal(replayed.memory.simulation.revision, 1);
  assert.deepEqual(replayed.memory.worldState.protagonist.inventory, ['染血钥匙']);
});

test('service reconciles a stale simulation clock from the selected message history before a new turn', () => {
  const service = new WorldSimulationService({ sessionService: {} });
  const session = {
    id: 'chronicle-reconcile-session',
    settings: { cardRuntimeEnabled: true },
    config: {
      characterCard: { name: '陈默', scenario: '永安筒子楼的门锁刚刚响过。' },
      groupMembers: [],
      characterPresets: [],
      worldBook: []
    },
    memory: {
      worldState: { protagonist: { name: '陈默', inventory: [] }, timeline: [] },
      worldStateBaseline: { protagonist: { name: '陈默', inventory: [] }, timeline: [] },
      simulation: { clock: { day: 1, minuteOfDay: 480 }, revision: 0 },
      simulationBaseline: { clock: { day: 1, minuteOfDay: 480 }, revision: 0 }
    },
    messages: [
      {
        id: 'assistant-clock-1',
        role: 'assistant',
        actionEnvelope: {
          spec: ACTION_PROTOCOL_SPEC,
          baseRevision: 0,
          actions: [{ type: 'clock.advance', minutes: 10, reason: '第一段路程', visibility: 'public' }]
        }
      },
      {
        id: 'assistant-clock-2',
        role: 'assistant',
        actionEnvelope: {
          spec: ACTION_PROTOCOL_SPEC,
          baseRevision: 1,
          actions: [{ type: 'clock.advance', minutes: 10, reason: '第二段路程', visibility: 'public' }]
        }
      }
    ]
  };

  service.prepareSession(session, session.config);

  assert.equal(session.memory.simulation.clock.label, '第1日 08:20');
  assert.equal(session.memory.simulation.revision, 2);
});

test('chronicle can be explicitly disabled and never consumes a continuation turn', () => {
  const disabled = ensureSimulationMemory({
    simulation: { settings: { chronicleEnabled: false }, clock: { day: 1, minuteOfDay: 480 } }
  });
  assert.equal(buildTurnChroniclePlan({ memory: disabled, userMessage: { content: '我调查现场。' } }), null);

  const enabled = ensureSimulationMemory({ simulation: { clock: { day: 1, minuteOfDay: 480 } } });
  assert.equal(buildTurnChroniclePlan({
    memory: enabled,
    userMessage: { content: '继续推进。' },
    generationType: 'continue'
  }), null);
  assert.equal(buildTurnChroniclePlan({
    memory: enabled,
    userMessage: { kind: 'continuation', content: '继续' }
  }), null);
});
