/**
 * 进阶宏/Macro 引擎
 *
 * 支持的宏：
 *   身份：{{user}} {{char}} {{persona_name}} {{persona_description}} ...
 *   角色属性：{{char_name}} {{char_role}} {{char_description}} {{char_personality}} {{char_scenario}}
 *   随机：{{random:a,b,c}}  {{random:1-100}}
 *   骰子：{{roll:d6}}  {{roll:3d20+5}}  {{roll:d%}}
 *   时间：{{time}} {{date}} {{datetime}} {{timestamp}}
 *   状态：{{message_count}} {{word_count}} {{last_user_message}}
 *   轻前端状态：{{getvar::relationships.shen}} {{globalvar::clues}}
 *   引用：{{get_worldbook:title:落雁夜市}}
 *   数组随机：{{pick:array_name}}
 *   模板：{{template:name}}
 */

import { renderSafeTemplate } from '../compat/lightFrontendRuntime.js';
import { normalizeWorldBookPosition } from './worldBookPosition.js';

import { expandNestedMacros, assertMacroSourceLength } from './nestedMacros.js';

/**
 * 展开 text 中的所有宏
 * @param {string} text
 * @param {Object} context - { user, characterCard, persona, groupMembers, messages, userMessage, worldBook, templates, customArrays }
 * @returns {string}
 */
export function expandMacros(text, context = {}) {
  if (typeof text !== 'string' || !text) return text;
  assertMacroSourceLength(text);
  // Prompt content must not inherit the display renderer's 120k prefix truncation.
  const safelyRendered = renderSafeTemplate(text, context, { unsupported: 'strip', maxSourceLength: text.length });
  return expandNestedMacros(safelyRendered, context, resolveMacro);
}

