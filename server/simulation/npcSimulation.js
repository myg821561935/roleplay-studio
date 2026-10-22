import { describesDeparture } from './commitmentAvailability.js';
import crypto from 'node:crypto';
import { projectWorldClock } from './worldClock.js';
import { isWorldBookCharacterProfileEntry } from '../character/characterContentMode.js';
import { deriveCalendarContext, formatCalendarTransition, hasCalendarTransition, normalizeCalendarProfile } from './calendarEngine.js';

export const SIMULATION_SPEC = 'lra.simulation/v1';
export const WORLD_SYSTEMS_SPEC = 'narrative-engine.world-systems/v1';

export function createSimulationState({ actors = [], clock, systems } = {}) {
  const normalizedActors = normalizeActors(actors);
  const normalizedSystems = normalizeWorldSystems(systems);
  const normalizedClock = normalizeClock(clock);
  return {
    spec: SIMULATION_SPEC,
    revision: 0,
    clock: normalizedClock,
    calendar: deriveCalendarContext({ clock: normalizedClock, calendar: normalizedSystems.calendar }),
    actors: normalizedActors,
    systems: normalizedSystems,
    backstageEvents: [],
    settings: {
      chronicleEnabled: true,
      autoAdvanceMinutes: 10,
      maxBackstageEvents: 300,
      rosterInitialized: normalizedActors.length > 0
    }
  };
}

export function ensureSimulationMemory(memory, { characterCard, groupMembers, characterPresets, worldSystems, worldBook } = {}) {
  const next = structuredClone(memory && typeof memory === 'object' ? memory : {});
  const existing = next.simulation && typeof next.simulation === 'object'
    ? next.simulation
    : createSimulationState();
  const seedActors = buildActorSeeds({ characterCard, groupMembers, characterPresets, worldBook });
  const worldBookSeeds = new Map(seedActors
    .filter((actor) => actor?.metadata?.source === 'worldbook')
    .map((actor) => [actor.id, actor]));
  const actors = normalizeActors(existing.actors).flatMap((actor) => {
    if (actor?.metadata?.source !== 'worldbook') return [actor];
    // Arbitration/replay normalizes existing memory without an authoritative
    // worldbook input. Absence is not a request to delete its registered NPCs.
    if (!Array.isArray(worldBook)) return [actor];
    const refreshed = worldBookSeeds.get(actor.id);
    // Re-reading a character profile refreshes its definition, not its live scene.
    return refreshed ? [{ ...refreshed, location: actor.location, status: actor.status }] : [];
  });
  const systems = hasWorldSystemContent(existing.systems)
    ? normalizeWorldSystems(existing.systems)
    : normalizeWorldSystems(worldSystems);
  const rosterInitialized = existing.settings?.rosterInitialized === true
    || actors.length > 0
    || normalizeInteger(existing.revision, 0) > 0;
  const knownIds = new Set(actors.map((actor) => actor.id));
  // Preserve an established session roster, but do not let that preservation
  // hide a newly declared worldbook character forever.  These entries are
  // imported facts rather than model-made NPCs and are safe to append by id.
  const seedsToApply = rosterInitialized
    ? seedActors.filter((seed) => seed?.metadata?.source === 'worldbook')
    : seedActors;
  for (const seed of seedsToApply) {
    if (!knownIds.has(seed.id)) {
      actors.push(seed);
      knownIds.add(seed.id);
    }
  }

  const chronicleEnabled = existing.settings?.chronicleEnabled !== false;
  const clock = normalizeClock(existing.clock);
  next.simulation = {
    spec: SIMULATION_SPEC,
    revision: normalizeInteger(existing.revision, 0),
    clock,
    calendar: deriveCalendarContext({ clock, calendar: systems.calendar }),
    actors,
    systems,
    backstageEvents: normalizeBackstageEvents(existing.backstageEvents),
    settings: {
      chronicleEnabled,
      // Earlier sessions stored 0 before automatic turn time existed. Treat it
      // as the legacy default; a deliberate opt-out is chronicleEnabled=false.
      autoAdvanceMinutes: chronicleEnabled
        ? normalizeAutoAdvanceMinutes(existing.settings?.autoAdvanceMinutes)
        : 0,
      maxBackstageEvents: clampInteger(existing.settings?.maxBackstageEvents, 50, 2000, 300),
      rosterInitialized: rosterInitialized || seedActors.length > 0
    }
  };
  next.worldState = { ...next.worldState, clock: projectWorldClock(next.worldState?.clock, next.simulation) };
  return ensureDeclaredWorldDynamics(next, { worldBook, actors, systems: next.simulation.systems });
}

