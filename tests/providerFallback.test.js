import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentService } from '../server/services/agentService.js';

function createMockProviderClient(sequence) {
  let callIndex = 0;
  return {
    complete: async ({ provider }) => {
      const item = sequence[callIndex] ?? { content: 'default' };
      callIndex++;
      if (item.error) throw item.error;
      return { content: item.content ?? 'default', raw: { usage: {} } };
    },
    stream: async ({ provider, onToken }) => {
      const item = sequence[callIndex] ?? { content: 'default' };
      callIndex++;
      if (item.error) throw item.error;
      const content = item.content ?? 'default';
      if (typeof onToken === 'function') {
        for (const ch of content) await onToken(ch);
      }
      return { content, raw: null };
    }
  };
}

function createMockConfig(providers, fallbackChain = []) {
  return {
    providers: {
      activeProviderId: providers[0]?.id || '',
      providers,
      fallbackChain,
      taskProviders: { chat: '', fact: '', summary: '' }
    }
  };
}

test('completeWithFallback uses primary when it succeeds', async () => {
  const providerA = { id: 'A', kind: 'openai-compatible', baseUrl: '', apiKey: '', model: '' };
  const providerB = { id: 'B', kind: 'openai-compatible', baseUrl: '', apiKey: '', model: '' };
  const client = createMockProviderClient([{ content: 'A response' }]);
  const service = new AgentService({
    configService: { getAll: async () => createMockConfig([providerA, providerB], ['B']) },
    sessionService: { getSession: async () => ({ messages: [], memory: {}, settings: {} }), saveSession: async () => {} },
    providerClient: client
  });

  const result = await service.completeWithFallback({
    primaryProvider: providerA,
    fallbackChain: [providerB],
    messages: [{ role: 'user', content: 'hi' }]
  });
  assert.equal(result.content, 'A response');
  assert.equal(result.routing.requestedProviderId, 'A');
  assert.equal(result.routing.providerId, 'A');
  assert.equal(result.routing.fallbackUsed, false);
  assert.deepEqual(result.routing.attempts.map((attempt) => attempt.status), ['success']);
});

test('completeWithFallback falls back when primary fails', async () => {
  const providerA = { id: 'A', kind: 'openai-compatible' };
  const providerB = { id: 'B', kind: 'openai-compatible' };
  const client = createMockProviderClient([
    { error: new Error('A down') },
    { content: 'B response' }
  ]);
  const service = new AgentService({
    configService: { getAll: async () => createMockConfig([providerA, providerB], ['B']) },
    sessionService: { getSession: async () => ({ messages: [], memory: {}, settings: {} }), saveSession: async () => {} },
    providerClient: client
  });

  const result = await service.completeWithFallback({
    primaryProvider: providerA,
    fallbackChain: [providerB],
    messages: [{ role: 'user', content: 'hi' }]
  });
  assert.equal(result.content, 'B response');
  assert.equal(result.routing.requestedProviderId, 'A');
  assert.equal(result.routing.providerId, 'B');
  assert.equal(result.routing.fallbackUsed, true);
  assert.deepEqual(result.routing.attempts.map((attempt) => attempt.status), ['error', 'success']);
});

test('completeWithFallback throws last error when all fail', async () => {
  const providerA = { id: 'A', kind: 'openai-compatible' };
  const providerB = { id: 'B', kind: 'openai-compatible' };
  const client = createMockProviderClient([
    { error: new Error('A down') },
    { error: new Error('B down') }
  ]);
  const service = new AgentService({
    configService: { getAll: async () => createMockConfig([providerA, providerB]) },
    sessionService: { getSession: async () => ({ messages: [], memory: {}, settings: {} }), saveSession: async () => {} },
    providerClient: client
  });

  await assert.rejects(
    service.completeWithFallback({
      primaryProvider: providerA,
      fallbackChain: [providerB],
      messages: [{ role: 'user', content: 'hi' }]
    }),
    /B down/
  );
});

test('getProviderChain dedupes and includes primary', async () => {
  const providerA = { id: 'A' };
  const providerB = { id: 'B' };
  const providerC = { id: 'C' };
  const client = createMockProviderClient([
    { error: new Error('A down') },
    { content: 'B response' }
  ]);
  const service = new AgentService({
    configService: { getAll: async () => createMockConfig([providerA, providerB, providerC], ['B', 'C', 'A']) },
    sessionService: { getSession: async () => ({ messages: [], memory: {}, settings: {} }), saveSession: async () => {} },
    providerClient: client
  });

  const result = await service.completeWithFallback({
    primaryProvider: providerA,
    fallbackChain: [providerB, providerC],
    messages: [{ role: 'user', content: 'hi' }]
  });
  assert.equal(result.content, 'B response');
});

