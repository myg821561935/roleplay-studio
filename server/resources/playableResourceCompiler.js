import { estimateTokens } from '../agent/token.js';
import { isWorldBookCharacterProfileEntry } from '../character/characterContentMode.js';
import { normalizeCalendarProfile } from '../simulation/calendarEngine.js';

export const WORLD_SYSTEMS_SPEC = 'narrative-engine.world-systems/v1';

export const DEFAULT_WORLD_BOOK_RUNTIME_LIMITS = Object.freeze({
  maxTokens: 6000,
  constantRatio: 0.4,
  maxInjectedEntries: 15
});

const CHARACTER_TEXT_BUDGETS = {
  role: 800,
  description: 6000,
  personality: 3200,
  scenario: 4200,
  firstMessage: 6000,
  creatorNotes: 1600,
  systemPrompt: 8000,
  postHistoryInstructions: 4000
};

const SAFE_EXTENSION_KEYS = new Set([
  'speech',
  'speechStyle',
  'speech_style',
  'goals',
  'knowledge',
  'knownInformation',
  'relationships',
  'local_roleplay_agent'
]);

export function compilePlayableCharacterCard(input = {}) {
  const source = structuredClone(input || {});
  const truncatedFields = [];
  const card = {
    name: clipText(source.name, 160, 'name', truncatedFields) || '未命名角色',
    role: clipText(source.role, CHARACTER_TEXT_BUDGETS.role, 'role', truncatedFields),
    description: clipText(source.description, CHARACTER_TEXT_BUDGETS.description, 'description', truncatedFields),
    personality: clipText(source.personality, CHARACTER_TEXT_BUDGETS.personality, 'personality', truncatedFields),
    scenario: clipText(source.scenario, CHARACTER_TEXT_BUDGETS.scenario, 'scenario', truncatedFields),
    firstMessage: clipText(source.firstMessage, CHARACTER_TEXT_BUDGETS.firstMessage, 'firstMessage', truncatedFields),
    exampleDialog: compileTextList(source.exampleDialog, {
      maxItems: 12,
      maxItemChars: 1600,
      field: 'exampleDialog',
      truncatedFields
    }),
    creatorNotes: clipText(source.creatorNotes, CHARACTER_TEXT_BUDGETS.creatorNotes, 'creatorNotes', truncatedFields),
    systemPrompt: clipText(source.systemPrompt, CHARACTER_TEXT_BUDGETS.systemPrompt, 'systemPrompt', truncatedFields),
    postHistoryInstructions: clipText(
      source.postHistoryInstructions,
      CHARACTER_TEXT_BUDGETS.postHistoryInstructions,
      'postHistoryInstructions',
      truncatedFields
    ),
    alternateGreetings: compileTextList(source.alternateGreetings, {
      maxItems: 8,
      maxItemChars: 2400,
      field: 'alternateGreetings',
      truncatedFields
    }),
    tags: Array.isArray(source.tags) ? source.tags.map(String).slice(0, 40) : [],
    creator: String(source.creator || ''),
    characterVersion: String(source.characterVersion || ''),
    sourceSpec: String(source.sourceSpec || ''),
    portrait: source.portrait ? structuredClone(source.portrait) : null,
    extensions: compileSafeExtensions(source.extensions),
    enabled: source.enabled !== false
  };
  const sourceEstimatedTokens = estimateTokens(JSON.stringify(source));
  const runtimeEstimatedTokens = estimateTokens(JSON.stringify(card));
  const report = {
    spec: 'narrative-engine.playable-character/v1',
    sourceEstimatedTokens,
    runtimeEstimatedTokens,
    savedTokens: Math.max(0, sourceEstimatedTokens - runtimeEstimatedTokens),
    rawExcluded: Boolean(source.raw),
    truncatedFields: [...new Set(truncatedFields)],
    safeExtensionKeys: Object.keys(card.extensions || {})
  };
  card.extensions = {
    ...(card.extensions || {}),
    local_roleplay_agent: {
      ...(card.extensions?.local_roleplay_agent || {}),
      playableCopy: report
    }
  };
  return { card, report };
}

export function compilePlayableWorldBook(entries = []) {
  const compiled = compilePlayableWorldBookEntries(entries);
  return {
    ...compiled,
    worldSystems: compileStructuredWorldSystems(compiled.entries)
  };
}