export function normalizeActors(input) {
  const actors = [];
  const usedIds = new Set();
  for (const [index, value] of (Array.isArray(input) ? input : []).entries()) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const name = String(value.name || '').trim().slice(0, 80);
    if (!name) continue;
    let id = normalizeActorId(value.id || slugify(name) || `npc-${index + 1}`);
    if (!id) id = `npc-${index + 1}`;
    let suffix = 2;
    const baseId = id;
    while (usedIds.has(id)) id = `${baseId}-${suffix++}`;
    usedIds.add(id);
    actors.push({
      id,
      name,
      role: String(value.role || '').trim().slice(0, 160),
      enabled: value.enabled !== false,
      location: String(value.location || '').trim().slice(0, 160),
      status: String(value.status || 'idle').trim().slice(0, 240),
      goals: uniqueStrings(value.goals, 12, 240),
      publicKnowledge: uniqueStrings(value.publicKnowledge || value.knowledge?.public, 30, 500),
      privateKnowledge: uniqueStrings(value.privateKnowledge || value.knowledge?.private, 30, 500),
      relationships: normalizeRelationships(value.relationships),
      schedule: normalizeSchedule(value.schedule),
      agenda: normalizeAgenda(value.agenda),
      metadata: normalizeMetadata(value.metadata)
    });
  }
  return actors;
}

export function normalizeWorldSystems(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const excludedSourceIds = collectExcludedSemanticSourceIds(source);
  const semanticRecords = (records, limit) => normalizeSystemRecords(records, limit)
    .filter((record) => !isExcludedSemanticRecord(record));
  return {
    spec: WORLD_SYSTEMS_SPEC,
    topology: {
      nodes: semanticRecords(source.topology?.nodes, 240),
      edges: normalizeSystemEdges(source.topology?.edges, 400)
        .filter((edge) => !excludedSourceIds.has(edge.sourceEntryId)),
      currentNodeId: String(source.topology?.currentNodeId || '').slice(0, 160)
    },
    population: {
      profiles: normalizePopulationProfiles(source.population?.profiles, 160)
        .filter((record) => !isOperationalSystemRecord(record)),
      scheduleRules: semanticRecords(source.population?.scheduleRules, 80)
    },
    factions: {
      entities: semanticRecords(source.factions?.entities, 120),
      relations: normalizeFactionRelations(source.factions?.relations, 240)
        .filter((relation) => !excludedSourceIds.has(relation.sourceEntryId))
    },
    calendar: normalizeCalendar(source.calendar),
    economy: {
      currencies: normalizeCurrencyTerms(source.economy?.currencies),
      markets: semanticRecords(source.economy?.markets, 80),
      rules: semanticRecords(source.economy?.rules, 100)
    },
    cultivation: {
      paths: semanticRecords(source.cultivation?.paths, 100),
      scales: normalizeScaleTerms(source.cultivation?.scales),
      backlash: semanticRecords(source.cultivation?.backlash, 40),
      rules: semanticRecords(source.cultivation?.rules, 120)
    },
    source: {
      entryCount: clampInteger(source.source?.entryCount, 0, 100000, 0),
      mappedCount: clampInteger(source.source?.mappedCount, 0, 100000, 0)
    }
  };
}

function normalizeCalendar(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const calendar = {
    name: String(source.name || '').slice(0, 120),
    era: String(source.era || '').slice(0, 120),
    dayLabel: String(source.dayLabel || '').slice(0, 120),
    rules: normalizeSystemRecords(source.rules, 80).filter((record) => !isExcludedSemanticRecord(record))
  };
  const profile = normalizeCalendarProfile(source.profile || source);
  if (profile) calendar.profile = profile;
  return calendar;
}

function collectExcludedSemanticSourceIds(source) {
  const records = [
    source.topology?.nodes,
    source.population?.profiles,
    source.population?.scheduleRules,
    source.factions?.entities,
    source.calendar?.rules,
    source.economy?.markets,
    source.economy?.rules,
    source.cultivation?.paths,
    source.cultivation?.backlash,
    source.cultivation?.rules
  ].flatMap((items) => Array.isArray(items) ? items : []);
  return new Set(records
    .filter((record) => isExcludedSemanticRecord(record))
    .map((record) => String(record?.sourceEntryId || '').trim())
    .filter(Boolean));
}

function isExcludedSemanticRecord(record) {
  return isWorldBookCharacterProfileEntry(record) || isOperationalSystemRecord(record);
}

function isOperationalSystemRecord(record) {
  const title = String(record?.name || record?.title || '').replace(/\s+/g, ' ').trim();
  return /^(?:\[?mvu[_ -]?update\]?\s*)?(?:变量更新规则|变量输出格式|变量列表|变量清单)$/iu.test(title)
    || /^(?:社区卡原生运行契约|社区资源兼容运行契约)$/u.test(title);
}

function normalizeCurrencyTerms(input) {
  const terms = (Array.isArray(input) ? input : []).flatMap((value) => (
    String(value || '').match(/(?:极品|上品|中品|下品)?灵石|白银|银两|铜钱|铜币|银币|金币|飞票|钱币|[\u4e00-\u9fffA-Za-z0-9·]{1,8}(?:币|券)/gu) || []
  ));
  return uniqueStrings(terms, 30, 80);
}

function normalizeScaleTerms(input) {
  const terms = (Array.isArray(input) ? input : []).flatMap((value) => (
    String(value || '').match(/[\u4e00-\u9fffA-Za-z0-9·]{1,12}?(?:值|深度|刻度)/gu) || []
  )).map((item) => item.replace(/^[与及和的其]+/u, '')).filter((item) => {
    const prefix = item.replace(/(?:值|深度|刻度)$/u, '');
    return prefix && prefix.length <= 8 && !/[也会将当把被让若则后前时每不需并仍尚其的]/u.test(prefix);
  });
  return uniqueStrings(terms, 40, 80);
}

