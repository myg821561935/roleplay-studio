import {
  excludesRecursiveActivation,
  preventsRecursiveScan,
  scoreCard
} from './memoryRetriever.js';
import {
  appendWorldBookAdditionalSources,
  buildWorldBookScanContext,
  matchesWorldBookCharacterFilter,
  matchesWorldBookGenerationType,
  summarizeWorldBookScanContext
} from './worldBookContext.js';

export const WORLD_BOOK_ACTIVATION_SPEC = 'narrative-engine.worldbook-activation/v1';

export function finalizeWorldBookActivation(snapshot, retainedEntries = []) {
  const next = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
    ? structuredClone(snapshot)
    : { spec: WORLD_BOOK_ACTIVATION_SPEC, effects: {}, suppressed: {} };
  const retainedIds = new Set((Array.isArray(retainedEntries) ? retainedEntries : [])
    .map((entry) => typeof entry === 'string' ? entry : entryKey(entry)));
  const candidateIds = Array.isArray(next.activatedIds) ? next.activatedIds : [];
  const omittedIds = candidateIds.filter((id) => !retainedIds.has(id));
  ['activatedIds', 'directIds', 'minimumActivationIds', 'recursiveIds', 'stickyIds'].forEach((key) => {
    next[key] = (Array.isArray(next[key]) ? next[key] : []).filter((id) => retainedIds.has(id));
  });
  const newEffectIds = new Set(Array.isArray(next.newEffectIds) ? next.newEffectIds : []);
  omittedIds.forEach((id) => {
    if (newEffectIds.has(id) && next.effects) delete next.effects[id];
  });
  next.newEffectIds = [...newEffectIds].filter((id) => retainedIds.has(id));
  next.suppressed = {
    ...(next.suppressed || {}),
    budgetIds: omittedIds
  };
  return next;
}

/**
 * Activate World Info entries with SillyTavern-compatible scan, group,
 * probability and timed-effect semantics. Random choices are derived from a
 * stable seed so a saved branch can be replayed exactly.
 */