function compilePlayableWorldBookEntries(entries = []) {
  const sourceEntries = Array.isArray(entries) ? entries : [];
  const runtimeEntries = [];
  const blockedEntries = [];
  const nativeBehaviors = [];

  sourceEntries.forEach((entry, index) => {
    const content = String(entry?.content || '');
    if (!containsExecutableWorldBookContent(content)) {
      runtimeEntries.push(structuredClone(entry));
      return;
    }

    const title = String(entry?.title || `条目 ${index + 1}`);
    blockedEntries.push({
      id: String(entry?.id || ''),
      title,
      reason: '依赖 EJS、脚本或动态模板运行时'
    });
    nativeBehaviors.push(...inferNativeControllerBehaviors(title));
  });

  const behaviorList = [...new Set(nativeBehaviors)];
  if (behaviorList.length) {
    runtimeEntries.unshift({
      id: 'community-runtime-compatibility-contract',
      title: '社区卡原生运行契约',
      keywords: [],
      content: [
        '以下规则由原卡的动态控制器安全转换而来。不得执行原始 JavaScript、EJS、DOM 或 iframe；使用世界状态、事件账本、角色关系和动作协议表达同类行为。',
        ...behaviorList.map((item) => `- ${item}`),
        '- 若原脚本中的具体条件未被声明式映射，不得臆造为已执行；应依据当前世界书、地点、角色已知信息和既有状态保守裁定。'
      ].join('\n'),
      enabled: true,
      constant: true,
      depth: 0,
      priority: 10000,
      insertionOrder: -10000,
      matchMode: 'keyword',
      logic: 'any',
      source: 'playable-derivative'
    });
  }

  return {
    entries: runtimeEntries,
    report: {
      spec: 'narrative-engine.playable-worldbook/v1',
      sourceCount: sourceEntries.length,
      runtimeCount: runtimeEntries.length,
      blockedCount: blockedEntries.length,
      blockedEntries,
      nativeBehaviors: behaviorList,
      safetyMode: blockedEntries.length ? 'safe-degradation' : 'complete-mapping'
    }
  };
}

export function estimateWorldBookRuntimeProfile(entries = [], {
  maxTokens = DEFAULT_WORLD_BOOK_RUNTIME_LIMITS.maxTokens,
  constantRatio = DEFAULT_WORLD_BOOK_RUNTIME_LIMITS.constantRatio,
  maxInjectedEntries = DEFAULT_WORLD_BOOK_RUNTIME_LIMITS.maxInjectedEntries,
  maxConstantEntryTokens,
  maxTriggeredEntryTokens
} = {}) {
  const sourceEntries = Array.isArray(entries) ? entries : [];
  const compiled = compilePlayableWorldBookEntries(sourceEntries);
  const playableEntries = compiled.entries
    .filter((entry) => entry && entry.enabled !== false && String(entry.content || '').trim());
  const sourceEnabledEntries = sourceEntries
    .filter((entry) => entry && entry.enabled !== false && String(entry.content || '').trim());
  const tokenLimit = normalizeBudget(maxTokens, DEFAULT_WORLD_BOOK_RUNTIME_LIMITS.maxTokens);
  const ratio = Number.isFinite(Number(constantRatio))
    ? Math.min(0.9, Math.max(0.1, Number(constantRatio)))
    : DEFAULT_WORLD_BOOK_RUNTIME_LIMITS.constantRatio;
  const constantTokenCap = Math.max(1, Math.floor(tokenLimit * ratio));
  const constantEntryLimit = normalizeBudget(
    maxConstantEntryTokens,
    Math.max(240, Math.floor(tokenLimit * 0.23))
  );
  const triggeredEntryLimit = normalizeBudget(
    maxTriggeredEntryTokens,
    Math.max(320, Math.floor(tokenLimit * 0.3))
  );
  const constantEntries = playableEntries
    .filter((entry) => entry.constant === true)
    .sort(compareWorldBookBudgetPriority);
  const triggeredEntries = playableEntries.filter((entry) => entry.constant !== true);
  const constantBudget = budgetWorldBookEntries(constantEntries, {
    maxTokens: constantTokenCap,
    maxEntryTokens: constantEntryLimit
  });
  const triggeredTokenCap = Math.max(0, tokenLimit - constantBudget.report.usedTokens);
  const triggeredEntryCountLimit = normalizeBudget(
    maxInjectedEntries,
    DEFAULT_WORLD_BOOK_RUNTIME_LIMITS.maxInjectedEntries
  );
  const triggeredUpperBound = triggeredEntries
    .map((entry) => estimateBudgetedWorldBookEntryTokens(entry, triggeredEntryLimit))
    .sort((left, right) => right - left)
    .slice(0, triggeredEntryCountLimit)
    .reduce((sum, tokens) => sum + tokens, 0);
  const estimatedPerTurnTokens = Math.min(
    tokenLimit,
    constantBudget.report.usedTokens + Math.min(triggeredTokenCap, triggeredUpperBound)
  );

  return {
    spec: 'narrative-engine.worldbook-runtime-profile/v1',
    mode: 'constant-and-triggered',
    source: {
      entryCount: sourceEnabledEntries.length,
      estimatedTokens: estimateWorldBookEntriesTokens(sourceEnabledEntries)
    },
    playable: {
      entryCount: playableEntries.length,
      estimatedTokens: estimateWorldBookEntriesTokens(playableEntries),
      blockedCount: compiled.report.blockedCount
    },
    alwaysOn: {
      entryCount: constantEntries.length,
      sourceTokens: estimateWorldBookEntriesTokens(constantEntries),
      selectedCount: constantBudget.report.selectedCount,
      omittedCount: constantBudget.report.omittedCount,
      truncatedCount: constantBudget.report.truncatedCount,
      tokenCap: constantTokenCap,
      estimatedTokens: constantBudget.report.usedTokens
    },
    triggered: {
      candidateCount: triggeredEntries.length,
      sourceTokens: estimateWorldBookEntriesTokens(triggeredEntries),
      maxSelectedCount: triggeredEntryCountLimit,
      tokenCap: triggeredTokenCap
    },
    perTurnTokenCap: tokenLimit,
    estimatedPerTurnTokens
  };
}

