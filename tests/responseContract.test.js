import test from 'node:test';
import assert from 'node:assert/strict';
import { buildResponseContractPrompt, normalizeResponseLengthMode } from '../server/agent/responseContract.js';

test('invalid length defaults to balanced', () => {
  assert.equal(normalizeResponseLengthMode('unexpected'), 'balanced');
  assert.match(buildResponseContractPrompt('unexpected'), /1200-2000 个中文字符/);
});
for (const generationType of ['normal', 'continue']) {
  test(`${generationType}: DM length choices differ and preserve player agency`, () => {
    const ranges = ['600-1000', '1200-2000', '2000-3200'];
    ['compact', 'balanced', 'long'].forEach((mode, i) => {
      const prompt = buildResponseContractPrompt(mode, { generationType, roleplayMode: 'dm' });
      assert.ok(prompt.includes(ranges[i]));
      assert.match(prompt, /不得替玩家决定重大选择/);
      assert.match(prompt, /字数是参考而非下限/);
      assert.match(prompt, /以用户要求为准/);
      assert.doesNotMatch(prompt, /未达目标下限|只完成 1 个世界反馈节拍/);
    });
  });
}
test('director long scenes retain source style and natural stopping points', () => {
  const prompt = buildResponseContractPrompt('long', { roleplayMode: 'director' });
  assert.match(prompt, /3-5 个相互承接的场景节拍/);
  assert.match(prompt, /专属文风与格式仍然有效/);
  assert.match(prompt, /应及时收束/);
});
