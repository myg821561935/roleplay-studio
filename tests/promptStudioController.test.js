import test from 'node:test';
import assert from 'node:assert/strict';

import { createPromptStudioController } from '../public/modules/promptStudio.js';

test('prompt studio changes only the active session modules and refreshes the local request preview', async () => {
  const calls = [];
  const state = {
    config: {
      promptModules: [
        { id: 'style', title: '文风', content: '保持克制。', enabled: true },
        { id: 'scene', title: '场景', content: '保留雨夜。', enabled: true }
      ]
    },
    session: { id: 'story/a', memory: {} }
  };
  const integrityStates = [];
  const controller = createPromptStudioController({
    state,
    els: {},
    getCurrentSessionId: () => 'story/a',
    getPreviewContent: () => '我站在门边。',
    apiRequest: async (path, options = {}) => {
      calls.push([path, options]);
      if (path.endsWith('/prompt-preview')) {
        return {
          tokenEstimate: 123,
          promptStudio: {
            blocks: [],
            modules: [],
            integrity: {
              status: 'suppressed-for-integrity',
              suppressedBundles: [{ title: '社区预设', reason: '变量链不完整' }]
            }
          },
          request: { messages: [{ role: 'user', content: '我站在门边。' }] }
        };
      }
      return { promptModules: options.body.promptModules };
    },
    onIntegrityChange: (integrity) => integrityStates.push(integrity.status)
  });

  const reordered = await controller.moveModule('scene', 'style');
  assert.deepEqual(reordered.map((module) => module.id), ['scene', 'style']);
  assert.deepEqual(calls[0], [
    '/api/prompt-modules',
    {
      method: 'PUT',
      body: {
        sessionId: 'story/a',
        promptModules: [
          { id: 'scene', title: '场景', content: '保留雨夜。', enabled: true, order: 0 },
          { id: 'style', title: '文风', content: '保持克制。', enabled: true, order: 1 }
        ]
      }
    }
  ]);
  assert.equal(calls[1][0], '/api/sessions/story%2Fa/prompt-preview');
  assert.equal(state.session.memory.promptRuntime.communityPresetIntegrity.status, 'suppressed-for-integrity');
  assert.deepEqual(integrityStates, ['suppressed-for-integrity']);

  assert.equal(calls.length, 2);
});

test('prompt studio does not reorder a compatibility-bound community module', async () => {
  const state = {
    config: {
      promptModules: [
        {
          id: 'community',
          title: '社区预设',
          content: '保持原顺序。',
          extensions: { sillyTavernPreset: { presetTitle: '社区预设', sequence: 1 } }
        },
        { id: 'style', title: '文风', content: '保持克制。' }
      ]
    }
  };
  const calls = [];
  const controller = createPromptStudioController({
    state,
    els: {},
    apiRequest: async (...args) => {
      calls.push(args);
      return {};
    }
  });

  assert.equal(await controller.moveModule('community', 'style'), null);
  assert.equal(calls.length, 0);
});
