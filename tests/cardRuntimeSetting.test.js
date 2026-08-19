import test from 'node:test';
import assert from 'node:assert/strict';

import { createCardRuntimeSettingController } from '../public/modules/cardRuntimeSetting.js';

test('card runtime setting persists one session-owned boolean and restores the control after saving', async () => {
  const input = {
    checked: true,
    disabled: false,
    listeners: new Map(),
    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    }
  };
  const settings = { cardRuntimeEnabled: true, narrativeMode: 'stable' };
  const saved = [];
  const statuses = [];
  let pending = false;
  const controller = createCardRuntimeSettingController({
    els: { cardRuntimeEnabled: input, appStatus: { id: 'app-status' } },
    getSettings: () => settings,
    beginOperation: () => {
      if (pending) return false;
      pending = true;
      controller.syncOperationState(true);
      return true;
    },
    endOperation: () => {
      pending = false;
      controller.syncOperationState(false);
    },
    saveSettingsPatch: async (patch) => {
      saved.push(patch);
      Object.assign(settings, patch);
      return { settings: { ...settings } };
    },
    renderSessionSettings: () => controller.render(),
    setStatus: (...args) => statuses.push(args)
  });

  controller.render();
  assert.equal(input.checked, true);
  const session = await controller.save(false);

  assert.deepEqual(saved, [{ cardRuntimeEnabled: false }]);
  assert.equal(session.settings.cardRuntimeEnabled, false);
  assert.equal(input.checked, false);
  assert.equal(input.disabled, false);
  assert.match(statuses.at(-1)[1], /关闭角色卡运行化层/);
});
