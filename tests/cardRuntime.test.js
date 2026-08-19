import test from 'node:test';
import assert from 'node:assert/strict';

import {
  beginCardRuntimeInteraction,
  buildCardRuntimeBlueprint,
  ensureCardRuntimeMemory,
  getCardRuntimeInteractionOptions,
  recordCardRuntimeFeedback,
  renderCardRuntimePrompt
} from '../server/agent/cardRuntime.js';
import { WorldSimulationService } from '../server/services/worldSimulationService.js';
import { ACTION_PROTOCOL_SPEC } from '../server/simulation/actionProtocol.js';

test('card runtime derives a bounded read-only blueprint without mutating imported resources', () => {
  const seeds = {
    characterCard: {
      name: '沈雁回',
      role: '巡夜人',
      description: '失踪案的唯一幸存者。',
      personality: '谨慎，不轻信陌生人。',
      scenario: '雨夜的客栈传来第三次敲门声。'
    },
    groupMembers: [{ name: '柳七', role: '客栈掌柜', relationship: '暂时合作' }],
    worldBook: [{ id: 'case', title: '失踪案线索', keywords: ['秘密', '调查'], category: '任务', content: '原文保持本地只读。' }],
    worldSystems: {
      source: { mappedCount: 2 },
      topology: { nodes: [{ id: 'inn', title: '客栈' }] },
      population: { profiles: [] },
      factions: { entities: [{ id: 'guard', title: '巡夜司' }] },
      cultivation: { rules: [] },
      economy: { rules: [] }
    }
  };
  const original = structuredClone(seeds);

  const blueprint = buildCardRuntimeBlueprint(seeds);

  assert.deepEqual(seeds, original);
  assert.equal(blueprint.enabled, true);
  assert.deepEqual(blueprint.actors.map((actor) => actor.name), ['沈雁回', '柳七']);
  assert.deepEqual(blueprint.openThreads.map((thread) => thread.title), ['失踪案线索', '已声明势力动向（1）']);
  assert.match(renderCardRuntimePrompt({ cardRuntime: blueprint }), /角色卡运行化层/);
  assert.match(renderCardRuntimePrompt({ cardRuntime: blueprint }), /沈雁回/);
});

test('card runtime only surfaces adjudicated public feedback and keeps director effects out', () => {
  const blueprint = buildCardRuntimeBlueprint({ characterCard: { name: '阿照', scenario: '旧城起雾。' } });
  const result = recordCardRuntimeFeedback({ cardRuntime: blueprint }, {
    userMessage: { content: '我检查门锁。' },
    assistantMessage: { id: 'assistant-1' },
    adjudication: {
      accepted: [{ id: 'public-effect' }, { id: 'director-effect' }],
      effects: [
        { type: 'state.append', path: 'protagonist.inventory', reason: '获得旧钥匙', visibility: 'public' },
        { type: 'actor.agenda', path: 'simulation.actors.keeper', reason: '掌柜暗中通风报信', visibility: 'director' }
      ]
    }
  });

  assert.equal(result.feedback.status, 'committed');
  assert.deepEqual(result.feedback.effects, [{ type: 'state.append', summary: '获得旧钥匙' }]);
  assert.doesNotMatch(JSON.stringify(result.feedback), /通风报信/);
  assert.equal(result.memory.cardRuntime.feedback.length, 1);
});

