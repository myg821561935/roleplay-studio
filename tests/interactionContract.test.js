import test from 'node:test';
import assert from 'node:assert/strict';

import {
  analyzePromptInteractionSemantics,
  buildCompactCastIndex,
  buildInteractionConflictReport,
  buildInteractionControlPrompt,
  findLatestMeaningfulUserMessage,
  isContinuationSignal
} from '../server/agent/interactionContract.js';

test('detects community preset control and dialogue semantics', () => {
  const modules = [
    { id: 'talk-over', title: '抢话', enabled: true, content: '描写用户的动作和对白。' },
    { id: 'agency', title: '别抢话', enabled: true, content: '不要替玩家决定行动和台词。' },
    { id: 'dialogue', title: '对话增多', enabled: true, content: '提高 NPC 对白比例。' }
  ];
  const semantics = analyzePromptInteractionSemantics(modules);
  const dm = buildInteractionConflictReport({ roleplayMode: 'dm', promptModules: modules });

  assert.equal(semantics.requestsPlayerWriting, true);
  assert.equal(semantics.protectsPlayerAgency, true);
  assert.equal(semantics.requestsMoreDialogue, true);
  assert.equal(semantics.hasInternalControlConflict, true);
  assert.ok(dm.conflicts.some((item) => item.type === 'preset-player-writing-conflict'));
  assert.ok(dm.conflicts.some((item) => item.type === 'preset-internal-control-conflict'));
});

test('does not misclassify a no-talk-over preset as a player-writing request', () => {
  const semantics = analyzePromptInteractionSemantics([
    { id: 'agency-only', title: '别抢话', content: '不要替玩家决定行动和台词。' }
  ]);

  assert.equal(semantics.protectsPlayerAgency, true);
  assert.equal(semantics.requestsPlayerWriting, false);
  assert.equal(semantics.hasInternalControlConflict, false);
});

test('continuation signals do not replace the latest visible player utterance', () => {
  const messages = [
    { role: 'user', content: '我把信递给她，等她回答。' },
    { role: 'assistant', content: '她拆开了信。' },
    { role: 'user', content: '（请继续推进剧情）', hiddenFromChat: true },
    { role: 'assistant', content: '她看完第一行。' }
  ];
  const result = buildInteractionControlPrompt({
    roleplayMode: 'dm',
    generationType: 'continue',
    promptModules: [{ id: 'more-talk', title: '对话增多', content: '增加对白。' }],
    messages
  });

  assert.equal(isContinuationSignal('（请继续推进剧情）'), true);
  assert.equal(findLatestMeaningfulUserMessage(messages)?.content, '我把信递给她，等她回答。');
  assert.match(result.prompt, /最近真实玩家输入：我把信递给她，等她回答/);
  assert.match(result.prompt, /在需要玩家作决定时停止/);
  assert.match(result.prompt, /把话语权交还玩家/);
  assert.match(result.prompt, /对白增多不等于替玩家说话/);
});

test('DM continuation cannot silently spend a second player action', () => {
  const result = buildInteractionControlPrompt({
    roleplayMode: 'dm',
    generationType: 'continue',
    messages: [
      { role: 'user', content: '我把陶片扔进裂缝，留在原地看它会发生什么。' },
      { role: 'assistant', content: '陶片落下后，门内亮起两条不同的石阶。' },
      { role: 'user', content: '继续', hiddenFromChat: true }
    ]
  });

  assert.match(result.prompt, /最近真实玩家输入：我把陶片扔进裂缝，留在原地看它会发生什么/);
  assert.match(result.prompt, /不授权主角移动、进入新路线、触碰物件、开门、攻击、回答/);
  assert.match(result.prompt, /主角必须停在原有控制边界内/);
});

test('only director mode permits bounded player coauthoring', () => {
  const playerWriting = [{ id: 'talk-over', title: '抢话', content: '替用户补写动作和台词。' }];
  const dm = buildInteractionControlPrompt({ roleplayMode: 'dm', promptModules: playerWriting });
  const director = buildInteractionControlPrompt({ roleplayMode: 'director', promptModules: playerWriting });

  assert.match(dm.prompt, /不得替玩家新增动作、对白、内心、立场或决定/);
  assert.match(dm.prompt, /因当前模式冲突而不执行代写部分/);
  assert.match(director.prompt, /可立即撤回的低风险动作和短对白/);
  assert.match(director.prompt, /仅在上述低风险共创边界内生效/);
});

test('builds a compact dormant cast index while leaving detailed lore to worldbook triggers', () => {
  const result = buildCompactCastIndex({
    characterCard: { name: '绝世仙宗', enabled: true },
    contentMode: { kind: 'scenario-container' },
    worldBook: [
      { title: '丝苻_基础信息', content: '身份：宗门长老\n性格：克制。', enabled: true },
      { title: '竹青_人物档案', content: '职业：剑修\n秘密：不可公开。', enabled: true },
      { title: '宗门规则', content: '宗门不可私斗。', enabled: true }
    ]
  });

  assert.deepEqual(result.entries.map((entry) => entry.name), ['丝苻', '竹青']);
  assert.match(result.prompt, /丝苻：宗门长老/);
  assert.match(result.prompt, /竹青：剑修/);
  assert.doesNotMatch(result.prompt, /秘密：不可公开/);
  assert.match(result.prompt, /详细外貌、性格、关系、秘密和语言风格仍必须.*触发/);
});
