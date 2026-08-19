const DEFAULT_HOPS = 2;
const MAX_RELATED_ENTITIES = 24;
const MAX_EXPANDED_QUERY_LENGTH = 600;

const RELATIONSHIP_EDGE_TYPES = new Set([
  'TRUSTS',
  'HOSTILE_TO',
  'OWES',
  'KNOWS',
  'KNOWS_SECRET',
  'RELATED_TO',
  'INTERACTED_WITH',
  'MEMBER_OF'
]);

const ACTIONABLE_EDGE_TYPES = new Set([
  'TRUSTS',
  'HOSTILE_TO',
  'OWES',
  'KNOWS_SECRET'
]);

export function expandQueryWithGraph({
  graph = null,
  query = '',
  seedEntities = [],
  hops = DEFAULT_HOPS,
  view = 'player'
} = {}) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];

  if (!nodes.length || !edges.length) {
    return {
      expandedQuery: String(query || ''),
      relatedEntities: [],
      graphTrail: [],
      actionableRelations: [],
      seedNodeIds: []
    };
  }

  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const visibleEdge = (edge) => view === 'director' || edge.visibility !== 'director';
  const edgeSourceId = (edge) => edge.sourceId || edge.source || edge.from || '';
  const edgeTargetId = (edge) => edge.targetId || edge.target || edge.to || '';

  const seedNames = new Set();
  const queryText = String(query || '');
  nodes.forEach((node) => {
    const name = normalizeEntityLabel(node);
    if (!name) return;
    if (queryText.includes(name)) seedNames.add(name);
    const aliases = Array.isArray(node.aliases) ? node.aliases : [];
    aliases.forEach((alias) => {
      if (alias && queryText.includes(alias)) seedNames.add(alias);
    });
  });
  (Array.isArray(seedEntities) ? seedEntities : []).forEach((name) => {
    const normalized = String(name || '').trim();
    if (normalized) seedNames.add(normalized);
  });

  const seedNodeIds = new Set();
  nodes.forEach((node) => {
    const name = normalizeEntityLabel(node);
    if (!name) return;
    if (seedNames.has(name)) {
      seedNodeIds.add(node.id);
      return;
    }
    const aliases = Array.isArray(node.aliases) ? node.aliases : [];
    if (aliases.some((alias) => seedNames.has(alias))) {
      seedNodeIds.add(node.id);
    }
  });

  if (!seedNodeIds.size) {
    return {
      expandedQuery: queryText,
      relatedEntities: [],
      graphTrail: [],
      actionableRelations: [],
      seedNodeIds: []
    };
  }

  const visited = new Set(seedNodeIds);
  const frontier = [...seedNodeIds];
  const trail = [];
  const relatedEntityIds = new Set();

  for (let hop = 1; hop <= hops; hop += 1) {
    const nextFrontier = [];
    edges.forEach((edge) => {
      if (!visibleEdge(edge)) return;
      if (edge.status === 'superseded') return;
      const eSourceId = edgeSourceId(edge);
      const eTargetId = edgeTargetId(edge);
      const fromSeed = frontier.includes(eSourceId);
      const toSeed = frontier.includes(eTargetId);
      if (!fromSeed && !toSeed) return;

      const neighborId = fromSeed ? eTargetId : eSourceId;
      if (visited.has(neighborId)) return;
      visited.add(neighborId);
      nextFrontier.push(neighborId);
      relatedEntityIds.add(neighborId);

      const sourceNode = nodeMap.get(eSourceId);
      const targetNode = nodeMap.get(eTargetId);
      if (sourceNode && targetNode) {
        trail.push({
          hop,
          source: normalizeEntityLabel(sourceNode),
          target: normalizeEntityLabel(targetNode),
          edgeType: edge.type,
          label: edge.label || ''
        });
      }
    });
    frontier.length = 0;
    frontier.push(...nextFrontier);
    if (!frontier.length) break;
  }

  const relatedEntities = [...relatedEntityIds]
    .map((id) => nodeMap.get(id))
    .filter(Boolean)
    .map((node) => ({
      id: node.id,
      name: normalizeEntityLabel(node),
      type: node.type,
      aliases: Array.isArray(node.aliases) ? [...node.aliases] : []
    }))
    .filter((entity) => entity.name)
    .slice(0, MAX_RELATED_ENTITIES);

  const actionableRelations = edges
    .filter((edge) => visibleEdge(edge) && edge.status !== 'superseded')
    .filter((edge) => ACTIONABLE_EDGE_TYPES.has(edge.type))
    .filter((edge) => {
      const eSourceId = edgeSourceId(edge);
      const eTargetId = edgeTargetId(edge);
      return seedNodeIds.has(eSourceId) || relatedEntityIds.has(eSourceId)
        || seedNodeIds.has(eTargetId) || relatedEntityIds.has(eTargetId);
    })
    .map((edge) => {
      const source = nodeMap.get(edgeSourceId(edge));
      const target = nodeMap.get(edgeTargetId(edge));
      return {
        type: edge.type,
        source: source ? normalizeEntityLabel(source) : '',
        target: target ? normalizeEntityLabel(target) : '',
        label: edge.label || '',
        confidence: Number(edge.confidence ?? 1)
      };
    })
    .filter((relation) => relation.source && relation.target)
    .slice(0, 12);

  const expansionTerms = relatedEntities
    .flatMap((entity) => [entity.name, ...entity.aliases])
    .filter(Boolean);

  const existingTerms = new Set(tokenizeForExpansion(queryText));
  const newTerms = expansionTerms.filter((term) => term.length >= 2 && !existingTerms.has(term.toLowerCase()));
  const uniqueNewTerms = [...new Set(newTerms)].slice(0, 12);
  const expandedQuery = uniqueNewTerms.length
    ? `${queryText} ${uniqueNewTerms.join(' ')}`.slice(0, MAX_EXPANDED_QUERY_LENGTH)
    : queryText;

  return {
    expandedQuery,
    relatedEntities,
    graphTrail: trail.slice(0, 30),
    actionableRelations,
    seedNodeIds: [...seedNodeIds]
  };
}

