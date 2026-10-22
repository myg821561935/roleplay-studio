import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryService } from '../server/memory/memoryService.js';
import { normalizeCoreMemory, createCoreMemory } from '../server/memory/memoryContract.js';
import { assemblePrompt } from '../server/agent/promptAssembler.js';

test('Core Memory lifecycle: normalization, service update, and prompt integration', () => {
  // 1. 契约归一化测试
  const defaultCore = createCoreMemory();
  assert.deepEqual(defaultCore, { personaView: '', activeCommitments: [], coreDirectives: [] });

  const raw = {
    personaView: '   重情重义的故人   ',
    activeCommitments: ['  保护遗孤安全  ', ''],
    coreDirectives: '复仇'
  };
  const normalized = normalizeCoreMemory(raw);
  assert.equal(normalized.personaView, '重情重义的故人');
  assert.deepEqual(normalized.activeCommitments, ['保护遗孤安全']);
  assert.deepEqual(normalized.coreDirectives, ['复仇']);

  // 2. MemoryService 读写测试
  const memoryService = new MemoryService();
  const session = {
    id: 'test-session',
    memory: {}
  };

  const initial = memoryService.getCoreMemory(session);
  assert.deepEqual(initial, { personaView: '', activeCommitments: [], coreDirectives: [] });

  const updated = memoryService.updateCoreMemory(session, {
    personaView: '视李青为至交好友',
    activeCommitments: ['护送密信至京城'],
    coreDirectives: ['查明旧案真相']
  });

  assert.equal(updated.personaView, '视李青为至交好友');
  assert.deepEqual(updated.activeCommitments, ['护送密信至京城']);

  // 3. PromptAssembler 常驻注入测试
  const prompt = assemblePrompt({
    characterCard: { name: '陆无双', personality: '清冷' },
    messages: [{ role: 'user', content: '陆姑娘，此行凶险。' }],
    memory: session.memory
  });

  // 核心规则、角色锚点和动态上下文现在拆为独立消息，避免动态状态破坏缓存前缀。
  const assembledPrompt = prompt.messages.map((message) => message.content).join('\n');
  assert.match(assembledPrompt, /# 角色核心认知与羁绊 \(Core Memory\)/);
  assert.match(assembledPrompt, /视李青为至交好友/);
  assert.match(assembledPrompt, /护送密信至京城/);
  assert.match(assembledPrompt, /查明旧案真相/);
});
