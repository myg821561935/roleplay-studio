export const SCENE_AFFORDANCE_SPEC = 'lra.scene-affordance/v2';

const CAPABILITY_FIELD_PATTERN = /^(?:abilities|ability|skills|skill|techniques|technique|powers|power|talents|talent|spells|spell|功法|技能|能力|神通|术法|天赋)$/iu;
const ITEM_FIELD_PATTERN = /^(?:inventory|items|item|equipment|gear|weapons|weapon|resources|resource|物品|装备|道具|武器|持有物)$/iu;
const CAPABILITY_LABEL_PATTERN = /(?:灵根|功法|心法|刀法|剑法|身法|术|法诀|神通|能力|天赋|血脉|异能|技能|修为|境界)/u;
const NON_ITEM_PATTERN = /(?:见闻|情报|记录|消息|线索|经历|回忆|关系|承诺|任务)/u;
const ROUTE_PATTERN = /(?:出口|入口|门|窗|梯|走廊|通道|岔路|密道|后路|退路|桥|林|院|街|巷)/u;
const THREAT_PATTERN = /(?:坍塌|崩塌|逼近|袭来|扑来|刺来|劈来|砍来|爆裂|失控|追兵|火势|封死|倒计时|来不及|马上就要|眼看就要)/u;

export function buildSceneAffordanceSnapshot({
  memory = {},
  assistantContent = '',
  actor = '',
  location = '',
  turnFrame = null
} = {}) {
  const worldState = isRecord(memory?.worldState) ? memory.worldState : {};
  const protagonist = isRecord(worldState.protagonist) ? worldState.protagonist : {};
  const protagonistName = text(protagonist.name);
  const locationState = isRecord(worldState.location) ? worldState.location : {};
  const frameScene = collectTurnFrameScene(turnFrame);
  const narrativeScene = collectNarrativeScene(assistantContent);
  const resolvedLocation = text(frameScene.location)
    || text(location)
    || text(locationState.current)
    || text(locationState.name)
    || (typeof worldState.location === 'string' ? text(worldState.location) : '')
    || text(narrativeScene.location);

  const actors = collectActors(memory, { actor, protagonistName, presentActors: frameScene.actors });
  const structured = collectExplicitProtagonistAffordances(protagonist);
  const ledger = collectOwnedResources(worldState.resourceLedger, protagonistName);
  const nearby = collectNearby(locationState);
  const routes = uniqueEntries([
    ...frameScene.routes,
    ...collectNamedEntries(locationState.exits, 'worldState.location.exits'),
    ...collectNamedEntries(locationState.routes, 'worldState.location.routes'),
    ...nearby.filter((entry) => ROUTE_PATTERN.test(entry.label)),
    ...narrativeScene.routes
  ], 5);
  const routeLabels = new Set(routes.map((entry) => normalize(entry.label)));
  const interactables = uniqueEntries([
    ...frameScene.interactables,
    ...collectNamedEntries(locationState.interactables, 'worldState.location.interactables'),
    ...collectNamedEntries(locationState.objects, 'worldState.location.objects'),
    ...nearby.filter((entry) => !routeLabels.has(normalize(entry.label))),
    ...ledger.items,
    ...narrativeScene.interactables
  ].filter((entry) => !actors.some((candidate) => normalize(candidate.label) === normalize(entry.label))), 8);
  const capabilities = uniqueEntries([...structured.capabilities, ...ledger.capabilities], 6);
  const items = uniqueEntries([...structured.items, ...ledger.items], 6);
  const threats = uniqueEntries([...frameScene.threats, ...collectThreats(assistantContent)], 4);
  const constraints = collectConstraints(memory, protagonistName, ledger.resources);
  const time = resolveSceneTime(memory, worldState);
  const actionDomains = (Array.isArray(memory?.cardRuntime?.actionDomains) ? memory.cardRuntime.actionDomains : [])
    .map((entry) => ({ label: text(entry?.label || entry?.name), source: 'cardRuntime.actionDomains' }))
    .filter((entry) => entry.label)
    .slice(0, 6);

  const graphAffordances = discoverGraphAffordances({
    graph: memory?.knowledgeGraph,
    protagonistName,
    actorName: actor,
    presentActors: actors.map((entry) => entry.label),
    location: resolvedLocation,
    view: memory?.knowledgeGraph?.view || 'player'
  });

  const graphAllies = graphAffordances.allies;
  const graphThreats = graphAffordances.threats;
  const graphLeverage = graphAffordances.leverage;
  const graphRoutes = graphAffordances.routes;
  const questContext = graphAffordances.questContext;

  const mergedThreats = uniqueEntries([...threats, ...graphThreats], 4);
  const mergedRoutes = uniqueEntries([...routes, ...graphRoutes], 6);

  return {
    spec: SCENE_AFFORDANCE_SPEC,
    location: resolvedLocation,
    time,
    actors,
    threats: mergedThreats,
    routes: mergedRoutes,
    interactables,
    capabilities,
    items,
    constraints,
    actionDomains,
    graphAllies,
    graphLeverage,
    questContext,
    grounded: Boolean(
      resolvedLocation || actors.length || mergedThreats.length || mergedRoutes.length
      || interactables.length || capabilities.length || items.length || constraints.length
      || actionDomains.length || graphAllies.length || graphLeverage.length || questContext.length
    )
  };
}

