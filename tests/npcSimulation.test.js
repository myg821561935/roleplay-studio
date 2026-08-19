import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceSimulationClock,
  createSimulationState,
  ensureSimulationMemory,
  normalizeWorldSystems,
  projectSimulation,
  renderSimulationPrompt
} from '../server/simulation/npcSimulation.js';

test('simulation seeds actors with separate public and private knowledge', () => {
  const memory = ensureSimulationMemory({}, {
    characterCard: { id: 'keeper', name: '守库人', publicKnowledge: ['仓门夜间关闭'], privateKnowledge: ['第三把钥匙已经遗失'] }
  });
  assert.equal(memory.simulation.actors.length, 1);
  assert.deepEqual(memory.simulation.actors[0].privateKnowledge, ['第三把钥匙已经遗失']);
  assert.equal(projectSimulation(memory.simulation, { director: false }).actors[0].privateKnowledge, undefined);
  assert.deepEqual(projectSimulation(memory.simulation, { director: true }).actors[0].privateKnowledge, ['第三把钥匙已经遗失']);
});

test('simulation deduplicates the protagonist repeated in character presets', () => {
  const memory = ensureSimulationMemory({}, {
    characterCard: { id: 'hero-card', name: '陈默', role: '调查员' },
    characterPresets: [
      { id: 'hero-preset', characterCard: { id: 'hero-preset-card', name: '陈默', role: '调查员' } },
      { id: 'partner', characterCard: { id: 'partner-card', name: '唐月', role: '刑警' } }
    ]
  });
  assert.deepEqual(memory.simulation.actors.map((actor) => actor.name), ['陈默', '唐月']);
});

test('simulation does not repopulate a roster that the creator intentionally cleared', () => {
  const memory = ensureSimulationMemory({
    simulation: {
      ...createSimulationState(),
      revision: 1,
      actors: []
    }
  }, {
    characterCard: { id: 'keeper', name: '守库人' }
  });
  assert.equal(memory.simulation.actors.length, 0);
  assert.equal(memory.simulation.settings.rosterInitialized, true);
});

test('simulation advances the clock and executes crossed NPC schedules', () => {
  const simulation = createSimulationState({
    clock: { day: 1, minuteOfDay: 470 },
    actors: [{
      id: 'runner',
      name: '驿卒',
      location: '驿站',
      schedule: [{ id: 'morning-run', at: '08:00', location: '北城门', activity: '递送军报', visibility: 'private' }]
    }]
  });
  const advanced = advanceSimulationClock(simulation, {
    minutes: 20,
    now: () => new Date('2026-07-16T00:00:00.000Z')
  });
  assert.equal(advanced.simulation.clock.label, '第1日 08:10');
  assert.equal(advanced.simulation.actors[0].location, '北城门');
  assert.equal(advanced.events.length, 1);
  assert.equal(advanced.events[0].visibility, 'private');
  assert.equal(projectSimulation(advanced.simulation, { director: false }).backstageEvents.length, 0);
});

test('simulation retains structured world systems and hides director-only records from public views', () => {
  const memory = ensureSimulationMemory({}, {
    worldSystems: {
      topology: {
        nodes: [
          { id: 'capital', name: '大朔天京', summary: '门阀与寒门交错。', visibility: 'public' },
          { id: 'sealed', name: '封印内层', summary: '只供导演裁定。', visibility: 'director' }
        ]
      },
      economy: { currencies: ['白银', '灵石'], rules: [{ id: 'tax', name: '过境税', summary: '各地税率不同。' }] },
      cultivation: { scales: ['德亏值', '契约深度'], rules: [{ id: 'paths', name: '十道途', summary: '力量必须承担代价。' }] }
    }
  });

  const director = projectSimulation(memory.simulation, { director: true });
  const publicView = projectSimulation(memory.simulation, { director: false });
  assert.equal(director.systems.topology.nodes.length, 2);
  assert.equal(publicView.systems.topology.nodes.length, 1);
  assert.match(renderSimulationPrompt(memory), /地点拓扑/);
  assert.match(renderSimulationPrompt(memory), /契约深度/);
});

test('simulation normalization removes legacy character and protocol records from unrelated systems', () => {
  const characterRecord = {
    id: 'diling',
    name: '地伶_性格调色盘',
    summary: '角色资料中提及宗门、灵石、灵根和功法。',
    sourceEntryId: 'character-diling'
  };
  const protocolRecord = {
    id: 'mvu-rules',
    name: '[mvu_update]变量更新规则',
    summary: '更新当前时间与地点。',
    sourceEntryId: 'mvu-rules'
  };
  const systems = normalizeWorldSystems({
    topology: {
      nodes: [protocolRecord],
      edges: [{ from: '杂役院', to: '山门', sourceEntryId: 'mvu-rules' }]
    },
    population: {
      profiles: [characterRecord],
      scheduleRules: [characterRecord]
    },
    factions: {
      entities: [characterRecord, { id: 'sect', name: '宗门势力结构', sourceEntryId: 'faction-law' }],
      relations: [{ from: '地伶', to: '绝世仙宗', sourceEntryId: 'character-diling' }]
    },
    calendar: { rules: [protocolRecord] },
    economy: {
      currencies: ['双耳悬挂细长银', '即使只差一颗碎灵石', '但会顺手丢下低阶丹药或灵石'],
      rules: [characterRecord]
    },
    cultivation: {
      scales: ['也会将当值', '契约深度'],
      rules: [characterRecord, { id: 'path', name: '修行体系', sourceEntryId: 'cultivation-law' }]
    }
  });

  assert.deepEqual(systems.population.profiles.map((record) => record.sourceEntryId), ['character-diling']);
  assert.equal(systems.population.scheduleRules.length, 0);
  assert.equal(systems.topology.nodes.length, 0);
  assert.equal(systems.topology.edges.length, 0);
  assert.deepEqual(systems.factions.entities.map((record) => record.sourceEntryId), ['faction-law']);
  assert.equal(systems.factions.relations.length, 0);
  assert.equal(systems.calendar.rules.length, 0);
  assert.equal(systems.economy.rules.length, 0);
  assert.deepEqual(systems.economy.currencies, ['灵石']);
  assert.deepEqual(systems.cultivation.rules.map((record) => record.sourceEntryId), ['cultivation-law']);
  assert.deepEqual(systems.cultivation.scales, ['契约深度']);
});

test('simulation prompt injects an identical multi-domain summary only in its strongest section', () => {
  const worldView = {
    id: 'world-view',
    name: '世界观',
    summary: '修仙条件是觉醒灵根，灵根决定修炼功法，并按炼气、筑基、金丹等境界逐步突破。',
    sourceEntryId: 'world-view'
  };
  const prompt = renderSimulationPrompt({
    worldState: {
      worldDynamics: {
        factions: [
          { name: '地伶_基础信息' },
          { name: '世界观' },
          { name: '绝世仙宗' }
        ]
      }
    },
    simulation: createSimulationState({
      systems: {
        factions: { entities: [worldView] },
        cultivation: { rules: [worldView] }
      }
    })
  });

  assert.equal((prompt.match(/世界观/g) || []).length, 1);
  assert.match(prompt, /## 修行与反噬\n- 世界观/);
  assert.doesNotMatch(prompt, /## 势力演化\n- 世界观/);
  assert.match(prompt, /势力背景事件：绝世仙宗/);
  assert.doesNotMatch(prompt, /势力背景事件：[^\n]*(?:地伶_基础信息|世界观)/);
});
