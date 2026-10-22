import {
  normalizeWorldBookTagRegistry,
  resolveWorldBookCharacterFilter
} from './worldBookTagRegistry.js';
import { normalizeWorldBookPosition } from '../agent/worldBookPosition.js';

export function importWorldBookFromPayload(payload = {}) {
  const rawBook = readJsonPayload(payload);
  return normalizeWorldBook(rawBook);
}

export function normalizeWorldBook(rawBook = {}) {
  const entries = readWorldBookEntries(rawBook);
  const fallbackScanDepth = normalizePositiveNumber(rawBook.scan_depth, 4);
  const tagRegistry = normalizeWorldBookTagRegistry(rawBook);
  return entries
    .filter((entry) => entry && entry.enabled !== false && entry.disable !== true && stringValue(entry.content))
    .map((entry, index) => normalizeWorldBookEntry(entry, index, fallbackScanDepth, tagRegistry));
}

function readWorldBookEntries(rawBook) {
  if (Array.isArray(rawBook)) return rawBook;
  if (Array.isArray(rawBook?.entries)) return rawBook.entries;
  if (rawBook?.entries && typeof rawBook.entries === 'object') return Object.values(rawBook.entries);
  return [];
}

function normalizeWorldBookEntry(entry, index, fallbackScanDepth, tagRegistry) {
  const keywords = normalizeStringArray(entry.keys ?? entry.key);
  const secondaryKeywords = normalizeStringArray(entry.secondary_keys ?? entry.keysecondary);
  const title = stringValue(entry.name || entry.comment || keywords[0] || `世界书条目 ${index + 1}`);
  const extensions = normalizeWorldBookExtensions(entry, fallbackScanDepth);
  const entryTagRegistry = [
    ...tagRegistry,
    ...(Array.isArray(extensions.character_filter_tag_registry)
      ? extensions.character_filter_tag_registry
      : [])
  ];
  const characterFilterResolution = resolveWorldBookCharacterFilter(
    extensions.character_filter,
    { tagRegistry: entryTagRegistry }
  );
  const characterFilter = characterFilterResolution.filter;
  if (characterFilter) extensions.character_filter = characterFilter;
  if (characterFilterResolution.mappings.length) {
    extensions.character_filter_tag_registry = characterFilterResolution.mappings;
  }
  const triggers = normalizeStringArray(extensions.triggers);

  return {
    id: `worldbook-${entry.uid ?? entry.id ?? index}-${slugify(title)}`,
    type: stringValue(entry.type || 'world-book'),
    title,
    keywords,
    secondaryKeywords,
    matchMode: normalizeMatchMode(entry),
    regex: normalizeStringArray(entry.regex ?? entry.regexes ?? entry.patterns),
    logic: normalizeLogic(entry),
    content: stringValue(entry.content),
    priority: normalizePositiveNumber(entry.priority ?? entry.order, 50),
    depth: normalizePositiveNumber(entry.extensions?.depth ?? entry.depth, 4),
    insertionOrder: normalizePositiveNumber(entry.insertion_order ?? entry.order, index),
    constant: entry.constant === true,
    caseSensitive: normalizeOptionalBoolean(
      entry.caseSensitive ?? entry.case_sensitive ?? extensions.case_sensitive
    ),
    matchWholeWords: normalizeOptionalBoolean(
      entry.matchWholeWords ?? entry.match_whole_words ?? extensions.match_whole_words
    ),
    characterFilter,
    triggers,
    position: normalizePosition(entry.position),
    scope: stringValue(entry.scope || 'prompt'),
    enabled: true,
    source: stringValue(entry.source || 'sillytavern-worldbook'),
    extensions,
    updatedAt: new Date().toISOString()
  };
}

