import test from 'node:test';
import assert from 'node:assert/strict';

import {
  enforcePromptMessageBudget,
  selectRecentMessagesForPrompt
} from '../server/agent/promptBudget.js';

test('recent history keeps user action and assistant result as atomic prompt turns', () => {
  const selected = selectRecentMessagesForPrompt([
    { id: 'u1', role: 'user', content: '我敲了敲青铜门。' },
    { id: 'a1', role: 'assistant', content: '门外传来地伶的脚步声。' },
    { id: 'u2', role: 'user', content: '我问她是否还在。' },
    { id: 'a2', role: 'assistant', content: '地伶隔门回答，并等你继续说。' },
    { id: 'u3', role: 'user', kind: 'continuation', content: '继续推进' },
    { id: 'a3', role: 'assistant', content: '门内外保持安静，没有替你回答。' }
  ], { maxMessages: 3, minCompleteTurns: 1 });

  const turns = new Map();
  selected.messages.forEach((message) => {
    if (!turns.has(message._promptTurnId)) turns.set(message._promptTurnId, []);
    turns.get(message._promptTurnId).push(message.role);
  });
  assert.ok([...turns.values()].every((roles) => roles.join(',') === 'user,assistant'));
  assert.ok(selected.messages.some((message) => message.content.includes('不代替玩家作出重大决定')));
  assert.ok(selected.messages.some((message) => message.content.includes('我问她是否还在')));
});

test('final prompt budget removes a history turn as a pair instead of orphaning one side', () => {
  const history = [
    { role: 'user', content: '较早行动'.repeat(100), _promptKind: 'history', _promptTurnId: 'turn-1' },
    { role: 'assistant', content: '较早结果'.repeat(100), _promptKind: 'history', _promptTurnId: 'turn-1' }
  ];
  const result = enforcePromptMessageBudget([
    { role: 'system', content: '核心规则', _promptKind: 'core-system' },
    ...history,
    { role: 'user', content: '当前行动', _promptKind: 'current-user' }
  ], { maxTokens: 40 });

  assert.equal(result.messages.some((message) => message.content.includes('较早行动')), false);
  assert.equal(result.messages.some((message) => message.content.includes('较早结果')), false);
});

test('final prompt budget removes a coherence-sensitive community preset as one atomic group', () => {
  const result = enforcePromptMessageBudget([
    { role: 'system', content: '核心规则。', _promptKind: 'core-system' },
    {
      role: 'system',
      content: '变量初始化约束。'.repeat(80),
      _promptKind: 'preset-critical',
      _promptModuleId: 'preset-setup',
      _promptIntegrityGroup: 'community-preset:atomic'
    },
    {
      role: 'system',
      content: '变量输出协议。'.repeat(80),
      _promptKind: 'preset-critical',
      _promptModuleId: 'preset-output',
      _promptIntegrityGroup: 'community-preset:atomic'
    },
    { role: 'user', content: '当前行动。', _promptKind: 'current-user' }
  ], { maxTokens: 80 });

  assert.equal(result.messages.some((message) => /变量初始化约束/.test(message.content)), false);
  assert.equal(result.messages.some((message) => /变量输出协议/.test(message.content)), false);
  assert.deepEqual(
    result.report.omittedMessageInspection.map((message) => message.moduleId).sort(),
    ['preset-output', 'preset-setup']
  );
  assert.ok(result.report.omittedMessageInspection.every((message) => (
    message.status === 'evicted-by-budget' && /完整性保护/.test(message.evictionReason)
  )));
});

test('budget-visible dynamic context is evicted before protected user intent', () => {
  const result = enforcePromptMessageBudget([
    { role: 'system', content: '核心规则。', _promptKind: 'core-system' },
    { role: 'system', content: '动态摘要。'.repeat(120), _promptKind: 'dynamic-context-tail' },
    { role: 'user', content: '我先听门外的人说完。', _promptKind: 'current-user' }
  ], { maxTokens: 80 });

  assert.equal(result.messages.some((message) => /动态摘要/.test(message.content)), false);
  assert.equal(result.messages.at(-1).content, '我先听门外的人说完。');
  assert.deepEqual(result.report.omittedMessageInspection.map((message) => ({
    kind: message.kind,
    status: message.status
  })), [{ kind: 'dynamic-context-tail', status: 'evicted-by-budget' }]);
});
