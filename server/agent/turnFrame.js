export const NARRATIVE_TURN_FRAME_SPEC = 'lra.narrative-turn-frame/v1';

// Providers occasionally normalize the documented <turn_frame> tag to
// <TurnFrame> or <turn-frame>. All three spellings carry the same hidden
// control-plane payload and must never become visible story prose.
const TURN_FRAME_PATTERN = /<turn[_-]?frame\b[^>]*>\s*([\s\S]*?)\s*<\/turn[_-]?frame\s*>/ig;
const TURN_FRAME_FENCE_PATTERN = /```lra-turn-frame\s*([\s\S]*?)```/ig;
const DECISION_KINDS = new Set([
  'direct-response',
  'explicit-choice',
  'immediate-threat',
  'pending-interaction',
  'new-discovery',
  'navigation',
  'open-state'
]);
const EVIDENCE_STATUSES = new Set(['confirmed', 'hypothesis', 'risk']);
const TRUSTED_FACT_SOURCE = /(?:角色卡|character[- ]?card|世界书|world[- ]?book|用户|玩家|user|既有(?:已确认)?状态|confirmed[- ]?state|动作裁决|action[- ]?adjudication|动作协议|action[- ]?protocol)/iu;

export function extractNarrativeTurnFrame(rawContent) {
  const source = String(rawContent || '');
  const blocks = [
    ...source.matchAll(TURN_FRAME_PATTERN),
    ...source.matchAll(TURN_FRAME_FENCE_PATTERN)
  ];
  let frame = null;
  let error = null;
  for (const match of blocks) {
    try {
      frame = normalizeNarrativeTurnFrame(JSON.parse(String(match[1] || '').trim()));
      error = null;
    } catch (cause) {
      error = {
        code: 'TURN_FRAME_INVALID',
        detail: String(cause?.message || cause || 'invalid turn frame').slice(0, 240)
      };
    }
  }
  return {
    content: stripNarrativeTurnFrame(source),
    frame,
    error
  };
}

export function stripNarrativeTurnFrame(rawContent) {
  return String(rawContent || '')
    .replace(TURN_FRAME_PATTERN, '\n')
    .replace(TURN_FRAME_FENCE_PATTERN, '\n')
    .trim();
}

export function normalizeNarrativeTurnFrame(value) {
  if (!isRecord(value)) throw new Error('TURN_FRAME_OBJECT_REQUIRED');
  const scene = isRecord(value.scene) ? value.scene : {};
  const decision = isRecord(value.decision) ? value.decision : {};
  const affordances = isRecord(value.affordances) ? value.affordances : {};
  const stateDelta = isRecord(value.stateDelta) ? value.stateDelta : {};
  const panels = isRecord(value.panels) ? value.panels : {};
  const kind = DECISION_KINDS.has(String(decision.kind || ''))
    ? String(decision.kind)
    : 'open-state';
  const frame = {
    spec: NARRATIVE_TURN_FRAME_SPEC,
    scene: {
      location: text(scene.location, 120),
      time: text(scene.time, 120),
      summary: text(scene.summary, 360),
      presentActors: strings(scene.presentActors, 12, 80)
    },
    decision: {
      kind,
      focus: text(decision.focus, 240),
      actor: text(decision.actor, 80),
      requiresPlayerResponse: decision.requiresPlayerResponse === true,
      urgency: ['low', 'normal', 'high', 'critical'].includes(String(decision.urgency || ''))
        ? String(decision.urgency)
        : 'normal'
    },
    evidence: normalizeEvidence(value.evidence),
    affordances: {
      routes: strings(affordances.routes, 8, 100),
      interactables: strings(affordances.interactables, 10, 100),
      threats: strings(affordances.threats, 6, 160),
      constraints: strings(affordances.constraints, 8, 160)
    },
    stateDelta: {
      summary: text(stateDelta.summary, 320),
      facts: normalizeEvidence(stateDelta.facts),
      timeAdvanceMinutes: numberOrNull(stateDelta.timeAdvanceMinutes)
    },
    panels: {
      sceneStatus: text(panels.sceneStatus, 600),
      characterStatus: text(panels.characterStatus, 600),
      relationshipStatus: text(panels.relationshipStatus, 600),
      nextCharacter: text(panels.nextCharacter, 600)
    },
    validation: {
      status: 'schema-valid',
      source: 'model-turn-frame'
    }
  };
  if (!frame.scene.summary && !frame.decision.focus && !frame.evidence.length) {
    throw new Error('TURN_FRAME_MEANINGFUL_CONTENT_REQUIRED');
  }
  return frame;
}