function collectTurnFrameScene(turnFrame) {
  if (!isRecord(turnFrame) || turnFrame?.validation?.status !== 'accepted') {
    return { location: '', actors: [], routes: [], interactables: [], threats: [] };
  }
  const scene = isRecord(turnFrame.scene) ? turnFrame.scene : {};
  const affordances = isRecord(turnFrame.affordances) ? turnFrame.affordances : {};
  const entries = (value, source) => (Array.isArray(value) ? value : [])
    .map((label) => ({ label: text(label), source }))
    .filter((entry) => entry.label);
  return {
    location: text(scene.location),
    actors: entries(scene.presentActors, 'turnFrame.scene.presentActors'),
    routes: entries(affordances.routes, 'turnFrame.affordances.routes'),
    interactables: entries(affordances.interactables, 'turnFrame.affordances.interactables'),
    threats: entries(affordances.threats, 'turnFrame.affordances.threats')
  };
}

function collectNarrativeScene(value) {
  const source = String(value || '').slice(-1800);
  if (!source.trim()) return { location: '', routes: [], interactables: [] };

  const locations = [...source.matchAll(/(?:站|立|停|落|踏|走|进入|来到|抵达|身处|置身)(?:在|入|到|于)?([^，。！？；\n]{2,36}?(?:上|下|中|内|外|前|后|旁|边|口|处|间|侧))/gu)]
    .map((match) => compact(match[1], 48))
    .filter((label) => label && !/(?:时候|刹那|一瞬|片刻|同时)$/u.test(label))
    .filter((label) => !/(?:像|仿佛|似乎|宛如|好似|声音|目光|语气|光|影)/u.test(label));
  const named = [...source.matchAll(/(?:那|这|一|两|几|每|脚下的|面前的|身后的|远处的|深处的)?([\u3400-\u9fffA-Za-z0-9·‘’“”_-]{1,22}?(?:门|通道|甬道|隧道|石阶|台阶|出口|入口|岔路|路径|门缝|裂缝|石缝|凹槽|刻字|铭文|石碑|令牌|腰牌|玉简|陶片|残片|碎片|器物|光点|亮点|机关|铜铃|尸体|干尸|铜镜|玉板|印记|匣|盒|箱|柜|瓶|盏|窗|梯|桥|井|祭坛|阵法))/gu)]
    .map((match) => cleanNarrativeObjectLabel(compact(match[1], 36)))
    .filter((label) => label.length >= 2)
    .filter((label) => !/(?:像|仿佛|似乎|宛如|好似|声音|目光|语气|光点$)/u.test(label));
  const routeActions = [...source.matchAll(/(?:踏(?:亮|暗|有光|无光)处|走(?:单|双)数(?:步|阶)|沿[^，。！？；\n]{1,18}(?:前行|深入|折返)|悬走[^，。！？；\n]{0,16})/gu)]
    .map((match) => compact(match[0], 36));
  const isRoute = (label) => /(?:门|通道|甬道|隧道|石阶|台阶|出口|入口|岔路|路径|梯|桥|踏.+处|走.+步|沿.+(?:前行|深入|折返)|悬走)/u.test(label);
  return {
    location: locations.at(-1) || '',
    routes: uniqueEntries([...routeActions, ...named.filter(isRoute)]
      .map((label) => ({ label, source: 'assistant.provisional' })), 6),
    interactables: uniqueEntries(named.filter((label) => !isRoute(label))
      .map((label) => ({ label, source: 'assistant.provisional' })), 8)
  };
}

