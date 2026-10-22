import test from 'node:test';
import assert from 'node:assert/strict';
import { createPromptExecutionSettings } from '../public/modules/promptExecutionSettings.js';
const control = () => ({ value: '', disabled: false, addEventListener(_type, fn) { this.change = fn; } });
test('enhancement controls persist explicit choices and restore mode defaults', async () => {
  const state = { session: { settings: { agentEnhancements: { memoryRecall: false, npcSimulation: true } } } };
  const memory = control(), npc = control(), plot = control(), actions = control();
  const controller = createPromptExecutionSettings({ state, els: { enhancementMemoryRecall: memory, enhancementNpcSimulation: npc, enhancementPlotGuidance: plot, enhancementActionSuggestions: actions },
    saveSettingsPatch: async patch => Object.assign(state.session.settings, patch), renderSessionSettings: () => {}, setStatus: () => {}, humanizeApiError: e => e.message });
  controller.bind(); controller.render();
  assert.equal(memory.value, 'false'); assert.equal(npc.value, 'true'); assert.equal(plot.value, 'auto');
  memory.value = 'auto'; plot.value = 'false'; actions.value = 'true'; await actions.change();
  assert.deepEqual(state.session.settings.agentEnhancements, { npcSimulation: true, plotGuidance: false, actionSuggestions: true });
  assert.equal(actions.disabled, false);
});
test('execution settings persist mode and budget and restore authoritative values after errors', async () => {
  const state = { session: { settings: { promptExecutionMode: 'auto', maxPromptTokens: 8000 } } };
  const mode = control(), budget = control(), patches = [], statuses = [];
  let fail = false, controller;
  controller = createPromptExecutionSettings({ state, els: { sessionPromptExecutionMode: mode, sessionPromptBudget: budget }, saveSettingsPatch: async patch => {
    assert.equal(mode.disabled, true); patches.push(patch);
    if (fail) throw new Error('保存失败');
    Object.assign(state.session.settings, patch);
  }, renderSessionSettings: () => controller.render(), setStatus: (_el, message) => statuses.push(message), humanizeApiError: e => e.message });
  controller.bind(); controller.render();
  assert.equal(mode.value, 'auto'); assert.equal(budget.value, 8000);
  mode.value = 'faithful'; budget.value = '32000'; await mode.change();
  assert.deepEqual(patches[0], { agentEnhancements: {}, promptExecutionMode: 'faithful', maxPromptTokens: 32000 });
  budget.value = '500'; await budget.change(); assert.equal(patches.length, 1);
  assert.match(statuses.at(-1), /至少 1000/);
  fail = true; mode.value = 'enhanced'; budget.value = '64000'; await mode.change();
  assert.equal(mode.value, 'faithful'); assert.equal(budget.value, 32000);
  assert.equal(mode.disabled, false); assert.equal(budget.disabled, false);
});