export function acceptNarrativeTurnFrame(frame, { consistencyValid = true } = {}) {
  if (!isRecord(frame)) return null;
  const next = structuredClone(frame);
  const admission = consistencyValid ? resolveFactAdmission(next) : blockedFactAdmission();
  const source = text(next?.validation?.source, 80) || 'model-turn-frame';
  next.validation = {
    status: consistencyValid ? 'accepted' : 'rejected',
    source,
    factAdmission: admission.status,
    groundedFactCount: admission.groundedFactCount,
    candidateFactCount: admission.candidateFactCount,
    acceptedAt: new Date().toISOString()
  };
  return next;
}

/**
 * Community presets do not always return the optional TurnFrame block. Keep the
 * visible reply, but derive a deliberately small same-turn frame from facts that
 * are explicit in the accepted prose and names already known to the session.
 * The result is only a navigation/interaction projection: it never promotes
 * prose guesses to canonical facts.
 */
export function deriveConservativeNarrativeTurnFrame({ content, memory = {} } = {}) {
  const source = String(content || '').replace(/\r/g, '').trim();
  if (!source) return null;

  const knownActors = collectKnownActors(memory);
  const presentActors = collectPresentActors(source, knownActors);
  const protagonistName = text(memory?.worldState?.protagonist?.name, 80);
  if (protagonistName && !presentActors.includes(protagonistName)) presentActors.unshift(protagonistName);
  const location = resolveNarrativeLocation(source, memory);
  const time = resolveNarrativeTime(source, memory);
  const decision = deriveNarrativeDecision(source, presentActors, protagonistName);
  const summary = deriveSceneSummary(source);
  const normalized = normalizeNarrativeTurnFrame({
    scene: { location, time, summary, presentActors },
    decision,
    evidence: summary ? [{ text: summary, status: 'hypothesis', source: 'accepted-prose-fallback' }] : [],
    affordances: { routes: [], interactables: [], threats: [], constraints: ['只同步正文明确呈现的信息'] },
    stateDelta: { summary, facts: [], timeAdvanceMinutes: null },
    panels: {}
  });
  normalized.validation.source = 'conservative-prose-fallback';
  return normalized;
}

export function resolveNarrativeTurnFrame(frame, {
  consistencyValid = true,
  content = '',
  memory = {}
} = {}) {
  if (!consistencyValid) return acceptNarrativeTurnFrame(frame, { consistencyValid: false });
  const fallback = deriveConservativeNarrativeTurnFrame({ content, memory });
  const candidate = isRecord(frame)
    ? reconcileNarrativeTurnFrame(frame, fallback, content)
    : fallback;
  return acceptNarrativeTurnFrame(candidate, { consistencyValid: true });
}

/**
 * Persist only a changed, explicit scene coordinate. Actors and uncertain facts
 * stay in the TurnFrame/current-act projection until normal fact extraction has
 * enough evidence to admit them into canonical world state.
 */
export function buildTurnFrameStateEnvelope(frame, memory = {}, existingEnvelope = null, { content = '' } = {}) {
  if (frame?.validation?.status !== 'accepted') return null;
  const location = text(frame?.scene?.location, 120);
  const currentLocation = resolveStoredLocation(memory);
  const existingActions = Array.isArray(existingEnvelope?.actions) ? existingEnvelope.actions : [];
  const alreadyUpdatesLocation = existingActions
    .some((action) => action?.type === 'state.set' && action?.path === 'location.current');
  const actions = [];
  if (location && location !== currentLocation && !alreadyUpdatesLocation) {
    actions.push({
      type: 'state.set',
      path: 'location.current',
      value: location,
      visibility: 'public',
      reason: frame.validation.source === 'conservative-prose-fallback'
        ? '正文明确移动后的保守场景同步'
        : '结构化回合声明的场景同步'
    });
  }
  actions.push(...deriveCompletedQuestActions(memory, content, existingActions));
  if (!actions.length) return null;
  return {
    spec: 'lra.action/v1',
    actorId: 'narrator',
    summary: actions.length === 1 && actions[0].type === 'state.set'
      ? `同步本轮明确地点：${location}`
      : '同步本轮正文已经明确落地的状态',
    baseRevision: null,
    actions
  };
}