export function compareWorldBookBudgetPriority(left = {}, right = {}) {
  return Number(right.priority ?? right.order ?? 0) - Number(left.priority ?? left.order ?? 0)
    || Number(left.insertionOrder ?? left.insertion_order ?? left.order ?? 0)
      - Number(right.insertionOrder ?? right.insertion_order ?? right.order ?? 0)
    || String(left.title || '').localeCompare(String(right.title || ''));
}

export function compileStructuredWorldSystems(entries = []) {
  const systems = {
    spec: WORLD_SYSTEMS_SPEC,
    topology: { nodes: [], edges: [], currentNodeId: '' },
    population: { profiles: [], scheduleRules: [] },
    factions: { entities: [], relations: [] },
    calendar: { name: '', era: '', dayLabel: '', rules: [] },
    economy: { currencies: [], markets: [], rules: [] },
    cultivation: { paths: [], scales: [], backlash: [], rules: [] },
    source: { entryCount: 0, mappedCount: 0 }
  };
  const sourceEntries = (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry && entry.enabled !== false && entry.id !== 'community-runtime-compatibility-contract');
  systems.source.entryCount = sourceEntries.length;

  sourceEntries.slice(0, 600).forEach((entry, index) => {
    const title = String(entry.title || '').trim();
    if (!title) return;
    const content = String(entry.content || '');
    const staticContent = summarizeStaticLore(content, 2400);
    const signals = [
      title,
      ...(Array.isArray(entry.keywords) ? entry.keywords : []),
      entry.category,
      entry.comment,
      entry?.extensions?.category,
      entry?.extensions?.group,
      staticContent
    ].filter(Boolean).join(' ');
    const record = createWorldSystemRecord(entry, index);
    const calendarProfile = normalizeCalendarProfile(
      entry?.extensions?.local_roleplay_agent?.calendarProfile
      || entry?.extensions?.calendarProfile
      || entry?.calendarProfile
    );
    let mapped = false;

    // Character profiles describe one actor, not the world's factions,
    // economy or cultivation system. Their prose commonly mentions 宗门、灵石、
    // 灵根 and 功法, so broad keyword matching would otherwise copy the same
    // entry into several unrelated world systems.
    if (isWorldBookCharacterProfileEntry(entry)) {
      const schedules = extractScheduleSlots(content);
      systems.population.profiles.push({
        ...record,
        schedules
      });
      if (schedules.length) systems.population.scheduleRules.push(record);
      systems.source.mappedCount += 1;
      return;
    }

    // Variable protocols and compatibility contracts control the runtime.
    // They are not lore and must never be projected as places, calendars or
    // world rules merely because their instructions mention time and location.
    if (isOperationalWorldBookEntry(entry)) return;

    if (/(?:地点|区域|地理|疆域|国家|城镇|城池|州郡|山川|宗门驻地|据点|要塞|墟市)/i.test(signals)) {
      systems.topology.nodes.push({
        ...record,
        kind: inferTopologyKind(`${title} ${staticContent}`)
      });
      systems.topology.edges.push(...extractTopologyEdges(content, record));
      mapped = true;
    }
    if (/(?:人物|角色|NPC|众生|居民|名录|日程|行程)/i.test(signals)) {
      const schedules = extractScheduleSlots(content);
      systems.population.profiles.push({
        ...record,
        schedules
      });
      if (schedules.length || /(?:日程|行程|作息|轮值|值守|每日|每夜)/i.test(signals)) {
        systems.population.scheduleRules.push(record);
      }
      mapped = true;
    }
    if (/(?:势力|阵营|国家|朝廷|宗门|门派|世家|学派|组织)/i.test(signals)) {
      systems.factions.entities.push(record);
      systems.factions.relations.push(...extractFactionRelations(content, record));
      mapped = true;
    }
    if (/(?:历法|时间|日期|节气|季节|气候|渊历|时辰|天候)/i.test(signals)) {
      systems.calendar.rules.push(record);
      if (!systems.calendar.name) {
        systems.calendar.name = extractCalendarName(`${title}\n${staticContent}`) || title.slice(0, 80);
      }
      if (!systems.calendar.dayLabel) {
        systems.calendar.dayLabel = extractCalendarDayLabel(staticContent);
      }
      mapped = true;
    }
    if (calendarProfile) {
      // A profile is opt-in, declarative world data. It gives imported and
      // original worlds the same clock semantics without executing card code.
      if (!systems.calendar.profile) systems.calendar.profile = calendarProfile;
      mapped = true;
    }
    if (/(?:经济|物价|货币|税率|税制|市场|贸易|商会|交易|灵石|白银|飞票)/i.test(signals)) {
      systems.economy.rules.push(record);
      systems.economy.currencies.push(...extractCurrencyTerms(`${title}\n${content}`));
      if (/(?:市场|墟市|商会|工坊|店铺|拍卖|物价|交易)/i.test(signals)) {
        systems.economy.markets.push(record);
      }
      mapped = true;
    }
    if (/(?:修行|修炼|功法|境界|道途|道脉|破境|反噬|暗伤|刻度|战斗|灵根|心炉|冥契)/i.test(signals)) {
      systems.cultivation.rules.push(record);
      systems.cultivation.scales.push(...extractScaleTerms(`${title}\n${content}`));
      if (/(?:道途|道脉|学派|修行体系|功法体系|传承)/i.test(signals)) {
        systems.cultivation.paths.push(record);
      }
      if (/(?:反噬|暗伤|代价|异化|走火入魔)/i.test(`${title}\n${record.summary}`)) {
        systems.cultivation.backlash.push(record);
      }
      mapped = true;
    }

    if (mapped) systems.source.mappedCount += 1;
  });

  systems.topology.nodes = uniqueSystemRecords(systems.topology.nodes, 240);
  systems.topology.edges = uniqueSystemRelations(systems.topology.edges, 400);
  systems.population.profiles = uniqueSystemRecords(systems.population.profiles, 160);
  systems.population.scheduleRules = uniqueSystemRecords(systems.population.scheduleRules, 80);
  systems.factions.entities = uniqueSystemRecords(systems.factions.entities, 120);
  systems.factions.relations = uniqueSystemRelations(systems.factions.relations, 240);
  systems.calendar.rules = uniqueSystemRecords(systems.calendar.rules, 80);
  systems.economy.markets = uniqueSystemRecords(systems.economy.markets, 80);
  systems.economy.rules = uniqueSystemRecords(systems.economy.rules, 100);
  systems.economy.currencies = [...new Set(systems.economy.currencies)].slice(0, 30);
  systems.cultivation.paths = uniqueSystemRecords(systems.cultivation.paths, 100);
  systems.cultivation.rules = uniqueSystemRecords(systems.cultivation.rules, 120);
  systems.cultivation.scales = [...new Set(systems.cultivation.scales)].slice(0, 40);
  systems.cultivation.backlash = uniqueSystemRecords(systems.cultivation.backlash, 40);
  return systems;
}

