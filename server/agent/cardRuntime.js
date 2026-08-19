export const CARD_RUNTIME_SPEC = 'narrative-engine.card-runtime/v1';
export const CARD_RUNTIME_FEEDBACK_SPEC = 'narrative-engine.card-runtime-feedback/v1';
export const CARD_RUNTIME_INTERACTION_SPEC = 'narrative-engine.card-runtime-interaction/v1';

const MAX_ACTORS = 16;
const MAX_THREADS = 8;
const MAX_FEEDBACK = 30;
const MAX_INTERACTION_OPTIONS = 4;

export function ensureCardRuntimeMemory(memory = {}, seeds = {}, { enabled = true } = {}) {
  const next = cloneRecord(memory);
  const derived = buildCardRuntimeBlueprint(seeds, { enabled });
  if (!derived.source.hasMaterial) return next;

  const existing = normalizeCardRuntime(next.cardRuntime);
  if (!existing) {
    next.cardRuntime = derived;
    return next;
  }

  next.cardRuntime = {
    ...existing,
    // The session setting is authoritative. A previously disabled derived
    // blueprint must not prevent the user from enabling it again.
    enabled: enabled !== false,
    source: {
      ...existing.source,
      currentFingerprint: derived.source.fingerprint,
      stale: existing.source.fingerprint !== derived.source.fingerprint
    }
  };
  return next;
}

export function buildCardRuntimeBlueprint({ characterCard, groupMembers, characterPresets, worldBook, worldSystems } = {}, { enabled = true } = {}) {
  const character = asRecord(characterCard);
  const groups = Array.isArray(groupMembers) ? groupMembers : [];
  const presets = Array.isArray(characterPresets) ? characterPresets : [];
  const entries = Array.isArray(worldBook) ? worldBook.filter((entry) => entry?.enabled !== false) : [];
  const systems = asRecord(worldSystems);
  const sourcePayload = {
    character: pickCharacterSource(character),
    groups: groups.map(pickActorSource),
    presets: presets.map((item) => pickActorSource(item?.characterCard || item)),
    worldBook: entries.map((entry) => ({
      id: stringValue(entry?.id, 120),
      title: stringValue(entry?.title, 160),
      keywords: uniqueStrings(entry?.keywords, 12, 80),
      category: stringValue(entry?.category || entry?.extensions?.category, 80)
    })),
    worldSystems: summarizeSystemSource(systems)
  };
  const actors = collectActors({ character, groups, presets, systems });
  const openThreads = collectOpenThreads({ character, entries, systems });
  const hasMaterial = Boolean(
    sourcePayload.character.name
    || actors.length
    || entries.length
    || sourcePayload.worldSystems.mappedCount
  );

  return {
    spec: CARD_RUNTIME_SPEC,
    enabled: enabled !== false && hasMaterial,
    source: {
      kind: 'derived-readonly',
      hasMaterial,
      characterName: sourcePayload.character.name,
      worldBookEntryCount: entries.length,
      fingerprint: fingerprint(sourcePayload),
      currentFingerprint: fingerprint(sourcePayload),
      stale: false
    },
    anchors: {
      identity: compactText([
        sourcePayload.character.name,
        sourcePayload.character.role,
        sourcePayload.character.description
      ].filter(Boolean).join(' · '), 420),
      portrayal: compactText([
        sourcePayload.character.personality,
        sourcePayload.character.speechStyle
      ].filter(Boolean).join('；'), 420),
      opening: compactText(sourcePayload.character.scenario || sourcePayload.character.firstMessage, 520)
    },
    actors,
    actionDomains: deriveActionDomains({ systems, entries, character }),
    openThreads,
    relationshipSeeds: collectRelationshipSeeds([...groups, ...presets.map((item) => item?.characterCard || item)]),
    interaction: createInteractionState(),
    feedback: []
  };
}