export function turnFrameAllowsFactAdmission(frame) {
  return frame?.validation?.status === 'accepted'
    && frame.validation.factAdmission === 'grounded';
}

export function materializeTurnFramePanels(frame) {
  if (!isRecord(frame)) return {};
  const panels = isRecord(frame.panels) ? frame.panels : {};
  const scene = isRecord(frame.scene) ? frame.scene : {};
  const decision = isRecord(frame.decision) ? frame.decision : {};
  const sceneStatus = panels.sceneStatus || [
    scene.location ? `地点：${scene.location}` : '',
    scene.time ? `时间：${scene.time}` : '',
    scene.presentActors?.length ? `在场：${scene.presentActors.join('、')}` : '',
    scene.summary
  ].filter(Boolean).join('\n');
  const nextCharacter = panels.nextCharacter || (
    decision.requiresPlayerResponse && (decision.actor || decision.focus)
      ? [`待回应：${decision.actor || '当前交互'}`, decision.focus].filter(Boolean).join('\n')
      : ''
  );
  return compactRecord({
    sceneStatus,
    characterStatus: panels.characterStatus,
    relationshipStatus: panels.relationshipStatus,
    nextCharacter
  });
}

function normalizeEvidence(value) {
  return (Array.isArray(value) ? value : [])
    .map((entry) => {
      if (typeof entry === 'string') return { text: text(entry, 220), status: 'hypothesis', source: 'model-current-turn' };
      if (!isRecord(entry)) return null;
      const status = EVIDENCE_STATUSES.has(String(entry.status || ''))
        ? String(entry.status)
        : 'hypothesis';
      return {
        text: text(entry.text || entry.fact || entry.summary, 220),
        status,
        source: text(entry.source, 120) || 'current-turn'
      };
    })
    .filter((entry) => entry?.text)
    .slice(0, 16);
}

function resolveFactAdmission(frame) {
  const facts = [
    ...(Array.isArray(frame?.evidence) ? frame.evidence : []),
    ...(Array.isArray(frame?.stateDelta?.facts) ? frame.stateDelta.facts : [])
  ].filter((entry) => entry?.text);
  const confirmed = facts.filter((entry) => entry.status === 'confirmed');
  const grounded = confirmed.filter((entry) => TRUSTED_FACT_SOURCE.test(String(entry.source || '')));
  const ungroundedConfirmed = confirmed.length - grounded.length;
  return {
    status: confirmed.length > 0 && ungroundedConfirmed === 0 ? 'grounded' : 'candidate-only',
    groundedFactCount: grounded.length,
    candidateFactCount: facts.length - grounded.length
  };
}

function blockedFactAdmission() {
  return { status: 'blocked', groundedFactCount: 0, candidateFactCount: 0 };
}

function reconcileNarrativeTurnFrame(frame, fallback, content) {
  if (!isRecord(fallback)) return frame;
  const next = structuredClone(frame);
  const modelDecision = isRecord(next.decision) ? next.decision : {};
  const fallbackDecision = fallback.decision;
  const invalidExplicitChoice = modelDecision.kind === 'explicit-choice'
    && !isCompleteExplicitChoice(modelDecision.focus);
  const fallbackClosesLatestInteraction = fallbackDecision?.requiresPlayerResponse === true
    && (
      invalidExplicitChoice
      || modelDecision.requiresPlayerResponse !== true
      || ['open-state', 'new-discovery', 'navigation'].includes(String(modelDecision.kind || ''))
    );
  if (fallbackClosesLatestInteraction) next.decision = structuredClone(fallbackDecision);

  const modelActors = Array.isArray(next?.scene?.presentActors) ? next.scene.presentActors : [];
  if (next.scene) {
    next.scene.presentActors = strings([...modelActors, ...fallback.scene.presentActors], 12, 80);
    if (!next.scene.location || hasExplicitMovementToLocation(content, fallback.scene.location)) {
      next.scene.location = fallback.scene.location;
    }
    // The simulation clock is authoritative. A prose-derived label is used
    // only when no clock exists, so preferring it prevents mixed story times.
    if (fallback.scene.time) next.scene.time = fallback.scene.time;
  }
  next.validation = {
    ...(isRecord(next.validation) ? next.validation : {}),
    source: fallbackClosesLatestInteraction
      ? 'model-turn-frame-reconciled'
      : text(next?.validation?.source, 80) || 'model-turn-frame'
  };
  return next;
}

