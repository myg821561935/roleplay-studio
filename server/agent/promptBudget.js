import { estimateTokens } from './token.js';
import {
  isContinuationSignal,
  isMeaningfulUserMessage
} from './interactionContract.js';

const NOOP_PROMPT_MARKERS = [
  '本占位不参与运行',
  '本占位保留原identifier',
  '当前主预设不再直接执行本条'
];

const ARRAY_LIMITS = Object.freeze({
  relationships: 8,
  quests: 4,
  factions: 6,
  timeline: 12,
  recentEvents: 6,
  events: 8,
  history: 6,
  resourceLedger: 8,
  obligations: 8,
  institutionLedger: 6
});

const FLAG_PRIORITY_KEYS = new Set(['genre', 'chapter', 'mode', 'route', 'activeArc']);
const WORLD_STATE_IDENTITY_KEYS = new Set([
  'id', 'name', 'title', 'character', 'target', 'item', 'institution',
  'type', 'debtor', 'creditor', 'current', 'currentLocation', 'identity',
  'role', 'status', 'genre', 'chapter', 'goal', 'objective'
]);

const PROTECTED_MESSAGE_KINDS = new Set([
  'current-user',
  'response-contract',
  'interaction-contract',
  'psychological-progression-contract',
  'cast-index',
  'character-anchor',
  'author-note',
  'history-recent',
  'history-user-anchor',
  'hard-facts-tail',
  'worldbook-anchor'
]);

const EXCLUSIVE_PRESET_VARIABLES = new Set([
  'pov_target',
  'sys_lang',
  'word_count',
  'tone',
  'model',
  'base_writing',
  'base_style',
  'sub_style'
]);

export function compilePromptModulesForRuntime(promptModules = [], {
  worldBook = [],
  maxTokens,
  maxModules
} = {}) {
  const active = (Array.isArray(promptModules) ? promptModules : [])
    .filter((module) => module?.enabled !== false && String(module?.content || '').trim());
  const worldBookTitles = new Set((Array.isArray(worldBook) ? worldBook : [])
    .map((entry) => String(entry?.title || '').trim())
    .filter(Boolean));
  const noopModules = active.filter(isNoopPromptModule);
  const runnable = active.filter((module) => !isNoopPromptModule(module));
  const dependencies = collectWorldBookDependencies(runnable, worldBookTitles);
  const budget = normalizeOptionalBudget(maxTokens);
  const moduleLimit = normalizeOptionalLimit(maxModules);
  const conflicts = detectExclusivePromptModuleConflicts(runnable);

  if (!budget) {
    const selected = moduleLimit && runnable.length > moduleLimit
      ? runnable
        .map((module, index) => ({ module, index, score: promptModuleRuntimePriority(module, index, runnable.length) }))
        .sort((left, right) => right.score - left.score || left.index - right.index)
        .slice(0, moduleLimit)
        .sort((left, right) => left.index - right.index)
        .map((item) => item.module)
      : runnable;
    return {
      modules: selected,
      report: buildPromptModuleReport({
        active,
        runnable,
        noopModules,
        selected,
        dependencies,
        maxTokens: null,
        moduleLimit,
        conflicts
      })
    };
  }

  const candidates = runnable.map((module, index) => ({
    module,
    index,
    score: promptModuleRuntimePriority(module, index, runnable.length),
    tokens: estimateModuleTokens(module)
  }));
  const selected = [];
  const truncatedIds = [];
  const truncationCandidates = [];
  let usedTokens = 0;

  for (const candidate of [...candidates].sort((left, right) => (
    right.score - left.score || left.index - right.index
  ))) {
    if (moduleLimit && selected.length >= moduleLimit) break;
    const remaining = budget - usedTokens;
    if (remaining <= 0) break;
    if (candidate.tokens <= remaining) {
      selected.push(candidate);
      usedTokens += candidate.tokens;
      continue;
    }
    // Do not let one oversized high-score module greedily consume the remainder:
    // smaller perspective/dialogue/style modules may fit intact and carry more
    // usable semantics together. Consider one truncation only after the full pass.
    truncationCandidates.push(candidate);
  }

  const remaining = budget - usedTokens;
  const truncationCandidate = truncationCandidates.find((candidate) => (
    (!selected.length || candidate.score >= 90)
    && (!moduleLimit || selected.length < moduleLimit)
  ));
  if (truncationCandidate && remaining > 24) {
    const titleTokens = estimateTokens(String(truncationCandidate.module.title || ''));
    let contentBudget = Math.max(1, remaining - titleTokens - 1);
    let content = limitTextToTokenBudget(truncationCandidate.module.content, contentBudget);
    let selectedModule = { ...truncationCandidate.module, content };
    let selectedTokens = estimateModuleTokens(selectedModule);
    for (let attempt = 0; content && selectedTokens > remaining && attempt < 3; attempt += 1) {
      contentBudget = Math.max(1, contentBudget - (selectedTokens - remaining) - 1);
      content = limitTextToTokenBudget(truncationCandidate.module.content, contentBudget);
      selectedModule = { ...truncationCandidate.module, content };
      selectedTokens = estimateModuleTokens(selectedModule);
    }
    if (content && selectedTokens <= remaining) {
      selected.push({
        ...truncationCandidate,
        module: selectedModule
      });
      usedTokens += selectedTokens;
      truncatedIds.push(truncationCandidate.module.id);
    }
  }

  selected.sort((left, right) => left.index - right.index);
  const selectedModules = selected.map((item) => item.module);
  return {
    modules: selectedModules,
    report: buildPromptModuleReport({
      active,
      runnable,
      noopModules,
      selected: selectedModules,
      dependencies,
      maxTokens: budget,
      usedTokens,
      truncatedIds,
      moduleLimit,
      conflicts
    })
  };
}