export function renderCardRuntimePrompt(memory, { maxChars = 1500 } = {}) {
  const runtime = normalizeCardRuntime(memory?.cardRuntime);
  if (!runtime?.enabled) return '';
  const lines = [
    '# 角色卡运行化层（会话派生）',
    '以下是从当前角色卡、世界书和已声明人物提取的只读运行索引；原始资源仍具有最高优先级。不得把潜在线索、人物关系或未确认后果写成既成事实。',
    runtime.anchors.identity ? `角色锚点：${runtime.anchors.identity}` : '',
    runtime.anchors.portrayal ? `演绎边界：${runtime.anchors.portrayal}` : '',
    runtime.anchors.opening ? `开局前提：${runtime.anchors.opening}` : '',
    runtime.actors.length ? `可运行人物：${runtime.actors.map((actor) => `${actor.name}${actor.role ? `（${actor.role}）` : ''}`).join('；')}` : '',
    runtime.actionDomains.length ? `可用互动域：${runtime.actionDomains.map((item) => item.label).join('、')}` : '',
    runtime.openThreads.length ? `已知待展开项：${runtime.openThreads.map((item) => item.title).join('；')}` : '',
    runtime.interaction.latestIntent
      ? `本轮玩家意图（尚未替玩家补写）：${runtime.interaction.latestIntent.label} · ${runtime.interaction.latestIntent.text}`
      : '',
    runtime.interaction.latestIntent
      ? '先直接回应这份玩家意图，再给出可观察的世界 / NPC 反馈；若结尾需要行动卡，只能使用当前场景中的具体人物、地点、物件或事件，不能把任何方向当作玩家已经选择。'
      : '',
    '用户的明确行动优先。只有可被当前世界状态和动作协议结算的后果，才能写入事件账本与关系状态。'
  ].filter(Boolean);
  return compactText(lines.join('\n'), maxChars);
}

export function beginCardRuntimeInteraction(memory = {}, { userMessage, generationType = 'normal' } = {}) {
  const next = cloneRecord(memory);
  const runtime = normalizeCardRuntime(next.cardRuntime);
  if (!runtime?.enabled) return { memory: next, interaction: null };

  const intent = normalizePlayerIntent(userMessage, generationType);
  if (!intent) return { memory: next, interaction: projectRuntimeInteraction(runtime.interaction) };
  const current = runtime.interaction.latestIntent;
  if (current?.turnId === intent.turnId && current.text === intent.text) {
    return { memory: next, interaction: projectRuntimeInteraction(runtime.interaction) };
  }

  runtime.interaction = {
    ...runtime.interaction,
    latestIntent: intent,
    options: buildInteractionOptions(runtime, { intent })
  };
  next.cardRuntime = runtime;
  return { memory: next, interaction: projectRuntimeInteraction(runtime.interaction) };
}

export function getCardRuntimeInteractionOptions(memory = {}, { limit = MAX_INTERACTION_OPTIONS } = {}) {
  const runtime = normalizeCardRuntime(memory?.cardRuntime);
  if (!runtime?.enabled) return [];
  const options = runtime.interaction.options.length
    ? runtime.interaction.options
    : buildInteractionOptions(runtime, { intent: runtime.interaction.latestIntent });
  return options.slice(0, clampInteger(limit, 0, MAX_INTERACTION_OPTIONS));
}

export function recordCardRuntimeFeedback(memory = {}, {
  userMessage,
  assistantMessage,
  adjudication,
  actionError
} = {}) {
  const next = cloneRecord(memory);
  const runtime = normalizeCardRuntime(next.cardRuntime);
  if (!runtime?.enabled) return { memory: next, feedback: null };

  const effects = (Array.isArray(adjudication?.effects) ? adjudication.effects : [])
    .filter((effect) => effect?.visibility === 'public')
    .slice(0, 4)
    .map((effect) => ({
      type: stringValue(effect.type, 80),
      summary: compactText(effect.reason || effect.path || effect.type, 180)
    }));
  const acceptedCount = Number(adjudication?.accepted?.length || 0);
  const status = actionError
    ? 'unresolved'
    : effects.length
      ? 'committed'
      : acceptedCount
        ? 'private'
        : 'observed';
  const feedback = {
    spec: CARD_RUNTIME_FEEDBACK_SPEC,
    turnId: stringValue(assistantMessage?.id, 160),
    status,
    intent: compactText(userMessage?.hiddenFromChat ? '' : userMessage?.content, 180),
    summary: feedbackSummary({ status, effects, acceptedCount }),
    effects
  };
  runtime.feedback = [...runtime.feedback, feedback].slice(-MAX_FEEDBACK);
  runtime.interaction = {
    ...runtime.interaction,
    latestOutcome: {
      turnId: feedback.turnId,
      status: feedback.status,
      summary: feedback.summary,
      publicEffectCount: effects.length
    },
    options: buildInteractionOptions(runtime, { intent: runtime.interaction.latestIntent })
  };
  next.cardRuntime = runtime;
  return { memory: next, feedback };
}