export function advanceSimulationClock(simulationInput, { minutes = 60, reason = 'manual', now = () => new Date(), custodyConstraints = [] } = {}) {
  const simulation = normalizeSimulation(simulationInput);
  const safeMinutes = clampInteger(minutes, 1, 10080, 60);
  const startAbsolute = toAbsoluteMinute(simulation.clock);
  const endAbsolute = startAbsolute + safeMinutes;
  const calendarBefore = structuredClone(simulation.calendar);
  const effects = [];
  const events = [];

  for (const actor of simulation.actors) {
    if (!actor.enabled) continue;
    for (const schedule of actor.schedule) {
      for (const occurrence of scheduleOccurrences(schedule, startAbsolute, endAbsolute)) {
        const retained=custodyConstraints.some(x=>x.counterparty===actor.name)
          && ((schedule.location && schedule.location!==actor.location && !(actor.location.length>=2 && schedule.location.startsWith(actor.location))) || describesDeparture(schedule.activity));
        if(retained) {
          events.push({id:`backstage-${crypto.randomUUID()}`,timestamp:now().toISOString(),absoluteMinute:occurrence,actorId:actor.id,actorName:actor.name,visibility:'public',summary:`${actor.name}因仍有随时可取回的保管约定，暂缓离场日程`,reason:'commitment-custody'});
          continue;
        }
        const before = { location: actor.location, status: actor.status };
        if (schedule.location) actor.location = schedule.location;
        if (schedule.activity) actor.status = schedule.activity;
        const event = {
          id: `backstage-${crypto.randomUUID()}`,
          timestamp: now().toISOString(),
          absoluteMinute: occurrence,
          actorId: actor.id,
          actorName: actor.name,
          visibility: schedule.visibility,
          summary: `${actor.name}${schedule.location ? `前往${schedule.location}` : ''}${schedule.activity ? `，${schedule.activity}` : ''}`,
          reason: String(reason || 'schedule').slice(0, 240)
        };
        events.push(event);
        effects.push({
          actionId: schedule.id,
          type: 'schedule.trigger',
          path: `simulation.actors.${actor.id}`,
          before,
          after: { location: actor.location, status: actor.status },
          visibility: schedule.visibility
        });
      }
    }
  }

  simulation.clock = fromAbsoluteMinute(endAbsolute);
  simulation.calendar = deriveCalendarContext({ clock: simulation.clock, calendar: simulation.systems.calendar });
  if (hasCalendarTransition(calendarBefore, simulation.calendar)) {
    const summary = formatCalendarTransition(calendarBefore, simulation.calendar);
    events.push({
      id: `backstage-${crypto.randomUUID()}`,
      timestamp: now().toISOString(),
      absoluteMinute: endAbsolute,
      actorId: 'world-calendar',
      actorName: simulation.systems.calendar.name || '世界时序',
      visibility: 'public',
      summary,
      reason: String(reason || 'calendar').slice(0, 240)
    });
    effects.push({
      actionId: 'calendar',
      type: 'calendar.transition',
      path: 'simulation.calendar',
      before: calendarBefore,
      after: structuredClone(simulation.calendar),
      visibility: 'public',
      reason: summary
    });
  }
  simulation.backstageEvents.push(...events);
  const maxEvents = simulation.settings.maxBackstageEvents;
  simulation.backstageEvents = simulation.backstageEvents.slice(-maxEvents);

  effects.unshift({
    actionId: 'clock',
    type: 'clock.advance',
    path: 'simulation.clock',
    before: fromAbsoluteMinute(startAbsolute),
    after: structuredClone(simulation.clock),
    visibility: 'public'
  });
  return { simulation, effects, events, minutes: safeMinutes };
}

export function projectSimulation(simulationInput, { director = false } = {}) {
  const simulation = normalizeSimulation(simulationInput);
  const actors = simulation.actors.map((actor) => {
    const projected = structuredClone(actor);
    if (!director) {
      delete projected.privateKnowledge;
      projected.schedule = projected.schedule.filter((entry) => entry.visibility === 'public');
      projected.agenda = projected.agenda.filter((entry) => entry.visibility === 'public');
    }
    return projected;
  });
  return {
    ...simulation,
    actors,
    systems: projectWorldSystems(simulation.systems, { director }),
    backstageEvents: simulation.backstageEvents.filter((event) => director || event.visibility === 'public')
  };
}