test('normalizeProviders preserves taskProviders and fallbackChain fields', async () => {
  const { ConfigService } = await import('../server/config/configService.js');
  const store = {
    read: async () => ({}),
    write: async (path, value) => {
      assert.equal(value.taskProviders.fact, 'provider-fact');
      assert.equal(value.taskProviders.summary, 'provider-summary');
      assert.equal(value.taskProviders.chat, 'provider-chat');
      assert.equal(value.taskProviders.rewrite, 'provider-rewrite');
      assert.deepEqual(value.fallbackChain, ['provider-b']);
      assert.deepEqual(value.taskFallbackChains.fact, ['provider-b']);
      return value;
    }
  };
  const service = new ConfigService(store);
  await service.saveProviders({
    activeProviderId: 'provider-chat',
    taskProviders: { chat: 'provider-chat', rewrite: 'provider-rewrite', fact: 'provider-fact', summary: 'provider-summary' },
    taskFallbackChains: { fact: ['provider-b'] },
    fallbackChain: ['provider-b'],
    providers: [
      { id: 'provider-chat', kind: 'openai-compatible', baseUrl: 'http://x', apiKey: 'k', model: 'm' },
      { id: 'provider-fact', kind: 'openai-compatible', baseUrl: 'http://x', apiKey: 'k', model: 'm' },
      { id: 'provider-summary', kind: 'openai-compatible', baseUrl: 'http://x', apiKey: 'k', model: 'm' },
      { id: 'provider-b', kind: 'openai-compatible', baseUrl: 'http://x', apiKey: 'k', model: 'm' }
    ]
  });
});

test('runMemoryMaintenanceIfNeeded uses task-routed providers for fact and summary', async () => {
  const providerChat = { id: 'chat', kind: 'openai-compatible' };
  const providerFact = { id: 'fact', kind: 'openai-compatible' };
  const providerSummary = { id: 'summary', kind: 'openai-compatible' };
  const seenIds = [];
  const client = {
    complete: async ({ provider }) => {
      seenIds.push(provider.id);
      return { content: 'ok', raw: {} };
    }
  };
  const config = {
    providers: {
      activeProviderId: 'chat',
      providers: [providerChat, providerFact, providerSummary],
      taskProviders: { chat: 'chat', fact: 'fact', summary: 'summary' },
      fallbackChain: []
    }
  };
  const session = {
    memory: {
      unsummarizedTurnCount: 100,
      worldState: { protagonist: { traits: [], injuries: [], inventory: [] }, location: { knownPlaces: [] }, relationships: [], quests: [], factions: [], flags: {}, timeline: [] },
      memoryCards: [],
      eventLedger: []
    },
    messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }],
    settings: { maxPromptTokens: 100, providerId: 'chat' }
  };
  const service = new AgentService({
    configService: { getAll: async () => config },
    sessionService: { saveSession: async () => {} },
    providerClient: client
  });
  await service.runMemoryMaintenanceIfNeeded({
    session,
    provider: providerChat,
    assembled: { tokenEstimate: 200, messages: [] },
    globalConfig: config
  });
  // fact 提取在前，summary 在后
  assert.equal(seenIds[0], 'fact', 'fact 任务应使用 fact provider');
  assert.equal(seenIds[1], 'summary', 'summary 任务应使用 summary provider');
  assert.ok(!seenIds.includes('chat'), 'chat provider 不应被调用');
  assert.deepEqual(session.usageLedger.map((entry) => entry.taskKey), ['fact', 'summary']);
});

test('runMemoryMaintenanceIfNeeded uses the session fast lane only when background tasks lack explicit routes', async () => {
  const providerChat = { id: 'chat', kind: 'openai-compatible' };
  const providerFast = { id: 'fast', kind: 'openai-compatible' };
  const seenIds = [];
  const config = {
    providers: {
      activeProviderId: 'chat',
      providers: [providerChat, providerFast],
      taskProviders: { chat: 'chat', fact: '', summary: '' },
      fallbackChain: []
    }
  };
  const session = {
    memory: {
      unsummarizedTurnCount: 100,
      worldState: { protagonist: { traits: [], injuries: [], inventory: [] }, location: { knownPlaces: [] }, relationships: [], quests: [], factions: [], flags: {}, timeline: [] },
      memoryCards: [],
      eventLedger: []
    },
    messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }],
    settings: { maxPromptTokens: 100, providerId: 'chat', fastTaskProviderId: 'fast' }
  };
  const service = new AgentService({
    configService: { getAll: async () => config },
    sessionService: { saveSession: async () => {} },
    providerClient: {
      complete: async ({ provider }) => {
        seenIds.push(provider.id);
        return { content: 'ok', raw: {} };
      }
    }
  });

  await service.runMemoryMaintenanceIfNeeded({
    session,
    provider: providerChat,
    assembled: { tokenEstimate: 200, messages: [] },
    globalConfig: config
  });

  assert.deepEqual(seenIds, ['fast', 'fast']);
});
