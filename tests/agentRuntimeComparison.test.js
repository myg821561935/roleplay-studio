import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { compareRuntimes } from '../scripts/compare-agent-runtimes.mjs';

test('comparison keeps independent histories and identical sampling configuration', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-comparison-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const messages = [{ role: 'system', content: '原卡设定' }, { role: 'user', content: '开场' }];
  const provider = { id: 'test', model: 'test', temperature: 0.9, apiKey: 'test-secret' };
  const seen = [];
  const result = await compareRuntimes({ messages, provider, outputDir: path.join(dir, 'run'), followUps: ['观察', '回应'],
    providerClient: { stream: async ({ messages: input, provider: actual, onToken }) => {
      assert.deepEqual(actual, provider);
      seen.push(structuredClone(input));
      const content = `独立回复${seen.length}`;
      await onToken(content);
      return { content, raw: { finishReason: 'stop' } };
    } } });
  assert.equal(result.runs.length, 6);
  assert.equal(result.status, 'completed');
  assert.ok(result.runs.every(r => r.finishReason === 'stop'));
  assert.deepEqual(seen[0], messages); assert.deepEqual(seen[1], messages);
  for (const input of seen.slice(2)) {
    assert.equal(input.length, input.at(-1).content === '观察' ? 4 : 6);
    assert.equal(input.filter(m => m.role === 'assistant').length, input.at(-1).content === '观察' ? 1 : 2);
  }
  assert.equal(messages.length, 2);
  assert.ok(result.runs.some(r => r.runtime.kind === 'pi'));
  for (const file of await fs.readdir(path.join(dir, 'run'))) assert.equal((await fs.readFile(path.join(dir, 'run', file), 'utf8')).includes('test-secret'), false);
  await assert.rejects(compareRuntimes({ messages, provider, outputDir: path.join(dir, 'run'), followUps: [] }), { code: 'EEXIST' });
});

test('failed comparison retains completed artifacts without exposing provider errors', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-comparison-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const outputDir = path.join(dir, 'run'); let calls = 0;
  await assert.rejects(compareRuntimes({ messages: [{ role: 'user', content: 'hi' }], provider: { model: 'test' }, outputDir, followUps: [],
    providerClient: { stream: async () => {
      if (++calls === 1) return { content: 'reply', raw: { choices: [{ finish_reason: 'stop' }] } };
      throw new Error('private-provider-detail');
    } } }), /stopped after 1 calls/);
  const manifest = await fs.readFile(path.join(outputDir, 'manifest.json'), 'utf8');
  assert.equal(JSON.parse(manifest).status, 'failed');
  assert.equal(manifest.includes('private-provider-detail'), false);
});
test('reassembled comparison passes only branch-local story history into every new prompt', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-reassemble-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const histories = [], requests = [];
  const result = await compareRuntimes({ messages: [{ role: 'user', content: '开场' }], provider: { model: 'test' }, outputDir: path.join(dir, 'run'), followUps: ['继续'],
    assembleTurn: ({ history, userMessage }) => {
      histories.push(structuredClone(history));
      return [{ role: 'system', content: history.length ? '本轮人物档案' : '开场设定' }, ...history, { role: 'user', content: userMessage }];
    }, providerClient: { stream: async ({ messages }) => {
      requests.push(structuredClone(messages));
      return { content: `独立回复${requests.length}`, raw: { finishReason: 'stop' } };
    } } });
  assert.equal(result.contextMode, 'reassembled-every-turn');
  assert.deepEqual(histories.map(h => h.length), [0, 0, 2, 2]);
  assert.equal(new Set(histories.slice(2).map(h => h[1].content)).size, 2);
  assert.ok(requests.slice(2).every(r => r[0].content === '本轮人物档案' && r.length === 4));
});
