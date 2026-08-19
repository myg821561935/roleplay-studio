import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyFactExtractionResult,
  buildFactExtractionPrompt,
  normalizeDynamicWorldBookEntries,
  parseFactExtractionResult
} from '../server/agent/factExtractor.js';

test('buildFactExtractionPrompt tells the model to emit dynamic world book entries', () => {
  const prompt = buildFactExtractionPrompt({
    worldState: { protagonist: { name: '沈观澜' } },
    messages: [{ role: 'user', content: '我拔出雪照。' }]
  });
  const systemPrompt = prompt[0].content;

  assert.match(systemPrompt, /worldBook/);
  assert.match(systemPrompt, /keywords/);
  assert.match(systemPrompt, /depth/);
  assert.match(systemPrompt, /动态世界书/);
  assert.match(systemPrompt, /角色卡与已启用世界书/);
  assert.match(systemPrompt, /characters/);
});

test('fact extraction receives canonical role card and world-book context', () => {
  const prompt = buildFactExtractionPrompt({
    worldState: {},
    messages: [{ role: 'assistant', content: '模型候选版本' }],
    canonicalContext: '【角色卡】江小鲤\n【世界书】凌霄山庄'
  });

  assert.match(prompt[1].content, /角色卡与世界书事实源/);
  assert.match(prompt[1].content, /江小鲤/);
  assert.match(prompt[1].content, /先用事实源消解冲突/);
});

test('buildFactExtractionPrompt includes route and institutional ledgers', () => {
  const prompt = buildFactExtractionPrompt({
    worldState: { flags: { genre: 'xianxia' } },
    messages: [{ role: 'user', content: '我借用族中灵田修行三月。' }],
    narrativeContext: {
      mode: 'stable',
      genre: 'xianxia',
      label: '太虚仙侠',
      activeArc: '清虚宗旧案',
      pillars: ['修行道途', '代际传承'],
      supporting: ['秘境探索']
    }
  });
  const systemPrompt = prompt[0].content;

  assert.match(systemPrompt, /叙事路线门禁/);
  assert.match(systemPrompt, /清虚宗旧案/);
  assert.match(systemPrompt, /resourceLedger/);
  assert.match(systemPrompt, /institutionLedger/);
});

test('parseFactExtractionResult returns empty object for non-JSON content', () => {
  const result = parseFactExtractionResult('抱歉，我无法提取事实。');
  assert.deepEqual(result, {});
});

test('parseFactExtractionResult extracts first JSON object from mixed text', () => {
  const result = parseFactExtractionResult('好的，这是结果：\n{"worldState":{"protagonist":{"name":"沈观澜"}}}\n以上是事实。');
  assert.equal(result.worldState.protagonist.name, '沈观澜');
});

test('parseFactExtractionResult handles fenced JSON with surrounding prose', () => {
  const result = parseFactExtractionResult('```json\n{"memoryCards":[]}\n```\n解释文字。');
  assert.deepEqual(result.memoryCards, []);
});

test('applyFactExtractionResult tolerates non-JSON model output without throwing', () => {
  const memory = {
    rollingSummary: '',
    unsummarizedTurnCount: 1,
    worldState: { protagonist: { name: '原主角' } },
    memoryCards: [],
    eventLedger: []
  };
  const next = applyFactExtractionResult(memory, '我无法理解，请重新提问。');
  assert.equal(next.worldState.protagonist.name, '原主角');
  assert.equal(next.lastFactExtractionError, '');
});

test('normalizeDynamicWorldBookEntries returns empty array for non-JSON content', () => {
  const entries = normalizeDynamicWorldBookEntries('这不是 JSON。');
  assert.deepEqual(entries, []);
});

test('stable route keeps unconfirmed extracted facts disabled for creator review', () => {
  const memory = {
    worldState: { flags: { genre: 'xianxia' } },
    memoryCards: []
  };
  const content = JSON.stringify({
    memoryCards: [{
      title: '荒野藏宝图',
      content: '模型临时提出了一张藏宝图。',
      extensions: {
        stability: 'candidate',
        genre: 'xianxia',
        narrativeRole: 'supporting',
        returnsToPillar: '回流宗门资源争议'
      }
    }]
  });
  const next = applyFactExtractionResult(memory, content, {
    narrativeContext: { mode: 'stable', genre: 'xianxia' }
  });

  assert.equal(next.memoryCards[0].enabled, false);
  assert.equal(next.memoryCards[0].extensions.reviewStatus, 'candidate');
});

test('stable route admits confirmed supporting facts only when they return to a pillar', () => {
  const content = JSON.stringify({
    memoryCards: [{
      title: '秘境名额质押',
      content: '用户确认用落雷秘境名额换取旧卷宗。',
      extensions: {
        stability: 'confirmed',
        genre: 'xianxia',
        narrativeRole: 'supporting',
        returnsToPillar: '推进清虚宗旧案与资源权属'
      }
    }]
  });
  const next = applyFactExtractionResult({ worldState: {}, memoryCards: [] }, content, {
    narrativeContext: { mode: 'stable', genre: 'xianxia' }
  });

  assert.equal(next.memoryCards[0].enabled, true);
  assert.equal(next.memoryCards[0].extensions.reviewStatus, 'admitted');
});

