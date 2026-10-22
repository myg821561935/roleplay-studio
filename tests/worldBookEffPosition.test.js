import test from 'node:test';
import assert from 'node:assert/strict';
import { assemblePrompt } from '../server/agent/promptAssembler.js';

test('worldBook position before_eff and after_eff inject around system modules', () => {
  const assembled = assemblePrompt({
    characterCard: { name: '韩立', description: '修仙者' },
    worldBook: [
      { id: 'wb-before-char', title: '世界观前置', content: '天南大陆修仙界。', position: 'before_char', constant: true, enabled: true },
      { id: 'wb-after-char', title: '掌天瓶', content: '绿光小瓶，能催熟灵草。', position: 'after_char', constant: true, enabled: true },
      { id: 'wb-before-eff', title: '天道法则', content: '修仙界强者为尊。', position: 'before_eff', constant: true, enabled: true },
      { id: 'wb-after-eff', title: '青元剑诀', content: '包含大庚剑阵。', position: 'after_eff', constant: true, enabled: true }
    ],
    promptModules: [
      { id: 'sys-rule-1', content: '遵守修仙世界行文规范。', role: 'system', enabled: true }
    ],
    messages: [
      { role: 'user', content: '在吗？' },
      { role: 'assistant', content: '在的。' }
    ],
    userMessage: '查看四周环境'
  });

  const messages = assembled.messages;

  // 1. before_char 应该被合并进第一个 system 消息的前部
  const firstSystem = messages[0];
  assert.ok(firstSystem, 'first system message exists');
  assert.match(firstSystem.content, /# 世界书（角色定义前）[\s\S]*天南大陆修仙界/);

  // 2. after_char 渲染在 core-system 之后的常驻世界书消息中
  const worldBookMain = messages.find((m) => m.role === 'system' && m.content.includes('掌天瓶'));
  assert.ok(worldBookMain, 'main worldbook exists');
  assert.match(worldBookMain.content, /# 常驻世界书和记忆[\s\S]*掌天瓶/);

  // 3. before_eff 应该在 preset-system 之前
  const beforeEffMsg = messages.find((m) => m.role === 'system' && m.content.includes('天道法则'));
  assert.ok(beforeEffMsg, 'worldbook-before-eff exists');
  assert.match(beforeEffMsg.content, /# 世界书（扩展效果前）[\s\S]*天道法则/);

  // 4. preset-system 模块
  const presetMsg = messages.find((m) => m.role === 'system' && m.content.includes('遵守修仙世界行文规范'));
  assert.ok(presetMsg, 'preset-system exists');

  // 5. after_eff 应该在 preset-system 之后
  const afterEffMsg = messages.find((m) => m.role === 'system' && m.content.includes('青元剑诀'));
  assert.ok(afterEffMsg, 'worldbook-after-eff exists');
  assert.match(afterEffMsg.content, /# 世界书（扩展效果后）[\s\S]*青元剑诀/);

  // 校验顺序
  const idxFirst = messages.indexOf(firstSystem);
  const idxMain = messages.indexOf(worldBookMain);
  const idxBeforeEff = messages.indexOf(beforeEffMsg);
  const idxPreset = messages.indexOf(presetMsg);
  const idxAfterEff = messages.indexOf(afterEffMsg);

  assert.ok(idxFirst < idxMain, 'first < worldbook');
  assert.ok(idxMain < idxBeforeEff, 'worldbook < before_eff');
  assert.ok(idxBeforeEff < idxPreset, 'before_eff < preset-system');
  assert.ok(idxPreset < idxAfterEff, 'preset-system < after_eff');
});

test('numeric SillyTavern positions keep at-depth and extension-module semantics', () => {
  const assembled = assemblePrompt({
    characterCard: { name: '韩立', description: '修仙者' },
    worldBook: [
      { id: 'wb-at-depth', title: '深度线索', content: '只在最近一轮前出现。', position: 4, depth: 1, constant: true, enabled: true },
      { id: 'wb-em-top', title: '预设前法则', content: '先于预设生效。', position: 5, constant: true, enabled: true },
      { id: 'wb-em-bottom', title: '预设后注记', content: '后于预设生效。', position: 6, constant: true, enabled: true },
      { id: 'wb-author-note', title: '作者注记兼容项', content: '仅保留为安全文本。', position: 2, constant: true, enabled: true }
    ],
    promptModules: [{ id: 'sys-rule', content: '预设系统规则。', role: 'system', enabled: true }],
    messages: [{ role: 'user', content: '旧回合' }, { role: 'assistant', content: '旧回应' }],
    userMessage: '现在行动'
  });

  const atDepth = assembled.sections.promptStudio.blocks
    .find((block) => block.content.includes('深度线索'));
  const emTop = assembled.messages.find((message) => message.content.includes('预设前法则'));
  const preset = assembled.messages.find((message) => message.content.includes('预设系统规则'));
  const emBottom = assembled.messages.find((message) => message.content.includes('预设后注记'));

  assert.equal(atDepth.depth, 1, 'position 4 must be an at-depth injection');
  assert.equal(atDepth.kind, 'worldbook-anchor');
  assert.ok(assembled.messages.indexOf(emTop) < assembled.messages.indexOf(preset));
  assert.ok(assembled.messages.indexOf(preset) < assembled.messages.indexOf(emBottom));
  assert.deepEqual(assembled.sections.worldBookPositionCompatibility, [{
    id: 'wb-author-note',
    title: '作者注记兼容项',
    sourcePosition: 2,
    normalizedPosition: 'after_character',
    status: 'degraded',
    capability: 'author-note-top',
    reason: '当前运行时未实现酒馆 Author’s Note 顶部插槽，已安全降级到角色定义之后。'
  }]);
});
