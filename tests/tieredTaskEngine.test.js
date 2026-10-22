import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTieredProvider, executeFastTask } from '../server/provider/tieredTaskEngine.js';

test('resolveTieredProvider falls back to primary provider when fastTaskProviderId not set', () => {
  const providers = [
    { id: 'deepseek-v3', name: 'DeepSeek V3' },
    { id: 'qwen-1.5b-local', name: 'Qwen 1.5B Local' }
  ];

  const session = {
    settings: {
      providerId: 'deepseek-v3'
    }
  };

  const mainResult = resolveTieredProvider({ session, providers, taskType: 'main' });
  assert.equal(mainResult.provider.id, 'deepseek-v3');
  assert.equal(mainResult.isTiered, false);

  const fastResult = resolveTieredProvider({ session, providers, taskType: 'fast' });
  assert.equal(fastResult.provider.id, 'deepseek-v3');
  assert.equal(fastResult.isTiered, false);
});

test('resolveTieredProvider routes to fastTaskProviderId when configured', () => {
  const providers = [
    { id: 'deepseek-v3', name: 'DeepSeek V3' },
    { id: 'qwen-1.5b-local', name: 'Qwen 1.5B Local' }
  ];

  const session = {
    settings: {
      providerId: 'deepseek-v3',
      fastTaskProviderId: 'qwen-1.5b-local'
    }
  };

  const fastResult = resolveTieredProvider({ session, providers, taskType: 'fast' });
  assert.equal(fastResult.provider.id, 'qwen-1.5b-local');
  assert.equal(fastResult.isTiered, true);
});

test('executeFastTask dispatches complete call to selected provider', async () => {
  const providers = [
    { id: 'qwen-1.5b-local', name: 'Qwen 1.5B Local' }
  ];
  const session = {
    settings: {
      providerId: 'qwen-1.5b-local'
    }
  };

  const fakeClient = {
    complete: async ({ provider, messages }) => {
      return {
        content: JSON.stringify({ emotion: 'calm', intent: 'investigate' }),
        usage: { total_tokens: 42 }
      };
    }
  };

  const result = await executeFastTask({
    taskName: 'emotion-tagging',
    messages: [{ role: 'user', content: '测试' }],
    session,
    providers,
    providerClient: fakeClient
  });

  assert.equal(result.status, 'success');
  assert.equal(result.taskName, 'emotion-tagging');
  assert.ok(result.content.includes('calm'));
});
