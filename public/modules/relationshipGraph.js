const NAME_PATTERN = '[\\u3400-\\u9fffA-Za-z][\\u3400-\\u9fffA-Za-z0-9·・]{0,15}';
const INDIRECT_PATTERN = /未露面|尚未(?:直接)?(?:见面|接触|登场)|间接关联|只闻其名|传闻|待登场/;
const DECLARED_CHARACTER_SOURCE_KINDS = new Set([
  'character-card',
  'group-member',
  'character-preset',
  'world-book'
]);

/**
 * Projects the canonical character registry into the three player-facing
 * roster groups. A declared role is not treated as an encountered role until
 * it becomes part of the current act (or has an explicit session encounter).
 */
export function buildImmersiveCharacterGroups({
  registry = null,
  protagonistNames = [],
  characterCard = null,
  worldState = null,
  configured = []
} = {}) {
  const knownProtagonists = new Set(protagonistNames.map(normalizeName).filter(Boolean));
  const registryRecords = Array.isArray(registry?.records) ? registry.records : [];
  const recordsById = new Map(registryRecords
    .map((record) => [String(record?.id || ''), record])
    .filter(([id]) => id));
  const currentActMembers = Array.isArray(registry?.currentAct?.members)
    ? registry.currentAct.members
    : [];
  const activeIds = new Set(currentActMembers.map((member) => String(member?.characterId || '')).filter(Boolean));
  const activeNames = new Set(currentActMembers.map((member) => normalizeName(member?.name)).filter(Boolean));
  const protagonistRecord = registryRecords.find((record) => record?.kind === 'protagonist')
    || registryRecords.find((record) => knownProtagonists.has(normalizeName(record?.name)))
    || createFallbackProtagonist(characterCard, worldState, protagonistNames);
  const protagonistName = normalizeName(protagonistRecord?.name);
  if (protagonistName) knownProtagonists.add(protagonistName);

  const currentAct = dedupeRoster(currentActMembers.map((act) => {
    const record = recordsById.get(String(act?.characterId || ''));
    const member = toRosterMember(record || act, {
      act,
      sourceLabel: '当前幕',
      rosterStatus: actStateLabel(act?.state)
    });
    return knownProtagonists.has(normalizeName(member?.name)) ? null : member;
  }));

  const declaredByName = new Map();
  const addDeclared = (record, fallbackSourceKind = '') => {
    const sourceKind = String(record?.source?.kind || fallbackSourceKind || '').trim();
    const name = normalizeName(record?.name);
    if (!name || knownProtagonists.has(name) || activeIds.has(String(record?.id || '')) || activeNames.has(name)) return;
    if (!DECLARED_CHARACTER_SOURCE_KINDS.has(sourceKind)) return;
    const previous = declaredByName.get(name);
    const member = toRosterMember(record, {
      sourceLabel: declaredSourceLabel(sourceKind),
      rosterStatus: record?.session?.encountered === true ? '已相识，未在当前幕' : '设定角色，尚未登场'
    });
    if (!previous || declaredSourceRank(sourceKind) < declaredSourceRank(previous.sourceKind)) {
      declaredByName.set(name, member);
    }
  };

  registryRecords.forEach((record) => addDeclared(record));
  (Array.isArray(configured) ? configured : [])
    .filter((member) => member?.enabled !== false)
    .forEach((member) => addDeclared({
      ...member,
      source: { kind: 'group-member', id: member?.id || member?.name },
      session: { encountered: member?.encountered === true }
    }, 'group-member'));

  return {
    protagonist: protagonistRecord ? [toRosterMember(protagonistRecord, {
      sourceLabel: '主角',
      rosterStatus: activeNames.has(protagonistName) ? '当前在场' : '本局主角'
    })] : [],
    currentAct,
    declared: [...declaredByName.values()]
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
      .slice(0, 48)
  };
}