export function renderSimulationPrompt(memory, { targetSpeaker } = {}) {
  const simulation = normalizeSimulation(memory?.simulation);
  const chronicleEnabled = simulation.settings?.chronicleEnabled !== false;
  if (!chronicleEnabled && !simulation.actors.length && !hasWorldSystemContent(simulation.systems)) return '';
  const lines = [
    '# 世界模拟状态',
    `时间：${simulation.calendar.label}（修订 ${simulation.revision}）`,
    '时间硬约束：以上是本回合唯一有效的日期与时段。正文、状态栏、日程和角色行动不得改写或猜测不同的星期、日期或时刻；不确定时只写“当前”而不要另起一套时间。',
    '以下资料来自安全转换后的世界书与当前模拟状态。它们是叙事约束，不代表原卡的 JavaScript 或 EJS 已执行。',
    '世界演化必须通过世界状态、角色日程、动作协议与事件账本落地；以下“私有”内容不得直接向用户泄露。'
  ];
  const target = String(targetSpeaker || '').trim();
  const enabledActors = simulation.actors.filter((item) => item.enabled);
  const orderedActors = target
    ? [...enabledActors.filter((item) => item.name === target), ...enabledActors.filter((item) => item.name !== target)]
    : enabledActors;
  for (const actor of orderedActors.slice(0, 16)) {
    const privateFacts = actor.privateKnowledge.slice(0, 8).join('；');
    const agenda = actor.agenda.filter((item) => item.status === 'active').slice(0, 4).map((item) => item.title).join('；');
    lines.push([
      `## ${actor.name}${target && actor.name === target ? '（当前发言）' : ''}`,
      actor.role ? `身份：${actor.role}` : '',
      actor.location ? `位置：${actor.location}` : '',
      actor.status ? `状态：${actor.status}` : '',
      actor.goals.length ? `目标：${actor.goals.join('；')}` : '',
      actor.publicKnowledge.length ? `公开已知：${actor.publicKnowledge.slice(0, 8).join('；')}` : '',
      privateFacts ? `私有已知：${privateFacts}` : '',
      agenda ? `幕后议程：${agenda}` : ''
    ].filter(Boolean).join('\n'));
  }
  appendWorldSystemsPrompt(lines, simulation.systems);
  appendDeclaredWorldDynamicsPrompt(lines, memory?.worldState?.worldDynamics);
  return lines.join('\n\n');
}

function buildActorSeeds({ characterCard, groupMembers, characterPresets, worldBook } = {}) {
  const inputs = [];
  if (characterCard?.name) inputs.push(characterCard);
  if (Array.isArray(groupMembers)) inputs.push(...groupMembers);
  if (Array.isArray(characterPresets)) {
    for (const preset of characterPresets) inputs.push(preset.characterCard || preset);
  }
  inputs.push(...extractWorldBookActorSeeds(worldBook));
  const actors = normalizeActors(inputs.map((value) => ({
    id: value.id || slugify(value.name),
    name: value.name,
    role: value.role,
    enabled: value.enabled,
    location: value.location || value.extensions?.location,
    status: value.status || 'idle',
    goals: value.goals || value.extensions?.goals,
    publicKnowledge: value.publicKnowledge || value.extensions?.publicKnowledge,
    privateKnowledge: value.privateKnowledge || value.extensions?.privateKnowledge,
    relationships: value.relationships || value.extensions?.relationships,
    schedule: value.schedule || value.extensions?.schedule,
    agenda: value.agenda || value.extensions?.agenda,
    metadata: value.metadata || { source: value.id ? 'content-pack' : 'character-card' }
  })));
  const knownNames = new Set();
  return actors.filter((actor) => {
    const nameKey = actor.name.trim().toLocaleLowerCase('zh-CN');
    if (knownNames.has(nameKey)) return false;
    knownNames.add(nameKey);
    return true;
  });
}

function extractWorldBookActorSeeds(worldBook = []) {
  return (Array.isArray(worldBook) ? worldBook : []).flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object' || entry.enabled === false) return [];
    const extensions = isRecord(entry.extensions) ? entry.extensions : {};
    const explicitActor = isRecord(extensions.actor) ? extensions.actor : null;
    const type = [entry.type, entry.category, extensions.type, extensions.category]
      .map((value) => String(value || '').toLowerCase())
      .join(' ');
    const title = String(entry.title || entry.name || '').trim();
    const explicitName = String(extensions.characterName || entry.characterName || '').trim();
    const content = String(entry.content || '');
    const labeledName = extractLabeledWorldBookField(content, ['姓名', '名字', '角色名']);
    const characterTyped = /(?:character|persona|npc|角色|人物)/u.test(type);
    const characterTitle = /^(?:(?:人物|角色)(?:档案|设定)|NPC)\s*[：:·－-]\s*\S+/iu.test(title)
      || /^.{1,32}[_·\s-]+(?:基础信息|二次解释|性格调色盘|人物档案|角色档案|人物设定|角色设定)(?:[_·\s-]|$)/u.test(title);
    if (!explicitActor && !explicitName && !(characterTyped && (characterTitle || labeledName))) return [];
    if (!explicitActor && /(?:变量|更新规则|输出格式|状态栏|模板|契约|世界观|角色速览|人物速览|总览|系统说明)/u.test(title)) return [];
    const name = String(
      explicitActor?.name
      || explicitName
      || labeledName
      || normalizeWorldBookActorName(title)
    ).trim().slice(0, 80);
    if (!name || name.length > 30) return [];
    const role = String(explicitActor?.role || entry.role || extractLabeledWorldBookField(content, ['身份', '职业', '角色'])).trim();
    const location = String(explicitActor?.location || entry.location || extractLabeledWorldBookField(content, ['地点', '位置', '常驻地'])).trim();
    const goals = explicitActor?.goals || entry.goals || extractWorldBookGoals(content);
    const explicitSchedule = explicitActor?.schedule || entry.schedule || extensions.schedule;
    return [{
      id: explicitActor?.id || `worldbook-${entry.id || index + 1}`,
      name,
      role,
      location,
      status: String(explicitActor?.status || entry.status || 'background-active'),
      goals,
      publicKnowledge: explicitActor?.publicKnowledge || entry.publicKnowledge,
      privateKnowledge: explicitActor?.privateKnowledge || entry.privateKnowledge,
      schedule: explicitSchedule || extractWorldBookSchedule(content),
      agenda: explicitActor?.agenda || entry.agenda || [{
        id: 'declared-worldbook-agenda',
        title: '遵循角色卡与世界书中已经声明的日程和目标',
        priority: 45,
        status: 'active',
        visibility: 'private'
      }],
      metadata: {
        source: 'worldbook',
        worldBookId: String(entry.id || ''),
        title
      }
    }];
  });
}

