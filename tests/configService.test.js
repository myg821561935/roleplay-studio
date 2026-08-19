import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../server/lib/jsonStore.js';
import { ConfigService } from '../server/config/configService.js';

test('ConfigService returns seeded prompt modules and world book', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-config-'));
  const service = new ConfigService(new JsonStore(root));
  const state = await service.getAll();
  assert.equal(state.promptModules.length >= 5, true);
  assert.equal(state.worldBook.length >= 3, true);
  assert.equal(state.characterCard.name, '未命名主角');
  assert.equal(state.providers.activeProviderId, '');

  const creativeMode = state.promptModules.find((module) => module.id === 'personal-creative-mode');
  assert.ok(creativeMode);
  assert.match(creativeMode.content, /不增加限制词/);
  const adultMode = state.promptModules.find((module) => module.id === 'adult-creative-mode');
  assert.ok(adultMode);
  assert.match(adultMode.content, /成人创作沙盒/);
  assert.ok(state.promptModules.find((module) => module.id === 'relationship-arc-engine'));
  assert.ok(state.promptModules.find((module) => module.id === 'fact-extraction-standards'));
  assert.ok(state.worldBook.find((entry) => entry.id === 'faction-zhenwusi'));
  assert.ok(state.worldBook.find((entry) => entry.id === 'location-luoyan-nightmarket'));
  assert.ok(state.worldBook.length >= 12);
});

test('ConfigService saves character card', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-config-'));
  const service = new ConfigService(new JsonStore(root));

  await service.saveCharacterCard({
    name: '沈观澜',
    role: '游侠',
    description: '初入江湖的刀客。',
    personality: '沉稳，重诺。',
    scenario: '正在调查镇武司旧案。',
    firstMessage: '夜雨打在刀鞘上。',
    exampleDialog: ['用户：你是谁？', '沈观澜：过路人。'],
    tags: ['武侠', '高武'],
    enabled: true
  });

  const state = await service.getAll();
  assert.equal(state.characterCard.name, '沈观澜');
  assert.equal(state.characterCard.role, '游侠');
  assert.deepEqual(state.characterCard.tags, ['武侠', '高武']);
});

test('ConfigService preserves compatible group member profiles without unsafe metadata keys', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-config-'));
  const service = new ConfigService(new JsonStore(root));

  await service.saveGroupMembers([{
    id: 'member-lu',
    name: ' 陆无咎 ',
    role: ' 谋士 ',
    enabled: false,
    speechStyle: '温和克制',
    exampleDialog: ['陆无咎：先看证据。'],
    goals: ['查清旧案'],
    relationships: { 沈观澜: '盟友' },
    location: '落雁城',
    publicKnowledge: ['城门将封'],
    schedule: { 夜间: '巡查' },
    extensions: JSON.parse('{"speech":"简短","__proto__":{"polluted":true}}')
  }]);

  const member = (await service.getAll()).groupMembers[0];
  assert.equal(member.name, '陆无咎');
  assert.equal(member.enabled, false);
  assert.equal(member.speechStyle, '温和克制');
  assert.deepEqual(member.exampleDialog, ['陆无咎：先看证据。']);
  assert.deepEqual(member.goals, ['查清旧案']);
  assert.deepEqual(member.relationships, { 沈观澜: '盟友' });
  assert.deepEqual(member.schedule, { 夜间: '巡查' });
  assert.equal(Object.hasOwn(member.extensions, '__proto__'), false);
});

test('ConfigService preserves valid talkativeness and drops invalid values on group members', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-config-'));
  const service = new ConfigService(new JsonStore(root));

  await service.saveGroupMembers([
    { id: 'member-a', name: '阿紫', talkativeness: 0.8 },
    { id: 'member-b', name: '萧远', talkativeness: 1 },
    { id: 'member-c', name: '陆沉', talkativeness: 0 },
    { id: 'member-d', name: '柳青', talkativeness: '废话' },
    { id: 'member-e', name: '秦烈', talkativeness: 2.5 },
    { id: 'member-f', name: '白砚' }
  ]);

  const members = (await service.getAll()).groupMembers;
  assert.equal(members.find((m) => m.name === '阿紫').talkativeness, 0.8);
  assert.equal(members.find((m) => m.name === '萧远').talkativeness, 1);
  // 0 / 非数字 / 超 1 / 缺省：字段被丢弃，选择器侧回落默认 0.5
  assert.equal('talkativeness' in members.find((m) => m.name === '陆沉'), false);
  assert.equal('talkativeness' in members.find((m) => m.name === '柳青'), false);
  assert.equal('talkativeness' in members.find((m) => m.name === '秦烈'), false);
  assert.equal('talkativeness' in members.find((m) => m.name === '白砚'), false);
});

test('ConfigService saves provider config without touching prompt modules', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-config-'));
  const service = new ConfigService(new JsonStore(root));
  await service.saveProviders({
    activeProviderId: 'local',
    providers: [{
      id: 'local',
      kind: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'secret',
      model: 'model-a',
      temperature: 0.9,
      maxTokens: 2000,
      headers: {}
    }]
  });
  const state = await service.getAll();
  assert.equal(state.providers.activeProviderId, 'local');
  assert.equal(state.promptModules.length >= 5, true);
});

test('ConfigService preserves native provider kind and preset metadata', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-config-'));
  const service = new ConfigService(new JsonStore(root));
  await service.saveProviders({
    activeProviderId: 'claude',
    providers: [{
      id: 'claude',
      kind: 'anthropic',
      preset: 'anthropic',
      baseUrl: '',
      apiKey: 'secret',
      model: 'claude-3-5-sonnet-latest',
      temperature: 0.9,
      maxTokens: 2000,
      headers: {}
    }]
  });

  const state = await service.getAll();
  assert.equal(state.providers.providers[0].kind, 'anthropic');
  assert.equal(state.providers.providers[0].preset, 'anthropic');
});

test('ConfigService normalizes provider reasoning mode', async () => {
  const enabled = await saveAndLoadProvider({ reasoningMode: 'enabled' });
  const invalid = await saveAndLoadProvider({ reasoningMode: 'unexpected' });

  assert.equal(enabled.reasoningMode, 'enabled');
  assert.equal(invalid.reasoningMode, 'auto');
});

test('ConfigService falls back for invalid temperature string', async () => {
  const provider = await saveAndLoadProvider({ temperature: 'not-a-number' });

  assert.equal(provider.temperature, 0.9);
});

test('ConfigService falls back for invalid maxTokens string', async () => {
  const provider = await saveAndLoadProvider({ maxTokens: 'not-a-number' });

  assert.equal(provider.maxTokens, 2000);
});

test('ConfigService falls back for non-positive maxTokens', async () => {
  const zeroProvider = await saveAndLoadProvider({ maxTokens: 0 });
  const negativeProvider = await saveAndLoadProvider({ maxTokens: -10 });

  assert.equal(zeroProvider.maxTokens, 2000);
  assert.equal(negativeProvider.maxTokens, 2000);
});

async function saveAndLoadProvider(providerPatch) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-config-'));
  const service = new ConfigService(new JsonStore(root));
  await service.saveProviders({
    activeProviderId: 'local',
    providers: [{
      id: 'local',
      kind: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'secret',
      model: 'model-a',
      temperature: 0.9,
      maxTokens: 2000,
      headers: {},
      ...providerPatch
    }]
  });

  const state = await service.getAll();
  return state.providers.providers[0];
}