function resolveMacro(body, context) {
  const lower = body.toLowerCase();
  // Tavern Helper's read-only message-state macro. Missing state stays unknown;
  // never fabricate zero-valued character variables or run the original script.
  if (lower.startsWith('format_message_variable::')) {
    const path = body.slice(body.indexOf('::') + 2).trim();
    const explicit = readStatePath(context.messageVariables, path);
    const value = explicit.found ? serializeMacroValue(explicit.value) : resolveLightFrontendState(path, context);
    if (value === '') return 'null';
    try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
  }

  // —— 身份变量 ——
  if (lower === 'user') return context.user || '用户';
  if (lower === 'char') return context.characterCard?.name || '主角';
  if (lower === 'model') return context.model || '模型';
  if (lower === 'slot') return String(context.slot || '1');
  if (lower === 'scenario') return context.characterCard?.scenario || context.scenario || '';

  // SillyTavern V2 spec: {{original}} 在 system_prompt 中替换为系统默认提示，
  // 在 post_history_instructions 中替换为系统默认 UJB。本系统模块化构建提示，
  // {{original}} 替换为本系统默认提示层文本（若调用方提供）。
  if (lower === 'original') return context.originalSystemPrompt || '';
  if (lower === 'charifnotgroup') {
    const hasGroup = Array.isArray(context.groupMembers)
      && context.groupMembers.some((member) => member?.enabled !== false && String(member?.name || '').trim());
    return hasGroup ? '' : (context.characterCard?.name || '主角');
  }

  if (lower.startsWith('persona_')) {
    const field = body.slice('persona_'.length).toLowerCase();
    const map = {
      name: 'name',
      description: 'description',
      background: 'background',
      personality: 'personality'
    };
    return context.persona?.[map[field]] || '';
  }

  // —— 角色属性 ——
  if (lower.startsWith('char_')) {
    const field = body.slice('char_'.length).toLowerCase();
    const map = {
      name: 'name',
      role: 'role',
      description: 'description',
      personality: 'personality',
      scenario: 'scenario'
    };
    return context.characterCard?.[map[field]] || '';
  }

  // —— SillyTavern prompt manager 占位符（camelCase 与 snake_case 双写别名）——
  // 预设作者在自定义模块中引用 {{charDefinition}} 等占位符时，
  // 将其映射到本系统对应的内容层，而不是依赖酒馆的固定注入顺序。
  if (lower === 'chardefinition' || lower === 'char_description' || lower === 'chardescription') {
    return resolveCharacterTextField(context, 'description');
  }
  if (lower === 'charpersonality' || lower === 'char_personality') {
    return resolveCharacterTextField(context, 'personality');
  }
  if (lower === 'personadescription' || lower === 'persona_description') {
    if (context.persona?.enabled === false) return '';
    return String(context.persona?.description || '').trim();
  }
  if (lower === 'dialogueexamples' || lower === 'dialogue_examples') {
    const dialogs = Array.isArray(context.characterCard?.exampleDialog)
      ? context.characterCard.exampleDialog
      : [];
    if (!dialogs.length) {
      const raw = context.characterCard?.mes_example || context.characterCard?.exampleDialog;
      if (typeof raw === 'string' && raw.trim()) return raw.trim();
      return '';
    }
    return dialogs.map((dialog) => String(dialog || '').trim()).filter(Boolean).join('\n');
  }
  if (lower === 'worldinfobefore' || lower === 'world_info_before') {
    return renderWorldBookSection(context, 'before_character');
  }
  if (lower === 'worldinfoafter' || lower === 'world_info_after') {
    return renderWorldBookSection(context, null);
  }

  // —— 随机（支持 random: 和 random:: 语法） ——
  if (lower.startsWith('random::') || lower.startsWith('random:')) {
    const prefixLen = lower.startsWith('random::') ? 8 : 7;
    return resolveRandom(body.slice(prefixLen));
  }

  // —— 骰子（支持 roll: 和 roll:: 语法） ——
  if (lower.startsWith('roll::') || lower.startsWith('roll:')) {
    const prefixLen = lower.startsWith('roll::') ? 6 : 5;
    return resolveRoll(body.slice(prefixLen));
  }

  // —— 时间 ——
  if (lower === 'time') return new Date().toLocaleTimeString('zh-CN', { hour12: false });
  if (lower === 'date') return new Date().toLocaleDateString('zh-CN');
  if (lower === 'datetime') return new Date().toLocaleString('zh-CN', { hour12: false });
  if (lower === 'timestamp') return String(Math.floor(Date.now() / 1000));

  // —— 状态与历史 ——
  // SillyTavern 的空白裁剪标记不产生可见文本；在本项目中安全降级为空串。
  if (lower === 'trim') return '';
  if (lower === 'message_count') {
    return String((context.messages || []).filter((m) => !m.excluded).length);
  }
  if (lower === 'word_count') {
    const text = (context.messages || []).map((m) => m.content || '').join('');
    return String(text.length);
  }
  if (lower === 'last_user_message' || lower === 'lastusermessage') {
    // The pending turn is passed separately from committed history. Presets
    // must see that turn; a macro in the input itself still refers to history.
    if (typeof context.userMessage === 'string' && context.userMessage.trim()) {
      return expandMacros(context.userMessage, { ...context, userMessage: undefined });
    }
    const userMsgs = (context.messages || []).filter((m) => m.role === 'user' && !m.excluded);
    const last = userMsgs[userMsgs.length - 1];
    return last?.content || '';
  }
  if (lower === 'last_char_message' || lower === 'lastcharmessage' || lower === 'lastmessage') {
    const charMsgs = (context.messages || []).filter((m) => m.role === 'assistant' && !m.excluded);
    const last = charMsgs[charMsgs.length - 1];
    return last?.content || '';
  }

  // —— 安全算术计算 (eval::) ——
  if (lower.startsWith('eval::')) {
    return evaluateSafeMath(body.slice(6), context);
  }

  // —— 逻辑宏 (if::, eq::, gt::, lt::, not::) ——
  if (lower.startsWith('if::')) {
    const parts = body.slice(4).split('::');
    const cond = String(parts[0] || '').trim().toLowerCase();
    const isTrue = cond && cond !== 'false' && cond !== '0' && cond !== 'null' && cond !== 'undefined';
    return isTrue ? String(parts[1] ?? '') : String(parts[2] ?? '');
  }
  if (lower.startsWith('eq::')) {
    const parts = body.slice(4).split('::');
    return String(parts[0] ?? '').trim() === String(parts[1] ?? '').trim() ? 'true' : 'false';
  }
  if (lower.startsWith('gt::')) {
    const parts = body.slice(4).split('::');
    return Number(parts[0] || 0) > Number(parts[1] || 0) ? 'true' : 'false';
  }
  if (lower.startsWith('lt::')) {
    const parts = body.slice(4).split('::');
    return Number(parts[0] || 0) < Number(parts[1] || 0) ? 'true' : 'false';
  }
  if (lower.startsWith('not::')) {
    const val = body.slice(5).trim().toLowerCase();
    const isFalsy = !val || val === 'false' || val === '0' || val === 'null';
    return isFalsy ? 'true' : 'false';
  }

  // —— Prompt 内声明式变量写入 ——
  // 只在调用方显式开启时使用临时作用域；不会执行 JavaScript，也不会持久化到会话。
  if (/^(setvar|addvar|incvar|decvar|setglobalvar)::/i.test(body) && context.allowVariableWrites === true) {
    return applyPromptVariableWrite(body, context);
  }

  // —— 社区轻前端/小白 X 只读变量与属性 ——
  // {{getvar::}} 读会话级（chat）变量；{{globalvar::}}/{{getglobalvar::}} 读跨会话（global）变量
  if (lower.startsWith('getvar::') || lower.startsWith('globalvar::') || lower.startsWith('getglobalvar::')
    || lower.startsWith('stat::') || lower.startsWith('attr::') || lower.startsWith('xiaobai_state::')) {
    const separator = body.indexOf('::');
    const scope = lower.startsWith('globalvar::') || lower.startsWith('getglobalvar::') ? 'global' : 'chat';
    return resolveLightFrontendState(body.slice(separator + 2), context, { scope });
  }

  // 梦境思客等预设通过酒馆助手宏拼接 LoRA/变量片段。这里不执行助手脚本，
  // 仅从本轮声明式变量或轻前端状态读取同名值；未声明时安全降级为空串。
  if (lower.startsWith('压缩相邻消息::')) {
    return resolveLightFrontendState(body.slice(body.indexOf('::') + 2), context);
  }

  // —— 引用世界书 ——
  if (lower.startsWith('get_worldbook:')) {
    return resolveGetWorldbook(body.slice('get_worldbook:'.length), context);
  }

  // —— 自定义数组随机 (支持 pick: 和 pick:: 语法) ——
  if (lower.startsWith('pick::') || lower.startsWith('pick:')) {
    const prefixLen = lower.startsWith('pick::') ? 6 : 5;
    return resolvePick(body.slice(prefixLen), context);
  }

  // —— 模板 ——
  if (lower.startsWith('template:')) {
    return resolveTemplate(body.slice('template:'.length), context);
  }

  return null;
}