function normalizeWorldBookActorName(title) {
  return String(title || '')
    .replace(/^(?:(?:人物|角色)(?:档案|设定)?|NPC)\s*[：:·－-]?\s*/iu, '')
    .replace(/[_·\s-]+(?:基础信息|二次解释|性格调色盘|人物档案|角色档案|人物设定|角色设定)(?:[_·\s-].*)?$/u, '')
    .trim();
}

function extractLabeledWorldBookField(content, labels = []) {
  const labelPattern = labels.map((label) => escapeRegExp(label)).join('|');
  if (!labelPattern) return '';
  const match = String(content || '').match(new RegExp(`(?:^|\\n)\\s*(?:${labelPattern})\\s*[：:]\\s*([^\\n。；;]{1,80})`, 'u'));
  return String(match?.[1] || '').trim();
}

function extractWorldBookGoals(content) {
  const value = extractLabeledWorldBookField(content, ['目标', '目的', '当前诉求']);
  return value ? value.split(/[、，,]/u).map((item) => item.trim()).filter(Boolean).slice(0, 6) : [];
}

function extractWorldBookSchedule(content) {
  const source = String(content || '');
  const timeMatch = source.match(/(?:每天|每日|日常|通常).{0,24}?(\d{1,2}[:：]\d{2}|清晨|上午|午后|傍晚|夜间|深夜)/u);
  if (!timeMatch) return [];
  const at = normalizeDeclaredScheduleTime(timeMatch[1]);
  if (!at) return [];
  return [{
    id: 'declared-worldbook-routine',
    at,
    activity: '执行世界书中已声明的日常安排',
    visibility: 'private'
  }];
}

function normalizeDeclaredScheduleTime(value) {
  const source = String(value || '').replace('：', ':').trim();
  if (/^\d{1,2}:\d{2}$/.test(source)) return source;
  const named = { 清晨: '07:00', 上午: '09:00', 午后: '14:00', 傍晚: '18:00', 夜间: '21:00', 深夜: '23:00' };
  return named[source] || '';
}

function ensureDeclaredWorldDynamics(memory, { worldBook, actors = [], systems = {} } = {}) {
  const next = memory && typeof memory === 'object' ? memory : {};
  const state = isRecord(next.worldState) ? next.worldState : {};
  const existing = isRecord(state.worldDynamics) ? state.worldDynamics : {};
  const declaredActors = (Array.isArray(actors) ? actors : [])
    .filter((actor) => actor?.metadata?.source === 'worldbook')
    .slice(0, 16)
    .map((actor) => ({
      id: actor.id,
      name: actor.name,
      scheduleCount: Array.isArray(actor.schedule) ? actor.schedule.length : 0,
      agenda: (Array.isArray(actor.agenda) ? actor.agenda : [])
        .filter((item) => item?.status === 'active')
        .map((item) => item.title)
        .slice(0, 3)
    }));
  const factions = (Array.isArray(systems?.factions?.entities) ? systems.factions.entities : [])
    .filter(isRunnableFactionRecord)
    .slice(0, 12)
    .map((faction, index) => ({
      id: String(faction.id || `faction-${index + 1}`),
      name: String(faction.title || faction.name || faction.label || '').trim(),
      status: 'background-active'
    }))
    .filter((faction) => faction.name);
  const promises = (Array.isArray(state.obligations) ? state.obligations : [])
    .filter((item) => item && typeof item === 'object')
    .slice(0, 16)
    .map((item, index) => ({
      id: String(item.id || `promise-${index + 1}`),
      title: String(item.title || item.details || item.type || '').trim().slice(0, 180),
      from: String(item.from || '').trim(),
      to: String(item.to || '').trim(),
      status: String(item.status || 'open').trim()
    }))
    .filter((item) => item.title);
  if (!declaredActors.length && !factions.length && !promises.length) return next;
  next.worldState = {
    ...state,
    worldDynamics: {
      spec: 'lra.world-dynamics/v1',
      declaredActors,
      factions,
      promises,
      source: {
        worldBookEntries: Array.isArray(worldBook) ? worldBook.length : 0,
        initialized: existing.source?.initialized === true || Boolean(declaredActors.length || factions.length || promises.length)
      }
    }
  };
  return next;
}