function cleanNarrativeObjectLabel(value) {
  const label = compact(value, 36);
  if (!label) return '';
  if (/(?:残片|碎片)$/u.test(label)) {
    const fragment = label.match(/(?:另一块|一块|那块|这块|更细薄的|细薄的)?(?:残片|碎片)$/u)?.[0];
    return fragment || label.replace(/^.*(?:靠近|接近|看向|望向|触碰|拿起|发现|露出|与|和|比)/u, '');
  }
  return label;
}

export function summarizeSceneAffordances(snapshot = {}) {
  const summarize = (entries, limit = 4) => (Array.isArray(entries) ? entries : [])
    .slice(0, limit)
    .map((entry) => text(entry?.label))
    .filter(Boolean);
  return {
    spec: snapshot.spec || SCENE_AFFORDANCE_SPEC,
    grounded: snapshot.grounded === true,
    location: text(snapshot.location),
    time: text(snapshot.time?.label),
    actors: summarize(snapshot.actors),
    threats: summarize(snapshot.threats, 2),
    routes: summarize(snapshot.routes),
    interactables: summarize(snapshot.interactables),
    capabilities: summarize(snapshot.capabilities),
    items: summarize(snapshot.items),
    constraints: summarize(snapshot.constraints, 3),
    allies: summarize(snapshot.graphAllies, 3),
    leverage: summarize(snapshot.graphLeverage, 3),
    quests: summarize(snapshot.questContext, 2)
  };
}

export function renderSceneAffordancePrompt(snapshot = {}) {
  if (!snapshot?.grounded) return '';
  const lines = [];
  const add = (label, values, limit = 5) => {
    const entries = (Array.isArray(values) ? values : [])
      .slice(0, limit)
      .map((entry) => text(entry?.label))
      .filter(Boolean);
    if (entries.length) lines.push(`${label}：${entries.join('；')}`);
  };
  if (snapshot.location) lines.push(`地点：${snapshot.location}`);
  if (snapshot.time?.label) lines.push(`时间：${snapshot.time.label}`);
  add('在场人物', snapshot.actors);
  add('即时威胁', snapshot.threats, 2);
  add('可用路径', snapshot.routes);
  add('可交互对象', snapshot.interactables);
  add('已确认能力', snapshot.capabilities);
  add('已确认持有物', snapshot.items);
  add('约束与承诺', snapshot.constraints, 3);
  add('可援引关系', snapshot.graphAllies, 3);
  add('关系筹码', snapshot.graphLeverage, 3);
  add('当前任务线索', snapshot.questContext, 2);
  if (lines.length) {
    lines.push('只能引用上述已确认条件；不得补造技能、装备、出口或保证行动成功。');
  }
  return lines.join('\n');
}

export function resolveAffordanceAnchors(action, snapshot = {}) {
  const source = text(action);
  const groups = ['actors', 'threats', 'routes', 'interactables', 'capabilities', 'items', 'constraints', 'graphAllies', 'graphLeverage', 'questContext'];
  const anchors = [];
  for (const group of groups) {
    for (const entry of Array.isArray(snapshot[group]) ? snapshot[group] : []) {
      const label = text(entry?.label);
      if (!label || !source.includes(label)) continue;
      anchors.push({ type: group, label, source: text(entry.source) || group });
    }
  }
  if (snapshot.location && source.includes(snapshot.location)) {
    anchors.push({ type: 'location', label: snapshot.location, source: 'worldState.location' });
  }
  return uniqueEntries(anchors, 8, (entry) => `${entry.type}:${entry.label}`);
}

