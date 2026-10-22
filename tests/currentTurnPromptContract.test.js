import test from 'node:test';
import assert from 'node:assert/strict';
import { expandMacros } from '../server/agent/macroEngine.js';
import { assemblePrompt } from '../server/agent/promptAssembler.js';

const messages = [
  { role: 'user', content: '将货箱搬到门外。' },
  { role: 'assistant', content: '货箱已搬到门外。' },
  { role: 'user', content: '不应出现的旧分支', excluded: true }
];

test('both last-user aliases prefer the pending turn and fall back to visible history for continuation', () => {
  for (const macro of ['lastUserMessage', 'last_user_message']) {
    assert.equal(expandMacros(`{{${macro}}}`, { messages, userMessage: '只观察门外的货箱。' }), '只观察门外的货箱。');
    for (const userMessage of [undefined, '', '  ']) {
      assert.equal(expandMacros(`{{${macro}}}`, { messages, userMessage }), '将货箱搬到门外。');
    }
    assert.equal(expandMacros(`{{${macro}}}`, { messages: [], userMessage: '第一条输入' }), '第一条输入');
  }
});

for (const promptExecutionMode of ['faithful', 'enhanced']) {
  test(`${promptExecutionMode}: imported prompt sees the current turn without rewriting committed history or source modules`, () => {
    const source = {
      characterCard: { name: '港口剧本', sourceSpec: 'chara_card_v3' },
      promptModules: [
        { id: 'input', enabled: true, content: '用户输入内容：{{lastUserMessage}}' },
        { id: 'options', enabled: true, content: '正文后提供5项备选行动，用<options>包裹。' }
      ],
      messages, userMessage: '我只观察，不采取新行动。',
      worldBook: [], memory: {}, options: { maxPromptTokens: 16000, promptExecutionMode }
    };
    const before = structuredClone(source);
    const result = assemblePrompt(source);
    const text = result.messages.map(m => m.content).join('\n');
    assert.match(text, /用户输入内容：我只观察，不采取新行动。/);
    assert.doesNotMatch(text, /用户输入内容：将货箱搬到门外/);
    assert.ok(result.messages.some(m => m.role === 'user' && m.content === messages[0].content));
    assert.equal(result.messages.findLast(m => m.role === 'user').content, source.userMessage);
    assert.match(text, /正文后提供5项备选行动/);
    assert.match(text, /行动范围和禁止事项优先于预设的通用代写许可/);
    assert.match(text, /选项是待玩家选择的可能行动，不表示已经执行/);
    assert.deepEqual(source, before);
  });
}

test('a user input referencing the previous user message does not expand into itself in either location', () => {
  const result = assemblePrompt({
    characterCard: { name: '港口剧本', sourceSpec: 'chara_card_v3' },
    promptModules: [{ id: 'input', enabled: true, content: '用户输入内容：{{lastUserMessage}}' }],
    messages, userMessage: '复述上个请求：{{last_user_message}}',
    worldBook: [], memory: {}, options: { maxPromptTokens: 16000 }
  });
  assert.equal(result.messages.findLast(m => m.role === 'user').content, '复述上个请求：将货箱搬到门外。');
  assert.match(result.messages.map(m => m.content).join('\n'), /用户输入内容：复述上个请求：将货箱搬到门外。/);
  assert.doesNotMatch(result.messages.map(m => m.content).join('\n'), /\{\{last_?user/i);
});
