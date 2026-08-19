const MAX_RULES = 32;
const MAX_PANELS = 8;
const MAX_TEXT_LENGTH = 120000;
const MAX_REPLACEMENT_LENGTH = 524288; // 与后端一致

export function applyLightFrontendDisplayTransforms(text, runtime = {}, { role = 'assistant', context = {} } = {}) {
  let output = String(text || '').slice(0, MAX_TEXT_LENGTH);
  const rules = Array.isArray(runtime?.regexTransforms) ? runtime.regexTransforms.slice(0, MAX_RULES) : [];
  for (const rule of rules) {
    if (!rule || rule.enabled === false) continue;
    if (!isDisplayRule(rule)) continue;
    const scope = ['assistant', 'user', 'all'].includes(rule.scope) ? rule.scope : 'assistant';
    if (scope !== 'all' && scope !== role) continue;
    const pattern = String(rule.pattern || '');
    if (!pattern || pattern.length > 500 || !isSafePattern(pattern)) continue;
    const flags = normalizeFlags(rule.flags);
    try {
      const rawReplacement = String(rule.replacement || '').slice(0, MAX_REPLACEMENT_LENGTH);
      // 可执行 replacement 完全由 scriptGovernance/sandboxRenderer 处理。
      // 未审核脚本必须保持原始消息内容，不能在这里生成悬空占位符。
      if (rule.requiresSandbox === true) {
        continue;
      }
      const processedReplacement = degradeStaticHtmlReplacement(rawReplacement);
      const replacement = expandDisplayMacros(
        renderSafeLightFrontendTemplate(processedReplacement, context),
        context
      );
      output = output.replace(new RegExp(pattern, flags), replacement);
    } catch {
      // Imported display rules are best-effort and never break the chat renderer.
    }
  }
  return output;
}

function isDisplayRule(rule) {
  if (rule.markdownOnly === true) return true;
  if (rule.promptOnly === true) return false;
  return !Object.hasOwn(rule, 'markdownOnly') && !Object.hasOwn(rule, 'promptOnly');
}