function collectActors(memory, { actor, protagonistName, presentActors = [] }) {
  const currentAct = Array.isArray(memory?.characterRegistry?.currentAct?.members)
    ? memory.characterRegistry.currentAct.members : [];
  const worldCharacters = Array.isArray(memory?.worldState?.characters)
    ? memory.worldState.characters : [];
  const entries = [
    ...(Array.isArray(presentActors) ? presentActors : []),
    ...(actor ? [{ label: actor, source: 'closing-beat' }] : []),
    ...currentAct
      .filter((entry) => text(entry?.state || 'on-stage') === 'on-stage')
      .map((entry) => ({ label: text(entry?.name), source: 'characterRegistry.currentAct' })),
    ...worldCharacters
      .filter((entry) => isCharacterCurrentlyRelevant(entry, actor))
      .map((entry) => ({ label: text(entry?.name), source: 'worldState.characters' }))
  ].filter((entry) => entry.label && normalize(entry.label) !== normalize(protagonistName));
  return uniqueEntries(entries, 8);
}

function isCharacterCurrentlyRelevant(entry, actor) {
  const name = text(entry?.name);
  if (!name) return false;
  if (actor && normalize(name) === normalize(actor)) return true;
  const status = text(entry?.status);
  return !/(?:已离去|未登场|不在场|本轮未|留在.+(?:外|远处)|离开)/u.test(status)
    && /(?:在|当前|此刻|屋中|现场|面前|身旁|同行|等待|接触|对话)/u.test(status);
}

function collectExplicitProtagonistAffordances(protagonist) {
  const capabilities = [];
  const items = [];
  for (const [key, value] of Object.entries(protagonist || {})) {
    if (CAPABILITY_FIELD_PATTERN.test(key)) capabilities.push(...collectNamedEntries(value, `worldState.protagonist.${key}`));
    if (ITEM_FIELD_PATTERN.test(key)) items.push(...collectNamedEntries(value, `worldState.protagonist.${key}`));
  }
  return { capabilities, items };
}

function collectOwnedResources(resourceLedger, protagonistName) {
  const latest = new Map();
  for (const entry of Array.isArray(resourceLedger) ? resourceLedger : []) {
    const label = text(entry?.resource || entry?.name || entry?.title);
    const owner = text(entry?.owner);
    if (!label || !isOwnedByProtagonist(owner, protagonistName)) continue;
    latest.set(normalize(label), { label, source: 'worldState.resourceLedger', detail: text(entry?.restriction || entry?.status) });
  }
  const resources = [...latest.values()].slice(-10).reverse();
  return {
    resources,
    capabilities: resources.filter((entry) => CAPABILITY_LABEL_PATTERN.test(entry.label)),
    items: resources.filter((entry) => !CAPABILITY_LABEL_PATTERN.test(entry.label) && !NON_ITEM_PATTERN.test(entry.label))
  };
}

function isOwnedByProtagonist(owner, protagonistName) {
  if (!owner) return false;
  if (protagonistName && owner.includes(protagonistName)) return true;
  return /^(?:主角|玩家|user|protagonist)/iu.test(owner);
}

function collectNearby(locationState) {
  const source = locationState?.nearby;
  if (Array.isArray(source) || isRecord(source)) return collectNamedEntries(source, 'worldState.location.nearby');
  return text(source)
    .split(/[、，,；;\/|]/u)
    .map((label) => ({ label: label.trim(), source: 'worldState.location.nearby' }))
    .filter((entry) => entry.label.length >= 1 && entry.label.length <= 30);
}

function collectThreats(value) {
  return uniqueEntries(String(value || '')
    .split(/(?<=[。！？?!])/u)
    .map((sentence) => text(sentence))
    .filter((sentence) => THREAT_PATTERN.test(sentence))
    .slice(-2)
    .map((label) => ({ label: compact(label, 56), source: 'closing-beat' })), 2);
}

