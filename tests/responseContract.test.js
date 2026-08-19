import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildResponseContractPrompt,
  normalizeResponseLengthMode
} from '../server/agent/responseContract.js';

test('response contract defaults to one complete DM feedback beat', () => {
  const prompt = buildResponseContractPrompt('unexpected');

  assert.equal(normalizeResponseLengthMode('unexpected'), 'balanced');
  assert.match(prompt, /标准推进/);
  assert.match(prompt, /900-1400 个中文字符/);
  assert.match(prompt, /不要停在动作刚开始/);
  assert.match(prompt, /只完成 1 个世界反馈节拍/);
  assert.match(prompt, /把话语权交还玩家/);
});

test('director mode can still request a long scene without taking over player decisions', () => {
  const prompt = buildResponseContractPrompt('long', { roleplayMode: 'director' });

  assert.match(prompt, /2000-3200 个中文字符/);
  assert.match(prompt, /3-5 个相互承接的场景节拍/);
  assert.match(prompt, /不得替玩家决定重大选择/);
});

test('dm continuation overrides long-form presets with exactly one feedback beat', () => {
  const prompt = buildResponseContractPrompt('long', {
    generationType: 'continue',
    roleplayMode: 'dm'
  });

  assert.match(prompt, /900-1400 个中文字符/);
  assert.match(prompt, /只完成 1 个世界反馈节拍/);
  assert.match(prompt, /未达目标下限/);
  assert.doesNotMatch(prompt, /3-5 个相互承接的场景节拍/);
});

test('normal DM turns also stop after one beat instead of opening a second scene', () => {
  const prompt = buildResponseContractPrompt('long', {
    generationType: 'normal',
    roleplayMode: 'dm'
  });

  assert.match(prompt, /900-1400 个中文字符/);
  assert.match(prompt, /只完成 1 个世界反馈节拍/);
  assert.match(prompt, /不得为凑篇幅凭空新增人物、物件、世界规则或神秘现象/);
  assert.doesNotMatch(prompt, /3-5 个相互承接的场景节拍/);
});