function hasExplicitMovementToLocation(content, location) {
  const source = String(content || '').slice(-1800);
  const target = text(location, 120);
  if (!source || !target) return false;
  return new RegExp(`(?:来到|走到|行至|抵达|回到|进入|进到|停在|站在|坐在|跪在|藏进|躲进|走向|朝(?:着)?|往)[^，。！？；：\\n]{0,32}${escapeRegExp(target)}`, 'u').test(source)
    || new RegExp(`${escapeRegExp(target)}[^，。！？；：\\n]{0,20}(?:到了|停下|站定|坐下|跪下|藏好|躲好)`, 'u').test(source);
}

function collectKnownActors(memory) {
  const values = [
    memory?.worldState?.protagonist,
    ...(Array.isArray(memory?.worldState?.characters) ? memory.worldState.characters : []),
    ...(Array.isArray(memory?.simulation?.actors) ? memory.simulation.actors : []),
    ...(Array.isArray(memory?.characterRegistry?.records) ? memory.characterRegistry.records : []),
    ...(Array.isArray(memory?.characterRegistry?.currentAct?.members) ? memory.characterRegistry.currentAct.members : [])
  ];
  const seen = new Set();
  return values.flatMap((entry) => {
    const name = text(entry?.name || entry, 80);
    const key = name.toLocaleLowerCase('zh-CN');
    if (!isPlausibleActorName(name) || seen.has(key)) return [];
    seen.add(key);
    return [name];
  });
}

function collectPresentActors(source, knownActors) {
  const closing = source.slice(-1800);
  return knownActors
    .filter((name) => closing.includes(name))
    .filter((name) => !new RegExp(`${escapeRegExp(name)}.{0,18}(?:已离开|离去了|走远|退场|不在场)`, 'u').test(closing))
    .slice(0, 12);
}

function resolveNarrativeLocation(source, memory) {
  // Movement often appears at the start of a long standard turn while the
  // closing paragraphs contain only the interaction that follows it.
  const closing = source.slice(-6000);
  const candidates = collectKnownLocations(memory)
    .map((label) => ({ label, index: closing.lastIndexOf(label) }))
    .filter((entry) => entry.index >= 0)
    .sort((left, right) => right.index - left.index);
  const movedTo = [...closing.matchAll(/(?:来到|走到|行至|抵达|回到|进入|进到|停在|站在|坐在|跪在|藏进|躲进|走向|朝(?:着)?|往)\s*([^，。！？；：\n]{1,28})/gu)]
    .reverse()
    .map((movement) => cleanMovementLocation(movement?.[1]))
    .find(Boolean);
  if (movedTo) return movedTo;
  if (candidates[0]?.label) return candidates[0].label;
  return resolveStoredLocation(memory);
}

function collectKnownLocations(memory) {
  const location = memory?.worldState?.location;
  const values = [
    location?.current,
    location?.name,
    location?.title,
    ...(Array.isArray(location?.knownPlaces) ? location.knownPlaces : []),
    memory?.characterRegistry?.currentAct?.location,
    ...(Array.isArray(memory?.worldState?.characters) ? memory.worldState.characters.map((entry) => entry?.location) : []),
    ...(Array.isArray(memory?.simulation?.actors) ? memory.simulation.actors.map((entry) => entry?.location) : [])
  ];
  return strings(values, 40, 120).sort((left, right) => right.length - left.length);
}

