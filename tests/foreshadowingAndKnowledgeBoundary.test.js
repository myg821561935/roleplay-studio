import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNarrativeTurnFrame } from '../server/agent/turnFrame.js';
import { validateNarrativeHardFacts } from '../server/memory/narrativeRepair.js';

test('TurnFrame normalizes foreshadowing queue and character knowledge boundaries', () => {
  const rawFrame = {
    scene: { location: '破庙', time: '夜半', summary: '避雨中' },
    decision: { kind: 'open-state', focus: '观察柴翁' },
    evidence: [{ text: '柴翁眼神闪烁', status: 'hypothesis' }],
    stateDelta: {
      summary: '柴翁神色有异',
      foreshadowing: [
        { id: 'hook-1', content: '井底暗红封泥下的青铜残片', status: 'open', targetEntity: '柴翁' },
        { id: 'hook-2', content: '破庙神像后藏着的血衣', status: 'open' }
      ],
      characterKnowledge: {
        '柴翁': {
          knownFacts: ['刘一正在探查神像', '外面正在下暴雨'],
          secretBoundaries: ['漆木匣中藏有密信', '刘一的真实身世']
        }
      }
    }
  };

  const normalized = normalizeNarrativeTurnFrame(rawFrame);

  // 1. 验证伏笔队列
  assert.equal(normalized.stateDelta.foreshadowing.length, 2);
  assert.equal(normalized.stateDelta.foreshadowing[0].id, 'hook-1');
  assert.equal(normalized.stateDelta.foreshadowing[0].content, '井底暗红封泥下的青铜残片');
  assert.equal(normalized.stateDelta.foreshadowing[0].targetEntity, '柴翁');
  assert.equal(normalized.stateDelta.foreshadowing[0].status, 'open');

  // 2. 验证角色已知信息与涉密盲区
  assert.ok(normalized.stateDelta.characterKnowledge['柴翁']);
  assert.deepEqual(normalized.stateDelta.characterKnowledge['柴翁'].knownFacts, ['刘一正在探查神像', '外面正在下暴雨']);
  assert.deepEqual(normalized.stateDelta.characterKnowledge['柴翁'].secretBoundaries, ['漆木匣中藏有密信', '刘一的真实身世']);
});

test('validateNarrativeHardFacts deterministically detects NPC secret boundary violations (anti-spoiler)', () => {
  const memory = {
    worldState: {
      characterKnowledge: {
        '柴翁': {
          knownFacts: ['外面正在下暴雨'],
          secretBoundaries: ['漆木匣中藏有密信', '青铜残片在井底']
        }
      }
    }
  };

  // 合规对白（未触碰涉密盲区）
  const safeContent = '柴翁咳嗽两声，沙哑道：“客官，这暴雨一时半会停不了，且在此歇息吧。”';
  const safeCheck = validateNarrativeHardFacts(safeContent, memory);
  assert.equal(safeCheck.valid, true);
  assert.equal(safeCheck.conflicts.length, 0);

  // 违规越权剧透（NPC 直接把漆木匣中藏有密信说出来了）
  const spoilerContent = '柴翁冷笑一声：“我知道你在找什么，漆木匣中藏有密信，你休想拿走！”';
  const spoilerCheck = validateNarrativeHardFacts(spoilerContent, memory);
  assert.equal(spoilerCheck.valid, false);
  assert.equal(spoilerCheck.conflicts.length, 1);
  assert.equal(spoilerCheck.conflicts[0].id, 'spoiler-柴翁');
  assert.equal(spoilerCheck.conflicts[0].matched, '漆木匣中藏有密信');
});