test('card runtime keeps the player intent separate from safe next-interaction options', () => {
  const blueprint = buildCardRuntimeBlueprint({
    characterCard: { name: '宁川', role: '行脚医师', scenario: '山道塌方，药箱失踪。' },
    groupMembers: [{ name: '石青', role: '驿站向导' }],
    worldBook: [{ id: 'trail', title: '山道失踪案', keywords: ['线索'], category: '任务' }]
  });
  const prepared = beginCardRuntimeInteraction({ cardRuntime: blueprint }, {
    userMessage: { id: 'user-intent', content: '我请石青沿着血迹追查山道失踪案中的药箱。' }
  });

  assert.equal(prepared.interaction.latestIntent.kind, 'observe');
  assert.equal(prepared.interaction.latestIntent.text, '我请石青沿着血迹追查山道失踪案中的药箱。');
  assert.ok(prepared.interaction.options.length >= 2);
  assert.match(renderCardRuntimePrompt(prepared.memory), /本轮玩家意图/);
  assert.deepEqual(
    getCardRuntimeInteractionOptions(prepared.memory),
    prepared.interaction.options
  );

  const completed = recordCardRuntimeFeedback(prepared.memory, {
    userMessage: { id: 'user-intent', content: '我请石青沿着血迹追查山道失踪案中的药箱。' },
    assistantMessage: { id: 'assistant-intent' },
    adjudication: { accepted: [], effects: [] }
  });
  assert.equal(completed.memory.cardRuntime.interaction.latestOutcome.status, 'observed');
  assert.equal(completed.memory.cardRuntime.interaction.latestIntent.text, '我请石青沿着血迹追查山道失踪案中的药箱。');
});

test('card runtime never derives choices from a generic opening or broad capability list', () => {
  const blueprint = buildCardRuntimeBlueprint({
    characterCard: { name: '世界背景', scenario: '雨夜的城门忽然关闭。' },
    worldBook: [{ id: 'trade', title: '商会制度', keywords: ['交易'], category: '经济' }]
  });

  assert.deepEqual(blueprint.openThreads, []);
  assert.deepEqual(getCardRuntimeInteractionOptions({ cardRuntime: blueprint }), []);
  assert.doesNotMatch(renderCardRuntimePrompt({ cardRuntime: blueprint }), /开局情境|可回应方向/);
});

test('world simulation seeds the runtime layer and records its turn feedback with the assistant swipe metadata', () => {
  const service = new WorldSimulationService({ sessionService: {} });
  const session = {
    id: 'runtime-session',
    settings: { cardRuntimeEnabled: true },
    config: {
      characterCard: { name: '宁川', role: '行脚医师', scenario: '山道塌方，药箱失踪。' },
      groupMembers: [],
      characterPresets: [],
      worldBook: [{ id: 'trail', title: '山道失踪案', keywords: ['线索'] }]
    },
    memory: { worldState: { protagonist: { inventory: [] } } },
    messages: []
  };
  service.prepareSession(session, session.config);
  const interaction = service.prepareInteraction({
    session,
    userMessage: { id: 'user-2', content: '我沿着血迹追查。' }
  });
  const assistantMessage = { id: 'assistant-2', activeSwipeIndex: 0 };

  service.applyTurn({
    session,
    userMessage: { id: 'user-2', content: '我沿着血迹追查。' },
    assistantMessage,
    actionEnvelope: {
      spec: ACTION_PROTOCOL_SPEC,
      baseRevision: 0,
      actorId: 'narrator',
      actions: [{
        type: 'state.append',
        path: 'protagonist.inventory',
        value: '带血的布条',
        reason: '沿血迹发现物证',
        visibility: 'public'
      }]
    }
  });

  assert.equal(session.memory.cardRuntime.enabled, true);
  assert.equal(interaction.latestIntent.kind, 'observe');
  assert.equal(assistantMessage.runtimeFeedback.status, 'committed');
  assert.ok(assistantMessage.runtimeFeedback.effects.some((effect) => /沿血迹/.test(effect.summary)));
  assert.deepEqual(assistantMessage.swipeMetadata[0].runtimeFeedback, assistantMessage.runtimeFeedback);
});

test('runtime layer can be disabled for a session without changing its source blueprint', () => {
  const seeds = { characterCard: { name: '顾寒', scenario: '雪夜赶路。' } };
  const initial = ensureCardRuntimeMemory({}, seeds);
  const disabled = ensureCardRuntimeMemory(initial, seeds, { enabled: false });

  assert.equal(initial.cardRuntime.enabled, true);
  assert.equal(disabled.cardRuntime.enabled, false);
  assert.equal(disabled.cardRuntime.source.fingerprint, initial.cardRuntime.source.fingerprint);

  const reenabled = ensureCardRuntimeMemory(disabled, seeds, { enabled: true });
  assert.equal(reenabled.cardRuntime.enabled, true);
  assert.equal(reenabled.cardRuntime.source.fingerprint, initial.cardRuntime.source.fingerprint);
});