export function collectImmersiveCharacterMembers({
  configured = [],
  relationships = [],
  characters = [],
  messages = [],
  interactiveStatus = '',
  relationshipStatus = '',
  castContent = '',
  protagonistNames = [],
  registry = null
} = {}) {
  const configuredRecords = Array.isArray(configured) ? configured : [];
  const messageRecords = Array.isArray(messages) ? messages : [];
  const protagonists = new Set(protagonistNames.map(normalizeName).filter(Boolean));
  const records = new Map();
  const encounteredNames = new Set();
  const registryRecords = Array.isArray(registry?.records) ? registry.records : [];
  const currentActById = new Map(
    (Array.isArray(registry?.currentAct?.members) ? registry.currentAct.members : [])
      .map((member) => [String(member?.characterId || ''), member])
      .filter(([id]) => id)
  );
  const panelTexts = [
    ...messageRecords.flatMap((message) => {
      const panels = message?.roleplayPanels || {};
      return [panels.characterStatus, panels.relationshipStatus, panels.sceneStatus];
    }),
    interactiveStatus,
    relationshipStatus
  ].filter(Boolean).map(String);

  panelTexts.forEach((text) => collectPanelNames(text).forEach((name) => encounteredNames.add(name)));

  const addMember = (member, { requireEncounter = false } = {}) => {
    const name = normalizeName(member?.name || member?.character || member?.target);
    if (!name || protagonists.has(name)) return;
    const evidence = [
      member?.status,
      member?.state,
      member?.description,
      member?.relationship,
      member?.relation,
      member?.detail,
      member?.notes
    ].filter(Boolean).join(' ');
    const encountered = member?.encountered === true
      || encounteredNames.has(name)
      || (member?.encountered !== false && !INDIRECT_PATTERN.test(evidence));
    if (requireEncounter && !encountered) return;
    const previous = records.get(name) || {};
    records.set(name, {
      ...previous,
      ...member,
      name,
      role: member?.role || member?.identity || member?.title || previous.role || '互动角色',
      description: member?.description || member?.detail || member?.notes || previous.description || '',
      relationship: member?.relationship || member?.relation || member?.status || previous.relationship || '',
      actState: member?.actState || previous.actState || '',
      actStatus: member?.actStatus || previous.actStatus || '',
      encountered: Boolean(previous.encountered || encountered)
    });
  };

  configuredRecords
    .filter((member) => member?.enabled !== false)
    .forEach((member) => addMember(member));
  registryRecords.forEach((record) => {
    const act = currentActById.get(String(record?.id || ''));
    addMember({
      name: record?.name,
      role: record?.profile?.role,
      description: record?.profile?.description,
      personality: record?.profile?.personality,
      portrait: record?.profile?.portrait,
      status: record?.session?.status,
      encountered: record?.session?.encountered === true,
      actState: act?.state || 'off-stage',
      actStatus: act?.status || ''
    }, { requireEncounter: record?.kind !== 'source-npc' });
  });
  (Array.isArray(characters) ? characters : []).forEach((member) => addMember(member, { requireEncounter: true }));
  (Array.isArray(relationships) ? relationships : []).forEach((member) => {
    const relationDetail = [member?.type, member?.relation, member?.relationship, member?.details, member?.detail]
      .filter(Boolean)
      .join(' · ');
    const source = normalizeName(member?.from || member?.source);
    const target = normalizeName(member?.to || member?.target || member?.character);
    if (source || target) {
      [source, target]
        .filter((name) => name && !protagonists.has(name))
        .forEach((name) => addMember({
          name,
          role: member?.role || member?.identity || '互动角色',
          relationship: relationDetail,
          encountered: member?.encountered !== false
        }, { requireEncounter: true }));
      return;
    }
    addMember(member, { requireEncounter: true });
  });

  collectCatalogMembers(castContent).forEach((member) => {
    if (encounteredNames.has(member.name) || !panelTexts.length) addMember(member);
  });
  encounteredNames.forEach((name) => addMember({ name, role: '本幕角色', encountered: true }));

  return [...records.values()]
    .filter((member) => member.encountered || configuredRecords.some((item) => normalizeName(item?.name) === member.name))
    .slice(0, 24);
}

