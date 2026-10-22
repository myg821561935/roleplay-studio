import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandMacros } from '../server/agent/macroEngine.js';
import { probePromptMacroSemantics } from '../scripts/probe-prompt-macro-semantics.mjs';

test('independent nested assignment, comment and variable-template regressions pass', () => {
  for (const probe of probePromptMacroSemantics()) assert.equal(probe.status, 'passed', probe.id);
});

test('nested writes run once in source order and identical siblings both run', () => {
  const context = { allowVariableWrites: true, promptVariables: { count: 0 } };
  assert.equal(expandMacros('{{setvar::voice::{{incvar::count}}第{{getvar::count}}次}}{{getvar::voice}}{{incvar::count}}{{incvar::count}}', context), '第1次');
  assert.deepEqual(context.promptVariables, { count: 3, voice: '第1次' });
});

test('conditional branches are lazy, including nested comparisons and separators', () => {
  const context = { allowVariableWrites: true, promptVariables: { count: 0 } };
  assert.equal(expandMacros('{{if::{{eq::a::a}}::{{incvar::count}}是::{{setvar::count::99}}否}}', context), '是');
  assert.equal(context.promptVariables.count, 1);
  assert.equal(expandMacros('{{if::false::{{incvar::count}}否::是}}', context), '是');
  assert.equal(context.promptVariables.count, 1);
});

test('comments and unfinished comments never evaluate child macros', () => {
  const context = { allowVariableWrites: true, promptVariables: { count: 0 } };
  assert.equal(expandMacros('前{{// {{incvar::count}} {{user}} }}后', context), '前后');
  assert.equal(expandMacros('前{{!-- {{incvar::count}} --}}后', context), '前后');
  assert.equal(expandMacros('前{{// {{incvar::count}}', context), '前');
  assert.equal(context.promptVariables.count, 0);
  assert.equal(expandMacros('前{{setvar::x::{{incvar::count}}', context), '前{{setvar::x::{{incvar::count}}');
  assert.equal(context.promptVariables.count, 0);
});

test('nested expansion preserves write permission and unknown macros', () => {
  const context = { user: '玩家', promptVariables: { count: 0 } };
  assert.equal(expandMacros('{{setvar::count::{{user}}}}', context), '{{setvar::count::{{user}}}}');
  assert.equal(context.promptVariables.count, 0);
  assert.equal(expandMacros('{{unknown::value}}', context), '{{unknown::value}}');
});

test('recursive variable references terminate without replaying writes', () => {
  const context = { allowVariableWrites: true, promptVariables: { count: 0, a: '{{incvar::count}}A{{getvar::b}}', b: 'B{{getvar::a}}' } };
  assert.equal(expandMacros('{{getvar::a}}', context), 'AB{{getvar::a}}');
  assert.equal(context.promptVariables.count, 1);
});

test('macro expansion limits fail explicitly for excessive nesting, size and work', () => {
  const context = { promptVariables: {} };
  for (let i = 0; i < 30; i++) context.promptVariables['v' + i] = '{{getvar::v' + (i + 1) + '}}';
  const limit = { code: 'MACRO_EXPANSION_LIMIT' };
  assert.throws(() => expandMacros('{{getvar::v0}}', context), limit);
  assert.throws(() => expandMacros('a'.repeat(1_000_001)), limit);
  assert.throws(() => expandMacros('{{user}}'.repeat(10_001)), limit);
});

test('long prompt text retains the tail beyond the display renderer limit', () => {
  const prefix = 'a'.repeat(120_001);
  assert.equal(expandMacros(prefix + '{{user}}', { user: '尾部' }), prefix + '尾部');
});

test('recursive named templates share the same cycle guard', () => {
  const context = { templates: [{ name: 'a', content: 'A{{template:b}}' }, { name: 'b', content: 'B{{template:a}}' }] };
  assert.equal(expandMacros('{{template:a}}', context), 'AB{{template:a}}');
});

test('named templates retain safe expression rendering during nested expansion', () => {
  const context = { user: '玩家', lightFrontendState: { values: { voice: '温和' } }, templates: [{ name: 'voice', content: '<%= getvar("voice") %>地向{{user}}问好' }] };
  assert.equal(expandMacros('{{template:voice}}', context), '温和地向玩家问好');
});