function appendDeclaredWorldDynamicsPrompt(lines, input) {
  const dynamics = isRecord(input) ? input : {};
  const actors = Array.isArray(dynamics.declaredActors) ? dynamics.declaredActors : [];
  const factions = (Array.isArray(dynamics.factions) ? dynamics.factions : []).filter(isRunnableFactionRecord);
  const promises = Array.isArray(dynamics.promises) ? dynamics.promises : [];
  if (!actors.length && !factions.length && !promises.length) return;
  lines.push('# 世界动态时钟');
  if (actors.length) {
    lines.push(`关键人物背景日程：${actors.map((actor) => `${actor.name}${actor.agenda?.length ? `（${actor.agenda.join('；')}）` : ''}`).join('；')}。`);
  }
  if (factions.length) {
    lines.push(`势力背景事件：${factions.map((faction) => faction.name).join('、')}均在独立演化；除非当前因果、时钟或玩家行动指向它们，不得强行插入当前场景。`);
  }
  if (promises.length) {
    lines.push(`承诺时钟：${promises.map((promise) => `${promise.from || '相关人物'}→${promise.to || '相关人物'}：${promise.title}`).join('；')}。已解决或已明确答复的承诺不得被重复追问，只在新的后果、到期时间或玩家行动出现时再推进。`);
  }
}

function isRunnableFactionRecord(record) {
  const name = String(record?.name || record?.title || '').replace(/\s+/g, ' ').trim();
  return Boolean(name)
    && !isWorldBookCharacterProfileEntry(record)
    && !/(?:世界观|设定|结构|体系|规则|演化|关系|总览|名录|说明|档案|调色盘|二次解释)$/u.test(name);
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeSimulation(input) {
  const source = input && typeof input === 'object' ? input : createSimulationState();
  const clock = normalizeClock(source.clock);
  const systems = normalizeWorldSystems(source.systems);
  return {
    spec: SIMULATION_SPEC,
    revision: normalizeInteger(source.revision, 0),
    clock,
    calendar: deriveCalendarContext({ clock, calendar: systems.calendar }),
    actors: normalizeActors(source.actors),
    systems,
    backstageEvents: normalizeBackstageEvents(source.backstageEvents),
    settings: {
      chronicleEnabled: source.settings?.chronicleEnabled !== false,
      autoAdvanceMinutes: source.settings?.chronicleEnabled === false
        ? 0
        : normalizeAutoAdvanceMinutes(source.settings?.autoAdvanceMinutes),
      maxBackstageEvents: clampInteger(source.settings?.maxBackstageEvents, 50, 2000, 300),
      rosterInitialized: source.settings?.rosterInitialized === true
        || normalizeActors(source.actors).length > 0
        || normalizeInteger(source.revision, 0) > 0
    }
  };
}

function appendWorldSystemsPrompt(lines, systemsInput) {
  const systems = normalizeWorldSystems(systemsInput);
  const groups = selectPreferredPromptSystemGroups([
    ['地点拓扑', systems.topology.nodes, 12],
    ['NPC 与日程规则', systems.population.profiles, 10],
    ['势力演化', systems.factions.entities, 10],
    ['历法与天候', systems.calendar.rules, 8],
    ['经济规则', systems.economy.rules, 8],
    ['修行与反噬', systems.cultivation.rules, 10]
  ]);
  groups.forEach(([title, records, limit]) => appendSystemRecordPrompt(lines, title, records, limit));
  if (systems.economy.currencies.length) lines.push(`经济单位：${systems.economy.currencies.join('、')}`);
  if (systems.cultivation.scales.length) lines.push(`不可逆/状态刻度：${systems.cultivation.scales.join('、')}`);
}

function selectPreferredPromptSystemGroups(groups) {
  const preferred = new Map();
  groups.forEach(([title, records]) => {
    records.forEach((record) => {
      const identity = getPromptSystemRecordIdentity(record);
      const score = scorePromptSystemGroup(title, `${record.name} ${record.summary}`);
      const current = preferred.get(identity);
      if (!current || score > current.score) preferred.set(identity, { title, score });
    });
  });
  return groups.map(([title, records, limit]) => [
    title,
    records.filter((record) => preferred.get(getPromptSystemRecordIdentity(record))?.title === title),
    limit
  ]);
}

function getPromptSystemRecordIdentity(record) {
  const sourceEntryId = String(record?.sourceEntryId || record?.id || '').trim();
  const summary = String(record?.summary || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
  return sourceEntryId ? `${sourceEntryId}:${summary}` : `${String(record?.name || '').toLocaleLowerCase()}:${summary}`;
}

function scorePromptSystemGroup(groupTitle, text) {
  const patterns = {
    '地点拓扑': /(?:地点|区域|地理|疆域|城镇|城池|州郡|山川|驻地|据点|要塞|墟市)/gu,
    'NPC 与日程规则': /(?:人物|角色|NPC|居民|日程|行程|作息|轮值|值守)/giu,
    '势力演化': /(?:势力|阵营|朝廷|宗门|门派|世家|学派|组织|成员状况)/gu,
    '历法与天候': /(?:历法|日期|节气|季节|气候|时辰|天候)/gu,
    '经济规则': /(?:经济|物价|货币|税率|市场|贸易|商会|交易|灵石|白银)/gu,
    '修行与反噬': /(?:修仙|修行|修炼|功法|境界|道途|破境|反噬|灵根|走火入魔)/gu
  };
  return String(text || '').match(patterns[groupTitle] || /$^/gu)?.length || 0;
}

function appendSystemRecordPrompt(lines, title, records, limit) {
  const visible = records.filter((record) => record.visibility !== 'director').slice(0, limit);
  const director = records.filter((record) => record.visibility === 'director').slice(0, Math.max(0, limit - visible.length));
  const selected = [...visible, ...director];
  if (!selected.length) return;
  lines.push([
    `## ${title}`,
    ...selected.map((record) => `- ${record.name}${record.summary ? `：${record.summary}` : ''}${record.visibility === 'director' ? '（私有）' : ''}`)
  ].join('\n'));
}

function projectWorldSystems(input, { director }) {
  const systems = normalizeWorldSystems(input);
  if (director) return systems;
  const publicRecords = (records) => records.filter((record) => record.visibility !== 'director');
  return {
    ...systems,
    topology: { ...systems.topology, nodes: publicRecords(systems.topology.nodes) },
    population: {
      ...systems.population,
      profiles: publicRecords(systems.population.profiles),
      scheduleRules: publicRecords(systems.population.scheduleRules)
    },
    factions: { ...systems.factions, entities: publicRecords(systems.factions.entities) },
    calendar: { ...systems.calendar, rules: publicRecords(systems.calendar.rules) },
    economy: {
      ...systems.economy,
      markets: publicRecords(systems.economy.markets),
      rules: publicRecords(systems.economy.rules)
    },
    cultivation: {
      ...systems.cultivation,
      paths: publicRecords(systems.cultivation.paths),
      backlash: publicRecords(systems.cultivation.backlash),
      rules: publicRecords(systems.cultivation.rules)
    }
  };
}

function hasWorldSystemContent(input) {
  const systems = normalizeWorldSystems(input);
  return systems.topology.nodes.length > 0
    || systems.population.profiles.length > 0
    || systems.factions.entities.length > 0
    || systems.calendar.rules.length > 0
    || Boolean(systems.calendar.profile)
    || systems.economy.rules.length > 0
    || systems.cultivation.rules.length > 0;
}

function normalizeSystemRecords(input, limit) {
  return (Array.isArray(input) ? input : []).slice(0, limit).map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const name = String(entry.name || entry.title || '').trim().slice(0, 120);
    if (!name) return null;
    return {
      id: String(entry.id || `system-${index + 1}`).slice(0, 160),
      name,
      summary: String(entry.summary || entry.description || '').trim().slice(0, 500),
      sourceEntryId: String(entry.sourceEntryId || '').slice(0, 160),
      constant: entry.constant === true,
      priority: clampInteger(entry.priority, -100000, 100000, 50),
      visibility: normalizeVisibility(entry.visibility)
    };
  }).filter(Boolean);
}