function normalizeWorldBookExtensions(entry, fallbackScanDepth) {
  const extensions = isPlainObject(entry.extensions) ? { ...entry.extensions } : {};
  const aliases = {
    scan_depth: [entry.scan_depth],
    probability: [entry.probability],
    useProbability: [entry.useProbability, entry.use_probability],
    group: [entry.group],
    group_override: [entry.groupOverride, entry.group_override],
    group_weight: [entry.groupWeight, entry.group_weight],
    use_group_scoring: [entry.useGroupScoring, entry.use_group_scoring],
    sticky: [entry.sticky],
    cooldown: [entry.cooldown],
    delay: [entry.delay],
    exclude_recursion: [entry.excludeRecursion, entry.exclude_recursion],
    prevent_recursion: [entry.preventRecursion, entry.prevent_recursion],
    delay_until_recursion: [entry.delayUntilRecursion, entry.delay_until_recursion],
    case_sensitive: [entry.caseSensitive, entry.case_sensitive],
    match_whole_words: [entry.matchWholeWords, entry.match_whole_words],
    character_filter: [entry.characterFilter, entry.character_filter],
    triggers: [entry.triggers],
    match_persona_description: [entry.matchPersonaDescription, entry.match_persona_description],
    match_character_description: [entry.matchCharacterDescription, entry.match_character_description],
    match_character_personality: [entry.matchCharacterPersonality, entry.match_character_personality],
    match_character_depth_prompt: [entry.matchCharacterDepthPrompt, entry.match_character_depth_prompt],
    match_scenario: [entry.matchScenario, entry.match_scenario],
    match_creator_notes: [entry.matchCreatorNotes, entry.match_creator_notes]
  };
  Object.entries(aliases).forEach(([key, values]) => {
    if (extensions[key] !== undefined) return;
    const value = values.find((item) => item !== undefined && item !== null);
    if (value !== undefined) extensions[key] = value;
  });
  if (extensions.scan_depth === undefined) {
    extensions.scan_depth = fallbackScanDepth;
    extensions.scan_depth_inherited = true;
  }
  return extensions;
}

function normalizeOptionalBoolean(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string') return value.trim().toLowerCase() === 'true';
  return Boolean(value);
}

function normalizeMatchMode(entry) {
  const mode = stringValue(entry.matchMode || entry.match_mode);
  if (mode) return mode;
  if (entry.selective === true) return 'selective';
  return normalizeStringArray(entry.regex ?? entry.regexes ?? entry.patterns).length ? 'regex' : 'keyword';
}

function normalizeLogic(entry) {
  if (entry.logic) return normalizeLogicValue(entry.logic);
  if (entry.selective === true) return normalizeSelectiveLogic(entry.selectiveLogic ?? entry.selective_logic);
  return 'any';
}

function normalizeSelectiveLogic(value) {
  return ['and_any', 'not_all', 'not_any', 'and_all'][Number(value)] || 'and_any';
}

function normalizeLogicValue(value) {
  const normalized = stringValue(value).toLowerCase().replace(/[\s-]+/g, '_');
  const aliases = {
    selective: 'and_any',
    andany: 'and_any',
    notall: 'not_all',
    notany: 'not_any',
    andall: 'and_all'
  };
  return aliases[normalized] || normalized || 'any';
}

function normalizePosition(position) {
  return normalizeWorldBookPosition(position);
}

function readJsonPayload(payload) {
  const text = decodePayloadBytes(payload).toString('utf8') || String(payload.data || '');
  try {
    return JSON.parse(text);
  } catch {
    try {
      const decoded = Buffer.from(text.trim(), 'base64').toString('utf8');
      return JSON.parse(decoded);
    } catch {
      const parsedEntries = parseTextWorldBook(text);
      if (parsedEntries.length) return parsedEntries;
      throw new Error('UNSUPPORTED_WORLD_BOOK_PAYLOAD');
    }
  }
}

function decodePayloadBytes(payload) {
  const data = String(payload.data || '');
  if (data.startsWith('data:')) {
    const [, base64 = ''] = data.split(',', 2);
    return Buffer.from(base64, 'base64');
  }
  if (payload.encoding === 'base64' || looksLikeBase64(data)) {
    return Buffer.from(data, 'base64');
  }
  return Buffer.from(data, 'utf8');
}

function looksLikeBase64(value) {
  const text = String(value || '').trim();
  return text.length > 32 && /^[A-Za-z0-9+/=\r\n]+$/.test(text);
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) return value.map((item) => stringValue(item)).filter(Boolean);
  const text = stringValue(value);
  return text ? [text] : [];
}