function createFallbackProtagonist(characterCard, worldState, protagonistNames) {
  const protagonist = worldState && typeof worldState === 'object' ? worldState.protagonist : null;
  const name = protagonist?.name || characterCard?.name || protagonistNames.find(Boolean);
  if (!normalizeName(name)) return null;
  return {
    id: 'protagonist:fallback',
    name,
    kind: 'protagonist',
    source: { kind: 'character-card', id: characterCard?.id || 'active-character-card' },
    profile: {
      role: protagonist?.role || protagonist?.realm || characterCard?.role || '',
      description: protagonist?.description || characterCard?.description || '',
      personality: protagonist?.personality || characterCard?.personality || '',
      portrait: protagonist?.portrait || characterCard?.portrait || characterCard?.avatar || ''
    },
    session: { encountered: true }
  };
}

function toRosterMember(record, { act = null, sourceLabel = '', rosterStatus = '' } = {}) {
  const profile = record?.profile && typeof record.profile === 'object' ? record.profile : record || {};
  const sourceKind = String(record?.source?.kind || '').trim();
  return {
    id: String(record?.id || act?.characterId || ''),
    name: normalizeName(record?.name || act?.name),
    role: profile?.role || act?.role || '设定角色',
    description: profile?.description || record?.description || record?.detail || '',
    personality: profile?.personality || record?.personality || '',
    portrait: profile?.portrait || record?.portrait || record?.avatar || '',
    encountered: record?.session?.encountered === true || record?.encountered === true,
    actState: act?.state || '',
    actStatus: act?.status || record?.session?.status || record?.status || '',
    sourceKind,
    sourceLabel,
    rosterStatus
  };
}

