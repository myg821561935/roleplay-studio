export const STORY_GRAPH_SPEC = 'lra.story-graph/v1';

export function normalizeStoryGraph(graph = {}) {
  const safe = graph && typeof graph === 'object' ? graph : {};
  const nodes = Array.isArray(safe.nodes) ? safe.nodes : [];

  return {
    spec: STORY_GRAPH_SPEC,
    currentChapter: String(safe.currentChapter || '第一章').trim(),
    nodes: nodes.map((node, index) => ({
      id: String(node.id || `node-${index + 1}`).trim(),
      title: String(node.title || `剧情节点 ${index + 1}`).trim(),
      chapter: String(node.chapter || safe.currentChapter || '第一章').trim(),
      description: String(node.description || '').trim(),
      status: ['locked', 'active', 'completed'].includes(String(node.status || ''))
        ? String(node.status)
        : (index === 0 ? 'active' : 'locked'),
      conditions: {
        requiredLocation: String(node.conditions?.requiredLocation || '').trim(),
        requiredFacts: Array.isArray(node.conditions?.requiredFacts)
          ? node.conditions.requiredFacts.map((f) => String(f).trim()).filter(Boolean)
          : [],
        requiredClues: Array.isArray(node.conditions?.requiredClues)
          ? node.conditions.requiredClues.map((c) => String(c).trim()).filter(Boolean)
          : []
      },
      outcomes: {
        unlockedNodes: Array.isArray(node.outcomes?.unlockedNodes)
          ? node.outcomes.unlockedNodes.map((id) => String(id).trim()).filter(Boolean)
          : [],
        revealedFacts: Array.isArray(node.outcomes?.revealedFacts)
          ? node.outcomes.revealedFacts.map((f) => String(f).trim()).filter(Boolean)
          : []
      }
    }))
  };
}

export function evaluateStoryGraph({
  graph = {},
  worldState = {},
  memoryCards = [],
  timeline = []
} = {}) {
  const currentGraph = normalizeStoryGraph(graph);
  if (!currentGraph.nodes.length) {
    return { graph: currentGraph, completedNodes: [], activatedNodes: [] };
  }

  const currentLocation = String(worldState.location || '').trim();
  const knownFactTexts = [
    ...(Array.isArray(memoryCards) ? memoryCards.map((m) => m.content || m.title || '') : []),
    ...(Array.isArray(timeline) ? timeline.map((t) => t.detail || t.title || '') : []),
    String(worldState.summary || '')
  ].join(' ');

  const completedNodes = [];
  const newlyUnlockedIds = new Set();

  // 1. 评估 active 节点是否满足完成条件
  for (const node of currentGraph.nodes) {
    if (node.status !== 'active') continue;

    let locationMatched = true;
    if (node.conditions.requiredLocation) {
      locationMatched = currentLocation.includes(node.conditions.requiredLocation)
        || node.conditions.requiredLocation.includes(currentLocation);
    }

    let factsMatched = true;
    if (node.conditions.requiredFacts.length) {
      factsMatched = node.conditions.requiredFacts.every((fact) => knownFactTexts.includes(fact));
    }

    let cluesMatched = true;
    if (node.conditions.requiredClues.length) {
      cluesMatched = node.conditions.requiredClues.every((clue) => knownFactTexts.includes(clue));
    }

    // 空条件节点只是作者给出的路线/章节占位，不能因为“没有条件”就在
    // 每轮后处理时自动完成。它必须由显式状态迁移或至少一项可核验条件驱动。
    const hasCompletionCondition = Boolean(
      node.conditions.requiredLocation
      || node.conditions.requiredFacts.length
      || node.conditions.requiredClues.length
    );
    if (hasCompletionCondition && locationMatched && factsMatched && cluesMatched) {
      node.status = 'completed';
      completedNodes.push(node);
      for (const nextId of node.outcomes.unlockedNodes) {
        newlyUnlockedIds.add(nextId);
      }
    }
  }

  // 2. 激活新解锁的节点
  const activatedNodes = [];
  for (const node of currentGraph.nodes) {
    if (node.status === 'locked' && newlyUnlockedIds.has(node.id)) {
      node.status = 'active';
      activatedNodes.push(node);
    }
  }

  // 更新当前章节
  const activeNode = currentGraph.nodes.find((n) => n.status === 'active');
  if (activeNode) {
    currentGraph.currentChapter = activeNode.chapter;
  }

  return {
    graph: currentGraph,
    completedNodes,
    activatedNodes
  };
}