export function compactWorldStateForPrompt(worldState, { maxTokens } = {}) {
  if (!worldState || typeof worldState !== 'object' || Array.isArray(worldState)) {
    return { worldState, report: { compacted: false, beforeTokens: 0, afterTokens: 0, omittedKeys: [] } };
  }

  const beforeTokens = estimateTokens(JSON.stringify(worldState));
  const compacted = compactWorldStateValue(worldState, 'worldState');

  const budget = normalizeOptionalBudget(maxTokens);
  const omittedKeys = [];
  if (budget) {
    shrinkArraysToBudget(compacted, budget);
    for (const key of ['institutionLedger', 'obligations', 'factions']) {
      if (estimateTokens(JSON.stringify(compacted)) <= budget) break;
      if (Object.hasOwn(compacted, key)) {
        delete compacted[key];
        omittedKeys.push(key);
      }
    }
    pruneObjectLeavesToBudget(compacted, budget);
  }

  return {
    worldState: compacted,
    report: {
      compacted: true,
      beforeTokens,
      afterTokens: estimateTokens(JSON.stringify(compacted)),
      omittedKeys
    }
  };
}

export function selectRecentMessagesForPrompt(messages = [], {
  maxMessages,
  maxTokens,
  minCompleteTurns = 0
} = {}) {
  const rawSource = (Array.isArray(messages) ? messages : []).filter((message) => !message?.excluded);
  const latestMeaningfulUserSourceIndex = findLatestMeaningfulUserIndex(rawSource);
  const source = rawSource.map((message, index) => {
    const continuation = String(message?.role || '').toLowerCase() === 'user'
      && (message?.kind === 'continuation' || isContinuationSignal(message?.content));
    return {
      ...message,
      _historySourceIndex: index,
      ...(continuation ? {
        content: '[玩家请求：不代替玩家作出重大决定，只继续一个世界反馈节拍]',
        _promptContinuation: true
      } : {})
    };
  });
  const units = buildPromptHistoryUnits(source);
  const countLimit = Number.isFinite(Number(maxMessages)) && Number(maxMessages) >= 0
    ? Math.floor(Number(maxMessages))
    : source.length;
  const recentUnits = [];
  let recentMessageCount = 0;
  for (let index = units.length - 1; index >= 0; index -= 1) {
    const unit = units[index];
    if (countLimit === 0) break;
    if (recentUnits.length && recentMessageCount + unit.messages.length > countLimit) break;
    recentUnits.unshift(unit);
    recentMessageCount += unit.messages.length;
  }
  const anchorUnit = units.find((unit) => unit.messages.some((message) => (
    message._historySourceIndex === latestMeaningfulUserSourceIndex
  )));
  if (anchorUnit && !recentUnits.includes(anchorUnit)) recentUnits.unshift(anchorUnit);
  const requiredUnits = new Set(recentUnits
    .filter((unit) => unit.complete)
    .slice(-Math.max(0, Math.floor(Number(minCompleteTurns) || 0)))
    .map((unit) => unit.id));
  if (anchorUnit) requiredUnits.add(anchorUnit.id);
  const protectUnit = (unit) => unit.messages.map((message) => ({
    ...message,
    _promptTurnId: unit.id,
    ...(requiredUnits.has(unit.id) ? { _promptProtected: true } : {}),
    ...(message._historySourceIndex === latestMeaningfulUserSourceIndex
      ? { _promptAnchor: 'latest-user' }
      : {})
  }));
  const budget = normalizeOptionalBudget(maxTokens);
  if (!budget) {
    const selected = recentUnits.flatMap(protectUnit);
    return {
      messages: selected,
      report: {
        maxTokens: null,
        usedTokens: estimateMessageTokens(selected),
        omittedCount: Math.max(0, source.length - selected.length),
        protectedCount: selected.filter((message) => message._promptProtected).length,
        protectedTurns: [...requiredUnits].filter((id) => units.find((unit) => unit.id === id)?.complete).length,
        latestUserAnchorIncluded: latestMeaningfulUserSourceIndex >= 0,
        atomicTurnCount: recentUnits.filter((unit) => unit.complete).length,
        overflowTokens: 0
      }
    };
  }
  const selectedUnits = [];
  let usedTokens = 0;
  for (let index = recentUnits.length - 1; index >= 0; index -= 1) {
    const unit = recentUnits[index];
    const protectedMessages = protectUnit(unit);
    const tokens = estimateMessageTokens(protectedMessages);
    const required = requiredUnits.has(unit.id);
    if (usedTokens + tokens <= budget || required) {
      selectedUnits.unshift(protectedMessages);
      usedTokens += tokens;
      continue;
    }
    // Optional history is admitted or omitted as a complete user→assistant unit.
    // Never keep an action without its result, or a result without its action.
  }
  const selected = selectedUnits.flat();
  return {
    messages: selected,
    report: {
      maxTokens: budget,
      usedTokens,
      omittedCount: Math.max(0, source.length - selected.length),
      protectedCount: selected.filter((message) => message._promptProtected).length,
      protectedTurns: [...requiredUnits].filter((id) => units.find((unit) => unit.id === id)?.complete).length,
      latestUserAnchorIncluded: selected.some((message) => message._promptAnchor === 'latest-user'),
      atomicTurnCount: selectedUnits.filter((unit) => unit.length === 2).length,
      overflowTokens: Math.max(0, usedTokens - budget)
    }
  };
}

