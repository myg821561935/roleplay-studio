import test from 'node:test';
import assert from 'node:assert/strict';

import { importSillyTavernPreset } from '../server/character/presetImport.js';
import { expandMacros } from '../server/agent/macroEngine.js';

function createPresetDocument() {
  return {
    name: '测试预设',
    prompts: [
      { identifier: 'main', name: '主提示', content: '你是叙事引擎。', enabled: true, role: 'system' },
      { identifier: 'charDescription', name: '角色描述（占位符）', content: '', enabled: true },
      { identifier: 'charPersonality', name: '角色性格（占位符）', content: '', enabled: true },
      { identifier: 'personaDescription', name: '人设描述（占位符）', content: '', enabled: false },
      { identifier: 'dialogueExamples', name: '对话示例（占位符）', content: '', enabled: true },
      { identifier: 'worldInfoBefore', name: '世界书前置（占位符）', content: '', enabled: true },
      { identifier: 'worldInfoAfter', name: '世界书后置（占位符）', content: '', enabled: true },
      { identifier: 'chatHistory', name: '聊天历史（占位符）', content: '', enabled: true },
      { identifier: 'customStyle', name: '自定义模块', content: '角色设定：{{charDefinition}}', enabled: true, role: 'system' }
    ],
    prompt_order: [
      { identifier: 'main', enabled: true },
      { identifier: 'charDescription', enabled: true },
      { identifier: 'worldInfoBefore', enabled: true },
      { identifier: 'customStyle', enabled: true }
    ]
  };
}

test('preset import maps placeholder modules to supported macro placeholders', () => {
  const result = importSillyTavernPreset(createPresetDocument(), { fileName: '测试预设.json' });
  assert.ok(result, '酒馆预设应能导入');

  // 占位符模块不进入 promptModules（避免空消息占位），但语义由宏承接
  assert.deepEqual(
    result.promptModules.map((module) => module.id),
    ['st-preset-main', 'st-preset-customStyle']
  );
  assert.equal(result.counts.placeholders, 7, '占位符模块应被计数');

  // 占位符清单透出，前端与审计可见
  assert.deepEqual(result.placeholderMapping.supported, [
    'charDefinition', 'charDescription', 'charPersonality', 'personaDescription',
    'dialogueExamples', 'worldInfoBefore', 'worldInfoAfter'
  ]);
  const resolvedIds = result.placeholderMapping.resolved.map((item) => item.id);
  assert.deepEqual(resolvedIds, [
    'charDescription', 'charPersonality', 'worldInfoBefore', 'personaDescription',
    'dialogueExamples', 'worldInfoAfter', 'chatHistory'
  ]);
  const persona = result.placeholderMapping.resolved.find((item) => item.id === 'personaDescription');
  assert.equal(persona.enabled, false, '占位符启用状态应保留');
});

test('placeholder macros expand inside imported custom modules at assembly time', () => {
  const result = importSillyTavernPreset(createPresetDocument(), { fileName: '测试预设.json' });
  const customModule = result.promptModules.find((module) => module.id === 'st-preset-customStyle');
  assert.equal(customModule.content, '角色设定：{{charDefinition}}');

  // 宏展开阶段：模块内容中的占位符映射到角色卡实际内容
  const expanded = expandMacros(customModule.content, {
    characterCard: { name: '沈观澜', description: '玄水阁阁主，佩剑听雨。' }
  });
  assert.equal(expanded, '角色设定：玄水阁阁主，佩剑听雨。');
});