function degradeStaticHtmlReplacement(value) {
  const source = String(value || '');
  if (!/<\/?[a-z][^>]*>/i.test(source)) return source;
  return source
    // Removing tags alone would expose stylesheet/program source as chat text.
    // Static replacements may keep their readable copy, but embedded control
    // and executable blocks never belong in the narrative surface.
    .replace(/<\s*(style|script|template|noscript)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
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

export function getLightFrontendQuickReplies(runtime = {}) {
  return (Array.isArray(runtime?.quickReplies) ? runtime.quickReplies : [])
    .filter((reply) => reply?.enabled !== false && (
      (reply?.actionType === 'compose' && reply?.template)
      || (reply?.actionType === 'mvu-patch' && Array.isArray(reply?.patch?.operations))
    ))
    .slice(0, 24)
    .map((reply) => ({
      id: String(reply.id || ''),
      label: String(reply.label || reply.template || reply.patch?.operations?.[0]?.path || '状态动作').slice(0, 40),
      template: String(reply.template || '').slice(0, 4000),
      actionType: reply.actionType,
      ...(reply.patch ? { patch: structuredClone(reply.patch) } : {}),
      source: 'community-light-frontend'
    }));
}

function expandDisplayMacros(text, context = {}) {
  const values = { user: context.user, char: context.char };
  return String(text || '').replace(/\{\{\s*(user|char|character[\s_-]+name)\s*\}\}/gi, (_, key) => {
    const normalizedKey = /^character[\s_-]+name$/i.test(String(key || '').trim()) ? 'char' : String(key).toLowerCase();
    return String(values[normalizedKey] || '');
  });
}

export function getLightFrontendPanels(runtime = {}) {
  return (Array.isArray(runtime?.panels) ? runtime.panels : [])
    .filter((panel) => panel?.enabled !== false && panel?.placement !== 'hidden' && panel?.title)
    .slice(0, MAX_PANELS)
    .map((panel) => ({
      id: String(panel.id || ''),
      title: String(panel.title || '').slice(0, 40),
      subtitle: String(panel.subtitle || '').slice(0, 80),
      summary: String(panel.summary || '').slice(0, 500),
      kind: ['stats', 'list', 'text'].includes(panel.kind) ? panel.kind : 'text',
      tone: normalizePanelTone(panel.tone),
      content: String(panel.content || '').slice(0, 4000),
      fields: Array.isArray(panel.fields) ? panel.fields.slice(0, 16) : [],
      items: Array.isArray(panel.items) ? panel.items.slice(0, 24) : [],
      source: 'community-light-frontend'
    }));
}

export function resolveLightFrontendPanel(panel, context = {}) {
  if (!panel) return null;
  const render = (value) => renderLightFrontendText(value, context);
  const sourceFields = Array.isArray(panel.fields) ? panel.fields : [];
  let unresolvedFieldCount = 0;
  const fields = sourceFields.map((field) => {
    const value = render(field?.template ?? field?.value).slice(0, 1000);
    if (hasUnresolvedTemplate(value)) unresolvedFieldCount += 1;
    return {
      id: String(field?.id || ''),
      label: render(field?.label).slice(0, 32),
      value,
      tone: normalizePanelTone(field?.tone),
      wide: field?.wide === true
    };
  }).filter((field) => field.label && field.value && !hasUnresolvedTemplate(`${field.label}\n${field.value}`));
  const items = (Array.isArray(panel.items) ? panel.items : []).map((item) => ({
    id: String(item?.id || ''),
    title: render(item?.title).slice(0, 100),
    detail: render(item?.detail).slice(0, 4000),
    meta: render(item?.meta).slice(0, 200),
    tone: normalizePanelTone(item?.tone)
  })).filter((item) => (item.title || item.detail) && !hasUnresolvedTemplate(`${item.title}\n${item.detail}\n${item.meta}`));
  const title = render(panel.title).slice(0, 40);
  const subtitle = render(panel.subtitle).slice(0, 80);
  const summary = render(panel.summary).slice(0, 500);
  const content = render(panel.content).slice(0, 4000);
  const unresolvedSchema = unresolvedFieldCount >= 2
    && unresolvedFieldCount * 2 >= sourceFields.length
    && fields.length <= 1
    && !items.length
    && !summary
    && !content;
  if (unresolvedSchema || hasUnresolvedTemplate(title)) return null;
  if (!fields.length && !items.length && !summary && !content) return null;
  return {
    ...panel,
    title,
    subtitle: hasUnresolvedTemplate(subtitle) ? '' : subtitle,
    summary: hasUnresolvedTemplate(summary) ? '' : summary,
    content: hasUnresolvedTemplate(content) ? '' : content,
    fields,
    items
  };
}

export function expandLightFrontendQuickReply(reply, context = {}) {
  const template = String(reply?.template || '').slice(0, 4000);
  const values = {
    user: context.user,
    char: context.char,
    scene: context.scene,
    location: context.location,
    time: context.time
  };
  return renderSafeLightFrontendTemplate(template, context)
    .replace(/\{\{\s*(user|char|character[\s_-]+name|scene|location|time)\s*\}\}/gi, (_, key) => {
      const normalizedKey = /^character[\s_-]+name$/i.test(String(key || '').trim()) ? 'char' : String(key).toLowerCase();
      return String(values[normalizedKey] || '');
    })
    .replace(/\{\{\s*(?:getvar|globalvar)::([^{}]+)\}\}/gi, (_, path) => {
      return stringifyValue(readPath(resolveState(context), path));
    })
    .trim();
}

function renderLightFrontendText(value, context) {
  const rendered = renderSafeLightFrontendTemplate(String(value || ''), context);
  const values = {
    user: context.user,
    char: context.char,
    scene: context.scene,
    location: context.location,
    time: context.time
  };
  return rendered
    .replace(/\{\{\s*(user|char|character[\s_-]+name|scene|location|time)\s*\}\}/gi, (_, key) => {
      const normalizedKey = /^character[\s_-]+name$/i.test(String(key || '').trim()) ? 'char' : String(key).toLowerCase();
      return String(values[normalizedKey] || '');
    })
    .replace(/\{\{\s*(?:getvar|globalvar)::([^{}]+)\}\}/gi, (_, path) => {
      return stringifyValue(readPath(resolveState(context), path));
    })
    .trim();
}

function hasUnresolvedTemplate(value) {
  return /\{\{[^{}]+\}\}/u.test(String(value || ''));
}

export function renderSafeLightFrontendTemplate(text = '', context = {}) {
  const source = String(text || '').slice(0, MAX_TEXT_LENGTH);
  const tagRegex = /<%([=-]?)([\s\S]*?)%>/g;
  const stack = [];
  let active = true;
  let cursor = 0;
  let count = 0;
  let output = '';
  let match;
  while ((match = tagRegex.exec(source)) && count < 80) {
    count += 1;
    if (active) output += source.slice(cursor, match.index);
    const tag = classifyTemplateTag(match[1], match[2]);
    if (tag.type === 'value') {
      const result = evaluateExpression(tag.expression, context);
      if (active && result.valid) output += stringifyValue(result.value);
    } else if (tag.type === 'if') {
      const result = evaluateExpression(tag.expression, context);
      stack.push({ parentActive: active, condition: result.valid && Boolean(result.value), elseSeen: false });
      active = active && result.valid && Boolean(result.value);
    } else if (tag.type === 'else') {
      const frame = stack.at(-1);
      if (frame && !frame.elseSeen) {
        frame.elseSeen = true;
        active = frame.parentActive && !frame.condition;
      }
    } else if (tag.type === 'close') {
      const frame = stack.pop();
      active = frame ? frame.parentActive : active;
    }
    cursor = tagRegex.lastIndex;
  }
  if (active) output += source.slice(cursor);
  return output;
}

function classifyTemplateTag(marker, body) {
  const source = String(body || '').trim();
  if (marker === '=' || marker === '-') return { type: 'value', expression: source };
  const conditional = source.match(/^if\s*\(([\s\S]+)\)\s*\{?\s*$/);
  if (conditional) return { type: 'if', expression: conditional[1] };
  if (/^\}?\s*else\s*\{?\s*$/.test(source)) return { type: 'else' };
  if (/^\}\s*;?\s*$/.test(source)) return { type: 'close' };
  return { type: 'unsupported' };
}

function evaluateExpression(expression, context) {
  const source = String(expression || '').trim().replace(/^\((.*)\)$/s, '$1').trim();
  if (!source || source.length > 300) return { valid: false };
  if (source.startsWith('!') && !source.startsWith('!=')) {
    const nested = evaluateExpression(source.slice(1), context);
    return nested.valid ? { valid: true, value: !nested.value } : nested;
  }
  const comparison = source.match(/^(.+?)\s*(===|!==|>=|<=|==|!=|>|<)\s*(.+)$/);
  if (comparison) {
    const left = resolveAtom(comparison[1], context);
    const right = resolveAtom(comparison[3], context);
    if (!left.valid || !right.valid) return { valid: false };
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
  return resolveAtom(source, context);
}

function compareNumbers(left, right, operator) {
  if (operator === '>') return left > right;
  if (operator === '<') return left < right;
  if (operator === '>=') return left >= right;
  return left <= right;
}

function resolveAtom(expression, context) {
  const source = String(expression || '').trim();
  const quoted = source.match(/^(['"])([\s\S]*)\1$/);
  if (quoted) return { valid: true, value: quoted[2] };
  if (/^-?\d+(?:\.\d+)?$/.test(source)) return { valid: true, value: Number(source) };
  if (/^(?:true|false)$/i.test(source)) return { valid: true, value: source.toLowerCase() === 'true' };
  if (/^(?:null|undefined)$/i.test(source)) return { valid: true, value: null };
  const getter = source.match(/^(?:getvar|getglobalvar)\(\s*(['"])([^'"]+)\1\s*\)$/i);
  if (getter) return { valid: true, value: readPath(resolveState(context), getter[2]) };
  if (!/^[\p{L}_$][\p{L}\p{N}_$-]*(?:\.[\p{L}\p{N}_$-]+)*$/u.test(source)) return { valid: false };
  const [root, ...path] = source.split('.');
  const state = resolveState(context);
  const roots = {
    user: context.user,
    char: context.char,
    scene: context.scene,
    location: context.location,
    time: context.time,
    persona: context.persona || {},
    character: context.character || {},
    mvu: state,
    state,
    vars: state,
    variables: state
  };
  if (!Object.hasOwn(roots, root)) return { valid: false };
  return { valid: true, value: readPath(roots[root], path) };
}

function resolveState(context) {
  const state = context.mvu ?? context.lightFrontendState ?? context.state ?? {};
  return state && typeof state === 'object' && !Array.isArray(state)
    ? state.values && typeof state.values === 'object' ? state.values : state
    : {};
}

function readPath(value, path) {
  const parts = Array.isArray(path) ? path : String(path || '').replace(/^\//, '').split(/[./]/).filter(Boolean);
  let current = value;
  for (const part of parts) {
    if (['__proto__', 'prototype', 'constructor'].includes(part) || current === null || typeof current !== 'object') return '';
    current = current[part];
  }
  return current ?? '';
}

function stringifyValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function normalizePanelTone(value) {
  const tone = String(value || '').trim().toLowerCase();
  return ['default', 'active', 'warning', 'resource', 'faction', 'relationship'].includes(tone)
    ? tone
    : 'default';
}

function normalizeFlags(value) {
  const flags = [...new Set(String(value || 'g').split('').filter((flag) => 'gimsu'.includes(flag)))].join('');
  return flags || 'g';
}

function isSafePattern(pattern) {
  if (/\\[1-9]/.test(pattern)) return false;
  if (/\(\?<[=!]/.test(pattern)) return false;
  if (/\([^)]*[+*][^)]*\)[+*{]/.test(pattern)) return false;
  if (/(?:\.\*|\.\+).*(?:\.\*|\.\+)/.test(pattern)) return false;
  return true;
}