function evaluateSafeMath(expr, context) {
  if (typeof expr !== 'string' || !expr.trim()) return '';
  let sanitized = expr.replace(/\bgetvar\s*\(\s*([a-zA-Z0-9_.-]+)\s*\)/g, (_, path) => {
    const val = Number(resolveLightFrontendState(path, context));
    return Number.isFinite(val) ? String(val) : '0';
  });
  sanitized = sanitized.replace(/\b[a-zA-Z_][a-zA-Z0-9_.]*\b/g, (name) => {
    const val = Number(resolveLightFrontendState(name, context));
    return Number.isFinite(val) ? String(val) : '0';
  });
  if (!/^[\d+\-*/%().\s]+$/.test(sanitized)) return '';
  try {
    const result = computeMathTokens(sanitized);
    return Number.isFinite(result) ? String(Math.round(result * 1000) / 1000) : '';
  } catch {
    return '';
  }
}

function computeMathTokens(str) {
  const tokens = str.match(/\d+(?:\.\d+)?|[+\-*/%()]/g) || [];
  let pos = 0;
  function parseExpression() {
    let result = parseTerm();
    while (pos < tokens.length && (tokens[pos] === '+' || tokens[pos] === '-')) {
      const op = tokens[pos++];
      const next = parseTerm();
      result = op === '+' ? result + next : result - next;
    }
    return result;
  }
  function parseTerm() {
    let result = parseFactor();
    while (pos < tokens.length && (tokens[pos] === '*' || tokens[pos] === '/' || tokens[pos] === '%')) {
      const op = tokens[pos++];
      const next = parseFactor();
      if (op === '*') result *= next;
      else if (op === '/') result = next === 0 ? 0 : result / next;
      else if (op === '%') result = next === 0 ? 0 : result % next;
    }
    return result;
  }
  function parseFactor() {
    if (pos >= tokens.length) return 0;
    const token = tokens[pos++];
    if (token === '(') {
      const result = parseExpression();
      if (tokens[pos] === ')') pos++;
      return result;
    }
    if (token === '+') return parseFactor();
    if (token === '-') return -parseFactor();
    const num = Number(token);
    return Number.isFinite(num) ? num : 0;
  }
  return parseExpression();
}

