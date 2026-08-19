import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyNarrativeForwardRepair,
  filterNarrativeContextMessages,
  renderNarrativeHardFactsPrompt,
  renderNarrativeRepairPrompt,
  validateNarrativeHardFacts
} from '../server/memory/narrativeRepair.js';

test('forward narrative repair preserves messages while excluding the invalid turn from context and episodic recall', () => {
  const session = {
    id: 'repair-test',
    messages: [
      { id: 'u1', role: 'user', content: '我在门口等车。' },
      { id: 'a1', role: 'assistant', content: '不存在的人物突然出现在办公室。' },
      { id: 'u2', role: 'user', content: '我回头看向周媛。' }
    ],
    memory: {
      worldState: { protagonist: { name: '旧名' }, location: { name: '旧地点' } },
      episodicMemory: {
        episodes: [{ id: 'episode:a1', sourceMessageIds: ['u1', 'a1'], status: 'confirmed' }]
      }
    }
  };

  const repaired = applyNarrativeForwardRepair(session, {
    reason: 'source-backed-correction',
    excludeMessageIds: ['a1'],
    canonicalFacts: {
      protagonistName: '刘一',
      protagonistRole: '性指导员',
      time: '2025年11月29日凌晨04:17',
      location: 'S市某老旧小区门口',
      presentCharacters: ['刘一', '周媛']
    },
    canonicalSummary: '刘一正在S市某老旧小区门口等候网约车。',
    prohibitedPhrases: ['不存在的人物', '检察员'],
    worldState: { protagonist: { name: '刘一' }, location: { name: 'S市某老旧小区门口' } },
    resetDerivedMemory: true,
    now: () => new Date('2026-08-06T13:00:00.000Z')
  });

  assert.equal(repaired.messages.length, 3);
  assert.equal(repaired.messages[1].content, '不存在的人物突然出现在办公室。');
  assert.equal(repaired.messages[1].contextExcluded, true);
  assert.deepEqual(filterNarrativeContextMessages(repaired.messages, repaired.memory).map((message) => message.id), ['u1', 'u2']);
  assert.equal(repaired.memory.episodicMemory.episodes[0].status, 'superseded');
  assert.deepEqual(repaired.memory.memoryCards, []);
  assert.deepEqual(repaired.memory.knowledgeGraph.nodes, []);
  assert.equal(repaired.memory.worldState.protagonist.name, '刘一');
  assert.equal(repaired.memory.worldState.location.name, 'S市某老旧小区门口');
  assert.match(renderNarrativeRepairPrompt(repaired.memory), /检察员/);
});

test('repair keeps identity and exclusions but retires stale scene coordinates after later turns', () => {
  const memory = {
    narrativeRepair: {
      spec: 'nre.narrative-repair/v1',
      revision: 1,
      appliedAt: '2026-08-06T13:00:00.000Z',
      canonicalFacts: {
        protagonistName: '刘一',
        time: '2025年11月29日凌晨',
        location: '旧小区门口',
        presentCharacters: ['刘一', '周媛']
      },
      prohibitedPhrases: ['错误人物']
    },
    worldState: {
      flags: { time: '2025年11月30日清晨' },
      location: { name: '大学城' }
    },
    characterRegistry: { currentAct: { updatedAt: '2026-08-07T09:00:00.000Z' } }
  };

  const prompt = renderNarrativeRepairPrompt(memory);
  assert.match(prompt, /剧情已经继续推进/);
  assert.doesNotMatch(prompt, /当前地点：旧小区门口/);
  assert.match(prompt, /主角规范名称：刘一/);
  assert.match(prompt, /错误人物/);
});

test('hard facts are rendered at the prompt tail and reject literal contradictions while active', () => {
  const repaired = applyNarrativeForwardRepair({ messages: [], memory: {} }, {
    hardFacts: [{
      id: 'diling-knows-entry',
      fact: '地伶亲自允许刘一进入，并留在门外等待。',
      contradictions: ['我不记得让你进入', '陌生巡夜者'],
      when: { path: 'worldState.flags.dilingAllowedEntry', equals: true }
    }],
    worldState: { flags: { dilingAllowedEntry: true } }
  });

  assert.match(renderNarrativeHardFactsPrompt(repaired.memory), /地伶亲自允许刘一进入/);
  assert.equal(validateNarrativeHardFacts('地伶说：“我不记得让你进入。”', repaired.memory).valid, false);
  repaired.memory.worldState.flags.dilingAllowedEntry = false;
  assert.equal(validateNarrativeHardFacts('地伶说：“我不记得让你进入。”', repaired.memory).valid, true);
});

test('historical repair clock anchors expire after deterministic world simulation advances', () => {
  const repaired = applyNarrativeForwardRepair({ messages: [], memory: {} }, {
    hardFacts: [
      {
        id: 'repair-resume-clock',
        fact: '纠偏续接点：第1日 12:00，青铜门外的巡查者正在等待回应。',
        contradictions: ['第2日 01:00']
      },
      {
        id: 'diling-identity',
        fact: '当前幕中的地伶必须使用世界书角色档案，不得替换为匿名巡查者。',
        contradictions: ['陌生巡查者']
      }
    ]
  });

  assert.match(renderNarrativeHardFactsPrompt(repaired.memory), /第1日 12:00/);
  assert.match(renderNarrativeHardFactsPrompt(repaired.memory), /地伶必须使用世界书角色档案/);
  repaired.memory.simulation = { revision: 1 };
  assert.doesNotMatch(renderNarrativeHardFactsPrompt(repaired.memory), /第1日 12:00/);
  assert.match(renderNarrativeHardFactsPrompt(repaired.memory), /地伶必须使用世界书角色档案/);
});
