import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveNarrationPerspective, renderNarrationPerspective, inspectNarrationDrift } from '../server/agent/narrationPerspective.js';
import { assemblePrompt } from '../server/agent/promptAssembler.js';
test('history drift is advisory and excludes quoted dialogue, user messages and hidden analysis', () => {
  const third = { perspective: 'third' };
  const messages = [{ role: 'assistant', content: '“你来了。”他点头。' }, { role: 'assistant', content: '<thinking>你应当回应</thinking>「你是谁？」' }, { role: 'user', content: '你站在门外。' }];
  assert.equal(inspectNarrationDrift(third, messages).status, 'no-signal');
  const before = JSON.stringify(messages);
  assert.equal(inspectNarrationDrift(third, [...messages, {role:'assistant',content:'你站在门外。'}, {role:'assistant',content:'你走入庭院。'}]).matchedMessages, 2);
  assert.equal(JSON.stringify(messages), before);
  assert.equal(inspectNarrationDrift({perspective:null}, messages).status, 'not-assessed');
});
test('perspective uses enabled explicit modules and declines ambiguous sources', () => {
  const third={id:'third',title:'🎦 第三人称叙事',content:'用主角名字叙述。'};
  assert.equal(resolveNarrationPerspective([third,{title:'第一人称',content:'我',enabled:false}]).perspective,'third');
  assert.equal(resolveNarrationPerspective([third,{title:'第一人称',content:'我'}]).status,'conflict');
  assert.equal(resolveNarrationPerspective([{title:'讨论',content:'不要使用第三人称'}]).perspective,null);
  assert.match(renderNarrationPerspective(resolveNarrationPerspective([third]),'刘一'), /刘一/);
  assert.match(renderNarrationPerspective(resolveNarrationPerspective([third]),'用户'), /主角原名/);
  assert.equal(renderNarrationPerspective(resolveNarrationPerspective([])), '');
});
test('enhanced community card keeps examples, long source tails and explicit perspective', () => {
  const result=assemblePrompt({characterCard:{name:'测试角色',sourceSpec:'chara_card_v3',description:'细节'.repeat(1800)+'独立尾部约束',exampleDialog:['原作示例尾部']},promptModules:[{id:'third',title:'第三人称叙事',content:'必须使用第三人称叙事。'}],worldBook:[],memory:{memoryCards:[]},messages:[],userMessage:'我问路。',options:{promptExecutionMode:'enhanced',maxPromptTokens:32000}});
  assert.equal(result.sections.preserveSources,true);
  assert.equal(result.sections.narrationPerspective.perspective,'third');
  assert.match(result.messages.map(m=>m.content).join('\n'), /独立尾部约束/);
  assert.match(result.messages.map(m=>m.content).join('\n'), /原作示例尾部/);
  assert.match(result.messages.at(-2).content,/正文旁白采用第三人称/);
});
