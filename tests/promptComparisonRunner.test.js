import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { planComparison, runComparison } from '../scripts/run-roleplay-comparison.mjs';
const provider = { kind: 'openai-compatible', baseUrl: 'https://example.test/v1', apiKey: 'private-test-key', model: 'test', temperature: 0.7, topP: 0.8, seed: 42 };
const bundle = { variants: ['faithful', 'enhanced'].map(mode => ({ mode, status: 'ready', messages: [{ role: 'user', content: mode }] })) };
test('truncated generations are retained but excluded from complete-response scoring', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comparison-truncated-'));
  const outputDir = path.join(root, 'result');
  try {
    const manifest = await runComparison({ bundle, provider, repeats: 1, outputDir, fetchImpl: async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '未完成的正文' } }] })) });
    assert.equal(manifest.completed, 2);
    assert.equal(manifest.truncatedOutputs, 2);
    const rows = JSON.parse(await fs.readFile(path.join(outputDir, 'blind.json')));
    assert.ok(rows.every(row => row.eligibleForScoring === false && row.finishReason === 'length'));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
test('comparison transmits identical explicit sampling parameters and validates before any call', () => {
  const plan = planComparison(bundle, provider);
  assert.equal(plan.parameters.top_p, 0.8); assert.equal(plan.parameters.seed, 42);
  assert.equal(plan.hasTavernReference, false);
  assert.throws(() => planComparison({ variants: [bundle.variants[0], { mode: 'enhanced', status: 'blocked' }] }, provider));
  assert.throws(() => planComparison(bundle, { ...provider, topP: 2 }));
  assert.throws(() => planComparison(bundle, provider, 100));
});
test('comparison stores blind outputs separately from origin and never writes authorization headers', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comparison-test-'));
  const outputDir = path.join(root, 'result'); let calls = 0;
  try {
    const result = await runComparison({ bundle, provider, repeats: 2, outputDir, fetchImpl: async (_url, init) => {
      calls++; assert.equal(init.headers.authorization, 'Bearer private-test-key');
      assert.equal(JSON.parse(init.body).top_p, 0.8);
      return new Response(JSON.stringify({ choices: [{ message: { content: '对方停下脚步。' } }] }));
    } });
    assert.equal(result.status, 'completed'); assert.equal(calls, 4);
    const blind = JSON.parse(await fs.readFile(path.join(outputDir, 'blind.json')));
    assert.equal(blind.length, 4); assert.equal(blind[0].mode, undefined);
    const files = await fs.readdir(outputDir);
    for (const file of files) assert.doesNotMatch(await fs.readFile(path.join(outputDir, file), 'utf8'), /private-test-key|authorization/);
    await assert.rejects(runComparison({ bundle, provider, outputDir, fetchImpl: () => { throw new Error('must not call'); } }), /EEXIST/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
test('comparison preserves completed samples and marks interrupted experiment failed', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comparison-test-'));
  const outputDir = path.join(root, 'result'); let calls = 0;
  try {
    await assert.rejects(runComparison({ bundle, provider, repeats: 1, outputDir, fetchImpl: async () => {
      if (++calls > 1) throw new Error('network failure');
      return new Response(JSON.stringify({ choices: [{ message: { content: '雨声渐近。' } }] }));
    } }), /stopped after 1/);
    const manifest = JSON.parse(await fs.readFile(path.join(outputDir, 'manifest.json')));
    assert.equal(manifest.status, 'failed'); assert.equal(manifest.completed, 1);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('configured optional sampling survives save and invalid values do not overwrite configuration', async () => {
  const { ConfigService } = await import('../server/config/configService.js');
  const { JsonStore } = await import('../server/lib/jsonStore.js');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sampling-config-'));
  try {
    const config = new ConfigService(new JsonStore(root));
    await config.saveProviders({ providers: [{ ...provider, id: 'test' }] });
    assert.equal((await config.getAll()).providers.providers[0].topP, 0.8);
    await assert.rejects(config.saveProviders({ providers: [{ ...provider, topP: 'bad' }] }), /Invalid provider topP/);
    assert.equal((await config.getAll()).providers.providers[0].topP, 0.8);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('content-triggered reasoning changes fail the same-parameter preflight', () => {
  const altered = { variants: bundle.variants.map((v, i) => ({ ...v, messages: [{ role: 'system', content: i ? '正文创作必须在思考阶段完全结束' : '普通叙述' }] })) };
  assert.throws(() => planComparison(altered, { ...provider, model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com', reasoningMode: 'auto' }), /parameters differ/);
  assert.doesNotThrow(() => planComparison(altered, { ...provider, model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com', reasoningMode: 'disabled' }));
});
