import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateTokens } from '../server/agent/token.js';
import {
  budgetWorldBookEntries,
  compilePlayableCharacterCard,
  compilePlayableWorldBook,
  estimateWorldBookRuntimeProfile
} from '../server/resources/playableResourceCompiler.js';

test('playable character copies retain authored roleplay fields without carrying raw runtime blobs', () => {
  const source = {
    name: '九渊',
    description: '残酷而持续演化的世界。',
    personality: '众生都有自保本能。',
    scenario: '十二国在渊息中彼此吞噬。',
    firstMessage: '边境税吏抬起眼。',
    raw: { huge: 'x'.repeat(20_000) },
    extensions: {
      speech: '克制，具体。',
      regex_scripts: [{ findRegex: '/.*/g', replaceString: '<script>run()</script>' }],
      tavern_helper: { scripts: [{ code: 'run()' }] }
    }
  };

  const result = compilePlayableCharacterCard(source);

  assert.equal(result.card.name, '九渊');
  assert.equal(result.card.extensions.speech, '克制，具体。');
  assert.equal(result.card.raw, undefined);
  assert.equal(result.card.extensions.regex_scripts, undefined);
  assert.equal(result.card.extensions.tavern_helper, undefined);
  assert.equal(source.raw.huge.length, 20_000);
  assert.equal(result.report.rawExcluded, true);
  assert.ok(result.report.savedTokens > 0);
});

test('playable world books keep static lore and convert executable controllers into native contracts', () => {
  const source = [{
    id: 'geography',
    title: '十二国地理',
    content: '每个据点拥有独立灵气、物价与过境税。',
    enabled: true
  }, {
    id: 'npc-controller',
    title: '在场NPC生成引擎',
    content: '<% if (state.location) { %>动态生成 NPC<% } %>',
    enabled: true
  }, {
    id: 'economy-controller',
    title: '地点、国家体制与区域事件控制器',
    content: '<script>updateEconomy()</script>',
    enabled: true
  }];

  const result = compilePlayableWorldBook(source);

  assert.ok(result.entries.find((entry) => entry.id === 'geography'));
  assert.equal(result.entries.some((entry) => entry.id === 'npc-controller'), false);
  assert.equal(result.entries.some((entry) => entry.id === 'economy-controller'), false);
  assert.ok(result.entries.find((entry) => entry.id === 'community-runtime-compatibility-contract'));
  assert.ok(result.report.nativeBehaviors.some((item) => item.includes('在场 NPC')));
  assert.ok(result.report.nativeBehaviors.some((item) => item.includes('国家与势力')));
  assert.ok(result.report.nativeBehaviors.some((item) => item.includes('区域事件')));
  assert.equal(result.worldSystems.topology.nodes[0].name, '十二国地理');
  assert.equal(result.report.safetyMode, 'safe-degradation');
  assert.equal(source[1].content.includes('<%'), true);
});

test('structured world systems classify static lore without executing community scripts', () => {
  const result = compilePlayableWorldBook([
    { id: 'topology', title: '十二国疆域与据点', content: '大朔天京、西戈工坊与南烬灵林各有独立环境。' },
    { id: 'npc', title: '边城人物日程', content: '09:30 税吏核验路引；18:00 商队关闭仓门。' },
    { id: 'factions', title: '三国势力与朝廷', content: '大朔、西戈与南烬持续博弈。' },
    { id: 'calendar', title: '渊历与二十四渊候', content: '息盛季会提高走火入魔风险。' },
    { id: 'economy', title: '白银灵石与过境税率', content: '凡人使用白银，修士交易灵石。' },
    { id: 'cultivation', title: '十道途修行刻度与反噬', content: '德亏值、心斋值、偏差值与契约深度不可逆。' },
    { id: 'unsafe', title: '动态世界引擎', content: '<% mutateWorld() %>' }
  ]);

  assert.equal(result.worldSystems.topology.nodes.length, 1);
  assert.equal(result.worldSystems.population.profiles[0].schedules[0].at, '09:30');
  assert.equal(result.worldSystems.population.scheduleRules.length, 1);
  assert.equal(result.worldSystems.factions.entities.length, 1);
  assert.equal(result.worldSystems.calendar.rules.length, 1);
  assert.ok(result.worldSystems.economy.currencies.includes('白银'));
  assert.equal(result.worldSystems.economy.markets.length > 0, true);
  assert.equal(result.worldSystems.cultivation.paths.length > 0, true);
  assert.ok(result.worldSystems.cultivation.scales.includes('契约深度'));
  assert.equal(result.worldSystems.source.mappedCount, 6);
  assert.equal(result.worldSystems.topology.nodes.some((item) => item.id === 'unsafe'), false);
});