function resolveStoredLocation(memory) {
  const location = memory?.worldState?.location;
  return text(
    memory?.characterRegistry?.currentAct?.location
      || location?.current
      || location?.name
      || location?.title
      || location?.label
      || (typeof location === 'string' ? location : ''),
    120
  );
}

function deriveCompletedQuestActions(memory, content, existingActions = []) {
  const source = String(content || '');
  if (!source) return [];
  const quests = Array.isArray(memory?.worldState?.quests) ? memory.worldState.quests : [];
  return quests.flatMap((quest) => {
    const questId = text(quest?.id || quest?.questId, 120);
    if (!questId || String(quest?.status || '').toLowerCase() === 'completed') return [];
    if (existingActions.some((action) => action?.type === 'quest.update' && String(action?.questId || action?.quest) === questId)) {
      return [];
    }
    const contract = `${quest?.title || ''}\n${quest?.objective || ''}`;
    const isWellChore = /(?:井轱辘|井绳|水桶吊|压井|提桶|打水)/u.test(contract);
    const explicitlyCompleted = /(?:绞到最后一圈|提到井口|提了上来|拉了上来|把|将)[^。！？\n]{0,36}(?:水桶|木桶)[^。！？\n]{0,28}(?:搁|放|稳|落|提)(?:在|到|上)[^。！？\n]{0,12}(?:井台|井沿|井口)/u.test(source)
      || /(?:水桶|木桶)[^。！？\n]{0,18}(?:已经|终于)?(?:被)?(?:提到井口|拉上井台|搁在井台|放在井台)/u.test(source)
      || /(?:水桶|木桶)[\s\S]{0,140}(?:把|将)它[^。！？\n]{0,24}(?:搁|放|稳|落)(?:在|到|上)[^。！？\n]{0,12}(?:井台|井沿|井口)/u.test(source);
    if (!isWellChore || !explicitlyCompleted) return [];
    return [{
      type: 'quest.update',
      questId,
      status: 'completed',
      progress: 100,
      note: '本轮正文已明确完成该现场事务',
      visibility: 'public',
      reason: '正文结果已落地，避免已完成任务继续占用当前决策'
    }];
  });
}

function cleanMovementLocation(value) {
  let candidate = text(value, 48)
    .replace(/^(?:了|那|这|一处|一座|一间|一片)\s*/u, '')
    .replace(/(?:走去|走来|过去|而去|前去|去|来|停下|站定|坐下|跪下|藏好|躲好).*$/u, '')
    .replace(/(?:的时候|之时|之际|以后|之后|时).*$/u, '')
    .replace(/(?:附近|近旁|边上|旁边|边|旁|前|后|里面|里|中|下|上)$/u, '')
    .trim();
  const place = candidate.match(/[\p{Script=Han}]{1,16}(?:井台|井边|槐树|院子|院|屋|房|门|庭|廊|道|山|林|殿|阁|楼|室|街|巷|田|洞|谷|坡|台|场|河|岸|桥|城|镇|村|宗|寺|观|坊|园|牢|塔|营|船|车)$/u)?.[0] || '';
  if (!place || /(?:哪里|那里|这里|什么|方向)$/u.test(place)) return '';
  return place;
}

function resolveNarrativeTime(source, memory) {
  const simulationTime = text(memory?.simulation?.calendar?.label || memory?.simulation?.clock?.label, 120);
  if (simulationTime) return simulationTime;
  const matches = [...source.slice(-1200).matchAll(/(?:翌日|次日|第二日|清晨|晨间|早晨|上午|正午|午后|傍晚|黄昏|入夜|夜里|深夜|子时|丑时|寅时|卯时|辰时|巳时|午时|未时|申时|酉时|戌时|亥时)/gu)];
  return text(matches.at(-1)?.[0], 120);
}