export function enforcePromptMessageBudget(messages = [], { maxTokens } = {}) {
  const budget = normalizeOptionalBudget(maxTokens);
  const source = Array.isArray(messages) ? messages.map((message, index) => ({ ...message, _index: index })) : [];
  const sourcePromptModuleIds = collectPromptModuleIds(source);
  if (!budget) return {
    messages: stripPromptMetadata(source),
    messageInspection: inspectPromptMessages(source),
    report: {
      maxTokens: null,
      beforeTokens: estimateMessageTokens(source),
      afterTokens: estimateMessageTokens(source),
      omittedKinds: {},
      retainedPromptModuleIds: sourcePromptModuleIds,
      omittedPromptModuleIds: []
    }
  };

  const beforeTokens = estimateMessageTokens(source);
  if (beforeTokens <= budget) {
    return {
      messages: stripPromptMetadata(source),
      messageInspection: inspectPromptMessages(source),
      report: {
        maxTokens: budget,
        beforeTokens,
        afterTokens: beforeTokens,
        omittedKinds: {},
        retainedPromptModuleIds: sourcePromptModuleIds,
        omittedPromptModuleIds: []
      }
    };
  }

  const omittedKinds = {};
  const removalPriority = {
    'preset-system': 10,
    'preset-relative': 12,
    'preset-in-chat': 14,
    history: 20,
    'preset-critical': 30,
    worldbook: 40
  };
  // Preserve one highest-value community instruction through the first removal
  // pass. The native core can still be compacted afterwards, which avoids the
  // pathological result where every preset module disappears even though the
  // final prompt has enough residual room for one focused narrative rule.
  const reservedCritical = source
    .filter((message) => message._promptKind === 'preset-critical')
    .sort((left, right) => (
      Number(right._promptPriority || 0) - Number(left._promptPriority || 0)
      || left._index - right._index
    ))[0];
  const removable = source
    .filter((message) => (
      message._index !== reservedCritical?._index
      && !PROTECTED_MESSAGE_KINDS.has(message._promptKind)
      && Object.hasOwn(removalPriority, message._promptKind)
    ))
    .sort((left, right) => (
      removalPriority[left._promptKind] - removalPriority[right._promptKind]
      || Number(left._promptPriority || 0) - Number(right._promptPriority || 0)
      || left._index - right._index
    ));
  const removed = new Set();
  const processedHistoryTurns = new Set();
  let currentTokens = beforeTokens;
  for (const message of removable) {
    if (currentTokens <= budget) break;
    const historyTurnId = message._promptKind === 'history' ? String(message._promptTurnId || '') : '';
    if (historyTurnId && processedHistoryTurns.has(historyTurnId)) continue;
    const removalGroup = historyTurnId
      ? source.filter((candidate) => candidate._promptTurnId === historyTurnId)
      : [message];
    if (removalGroup.some((candidate) => PROTECTED_MESSAGE_KINDS.has(candidate._promptKind))) continue;
    if (historyTurnId) processedHistoryTurns.add(historyTurnId);
    const messageTokens = estimateMessageTokens(removalGroup);
    const overflow = currentTokens - budget;
    if (message._promptKind === 'worldbook' && messageTokens - overflow >= 160) {
      const targetContentTokens = Math.max(80, messageTokens - overflow - 4);
      message.content = limitTextToTokenBudget(message.content, targetContentTokens);
      currentTokens = estimateMessageTokens(source.filter((candidate) => !removed.has(candidate._index)));
      omittedKinds['worldbook-truncated'] = (omittedKinds['worldbook-truncated'] || 0) + 1;
      continue;
    }
    if (message._promptKind === 'preset-critical' && messageTokens - overflow >= 120) {
      const targetContentTokens = Math.max(80, messageTokens - overflow - 4);
      message.content = limitTextToTokenBudget(message.content, targetContentTokens);
      currentTokens = estimateMessageTokens(source.filter((candidate) => !removed.has(candidate._index)));
      omittedKinds['preset-critical-truncated'] = (omittedKinds['preset-critical-truncated'] || 0) + 1;
      continue;
    }
    removalGroup.forEach((candidate) => removed.add(candidate._index));
    currentTokens -= messageTokens;
    omittedKinds[message._promptKind] = (omittedKinds[message._promptKind] || 0) + removalGroup.length;
  }

  const kept = source.filter((message) => !removed.has(message._index));
  currentTokens = estimateMessageTokens(kept);
  if (currentTokens > budget) {
    const core = kept.find((message) => message._promptKind === 'core-system');
    if (core) {
      const otherTokens = currentTokens - estimateTokens(`${core.role || 'system'}: ${core.content || ''}`);
      core.content = limitTextToTokenBudget(core.content, Math.max(1, budget - otherTokens - 4));
      currentTokens = estimateMessageTokens(kept);
    }
  }

  if (currentTokens > budget && reservedCritical && kept.includes(reservedCritical)) {
    const messageTokens = estimateTokens(`${reservedCritical.role || 'system'}: ${reservedCritical.content || ''}`);
    if (messageTokens > 100) {
      const overflow = currentTokens - budget;
      reservedCritical.content = limitTextToTokenBudget(
        reservedCritical.content,
        Math.max(80, messageTokens - overflow - 4)
      );
      omittedKinds['preset-critical-truncated'] = (omittedKinds['preset-critical-truncated'] || 0) + 1;
      currentTokens = estimateMessageTokens(kept);
    }
  }

  if (currentTokens > budget) {
    currentTokens = truncateProtectedMessagesToBudget(kept, {
      kinds: ['history-recent', 'history-user-anchor', 'worldbook-anchor', 'cast-index', 'psychological-progression-contract'],
      budget,
      omittedKinds
    });
  }

  const retainedPromptModuleIds = collectPromptModuleIds(kept);
  const retainedPromptModuleIdSet = new Set(retainedPromptModuleIds);

  return {
    messages: stripPromptMetadata(kept),
    messageInspection: inspectPromptMessages(kept),
    report: {
      maxTokens: budget,
      beforeTokens,
      afterTokens: currentTokens,
      omittedKinds,
      retainedPromptModuleIds,
      omittedPromptModuleIds: sourcePromptModuleIds.filter((id) => !retainedPromptModuleIdSet.has(id))
    }
  };
}