function resolveLightFrontendState(path, context, { scope = 'chat' } = {}) {
  const promptValue = readStatePath(context.promptVariables, path);
  if (promptValue.found) return serializeMacroValue(promptValue.value);
  const globalValue = readStatePath(context.globalVariables, path);
  if (globalValue.found) return serializeMacroValue(globalValue.value);
  const worldStateValue = readStatePath(context.worldState, path);
  if (worldStateValue.found) return serializeMacroValue(worldStateValue.value);
  const source = context.lightFrontendState ?? context.mvu ?? {};
  const values = isPlainObject(source?.values) ? source.values : isPlainObject(source) ? source : {};
  // 双根作用域解析：chat/global 子树存在时按 scope 取；显式路径前缀优先于宏默认作用域
  const scopedValues = resolveScopedValues(values, path, scope);
  const result = readStatePath(scopedValues.root, scopedValues.path);
  return result.found ? serializeMacroValue(result.value) : '';
}

// 双根 values 的作用域解析：显式 chat./global. 前缀 > 宏默认作用域；旧版扁平结构直接透传
function resolveScopedValues(values, path, defaultScope) {
  const raw = String(path || '');
  const prefixMatch = /^(chat|global)[.:](.+)$/i.exec(raw);
  const hasDualRoot = isPlainObject(values.chat) && isPlainObject(values.global);
  if (prefixMatch) {
    const scope = prefixMatch[1].toLowerCase();
    if (hasDualRoot) return { root: values[scope], path: prefixMatch[2] };
    return { root: values, path: prefixMatch[2] };
  }
  if (hasDualRoot) return { root: values[defaultScope] || {}, path: raw };
  return { root: values, path: raw };
}

function applyPromptVariableWrite(body, context) {
  const parts = String(body || '').split('::');
  const operation = String(parts.shift() || '').trim().toLowerCase();
  const path = String(parts.shift() || '').trim();
  const pathParts = normalizeVariablePath(path);
  if (!pathParts.length) return '';
  const variables = isPlainObject(context.promptVariables) ? context.promptVariables : {};
  context.promptVariables = variables;
  const current = readStatePath(variables, path).value;
  const rawValue = parts.join('::').trim();
  let value;
  if (operation === 'setvar' || operation === 'setglobalvar') value = parseMacroLiteral(rawValue);
  else if (operation === 'addvar') value = addMacroValues(current, parseMacroLiteral(rawValue));
  else if (operation === 'incvar') value = Number(current || 0) + 1;
  else value = Number(current || 0) - 1;
  writeStatePath(variables, pathParts, value);
  if (Array.isArray(context.promptVariableAudit) && context.promptVariableAudit.length < 256) {
    context.promptVariableAudit.push({ operation, path: pathParts.join('.') });
  }
  return '';
}

