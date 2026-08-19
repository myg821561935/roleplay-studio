import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CHARACTER_REGISTRY_SPEC,
  normalizeCharacterRegistry,
  syncCharacterRegistry
} from '../server/agent/characterRegistry.js';

const FIXED_NOW = () => '2026-08-07T10:00:00.000Z';

test('character registry keeps source roles separate from observed session state', () => {
  const memory = syncCharacterRegistry({
    worldState: {
      protagonist: { name: '沈观澜', realm: '炼气' },
      characters: [{ name: '江小鲤', role: '庄主之女', encountered: true, status: '留守西院' }]
    }
  }, {
    characterCard: { id: 'hero-card', name: '沈观澜', role: '外门弟子', description: '正在追查旧案。' },
    groupMembers: [{ id: 'xiaoli', name: '江小鲤', role: '庄主之女', description: '山庄主人之女。' }],
    worldBook: [{ id: 'tangyue-profile', title: '唐月_人物档案', content: '刑警唐月的公开设定。' }],
    now: FIXED_NOW
  });

  assert.equal(memory.characterRegistry.spec, CHARACTER_REGISTRY_SPEC);
  assert.equal(memory.characterRegistry.records.length, 3);
  const protagonist = memory.characterRegistry.records.find((item) => item.kind === 'protagonist');
  const xiaoli = memory.characterRegistry.records.find((item) => item.name === '江小鲤');
  const tangyue = memory.characterRegistry.records.find((item) => item.name === '唐月');
  assert.equal(protagonist.source.kind, 'character-card');
  assert.equal(protagonist.session.encountered, true);
  assert.equal(xiaoli.source.kind, 'group-member');
  assert.equal(xiaoli.kind, 'source-npc');
  assert.equal(xiaoli.session.encountered, true);
  assert.equal(xiaoli.session.status, '留守西院');
  assert.equal(tangyue.source.kind, 'world-book');
  assert.equal(tangyue.session.encountered, false);
});

test('character registry turns structured status panels into a current act roster', () => {
  const memory = syncCharacterRegistry({
    worldState: { protagonist: { name: '陈默' } }
  }, {
    characterCard: { name: '陈默', role: '调查者' },
    groupMembers: [{ id: 'tangyue', name: '唐月', role: '刑警' }],
    assistantMessage: {
      id: 'assistant-12',
      speaker: '唐月',
      roleplayPanels: {
        sceneStatus: '第1日 08:30，筒子楼二层。',
        characterStatus: '『陈默·状态』身份：调查者\n『唐月·状态』身份：刑警；正在检查门锁。',
        nextCharacter: '『周警官·待登场』可能带来封楼记录。'
      }
    },
    turnId: 'assistant-12',
    now: FIXED_NOW
  });

  const act = memory.characterRegistry.currentAct;
  assert.equal(act.turnId, 'assistant-12');
  assert.equal(act.location, '');
  assert.deepEqual(act.members.map((item) => [item.name, item.state]), [
    ['陈默', 'on-stage'],
    ['唐月', 'on-stage']
  ]);
  assert.match(act.members.find((item) => item.name === '唐月').status, /正在检查门锁/);
  assert.deepEqual(act.next.map((item) => item.name), ['周警官']);
});

test('character registry recovers the current NPC from visible prose when a reply omits status panels', () => {
  const memory = syncCharacterRegistry({
    worldState: {
      protagonist: { name: '陈默' },
      characters: [
        { name: '唐月', role: '刑警', encountered: true, status: '正在检查门锁。' },
        { name: '老孙', role: '门卫', encountered: true, status: '留守一楼值班室。' }
      ]
    }
  }, {
    characterCard: { name: '陈默', role: '调查者' },
    assistantMessage: {
      id: 'assistant-13',
      content: '唐月按住门锁，示意陈默不要出声。',
      roleplayPanels: { runtimeNotice: '当前回复未提供状态栏。' }
    },
    turnId: 'assistant-13',
    now: FIXED_NOW
  });

  assert.deepEqual(memory.characterRegistry.currentAct.members.map((item) => item.name), ['陈默', '唐月']);
  assert.match(memory.characterRegistry.currentAct.members.find((item) => item.name === '唐月').status, /检查门锁/);
  assert.equal(memory.characterRegistry.currentAct.members.some((item) => item.name === '老孙'), false);
});