function normalizePopulationProfiles(input, limit) {
  return (Array.isArray(input) ? input : []).slice(0, limit).map((entry, index) => {
    const [record] = normalizeSystemRecords([entry], 1);
    if (!record) return null;
    return {
      ...record,
      id: String(entry.id || `population-${index + 1}`).slice(0, 160),
      schedules: normalizeScheduleSlots(entry.schedules)
    };
  }).filter(Boolean);
}

function normalizeScheduleSlots(input) {
  return (Array.isArray(input) ? input : []).slice(0, 24).map((entry) => {
    if (!entry || typeof entry !== 'object') return null;
    const at = normalizeTime(entry.at || entry.time);
    if (!at) return null;
    return {
      at,
      activity: String(entry.activity || entry.status || '').trim().slice(0, 160)
    };
  }).filter(Boolean);
}

function normalizeSystemEdges(input, limit) {
  return (Array.isArray(input) ? input : []).slice(0, limit).map((entry) => {
    if (!entry || typeof entry !== 'object') return null;
    const from = String(entry.from || '').slice(0, 160);
    const to = String(entry.to || '').slice(0, 160);
    if (!from || !to) return null;
    return {
      from,
      to,
      relation: String(entry.relation || entry.type || 'connected').slice(0, 80),
      cost: clampInteger(entry.cost, 0, 1000000, 1),
      sourceEntryId: String(entry.sourceEntryId || '').slice(0, 160),
      visibility: normalizeVisibility(entry.visibility)
    };
  }).filter(Boolean);
}

function normalizeFactionRelations(input, limit) {
  return (Array.isArray(input) ? input : []).slice(0, limit).map((entry) => {
    if (!entry || typeof entry !== 'object') return null;
    const from = String(entry.from || '').slice(0, 160);
    const to = String(entry.to || '').slice(0, 160);
    if (!from || !to) return null;
    return {
      from,
      to,
      stance: clampInteger(entry.stance, -100, 100, 0),
      reason: String(entry.reason || '').slice(0, 300),
      sourceEntryId: String(entry.sourceEntryId || '').slice(0, 160),
      visibility: normalizeVisibility(entry.visibility)
    };
  }).filter(Boolean);
}

function normalizeClock(input) {
  const day = clampInteger(input?.day, 1, 999999, 1);
  const minuteOfDay = clampInteger(input?.minuteOfDay ?? input?.minute, 0, 1439, 480);
  return { day, minuteOfDay, label: formatClock(day, minuteOfDay) };
}

