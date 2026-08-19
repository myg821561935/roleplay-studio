import {
  normalizeDeclarativeLifecycle,
  normalizeLifecycleOperation,
  parseAllowlistedSlashCommand
} from './lifecyclePolicy.js';

const MAX_REGEX_RULES = 32;
const MAX_QUICK_REPLIES = 24;
const MAX_PANELS = 8;
const MAX_PANEL_FIELDS = 16;
const MAX_PANEL_ITEMS = 24;
const MAX_PATTERN_LENGTH = 500;
const MAX_REPLACEMENT_LENGTH = 524288; // 512KB：支持大型 HTML 状态栏（如九渊 4.5MB 需授权后分块，常规状态栏 ~200KB 可完整存储）
const MAX_TEMPLATE_LENGTH = 4000;
const MAX_TEMPLATE_TAGS = 80;
const MAX_DISPLAY_TEXT_LENGTH = 120000;
const MAX_STATE_BYTES = 64000;
const MAX_STATE_DEPTH = 8;
const BLOCKED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const COMMUNITY_ADAPTER_ALLOWLIST = new Set(['tavern-helper', 'xiaobai-x', 'static-status-panel']);
const STATUS_PANEL_TITLE_PATTERN = /(?:主角信息|角色状态|人物状态|状态栏|互动角色|人物关系|关系面板|天机榜单|任务|线索|神府造化|修为|资源|背包|梦入神机|长期记忆|短期记忆|世界状态|势力|声望)/iu;

export function extractLightFrontendRuntime(payload = {}) {
  const containers = collectExtensionContainers(payload);
  const baseRuntime = normalizeLightFrontendRuntime(collectRuntimeInput(containers));
  const adapterRuntimes = collectCommunityAdapterSources(payload).map((source) => {
    const runtime = normalizeLightFrontendRuntime(collectRuntimeInput(
      collectExtensionContainers(source.payload),
      { adapter: true }
    ));
    return {
      ...runtime,
      adapters: [describeCommunityAdapter(source, runtime)]
    };
  });
  const staticPanels = extractStaticStatusPanels(payload);
  const staticPanelRuntime = normalizeLightFrontendRuntime({
    panels: staticPanels.panels,
    diagnostics: staticPanels.diagnostics,
    adapters: staticPanels.panels.length ? [{
      id: 'static-status-panel',
      sourceKey: 'static-heavy-frontend',
      mode: 'declarative-partial',
      mappedCapabilities: ['sidebar-panels'],
      unsupportedCapabilities: staticPanels.unsupportedCapabilities
    }] : []
  });
  return mergeLightFrontendRuntimes([baseRuntime, ...adapterRuntimes, staticPanelRuntime]);
}

function collectRuntimeInput(containers, { adapter = false } = {}) {
  const regexCandidates = collectNamedValues(containers, [
    'regex_scripts',
    'regexScripts',
    'regex',
    'display_regex'
  ]).flatMap(asArray);
  const quickReplyCandidates = collectNamedValues(containers, [
    'quick_replies',
    'quickReplies',
    'quick_reply',
    'quickReply',
    ...(adapter ? ['buttons', 'actions', 'quickReplySet', 'quick_reply_set'] : [])
  ]).flatMap(asArray);
  const panelCandidates = collectNamedValues(containers, [
    'panels',
    'status_panels',
    'statusPanels',
    'sidebar_panels',
    'sidebarPanels',
    ...(adapter ? ['widgets', 'cards'] : [])
  ]).flatMap(asArray);
  const mvuCandidates = collectNamedValues(containers, [
    'mvu',
    'mvu_state',
    'mvuState',
    'variables',
    'variable_state',
    ...(adapter ? ['initialVariables', 'initial_variables', 'state'] : [])
  ]);
  const lifecycleCandidates = collectNamedValues(containers, [
    'lifecycle',
    'lifecycle_events',
    'lifecycleEvents',
    'events'
  ]);
  const lifecycle = mergeLifecycleSources(lifecycleCandidates);
  for (const event of ['onImport', 'onUser', 'onAssistant']) {
    const steps = collectNamedValues(containers, [event]).flatMap(asArrayOrSingle);
    if (steps.length) lifecycle[event] = [...(lifecycle[event] || []), ...steps];
  }

  return {
    regexTransforms: regexCandidates,
    quickReplies: quickReplyCandidates,
    panels: panelCandidates,
    mvu: mergeMvuSeeds(mvuCandidates),
    lifecycle
  };
}

export function mergeLightFrontendRuntimes(runtimes = []) {
  const normalized = (Array.isArray(runtimes) ? runtimes : [runtimes])
    .map(normalizeLightFrontendRuntime);
  const regexTransforms = dedupeById(normalized.flatMap((item) => item.regexTransforms));
  const quickReplies = dedupeById(normalized.flatMap((item) => item.quickReplies));
  const panels = dedupeById(normalized.flatMap((item) => item.panels || []));
  const adapters = dedupeAdapters(normalized.flatMap((item) => item.adapters || []));
  const lifecycleEvents = {};
  for (const runtime of normalized) {
    for (const [event, steps] of Object.entries(runtime.lifecycle?.events || {})) {
      lifecycleEvents[event] = [...(lifecycleEvents[event] || []), ...steps];
    }
  }
  const mvuValues = {};
  for (const runtime of normalized) {
    if (runtime.mvu.enabled) safeMerge(mvuValues, runtime.mvu.values);
  }
  return normalizeLightFrontendRuntime({
    regexTransforms,
    quickReplies,
    panels,
    adapters,
    lifecycle: lifecycleEvents,
    diagnostics: normalized.flatMap((item) => item.diagnostics || []),
    mvu: {
      enabled: normalized.some((item) => item.mvu.enabled),
      values: mvuValues,
      revision: 0
    }
  });
}

export function normalizeLightFrontendRuntime(input = {}) {
  const diagnostics = (Array.isArray(input.diagnostics) ? input.diagnostics : [])
    .filter(isPlainObject)
    .map((item) => structuredClone(item))
    .slice(0, 80);
  const regexTransforms = [];
  const regexSource = Array.isArray(input.regexTransforms) ? input.regexTransforms : [];
  for (let index = 0; index < regexSource.length && regexTransforms.length < MAX_REGEX_RULES; index += 1) {
    const normalized = normalizeRegexTransform(regexSource[index], index, diagnostics);
    if (normalized) regexTransforms.push(normalized);
  }

  const quickReplies = [];
  const quickSource = Array.isArray(input.quickReplies) ? input.quickReplies : [];
  for (let index = 0; index < quickSource.length && quickReplies.length < MAX_QUICK_REPLIES; index += 1) {
    const normalized = normalizeQuickReply(quickSource[index], index, diagnostics);
    if (normalized) quickReplies.push(normalized);
  }

  const panels = [];
  const panelSource = Array.isArray(input.panels) ? input.panels : [];
  for (let index = 0; index < panelSource.length && panels.length < MAX_PANELS; index += 1) {
    const normalized = normalizeDeclarativePanel(panelSource[index], index, diagnostics);
    if (normalized) panels.push(normalized);
  }

  const mvu = normalizeMvuState(input.mvu, diagnostics);
  const lifecycle = normalizeDeclarativeLifecycle(input.lifecycle, diagnostics);
  return {
    schemaVersion: 1,
    mode: 'declarative-safe',
    executesThirdPartyCode: false,
    regexTransforms,
    quickReplies,
    panels,
    adapters: normalizeAdapters(input.adapters),
    mvu,
    lifecycle,
    diagnostics
  };
}