test('accepted turn frame admits only canonical named actors into the current act', () => {
  const memory = syncCharacterRegistry({
    worldState: {
      protagonist: { name: '刘一' },
      characters: [
        { name: '地伶', role: '真传弟子', encountered: true, status: '正在门外等待。' },
        { name: '管事婆婆', role: '管事', encountered: true, status: '本轮未登场。' }
      ]
    }
  }, {
    characterCard: { name: '刘一', role: '杂役' },
    assistantMessage: {
      id: 'assistant-frame',
      content: '一名陌生女子站在门外，地伶举起令牌。',
      turnFrame: {
        validation: { status: 'accepted' },
        scene: { presentActors: ['地伶', '匿名女子'] }
      }
    },
    turnId: 'assistant-frame',
    now: FIXED_NOW
  });

  assert.deepEqual(memory.characterRegistry.currentAct.members.map((item) => item.name), ['刘一', '地伶']);
  assert.equal(memory.characterRegistry.records.some((item) => item.name === '匿名女子'), false);
  assert.equal(memory.characterRegistry.currentAct.members.find((item) => item.name === '地伶').status, '');
});

test('accepted turn frame uses only a same-turn panel for current-act status', () => {
  const memory = syncCharacterRegistry({
    worldState: {
      protagonist: { name: '刘一' },
      characters: [{ name: '柴翁', role: '屋后老人', encountered: true, status: '正在老槐下削绳。' }]
    }
  }, {
    characterCard: { name: '刘一', role: '杂役' },
    assistantMessage: {
      id: 'assistant-current-panel',
      turnFrame: {
        validation: { status: 'accepted' },
        scene: { presentActors: ['刘一', '柴翁'] }
      },
      roleplayPanels: {
        characterStatus: '『柴翁·状态』身份：屋后老人；正在井台边查看水桶。'
      }
    },
    turnId: 'assistant-current-panel',
    now: FIXED_NOW
  });

  assert.match(memory.characterRegistry.currentAct.members.find((item) => item.name === '柴翁').status, /井台边查看水桶/);
  assert.doesNotMatch(memory.characterRegistry.currentAct.members.find((item) => item.name === '柴翁').status, /老槐下削绳/);
});

test('character registry keeps an on-stage NPC across a pronoun-only continuous reply', () => {
  const first = syncCharacterRegistry({
    worldState: {
      protagonist: { name: '陈默' },
      characters: [
        { name: '唐月', role: '刑警', encountered: true, status: '正在陈默身旁检查门锁。' },
        { name: '老孙', role: '门卫', encountered: true, status: '本轮未登场，留守一楼。' }
      ]
    }
  }, {
    characterCard: { name: '陈默', role: '调查者' },
    assistantMessage: { id: 'assistant-14', content: '唐月按住门锁，示意陈默不要出声。' },
    turnId: 'assistant-14',
    now: FIXED_NOW
  });

  const next = syncCharacterRegistry(first, {
    characterCard: { name: '陈默', role: '调查者' },
    assistantMessage: { id: 'assistant-15', content: '她俯身听了片刻，又向你招了招手。' },
    turnId: 'assistant-15',
    now: FIXED_NOW
  });

  assert.deepEqual(next.characterRegistry.currentAct.members.map((item) => item.name), ['陈默', '唐月']);
  assert.equal(next.characterRegistry.currentAct.members.some((item) => item.name === '老孙'), false);
});

test('character registry conservatively repairs a collapsed act from one canonical active NPC', () => {
  const memory = syncCharacterRegistry({
    worldState: {
      protagonist: { name: '刘一' },
      location: { current: '绝世仙宗杂役院·刘一屋中' },
      characters: [
        { name: '地伶', role: '真传弟子', encountered: true, status: '正在刘一身旁与其交谈，并等待回应。' },
        { name: '管事婆婆', role: '管事', encountered: true, status: '本轮未登场，留守药圃。' },
        { name: '枯骨', role: '上一任灵官', encountered: true, status: '仍盘膝端坐于石室。' }
      ]
    },
    characterRegistry: {
      records: [{ id: 'protagonist:刘一', name: '刘一', kind: 'protagonist' }],
      currentAct: {
        id: 'assistant-old',
        turnId: 'assistant-old',
        members: [{ characterId: 'protagonist:刘一', name: '刘一', state: 'on-stage' }]
      }
    }
  }, {
    characterCard: { name: '刘一', role: '杂役' },
    now: FIXED_NOW
  });

  assert.deepEqual(memory.characterRegistry.currentAct.members.map((item) => item.name), ['刘一', '地伶']);
  assert.equal(memory.characterRegistry.currentAct.members.some((item) => item.name === '管事婆婆'), false);
  assert.equal(memory.characterRegistry.currentAct.members.some((item) => item.name === '枯骨'), false);
});