export function activateWorldBookEntries(args = {}) {
  const worldBook = normalizeEntries(args.worldBook);
  const memoryCards = normalizeEntries(args.memoryCards);
  const entries = [...worldBook, ...memoryCards];
  const messages = Array.isArray(args.messages) ? args.messages : [];
  const includeNames = args.includeNames !== false;
  const additionalScanText = String(args.additionalScanText || '').trim().slice(0, 1200);
  const chat = buildChat(messages, args.userMessage, {
    userName: args.userName,
    characterName: args.characterName
  });
  const messageCount = chat.length;
  const scanContext = buildWorldBookScanContext({
    generationType: args.generationType,
    characterCard: args.characterCard,
    persona: args.persona,
    groupMembers: args.groupMembers,
    targetSpeaker: args.targetSpeaker
  });
  const maxTriggeredCards = normalizeLimit(args.maxCards, 5);
  const maxRecursionDepth = normalizeLimit(args.maxRecursionDepth, 1);
  const defaultScanDepth = normalizeLimit(args.defaultScanDepth, Math.max(1, chat.length));
  const minActivations = normalizeLimit(args.minActivations, 0);
  const configuredMinDepthMax = normalizeLimit(args.minActivationsDepthMax, 0);
  const minActivationsDepthMax = configuredMinDepthMax > 0
    ? Math.min(configuredMinDepthMax, messageCount)
    : messageCount;
  const matchingDefaults = {
    caseSensitive: args.caseSensitive === true,
    matchWholeWords: args.matchWholeWords === true
  };
  const seedHash = stableHash([
    String(args.seed || ''),
    String(messageCount),
    ...chat.map((message) => `${message.id || ''}:${message.role || ''}:${message.speaker || ''}:${message.content || ''}`)
  ].join('\n'));
  const effects = restoreEffects({
    previous: findPreviousActivation(messages),
    entries,
    messageCount
  });
  const suppressed = {
    generationTypeIds: new Set(),
    characterFilterIds: new Set(),
    cooldownIds: new Set(),
    delayIds: new Set(),
    recursionDelayIds: new Set(),
    groupIds: new Set(),
    probabilityIds: new Set()
  };
  const activatedGroups = new Set();
  const activatedItems = [];
  const recursionDelayLevels = [...new Set(entries
    .map(entryRecursionDelayLevel)
    .filter((level) => level > 0))]
    .sort((left, right) => left - right);
  let currentRecursionDelayLevel = recursionDelayLevels.shift() ?? 0;
  let available = [...entries];
  let recursionQuery = '';
  let scanState = 'initial';
  let scanDepth = defaultScanDepth;
  let recursionStep = 0;
  const safetyLimit = Math.max(8, entries.length * 3 + messageCount + recursionDelayLevels.length);

  for (let scanCount = 0; scanState && scanCount < safetyLimit; scanCount += 1) {
    const isRecursiveScan = scanState === 'recursion';
    if (isRecursiveScan) recursionStep += 1;
    const triggerDepth = isRecursiveScan ? recursionStep : 0;
    const candidates = [];

    for (const card of available) {
      const id = entryKey(card);
      const effect = effects[id];
      const sticky = isStickyActive(effect, messageCount);
      const recursionDelayLevel = entryRecursionDelayLevel(card);

      if (!matchesWorldBookGenerationType(card, scanContext.generationType)) {
        suppressed.generationTypeIds.add(id);
        continue;
      }
      if (!matchesWorldBookCharacterFilter(card, scanContext.characters)) {
        suppressed.characterFilterIds.add(id);
        continue;
      }

      if (!sticky && isCooldownActive(effect, messageCount)) {
        suppressed.cooldownIds.add(id);
        continue;
      }
      if (!sticky && messageCount < entryNumber(card, ['delay'], 0)) {
        suppressed.delayIds.add(id);
        continue;
      }
      if (!sticky && recursionDelayLevel > 0 && !isRecursiveScan) {
        suppressed.recursionDelayIds.add(id);
        continue;
      }
      if (!sticky && isRecursiveScan && recursionDelayLevel > currentRecursionDelayLevel) {
        suppressed.recursionDelayIds.add(id);
        continue;
      }
      if (!sticky && isRecursiveScan && excludesRecursiveActivation(card)) continue;

      let score = 0;
      if (sticky) {
        score = 20000 + entryOrder(card);
      } else if (!isRecursiveScan) {
        const effectiveDepth = scanState === 'minimum'
          ? entryMinimumScanDepth(card, scanDepth)
          : entryScanDepth(card, defaultScanDepth);
        if (card.constant === true) {
          score = scoreCard(card, '', matchingDefaults);
        } else if (effectiveDepth > 0) {
          const query = appendWorldBookAdditionalSources(
            [buildScanQuery(chat, effectiveDepth, includeNames), additionalScanText].filter(Boolean).join('\n'),
            card,
            scanContext
          );
          score = scoreCard(card, query, matchingDefaults);
        }
      } else {
        const effectiveDepth = entryScanDepth(card, scanDepth);
        const chatQuery = effectiveDepth > 0 ? buildScanQuery(chat, effectiveDepth, includeNames) : '';
        const baseQuery = [chatQuery, additionalScanText, recursionQuery].filter(Boolean).join('\n');
        const query = effectiveDepth > 0
          ? appendWorldBookAdditionalSources(baseQuery, card, scanContext)
          : baseQuery;
        if (card.constant === true) score = scoreCard(card, '', matchingDefaults);
        else if (query) score = scoreCard(card, query, matchingDefaults);
      }

      if (score > 0) {
        candidates.push({
          card,
          id,
          score,
          sticky,
          triggerDepth,
          activationSource: scanState
        });
      }
    }

    const matchedIds = new Set(candidates.map((item) => item.id));
    const groupFiltered = resolveInclusionGroups({
      candidates,
      activatedGroups,
      seedHash,
      triggerDepth,
      suppressed
    });
    const accepted = groupFiltered.filter((item) => {
      if (item.sticky || passesProbability(item.card, seedHash, messageCount, triggerDepth)) return true;
      suppressed.probabilityIds.add(item.id);
      return false;
    });

    available = available.filter((card) => !matchedIds.has(entryKey(card)));
    accepted.forEach((item) => {
      activatedItems.push(item);
      suppressed.recursionDelayIds.delete(item.id);
      entryGroups(item.card).forEach((group) => activatedGroups.add(group));
    });
    const newContent = accepted
      .filter((item) => !preventsRecursiveScan(item.card))
      .map((item) => String(item.card.content || ''))
      .join('\n');
    if (newContent.trim()) recursionQuery = `${recursionQuery}\n${newContent}`.slice(-4000);

    const canRecurse = minActivations > 0 || recursionStep < maxRecursionDepth;
    if (newContent.trim() && canRecurse) {
      scanState = 'recursion';
      continue;
    }
    if (minActivations > 0
      && activatedItems.length < minActivations
      && scanDepth < minActivationsDepthMax) {
      scanDepth += 1;
      scanState = 'minimum';
      continue;
    }
    if (recursionDelayLevels.length && canRecurse) {
      currentRecursionDelayLevel = recursionDelayLevels.shift();
      scanState = 'recursion';
      continue;
    }
    scanState = '';
  }

  activatedItems.sort(compareActivatedItems);
  const constantItems = activatedItems.filter((item) => item.card.constant === true);
  const triggeredItems = activatedItems
    .filter((item) => item.card.constant !== true)
    .slice(0, maxTriggeredCards);
  const selectedItems = [...constantItems, ...triggeredItems];
  const newEffectIds = applyNewEffects({ effects, items: selectedItems, messageCount });
  pruneExpiredEffects(effects, messageCount);

  const snapshot = {
    spec: WORLD_BOOK_ACTIVATION_SPEC,
    messageCount,
    seedHash,
    activatedIds: selectedItems.map((item) => item.id),
    directIds: selectedItems.filter((item) => item.triggerDepth === 0).map((item) => item.id),
    minimumActivationIds: selectedItems
      .filter((item) => item.activationSource === 'minimum')
      .map((item) => item.id),
    recursiveIds: selectedItems.filter((item) => item.triggerDepth > 0).map((item) => item.id),
    stickyIds: selectedItems.filter((item) => item.sticky).map((item) => item.id),
    newEffectIds,
    suppressed: Object.fromEntries(
      Object.entries(suppressed).map(([key, value]) => [key, [...value]])
    ),
    effects,
    scan: {
      includeNames,
      caseSensitive: matchingDefaults.caseSensitive,
      matchWholeWords: matchingDefaults.matchWholeWords,
      defaultDepth: defaultScanDepth,
      reachedDepth: scanDepth,
      minActivations,
      minActivationsDepthMax,
      additionalScanTerms: additionalScanText.split(/\n+/u).filter(Boolean),
      recursionSteps: recursionStep,
      recursionDelayLevel: currentRecursionDelayLevel
    },
    context: summarizeWorldBookScanContext(scanContext)
  };

  return {
    entries: selectedItems.map((item) => item.card),
    items: selectedItems,
    snapshot
  };
}