export function projectCardRuntime(runtimeInput, { includeFeedback = true } = {}) {
  const runtime = normalizeCardRuntime(runtimeInput);
  if (!runtime) return null;
  return {
    spec: CARD_RUNTIME_SPEC,
    enabled: runtime.enabled,
    source: {
      kind: runtime.source.kind,
      characterName: runtime.source.characterName,
      worldBookEntryCount: runtime.source.worldBookEntryCount,
      stale: runtime.source.stale === true
    },
    actionDomains: runtime.actionDomains.map((item) => ({ id: item.id, label: item.label })),
    actorCount: runtime.actors.length,
    openThreadCount: runtime.openThreads.length,
    interaction: projectRuntimeInteraction(runtime.interaction),
    ...(includeFeedback ? { feedback: structuredClone(runtime.feedback) } : {})
  };
}

function normalizeCardRuntime(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.spec !== CARD_RUNTIME_SPEC) return null;
  return {
    spec: CARD_RUNTIME_SPEC,
    enabled: value.enabled !== false,
    source: {
      kind: stringValue(value.source?.kind || 'derived-readonly', 80),
      hasMaterial: value.source?.hasMaterial === true,
      characterName: stringValue(value.source?.characterName, 120),
      worldBookEntryCount: clampInteger(value.source?.worldBookEntryCount, 0, 10000),
      fingerprint: stringValue(value.source?.fingerprint, 64),
      currentFingerprint: stringValue(value.source?.currentFingerprint || value.source?.fingerprint, 64),
      stale: value.source?.stale === true
    },
    anchors: {
      identity: compactText(value.anchors?.identity, 420),
      portrayal: compactText(value.anchors?.portrayal, 420),
      opening: compactText(value.anchors?.opening, 520)
    },
    actors: normalizeActors(value.actors),
    actionDomains: normalizeActionDomains(value.actionDomains),
    openThreads: normalizeThreads(value.openThreads),
    relationshipSeeds: normalizeRelationshipSeeds(value.relationshipSeeds),
    interaction: normalizeInteractionState(value.interaction),
    feedback: normalizeFeedback(value.feedback)
  };
}

function collectActors({ character, groups, presets, systems }) {
  const population = Array.isArray(systems.population?.profiles) ? systems.population.profiles : [];
  const sources = [character, ...groups, ...presets.map((item) => item?.characterCard || item), ...population];
  const seen = new Set();
  return sources.flatMap((source) => {
    const name = stringValue(source?.name || source?.title, 120);
    const key = name.toLocaleLowerCase('zh-CN');
    if (!name || seen.has(key) || seen.size >= MAX_ACTORS) return [];
    seen.add(key);
    return [{
      id: stringValue(source?.id || slugify(name), 120) || `actor-${seen.size}`,
      name,
      role: stringValue(source?.role || source?.summary || source?.description, 180),
      source: source === character ? 'character-card' : 'declared-resource'
    }];
  });
}

function collectOpenThreads({ character, entries, systems }) {
  const threads = [];
  entries.forEach((entry, index) => {
    const signals = `${entry?.title || ''} ${(entry?.keywords || []).join(' ')} ${entry?.category || ''}`;
    if (!/(任务|主线|剧情|事件|线索|谜|秘密|冲突|危机|开局|传闻)/i.test(signals)) return;
    const title = stringValue(entry?.title, 160);
    if (title && threads.length < MAX_THREADS) threads.push({ id: stringValue(entry?.id || `worldbook-${index + 1}`, 120), title, source: 'worldbook' });
  });
  const factionCount = Array.isArray(systems.factions?.entities) ? systems.factions.entities.length : 0;
  if (factionCount && threads.length < MAX_THREADS) threads.push({ id: 'factions', title: `已声明势力动向（${factionCount}）`, source: 'world-system' });
  return normalizeThreads(threads);
}