test('historical protagonist mentions do not pull an off-scene NPC back into the current act', () => {
  const memory = syncCharacterRegistry({
    worldState: {
      protagonist: { name: '刘一' },
      characters: [{
        name: '管事',
        role: '杂役院管事',
        encountered: true,
        status: '收下刘一上交的木牌，令他明日去道库登记。'
      }]
    },
    characterRegistry: {
      records: [{ id: 'protagonist:刘一', name: '刘一', kind: 'protagonist' }],
      currentAct: {
        id: 'assistant-old',
        turnId: 'assistant-old',
        members: [{ characterId: 'protagonist:刘一', name: '刘一', state: 'on-stage' }]
      }
    }
  }, {
    characterCard: { name: '刘一', role: '杂役' },
    now: FIXED_NOW
  });

  assert.deepEqual(memory.characterRegistry.currentAct.members.map((item) => item.name), ['刘一']);
});

test('scenario-container root cards are not registered as protagonists or NPCs', () => {
  const memory = syncCharacterRegistry({
    worldState: {
      protagonist: { name: '刘一' },
      characters: [{ name: '绝世仙宗', encountered: true, status: '旧版错误派生角色' }]
    },
    simulation: {
      actors: [{ id: 'root-actor', name: '绝世仙宗', encountered: true }]
    },
    characterRegistry: {
      records: [{
        id: 'protagonist:绝世仙宗',
        name: '绝世仙宗',
        kind: 'protagonist',
        source: { kind: 'character-card', id: 'active-character-card' }
      }]
    }
  }, {
    characterCard: { name: '绝世仙宗', role: '多角色场景包' },
    worldBook: [
      { id: 'diling', title: '地伶_基础信息', enabled: true },
      { id: 'luoyu', title: '洛玉_人物档案', enabled: true },
      { id: 'yaotai', title: '瑶台_角色设定', enabled: true }
    ],
    now: FIXED_NOW
  });

  assert.equal(memory.characterRegistry.records.some((item) => item.name === '绝世仙宗'), false);
  assert.equal(memory.characterRegistry.records.find((item) => item.kind === 'protagonist')?.name, '刘一');
  assert.deepEqual(
    memory.characterRegistry.records.filter((item) => item.source.kind === 'world-book').map((item) => item.name),
    ['地伶', '洛玉', '瑶台']
  );
});

test('character registry keeps the latest world-state dossier status over a stale simulation actor', () => {
  const memory = syncCharacterRegistry({
    worldState: {
      protagonist: { name: '刘一' },
      characters: [{
        name: '地伶',
        role: '真传弟子',
        encountered: true,
        status: '正与刘一进入石门，并等待刘一回应。',
        location: '禁地石门'
      }]
    },
    simulation: {
      actors: [{
        name: '地伶',
        role: '真传弟子',
        encountered: true,
        status: 'waiting-for-player-response',
        location: '青铜门外'
      }]
    }
  }, {
    characterCard: { name: '刘一', role: '杂役' },
    now: FIXED_NOW
  });

  const diling = memory.characterRegistry.records.find((item) => item.name === '地伶');
  assert.equal(diling.session.status, '正与刘一进入石门，并等待刘一回应。');
  assert.equal(diling.session.location, '禁地石门');
});

test('character registry does not carry a previous NPC across an explicit departure', () => {
  const first = syncCharacterRegistry({
    worldState: {
      protagonist: { name: '陈默' },
      characters: [{ name: '唐月', role: '刑警', encountered: true, status: '正在陈默身旁检查门锁。' }]
    }
  }, {
    characterCard: { name: '陈默', role: '调查者' },
    assistantMessage: { id: 'assistant-16', content: '唐月按住门锁。' },
    turnId: 'assistant-16',
    now: FIXED_NOW
  });
  first.worldState.characters[0].status = '已经离开现场。';

  const next = syncCharacterRegistry(first, {
    characterCard: { name: '陈默', role: '调查者' },
    assistantMessage: { id: 'assistant-17', content: '她转身离开，脚步声逐渐消失。' },
    turnId: 'assistant-17',
    now: FIXED_NOW
  });

  assert.deepEqual(next.characterRegistry.currentAct.members.map((item) => item.name), ['陈默']);
});

test('registry normalization drops malformed actor names and does not duplicate a canonical name', () => {
  const registry = normalizeCharacterRegistry({
    records: [
      { id: 'a', name: '唐月', kind: 'source-npc', source: { kind: 'group-member', id: 'a' } },
      { id: 'b', name: '唐月', kind: 'discovered-npc', source: { kind: 'world-state', id: '唐月' } },
      { id: 'c', name: '坏 名', kind: 'temporary' }
    ]
  });

  assert.equal(registry.records.length, 1);
  assert.deepEqual(registry.records.map((item) => item.name), ['唐月']);
});
