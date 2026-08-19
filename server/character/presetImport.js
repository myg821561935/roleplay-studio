import {
  collectSillyTavernRegexRules,
  createSillyTavernRegexCompanion,
  importSillyTavernRegexPreset
} from './regexPresetImport.js';

const PLACEHOLDER_IDS = new Set([
  'worldInfoBefore',
  'personaDescription',
  'charDescription',
  'charPersonality',
  'scenario',
  'worldInfoAfter',
  'dialogueExamples',
  'chatHistory',
  'enhanceDefinitions'
]);

const PROMPT_ID_ALIASES = {
  world_info_before: 'worldInfoBefore',
  persona_description: 'personaDescription',
  char_description: 'charDescription',
  char_personality: 'charPersonality',
  world_info_after: 'worldInfoAfter',
  dialogue_examples: 'dialogueExamples',
  chat_history: 'chatHistory',
  enhance_definitions: 'enhanceDefinitions'
};

const PRESET_SIGNAL_KEYS = new Set([
  'max_context',
  'max_completion_tokens',
  'should_stream',
  'openai_max_context',
  'openai_max_tokens',
  'stream_openai',
  'prompt_order',
  'chat_completion_source'
]);

export function importSillyTavernPreset(document, { fileName = '' } = {}) {
  if (!isPlainObject(document) || !Array.isArray(document.prompts) || !hasPresetSignal(document)) {
    return null;
  }

  const sourceFormat = isTavernHelperPreset(document)
    ? 'tavern-helper-preset'
    : 'sillytavern-preset';
  const title = resolvePresetTitle(document, fileName);
  const promptOrder = resolvePromptOrder(document.prompt_order);
  const orderById = new Map(promptOrder.map((item, index) => [
    normalizePromptId(item.identifier || item.id),
    { ...item, index }
  ]));
  const prompts = document.prompts
    .map((prompt, index) => normalizePresetPrompt(prompt, index, orderById))
    .sort(comparePresetPrompts);
  const dependencySignals = summarizeExtensionSignals(document);
  const generationSettings = normalizeGenerationSettings(document);
  const regexRules = collectSillyTavernRegexRules(document);
  const regexPreset = regexRules.length
    ? importSillyTavernRegexPreset(regexRules, { fileName: title })
    : null;
  const promptLayout = prompts.map((prompt) => ({
    id: prompt.id,
    name: prompt.name,
    enabled: prompt.enabled,
    placeholder: prompt.placeholder,
    role: prompt.role,
    position: prompt.position,
    depth: prompt.depth,
    order: prompt.order
  }));
  const promptModules = prompts
    .filter((prompt) => !prompt.placeholder && prompt.content.trim())
    .map((prompt, index) => ({
      id: `st-preset-${safeId(prompt.id || String(index + 1))}`,
      title: prompt.name || prompt.id || `预设模块 ${index + 1}`,
      enabled: prompt.enabled,
      content: prompt.content,
      role: prompt.role,
      position: prompt.position,
      depth: prompt.depth,
      order: prompt.order,
      source: sourceFormat,
      extensions: {
        sillyTavernPreset: {
          presetTitle: title,
          sourceFormat,
          promptId: prompt.id,
          originalIndex: prompt.originalIndex,
          sequence: index
        }
      }
    }));
  const runtimeCompanion = createSillyTavernRegexCompanion(regexRules, {
    title,
    sourceFormat
  });
  if (runtimeCompanion) promptModules.push(runtimeCompanion);

  return {
    title,
    sourceFormat,
    promptModules,
    promptLayout,
    generationSettings,
    dependencySignals,
    regexCompatibility: regexPreset?.compatibility || null,
    // 占位符模块的注入语义已由宏引擎承接（{{charDefinition}} 等），
    // 此处透出清单供审计与前端展示，标记为「已映射」而非「被丢弃」。
    placeholderMapping: {
      supported: ['charDefinition', 'charDescription', 'charPersonality', 'personaDescription',
        'dialogueExamples', 'worldInfoBefore', 'worldInfoAfter'],
      resolved: prompts
        .filter((prompt) => prompt.placeholder)
        .map((prompt) => ({ id: prompt.id, enabled: prompt.enabled }))
    },
    counts: {
      prompts: prompts.length,
      enabled: prompts.filter((prompt) => prompt.enabled).length,
      modules: promptModules.length - (runtimeCompanion ? 1 : 0),
      runtimeCompanions: runtimeCompanion ? 1 : 0,
      placeholders: prompts.filter((prompt) => prompt.placeholder).length,
      regexScripts: dependencySignals.regex_scripts?.count || 0,
      safeRegexScripts: regexPreset?.counts.safe || 0,
      degradedRegexScripts: regexPreset?.counts.degraded || 0,
      sandboxedRegexScripts: regexPreset?.counts.sandboxed || 0,
      blockedRegexScripts: regexPreset?.counts.blocked || 0,
      truncatedRegexScripts: regexPreset?.counts.truncated || 0,
      tavernHelperScripts: dependencySignals.tavern_helper?.scriptCount || 0
    }
  };
}

