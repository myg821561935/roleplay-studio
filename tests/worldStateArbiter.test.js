import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultMemory } from '../server/agent/memoryUpdater.js';
import { adjudicateActionEnvelope, replayActionHistory } from '../server/simulation/worldStateArbiter.js';
import { ensureSimulationMemory } from '../server/simulation/npcSimulation.js';

function seededMemory() {
  return ensureSimulationMemory(createDefaultMemory(), {
    characterCard: { id: 'shen', name: '沈砚', role: '巡检', privateKnowledge: ['密令来自内廷'] },
    groupMembers: [{ id: 'su', name: '苏棠', role: '账房' }]
  });
}

test('world-state arbiter applies allowlisted actions and records exact effects', () => {
  const memory = seededMemory();
  const { memory: next, result } = adjudicateActionEnvelope({
    memory,
    envelope: {
      baseRevision: 0,
      actorId: 'shen',
      summary: '取得账册并转移地点',
      actions: [
        { type: 'state.append', path: 'protagonist.inventory', value: '盐引账册', reason: '已经收好' },
        { type: 'actor.move', actorId: 'su', location: '西平码头', reason: '按约查账', visibility: 'private' }
      ]
    }
  });

  assert.equal(result.status, 'accepted');
  assert.equal(result.revisionAfter, 1);
  assert.deepEqual(next.worldState.protagonist.inventory, ['盐引账册']);
  assert.equal(next.simulation.actors.find((actor) => actor.id === 'su').location, '西平码头');
  assert.equal(result.effects.length, 2);
  assert.deepEqual(next.worldStateBaseline.protagonist.inventory, []);
});

test('world-state arbiter rejects stale revisions and failed conditions', () => {
  const memory = seededMemory();
  memory.worldState.flags.doorOpen = false;

  const stale = adjudicateActionEnvelope({
    memory,
    envelope: { baseRevision: 3, actions: [{ type: 'state.set', path: 'flags.alarm', value: true }] }
  });
  assert.equal(stale.result.code, 'ACTION_REVISION_CONFLICT');

  const conditional = adjudicateActionEnvelope({
    memory,
    envelope: {
      actions: [{
        type: 'state.set',
        path: 'flags.enteredVault',
        value: true,
        conditions: [{ path: 'flags.doorOpen', operator: 'eq', value: true }]
      }]
    }
  });
  assert.equal(conditional.result.status, 'rejected');
  assert.equal(conditional.result.rejected[0].code, 'ACTION_CONDITION_NOT_MET');
  assert.equal(conditional.memory.worldState.flags.enteredVault, undefined);
});

test('action history replays from baseline after a regenerated reply', () => {
  const initial = seededMemory();
  const first = adjudicateActionEnvelope({
    memory: initial,
    envelope: { actions: [{ type: 'state.append', path: 'protagonist.inventory', value: '旧钥匙' }] }
  });
  const messages = [
    { id: 'u1', role: 'user', content: '查看桌面' },
    {
      id: 'a1',
      role: 'assistant',
      content: '只发现一封信。',
      actionEnvelope: { actions: [{ type: 'state.append', path: 'protagonist.inventory', value: '密信' }] }
    }
  ];
  const replayed = replayActionHistory({ memory: first.memory, messages });
  assert.deepEqual(replayed.memory.worldState.protagonist.inventory, ['密信']);
  assert.equal(replayed.results.get('a1').status, 'accepted');
});

test('action history never replays an assistant result excluded by narrative repair', () => {
  const initial = seededMemory();
  const messages = [{
    id: 'a-invalid',
    role: 'assistant',
    contextExcluded: true,
    actionEnvelope: {
      actions: [{ type: 'state.append', path: 'protagonist.inventory', value: '幻觉钥匙' }]
    }
  }];

  const replayed = replayActionHistory({ memory: initial, messages });
  assert.deepEqual(replayed.memory.worldState.protagonist.inventory, []);
  assert.equal(replayed.results.has('a-invalid'), false);
});