function isOperationalWorldBookEntry(entry) {
  const title = String(entry?.title || entry?.name || '').replace(/\s+/g, ' ').trim();
  return /^(?:\[?mvu[_ -]?update\]?\s*)?(?:变量更新规则|变量输出格式|变量列表|变量清单)$/iu.test(title)
    || /^(?:社区卡原生运行契约|社区资源兼容运行契约)$/u.test(title);
}

export function budgetWorldBookEntries(entries = [], {
  maxTokens = 6000,
  maxEntryTokens = 1600
} = {}) {
  const tokenLimit = normalizeBudget(maxTokens, 6000);
  const entryLimit = Math.min(tokenLimit, normalizeBudget(maxEntryTokens, 1600));
  const accepted = [];
  const omittedIds = [];
  let usedTokens = 0;
  let truncatedCount = 0;

  for (const entry of Array.isArray(entries) ? entries : []) {
    const remaining = tokenLimit - usedTokens;
    if (remaining <= 0) {
      omittedIds.push(entry?.id);
      continue;
    }
    const titleTokens = estimateTokens(String(entry?.title || ''));
    const allowance = Math.min(
      Math.max(0, entryLimit - titleTokens),
      Math.max(0, remaining - titleTokens)
    );
    const content = limitTextToTokens(String(entry?.content || ''), allowance);
    if (!content) {
      omittedIds.push(entry?.id);
      continue;
    }
    const rendered = { ...entry, content };
    const tokens = estimateTokens(`${entry?.title || ''}\n${content}`);
    if (content.length < String(entry?.content || '').length) truncatedCount += 1;
    accepted.push(rendered);
    usedTokens += tokens;
  }

  return {
    entries: accepted,
    report: {
      maxTokens: tokenLimit,
      maxEntryTokens: entryLimit,
      usedTokens,
      selectedCount: accepted.length,
      omittedCount: omittedIds.length,
      omittedIds: omittedIds.filter(Boolean),
      truncatedCount
    }
  };
}