function normalizeEntries(value) {
  return (Array.isArray(value) ? value : [])
    .filter((card) => card && card.enabled !== false && String(card.content || '').trim());
}

function buildChat(messages, userMessage, { userName, characterName } = {}) {
  const chat = messages
    .filter((message) => message && !message.excluded)
    .map((message) => ({
      id: String(message.id || ''),
      role: String(message.role || ''),
      speaker: resolveMessageSpeaker(message, { userName, characterName }),
      content: String(message.content || '')
    }));
  if (userMessage !== undefined && userMessage !== null) {
    chat.push({
      id: '',
      role: 'user',
      speaker: String(userName || 'user'),
      content: String(userMessage || '')
    });
  }
  return chat;
}

function buildScanQuery(chat, scanDepth, includeNames) {
  return chat
    .slice(-Math.max(0, scanDepth))
    .map((message) => {
      const prefix = includeNames && message.speaker ? `${message.speaker}: ` : '';
      return `\x01${prefix}${String(message.content || '')}`;
    })
    .join('\n');
}

function resolveMessageSpeaker(message, { userName, characterName }) {
  const explicit = String(message?.speaker || '').trim();
  if (explicit) return explicit;
  if (message?.role === 'user') return String(userName || 'user');
  if (message?.role === 'assistant') return String(characterName || 'assistant');
  return String(message?.role || 'system');
}

function findPreviousActivation(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.excluded || message?.role !== 'assistant') continue;
    if (message.worldBookActivation?.spec === WORLD_BOOK_ACTIVATION_SPEC) {
      return message.worldBookActivation;
    }
  }
  return null;
}

