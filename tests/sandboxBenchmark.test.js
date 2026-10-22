import test from 'node:test';
import assert from 'node:assert/strict';
import { runSandboxBenchmark } from '../server/tools/sandboxBenchmark.js';

test('runSandboxBenchmark runs multi-turn simulation and generates comprehensive health report', async () => {
  const characterCard = {
    name: '柳生十兵卫',
    description: '东瀛独眼剑客',
    personality: '沉默寡言，出手如风',
    scenario: '古庙避雨'
  };

  const worldBook = [
    { id: 'wb-1', keys: ['大堂', '客栈'], content: '客栈大堂陈设破旧', constant: true },
    { id: 'wb-2', keys: ['密道', '地窖'], content: '地窖下藏有陈年好酒', constant: false }
  ];

  const coreMemory = {
    personaView: '对玩家心存戒备',
    activeCommitments: ['护送佩刀'],
    coreDirectives: ['探求剑道极意']
  };

  const report = await runSandboxBenchmark({
    characterCard,
    worldBook,
    coreMemory,
    simulatedTurns: 3
  });

  assert.equal(report.totalTurns, 3);
  assert.equal(report.kvCacheStability.stabilityScore, 100, 'Zone 1 stability score must be 100%');
  assert.equal(report.foreshadowingStats.created, 1);
  assert.equal(report.foreshadowingStats.resolved, 1);
  assert.ok(report.summaryText.includes('【剧本沙箱体检报告】'));
  assert.ok(report.summaryText.includes('KV Cache 前缀一致性评分：100%'));
});