function collectRelationshipSeeds(inputs) {
  return inputs.flatMap((item) => {
    const name = stringValue(item?.name, 120);
    const relationship = stringValue(item?.relationship || item?.extensions?.relationship, 240);
    return name && relationship ? [{ name, relationship }] : [];
  }).slice(0, MAX_ACTORS);
}

function deriveActionDomains({ systems, entries, character }) {
  const signals = [
    character?.role,
    character?.description,
    character?.scenario,
    ...entries.flatMap((entry) => [entry?.title, entry?.category, ...(entry?.keywords || [])])
  ].filter(Boolean).join(' ');
  const domains = [
    { id: 'observe', label: '观察与调查' },
    { id: 'engage', label: '交涉与互动' },
    { id: 'explore', label: '移动与探索' }
  ];
  if (Array.isArray(systems.cultivation?.rules) && systems.cultivation.rules.length || /修行|功法|境界|法术|灵根|武学|内力/.test(signals)) {
    domains.push({ id: 'practice', label: '修行与施展' });
  }
  if (Array.isArray(systems.economy?.rules) && systems.economy.rules.length || /交易|商会|货币|银两|灵石|市场/.test(signals)) {
    domains.push({ id: 'trade', label: '交易与筹备' });
  }
  if (/战斗|追捕|追杀|决斗|怪物|妖|危机|战争/.test(signals)) {
    domains.push({ id: 'intervene', label: '干预与应对' });
  }
  return normalizeActionDomains(domains);
}

function pickCharacterSource(value) {
  return {
    name: stringValue(value?.name, 120),
    role: stringValue(value?.role, 160),
    description: compactText(value?.description, 600),
    personality: compactText(value?.personality, 420),
    speechStyle: compactText(value?.speechStyle, 280),
    scenario: compactText(value?.scenario, 600),
    firstMessage: compactText(value?.firstMessage, 600)
  };
}

function pickActorSource(value) {
  return {
    id: stringValue(value?.id, 120),
    name: stringValue(value?.name, 120),
    role: stringValue(value?.role, 160),
    relationship: stringValue(value?.relationship || value?.extensions?.relationship, 240)
  };
}

function summarizeSystemSource(systems) {
  return {
    mappedCount: clampInteger(systems?.source?.mappedCount, 0, 10000),
    topologyCount: Array.isArray(systems?.topology?.nodes) ? systems.topology.nodes.length : 0,
    populationCount: Array.isArray(systems?.population?.profiles) ? systems.population.profiles.length : 0,
    factionCount: Array.isArray(systems?.factions?.entities) ? systems.factions.entities.length : 0,
    cultivationCount: Array.isArray(systems?.cultivation?.rules) ? systems.cultivation.rules.length : 0,
    economyCount: Array.isArray(systems?.economy?.rules) ? systems.economy.rules.length : 0
  };
}

function normalizeActors(items) {
  const seen = new Set();
  return (Array.isArray(items) ? items : []).flatMap((item, index) => {
    const name = stringValue(item?.name, 120);
    const key = name.toLocaleLowerCase('zh-CN');
    if (!name || seen.has(key) || seen.size >= MAX_ACTORS) return [];
    seen.add(key);
    return [{
      id: stringValue(item?.id || slugify(name), 120) || `actor-${index + 1}`,
      name,
      role: stringValue(item?.role, 180),
      source: stringValue(item?.source || 'declared-resource', 80)
    }];
  });
}

function normalizeActionDomains(items) {
  const seen = new Set();
  return (Array.isArray(items) ? items : []).flatMap((item) => {
    const id = stringValue(item?.id, 64);
    const label = stringValue(item?.label, 80);
    if (!id || !label || seen.has(id)) return [];
    seen.add(id);
    return [{ id, label }];
  }).slice(0, 8);
}