export function scoreGraphRelevance(item, graphExpansion, { textFields = [] } = {}) {
  if (!graphExpansion || !graphExpansion.relatedEntities?.length) return 0;
  const text = textFields
    .filter(Boolean)
    .join('\n')
    .normalize('NFKC')
    .toLowerCase('zh-CN');

  let score = 0;
  graphExpansion.relatedEntities.forEach((entity) => {
    const name = String(entity.name || '').toLowerCase('zh-CN');
    if (name && name.length >= 2 && text.includes(name)) score += 3;
    (entity.aliases || []).forEach((alias) => {
      const normalized = String(alias || '').toLowerCase('zh-CN');
      if (normalized && normalized.length >= 2 && text.includes(normalized)) score += 2;
    });
  });

  graphExpansion.actionableRelations.forEach((relation) => {
    const combined = `${relation.source} ${relation.target} ${relation.label}`.toLowerCase('zh-CN');
    if (combined && text.includes(relation.source.toLowerCase('zh-CN')) && text.includes(relation.target.toLowerCase('zh-CN'))) {
      score += 5;
    }
  });

  return score;
}

export function buildGraphContextForActivation(graphExpansion) {
  if (!graphExpansion) return '';
  const terms = [];
  graphExpansion.relatedEntities?.forEach((entity) => {
    if (entity.name) terms.push(entity.name);
    (entity.aliases || []).forEach((alias) => {
      if (alias && !terms.includes(alias)) terms.push(alias);
    });
  });
  return terms.slice(0, 20).join('\n');
}

function normalizeEntityLabel(node) {
  return String(node?.name || node?.label || '').trim();
}

function tokenizeForExpansion(value) {
  const text = String(value || '').normalize('NFKC').toLowerCase('zh-CN');
  const tokens = new Set(text.match(/[a-z0-9_]{2,}|[\u3400-\u9fff]{2,4}/g) || []);
  return tokens;
}