export function applyDisplayTransforms(text, rules = [], { role = 'assistant', context = {} } = {}) {
  let output = String(text || '').slice(0, MAX_DISPLAY_TEXT_LENGTH);
  for (const rule of Array.isArray(rules) ? rules.slice(0, MAX_REGEX_RULES) : []) {
    const normalized = normalizeRegexTransform(rule, 0, []);
    if (!normalized || normalized.enabled === false) continue;
    if (!isDisplayRegexRule(normalized)) continue;
    if (normalized.scope !== 'all' && normalized.scope !== role) continue;
    try {
      const replacement = expandDisplayMacros(
        renderSafeTemplate(degradeStaticHtmlReplacement(normalized.replacement), context, { unsupported: 'strip' }),
        context
      );
      output = output.replace(new RegExp(normalized.pattern, normalized.flags), replacement);
    } catch {
      // Invalid rules are ignored at display time and remain visible in diagnostics.
    }
  }
  return output;
}

export function applyPromptTransforms(text, rules = [], {
  role = 'assistant',
  context = {},
  depth = 0
} = {}) {
  let output = String(text || '').slice(0, MAX_DISPLAY_TEXT_LENGTH);
  const messageDepth = Math.max(0, Math.trunc(Number(depth) || 0));
  for (const rule of Array.isArray(rules) ? rules.slice(0, MAX_REGEX_RULES) : []) {
    const normalized = normalizeRegexTransform(rule, 0, []);
    if (!normalized || normalized.enabled === false || normalized.promptOnly !== true) continue;
    if (normalized.scope !== 'all' && normalized.scope !== role) continue;
    if (normalized.minDepth !== undefined && messageDepth < normalized.minDepth) continue;
    if (normalized.maxDepth !== undefined && messageDepth > normalized.maxDepth) continue;
    try {
      const replacement = expandDisplayMacros(
        renderSafeTemplate(normalized.replacement, context, { unsupported: 'strip' }),
        context
      );
      output = output.replace(new RegExp(normalized.pattern, normalized.flags), replacement);
    } catch {
      // Invalid imported rules are ignored and never interrupt prompt assembly.
    }
  }
  return output;
}

export function expandQuickReply(reply, context = {}) {
  const normalized = normalizeQuickReply(reply, 0, []);
  if (!normalized) return '';
  const values = {
    user: context.user,
    char: context.char,
    scene: context.scene,
    location: context.location,
    time: context.time
  };
  const rendered = renderSafeTemplate(normalized.template, context, { unsupported: 'strip' });
  return rendered
    .replace(/\{\{\s*(user|char|character[\s_-]+name|scene|location|time)\s*\}\}/gi, (_, key) => {
      const normalizedKey = /^character[\s_-]+name$/i.test(String(key || '').trim()) ? 'char' : String(key).toLowerCase();
      return String(values[normalizedKey] || '');
    })
    .replace(/\{\{\s*(?:getvar|globalvar)::([^{}]+)\}\}/gi, (_, path) => {
      return stringifyTemplateValue(readStatePath(resolveTemplateState(context), path));
    })
    .trim();
}

export function inspectSafeTemplate(text = '') {
  const source = String(text || '').slice(0, MAX_DISPLAY_TEXT_LENGTH);
  const tags = [...source.matchAll(/<%([=-]?)([\s\S]*?)%>/g)].slice(0, MAX_TEMPLATE_TAGS);
  const unsupported = [];
  let supportedCount = 0;
  for (const match of tags) {
    const classification = classifyTemplateTag(match[1], match[2]);
    if (classification.supported) supportedCount += 1;
    else unsupported.push(String(match[0] || '').slice(0, 160));
  }
  return {
    hasTemplate: tags.length > 0,
    supported: tags.length > 0 && unsupported.length === 0,
    supportedCount,
    unsupportedCount: unsupported.length,
    unsupported
  };
}

export function renderSafeTemplate(text = '', context = {}, { unsupported = 'preserve' } = {}) {
  const source = String(text || '').slice(0, MAX_DISPLAY_TEXT_LENGTH);
  const tagRegex = /<%([=-]?)([\s\S]*?)%>/g;
  const stack = [];
  let active = true;
  let cursor = 0;
  let count = 0;
  let output = '';
  let match;
  while ((match = tagRegex.exec(source)) && count < MAX_TEMPLATE_TAGS) {
    count += 1;
    if (active) output += source.slice(cursor, match.index);
    const tag = classifyTemplateTag(match[1], match[2]);
    if (tag.type === 'value') {
      if (active) output += stringifyTemplateValue(evaluateSafeExpression(tag.expression, context).value);
    } else if (tag.type === 'if') {
      const result = evaluateSafeExpression(tag.expression, context);
      stack.push({ parentActive: active, condition: result.valid && Boolean(result.value), elseSeen: false });
      active = active && result.valid && Boolean(result.value);
    } else if (tag.type === 'else') {
      const frame = stack.at(-1);
      if (frame && !frame.elseSeen) {
        frame.elseSeen = true;
        active = frame.parentActive && !frame.condition;
      } else if (active && unsupported === 'preserve') {
        output += match[0];
      }
    } else if (tag.type === 'close') {
      const frame = stack.pop();
      active = frame ? frame.parentActive : active;
    } else if (active && unsupported === 'preserve') {
      output += match[0];
    }
    cursor = tagRegex.lastIndex;
  }
  if (active) output += source.slice(cursor);
  return output;
}

export function applyMvuPatch(current = {}, patch = {}, { expectedRevision } = {}) {
  const normalized = normalizeMvuState(current, []);
  const revision = normalized.revision;
  if (expectedRevision !== undefined && Number(expectedRevision) !== revision) {
    const error = new Error('MVU_REVISION_CONFLICT');
    error.code = 'MVU_REVISION_CONFLICT';
    error.currentRevision = revision;
    throw error;
  }

  const nextValues = structuredClone(normalized.values);
  const operations = Array.isArray(patch) ? patch : Array.isArray(patch.operations) ? patch.operations : [];
  if (!operations.length || operations.length > 64) throw new Error('INVALID_MVU_PATCH');
  for (const operation of operations) applyMvuOperation(nextValues, operation);
  assertSafeState(nextValues);
  return {
    enabled: true,
    values: nextValues,
    revision: revision + 1
  };
}

function classifyTemplateTag(marker, body) {
  const source = String(body || '').trim();
  if (marker === '=' || marker === '-') {
    const result = evaluateSafeExpression(source, {});
    return { type: result.valid ? 'value' : 'unsupported', expression: source, supported: result.valid };
  }
  const ifMatch = source.match(/^if\s*\(([\s\S]+)\)\s*\{?\s*$/);
  if (ifMatch) {
    const result = evaluateSafeExpression(ifMatch[1], {});
    return { type: result.valid ? 'if' : 'unsupported', expression: ifMatch[1], supported: result.valid };
  }
  if (/^\}?\s*else\s*\{?\s*$/.test(source)) return { type: 'else', supported: true };
  if (/^\}\s*;?\s*$/.test(source)) return { type: 'close', supported: true };
  return { type: 'unsupported', supported: false };
}