function normalizeThreads(items) {
  const seen = new Set();
  return (Array.isArray(items) ? items : []).flatMap((item, index) => {
    const title = stringValue(item?.title, 160);
    const id = stringValue(item?.id || `thread-${index + 1}`, 120);
    if (!title || seen.has(title) || seen.size >= MAX_THREADS) return [];
    seen.add(title);
    return [{ id, title, source: stringValue(item?.source || 'derived', 80) }];
  });
}

function normalizeRelationshipSeeds(items) {
  return (Array.isArray(items) ? items : []).flatMap((item) => {
    const name = stringValue(item?.name, 120);
    const relationship = stringValue(item?.relationship, 240);
    return name && relationship ? [{ name, relationship }] : [];
  }).slice(0, MAX_ACTORS);
}

function createInteractionState() {
  return {
    spec: CARD_RUNTIME_INTERACTION_SPEC,
    latestIntent: null,
    latestOutcome: null,
    options: []
  };
}

function normalizeInteractionState(value) {
  const source = asRecord(value);
  return {
    spec: CARD_RUNTIME_INTERACTION_SPEC,
    latestIntent: normalizeIntentRecord(source.latestIntent),
    latestOutcome: normalizeOutcomeRecord(source.latestOutcome),
    options: normalizeInteractionOptions(source.options)
  };
}

function normalizePlayerIntent(userMessage, generationType) {
  const source = asRecord(userMessage);
  const text = compactText(source.hiddenFromChat ? '' : source.content, 180);
  if (!text || source.kind === 'continuation' || generationType === 'continue') return null;
  const kind = classifyIntentKind(text);
  return {
    turnId: stringValue(source.id, 160),
    kind,
    label: intentLabel(kind),
    text
  };
}

function normalizeIntentRecord(value) {
  const source = asRecord(value);
  const text = compactText(source.text, 180);
  if (!text) return null;
  const kind = normalizeIntentKind(source.kind);
  return {
    turnId: stringValue(source.turnId, 160),
    kind,
    label: intentLabel(kind),
    text
  };
}

function normalizeOutcomeRecord(value) {
  const source = asRecord(value);
  const summary = compactText(source.summary, 240);
  if (!summary) return null;
  const status = ['committed', 'private', 'observed', 'unresolved'].includes(source.status)
    ? source.status
    : 'observed';
  return {
    turnId: stringValue(source.turnId, 160),
    status,
    summary,
    publicEffectCount: clampInteger(source.publicEffectCount, 0, 4)
  };
}

function projectRuntimeInteraction(interactionInput) {
  const interaction = normalizeInteractionState(interactionInput);
  return {
    spec: CARD_RUNTIME_INTERACTION_SPEC,
    latestIntent: interaction.latestIntent ? {
      kind: interaction.latestIntent.kind,
      label: interaction.latestIntent.label,
      text: interaction.latestIntent.text
    } : null,
    latestOutcome: interaction.latestOutcome ? { ...interaction.latestOutcome } : null,
    options: [...interaction.options]
  };
}

function buildInteractionOptions(runtime, { intent = null } = {}) {
  const intentText = compactText(intent?.text, 180);
  // This projection is for the runtime inspector only. It must be anchored
  // to the user's actual turn rather than suggesting generic actions from a
  // card's broad domains or its opening description.
  if (!intentText) return [];
  const options = [];
  const thread = selectInteractionThread(runtime.openThreads, intentText);
  const actor = selectInteractionActor(runtime.actors, intent);

  if (actor && thread) {
    options.push(`向${actor.name}核实「${thread.title}」与本轮行动的关联`);
    options.push(`请${actor.name}说明「${thread.title}」下一步可验证的线索`);
  } else if (actor) {
    options.push(`继续向${actor.name}核实「${intentText}」涉及的关键信息`);
  }
  if (thread && !actor) options.push(`围绕「${thread.title}」核实本轮行动尚未确认的后续`);
  return normalizeInteractionOptions(options);
}