function dedupeRoster(members) {
  const seen = new Set();
  return members.filter((member) => {
    const name = normalizeName(member?.name);
    if (!name || seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}

function declaredSourceLabel(sourceKind) {
  return ({
    'character-card': '角色卡',
    'group-member': '角色卡角色',
    'character-preset': '角色预设',
    'world-book': '世界书角色'
  })[sourceKind] || '设定角色';
}

function declaredSourceRank(sourceKind) {
  return ({
    'character-card': 0,
    'group-member': 1,
    'character-preset': 2,
    'world-book': 3
  })[sourceKind] ?? 99;
}

function actStateLabel(state) {
  return ({
    'on-stage': '当前在场',
    'off-stage': '本幕离场',
    mentioned: '本幕提及',
    pending: '待进入本幕'
  })[state] || '本幕角色';
}

export function buildImmersiveRelationshipGraph({
  protagonistName = '主角',
  graphProjection = null,
  relationships = [],
  factions = [],
  relationshipStatus = ''
} = {}) {
  const protagonist = normalizeName(protagonistName) || '主角';
  const nodes = new Map([[protagonist, { id: protagonist, label: protagonist, type: 'protagonist', direct: true }]]);
  const edges = [];
  const edgeKeys = new Set();
  const addNode = (name, extra = {}) => {
    const normalized = normalizeName(name);
    if (!normalized) return '';
    nodes.set(normalized, { ...(nodes.get(normalized) || {}), id: normalized, label: normalized, ...extra });
    return normalized;
  };
  const addEdge = (source, target, label = '', indirect = false) => {
    const from = addNode(source);
    const to = addNode(target);
    if (!from || !to || from === to) return;
    const key = [from, to].sort().join('::');
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ source: from, target: to, label: cleanLabel(label), indirect });
  };

  const projectedNodes = (Array.isArray(graphProjection?.nodes) ? graphProjection.nodes : [])
    .filter((node) => ['Character', 'Faction'].includes(node?.type));
  const projectedEdges = Array.isArray(graphProjection?.edges) ? graphProjection.edges : [];
  projectedNodes.forEach((node) => {
    const properties = node?.properties || {};
    const type = properties.protagonist
      ? 'protagonist'
      : node?.type === 'Faction'
        ? 'faction'
        : node?.type === 'Character'
          ? 'character'
          : 'knowledge';
    addNode(node?.label || node?.name, {
      type,
      direct: properties.indirect !== true && properties.encountered !== false,
      detail: cleanLabel(properties.description || ''),
      role: properties.role || ''
    });
  });
  const projectedNames = new Map(projectedNodes.map((node) => [node.id, node.label || node.name]));
  projectedEdges.forEach((edge) => {
    const source = projectedNames.get(edge.source);
    const target = projectedNames.get(edge.target);
    if (!source || !target) return;
    addEdge(source, target, edge.label || relationTypeLabel(edge.type), edge.properties?.indirect === true);
  });

  (Array.isArray(relationships) ? relationships : []).slice(0, 24).forEach((record) => {
    const sourceName = normalizeName(record?.from || record?.source);
    const targetName = normalizeName(record?.to || record?.target || record?.character);
    const typeLabel = cleanLabel(record?.type || record?.relation || record?.relationship || '');
    const details = cleanLabel(record?.details || record?.detail || record?.notes || record?.status || '');
    if (sourceName && targetName) {
      const detail = [typeLabel, details].filter(Boolean).join(' · ');
      const indirect = record?.encountered === false || INDIRECT_PATTERN.test(detail);
      addNode(sourceName, {
        type: sourceName === protagonist ? 'protagonist' : 'character',
        direct: !indirect
      });
      addNode(targetName, {
        type: targetName === protagonist ? 'protagonist' : 'character',
        direct: !indirect
      });
      addEdge(sourceName, targetName, detail || '已建立联系', indirect);
      return;
    }
    const name = normalizeName(record?.name || record?.character || record?.target);
    if (!name || name === protagonist) return;
    const detail = [record?.relationship, record?.relation, record?.status, record?.detail, record?.notes]
      .filter(Boolean).join(' ');
    const indirect = record?.encountered === false || INDIRECT_PATTERN.test(detail);
    addNode(name, {
      type: 'character',
      direct: !indirect,
      detail: cleanLabel(detail),
      role: record?.role || record?.identity || record?.title || ''
    });
    addEdge(protagonist, name, detail || record?.role || '已建立联系', indirect);
  });

  extractRelationshipEdges(relationshipStatus).forEach((edge) => {
    addNode(edge.source, { type: edge.source === protagonist ? 'protagonist' : 'character', direct: true });
    addNode(edge.target, { type: edge.target === protagonist ? 'protagonist' : 'character', direct: true });
    addEdge(edge.source, edge.target, edge.label, false);
  });

  (Array.isArray(factions) ? factions : []).slice(0, 10).forEach((record) => {
    const name = normalizeName(record?.name || record?.title || record?.faction);
    if (!name) return;
    addNode(name, {
      type: 'faction',
      direct: true,
      detail: cleanLabel(record?.detail || record?.description || record?.status || ''),
      role: '势力'
    });
    const related = normalizeName(record?.character || record?.leader || record?.owner);
    if (related && nodes.has(related)) addEdge(related, name, record?.relationship || '所属', false);
  });

  return { protagonist, nodes: [...nodes.values()].slice(0, 25), edges: edges.slice(0, 36) };
}

function relationTypeLabel(type) {
  return ({
    INTERACTED_WITH: '已互动',
    KNOWS: '知晓',
    TRUSTS: '信任',
    HOSTILE_TO: '敌对',
    MEMBER_OF: '所属',
    OWES: '亏欠',
    LOCATED_AT: '位于',
    RELATED_TO: '关联'
  })[type] || String(type || '关联');
}

export function renderImmersiveRelationshipGraph(container, graph, { documentObject = globalThis.document } = {}) {
  if (!container || !documentObject) return null;
  const root = documentObject.createElement('section');
  root.className = 'immersive-relationship-graph';
  const heading = documentObject.createElement('header');
  heading.className = 'immersive-relationship-graph-heading';
  const title = documentObject.createElement('h4');
  title.textContent = '人物与动态记忆图谱';
  const hint = documentObject.createElement('span');
  hint.textContent = '可拖拽节点交互 · 实时力导向排版';
  heading.append(title, hint);
  root.append(heading);

  if (!graph?.nodes?.length || graph.nodes.length <= 1) {
    const empty = documentObject.createElement('p');
    empty.className = 'immersive-relationship-graph-empty';
    empty.textContent = '尚未形成可绘制的动态联系。角色实际登场后会在这里建立节点。';
    root.append(empty);
    container.append(root);
    return root;
  }

  const width = 680;
  const height = Math.max(420, Math.min(600, 320 + graph.nodes.length * 15));
  const svg = createSvgElement(documentObject, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', '当前人物与动态知识网络图');

  // Map nodes to objects containing physics state
  const physicsNodes = graph.nodes.map(n => ({
    ...n,
    x: width / 2 + (Math.random() - 0.5) * 100,
    y: height / 2 + (Math.random() - 0.5) * 100,
    vx: 0,
    vy: 0
  }));
  const nodeMap = new Map(physicsNodes.map(n => [n.id, n]));
  const physicsEdges = graph.edges.map(e => ({
    ...e,
    sourceNode: nodeMap.get(e.source),
    targetNode: nodeMap.get(e.target)
  })).filter(e => e.sourceNode && e.targetNode);

  // Render Edges
  const edgeElements = physicsEdges.map(edge => {
    const line = createSvgElement(documentObject, 'line');
    line.classList?.add('immersive-graph-edge');
    if (edge.indirect) line.classList?.add('is-indirect');
    const lineTitle = createSvgElement(documentObject, 'title');
    lineTitle.textContent = `${edge.source} 与 ${edge.target}${edge.label ? `：${edge.label}` : ''}`;
    line.append(lineTitle);
    svg.append(line);
    return { edge, line };
  });

  // Render Nodes & Enhanced Panorama Detail
  const detail = documentObject.createElement('div');
  detail.className = 'immersive-relationship-graph-detail';
  detail.innerHTML = '<p class="immersive-graph-detail-placeholder">选择或拖拽节点可查看身份、关系拓扑与沉淀的因果事件。</p>';

  let focusedNodeId = null;

  const updateNeighborhoodFocus = (targetNodeId) => {
    focusedNodeId = targetNodeId;
    const isFocus = Boolean(targetNodeId);
    const neighborIds = new Set();
    if (isFocus) {
      neighborIds.add(targetNodeId);
      graph.edges.forEach(edge => {
        if (edge.source === targetNodeId) neighborIds.add(edge.target);
        if (edge.target === targetNodeId) neighborIds.add(edge.source);
      });
    }

    edgeElements.forEach(({ edge, line }) => {
      const isRelatedEdge = isFocus && (edge.source === targetNodeId || edge.target === targetNodeId);
      line.classList?.toggle('is-dimmed', isFocus && !isRelatedEdge);
      line.classList?.toggle('is-highlighted', isRelatedEdge);
    });

    nodeElements.forEach(({ node, group }) => {
      const isNeighbor = neighborIds.has(node.id);
      group.classList?.toggle('is-dimmed', isFocus && !isNeighbor);
      group.classList?.toggle('is-selected', node.id === targetNodeId);
      group.classList?.toggle('is-neighbor', isFocus && isNeighbor && node.id !== targetNodeId);
    });
  };

  const nodeElements = physicsNodes.map(node => {
    const group = createSvgElement(documentObject, 'g');
    group.classList?.add('immersive-graph-node', `is-${node.type || 'character'}`);
    if (node.direct === false) group.classList?.add('is-indirect');
    group.setAttribute('tabindex', '0');
    group.setAttribute('role', 'button');
    group.setAttribute('aria-label', `${node.label}${node.role ? `，${node.role}` : ''}`);

    // Geometry
    const isFaction = node.type === 'faction';
    const isMemory = node.type === 'knowledge' || node.type === 'memory';
    let shape;
    if (isFaction || isMemory) {
      shape = createSvgElement(documentObject, 'rect');
      const w = isFaction ? 100 : 70;
      const h = isFaction ? 44 : 32;
      shape.setAttribute('x', `-${w / 2}`);
      shape.setAttribute('y', `-${h / 2}`);
      shape.setAttribute('width', `${w}`);
      shape.setAttribute('height', `${h}`);
      shape.setAttribute('rx', isFaction ? '9' : '4');
    } else {
      shape = createSvgElement(documentObject, 'circle');
      shape.setAttribute('r', node.type === 'protagonist' ? '31' : '25');
    }

    const label = createSvgElement(documentObject, 'text');
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('dominant-baseline', 'central');
    label.textContent = truncateLabel(node.label, isFaction ? 8 : (isMemory ? 6 : 5));
    group.append(shape, label);

    const showDetail = () => {
      updateNeighborhoodFocus(node.id);

      const relatedEdges = graph.edges.filter(edge => edge.source === node.id || edge.target === node.id);
      const isProtagonist = node.type === 'protagonist';
      const kindLabel = isProtagonist ? '本局主角' : isFaction ? '势力阵营' : isMemory ? '知识记忆' : node.direct === false ? '传闻角色' : '关键人物';

      detail.innerHTML = '';
      const panorama = documentObject.createElement('article');
      panorama.className = 'immersive-graph-panorama-card';

      // Header
      const header = documentObject.createElement('div');
      header.className = 'immersive-graph-panorama-header';
      const titleWrap = documentObject.createElement('div');
      const name = documentObject.createElement('strong');
      name.textContent = node.label;
      const badge = documentObject.createElement('span');
      badge.className = `immersive-graph-badge is-${node.type || 'character'}`;
      badge.textContent = kindLabel;
      titleWrap.append(name, badge);

      const actions = documentObject.createElement('div');
      actions.className = 'immersive-graph-panorama-actions';
      const resetBtn = documentObject.createElement('button');
      resetBtn.type = 'button';
      resetBtn.className = 'immersive-graph-reset-focus';
      resetBtn.textContent = '重置全景';
      resetBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        updateNeighborhoodFocus(null);
        detail.innerHTML = '<p class="immersive-graph-detail-placeholder">已恢复全景视角。选择或拖拽节点可重新查看因果事件。</p>';
      });
      actions.append(resetBtn);
      header.append(titleWrap, actions);

      // Meta / Identity
      const roleText = node.role || node.detail || '已在当前故事画卷中登场。';
      const meta = documentObject.createElement('p');
      meta.className = 'immersive-graph-panorama-role';
      meta.textContent = roleText;

      // Relations
      const relationsSection = documentObject.createElement('div');
      relationsSection.className = 'immersive-graph-panorama-relations';
      const relHeading = documentObject.createElement('h5');
      relHeading.textContent = '关系拓扑';
      relationsSection.append(relHeading);

      if (relatedEdges.length) {
        const tags = documentObject.createElement('div');
        tags.className = 'immersive-graph-relation-tags';
        relatedEdges.forEach(edge => {
          const targetName = edge.source === node.id ? edge.target : edge.source;
          const tag = documentObject.createElement('span');
          tag.className = 'immersive-graph-relation-tag';
          tag.textContent = `${targetName} · ${edge.label || '关联'}`;
          tags.append(tag);
        });
        relationsSection.append(tags);
      } else {
        const noRel = documentObject.createElement('small');
        noRel.className = 'immersive-graph-text-subtle';
        noRel.textContent = '暂无直接对向联系。';
        relationsSection.append(noRel);
      }

      // Causal Events
      const causalSection = documentObject.createElement('div');
      causalSection.className = 'immersive-graph-panorama-causal';
      const causalHeading = documentObject.createElement('h5');
      causalHeading.textContent = '因果事件与时序记忆';
      causalSection.append(causalHeading);

      const events = Array.isArray(node.events) && node.events.length ? node.events : (Array.isArray(node.causalRecords) ? node.causalRecords : []);
      if (events.length) {
        const list = documentObject.createElement('ul');
        list.className = 'immersive-graph-causal-list';
        events.slice(0, 5).forEach(ev => {
          const li = documentObject.createElement('li');
          li.textContent = typeof ev === 'string' ? ev : `${ev.turn ? `【第 ${ev.turn} 幕】` : ''}${ev.summary || ev.title || ev.content || ''}`;
          list.append(li);
        });
        causalSection.append(list);
      } else {
        const hint = documentObject.createElement('small');
        hint.className = 'immersive-graph-text-subtle';
        hint.textContent = '随剧情推移，与该角色的因果转折与互动事实将在此实时同步沉淀。';
        causalSection.append(hint);
      }

      panorama.append(header, meta, relationsSection, causalSection);
      detail.append(panorama);
    };

    group.addEventListener?.('click', showDetail);
    group.addEventListener?.('focus', showDetail);
    svg.append(group);

    return { node, group, showDetail };
  });

  root.append(svg, detail);
  container.append(root);

  // Force-Directed Engine
  const simulation = runForceSimulation(physicsNodes, physicsEdges, width, height, () => {
    // Tick
    edgeElements.forEach(({ edge, line }) => {
      line.setAttribute('x1', edge.sourceNode.x);
      line.setAttribute('y1', edge.sourceNode.y);
      line.setAttribute('x2', edge.targetNode.x);
      line.setAttribute('y2', edge.targetNode.y);
    });
    nodeElements.forEach(({ node, group }) => {
      group.setAttribute('transform', `translate(${node.x} ${node.y})`);
    });
  });

  // Drag Interaction
  nodeElements.forEach(({ node, group, showDetail }) => {
    let isDragging = false;
    group.addEventListener('mousedown', (e) => {
      e.preventDefault();
      isDragging = true;
      showDetail();
      node.fx = node.x;
      node.fy = node.y;
      simulation.reheat();
      const onMouseMove = (moveEvent) => {
        if (!isDragging) return;
        const rect = svg.getBoundingClientRect();
        // Calculate SVG coordinate taking viewBox and scaling into account
        const scaleX = width / rect.width;
        const scaleY = height / rect.height;
        node.fx = (moveEvent.clientX - rect.left) * scaleX;
        node.fy = (moveEvent.clientY - rect.top) * scaleY;
        simulation.reheat();
      };
      const onMouseUp = () => {
        isDragging = false;
        node.fx = null;
        node.fy = null;
        documentObject.removeEventListener('mousemove', onMouseMove);
        documentObject.removeEventListener('mouseup', onMouseUp);
      };
      documentObject.addEventListener('mousemove', onMouseMove);
      documentObject.addEventListener('mouseup', onMouseUp);
    });
  });

  return root;
}