function readStatePath(source, path) {
  if ((!isPlainObject(source) && !Array.isArray(source)) || !path) return { found: false, value: undefined };
  if (isPlainObject(source) && Object.hasOwn(source, path)) {
    return { found: true, value: source[path] };
  }
  const parts = normalizeVariablePath(path);
  if (!parts.length) return { found: false, value: undefined };
  let current = source;
  for (const part of parts) {
    if ((!isPlainObject(current) && !Array.isArray(current)) || !Object.hasOwn(current, part)) {
      return { found: false, value: undefined };
    }
    current = current[part];
  }
  return { found: true, value: current };
}

function writeStatePath(target, parts, value) {
  let current = target;
  parts.forEach((part, index) => {
    if (index === parts.length - 1) {
      current[part] = value;
      return;
    }
    if (!isPlainObject(current[part])) current[part] = {};
    current = current[part];
  });
}

function normalizeVariablePath(path) {
  const parts = String(path || '').replace(/^\//, '').split(/[./]/).map((part) => part.trim()).filter(Boolean);
  if (!parts.length || parts.length > 8) return [];
  if (parts.some((part) => ['__proto__', 'prototype', 'constructor'].includes(part) || !/^[\p{L}\p{N}_-]{1,80}$/u.test(part))) return [];
  return parts;
}

function parseMacroLiteral(value) {
  const raw = String(value ?? '').trim();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  const number = Number(raw);
  if (raw && Number.isFinite(number)) return number;
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  return raw;
}

function addMacroValues(current, incoming) {
  if (typeof current === 'number' && typeof incoming === 'number') return current + incoming;
  if (Array.isArray(current)) return [...current, incoming];
  if (current === undefined || current === null || current === '') return incoming;
  return `${serializeMacroValue(current)}${serializeMacroValue(incoming)}`;
}

function serializeMacroValue(value) {
  if (value === null || value === undefined) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function resolveRandom(arg) {
  const trimmed = String(arg || '').trim();
  if (!trimmed) return '';
  // 双冒号分隔列表：random::a::b::c
  if (trimmed.includes('::')) {
    const items = trimmed.split('::').map((s) => s.trim()).filter(Boolean);
    if (!items.length) return '';
    // 如果是两个数字，当作范围处理
    if (items.length === 2 && Number.isFinite(Number(items[0])) && Number.isFinite(Number(items[1]))) {
      const min = Number(items[0]);
      const max = Number(items[1]);
      return String(Math.floor(Math.random() * (max - min + 1)) + min);
    }
    return items[Math.floor(Math.random() * items.length)];
  }
  // 数字范围：1-100 / 1-6
  const rangeMatch = trimmed.match(/^(-?\d+)\s*-\s*(-?\d+)$/);
  if (rangeMatch) {
    const min = Number(rangeMatch[1]);
    const max = Number(rangeMatch[2]);
    if (max < min) return '';
    return String(Math.floor(Math.random() * (max - min + 1)) + min);
  }
  // 逗号分隔
  const items = trimmed.split(',').map((s) => s.trim()).filter(Boolean);
  if (!items.length) return '';
  return items[Math.floor(Math.random() * items.length)];
}

function resolveRoll(arg) {
  const trimmed = String(arg || '').trim().toLowerCase();
  if (!trimmed) return null;
  // d% = d100
  const normalized = trimmed === 'd%' ? 'd100' : trimmed;
  // 匹配 NdM+K 或 NdM-K 或 dM
  const match = normalized.match(/^(\d*)d(\d+)(?:([+-])(\d+))?$/);
  if (!match) return null;
  const count = match[1] ? Math.max(1, Math.min(100, Number(match[1]))) : 1;
  const sides = Math.max(1, Math.min(1000, Number(match[2])));
  const op = match[3];
  const modifier = match[4] ? Number(match[4]) : 0;

  let total = 0;
  const rolls = [];
  for (let i = 0; i < count; i++) {
    const r = Math.floor(Math.random() * sides) + 1;
    rolls.push(r);
    total += r;
  }
  if (op === '+') total += modifier;
  else if (op === '-') total -= modifier;

  if (count === 1 && !op) return String(total);
  return `${total} (${rolls.join('+')}${op ? ` ${op} ${modifier}` : ''})`;
}

function resolveGetWorldbook(arg, context) {
  // 格式：title:落雁夜市  或  id:abc123
  const parts = String(arg || '').split(':');
  if (parts.length < 2) return '';
  const field = parts[0].trim().toLowerCase();
  const value = parts.slice(1).join(':').trim();
  const cards = Array.isArray(context.worldBook) ? context.worldBook : [];
  const found = cards.find((c) => String(c[field] || '').trim() === value);
  return found?.content || '';
}

function resolvePick(arg, context) {
  const trimmed = String(arg || '').trim();
  if (!trimmed) return '';
  if (trimmed.includes('::')) {
    const items = trimmed.split('::').map((s) => s.trim()).filter(Boolean);
    if (items.length) return items[Math.floor(Math.random() * items.length)];
  }
  if (trimmed.includes(',')) {
    const items = trimmed.split(',').map((s) => s.trim()).filter(Boolean);
    if (items.length) return items[Math.floor(Math.random() * items.length)];
  }
  const arrays = isPlainObject(context.customArrays) ? context.customArrays : {};
  const arr = Array.isArray(arrays[trimmed]) ? arrays[trimmed] : [];
  if (!arr.length) return '';
  return String(arr[Math.floor(Math.random() * arr.length)] || '');
}

function resolveTemplate(arg, context) {
  const name = String(arg || '').trim();
  if (!name) return '';
  const templates = Array.isArray(context.templates) ? context.templates : [];
  const tpl = templates.find((t) => t.name === name);
  if (!tpl) return '';
  // 交由调用方共享递归预算展开，避免重新开始计数和重复执行。
  const source = String(tpl.content || '');
  assertMacroSourceLength(source);
  return renderSafeTemplate(source, context, { unsupported: 'strip', maxSourceLength: source.length });
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// 角色卡文本字段：标准驼峰字段优先，兼容酒馆原生蛇形命名
function resolveCharacterTextField(context, field) {
  const card = context.characterCard || {};
  const value = card[field] ?? card[field === 'description' ? 'description' : 'personality'];
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean).join('\n');
  return '';
}

// 世界书占位符渲染：position=before_character 渲染前置条目，before_eff/after_eff 渲染对应扩展条目，null 渲染其余常驻条目
function renderWorldBookSection(context, position) {
  const cards = Array.isArray(context.worldBook) ? context.worldBook : [];
  const matched = cards.filter((card) => {
    const cardPosition = normalizeWorldBookPosition(card?.position);
    if (position === 'before_character') {
      return cardPosition === 'before_character';
    }
    if (position === 'before_eff') {
      return cardPosition === 'before_eff';
    }
    if (position === 'after_eff') {
      return cardPosition === 'after_eff';
    }
    return cardPosition === 'after_character';
  });
  if (!matched.length) return '';
  return matched
    .map((card) => {
      const title = String(card?.title || '').trim();
      const content = String(card?.content || '').trim();
      if (!content) return '';
      return title ? `## ${title}\n${content}` : content;
    })
    .filter(Boolean)
    .join('\n\n');
}