function evaluateSafeExpression(expression, context) {
  const source = stripOuterParentheses(String(expression || '').trim());
  if (!source || source.length > 300) return { valid: false, value: undefined };
  if (source.startsWith('!') && !source.startsWith('!=')) {
    const nested = evaluateSafeExpression(source.slice(1), context);
    return nested.valid ? { valid: true, value: !nested.value } : nested;
  }
  const comparison = source.match(/^(.+?)\s*(===|!==|>=|<=|==|!=|>|<)\s*(.+)$/);
  if (comparison) {
    const left = resolveTemplateAtom(comparison[1], context);
    const right = resolveTemplateAtom(comparison[3], context);
    if (!left.valid || !right.valid) return { valid: false, value: undefined };
    if (['>', '<', '>=', '<='].includes(comparison[2])) {
      const leftNumber = Number(left.value);
      const rightNumber = Number(right.value);
      const value = Number.isFinite(leftNumber) && Number.isFinite(rightNumber)
        ? compareNumbers(leftNumber, rightNumber, comparison[2])
        : false;
      return { valid: true, value };
    }
    const equal = left.value === right.value || (
      ['==', '!='].includes(comparison[2]) && String(left.value) === String(right.value)
    );
    return { valid: true, value: comparison[2].includes('!') ? !equal : equal };
  }
  return resolveTemplateAtom(source, context);
}

function compareNumbers(left, right, operator) {
  if (operator === '>') return left > right;
  if (operator === '<') return left < right;
  if (operator === '>=') return left >= right;
  return left <= right;
}