function collectPanelNames(text) {
  const names = new Set();
  const source = String(text || '');
  const statusPattern = new RegExp(`[『【\\[]\\s*(${NAME_PATTERN}?)(?:[·\\s]*(?:(?:主角|角色)[·\\s]*)?(?:状态|档案))\\s*[』】\\]]`, 'g');
  let match;
  while ((match = statusPattern.exec(source)) !== null) names.add(normalizeName(match[1]));
  extractRelationshipEdges(source).forEach((edge) => {
    names.add(edge.source);
    names.add(edge.target);
  });
  const presentMatch = source.match(/在场人物\s*[:：]\s*([^\n]+)/);
  if (presentMatch) {
    presentMatch[1].split(/[、，,／/与和]/).map(normalizeName).filter(Boolean).forEach((name) => names.add(name));
  }
  return [...names].filter(Boolean);
}

function collectCatalogMembers(value) {
  const members = [];
  const pattern = /(?:^|[。；;\n])\s*([\u3400-\u9fffA-Za-z·]{2,16})\s*[：:]\s*([^。；;\n]{2,160})/g;
  let match;
  while ((match = pattern.exec(String(value || ''))) !== null) {
    members.push({ name: normalizeName(match[1]), role: '设定角色', description: match[2].trim() });
  }
  return members;
}