function deriveNarrativeDecision(source, presentActors, protagonistName) {
  const closing = source.slice(-1400);
  const speeches = [...closing.matchAll(/[“「『"]([^”」』"\n]{1,240})[”」』"]/gu)];
  for (const match of speeches.reverse()) {
    const focus = text(match[1], 240);
    const actor = resolveSpeechActor(closing, Number(match.index || 0), presentActors, protagonistName);
    if (isCompleteExplicitChoice(focus)) {
      return { kind: 'explicit-choice', focus, actor, requiresPlayerResponse: true, urgency: 'critical' };
    }
    if (isDirectQuestion(focus)) {
      return { kind: 'direct-response', focus, actor, requiresPlayerResponse: true, urgency: 'high' };
    }
    if (isCommandOrRequest(focus)) {
      return { kind: 'pending-interaction', focus, actor, requiresPlayerResponse: true, urgency: 'high' };
    }
  }

  const finalSentence = lastNarrativeSentence(closing);
  if (/(?:下一瞬|眼看|即将|逼近|袭来|扑来|就要|马上).{0,80}(?:击中|撞上|暴露|发现|封死|坍塌|爆发|失控)/u.test(finalSentence)) {
    return { kind: 'immediate-threat', focus: finalSentence, actor: '', requiresPlayerResponse: true, urgency: 'critical' };
  }
  if (/(?:等你|等着你|只等|看你如何|由你决定|交给你决定)/u.test(finalSentence)) {
    return { kind: 'pending-interaction', focus: finalSentence, actor: resolveSpeechActor(closing, closing.length, presentActors, protagonistName), requiresPlayerResponse: true, urgency: 'high' };
  }
  if (/(?:发现|露出|浮现|出现|异动|异常|痕迹|线索|亮起|响起|裂开|渗出)/u.test(finalSentence)) {
    return { kind: 'new-discovery', focus: finalSentence, actor: '', requiresPlayerResponse: false, urgency: 'normal' };
  }
  return { kind: 'open-state', focus: finalSentence, actor: '', requiresPlayerResponse: false, urgency: 'normal' };
}

function isCompleteExplicitChoice(value) {
  const source = String(value || '');
  if (/(?:……|\.{3,})/u.test(source)) return false;
  const match = source.match(/要么(.{1,80})要么(.{1,80})/u);
  if (match && text(match[1], 80) && text(match[2], 80)) return true;
  return /(?:二选一|由你决定|你来决定|请选择|选择其中|只能选择|你(?:想|要|选).{1,80}还是)/u.test(source);
}

function isDirectQuestion(value) {
  const source = String(value || '').trim();
  return /[？?]$/u.test(source)
    || /(?:谁|什么|哪(?:里|个|一)|为何|为什么|怎么|如何|是否|能否|可否|吗|么|呢)[？?。！!]?$/u.test(source);
}

function isCommandOrRequest(value) {
  const source = String(value || '').trim();
  return /(?:你(?:先|再|就|来|去|把|给|替|帮|看|看看|瞧|听|说|告诉|回答|确认|决定|定)|请|劳烦|别|不要|不许|跟我|随我|过来|站住|放下|打开|关上|看看再定)/u.test(source);
}

function resolveSpeechActor(source, index, presentActors, protagonistName) {
  const prefix = source.slice(Math.max(0, index - 180), index);
  const candidates = presentActors
    .filter((name) => name !== protagonistName)
    .map((name) => ({ name, index: prefix.lastIndexOf(name) }))
    .filter((entry) => entry.index >= 0)
    .sort((left, right) => right.index - left.index);
  if (candidates[0]) return candidates[0].name;
  const nonProtagonists = presentActors.filter((name) => name !== protagonistName);
  return nonProtagonists.length === 1 ? nonProtagonists[0] : '';
}

function deriveSceneSummary(source) {
  const paragraphs = source.split(/\n{2,}/u).map((entry) => text(entry, 360)).filter(Boolean);
  const selected = paragraphs.slice(-2).join(' ');
  return text(selected || source, 360);
}

function lastNarrativeSentence(source) {
  const sentences = String(source || '').split(/(?<=[。！？!?])\s*/u).map((entry) => text(entry, 240)).filter(Boolean);
  return sentences.at(-1) || text(source, 240);
}

function isPlausibleActorName(value) {
  const name = String(value || '').trim();
  return name.length >= 2 && name.length <= 32 && /^[\p{Script=Han}A-Za-z0-9·_\-\s]+$/u.test(name);
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function strings(value, limit, maxLength) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((item) => text(item?.label || item?.name || item, maxLength))
    .filter(Boolean))].slice(0, limit);
}

function text(value, maxLength) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function compactRecord(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => String(item || '').trim()));
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