function collectConstraints(memory, protagonistName, resources) {
  const obligations = (Array.isArray(memory?.worldState?.obligations) ? memory.worldState.obligations : [])
    .filter((entry) => !/(?:完成|已完成|关闭|取消|fulfilled|resolved|completed|closed)/iu.test(text(entry?.status)))
    .filter((entry) => !protagonistName || [entry?.from, entry?.to, entry?.owner].some((value) => text(value).includes(protagonistName)))
    .slice(-3)
    .reverse()
    .map((entry) => ({
      label: compact(entry?.detail || entry?.obligation || entry?.title, 72),
      source: 'worldState.obligations'
    }));
  const restrictions = (Array.isArray(resources) ? resources : [])
    .filter((entry) => entry.detail)
    .slice(0, 2)
    .map((entry) => ({ label: compact(`${entry.label}：${entry.detail}`, 72), source: entry.source }));
  return uniqueEntries([...obligations, ...restrictions], 4);
}

function resolveSceneTime(memory, worldState) {
  const timelineLabel = text((Array.isArray(worldState.timeline) ? worldState.timeline.at(-1) : null)?.time);
  const clockLabel = text(memory?.simulation?.clock?.label) || text(memory?.simulation?.calendar?.label);
  const label = timelineLabel || clockLabel;
  return label ? { label, source: timelineLabel ? 'worldState.timeline' : 'simulation.clock' } : null;
}

function collectNamedEntries(value, source) {
  if (value === null || value === undefined) return [];
  if (typeof value === 'string' || typeof value === 'number') {
    return text(value).split(/[、，,；;\n]/u)
      .map((label) => ({ label: compact(label, 72), source }))
      .filter((entry) => entry.label);
  }
  if (Array.isArray(value)) return value.flatMap((entry) => collectNamedEntries(entry, source));
  if (!isRecord(value)) return [];
  const label = compact(value.name || value.title || value.label || value.resource || value.item || value.skill || value.ability, 72);
  if (label) return [{ label, source }];
  return Object.entries(value).flatMap(([key, entry]) => {
    if (typeof entry === 'boolean') return entry ? [{ label: text(key), source }] : [];
    if (typeof entry === 'string' || typeof entry === 'number') return [{ label: `${text(key)}：${text(entry)}`, source }];
    return [];
  });
}

function uniqueEntries(entries, limit, keyOf = (entry) => normalize(entry.label)) {
  const result = [];
  const seen = new Set();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const label = text(entry?.label);
    const key = keyOf({ ...entry, label });
    if (!label || !key || seen.has(key)) continue;
    seen.add(key);
    result.push({ ...entry, label });
    if (result.length >= limit) break;
  }
  return result;
}

function compact(value, limit) {
  const source = text(value).replace(/\s+/gu, ' ');
  return source.length > limit ? `${source.slice(0, limit - 1)}…` : source;
}