function selectInteractionActor(actors, intent) {
  const source = Array.isArray(actors) ? actors : [];
  if (!source.length) return null;
  const text = String(intent?.text || '');
  return source.find((actor) => actor?.name && text.includes(actor.name)) || null;
}

function selectInteractionThread(threads, intentText) {
  const source = Array.isArray(threads) ? threads : [];
  const text = String(intentText || '');
  return source.find((thread) => thread?.title && text.includes(thread.title)) || null;
}

function normalizeInteractionOptions(items) {
  const seen = new Set();
  return (Array.isArray(items) ? items : []).flatMap((item) => {
    const text = compactText(item, 120);
    if (!text || seen.has(text) || !/[\p{L}\p{N}]/u.test(text)) return [];
    seen.add(text);
    return text;
  }).slice(0, MAX_INTERACTION_OPTIONS);
}

function classifyIntentKind(text) {
  if (/(?:问|询问|追问|回答|交谈|说|告诉|解释|商量|请求)/u.test(text)) return 'engage';
  if (/(?:观察|查看|检查|调查|搜查|打量|寻找|线索|追查)/u.test(text)) return 'observe';
  if (/(?:前往|离开|进入|跟随|赶往|移动|探索|绕到|去)/u.test(text)) return 'explore';
  if (/(?:战斗|攻击|拔剑|出手|追捕|阻止|救|对抗|介入)/u.test(text)) return 'intervene';
  if (/(?:修炼|修行|施法|运功|功法|炼制|疗伤)/u.test(text)) return 'practice';
  if (/(?:购买|交易|出售|交换|筹备|雇佣|借用)/u.test(text)) return 'trade';
  return 'freeform';
}

function normalizeIntentKind(value) {
  const kind = stringValue(value, 40);
  return ['engage', 'observe', 'explore', 'intervene', 'practice', 'trade', 'freeform'].includes(kind)
    ? kind
    : 'freeform';
}

function intentLabel(kind) {
  return {
    engage: '交谈与交涉',
    observe: '观察与调查',
    explore: '移动与探索',
    intervene: '干预与应对',
    practice: '修行与施展',
    trade: '交易与筹备',
    freeform: '自主行动'
  }[kind] || '自主行动';
}

function normalizeFeedback(items) {
  return (Array.isArray(items) ? items : []).flatMap((item) => {
    const status = ['committed', 'private', 'observed', 'unresolved'].includes(item?.status) ? item.status : 'observed';
    return [{
      spec: CARD_RUNTIME_FEEDBACK_SPEC,
      turnId: stringValue(item?.turnId, 160),
      status,
      intent: compactText(item?.intent, 180),
      summary: compactText(item?.summary, 240),
      effects: (Array.isArray(item?.effects) ? item.effects : []).flatMap((effect) => {
        const type = stringValue(effect?.type, 80);
        const summary = compactText(effect?.summary, 180);
        return type && summary ? [{ type, summary }] : [];
      }).slice(0, 4)
    }];
  }).slice(-MAX_FEEDBACK);
}

function feedbackSummary({ status, effects, acceptedCount }) {
  if (status === 'committed') return `已写入 ${effects.length} 项公开世界反馈。`;
  if (status === 'private') return '本轮存在仅限导演视图的状态裁定，未向玩家侧栏展开。';
  if (status === 'unresolved') return '本轮未形成可确认的运行时裁定。';
  return acceptedCount ? '本轮裁定未产生公开世界反馈。' : '本轮保持既有公开世界状态。';
}

function fingerprint(value) {
  let hash = 2166136261;
  for (const char of JSON.stringify(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cloneRecord(value) {
  return structuredClone(asRecord(value));
}

function compactText(value, max = 240) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function stringValue(value, max = 240) {
  return compactText(value, max);
}

function uniqueStrings(values, maxItems, maxLength) {
  const seen = new Set();
  return (Array.isArray(values) ? values : []).flatMap((value) => {
    const text = stringValue(value, maxLength);
    if (!text || seen.has(text) || seen.size >= maxItems) return [];
    seen.add(text);
    return text;
  });
}

function clampInteger(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLocaleLowerCase('zh-CN')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}
