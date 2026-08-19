import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMacroVariableWrites } from '../server/compat/lifecyclePolicy.js';
import { applyMvuPatch } from '../server/compat/lightFrontendRuntime.js';

test('parseMacroVariableWrites parses {{setvar::key::value}}', () => {
  const ops = parseMacroVariableWrites('{{setvar::mood::angry}}');
  assert.equal(ops.length, 1);
  assert.deepEqual(ops[0].op, 'set');
  assert.equal(ops[0].path, 'variables.mood');
  assert.equal(ops[0].value, 'angry');
});

test('parseMacroVariableWrites parses {{addvar::key::value}}', () => {
  const ops = parseMacroVariableWrites('{{addvar::inventory::gold}}');
  assert.equal(ops.length, 1);
  assert.equal(ops[0].op, 'append');
  assert.equal(ops[0].path, 'variables.inventory');
  assert.equal(ops[0].value, 'gold');
});

test('parseMacroVariableWrites parses {{incvar::key}}', () => {
  const ops = parseMacroVariableWrites('{{incvar::count}}');
  assert.equal(ops.length, 1);
  assert.equal(ops[0].op, 'increment');
  assert.equal(ops[0].path, 'variables.count');
  assert.equal(ops[0].value, 1);
});

test('parseMacroVariableWrites parses {{decvar::key}}', () => {
  const ops = parseMacroVariableWrites('{{decvar::health}}');
  assert.equal(ops.length, 1);
  assert.equal(ops[0].op, 'increment');
  assert.equal(ops[0].path, 'variables.health');
  assert.equal(ops[0].value, -1);
});

test('parseMacroVariableWrites parses numeric values', () => {
  const ops = parseMacroVariableWrites('{{setvar::level::5}}');
  assert.equal(ops[0].value, 5);
});

test('parseMacroVariableWrites parses boolean values', () => {
  const ops = parseMacroVariableWrites('{{setvar::flag::true}}');
  assert.equal(ops[0].value, true);
});

test('parseMacroVariableWrites parses quoted strings', () => {
  const ops = parseMacroVariableWrites("{{setvar::name::'白鹿原'}}");
  assert.equal(ops[0].value, '白鹿原');
});

test('parseMacroVariableWrites handles multiple macros in one text', () => {
  const ops = parseMacroVariableWrites('{{setvar::a::1}}{{addvar::b::2}}{{incvar::c}}');
  assert.equal(ops.length, 3);
  assert.equal(ops[0].op, 'set');
  assert.equal(ops[1].op, 'append');
  assert.equal(ops[2].op, 'increment');
});

test('parseMacroVariableWrites ignores non-macro text', () => {
  const ops = parseMacroVariableWrites('普通文本 {{getvar::foo}} 不含写入宏');
  assert.equal(ops.length, 0);
});

test('applyMvuPatch append op extends arrays', () => {
  const current = { enabled: true, values: { chat: { variables: { items: ['sword'] } }, global: {} }, revision: 0 };
  const result = applyMvuPatch(current, [{ op: 'append', path: 'variables.items', value: ['shield'] }]);
  assert.deepEqual(result.values.chat.variables.items, ['sword', 'shield']);
});

test('applyMvuPatch append op concatenates strings', () => {
  const current = { enabled: true, values: { chat: { variables: { log: 'start' } }, global: {} }, revision: 0 };
  const result = applyMvuPatch(current, [{ op: 'append', path: 'variables.log', value: ' end' }]);
  assert.equal(result.values.chat.variables.log, 'start end');
});

test('applyMvuPatch append op adds numbers', () => {
  const current = { enabled: true, values: { chat: { variables: { score: 10 } }, global: {} }, revision: 0 };
  const result = applyMvuPatch(current, [{ op: 'append', path: 'variables.score', value: 5 }]);
  assert.equal(result.values.chat.variables.score, 15);
});

test('applyMvuPatch append op creates new path when missing', () => {
  const current = { enabled: true, values: { chat: {}, global: {} }, revision: 0 };
  const result = applyMvuPatch(current, [{ op: 'append', path: 'variables.newKey', value: 'first' }]);
  assert.equal(result.values.chat.variables.newKey, 'first');
});

test('MVU patch allows stat_data path prefix', () => {
  const current = { enabled: true, values: { chat: {}, global: {} }, revision: 0 };
  const result = applyMvuPatch(current, [{ op: 'set', path: 'stat_data.系统.城镇', value: '白鹿原' }]);
  assert.equal(result.values.chat.stat_data.系统.城镇, '白鹿原');
});