function normalize(value) {
  return text(value).replace(/[\s，。！？；：、"“”'‘’「」【】()（）]/gu, '').toLowerCase();
}

function text(value) {
  return String(value ?? '').trim();
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function discoverGraphAffordances({
  graph = null,
  protagonistName = '',
  actorName = '',
  presentActors = [],
  location = '',
  view = 'player'
} = {}) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  const result = {
    allies: [],
    threats: [],
    leverage: [],
    routes: [],
    questContext: []
  };
  if (!nodes.length || !edges.length) return result;

  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const visibleEdge = (edge) => view === 'director' || edge.visibility !== 'director';
  const edgeSourceId = (edge) => edge.sourceId || edge.source || edge.from || '';
  const edgeTargetId = (edge) => edge.targetId || edge.target || edge.to || '';
  const nodeName = (node) => text(node?.name || node?.label || node?.id);

  const focusNames = new Set();
  if (protagonistName) focusNames.add(normalize(protagonistName));
  if (actorName) focusNames.add(normalize(actorName));
  presentActors.forEach((name) => {
    if (name) focusNames.add(normalize(name));
  });

  const focusNodeIds = new Set();
  nodes.forEach((node) => {
    const name = nodeName(node);
    if (name && focusNames.has(normalize(name))) {
      focusNodeIds.add(node.id);
    }
    if (Array.isArray(node.aliases)) {
      node.aliases.forEach((alias) => {
        if (alias && focusNames.has(normalize(alias))) focusNodeIds.add(node.id);
      });
    }
  });

  const protagonistNodeId = graph.protagonistId || '';

  edges.forEach((edge) => {
    if (!visibleEdge(edge) || edge.status === 'superseded') return;
    const eSourceId = edgeSourceId(edge);
    const eTargetId = edgeTargetId(edge);
    const sourceNode = nodeMap.get(eSourceId);
    const targetNode = nodeMap.get(eTargetId);
    if (!sourceNode || !targetNode) return;

    const sourceName = nodeName(sourceNode);
    const targetName = nodeName(targetNode);
    const edgeLabel = text(edge.label);
    const involvesFocus = focusNodeIds.has(eSourceId) || focusNodeIds.has(eTargetId);
    const involvesProtagonist = protagonistNodeId
      && (eSourceId === protagonistNodeId || eTargetId === protagonistNodeId);

    if (!involvesFocus && !involvesProtagonist) return;

    const isSourceFocus = eSourceId === protagonistNodeId || focusNodeIds.has(eSourceId);
    const otherNode = isSourceFocus ? targetNode : sourceNode;
    const otherName = nodeName(otherNode);
    if (!otherName) return;

    const presentSet = new Set(presentActors.map((name) => normalize(name)));
    const isPresent = presentSet.has(normalize(otherName));
    const otherIsFocus = focusNodeIds.has(otherNode.id);

    if (edge.type === 'TRUSTS' || edge.type === 'RELATED_TO') {
      if (!otherIsFocus) {
        result.allies.push({
          label: compact(`${otherName}${edgeLabel ? `（${edgeLabel}）` : ''}`, 56),
          source: `graph.${edge.type}`,
          present: isPresent
        });
      }
    } else if (edge.type === 'HOSTILE_TO') {
      result.threats.push({
        label: compact(`${otherName}${edgeLabel ? `：${edgeLabel}` : ''}`, 56),
        source: `graph.${edge.type}`
      });
    } else if (edge.type === 'OWES') {
      const owesUs = eTargetId === protagonistNodeId || focusNodeIds.has(eTargetId);
      result.leverage.push({
        label: compact(
          owesUs ? `${otherName}欠你${edgeLabel || '人情'}` : `你欠${otherName}${edgeLabel || '人情'}`,
          64
        ),
        source: `graph.${edge.type}`
      });
    } else if (edge.type === 'KNOWS_SECRET') {
      if (eSourceId === protagonistNodeId || focusNodeIds.has(eSourceId)) {
        result.leverage.push({
          label: compact(`你掌握${otherName}的秘密${edgeLabel ? `：${edgeLabel}` : ''}`, 64),
          source: `graph.${edge.type}`
        });
      }
    } else if (edge.type === 'LOCATED_AT' && otherNode.type === 'Location') {
      if (location && normalize(otherName) !== normalize(location)) {
        result.routes.push({
          label: otherName,
          source: `graph.${edge.type}`
        });
      }
    } else if (edge.type === 'INVOLVED_IN' && otherNode.type === 'Quest') {
      result.questContext.push({
        label: compact(otherName, 64),
        source: `graph.${edge.type}`
      });
    }
  });

  const seen = new Set();
  const dedupe = (entries) => entries.filter((entry) => {
    const key = normalize(entry.label);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  result.allies = dedupe(result.allies).slice(0, 4);
  result.threats = dedupe(result.threats).slice(0, 3);
  result.leverage = dedupe(result.leverage).slice(0, 4);
  result.routes = dedupe(result.routes).slice(0, 4);
  result.questContext = dedupe(result.questContext).slice(0, 3);

  return result;
}