function hasPresetSignal(document) {
  if (Object.keys(document).some((key) => PRESET_SIGNAL_KEYS.has(key))) return true;
  if (isPlainObject(document.settings) && Object.keys(document.settings).some((key) => PRESET_SIGNAL_KEYS.has(key))) {
    return true;
  }
  return document.prompts.some((prompt) => isPlainObject(prompt) && (
    'identifier' in prompt
    || 'injection_position' in prompt
    || isPlainObject(prompt.position)
  ));
}

function isTavernHelperPreset(document) {
  return isPlainObject(document.settings)
    && document.prompts.some((prompt) => isPlainObject(prompt) && isPlainObject(prompt.position));
}

function resolvePresetTitle(document, fileName) {
  const fromFile = String(fileName || '').replace(/\.(?:json|ya?ml)$/i, '').trim();
  return String(
    document.name
    || document.preset_name
    || document.title
    || fromFile
    || '导入的酒馆预设'
  ).trim().slice(0, 120);
}

function resolvePromptOrder(value) {
  if (!Array.isArray(value) || !value.length) return [];
  if (value.every((item) => isPlainObject(item) && ('identifier' in item || 'id' in item))) {
    return value;
  }
  const profile = value.find((item) => isPlainObject(item) && Array.isArray(item.order));
  return profile?.order || [];
}

function normalizePresetPrompt(prompt, originalIndex, orderById) {
  const source = isPlainObject(prompt) ? prompt : {};
  const id = normalizePromptId(source.identifier || source.id || `prompt-${originalIndex + 1}`);
  const ordered = orderById.get(id);
  const position = normalizePromptPosition(source);
  return {
    id,
    name: String(source.name || source.title || id || `预设模块 ${originalIndex + 1}`).trim(),
    enabled: ordered ? ordered.enabled !== false : source.enabled !== false,
    content: String(source.content ?? source.prompt ?? source.system_prompt ?? ''),
    role: normalizePromptRole(source.role),
    position: position.type,
    depth: position.depth,
    order: position.order,
    placeholder: PLACEHOLDER_IDS.has(id),
    originalIndex,
    sequence: ordered?.index ?? originalIndex
  };
}

function normalizePromptId(value) {
  const id = String(value || '').trim();
  return PROMPT_ID_ALIASES[id] || id;
}

function normalizePromptRole(value) {
  if (typeof value === 'number') return ['system', 'user', 'assistant'][value] || 'system';
  const role = String(value || 'system').trim().toLowerCase();
  return ['system', 'user', 'assistant'].includes(role) ? role : 'system';
}

function normalizePromptPosition(prompt) {
  const source = isPlainObject(prompt.position) ? prompt.position : {};
  const rawType = source.type ?? prompt.injection_position ?? prompt.position;
  const type = rawType === 1 || String(rawType || '').toLowerCase() === 'in_chat'
    ? 'in_chat'
    : 'relative';
  return {
    type,
    depth: finiteNumber(source.depth ?? prompt.injection_depth, type === 'in_chat' ? 4 : 0),
    order: finiteNumber(source.order ?? prompt.injection_order, 0)
  };
}