test('structured world systems use static entry bodies when generic titles hide their semantics', () => {
  const result = compilePlayableWorldBook([{
    id: 'generic-settings',
    title: '核心设定',
    content: [
      '疆域：大朔天京通往西戈工坊，南烬灵林与渊下野接壤。',
      '人物日程：09:30 税吏核验路引；18:00 商队关闭仓门。',
      '势力演化：大朔与西戈持续对峙，南烬和渊下野保持贸易。',
      '渊历与二十四渊候控制季节、天候和修行效率。',
      '市场采用白银与灵石双轨交易，各地物价和过境税率不同。',
      '十道途与三条隐秘道脉共同构成修行体系，德亏值与契约深度会触发反噬。'
    ].join('\n')
  }]);

  const systems = result.worldSystems;
  assert.equal(systems.source.mappedCount, 1);
  assert.equal(systems.topology.nodes.length, 1);
  assert.equal(systems.topology.edges.length >= 1, true);
  assert.equal(systems.population.scheduleRules.length, 1);
  assert.equal(systems.factions.relations.length >= 1, true);
  assert.equal(systems.calendar.rules.length, 1);
  assert.equal(systems.economy.markets.length, 1);
  assert.equal(systems.cultivation.paths.length, 1);
  assert.ok(systems.cultivation.scales.includes('契约深度'));
});

test('character profiles and runtime protocols do not pollute semantic world systems', () => {
  const systems = compilePlayableWorldBook([{
    id: 'character-diling',
    title: '地伶_基础信息',
    content: '地伶是绝世仙宗弟子，持有灵石，身具风灵根并修炼醉仙步。'
  }, {
    id: 'mvu-rules',
    title: '[mvu_update]变量更新规则',
    content: '当前时间和地点必须在每次事件推进后更新。'
  }, {
    id: 'faction-law',
    title: '宗门势力结构',
    content: '绝世仙宗与外宗围绕灵田和执事席位展开博弈。'
  }, {
    id: 'cultivation-law',
    title: '修行体系',
    content: '灵根决定功法契合度，破境会产生可追踪的反噬。'
  }]).worldSystems;

  assert.deepEqual(systems.population.profiles.map((record) => record.sourceEntryId), ['character-diling']);
  assert.deepEqual(systems.factions.entities.map((record) => record.sourceEntryId), ['faction-law']);
  assert.deepEqual(systems.cultivation.rules.map((record) => record.sourceEntryId), ['cultivation-law']);
  assert.equal(systems.topology.nodes.length, 0);
  assert.equal(systems.calendar.rules.length, 0);
  assert.equal(systems.economy.rules.length, 0);
  assert.equal(systems.source.mappedCount, 3);
});

test('structured world systems extract canonical currency names instead of surrounding prose', () => {
  const systems = compilePlayableWorldBook([{
    id: 'economy-prose',
    title: '经济规则',
    content: '她双耳悬挂细长银饰，即使只差一颗碎灵石，也会顺手留下低阶丹药或灵石。'
  }]).worldSystems;

  assert.deepEqual(systems.economy.currencies, ['灵石']);
});

test('world book token budgets never exceed their declared total', () => {
  const result = budgetWorldBookEntries([{
    id: 'large-entry',
    title: '渊历与二十四渊候',
    content: '渊息影响修行、物价、伤势与人物日程。'.repeat(200),
    enabled: true
  }], {
    maxTokens: 80,
    maxEntryTokens: 80
  });

  assert.equal(result.entries.length, 1);
  assert.ok(result.report.usedTokens <= 80);
  assert.ok(estimateTokens(`${result.entries[0].title}\n${result.entries[0].content}`) <= 80);
  assert.equal(result.report.truncatedCount, 1);
});

test('world book runtime profiles separate local source size from the per-turn dynamic budget', () => {
  const source = [{
    id: 'world-law',
    title: '世界法则',
    content: '世界法则必须持续成立。'.repeat(1200),
    constant: true,
    enabled: true,
    priority: 100,
    insertionOrder: 1
  }, {
    id: 'market',
    title: '墟市物价',
    keywords: ['墟市'],
    content: '墟市物价受季节和势力控制。'.repeat(1200),
    enabled: true
  }, {
    id: 'disabled',
    title: '禁用旧设定',
    content: '不应进入运行时统计。'.repeat(1200),
    constant: true,
    enabled: false
  }];

  const profile = estimateWorldBookRuntimeProfile(source, {
    maxTokens: 1200,
    maxInjectedEntries: 5
  });

  assert.equal(profile.mode, 'constant-and-triggered');
  assert.equal(profile.source.entryCount, 2);
  assert.equal(profile.alwaysOn.entryCount, 1);
  assert.equal(profile.triggered.candidateCount, 1);
  assert.equal(profile.perTurnTokenCap, 1200);
  assert.ok(profile.source.estimatedTokens > profile.estimatedPerTurnTokens);
  assert.ok(profile.estimatedPerTurnTokens <= 1200);
  assert.equal(source[0].content.endsWith('世界法则必须持续成立。'), true);
});
