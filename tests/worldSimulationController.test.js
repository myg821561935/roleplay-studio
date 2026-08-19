import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createWorldSimulationController,
  formatSimulationDuration,
  renderSimulationActor,
  renderSimulationEvent,
  renderSimulationTextList
} from '../public/modules/worldSimulation.js';

function createElement(overrides = {}) {
  return {
    textContent: '',
    innerHTML: '',
    value: '',
    readOnly: false,
    disabled: false,
    ...overrides
  };
}

function createHarness({
  state,
  apiRequest = async () => ({}),
  parseJsonFromTextarea = (textarea) => JSON.parse(textarea.value)
} = {}) {
  const viewButtons = ['director', 'public'].map((view) => ({
    dataset: { simulationView: view },
    active: false,
    ariaPressed: '',
    classList: {
      toggle(_name, active) {
        this.owner.active = active;
      },
      owner: null
    },
    setAttribute(_name, value) {
      this.ariaPressed = value;
    }
  }));
  viewButtons.forEach((button) => {
    button.classList.owner = button;
  });
  const advanceButtons = [{ disabled: false }, { disabled: false }];
  const els = {
    simulationClockLabel: createElement(),
    simulationViewSwitch: {
      querySelectorAll: () => viewButtons
    },
    simulationMetrics: createElement(),
    simulationStatus: createElement(),
    simulationActorCount: createElement(),
    simulationActors: createElement(),
    simulationEventCount: createElement(),
    simulationEvents: createElement(),
    simulationActorsEditor: createElement(),
    simulationActorsStatus: createElement(),
    saveSimulationActors: createElement()
  };
  const statuses = [];
  const scheduled = [];
  const controller = createWorldSimulationController({
    state,
    els,
    apiRequest,
    getCurrentSessionId: () => 'fallback-session',
    parseJsonFromTextarea,
    setStatus: (element, message, tone) => {
      element.textContent = message;
      statuses.push({ element, message, tone });
    },
    documentObject: {
      activeElement: null,
      querySelectorAll: () => advanceButtons,
      getElementById: (id) => (id === 'simulation-minimap' ? createElement() : null)
    },
    queueMicrotaskFn: (callback) => scheduled.push(callback)
  });
  return { controller, els, viewButtons, advanceButtons, statuses, scheduled };
}

test('world simulation render helpers escape content and hide director-only knowledge', () => {
  const actor = {
    name: '<凌霜>',
    role: '听雨楼',
    status: 'watching',
    location: '墨香书坊',
    goals: ['保护活口'],
    publicKnowledge: ['城门已锁'],
    privateKnowledge: ['真正目标是<script>'],
    agenda: [{ title: '转移证物', status: 'active' }],
    schedule: [{ at: '23:00', location: '粮仓', activity: '接头' }]
  };
  const director = renderSimulationActor(actor, { directorView: true });
  const publicView = renderSimulationActor(actor, { directorView: false });
  const event = renderSimulationEvent({
    kind: 'simulation-tick',
    status: 'accepted',
    summary: '<推进一小时>',
    actor: 'world-clock',
    effects: [{ type: 'clock.advance' }],
    revisionAfter: 3,
    timestamp: 'invalid'
  });

  assert.match(director, /&lt;凌霜&gt;/);
  assert.match(director, /私有知识/);
  assert.match(director, /真正目标是&lt;script&gt;/);
  assert.doesNotMatch(publicView, /私有知识|真正目标/);
  assert.match(publicView, /当前议程/);
  assert.match(event, /世界时钟/);
  assert.match(event, /&lt;推进一小时&gt;/);
  assert.match(event, /时间未知/);
  assert.match(renderSimulationTextList([], '暂无'), /暂无/);
  assert.equal(formatSimulationDuration(30), '30 分钟');
  assert.equal(formatSimulationDuration(120), '2 小时');
  assert.equal(formatSimulationDuration(2880), '2 日');
});