function inspectPromptMessages(messages = []) {
  return (Array.isArray(messages) ? messages : []).map((message, index) => ({
    order: index + 1,
    role: String(message?.role || 'system'),
    kind: String(message?._promptKind || 'message'),
    moduleId: String(message?._promptModuleId || ''),
    bundleKey: String(message?._promptBundleKey || ''),
    depth: Number.isFinite(Number(message?._promptDepth)) ? Number(message._promptDepth) : null,
    trigger: String(message?._promptTrigger || ''),
    turnId: String(message?._promptTurnId || ''),
    tokenEstimate: estimateTokens(`${message?.role || 'system'}: ${message?.content || ''}`),
    content: String(message?.content || '')
  }));
}

export function limitTextToTokenBudget(value, maxTokens) {
  const text = String(value || '').trim();
  const budget = normalizeOptionalBudget(maxTokens);
  if (!text || !budget || estimateTokens(text) <= budget) return text;
  const suffix = '\n[内容已按本轮上下文预算截断]';
  const suffixTokens = estimateTokens(suffix);
  const contentBudget = Math.max(1, budget - suffixTokens);
  let used = 0;
  let end = 0;
  for (const char of text) {
    const cost = estimateTokens(char);
    if (used + cost > contentBudget) break;
    used += cost;
    end += char.length;
  }
  const prefix = text.slice(0, end);
  const boundary = Math.max(prefix.lastIndexOf('\n\n'), prefix.lastIndexOf('。'), prefix.lastIndexOf('！'), prefix.lastIndexOf('？'));
  const safePrefix = boundary >= Math.floor(prefix.length * 0.6) ? prefix.slice(0, boundary + 1) : prefix;
  return `${safePrefix.trimEnd()}${suffix}`;
}