function restoreEffects({ previous, entries, messageCount }) {
  const source = previous?.effects && typeof previous.effects === 'object' && !Array.isArray(previous.effects)
    ? previous.effects
    : {};
  const cardsById = new Map(entries.map((entry) => [entryKey(entry), entry]));
  const effects = {};

  Object.entries(source).forEach(([id, effect]) => {
    const card = cardsById.get(id);
    if (!card || !effect || effect.fingerprint !== entryFingerprint(card)) return;
    if (messageCount <= Number(effect.activatedAt ?? -1)) return;
    const end = Math.max(Number(effect.stickyEnd || 0), Number(effect.cooldownEnd || 0));
    if (end > messageCount) effects[id] = structuredClone(effect);
  });
  return effects;
}

function applyNewEffects({ effects, items, messageCount }) {
  const addedIds = [];
  items.forEach(({ card, id }) => {
    const current = effects[id];
    if (isStickyActive(current, messageCount) || isCooldownActive(current, messageCount)) return;
    const sticky = entryNumber(card, ['sticky'], 0);
    const cooldown = entryNumber(card, ['cooldown'], 0);
    if (!sticky && !cooldown) return;
    const stickyEnd = sticky ? messageCount + sticky : 0;
    const cooldownStart = sticky ? stickyEnd : messageCount;
    effects[id] = {
      fingerprint: entryFingerprint(card),
      activatedAt: messageCount,
      stickyEnd,
      cooldownStart: cooldown ? cooldownStart : 0,
      cooldownEnd: cooldown ? cooldownStart + cooldown : 0
    };
    addedIds.push(id);
  });
  return addedIds;
}

function pruneExpiredEffects(effects, messageCount) {
  Object.entries(effects).forEach(([id, effect]) => {
    const end = Math.max(Number(effect.stickyEnd || 0), Number(effect.cooldownEnd || 0));
    if (end <= messageCount) delete effects[id];
  });
}

function isStickyActive(effect, messageCount) {
  return Boolean(effect)
    && messageCount > Number(effect.activatedAt ?? -1)
    && messageCount < Number(effect.stickyEnd || 0);
}

function isCooldownActive(effect, messageCount) {
  return Boolean(effect)
    && messageCount > Number(effect.activatedAt ?? -1)
    && messageCount >= Number(effect.cooldownStart || 0)
    && messageCount < Number(effect.cooldownEnd || 0);
}

function resolveInclusionGroups({ candidates, activatedGroups, seedHash, triggerDepth, suppressed }) {
  let selected = [...candidates];
  const groupNames = [...new Set(selected.flatMap((item) => entryGroups(item.card)))].sort();

  for (const group of groupNames) {
    let members = selected.filter((item) => entryGroups(item.card).includes(group));
    if (!members.length) continue;
    if (activatedGroups.has(group)) {
      members.forEach((item) => suppressed.groupIds.add(item.id));
      selected = selected.filter((item) => !members.includes(item));
      continue;
    }

    const stickyMembers = members.filter((item) => item.sticky);
    if (stickyMembers.length) {
      const losers = members.filter((item) => !item.sticky);
      losers.forEach((item) => suppressed.groupIds.add(item.id));
      selected = selected.filter((item) => !losers.includes(item));
      continue;
    }

    if (members.some((item) => entryBoolean(item.card, ['useGroupScoring', 'use_group_scoring'], false))) {
      const maxScore = Math.max(...members.map(keyMatchScore));
      const losers = members.filter((item) => (
        entryBoolean(item.card, ['useGroupScoring', 'use_group_scoring'], false)
        && keyMatchScore(item) < maxScore
      ));
      losers.forEach((item) => suppressed.groupIds.add(item.id));
      selected = selected.filter((item) => !losers.includes(item));
      members = selected.filter((item) => entryGroups(item.card).includes(group));
    }
    if (members.length <= 1) continue;

    const prioritized = members
      .filter((item) => entryBoolean(item.card, ['groupOverride', 'group_override'], false))
      .sort((left, right) => entryOrder(right.card) - entryOrder(left.card) || compareActivatedItems(left, right));
    const winner = prioritized[0] || weightedWinner(
      members,
      `${seedHash}:${triggerDepth}:${group}`
    );
    const losers = members.filter((item) => item !== winner);
    losers.forEach((item) => suppressed.groupIds.add(item.id));
    selected = selected.filter((item) => !losers.includes(item));
  }
  return selected;
}