test('world simulation controller applies director snapshots and loads a public projection', async () => {
  const state = {
    session: {
      id: 'story/session',
      memory: {
        keep: 'preserved',
        worldState: { old: true },
        simulation: {
          revision: 1,
          clock: { label: '第1日 08:00' },
          actors: [{ id: 'actor-1', name: '凌霜', privateKnowledge: ['幕后身份'] }]
        },
        eventLedger: [{ id: 'old-event' }]
      }
    },
    simulationView: 'director',
    simulationPublicSnapshot: { stale: true },
    simulationBusy: false
  };
  const calls = [];
  const publicSnapshot = {
    simulation: {
      revision: 2,
      clock: { label: '第1日 09:00' },
      actors: [{ id: 'actor-1', name: '凌霜', publicKnowledge: ['公开线索'] }]
    },
    events: [{ id: 'public-event', summary: '公开事件' }]
  };
  const harness = createHarness({
    state,
    apiRequest: async (path) => {
      calls.push(path);
      return { snapshot: publicSnapshot };
    }
  });

  harness.controller.applyDirectorSimulationSnapshot({
    worldState: { current: true },
    simulation: { revision: 2, actors: [] },
    events: [{ id: 'director-event' }]
  });
  assert.equal(state.session.memory.keep, 'preserved');
  assert.deepEqual(state.session.memory.worldState, { current: true });
  assert.equal(state.session.memory.simulation.revision, 2);
  assert.equal(state.simulationPublicSnapshot, null);

  await harness.controller.selectSimulationView('public');

  assert.equal(state.simulationView, 'public');
  assert.equal(calls.length, 1);
  assert.equal(calls[0], '/api/sessions/story%2Fsession/simulation?view=public');
  assert.equal(state.simulationPublicSnapshot, publicSnapshot);
  assert.equal(harness.els.simulationClockLabel.textContent, '第1日 09:00');
  assert.equal(harness.els.simulationActorsEditor.readOnly, true);
  assert.equal(harness.els.saveSimulationActors.disabled, true);
  assert.doesNotMatch(harness.els.simulationActors.innerHTML, /幕后身份|私有知识/);
});

test('world simulation controller advances time and saves the edited actor registry', async () => {
  const state = {
    session: {
      id: 'main',
      memory: {
        simulation: { revision: 1, actors: [] },
        eventLedger: []
      }
    },
    simulationView: 'director',
    simulationPublicSnapshot: null,
    simulationBusy: false
  };
  const calls = [];
  const nextActors = [{ id: 'actor-1', name: '铁青' }];
  const harness = createHarness({
    state,
    parseJsonFromTextarea: () => nextActors,
    apiRequest: async (path, options = {}) => {
      calls.push({ path, options });
      if (path.endsWith('/simulation/advance')) {
        return {
          snapshot: {
            simulation: { revision: 2, actors: [] },
            events: [{ id: 'tick' }]
          }
        };
      }
      return {
        snapshot: {
          simulation: { revision: 3, actors: nextActors },
          events: [{ id: 'registry' }]
        }
      };
    }
  });

  await harness.controller.advanceWorldSimulation(120);
  await harness.controller.saveSimulationActors();

  assert.equal(calls[0].path, '/api/sessions/main/simulation/advance');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.body.minutes, 120);
  assert.equal(calls[1].path, '/api/sessions/main/simulation/actors');
  assert.equal(calls[1].options.method, 'PUT');
  assert.deepEqual(calls[1].options.body.actors, nextActors);
  assert.equal(state.session.memory.simulation.revision, 3);
  assert.equal(state.simulationBusy, false);
  assert.ok(harness.statuses.some(({ message, tone }) => message === '世界时钟已推进 2 小时' && tone === 'ok'));
  assert.ok(harness.statuses.some(({ message, tone }) => message === '已保存 1 名角色' && tone === 'ok'));
});