function compileSafeExtensions(extensions) {
  if (!extensions || typeof extensions !== 'object' || Array.isArray(extensions)) return {};
  return Object.fromEntries(
    Object.entries(extensions)
      .filter(([key]) => SAFE_EXTENSION_KEYS.has(key))
      .map(([key, value]) => [key, structuredClone(value)])
  );
}

function containsExecutableWorldBookContent(content) {
  const text = String(content || '');
  return /<%[_=-]?|<\/script\s*>|<script\b|javascript:|@@preprocessing/i.test(text);
}

function inferNativeControllerBehaviors(title) {
  const value = String(title || '');
  const behaviors = [];
  const mappings = [
    [/在场NPC|在场角色/, '在场 NPC 由当前地点、已发生事件与角色可达性决定；只向模型提供实际在场角色，并把进入、离开写入事件账本。'],
    [/地点|区域/, '地点变化写入世界状态；检索当前国家、城镇、区域对应的世界书，并以其中的灵气、物价、税率与环境危险为本地约束。'],
    [/区域事件|奇遇/, '区域事件只在地点、历法、势力、人物可达性和前置事实同时满足时进入候选；不把随机偶遇自动解释成主角奖励。'],
    [/国家|体制|势力/, '国家与势力即使主角不介入也会按事件账本演化；NPC 的权限、资源、立场和日程受所属势力约束。'],
    [/女主|角色触发|NPC生成/, '角色登场必须满足地点、关系与剧情条件；临时 NPC 需要独立目标、信息边界和离场条件。'],
    [/传闻/, '传闻按来源、地点、时间和可信度传播并衰减，不自动等同于客观真相。'],
    [/战斗/, '战斗结果依据境界差、状态、能力、环境和代价裁定；越阶行为必须承担设定中的碾压与永久伤势，并通过动作协议更新状态。'],
    [/修行|功法/, '修行与功法必须遵守世界书中的境界、不可逆刻度、反噬、资源与历法约束，不凭叙事便利跳级。'],
    [/寿元|夺舍/, '寿元、死亡与夺舍由既有状态和世界规则触发，关键变更写入事实与事件账本。'],
    [/洞府/, '洞府经营通过世界状态记录资源、设施、成员和时间推进，不依赖隐藏脚本变量。'],
    [/暗拍|拍卖/, '交易与拍卖通过显式物品、价格、竞买者目标和结算事件推进。'],
    [/阴墟|副本/, '副本进度、区域、试炼结果与退出条件必须显式记录，不允许跳过未满足的阶段。'],
    [/DM引擎|导演/, '世界导演只推进符合当前地点、主线和角色动机的事件；不得替主角作决定。']
  ];
  mappings.forEach(([pattern, behavior]) => {
    if (pattern.test(value)) behaviors.push(behavior);
  });
  if (!behaviors.length && /EJS|控制器|引擎/i.test(value)) {
    behaviors.push(`“${value}”未能完整转换；保留其名称作为兼容差异，不执行原脚本。`);
  }
  return behaviors;
}