function comparePresetPrompts(left, right) {
  if (left.sequence !== right.sequence) return left.sequence - right.sequence;
  if (left.order !== right.order) return left.order - right.order;
  return left.originalIndex - right.originalIndex;
}

function normalizeGenerationSettings(document) {
  const settings = isPlainObject(document.settings) ? document.settings : {};
  const value = (normalizedKey, ...nativeKeys) => {
    if (settings[normalizedKey] !== undefined) return settings[normalizedKey];
    for (const key of nativeKeys) {
      if (document[key] !== undefined) return document[key];
    }
    return undefined;
  };
  return compactObject({
    maxContext: finiteOptional(value('max_context', 'openai_max_context')),
    maxCompletionTokens: finiteOptional(value('max_completion_tokens', 'openai_max_tokens')),
    replyCount: finiteOptional(value('reply_count', 'n')),
    stream: booleanOptional(value('should_stream', 'stream_openai')),
    temperature: finiteOptional(value('temperature', 'temperature', 'temp_openai')),
    frequencyPenalty: finiteOptional(value('frequency_penalty', 'frequency_penalty')),
    presencePenalty: finiteOptional(value('presence_penalty', 'presence_penalty')),
    topP: finiteOptional(value('top_p', 'top_p')),
    repetitionPenalty: finiteOptional(value('repetition_penalty', 'repetition_penalty')),
    minP: finiteOptional(value('min_p', 'min_p')),
    topK: finiteOptional(value('top_k', 'top_k')),
    topA: finiteOptional(value('top_a', 'top_a')),
    seed: finiteOptional(value('seed', 'seed')),
    squashSystemMessages: booleanOptional(value('squash_system_messages', 'squash_system_messages')),
    reasoningEffort: stringOptional(value('reasoning_effort', 'reasoning_effort')),
    requestThoughts: booleanOptional(value('request_thoughts', 'show_thoughts')),
    requestImages: booleanOptional(value('request_images', 'request_images')),
    enableFunctionCalling: booleanOptional(value('enable_function_calling', 'function_calling')),
    enableWebSearch: booleanOptional(value('enable_web_search', 'enable_web_search'))
  });
}

function summarizeExtensionSignals(document) {
  const extensions = isPlainObject(document.extensions) ? document.extensions : {};
  const regexScripts = firstArray(
    extensions.regex_scripts,
    extensions.regexScripts,
    document.regex_scripts,
    document.regexScripts
  );
  const tavernHelper = firstObject(
    extensions.tavern_helper,
    extensions.tavernHelper,
    extensions.TavernHelper,
    document.tavern_helper
  );
  const scripts = Array.isArray(tavernHelper?.scripts) ? tavernHelper.scripts : [];
  const variables = firstObject(tavernHelper?.variables, tavernHelper?.variales) || {};
  return compactObject({
    prompt_order: {
      count: resolvePromptOrder(document.prompt_order).length || document.prompts.length,
      source: Array.isArray(document.prompt_order) ? 'explicit' : 'document-order'
    },
    regex_scripts: regexScripts.length ? { count: regexScripts.length } : undefined,
    tavern_helper: scripts.length || Object.keys(variables).length
      ? { scriptCount: scripts.length, variableCount: Object.keys(variables).length, execution: 'disabled' }
      : undefined
  });
}

function firstArray(...values) {
  return values.find(Array.isArray) || [];
}

function firstObject(...values) {
  return values.find(isPlainObject);
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function finiteOptional(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function booleanOptional(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'string') return !['false', '0', 'off', 'no'].includes(value.trim().toLowerCase());
  return Boolean(value);
}

function stringOptional(value) {
  const text = String(value ?? '').trim();
  return text || undefined;
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function safeId(value) {
  return String(value || 'prompt')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'prompt';
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