function parseTextWorldBook(text) {
  const normalized = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const explicitEntries = parseExplicitTextEntries(normalized);
  if (explicitEntries.length) return explicitEntries;

  return parseYamlIdBlocks(normalized);
}

function parseExplicitTextEntries(text) {
  const entries = [];
  let current = null;
  let collectingContent = false;

  for (const line of text.split('\n')) {
    const title = matchLineValue(line, /^(?:条目名|条目|entry\s*name)\s*[:：]\s*(.+)$/i);
    if (title) {
      pushExplicitTextEntry(entries, current);
      current = { name: cleanScalar(title), key: [], content: '', source: 'text-worldbook' };
      collectingContent = false;
      continue;
    }

    if (!current) continue;

    const keywords = matchLineValue(line, /^(?:触发词|关键词|keys?|keywords?)\s*[:：]\s*(.+)$/i);
    if (keywords) {
      current.key = splitKeywords(keywords);
      collectingContent = false;
      continue;
    }

    const content = matchLineValue(line, /^(?:内容|content)\s*[:：]\s*(.*)$/i);
    if (content !== null) {
      current.content = content ? `${current.content}${current.content ? '\n' : ''}${content}` : current.content;
      collectingContent = true;
      continue;
    }

    if (collectingContent) {
      current.content = `${current.content}${current.content ? '\n' : ''}${line}`;
    }
  }

  pushExplicitTextEntry(entries, current);
  return entries;
}

function pushExplicitTextEntry(entries, entry) {
  if (!entry || !stringValue(entry.name) || !stringValue(entry.content)) return;
  const keywords = entry.key.length ? entry.key : [entry.name];
  entries.push({
    ...entry,
    key: keywords,
    content: entry.content.trim()
  });
}

function parseYamlIdBlocks(text) {
  const lines = text.split('\n');
  const startIndexes = [];
  lines.forEach((line, index) => {
    if (/^\s*-\s*id\s*[:：]/i.test(line)) startIndexes.push(index);
  });

  return startIndexes.map((startIndex, index) => {
    const endIndex = startIndexes[index + 1] ?? lines.length;
    const block = lines.slice(startIndex, endIndex).join('\n').trim();
    const id = extractYamlScalar(block, ['id']);
    const title = extractYamlScalar(block, ['名称', '系统名', 'name', 'title', '标题']) || id || `世界书条目 ${index + 1}`;
    const aliases = extractYamlScalar(block, ['触发词', '关键词', 'aliases', 'keys', 'keywords']);
    const keywords = uniqueStrings([title, id, ...splitKeywords(aliases)]);
    return {
      uid: id || index,
      name: title,
      key: keywords,
      content: block,
      source: 'yaml-worldbook',
      enabled: true
    };
  }).filter((entry) => stringValue(entry.content));
}

function extractYamlScalar(text, keys) {
  for (const key of keys) {
    const escaped = escapeRegExp(key);
    const match = text.match(new RegExp(`(?:^|\\n)\\s*(?:-\\s*)?${escaped}\\s*[:：]\\s*(.+)`, 'i'));
    if (match) return cleanScalar(match[1]);
  }
  return '';
}

function matchLineValue(line, pattern) {
  const match = String(line || '').match(pattern);
  return match ? match[1].trim() : null;
}

function splitKeywords(value) {
  return String(value || '')
    .replace(/^\[|\]$/g, '')
    .split(/[,，、;；/|]/)
    .map(cleanScalar)
    .filter(Boolean);
}

function cleanScalar(value) {
  return String(value || '')
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .trim();
}

function uniqueStrings(values) {
  const result = [];
  values.map(stringValue).filter(Boolean).forEach((value) => {
    if (!result.includes(value)) result.push(value);
  });
  return result;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizePositiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function stringValue(value) {
  return String(value ?? '').trim();
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function slugify(value) {
  return String(value || 'entry')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/gi, '-')
    .replace(/^-+|-+$/g, '') || 'entry';
}