function weightedWinner(items, seed) {
  const weights = items.map((item) => Math.max(0, entryNumber(item.card, ['groupWeight', 'group_weight'], 100)));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return items[stableHash(seed) % items.length];
  const roll = deterministicUnit(seed) * total;
  let cursor = 0;
  for (let index = 0; index < items.length; index += 1) {
    cursor += weights[index];
    if (roll <= cursor) return items[index];
  }
  return items.at(-1);
}

function passesProbability(card, seedHash, messageCount, triggerDepth) {
  const probability = Math.min(100, Math.max(0, entryNumber(card, ['probability'], 100)));
  const usesProbability = entryBoolean(card, ['useProbability', 'use_probability'], true);
  if (!usesProbability || probability >= 100) return true;
  if (probability <= 0) return false;
  const roll = deterministicUnit(`${seedHash}:${messageCount}:${triggerDepth}:${entryKey(card)}:probability`) * 100;
  return roll <= probability;
}

function entryScanDepth(card, fallback) {
  return normalizeLimit(entryExplicitScanDepth(card), fallback);
}

function entryMinimumScanDepth(card, fallback) {
  const explicit = entryExplicitScanDepth(card, { ignoreInherited: true });
  return normalizeLimit(explicit, fallback);
}

function entryExplicitScanDepth(card, { ignoreInherited = false } = {}) {
  const directValue = firstDefined(
    card.scanDepth,
    card.scan_depth,
    card.activationScanDepth,
    card.extensions?.scanDepth
  );
  if (directValue !== undefined) return directValue;
  if (ignoreInherited && card.extensions?.scan_depth_inherited === true) return undefined;
  return firstDefined(card.extensions?.scan_depth);
}

function entryRecursionDelayLevel(card) {
  const value = firstDefined(
    card.delayUntilRecursion,
    card.delay_until_recursion,
    card.extensions?.delayUntilRecursion,
    card.extensions?.delay_until_recursion
  );
  if (value === true) return 1;
  if (value === false || value === undefined) return 0;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function entryGroups(card) {
  const value = firstDefined(card.group, card.extensions?.group, '');
  const source = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(source.map((item) => String(item || '').trim()).filter(Boolean))];
}

function entryNumber(card, names, fallback) {
  const values = [];
  names.forEach((name) => {
    values.push(card?.[name], card?.extensions?.[name]);
  });
  const value = firstDefined(...values);
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function entryBoolean(card, names, fallback) {
  const values = [];
  names.forEach((name) => {
    values.push(card?.[name], card?.extensions?.[name]);
  });
  const value = firstDefined(...values);
  if (value === undefined) return fallback;
  if (typeof value === 'string') return value.trim().toLowerCase() === 'true';
  return Boolean(value);
}

function entryOrder(card) {
  const number = Number(card?.priority ?? card?.order ?? card?.insertionOrder ?? card?.insertion_order ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function entryKey(card) {
  const id = String(card?.id || '').trim();
  if (id) return id;
  return `entry-${stableHash(`${card?.title || ''}\n${card?.content || ''}`).toString(16)}`;
}

function entryFingerprint(card) {
  return stableHash(JSON.stringify({
    id: entryKey(card),
    content: String(card?.content || ''),
    keywords: card?.keywords,
    secondaryKeywords: card?.secondaryKeywords,
    regex: card?.regex,
    constant: card?.constant,
    priority: card?.priority,
    extensions: card?.extensions
  })).toString(16);
}

function compareActivatedItems(left, right) {
  return left.triggerDepth - right.triggerDepth
    || Number(right.sticky) - Number(left.sticky)
    || right.score - left.score
    || Number(left.card.insertionOrder ?? left.card.insertion_order ?? 0)
      - Number(right.card.insertionOrder ?? right.card.insertion_order ?? 0)
    || String(left.card.title || '').localeCompare(String(right.card.title || ''));
}

function keyMatchScore(item) {
  if (item?.card?.constant === true) return 0;
  const priority = Number(item?.card?.priority ?? 50);
  const priorityComponent = Number.isFinite(priority) ? priority / 10 : 5;
  return Math.max(0, Math.round((Number(item?.score || 0) - priorityComponent) / 100));
}

function normalizeLimit(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return Math.max(0, Math.floor(Number(fallback) || 0));
  return Math.floor(number);
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function deterministicUnit(value) {
  return stableHash(String(value || '')) / 0x100000000;
}

function stableHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < String(value || '').length; index += 1) {
    hash ^= String(value || '').charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
