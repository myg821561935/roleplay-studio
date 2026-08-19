import test from 'node:test';
import assert from 'node:assert/strict';

import { importCharacterCardFromPayload } from '../server/character/characterCardImport.js';
import { importSillyTavernPreset } from '../server/character/presetImport.js';
import { importWorldBookFromPayload } from '../server/character/worldBookImport.js';
import { expandMacros } from '../server/agent/macroEngine.js';

// 阶段一兼容性回归：用酒馆社区真实结构（V2/V3 卡、预设、世界书）
// 验证导入链路与宏消费端到端不回退。

function cardPayload(card) {
  return {
    fileName: `${card.data.name}.json`,
    mimeType: 'application/json',
    data: JSON.stringify(card)
  };
}

test('phase 1 regression: SillyTavern V2 card imports with world book and example dialogues', () => {
  const v2Card = {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: '阿萤',
      description: '守灯人，常年住在灯塔顶层。',
      personality: '温柔而执拗',
      scenario: '暴风雨夜',
      first_mes: '灯塔的光在雨里晃了一下。',
      mes_example: '{{user}}: 灯还亮着吗\n阿萤: 亮着，一直亮着。',
      character_book: {
        entries: [
          { keys: ['灯塔'], content: '百年前由渔村集资修建。', enabled: true, position: 'before_char' },
          { keys: ['阿萤'], content: '守灯人第七代。', enabled: true }
        ]
      }
    }
  };
  const imported = importCharacterCardFromPayload(cardPayload(v2Card));
  const card = imported.characterCard;
  assert.equal(card.name, '阿萤');
  assert.ok(card.description.includes('守灯人'));
  assert.equal(card.sourceSpec, 'chara_card_v2');
  // 世界书随卡导入并保留前后置位置
  assert.equal(imported.worldBook.length, 2);
  const beforeEntry = imported.worldBook.find((entry) => entry.title === '灯塔');
  assert.ok(beforeEntry.position === 'before_char' || beforeEntry.position === 'before_character');
});

test('phase 1 regression: SillyTavern V3 card fields are consumed (system_prompt/assets/creator_notes)', () => {
  const v3Card = {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
      name: '临渊',
      description: '深渊测绘师。',
      system_prompt: '你是深渊测绘师临渊。',
      creator_notes: '适合克苏鲁风格跑团。',
      assets: [
        { type: 'icon', uri: 'https://cdn.example.com/avatar.png', name: '头像' },
        { type: 'background', uri: '/local/bg.jpg', name: '背景' },
        { type: 'icon', uri: 'javascript:alert(1)', name: '恶意脚本' }
      ]
    }
  };
  const imported = importCharacterCardFromPayload(cardPayload(v3Card));
  const card = imported.characterCard;
  assert.equal(card.sourceSpec, 'chara_card_v3');
  assert.equal(card.systemPrompt, '你是深渊测绘师临渊。');
  assert.equal(card.creatorNotes, '适合克苏鲁风格跑团。');
  // 安全消费：http(s) 外链与同源相对路径保留，javascript: 拒绝
  const assets = Array.isArray(card.assets) ? card.assets : [];
  const uris = assets.map((asset) => asset.uri).filter(Boolean);
  assert.ok(uris.includes('https://cdn.example.com/avatar.png'), 'https 外链应保留');
  assert.ok(uris.includes('/local/bg.jpg'), '同源相对路径应保留');
  assert.equal(uris.some((uri) => uri.startsWith('javascript:')), false, 'javascript: 应被拒绝');
});

test('phase 1 regression: preset placeholders map to local layers end to end', () => {
  const preset = {
    name: '回归预设',
    prompts: [
      { identifier: 'main', content: '你是叙事引擎。', enabled: true, role: 'system' },
      { identifier: 'charDescription', content: '', enabled: true },
      { identifier: 'worldInfoBefore', content: '', enabled: true },
      { identifier: 'custom', content: '角色：{{charDefinition}}\n人设：{{personaDescription}}', enabled: true, role: 'system' }
    ],
    prompt_order: [
      { identifier: 'main', enabled: true },
      { identifier: 'charDescription', enabled: true },
      { identifier: 'custom', enabled: true }
    ]
  };
  const result = importSillyTavernPreset(preset, { fileName: 'regression.json' });
  assert.ok(result.promptModules.length >= 2);
  const custom = result.promptModules.find((module) => module.id === 'st-preset-custom');
  assert.ok(custom);
  // 占位符在组装期展开为本系统内容层
  const expanded = expandMacros(custom.content, {
    characterCard: { name: '临渊', description: '深渊测绘师。' },
    persona: { description: '档案馆研究员。', enabled: true }
  });
  assert.equal(expanded, '角色：深渊测绘师。\n人设：档案馆研究员。');
});

test('phase 1 regression: standalone world book import keeps trigger modes and logic modifiers', () => {
  const book = {
    name: '回归世界书',
    entries: [
      { keys: ['灯塔'], content: '百年灯塔。', enabled: true, position: 'before_char' },
      { keys: ['风暴'], secondary_keys: ['海'], content: '风暴将至。', enabled: true, selectLogic: 'AND' }
    ]
  };
  const entries = importWorldBookFromPayload({
    fileName: 'regression-book.json',
    mimeType: 'application/json',
    data: JSON.stringify(book)
  });
  assert.ok(entries.length === 2, `应导入 2 条，实际 ${entries.length}`);
  const beforeEntry = entries.find((entry) => (entry.keywords || []).includes('灯塔'));
  assert.ok(beforeEntry.position === 'before_char' || beforeEntry.position === 'before_character');
  const selective = entries.find((entry) => (entry.keywords || []).includes('风暴'));
  assert.ok(
    selective.secondaryKeywords?.length || selective.matchMode === 'selective',
    '选择性触发字段应保留'
  );
});

test('phase 1 regression: identity and variable macros still expand after phase 1 changes', () => {
  const context = {
    user: '林青阳',
    characterCard: { name: '沈观澜', description: '玄水阁阁主。', personality: '外冷内热。' },
    persona: { name: '林青阳', description: '江南剑客。', enabled: true }
  };
  assert.equal(expandMacros('{{char}}', context), '沈观澜');
  assert.equal(expandMacros('{{user}}', context), '林青阳');
  assert.equal(expandMacros('{{charDefinition}}', context), '玄水阁阁主。');
  assert.equal(expandMacros('{{personaDescription}}', context), '江南剑客。');
});