function extractRelationshipEdges(value) {
  const edges = [];
  const pattern = new RegExp(`(${NAME_PATTERN})\\s*(↔|→|←|--?>)\\s*(${NAME_PATTERN})\\s*[:：]?\\s*([^\\n；;]{0,80})`, 'g');
  let match;
  while ((match = pattern.exec(String(value || ''))) !== null) {
    const left = normalizeName(match[1]);
    const right = normalizeName(match[3]);
    edges.push({
      source: match[2] === '←' ? right : left,
      target: match[2] === '←' ? left : right,
      label: cleanLabel(match[4])
    });
  }
  return edges;
}

function runForceSimulation(nodes, edges, width, height, onTick) {
  const center = { x: width / 2, y: height / 2 };
  let alpha = 1;
  const decay = 0.96;
  let animationFrameId;

  function tick() {
    alpha *= decay;
    if (alpha < 0.005) return;

    // Repulsion
    const k = 100;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const n1 = nodes[i];
        const n2 = nodes[j];
        const dx = n2.x - n1.x;
        const dy = n2.y - n1.y;
        let distSq = dx * dx + dy * dy;
        if (distSq === 0) distSq = 0.01;
        const dist = Math.sqrt(distSq);
        const force = (k * k) / dist;
        const fx = (dx / dist) * force * alpha;
        const fy = (dy / dist) * force * alpha;
        if (n1.fx == null) { n1.vx -= fx; n1.vy -= fy; }
        if (n2.fx == null) { n2.vx += fx; n2.vy += fy; }
      }
    }

    // Attraction (Edges)
    const idealLen = 140;
    edges.forEach(edge => {
      const n1 = edge.sourceNode;
      const n2 = edge.targetNode;
      const dx = n2.x - n1.x;
      const dy = n2.y - n1.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const force = (dist - idealLen) * 0.04 * alpha;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      if (n1.fx == null) { n1.vx += fx; n1.vy += fy; }
      if (n2.fx == null) { n2.vx -= fx; n2.vy -= fy; }
    });

    // Gravity
    const gravity = 0.08 * alpha;
    nodes.forEach(node => {
      if (node.fx == null) {
        node.vx += (center.x - node.x) * gravity;
        node.vy += (center.y - node.y) * gravity;
      }
    });

    // Update positions
    nodes.forEach(node => {
      if (node.fx != null) {
        node.x = node.fx;
        node.y = node.fy;
        node.vx = 0;
        node.vy = 0;
      } else {
        node.vx *= 0.6; // Friction
        node.vy *= 0.6;
        node.x += node.vx;
        node.y += node.vy;
        node.x = Math.max(20, Math.min(width - 20, node.x));
        node.y = Math.max(20, Math.min(height - 20, node.y));
      }
    });

    onTick();
    const raf = typeof globalThis.requestAnimationFrame === 'function'
      ? globalThis.requestAnimationFrame
      : (cb) => setTimeout(cb, 16);
    animationFrameId = raf(tick);
  }

  tick();

  const caf = typeof globalThis.cancelAnimationFrame === 'function'
    ? globalThis.cancelAnimationFrame
    : clearTimeout;

  return {
    reheat: () => {
      if (alpha < 0.2) {
        alpha = 0.5;
        caf(animationFrameId);
        tick();
      }
    },
    stop: () => caf(animationFrameId)
  };
}

function createSvgElement(documentObject, name) {
  return documentObject.createElementNS
    ? documentObject.createElementNS('http://www.w3.org/2000/svg', name)
    : documentObject.createElement(name);
}

function normalizeName(value) {
  return String(value || '').replace(/^[『【\[「“'\s]+|[』】\]」”'\s]+$/g, '').trim();
}

function cleanLabel(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 180);
}

function truncateLabel(value, maxLength) {
  const text = String(value || '');
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}