function createWorldSystemRecord(entry, index) {
  return {
    id: String(entry.id || `world-system-${index + 1}`).slice(0, 160),
    name: String(entry.title || `条目 ${index + 1}`).trim().slice(0, 120),
    summary: summarizeStaticLore(entry.content),
    sourceEntryId: String(entry.id || '').slice(0, 160),
    constant: entry.constant === true,
    priority: Number.isFinite(Number(entry.priority)) ? Number(entry.priority) : 50,
    visibility: normalizeSystemVisibility(entry?.extensions?.visibility || entry?.visibility)
  };
}

function summarizeStaticLore(value, maxChars = 420) {
  return String(value || '')
    .replace(/<%[\s\S]*?%>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*_>`~|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxChars);
}

function inferTopologyKind(title) {
  if (/(?:国|朝|疆域)/.test(title)) return 'realm';
  if (/(?:城|镇|州|郡|墟市)/.test(title)) return 'settlement';
  if (/(?:宗|门|寺|宫|书院)/.test(title)) return 'institution';
  if (/(?:山|河|海|原|野|林|谷|渊)/.test(title)) return 'region';
  return 'location';
}

function extractScheduleSlots(value) {
  const slots = [];
  const text = String(value || '');
  const pattern = /(?:^|[\s，。；;])(\d{1,2}:\d{2})\s*[-—:：]?\s*([^。\n；;]{0,80})/g;
  let match;
  while ((match = pattern.exec(text)) && slots.length < 12) {
    const [hour, minute] = match[1].split(':').map(Number);
    if (hour > 23 || minute > 59) continue;
    slots.push({
      at: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
      activity: String(match[2] || '').trim().slice(0, 80)
    });
  }
  return slots;
}

function extractTopologyEdges(value, record) {
  const edges = [];
  const text = summarizeStaticLore(value, 6000);
  const patterns = [
    /([^，。；;：:\n]{2,24})\s*(通往|连接|毗邻|接壤|相邻于?|可达)\s*([^，。；;\n]{2,24})/g,
    /从\s*([^，。；;：:\n]{2,24})\s*(?:到|至|前往)\s*([^，。；;\n]{2,24})/g
  ];
  patterns.forEach((pattern) => {
    let match;
    while ((match = pattern.exec(text)) && edges.length < 24) {
      const isFromPattern = match.length === 3;
      const from = cleanRelationTerm(match[1]);
      const relation = isFromPattern ? '通往' : String(match[2] || '连接').slice(0, 20);
      const to = cleanRelationTerm(isFromPattern ? match[2] : match[3]);
      if (!from || !to || from === to) continue;
      edges.push({
        id: `${record.id}:edge:${edges.length + 1}`,
        from,
        to,
        relation,
        summary: record.summary,
        sourceEntryId: record.sourceEntryId,
        visibility: record.visibility
      });
    }
  });
  return edges;
}

function extractFactionRelations(value, record) {
  const relations = [];
  const text = summarizeStaticLore(value, 6000);
  const pattern = /([^，。；;：:\n]{2,24})\s*(?:与|和|对)\s*([^，。；;：:\n]{2,24})\s*(联盟|敌对|交战|战争|博弈|竞争|依附|从属|敌视|合作|贸易|摩擦|对峙)/g;
  let match;
  while ((match = pattern.exec(text)) && relations.length < 24) {
    const from = cleanRelationTerm(match[1]);
    const to = cleanRelationTerm(match[2]);
    if (!from || !to || from === to) continue;
    relations.push({
      id: `${record.id}:relation:${relations.length + 1}`,
      from,
      to,
      relation: String(match[3] || '关联').slice(0, 20),
      summary: record.summary,
      sourceEntryId: record.sourceEntryId,
      visibility: record.visibility
    });
  }
  return relations;
}

function extractCalendarName(value) {
  return String(value || '').match(/[\u4e00-\u9fffA-Za-z0-9·]{1,20}(?:历法|历)(?!史)/)?.[0]?.slice(0, 80) || '';
}

function extractCalendarDayLabel(value) {
  return String(value || '').match(/(?:当前日期|日期|今日|今夜)\s*[：:]\s*([^，。；;\n]{1,80})/)?.[1]?.trim() || '';
}

function extractCurrencyTerms(value) {
  return String(value || '').match(/(?:极品|上品|中品|下品)?灵石|白银|银两|铜钱|铜币|银币|金币|飞票|钱币|[\u4e00-\u9fffA-Za-z0-9·]{1,8}(?:币|券)/gu) || [];
}

function extractScaleTerms(value) {
  return (String(value || '').match(/[\u4e00-\u9fffA-Za-z0-9·]{1,12}?(?:值|深度|刻度)/gu) || [])
    .map((item) => item.replace(/^[与及和的其]+/u, ''))
    .filter((item) => {
      const prefix = item.replace(/(?:值|深度|刻度)$/u, '');
      return prefix && prefix.length <= 8 && !/[也会将当把被让若则后前时每不需并仍尚其的]/u.test(prefix);
    });
}

function uniqueSystemRecords(records, limit) {
  const used = new Set();
  return records.filter((record) => {
    const key = `${record.sourceEntryId}:${record.name}`;
    if (used.has(key)) return false;
    used.add(key);
    return true;
  }).slice(0, limit);
}

function uniqueSystemRelations(relations, limit) {
  const used = new Set();
  return relations.filter((relation) => {
    const key = `${relation.sourceEntryId}:${relation.from}:${relation.to}:${relation.relation}`;
    if (used.has(key)) return false;
    used.add(key);
    return true;
  }).slice(0, limit);
}

function cleanRelationTerm(value) {
  return String(value || '')
    .replace(/^(?:从|由|在|并且|同时|其中|如今|当前)\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
}

function normalizeSystemVisibility(value) {
  return /^(?:gm|private|director)$/i.test(String(value || '')) ? 'director' : 'public';
}

function compileTextList(value, { maxItems, maxItemChars, field, truncatedFields }) {
  const list = Array.isArray(value) ? value : [];
  if (list.length > maxItems) truncatedFields.push(field);
  return list
    .slice(0, maxItems)
    .map((item, index) => clipText(item, maxItemChars, `${field}[${index}]`, truncatedFields))
    .filter(Boolean);
}

function clipText(value, maxChars, field, truncatedFields) {
  const text = String(value || '').trim();
  if (text.length <= maxChars) return text;
  truncatedFields.push(field);
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function limitTextToTokens(value, maxTokens) {
  const text = String(value || '').trim();
  if (!text || maxTokens <= 0) return '';
  if (estimateTokens(text) <= maxTokens) return text;

  const suffix = '…';
  const suffixTokens = estimateTokens(suffix);
  if (suffixTokens > maxTokens) return '';
  const contentBudget = Math.max(0, maxTokens - suffixTokens);
  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (estimateTokens(text.slice(0, middle)) <= contentBudget) low = middle;
    else high = middle - 1;
  }
  return low > 0 ? `${text.slice(0, low).trimEnd()}${suffix}` : '';
}

function estimateWorldBookEntriesTokens(entries = []) {
  return (Array.isArray(entries) ? entries : [])
    .reduce((sum, entry) => sum + estimateTokens(`${entry?.title || ''}\n${entry?.content || ''}`), 0);
}

function estimateBudgetedWorldBookEntryTokens(entry = {}, maxEntryTokens) {
  const entryLimit = normalizeBudget(maxEntryTokens, 1600);
  const title = String(entry.title || '');
  const titleTokens = estimateTokens(title);
  const content = limitTextToTokens(
    String(entry.content || ''),
    Math.max(0, entryLimit - titleTokens)
  );
  return content ? estimateTokens(`${title}\n${content}`) : 0;
}

function normalizeBudget(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