function isNoopPromptModule(module) {
  const content = String(module?.content || '');
  if (NOOP_PROMPT_MARKERS.some((marker) => content.includes(marker))) return true;
  const meaningful = content
    .replace(/\{\{\s*\/\/[\s\S]*?\}\}/g, '')
    .replace(/\{\{\s*trim\s*\}\}/gi, '')
    .trim();
  if (!meaningful) return true;
  return content.length < 900 && /占位/.test(content) && /(已迁移|已整合|源条目|只读归档)/.test(content);
}

function collectWorldBookDependencies(modules, availableTitles) {
  const references = [];
  for (const module of modules) {
    for (const match of String(module?.content || '').matchAll(/《([^》]{1,120}世界书)》/g)) {
      references.push({ moduleId: module.id, title: match[1] });
    }
  }
  const uniqueReferences = [...new Map(references.map((item) => [`${item.moduleId}:${item.title}`, item])).values()];
  return {
    references: uniqueReferences,
    missing: uniqueReferences.filter((item) => !availableTitles.has(item.title))
  };
}

export function promptModuleRuntimePriority(module, index = 0, total = 1) {
  const label = `${module?.id || ''} ${module?.title || ''}`.toLowerCase();
  const content = String(module?.content || '');
  let score = 0;
  if (/final|终检|最终/.test(label)) score += 105;
  if (/core|main|主核|总控/.test(label)) score += 95;
  if (/router|dispatch|permission|路由|调度|权限/.test(label)) score += 80;
  if (/character|worldbook|format|input|角色|世界书|格式|输入/.test(label)) score += 65;
  if (/variable|memory|变量|记忆/.test(label)) score += 45;
  if (/叙事推进|剧情推进|推进基准|continuity|pacing/.test(label)) score += 260;
  if (/活人感|人物塑造|角色塑造|characterization/.test(label)) score += 220;
  if (/反全知|视角约束|perspective/.test(label)) score += 180;
  if (/增加对白|对白|dialogue/.test(label)) score += 160;
  if (/抢话|别抢话|对话增多|互动要求|控制权|player[-_ ]?agency|auto[-_ ]?player/.test(label)) score += 320;
  if (/文风|style|字数|篇幅/.test(label)) score += 80;
  if (/思维链|\bcot\b|thinking|reasoning|草稿/.test(label)) score -= 260;
  if (/schema\s*初始化|变量初始化/.test(label)) score += 70;
  if (/(?:最终回复|完整回复|根节点|response\s+format|output\s+protocol)/i.test(content)
    && /<[^>]{1,80}>/.test(content)) score += 110;
  if ((content.match(/\{\{\s*getvar::/gi) || []).length >= 4) score += 85;
  if ((content.match(/\{\{\s*(?:setvar|addvar)::/gi) || []).length >= 4) score += 70;
  if (normalizePromptRole(module?.role) !== 'system') score += 35;
  if (/\{\{\s*(setvar|addvar|incvar|decvar)/i.test(content)) score += 20;
  if (index >= Math.max(0, total - 3)) score += 15;
  return score;
}

function buildPromptModuleReport({
  active,
  runnable,
  noopModules,
  selected,
  dependencies,
  maxTokens,
  usedTokens,
  truncatedIds = [],
  moduleLimit = null,
  conflicts = []
}) {
  const selectedIds = new Set(selected.map((module) => module.id));
  return {
    maxTokens,
    usedTokens: usedTokens ?? selected.reduce((sum, module) => sum + estimateModuleTokens(module), 0),
    activeCount: active.length,
    runnableCount: runnable.length,
    selectedCount: selected.length,
    moduleLimit,
    excessiveActiveModules: Boolean(moduleLimit && runnable.length > moduleLimit),
    noopIds: noopModules.map((module) => module.id).filter(Boolean),
    omittedIds: runnable.filter((module) => !selectedIds.has(module.id)).map((module) => module.id).filter(Boolean),
    truncatedIds: truncatedIds.filter(Boolean),
    missingWorldBooks: [...new Set(dependencies.missing.map((item) => item.title))],
    missingDependencyModuleIds: [...new Set(dependencies.missing.map((item) => item.moduleId).filter(Boolean))],
    conflicts
  };
}

function detectExclusivePromptModuleConflicts(modules) {
  const writers = new Map();
  modules.forEach((module) => {
    for (const match of String(module?.content || '').matchAll(/\{\{\s*setvar::([^:{}\s]+)::([^{}]*)\}\}/gi)) {
      const variable = String(match[1] || '').trim().toLowerCase();
      const value = String(match[2] || '').trim();
      if (!EXCLUSIVE_PRESET_VARIABLES.has(variable) || !value) continue;
      if (!writers.has(variable)) writers.set(variable, []);
      writers.get(variable).push({ moduleId: module.id, title: module.title, value: value.slice(0, 160) });
    }
  });
  return [...writers.entries()]
    .map(([variable, entries]) => ({
      variable,
      entries,
      distinctValues: [...new Set(entries.map((entry) => entry.value))]
    }))
    .filter((item) => item.distinctValues.length > 1)
    .map((item) => ({
      type: 'exclusive-variable-conflict',
      variable: item.variable,
      moduleIds: item.entries.map((entry) => entry.moduleId).filter(Boolean),
      titles: item.entries.map((entry) => entry.title).filter(Boolean),
      values: item.distinctValues
    }));
}

function buildPromptHistoryUnits(messages) {
  const units = [];
  let pendingUser = null;
  const pushStandaloneUser = () => {
    if (!pendingUser) return;
    units.push({ id: `turn-${pendingUser._historySourceIndex}`, messages: [pendingUser], complete: false });
    pendingUser = null;
  };
  for (const message of messages) {
    const role = String(message?.role || '').toLowerCase();
    if (role === 'user') {
      pushStandaloneUser();
      pendingUser = message;
      continue;
    }
    if (role === 'assistant' && pendingUser) {
      units.push({
        id: `turn-${pendingUser._historySourceIndex}-${message._historySourceIndex}`,
        messages: [pendingUser, message],
        complete: true
      });
      pendingUser = null;
      continue;
    }
    units.push({ id: `turn-${message._historySourceIndex}`, messages: [message], complete: false });
  }
  pushStandaloneUser();
  return units;
}

function findLatestMeaningfulUserIndex(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (isMeaningfulUserMessage(messages[index])) return index;
  }
  return -1;
}

function truncateProtectedMessagesToBudget(messages, { kinds, budget, omittedKinds }) {
  let currentTokens = estimateMessageTokens(messages);
  const candidates = messages.filter((message) => kinds.includes(message._promptKind));
  for (const message of candidates) {
    if (currentTokens <= budget) break;
    const messageTokens = estimateTokens(`${message.role || 'user'}: ${message.content || ''}`);
    if (messageTokens <= 100) continue;
    const overflow = currentTokens - budget;
    const targetTokens = Math.max(80, messageTokens - overflow - 4);
    const nextContent = limitTextToTokenBudget(message.content, targetTokens);
    if (!nextContent || nextContent === message.content) continue;
    message.content = nextContent;
    omittedKinds[`${message._promptKind}-truncated`] = (omittedKinds[`${message._promptKind}-truncated`] || 0) + 1;
    currentTokens = estimateMessageTokens(messages);
  }
  return currentTokens;
}

function dedupeWorldStateArray(key, values) {
  const seen = new Set();
  const selected = [];
  for (let index = values.length - 1; index >= 0; index--) {
    const item = values[index];
    const identity = worldStateIdentity(key, item);
    if (seen.has(identity)) continue;
    seen.add(identity);
    selected.push(structuredClone(item));
  }
  return selected.reverse();
}

function compactWorldStateValue(value, key) {
  if (Array.isArray(value)) {
    const deduped = dedupeWorldStateArray(key, value);
    const limit = ARRAY_LIMITS[key] || 20;
    return deduped.slice(-limit).map((item) => compactWorldStateValue(item, key));
  }
  if (!value || typeof value !== 'object') return structuredClone(value);
  let entries = Object.entries(value);
  if (key === 'flags' && entries.length > 16) {
    const selectedKeys = new Set([
      ...entries.filter(([entryKey]) => FLAG_PRIORITY_KEYS.has(entryKey)).map(([entryKey]) => entryKey),
      ...entries.filter(([entryKey]) => !FLAG_PRIORITY_KEYS.has(entryKey)).slice(-12).map(([entryKey]) => entryKey)
    ]);
    entries = entries.filter(([entryKey]) => selectedKeys.has(entryKey));
  }
  return Object.fromEntries(entries.map(([entryKey, entryValue]) => [
    entryKey,
    compactWorldStateValue(entryValue, entryKey)
  ]));
}

function worldStateIdentity(key, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return `${key}:${String(value)}`;
  if (key === 'relationships') return `${key}:${value.name || value.character || value.target || JSON.stringify(value)}`;
  if (key === 'quests') return `${key}:${value.id || value.title || JSON.stringify(value)}`;
  if (key === 'factions') return `${key}:${value.id || value.name || JSON.stringify(value)}`;
  if (key === 'resourceLedger') return `${key}:${value.id || value.item || JSON.stringify(value)}`;
  if (key === 'obligations') return `${key}:${value.id || `${value.type || ''}|${value.debtor || ''}|${value.creditor || ''}`}`;
  if (key === 'institutionLedger') return `${key}:${value.id || value.institution || JSON.stringify(value)}`;
  return `${key}:${JSON.stringify(value)}`;
}

function shrinkArraysToBudget(worldState, budget) {
  const arrays = () => collectArrayReferences(worldState)
    .filter((candidate) => candidate.value.length > candidate.minItems)
    .sort((left, right) => (
      estimateTokens(JSON.stringify(right.value)) - estimateTokens(JSON.stringify(left.value))
      || right.value.length - left.value.length
    ));
  while (estimateTokens(JSON.stringify(worldState)) > budget) {
    const candidate = arrays()[0];
    if (!candidate) break;
    candidate.value.shift();
  }
}

function collectArrayReferences(value, path = [], output = []) {
  if (Array.isArray(value)) {
    const field = path.at(-1) || '';
    const rootCollection = path.length === 1 && ['relationships', 'quests', 'resourceLedger'].includes(field);
    output.push({ value, path, minItems: rootCollection ? 1 : 0 });
    value.forEach((item, index) => collectArrayReferences(item, [...path, String(index)], output));
    return output;
  }
  if (!value || typeof value !== 'object') return output;
  Object.entries(value).forEach(([key, item]) => collectArrayReferences(item, [...path, key], output));
  return output;
}

function pruneObjectLeavesToBudget(worldState, budget) {
  while (estimateTokens(JSON.stringify(worldState)) > budget) {
    const candidates = collectRemovableLeaves(worldState)
      .sort((left, right) => right.tokens - left.tokens || right.path.length - left.path.length);
    const candidate = candidates[0];
    if (!candidate) break;
    delete candidate.parent[candidate.key];
  }
}

function collectRemovableLeaves(value, path = [], output = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return output;
  for (const [key, item] of Object.entries(value)) {
    const nextPath = [...path, key];
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      collectRemovableLeaves(item, nextPath, output);
      continue;
    }
    if (Array.isArray(item) || WORLD_STATE_IDENTITY_KEYS.has(key)) continue;
    output.push({
      parent: value,
      key,
      path: nextPath,
      tokens: estimateTokens(JSON.stringify(item))
    });
  }
  return output;
}

function estimateModuleTokens(module) {
  return estimateTokens(`${module?.title || ''}\n${runtimeVisiblePromptContent(module?.content)}`);
}

function runtimeVisiblePromptContent(value) {
  return String(value || '')
    .replace(/\{\{\s*\/\/[\s\S]*?\}\}/g, '')
    .replace(/\{\{\s*trim\s*\}\}/gi, '')
    .replace(/\{\{\s*(?:setvar|addvar|incvar|decvar)::[^{}]*\}\}/gi, '')
    .trim();
}

function estimateMessageTokens(messages) {
  return estimateTokens((messages || []).map((message) => `${message?.role || 'user'}: ${message?.content || ''}`).join('\n'));
}

function stripPromptMetadata(messages) {
  return messages.map((message) => Object.fromEntries(
    Object.entries(message).filter(([key]) => !key.startsWith('_prompt'))
  ));
}

function collectPromptModuleIds(messages) {
  return [...new Set((messages || [])
    .map((message) => String(message?._promptModuleId || '').trim())
    .filter(Boolean))];
}

function normalizePromptRole(role) {
  const normalized = String(role || 'system').trim().toLowerCase();
  return ['system', 'user', 'assistant'].includes(normalized) ? normalized : 'system';
}

function normalizeOptionalBudget(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : null;
}

function normalizeOptionalLimit(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : null;
}