test('stable route rejects drift world-book entries and preserves the locked genre', () => {
  const context = { mode: 'stable', genre: 'xianxia' };
  const content = JSON.stringify({
    worldState: { flags: { genre: 'wilderness-survival', weather: '暴雨' } },
    worldBook: [
      {
        title: '纯荒野求生规则',
        content: '从此只计算饥饿和庇护所。',
        extensions: { stability: 'confirmed', genre: 'xianxia', narrativeRole: 'drift' }
      },
      {
        title: '落雷秘境所得归属',
        content: '秘境所得要按宗门贡献契约分配。',
        extensions: { stability: 'confirmed', genre: 'xianxia', narrativeRole: 'core' }
      }
    ]
  });
  const next = applyFactExtractionResult({
    worldState: { flags: { genre: 'xianxia' } },
    memoryCards: []
  }, content, { narrativeContext: context });
  const entries = normalizeDynamicWorldBookEntries(content, { narrativeContext: context });

  assert.equal(next.worldState.flags.genre, 'xianxia');
  assert.equal(next.worldState.flags.weather, '暴雨');
  assert.deepEqual(entries.map((entry) => entry.title), ['落雷秘境所得归属']);
});

test('fact extraction updates stable world-state entities instead of appending revisions', () => {
  const memory = {
    worldState: {
      relationships: [{ name: '沈观澜', trust: 2, note: '仍在试探' }],
      quests: [{ id: 'old-case', title: '镇武司旧案', status: 'active', clue: '残页' }],
      resourceLedger: [{ id: 'snow-blade', item: '雪照刀', owner: '沈观澜', restriction: '不可离身' }],
      obligations: [{ id: 'tea-debt', type: '人情', debtor: '沈观澜', creditor: '掌柜', status: 'open' }]
    },
    memoryCards: []
  };
  const next = applyFactExtractionResult(memory, JSON.stringify({
    worldState: {
      relationships: [{ name: '沈观澜', trust: 4 }],
      quests: [{ id: 'old-case', status: 'resolved' }],
      resourceLedger: [{ id: 'snow-blade', owner: '林青阳' }],
      obligations: [{ id: 'tea-debt', status: 'paid' }]
    }
  }));

  assert.deepEqual(next.worldState.relationships, [{ name: '沈观澜', trust: 4, note: '仍在试探' }]);
  assert.deepEqual(next.worldState.quests, [{ id: 'old-case', title: '镇武司旧案', status: 'resolved', clue: '残页' }]);
  assert.deepEqual(next.worldState.resourceLedger, [{ id: 'snow-blade', item: '雪照刀', owner: '林青阳', restriction: '不可离身' }]);
  assert.deepEqual(next.worldState.obligations, [{ id: 'tea-debt', type: '人情', debtor: '沈观澜', creditor: '掌柜', status: 'paid' }]);
});

test('fact extraction merges named quests and encountered characters by canonical name', () => {
  const next = applyFactExtractionResult({
    worldState: {
      characters: [{ name: '江小鲤', encountered: true, role: '庄主之女' }],
      quests: [{ name: '西门调查', status: 'active', clue: '旧脚印' }]
    },
    memoryCards: []
  }, JSON.stringify({
    worldState: {
      characters: [{ name: '江小鲤', status: '留在住处' }],
      quests: [{ name: '西门调查', status: 'resolved' }]
    }
  }));

  assert.deepEqual(next.worldState.characters, [{
    name: '江小鲤',
    encountered: true,
    role: '庄主之女',
    status: '留在住处'
  }]);
  assert.deepEqual(next.worldState.quests, [{ name: '西门调查', status: 'resolved', clue: '旧脚印' }]);
});

test('fact extraction compacts repeated from-to relationship revisions into the current relation', () => {
  const next = applyFactExtractionResult({
    worldState: {
      relationships: [
        { from: '刘一', to: '周媛', type: '性指导员-被指导者', details: '早期状态' },
        { from: '刘一', to: '周媛', type: '性指导员-被指导者', details: '上一轮状态' }
      ]
    },
    memoryCards: []
  }, JSON.stringify({
    worldState: {
      relationships: [{
        from: '刘一',
        to: '周媛',
        type: '性指导员-被指导者',
        details: '当前已确认状态',
        encountered: true
      }]
    }
  }));

  assert.deepEqual(next.worldState.relationships, [{
    from: '刘一',
    to: '周媛',
    type: '性指导员-被指导者',
    details: '当前已确认状态',
    encountered: true
  }]);
});
