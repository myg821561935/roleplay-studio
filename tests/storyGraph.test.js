import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStoryGraph, evaluateStoryGraph } from '../server/simulation/storyGraph.js';

test('storyGraph evaluates milestone completion and unlocks next nodes', () => {
  const initialGraph = {
    currentChapter: '序幕：初入江湖',
    nodes: [
      {
        id: 'node-1',
        title: '古庙避雨与接头',
        chapter: '序幕：初入江湖',
        status: 'active',
        conditions: {
          requiredLocation: '破庙',
          requiredFacts: ['得到半张残图']
        },
        outcomes: {
          unlockedNodes: ['node-2']
        }
      },
      {
        id: 'node-2',
        title: '夜探黑风寨',
        chapter: '第一幕：黑风迷雾',
        status: 'locked',
        conditions: {
          requiredLocation: '黑风寨'
        },
        outcomes: {
          unlockedNodes: ['node-3']
        }
      }
    ]
  };

  // 1. 条件未完全满足时（地点满足但尚未得到残图）
  const result1 = evaluateStoryGraph({
    graph: initialGraph,
    worldState: { location: '破庙大殿' },
    memoryCards: []
  });

  assert.equal(result1.completedNodes.length, 0);
  assert.equal(result1.graph.nodes[0].status, 'active');
  assert.equal(result1.graph.nodes[1].status, 'locked');

  // 2. 条件完全满足时（在破庙且确认了残图事实）
  const result2 = evaluateStoryGraph({
    graph: initialGraph,
    worldState: { location: '破庙大殿' },
    memoryCards: [{ title: '线索', content: '击败黑衣人后得到半张残图' }]
  });

  assert.equal(result2.completedNodes.length, 1);
  assert.equal(result2.completedNodes[0].id, 'node-1');
  assert.equal(result2.graph.nodes[0].status, 'completed');
  assert.equal(result2.graph.nodes[1].status, 'active');
  assert.equal(result2.graph.currentChapter, '第一幕：黑风迷雾');
});

test('storyGraph does not auto-complete a placeholder node without explicit conditions', () => {
  const result = evaluateStoryGraph({
    graph: { nodes: [{ id: 'placeholder', title: '等待玩家决定', status: 'active' }] },
    worldState: { location: '任意地点' }
  });

  assert.equal(result.completedNodes.length, 0);
  assert.equal(result.graph.nodes[0].status, 'active');
});