function resolveTemplateAtom(expression, context) {
  const source = String(expression || '').trim();
  const quoted = source.match(/^(['"])([\s\S]*)\1$/);
  if (quoted) return { valid: true, value: quoted[2] };
  if (/^-?\d+(?:\.\d+)?$/.test(source)) return { valid: true, value: Number(source) };
  if (/^(?:true|false)$/i.test(source)) return { valid: true, value: source.toLowerCase() === 'true' };
  if (/^(?:null|undefined)$/i.test(source)) return { valid: true, value: null };

  const getter = source.match(/^(getvar|getglobalvar)\(\s*(['"])([^'"]+)\2\s*\)$/i);
  if (getter) {
    const scope = getter[1].toLowerCase() === 'getglobalvar' ? MVU_SCOPE_GLOBAL : MVU_SCOPE_CHAT;
    return { valid: true, value: readStatePath(resolveTemplateScopeState(context, scope), getter[3]) };
  }

  if (!/^[\p{L}_$][\p{L}\p{N}_$-]*(?:\.[\p{L}\p{N}_$-]+)*$/u.test(source)) {
    return { valid: false, value: undefined };
  }
  const [root, ...path] = source.split('.');
  const state = resolveTemplateState(context);
  const roots = {
    user: context.user,
    char: context.char ?? context.characterCard?.name ?? context.character?.name,
    scene: context.scene,
    location: context.location,
    time: context.time,
    persona: context.persona || {},
    character: context.characterCard || context.character || {},
    mvu: state,
    state,
    vars: state,
    variables: state
  };
  if (!Object.hasOwn(roots, root)) return { valid: false, value: undefined };
  return { valid: true, value: readStatePath(roots[root], path) };
}

function resolveTemplateState(context = {}) {
  const value = context.lightFrontendState ?? context.mvu ?? context.state ?? context.variables ?? {};
  if (!isPlainObject(value)) return {};
  return isPlainObject(value.values) ? value.values : value;
}

// 按作用域解析模板可读状态：chat/global 双根下的对应子树；
// 旧版扁平 values（迁移前）按 scope 兜底——chat 返回全部，global 返回空对象
function resolveTemplateScopeState(context = {}, scope = MVU_SCOPE_CHAT) {
  const values = resolveTemplateState(context);
  if (isPlainObject(values[MVU_SCOPE_CHAT]) && isPlainObject(values[MVU_SCOPE_GLOBAL])) {
    return values[scope] || {};
  }
  return scope === MVU_SCOPE_CHAT ? values : {};
}

function readStatePath(value, path) {
  const segments = Array.isArray(path)
    ? path
    : String(path || '').replace(/^\//, '').split(/[./]/).filter(Boolean);
  let current = value;
  for (const segment of segments) {
    if (BLOCKED_KEYS.has(segment) || (!isPlainObject(current) && !Array.isArray(current))) return '';
    current = current?.[segment];
  }
  return current ?? '';
}

function stripOuterParentheses(value) {
  let source = String(value || '').trim();
  while (source.startsWith('(') && source.endsWith(')')) source = source.slice(1, -1).trim();
  return source;
}

function stringifyTemplateValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function normalizeRegexTransform(value, index, diagnostics) {
  if (!isPlainObject(value)) return null;
  const rawPattern = String(value.pattern || value.findRegex || value.regex || '').trim();
  const literal = parseRegexLiteral(rawPattern);
  const pattern = String(literal.pattern || '').slice(0, MAX_PATTERN_LENGTH);
  const flags = normalizeRegexFlags(value.flags || literal.flags);
  const replacement = String(
    value.replacement ?? value.replaceString ?? value.replace ?? value.substitute ?? ''
  ).slice(0, MAX_REPLACEMENT_LENGTH);
  if (!pattern) return null;
  if (!isSafeRegexPattern(pattern)) {
    diagnostics.push({ code: 'unsafe-regex-disabled', index, label: String(value.scriptName || value.name || '') });
    return null;
  }
  try {
    new RegExp(pattern, flags);
  } catch {
    diagnostics.push({ code: 'invalid-regex-disabled', index, label: String(value.scriptName || value.name || '') });
    return null;
  }
  const hasMarkdownOnly = Object.hasOwn(value, 'markdownOnly') || Object.hasOwn(value, 'markdown_only');
  const hasPromptOnly = Object.hasOwn(value, 'promptOnly') || Object.hasOwn(value, 'prompt_only');
  const markdownOnly = Boolean(value.markdownOnly ?? value.markdown_only);
  const promptOnly = Boolean(value.promptOnly ?? value.prompt_only);
  if (hasExecutableReplacement(replacement)) {
    diagnostics.push({
      code: 'executable-regex-replacement-sandboxed',
      index,
      label: String(value.scriptName || value.name || ''),
      message: '正则替换包含可执行内容，只有人工审核并绑定当前内容哈希后才会在隔离沙箱中执行。'
    });
    return {
      id: cleanId(value.id || value.scriptName || value.name || `regex-${index + 1}`),
      name: String(value.scriptName || value.name || `显示规则 ${index + 1}`).trim().slice(0, 80),
      pattern,
      flags,
      replacement,
      scope: normalizeRegexScope(value.scope ?? value.placement ?? value.source),
      enabled: value.disabled !== true && value.enabled !== false,
      ...(hasMarkdownOnly ? { markdownOnly } : {}),
      ...(hasPromptOnly ? { promptOnly } : {}),
      runOnEdit: value.runOnEdit === true || value.run_on_edit === true,
      requiresSandbox: true,
      ...normalizeOptionalDepth(value.minDepth ?? value.min_depth, 'minDepth'),
      ...normalizeOptionalDepth(value.maxDepth ?? value.max_depth, 'maxDepth'),
      trimStrings: Array.isArray(value.trimStrings ?? value.trim_strings)
        ? (value.trimStrings ?? value.trim_strings).map((item) => String(item || '')).slice(0, 24)
        : []
    };
  }
  if (markdownOnly && /<\/?[a-z][^>]*>/i.test(replacement)) {
    diagnostics.push({
      code: 'html-regex-replacement-degraded',
      index,
      label: String(value.scriptName || value.name || ''),
      message: '静态 HTML 美化不会作为页面代码执行，显示时将降级为可读文本。'
    });
  }
  return {
    id: cleanId(value.id || value.scriptName || value.name || `regex-${index + 1}`),
    name: String(value.scriptName || value.name || `显示规则 ${index + 1}`).trim().slice(0, 80),
    pattern,
    flags,
    replacement,
    scope: normalizeRegexScope(value.scope ?? value.placement ?? value.source),
    enabled: value.disabled !== true && value.enabled !== false,
    ...(hasMarkdownOnly ? { markdownOnly } : {}),
    ...(hasPromptOnly ? { promptOnly } : {}),
    runOnEdit: value.runOnEdit === true || value.run_on_edit === true,
    ...normalizeOptionalDepth(value.minDepth ?? value.min_depth, 'minDepth'),
    ...normalizeOptionalDepth(value.maxDepth ?? value.max_depth, 'maxDepth'),
    trimStrings: Array.isArray(value.trimStrings ?? value.trim_strings)
      ? (value.trimStrings ?? value.trim_strings).map((item) => String(item || '')).slice(0, 24)
      : []
  };
}

function normalizeQuickReply(value, index, diagnostics) {
  if (typeof value === 'string') value = { label: value.slice(0, 24), content: value };
  if (!isPlainObject(value)) return null;
  if (value.actionType === 'mvu-patch' && Array.isArray(value.patch?.operations)) {
    const operations = value.patch.operations.map(normalizeLifecycleOperation).filter(Boolean);
    if (!operations.length || operations.length !== value.patch.operations.length) {
      diagnostics.push({ code: 'command-quick-reply-disabled', index, label: String(value.label || value.name || '') });
      return null;
    }
    return {
      id: cleanId(value.id || value.label || value.name || `quick-reply-${index + 1}`),
      label: String(value.label || value.name || operations[0].path).trim().slice(0, 40),
      template: '',
      actionType: 'mvu-patch',
      patch: { operations },
      enabled: value.disabled !== true && value.enabled !== false
    };
  }
  const raw = String(
    value.template ?? value.content ?? value.message ?? value.command ?? value.text ?? value.value ?? value.prompt ?? ''
  ).trim();
  if (!raw) return null;
  const command = normalizeQuickReplyCommand(raw);
  if (!command) {
    diagnostics.push({ code: 'command-quick-reply-disabled', index, label: String(value.label || value.name || '') });
    return null;
  }
  const fallbackLabel = command.template || command.patch?.operations?.[0]?.path || `快捷动作 ${index + 1}`;
  return {
    id: cleanId(value.id || value.label || value.name || `quick-reply-${index + 1}`),
    label: String(value.label || value.name || fallbackLabel).trim().slice(0, 40),
    template: String(command.template || '').slice(0, MAX_TEMPLATE_LENGTH),
    actionType: command.actionType,
    ...(command.patch ? { patch: command.patch } : {}),
    enabled: value.disabled !== true && value.enabled !== false
  };
}

function normalizeDeclarativePanel(value, index, diagnostics) {
  if (typeof value === 'string') value = { title: `社区面板 ${index + 1}`, content: value };
  if (!isPlainObject(value)) return null;
  const title = String(value.title || value.label || value.name || `社区面板 ${index + 1}`).trim().slice(0, 40);
  const fields = normalizePanelFields(value.fields ?? value.stats ?? value.values);
  const items = normalizePanelItems(value.items ?? value.entries ?? value.rows);
  const content = String(value.content ?? value.markdown ?? value.body ?? '').trim().slice(0, MAX_TEMPLATE_LENGTH);
  if (!fields.length && !items.length && !content) {
    diagnostics.push({ code: 'empty-panel-disabled', index, label: title });
    return null;
  }
  return {
    id: cleanId(value.id || title || `panel-${index + 1}`),
    title,
    subtitle: String(value.subtitle || value.eyebrow || '').trim().slice(0, 80),
    summary: String(value.summary || value.description || '').trim().slice(0, 500),
    kind: normalizePanelKind(value.kind || value.type, { fields, items, content }),
    tone: normalizePanelTone(value.tone || value.variant),
    placement: 'sidebar',
    fields,
    items,
    content,
    enabled: value.disabled !== true && value.enabled !== false
  };
}

function normalizePanelFields(value) {
  const candidates = Array.isArray(value)
    ? value
    : isPlainObject(value)
      ? Object.entries(value).map(([label, fieldValue]) => (
        isPlainObject(fieldValue) ? { label, ...fieldValue } : { label, value: fieldValue }
      ))
      : [];
  return candidates.slice(0, MAX_PANEL_FIELDS).map((field, index) => {
    if (!isPlainObject(field)) field = { label: `字段 ${index + 1}`, value: field };
    const label = String(field.label || field.name || field.title || `字段 ${index + 1}`).trim().slice(0, 32);
    const path = normalizePanelPath(field.path || field.key || field.variable);
    const rawValue = field.template ?? field.value ?? field.content ?? field.text;
    const template = path
      ? `<%= ${path} %>`
      : stringifyPanelSource(rawValue).slice(0, MAX_TEMPLATE_LENGTH);
    if (!label || !template) return null;
    return {
      id: cleanId(field.id || label || `field-${index + 1}`),
      label,
      template,
      tone: normalizePanelTone(field.tone || field.variant),
      wide: field.wide === true
    };
  }).filter(Boolean);
}

function normalizePanelItems(value) {
  const candidates = Array.isArray(value)
    ? value
    : isPlainObject(value)
      ? Object.entries(value).map(([title, itemValue]) => (
        isPlainObject(itemValue) ? { title, ...itemValue } : { title, detail: itemValue }
      ))
      : [];
  return candidates.slice(0, MAX_PANEL_ITEMS).map((item, index) => {
    if (typeof item === 'string' || typeof item === 'number') {
      item = { title: `条目 ${index + 1}`, detail: item };
    }
    if (!isPlainObject(item)) return null;
    const title = stringifyPanelSource(item.title ?? item.label ?? item.name ?? `条目 ${index + 1}`)
      .trim()
      .slice(0, 100);
    const detail = stringifyPanelSource(item.detail ?? item.content ?? item.description ?? item.value ?? item.text)
      .trim()
      .slice(0, MAX_TEMPLATE_LENGTH);
    const meta = stringifyPanelSource(item.meta ?? item.status ?? item.caption ?? '')
      .trim()
      .slice(0, 200);
    if (!title && !detail) return null;
    return {
      id: cleanId(item.id || title || `item-${index + 1}`),
      title,
      detail,
      meta,
      tone: normalizePanelTone(item.tone || item.variant)
    };
  }).filter(Boolean);
}

function normalizePanelKind(value, { fields, items, content }) {
  const kind = String(value || '').trim().toLowerCase();
  if (['stats', 'status', 'profile', 'fields'].includes(kind)) return 'stats';
  if (['list', 'items', 'ledger', 'records'].includes(kind)) return 'list';
  if (['text', 'markdown', 'info', 'prose'].includes(kind)) return 'text';
  if (fields.length) return 'stats';
  if (items.length) return 'list';
  return content ? 'text' : 'list';
}

function normalizePanelTone(value) {
  const tone = String(value || '').trim().toLowerCase();
  return ['default', 'active', 'warning', 'resource', 'faction', 'relationship'].includes(tone)
    ? tone
    : 'default';
}

function normalizePanelPath(value) {
  let source = String(value || '').trim().replace(/^\$\.?/, '');
  if (!source || !/^[\p{L}_$][\p{L}\p{N}_$-]*(?:\.[\p{L}\p{N}_$-]+)*$/u.test(source)) return '';
  const [root] = source.split('.');
  if (!['user', 'char', 'scene', 'location', 'time', 'persona', 'character', 'mvu', 'state', 'vars', 'variables'].includes(root)) {
    source = `mvu.${source}`;
  }
  return source;
}

function stringifyPanelSource(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }
  return String(value);
}

// SillyTavern 变量作用域：chat（会话级，{{getvar}}/{{setvar}}）、global（跨会话，{{globalvar}}/{{setglobalvar}}）
// MVU 状态树双根结构：values = { chat: {...}, global: {...} }
// 向后兼容：旧版扁平 values 自动迁移为 { chat: {...old}, global: {} }
const MVU_SCOPE_CHAT = 'chat';
const MVU_SCOPE_GLOBAL = 'global';
const MVU_SCOPES = new Set([MVU_SCOPE_CHAT, MVU_SCOPE_GLOBAL]);
const MVU_GLOBAL_KEYS = new Set(['enabled', 'revision', 'schema', 'rules', 'updaters', 'chat', 'global']);

function normalizeMvuState(value, diagnostics) {
  const source = isPlainObject(value) ? value : {};
  const candidateValues = isPlainObject(source.values)
    ? source.values
    : isPlainObject(source.state)
      ? source.state
      : stripMvuMetadata(source);
  let values = {};
  try {
    assertSafeState(candidateValues);
    values = migrateToDualScope(candidateValues);
  } catch {
    diagnostics.push({ code: 'invalid-mvu-seed-disabled' });
  }
  // 双根结构下判定是否存在实际变量（chat/global 任一非空）
  const hasValues = Object.values(values).some((scope) => Object.keys(scope || {}).length > 0);
  return {
    enabled: source.enabled === true || hasValues,
    values,
    revision: Math.max(0, Math.trunc(Number(source.revision) || 0))
  };
}

// 旧版扁平 values 迁移为双根：已存在 chat/global 子对象则保留；否则全部归入 chat
function migrateToDualScope(values) {
  if (!isPlainObject(values)) return { chat: {}, global: {} };
  const hasChat = isPlainObject(values[MVU_SCOPE_CHAT]);
  const hasGlobal = isPlainObject(values[MVU_SCOPE_GLOBAL]);
  if (hasChat || hasGlobal) {
    return {
      chat: isPlainObject(values[MVU_SCOPE_CHAT]) ? structuredClone(values[MVU_SCOPE_CHAT]) : {},
      global: isPlainObject(values[MVU_SCOPE_GLOBAL]) ? structuredClone(values[MVU_SCOPE_GLOBAL]) : {}
    };
  }
  // 旧版扁平结构：全部归入 chat 作用域
  const chatValues = {};
  for (const [key, val] of Object.entries(values)) {
    if (MVU_GLOBAL_KEYS.has(key)) continue;
    chatValues[key] = val;
  }
  return { chat: chatValues, global: {} };
}

function applyMvuOperation(target, operation) {
  if (!isPlainObject(operation)) throw new Error('INVALID_MVU_OPERATION');
  const op = String(operation.op || 'set').toLowerCase();
  const { scope, path } = resolveStateScopePath(operation.path);
  if (!path.length) throw new Error('INVALID_MVU_PATH');
  const scoped = ensureScopeRoot(target, scope);
  const { parent, key } = resolveStateParent(scoped, path, op === 'set' || op === 'increment' || op === 'append');
  if (op === 'set') {
    assertSafeState(operation.value);
    parent[key] = structuredClone(operation.value);
  } else if (op === 'increment') {
    const amount = Number(operation.value ?? 1);
    if (!Number.isFinite(amount)) throw new Error('INVALID_MVU_INCREMENT');
    const current = Number(parent[key] || 0);
    if (!Number.isFinite(current)) throw new Error('INVALID_MVU_INCREMENT_TARGET');
    parent[key] = current + amount;
  } else if (op === 'append') {
    // addvar 语义：数组追加、字符串拼接、数值累加（兼容 SillyTavern {{addvar::}}）
    assertSafeState(operation.value);
    const value = structuredClone(operation.value);
    if (Array.isArray(parent[key]) && Array.isArray(value)) {
      parent[key] = [...parent[key], ...value];
    } else if (typeof parent[key] === 'string' || typeof value === 'string') {
      parent[key] = String(parent[key] || '') + String(value);
    } else if (typeof parent[key] === 'number' || typeof value === 'number') {
      parent[key] = Number(parent[key] || 0) + Number(value || 0);
    } else {
      parent[key] = value;
    }
  } else if (op === 'delete') {
    delete parent[key];
  } else {
    throw new Error('UNSUPPORTED_MVU_OPERATION');
  }
}

function resolveStateParent(target, path, create) {
  let current = target;
  for (const segment of path.slice(0, -1)) {
    if (!isPlainObject(current[segment])) {
      if (!create) throw new Error('MVU_PATH_NOT_FOUND');
      current[segment] = {};
    }
    current = current[segment];
  }
  return { parent: current, key: path.at(-1) };
}

function normalizeStatePath(value) {
  const parts = Array.isArray(value)
    ? value
    : String(value || '').replace(/^\//, '').split(/[./]/);
  const normalized = parts.map((part) => String(part || '').trim()).filter(Boolean);
  if (!normalized.length || normalized.length > MAX_STATE_DEPTH || normalized.some((part) => BLOCKED_KEYS.has(part))) {
    return [];
  }
  return normalized;
}

// 解析 MVU 操作路径的作用域前缀：
//   chat.xxx / chat:xxx → chat 作用域；global.xxx / global:xxx → global 作用域
//   裸路径（xxx）默认 chat 作用域（兼容旧补丁与模型输出习惯）
function resolveStateScopePath(value) {
  const raw = Array.isArray(value) ? value.join('.') : String(value || '');
  const match = /^\s*(chat|global)\s*[:.]\s*(.+)$/i.exec(raw);
  if (match) {
    return { scope: match[1].toLowerCase(), path: normalizeStatePath(match[2]) };
  }
  return { scope: MVU_SCOPE_CHAT, path: normalizeStatePath(raw) };
}

// 确保双根结构中指定作用域的根对象存在，返回该作用域的写入目标
function ensureScopeRoot(target, scope) {
  const normalizedScope = MVU_SCOPES.has(scope) ? scope : MVU_SCOPE_CHAT;
  if (isPlainObject(target.chat) && isPlainObject(target.global)) return target[normalizedScope];
  // 目标不是双根结构（旧版扁平 values）：原地改造为双根，旧数据归入 chat
  const legacyValues = {};
  for (const [key, val] of Object.entries(target)) {
    if (MVU_GLOBAL_KEYS.has(key)) continue;
    legacyValues[key] = val;
  }
  for (const key of Object.keys(target)) {
    if (!MVU_SCOPES.has(key)) delete target[key];
  }
  target.chat = normalizedScope === MVU_SCOPE_CHAT ? legacyValues : {};
  target.global = normalizedScope === MVU_SCOPE_GLOBAL ? legacyValues : {};
  return target[normalizedScope];
}

function assertSafeState(value, depth = 0, seen = new Set()) {
  if (depth > MAX_STATE_DEPTH) throw new Error('MVU_STATE_TOO_DEEP');
  if (value === null || ['string', 'boolean'].includes(typeof value)) return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('INVALID_MVU_NUMBER');
    return;
  }
  if (typeof value !== 'object' || seen.has(value)) throw new Error('INVALID_MVU_VALUE');
  seen.add(value);
  if (Array.isArray(value)) {
    if (value.length > 500) throw new Error('MVU_STATE_TOO_LARGE');
    value.forEach((item) => assertSafeState(item, depth + 1, seen));
  } else {
    for (const [key, item] of Object.entries(value)) {
      if (BLOCKED_KEYS.has(key)) throw new Error('INVALID_MVU_KEY');
      assertSafeState(item, depth + 1, seen);
    }
  }
  if (depth === 0 && Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_STATE_BYTES) {
    throw new Error('MVU_STATE_TOO_LARGE');
  }
}

function isSafeRegexPattern(pattern) {
  if (!pattern || pattern.length > MAX_PATTERN_LENGTH) return false;
  if (/\\[1-9]/.test(pattern)) return false;
  if (/\(\?<[=!]/.test(pattern)) return false;
  if (/\([^)]*[+*][^)]*\)[+*{]/.test(pattern)) return false;
  if (/(?:\.\*|\.\+).*(?:\.\*|\.\+)/.test(pattern)) return false;
  return true;
}

function parseRegexLiteral(value) {
  const source = String(value || '').trim();
  if (!source.startsWith('/')) return { pattern: source, flags: '' };
  const lastSlash = source.lastIndexOf('/');
  if (lastSlash <= 0) return { pattern: source, flags: '' };
  return { pattern: source.slice(1, lastSlash), flags: source.slice(lastSlash + 1) };
}

function normalizeRegexFlags(value) {
  const flags = [...new Set(String(value || 'g').split('').filter((flag) => 'gimsu'.includes(flag)))].join('');
  return flags || 'g';
}

function normalizeRegexScope(value) {
  const source = String(value || '').toLowerCase();
  if (source.includes('user') || source === '1') return 'user';
  if (source.includes('all')) return 'all';
  if (source.includes('assistant') || source.includes('ai') || source === '2') return 'assistant';
  return 'assistant';
}

function normalizeOptionalDepth(value, key) {
  if (value === undefined || value === null || value === '') return {};
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? { [key]: Math.trunc(number) } : {};
}

function isDisplayRegexRule(rule) {
  if (rule.markdownOnly === true) return true;
  if (rule.promptOnly === true) return false;
  return !Object.hasOwn(rule, 'markdownOnly') && !Object.hasOwn(rule, 'promptOnly');
}

function hasExecutableReplacement(value) {
  const source = String(value || '');
  return /<\s*(?:script|iframe|object|embed)(?:\s|>)/i.test(source)
    || /javascript\s*:/i.test(source)
    || /\son[a-z]+\s*=/i.test(source);
}

function degradeStaticHtmlReplacement(value) {
  const source = String(value || '');
  if (!/<\/?[a-z][^>]*>/i.test(source)) return source;
  return source
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/\s*(?:p|div|details|summary|section|article|h[1-6])\s*>/gi, '\n')
    .replace(/<\s*li(?:\s[^>]*)?>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeQuickReplyCommand(value) {
  const text = String(value || '').trim();
  if (/<script(?:\s|>)/i.test(text) || /javascript\s*:/i.test(text)) return null;
  const send = text.match(/^\/(?:send|say)\s+([\s\S]+)$/i);
  if (send) return { actionType: 'compose', template: send[1].trim() };
  const operation = parseAllowlistedSlashCommand(text);
  if (operation) {
    return {
      actionType: 'mvu-patch',
      template: '',
      patch: { operations: [operation] }
    };
  }
  if (text.startsWith('/')) return null;
  return { actionType: 'compose', template: text };
}

function expandDisplayMacros(text, context = {}) {
  const values = {
    user: context.user,
    char: context.char
  };
  return String(text || '').replace(/\{\{\s*(user|char|character[\s_-]+name)\s*\}\}/gi, (_, key) => {
    const normalizedKey = /^character[\s_-]+name$/i.test(String(key || '').trim()) ? 'char' : String(key).toLowerCase();
    return String(values[normalizedKey] || '');
  });
}

function mergeLifecycleSources(values = []) {
  const events = {};
  for (const value of values) {
    if (!isPlainObject(value)) continue;
    for (const event of ['onImport', 'onUser', 'onAssistant']) {
      const directValue = value[event];
      if (directValue !== undefined) {
        events[event] = [...(events[event] || []), ...asArrayOrSingle(directValue)];
      }
    }
  }
  return events;
}

function asArrayOrSingle(value) {
  return Array.isArray(value) ? value : [value];
}

function collectExtensionContainers(payload) {
  const containers = [];
  const queue = [payload];
  const seen = new Set();
  while (queue.length && containers.length < 80) {
    const value = queue.shift();
    if (Array.isArray(value)) {
      value.slice(0, 80).forEach((item) => queue.push(item));
      continue;
    }
    if (!isPlainObject(value) || seen.has(value)) continue;
    seen.add(value);
    containers.push(value);
    for (const key of [
      'data', 'extensions', 'extension', 'metadata', 'raw', 'config', 'settings', 'preset',
      'quickReplySet', 'quick_reply_set', 'ui', 'panel', 'panels'
    ]) {
      if (isPlainObject(value[key]) || Array.isArray(value[key])) queue.push(value[key]);
    }
  }
  return containers;
}

function collectCommunityAdapterSources(payload) {
  const sources = [];
  const queue = [payload];
  const seen = new Set();
  while (queue.length && seen.size < 300) {
    const value = queue.shift();
    if (Array.isArray(value)) {
      value.slice(0, 120).forEach((item) => queue.push(item));
      continue;
    }
    if (!isPlainObject(value) || seen.has(value)) continue;
    seen.add(value);
    for (const [key, child] of Object.entries(value).slice(0, 300)) {
      const adapterId = identifyCommunityAdapter(key);
      if (adapterId && (isPlainObject(child) || Array.isArray(child))) {
        sources.push({ id: adapterId, payload: child, sourceKey: key });
      }
      if (isPlainObject(child) || Array.isArray(child)) queue.push(child);
    }
  }
  return sources.slice(0, 12);
}

function identifyCommunityAdapter(key) {
  const source = String(key || '').trim();
  if (/^(?:tavern[._-]?helper|酒馆助手)$/iu.test(source)) return 'tavern-helper';
  if (/^(?:xiaobai[._-]?x|小白\s*[xXＸ])$/u.test(source)) return 'xiaobai-x';
  return '';
}

function describeCommunityAdapter(source, runtime) {
  const mappedCapabilities = [];
  if (runtime.regexTransforms.length) mappedCapabilities.push('safe-regex-display');
  if (runtime.quickReplies.length) mappedCapabilities.push('quick-replies');
  if (runtime.panels.length) mappedCapabilities.push('sidebar-panels');
  if (runtime.mvu.enabled) mappedCapabilities.push('mvu-state');
  const unsupportedCapabilities = detectExecutableAdapterMarkers(source.payload);
  return {
    id: source.id,
    sourceKey: String(source.sourceKey || source.id).slice(0, 80),
    mode: mappedCapabilities.length ? 'declarative-partial' : 'unmapped',
    mappedCapabilities,
    unsupportedCapabilities
  };
}

function detectExecutableAdapterMarkers(payload) {
  const markers = new Set();
  const containers = collectAllContainers(payload);
  for (const container of containers) {
    for (const [key, value] of Object.entries(container)) {
      if (/^(?:scripts?|scriptcode|javascript|hooks?|on[a-z]+)$/i.test(key)) markers.add(key);
      if (typeof value === 'string' && (
        /<script(?:\s|>)/i.test(value)
        || /javascript\s*:/i.test(value)
        || /\son[a-z]+\s*=/i.test(value)
        || /(?:^|\s)\/(?:setvar|run|trigger)(?:\s|$)/im.test(value)
      )) {
        markers.add('executable-command');
      }
    }
  }
  return [...markers].slice(0, 12);
}

function extractStaticStatusPanels(payload) {
  const diagnostics = [];
  const unsupportedCapabilities = detectExecutableAdapterMarkers(payload);
  const candidates = collectStaticMarkupCandidates(payload);
  const panels = [];
  let deferredTemplateCount = 0;
  for (const candidate of candidates) {
    for (const block of splitStaticPanelBlocks(candidate)) {
      if (isAuthorInstructionStatusTemplate(block)) {
        deferredTemplateCount += 1;
        continue;
      }
      const panel = parseStaticPanel(block, panels.length);
      if (!panel) continue;
      panels.push(panel);
      if (panels.length >= MAX_PANELS) break;
    }
    if (panels.length >= MAX_PANELS) break;
  }
  if (panels.length) {
    diagnostics.push({
      code: 'static-heavy-panel-mapped',
      count: panels.length,
      message: `已将 ${panels.length} 个静态重前端状态块转换为原生侧栏卡片。`
    });
  }
  if (deferredTemplateCount) {
    diagnostics.push({
      code: 'static-status-template-deferred',
      count: deferredTemplateCount,
      message: `检测到 ${deferredTemplateCount} 个待模型填写的状态模板；生成具体状态前不挂载为实时侧栏。`
    });
  }
  if (unsupportedCapabilities.length) {
    diagnostics.push({
      code: 'third-party-executable-disabled',
      markers: unsupportedCapabilities,
      message: '第三方脚本与事件处理器未执行，仅保留白名单声明式内容。'
    });
  }
  return { panels, diagnostics, unsupportedCapabilities };
}

function collectStaticMarkupCandidates(payload) {
  const candidates = [];
  const queue = [payload];
  const seen = new Set();
  while (queue.length && seen.size < 500 && candidates.length < 80) {
    const value = queue.shift();
    if (Array.isArray(value)) {
      value.slice(0, 160).forEach((item) => queue.push(item));
      continue;
    }
    if (!isPlainObject(value) || seen.has(value)) continue;
    seen.add(value);
    for (const child of Object.values(value).slice(0, 400)) {
      if (typeof child === 'string') {
        if (
          child.length <= MAX_DISPLAY_TEXT_LENGTH
          && /<(?:div|section|aside|details|table|h[1-6]|status|panel)\b/iu.test(child)
          && STATUS_PANEL_TITLE_PATTERN.test(stripStaticMarkup(child))
        ) candidates.push(child);
      } else if (isPlainObject(child) || Array.isArray(child)) {
        queue.push(child);
      }
    }
  }
  return uniqueStrings(candidates);
}

function splitStaticPanelBlocks(markup) {
  const safe = sanitizeStaticMarkup(markup);
  const blocks = [
    ...[...safe.matchAll(/<details\b[^>]*>[\s\S]*?<\/details>/giu)],
    ...[...safe.matchAll(/<(?:section|aside)\b[^>]*>[\s\S]*?<\/(?:section|aside)>/giu)]
  ]
    .map((match) => ({ index: match.index ?? 0, markup: match[0] }))
    .sort((left, right) => left.index - right.index)
    .map((item) => item.markup);
  return blocks.length ? blocks : [safe];
}

function parseStaticPanel(markup, index) {
  const title = normalizeCommunityMacroAliases(extractFirstMarkupText(markup, [
    /<summary\b[^>]*>([\s\S]*?)<\/summary>/iu,
    /<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/iu,
    /<(?:header|strong)\b[^>]*>([\s\S]*?)<\/(?:header|strong)>/iu
  ]));
  if (!title || !STATUS_PANEL_TITLE_PATTERN.test(title)) return null;

  const fields = [];
  const rowPattern = /<tr\b[^>]*>\s*<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>\s*<td\b[^>]*>([\s\S]*?)<\/td>[\s\S]*?<\/tr>/giu;
  for (const match of markup.matchAll(rowPattern)) {
    const label = stripStaticMarkup(match[1]).slice(0, 32);
    const value = normalizeCommunityMacroAliases(stripStaticMarkup(match[2])).slice(0, 500);
    if (hasUnknownMustachePlaceholder(value)) continue;
    if (label && value) fields.push({ label, value });
    if (fields.length >= MAX_PANEL_FIELDS) break;
  }

  const items = [];
  for (const match of markup.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/giu)) {
    const text = normalizeCommunityMacroAliases(stripStaticMarkup(match[1]));
    if (!text) continue;
    const parts = text.split(/[：:]/u);
    const item = {
      title: (parts.shift() || `条目 ${items.length + 1}`).trim().slice(0, 100),
      detail: parts.join('：').trim().slice(0, MAX_TEMPLATE_LENGTH)
    };
    if (hasUnknownMustachePlaceholder(`${item.title}\n${item.detail}`)) continue;
    items.push(item);
    if (items.length >= MAX_PANEL_ITEMS) break;
  }

  if (!fields.length) {
    const text = stripStaticMarkup(markup);
    for (const line of text.split('\n')) {
      const match = line.match(/^([^：:\n]{1,32})[：:]\s*(.+)$/u);
      if (!match || match[1].trim() === title) continue;
      const value = normalizeCommunityMacroAliases(match[2].trim()).slice(0, 500);
      if (hasUnknownMustachePlaceholder(value)) continue;
      fields.push({ label: match[1].trim(), value });
      if (fields.length >= MAX_PANEL_FIELDS) break;
    }
  }

  const plainText = stripStaticMarkup(markup)
    .split('\n')
    .filter((line) => line !== title)
    .join('\n')
    .trim();
  if (!fields.length && !items.length && !plainText) return null;
  return {
    id: `static-panel-${index + 1}-${cleanId(title)}`,
    title,
    subtitle: '由静态状态面板安全转换',
    summary: '',
    kind: fields.length ? 'stats' : items.length ? 'list' : 'text',
    tone: inferStaticPanelTone(title),
    fields,
    items,
    content: fields.length || items.length ? '' : plainText.slice(0, MAX_TEMPLATE_LENGTH)
  };
}

function isAuthorInstructionStatusTemplate(markup) {
  if (!STATUS_PANEL_TITLE_PATTERN.test(stripStaticMarkup(markup))) return false;
  const unknownPlaceholders = getMustachePlaceholders(markup)
    .filter((placeholder) => !isSupportedDisplayPlaceholder(placeholder));
  return unknownPlaceholders.length >= 2;
}

function normalizeCommunityMacroAliases(value) {
  return String(value || '').replace(
    /\{\{\s*character[\s_-]+name\s*\}\}/giu,
    '{{char}}'
  );
}

function hasUnknownMustachePlaceholder(value) {
  return getMustachePlaceholders(value)
    .some((placeholder) => !isSupportedDisplayPlaceholder(placeholder));
}

function getMustachePlaceholders(value) {
  return [...String(value || '').matchAll(/\{\{\s*([^{}]+?)\s*\}\}/gu)]
    .map((match) => String(match[1] || '').trim())
    .filter(Boolean);
}

function isSupportedDisplayPlaceholder(value) {
  return /^(?:user|char|character[\s_-]+name|scene|location|time|(?:getvar|globalvar)::[^{}]+)$/iu
    .test(String(value || '').trim());
}

function sanitizeStaticMarkup(value) {
  return String(value || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/giu, '')
    .replace(/javascript\s*:/giu, '');
}

function stripStaticMarkup(value) {
  return sanitizeStaticMarkup(value)
    .replace(/<(?:br|\/p|\/div|\/li|\/tr|\/section|\/details|\/aside|\/h[1-6])\b[^>]*>/giu, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/giu, ' ')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&amp;/giu, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

function extractFirstMarkupText(markup, patterns) {
  for (const pattern of patterns) {
    const value = stripStaticMarkup(markup.match(pattern)?.[1] || '').trim().slice(0, 40);
    if (value) return value;
  }
  return '';
}

function inferStaticPanelTone(title) {
  if (/关系|互动|好感/u.test(title)) return 'relationship';
  if (/资源|背包|修为|造化/u.test(title)) return 'resource';
  if (/势力|声望/u.test(title)) return 'faction';
  if (/任务|线索|风险/u.test(title)) return 'warning';
  return 'default';
}

function collectAllContainers(payload) {
  const containers = [];
  const queue = [payload];
  const seen = new Set();
  while (queue.length && seen.size < 500) {
    const value = queue.shift();
    if (Array.isArray(value)) {
      value.slice(0, 160).forEach((item) => queue.push(item));
      continue;
    }
    if (!isPlainObject(value) || seen.has(value)) continue;
    seen.add(value);
    containers.push(value);
    Object.values(value).slice(0, 400).forEach((child) => {
      if (isPlainObject(child) || Array.isArray(child)) queue.push(child);
    });
  }
  return containers;
}

function mergeMvuSeeds(values) {
  // 种子合并直接在双根结构上进行：裸键归 chat，显式 chat./global. 前缀归对应作用域
  const merged = { chat: {}, global: {} };
  let enabled = false;
  let revision = 0;
  for (const value of values) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isPlainObject(item) && item.name) {
          const k = String(item.name).trim();
          if (k) {
            const { scope, path } = resolveStateScopePath(k);
            const root = ensureScopeRoot(merged, scope);
            writeSeedPath(root, path, item.value ?? '');
            enabled = true;
          }
        }
      }
      continue;
    }
    if (!isPlainObject(value)) continue;
    const normalized = normalizeMvuState(value, []);
    if (normalized.enabled) enabled = true;
    revision = Math.max(revision, normalized.revision);
    safeMerge(merged, normalized.values);
  }
  return { enabled, values: merged, revision };
}

// 种子写入：逐级创建父对象后写叶子值
function writeSeedPath(root, path, value) {
  if (!path.length) return;
  let current = root;
  for (const segment of path.slice(0, -1)) {
    if (!isPlainObject(current[segment])) current[segment] = {};
    current = current[segment];
  }
  current[path.at(-1)] = value;
}

function collectNamedValues(containers, names) {
  const values = [];
  for (const container of containers) {
    for (const name of names) {
      if (Object.hasOwn(container, name)) values.push(container[name]);
    }
  }
  return values;
}

function stripMvuMetadata(source) {
  const values = {};
  for (const [key, value] of Object.entries(source)) {
    if (['enabled', 'revision', 'schema', 'rules', 'updaters'].includes(key)) continue;
    values[key] = value;
  }
  return values;
}

function normalizeAdapters(values) {
  return dedupeAdapters((Array.isArray(values) ? values : []).map((value) => {
    const rawId = String(value?.id || '').trim();
    if (!rawId || !COMMUNITY_ADAPTER_ALLOWLIST.has(rawId)) return null;
    return {
      id: rawId,
      sourceKey: String(value?.sourceKey || rawId).trim().slice(0, 80),
      mode: value?.mode === 'declarative-partial' ? 'declarative-partial' : 'unmapped',
      mappedCapabilities: uniqueStrings(value?.mappedCapabilities).slice(0, 12),
      unsupportedCapabilities: uniqueStrings(value?.unsupportedCapabilities).slice(0, 12)
    };
  }).filter(Boolean));
}

function dedupeAdapters(values) {
  const byId = new Map();
  for (const value of values) {
    if (!value?.id) continue;
    const existing = byId.get(value.id);
    if (!existing) {
      byId.set(value.id, structuredClone(value));
      continue;
    }
    existing.mode = existing.mode === 'declarative-partial' || value.mode === 'declarative-partial'
      ? 'declarative-partial'
      : 'unmapped';
    existing.mappedCapabilities = uniqueStrings([
      ...(existing.mappedCapabilities || []),
      ...(value.mappedCapabilities || [])
    ]);
    existing.unsupportedCapabilities = uniqueStrings([
      ...(existing.unsupportedCapabilities || []),
      ...(value.unsupportedCapabilities || [])
    ]);
  }
  return [...byId.values()];
}

function safeMerge(target, source) {
  for (const [key, value] of Object.entries(isPlainObject(source) ? source : {})) {
    if (BLOCKED_KEYS.has(key)) continue;
    if (isPlainObject(value) && isPlainObject(target[key])) safeMerge(target[key], value);
    else target[key] = structuredClone(value);
  }
}

function dedupeById(values) {
  const seen = new Set();
  return values.filter((value) => {
    if (!value?.id || seen.has(value.id)) return false;
    seen.add(value.id);
    return true;
  });
}

function cleanId(value) {
  return String(value || 'item')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'item';
}

function asArray(value) {
  return Array.isArray(value) ? value : isPlainObject(value) ? Object.values(value) : [];
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : [values])
    .map((value) => String(value || '').trim())
    .filter(Boolean))];
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
