import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { auditLocalCommunitySamples } from '../scripts/audit-local-community-samples.mjs';

test('audits ready local samples without requiring private fixtures in Git', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'roleplay-local-samples-'));
  try {
    const worldBookPath = path.join(tempDir, 'worldbook.json');
    const bytes = Buffer.from(JSON.stringify({ name: 'Synthetic', entries: { one: { key: ['test'], content: 'safe' } } }));
    await writeFile(worldBookPath, bytes);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const manifestPath = path.join(tempDir, 'manifest.json');
    await writeFile(manifestPath, JSON.stringify({
      schemaVersion: 1,
      samples: [
        {
          id: 'synthetic-worldbook',
          resourceType: 'worldbook',
          contentTier: 'sfw',
          frontendTier: 'text',
          status: 'ready',
          sourcePath: worldBookPath,
          sha256,
          expectedOutcome: 'full-mapping'
        },
        {
          id: 'pending-character',
          resourceType: 'character',
          contentTier: 'sfw',
          frontendTier: 'light',
          status: 'pending'
        },
        {
          id: 'worldbook-frontend-not-applicable',
          resourceType: 'worldbook',
          contentTier: 'sfw',
          frontendTier: 'not-applicable',
          status: 'not-applicable'
        }
      ]
    }));

    const report = await auditLocalCommunitySamples(manifestPath);
    assert.equal(report.ok, true);
    assert.equal(report.complete, false);
    assert.deepEqual(report.incomplete, ['pending-character']);
    assert.deepEqual(report.summary, {
      total: 3,
      passed: 1,
      failed: 0,
      candidate: 0,
      pending: 1,
      notApplicable: 1
    });
    assert.equal(report.results[0].details.entries, 1);

    const strictReport = await auditLocalCommunitySamples(manifestPath, { requireComplete: true });
    assert.equal(strictReport.ok, false);
    assert.equal(strictReport.complete, false);
    assert.deepEqual(strictReport.incomplete, ['pending-character']);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('fails a ready sample when its pinned content hash changes', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'roleplay-local-samples-'));
  try {
    const presetPath = path.join(tempDir, 'preset.json');
    await writeFile(presetPath, JSON.stringify({ name: 'Synthetic', prompts: [] }));
    const manifestPath = path.join(tempDir, 'manifest.json');
    await writeFile(manifestPath, JSON.stringify({
      schemaVersion: 1,
      samples: [{
        id: 'changed-preset',
        resourceType: 'preset',
        contentTier: 'general',
        frontendTier: 'text',
        status: 'ready',
        sourcePath: presetPath,
        sha256: '0'.repeat(64)
      }]
    }));

    const report = await auditLocalCommunitySamples(manifestPath);
    assert.equal(report.ok, false);
    assert.equal(report.summary.failed, 1);
    assert.match(report.results[0].error, /文件哈希已变化/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('character samples count their normalized embedded worldbook entries', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'embedded-book-audit-'));
  try {
    const sourcePath = path.join(root, 'card.json');
    await writeFile(sourcePath, JSON.stringify({ spec: 'chara_card_v2', data: { name: '测试人物', description: '简洁对白', character_book: { entries: [{ id: 1, keys: ['街道'], content: '街道通往广场。', enabled: true }] } } }));
    const manifest = path.join(root, 'manifest.json');
    await writeFile(manifest, JSON.stringify({ schemaVersion: 1, samples: [{ id: 'embedded', resourceType: 'character', contentTier: 'sfw', frontendTier: 'text', status: 'ready', sourcePath }] }));
    const report = await auditLocalCommunitySamples(manifest);
    assert.equal(report.results[0].status, 'passed');
    assert.equal(report.results[0].details.worldBookEntries, 1);
  } finally { await rm(root, {recursive:true, force:true}); }
});