function fromAbsoluteMinute(value) {
  const absolute = Math.max(0, normalizeInteger(value, 0));
  const day = Math.floor(absolute / 1440) + 1;
  const minuteOfDay = absolute % 1440;
  return { day, minuteOfDay, label: formatClock(day, minuteOfDay) };
}

function toAbsoluteMinute(clock) {
  return (Math.max(1, clock.day) - 1) * 1440 + clock.minuteOfDay;
}

function formatClock(day, minuteOfDay) {
  const hours = String(Math.floor(minuteOfDay / 60)).padStart(2, '0');
  const minutes = String(minuteOfDay % 60).padStart(2, '0');
  return `第${day}日 ${hours}:${minutes}`;
}

function scheduleOccurrences(schedule, startAbsolute, endAbsolute) {
  const occurrences = [];
  const minute = parseTime(schedule.at);
  if (minute === null) return occurrences;
  const startDay = Math.floor(startAbsolute / 1440) + 1;
  const endDay = Math.floor(endAbsolute / 1440) + 1;
  for (let day = startDay; day <= endDay; day += 1) {
    const weekday = ((day - 1) % 7) + 1;
    if (schedule.days.length && !schedule.days.includes(weekday)) continue;
    const absolute = (day - 1) * 1440 + minute;
    if (absolute > startAbsolute && absolute <= endAbsolute) occurrences.push(absolute);
  }
  return occurrences;
}

function normalizeSchedule(input) {
  return (Array.isArray(input) ? input : []).slice(0, 48).map((entry, index) => {
    if (!entry || typeof entry !== 'object') return null;
    const at = normalizeTime(entry.at || entry.time);
    if (!at) return null;
    return {
      id: normalizeActorId(entry.id || `schedule-${index + 1}`),
      at,
      days: (Array.isArray(entry.days) ? entry.days : []).map(Number).filter((day) => Number.isInteger(day) && day >= 1 && day <= 7),
      location: String(entry.location || '').trim().slice(0, 160),
      activity: String(entry.activity || entry.status || '').trim().slice(0, 240),
      visibility: normalizeVisibility(entry.visibility)
    };
  }).filter(Boolean);
}

function normalizeAgenda(input) {
  return (Array.isArray(input) ? input : []).slice(0, 30).map((entry, index) => {
    if (typeof entry === 'string') {
      return { id: `agenda-${index + 1}`, title: entry.slice(0, 240), priority: 50, status: 'active', visibility: 'private' };
    }
    if (!entry || typeof entry !== 'object') return null;
    const title = String(entry.title || entry.goal || '').trim().slice(0, 240);
    if (!title) return null;
    return {
      id: normalizeActorId(entry.id || `agenda-${index + 1}`),
      title,
      priority: clampInteger(entry.priority, 0, 100, 50),
      status: ['active', 'blocked', 'completed', 'failed'].includes(entry.status) ? entry.status : 'active',
      visibility: normalizeVisibility(entry.visibility || 'private')
    };
  }).filter(Boolean);
}

function normalizeRelationships(input) {
  return (Array.isArray(input) ? input : []).slice(0, 50).map((entry) => {
    if (!entry || typeof entry !== 'object') return null;
    const targetId = normalizeActorId(entry.targetId || entry.target);
    if (!targetId) return null;
    return {
      targetId,
      trust: clampInteger(entry.trust, -100, 100, 0),
      tension: clampInteger(entry.tension, -100, 100, 0),
      lastReason: String(entry.lastReason || entry.reason || '').trim().slice(0, 300)
    };
  }).filter(Boolean);
}

function normalizeBackstageEvents(input) {
  return (Array.isArray(input) ? input : []).slice(-2000).filter((entry) => entry && typeof entry === 'object').map((entry) => ({
    id: String(entry.id || `backstage-${crypto.randomUUID()}`),
    timestamp: String(entry.timestamp || new Date().toISOString()),
    absoluteMinute: normalizeInteger(entry.absoluteMinute, 0),
    actorId: String(entry.actorId || ''),
    actorName: String(entry.actorName || ''),
    visibility: normalizeVisibility(entry.visibility),
    summary: String(entry.summary || '').slice(0, 500),
    reason: String(entry.reason || '').slice(0, 240)
  }));
}

function normalizeMetadata(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  return Object.fromEntries(Object.entries(input).slice(0, 20).map(([key, value]) => [String(key).slice(0, 64), String(value).slice(0, 240)]));
}

function uniqueStrings(input, maxItems, maxLength) {
  return [...new Set((Array.isArray(input) ? input : []).map((item) => String(item || '').trim().slice(0, maxLength)).filter(Boolean))].slice(0, maxItems);
}

function normalizeActorId(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_.:\-\u4e00-\u9fff]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100);
}

function slugify(value) {
  return normalizeActorId(value) || `npc-${crypto.randomUUID()}`;
}

function normalizeTime(value) {
  const minute = parseTime(value);
  if (minute === null) return '';
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

function parseTime(value) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function normalizeVisibility(value) {
  const visibility = String(value || 'public').trim().toLowerCase();
  return ['public', 'private', 'director'].includes(visibility) ? visibility : 'public';
}

function normalizeInteger(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : fallback;
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

function normalizeAutoAdvanceMinutes(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || Math.trunc(number) < 1) return 10;
  return clampInteger(number, 1, 1440, 10);
}
