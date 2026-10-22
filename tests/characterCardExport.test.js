import test from 'node:test';
import assert from 'node:assert/strict';
import { exportCharacterCardToV3 } from '../server/character/characterCardExport.js';
import { importCharacterCardFromPayload } from '../server/character/characterCardImport.js';

test('exportCharacterCardToV3 generates valid V3 card with coreMemory extensions that imports symmetrically', () => {
  const card = {
    name: '李逍遥',
    description: '盛渔村的客栈小厮，心怀大侠梦',
    personality: '机灵跳脱，重情重义',
    scenario: '仙灵岛初遇赵灵儿',
    firstMessage: '小二，来壶好酒！',
    systemPrompt: '始终以潇洒不羁的少年剑客口吻发言',
    tags: ['仙剑', '主角', '少年剑客']
  };

  const coreMemory = {
    personaView: '将赵灵儿视为一生挚爱与守护之人',
    activeCommitments: ['护送灵儿前往苗疆寻找娘亲'],
    coreDirectives: ['成为天下第一大侠']
  };

  const foreshadowing = [
    { id: 'hook-1', content: '水灵珠的下落', status: 'open' }
  ];

  const worldBook = [
    {
      title: '御剑术',
      keys: ['御剑术', '蜀山剑法'],
      content: '蜀山派入门御剑口诀',
      constant: true,
      position: 1
    }
  ];

  const exported = exportCharacterCardToV3(card, { worldBook, coreMemory, foreshadowing });

  // 1. 验证 V3 规范结构
  assert.equal(exported.spec, 'chara_card_v3');
  assert.equal(exported.spec_version, '3.0');
  assert.equal(exported.data.name, '李逍遥');
  assert.equal(exported.data.first_mes, '小二，来壶好酒！');
  assert.deepEqual(exported.data.extensions.local_roleplay_agent.coreMemory, coreMemory);
  assert.deepEqual(exported.data.extensions.local_roleplay_agent.foreshadowing, foreshadowing);
  assert.equal(exported.data.character_book.entries.length, 1);
  assert.equal(exported.data.character_book.entries[0].comment, '御剑术');

  // 2. 验证反向导入（导入器无缝兼容导出产物）
  const imported = importCharacterCardFromPayload({
    data: JSON.stringify(exported)
  });

  assert.equal(imported.characterCard.name, '李逍遥');
  assert.equal(imported.characterCard.firstMessage, '小二，来壶好酒！');
  assert.equal(imported.worldBook.length, 1);
  assert.equal(imported.worldBook[0].title, '御剑术');
  assert.equal(imported.worldBook[0].constant, true);
});
