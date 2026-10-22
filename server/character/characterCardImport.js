import { inflateSync } from 'node:zlib';
import { normalizeWorldBookPosition } from '../agent/worldBookPosition.js';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// ZIP 本地文件头签名（PK\x03\x04）。CharX 角色卡本质上是包含 card.json 与 assets/ 的 ZIP 包。
const ZIP_LOCAL_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

export function importCharacterCardFromPayload(payload = {}) {
  const rawCard = readCardJson(payload);
  const imported = normalizeImportedCard(rawCard);
  const sourceFileName = String(payload.fileName || '').trim().split(/[\\/]/).at(-1) || '';
  if (sourceFileName) {
    const extensions = isPlainObject(imported.characterCard.extensions)
      ? imported.characterCard.extensions
      : {};
    const localMetadata = isPlainObject(extensions.local_roleplay_agent)
      ? extensions.local_roleplay_agent
      : {};
    imported.characterCard.extensions = {
      ...extensions,
      local_roleplay_agent: {
        ...localMetadata,
        sourceFileName
      }
    };
  }
  return imported;
}

export function extractCharacterCardImage(payload = {}) {
  const bytes = decodePayloadBytes(payload);
  // CharX 压缩包：尝试从 assets/ 提取头像图片（PNG 优先）。
  const charxImage = readCharxPortrait(bytes);
  if (charxImage) return charxImage;
  if (!PNG_SIGNATURE.equals(bytes.subarray(0, PNG_SIGNATURE.length))) return null;

  const dimensions = readPngDimensions(bytes);
  return {
    bytes: stripCharacterCardMetadata(bytes),
    mimeType: 'image/png',
    width: dimensions.width,
    height: dimensions.height
  };
}

function readCardJson(payload) {
  const data = typeof payload.data === 'string' ? payload.data : '';
  const bytes = decodePayloadBytes(payload);
  // CharX 压缩包：优先从 ZIP 中提取 card.json。
  const charxCardJson = readCharxCardJson(bytes);
  if (charxCardJson !== null) return charxCardJson;
  const isPng = String(payload.mimeType || '').includes('png') || PNG_SIGNATURE.equals(bytes.subarray(0, PNG_SIGNATURE.length));
  const text = isPng ? readPngCharacterText(bytes) : bytes.toString('utf8') || data;

  try {
    return JSON.parse(text);
  } catch {
    try {
      const decoded = Buffer.from(text.trim(), 'base64').toString('utf8');
      return JSON.parse(decoded);
    } catch {
      return parseYamlLikeCharacterCard(text);
    }
  }
}

// CharX（Character eXchange）是 SillyTavern/RisuAI 的 ZIP 角色卡格式，
// 包含 card.json（V2/V3 角色卡）、assets/（头像、表情精灵）等资源。
// 本读取器实现最小化的 ZIP 本地文件头解析，仅提取 card.json 与首张 PNG 头像。
function readCharxCardJson(bytes) {
  if (!isZipBytes(bytes)) return null;
  const entries = parseZipEntries(bytes);
  const cardEntry = entries.find((entry) => normalizeZipPath(entry.name) === 'card.json');
  if (!cardEntry) return null;
  const cardText = extractZipEntryData(bytes, cardEntry).toString('utf8');
  try {
    return JSON.parse(cardText);
  } catch {
    return null;
  }
}

function readCharxPortrait(bytes) {
  if (!isZipBytes(bytes)) return null;
  const entries = parseZipEntries(bytes);
  // 头像候选：assets/ 下的 png，文件名含 avatar/portrait/icon 优先。
  const pngCandidates = entries.filter((entry) => {
    const name = normalizeZipPath(entry.name).toLowerCase();
    return name.startsWith('assets/') && name.endsWith('.png');
  });
  if (!pngCandidates.length) return null;
  const ranked = [...pngCandidates].sort((a, b) => {
    const score = (entry) => {
      const name = normalizeZipPath(entry.name).toLowerCase();
      if (name.includes('avatar')) return 0;
      if (name.includes('portrait')) return 1;
      if (name.includes('icon')) return 2;
      return 3;
    };
    return score(a) - score(b);
  });
  const portraitBytes = extractZipEntryData(bytes, ranked[0]);
  const dimensions = readPngDimensions(portraitBytes);
  return {
    bytes: portraitBytes,
    mimeType: 'image/png',
    width: dimensions.width,
    height: dimensions.height
  };
}

function isZipBytes(bytes) {
  return bytes.length > 4 && bytes.subarray(0, 4).equals(ZIP_LOCAL_HEADER);
}

function parseZipEntries(bytes) {
  const entries = [];
  let offset = 0;
  // 仅扫描本地文件头；不解析中央目录。对常规 CharX 足够。
  while (offset + 30 <= bytes.length) {
    if (!bytes.subarray(offset, offset + 4).equals(ZIP_LOCAL_HEADER)) break;
    const compressionMethod = bytes.readUInt16LE(offset + 8);
    const compressedSize = bytes.readUInt32LE(offset + 18);
    const uncompressedSize = bytes.readUInt32LE(offset + 22);
    const fileNameLength = bytes.readUInt16LE(offset + 26);
    const extraFieldLength = bytes.readUInt16LE(offset + 28);
    const dataOffset = offset + 30 + fileNameLength + extraFieldLength;
    const name = bytes.subarray(offset + 30, offset + 30 + fileNameLength).toString('utf8');
    entries.push({
      name,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      dataOffset
    });
    offset = dataOffset + compressedSize;
  }
  return entries;
}

function extractZipEntryData(bytes, entry) {
  const { compressionMethod, compressedSize, uncompressedSize, dataOffset } = entry;
  const compressed = bytes.subarray(dataOffset, dataOffset + compressedSize);
  if (compressionMethod === 0) return Buffer.from(compressed); // stored
  if (compressionMethod === 8) return inflateSync(compressed); // deflate
  // 不支持的压缩方式：返回空，调用方按缺失处理。
  return Buffer.alloc(0);
}

function normalizeZipPath(name) {
  return String(name || '').replace(/\\/g, '/').replace(/^\.?\//, '');
}

function decodePayloadBytes(payload) {
  if (Buffer.isBuffer(payload.data)) return Buffer.from(payload.data);
  if (payload.data instanceof Uint8Array) return Buffer.from(payload.data);
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

function readPngDimensions(buffer) {
  if (buffer.length < 24 || buffer.subarray(12, 16).toString('ascii') !== 'IHDR') {
    return { width: 0, height: 0 };
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

function stripCharacterCardMetadata(buffer) {
  const chunks = [PNG_SIGNATURE];
  let offset = PNG_SIGNATURE.length;
  let hasIend = false;

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > buffer.length) return Buffer.from(buffer);

    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (!isCharacterTextChunk(type, data)) {
      chunks.push(buffer.subarray(offset, end));
    }

    offset = end;
    if (type === 'IEND') {
      hasIend = true;
      break;
    }
  }

  return hasIend ? Buffer.concat(chunks) : Buffer.from(buffer);
}

const PNG_CHARA_KEYWORDS = new Set(['chara', 'ccv3']);

function isCharacterTextChunk(type, data) {
  if (!['tEXt', 'zTXt', 'iTXt'].includes(type)) return false;
  const separator = data.indexOf(0);
  if (separator < 0) return false;
  const encoding = type === 'iTXt' ? 'utf8' : 'latin1';
  return PNG_CHARA_KEYWORDS.has(data.subarray(0, separator).toString(encoding).toLowerCase());
}

function readPngCharacterText(buffer) {
  if (!PNG_SIGNATURE.equals(buffer.subarray(0, PNG_SIGNATURE.length))) {
    throw new Error('INVALID_PNG');
  }

  let offset = PNG_SIGNATURE.length;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    const text = readPngTextChunk(type, data);
    if (text && PNG_CHARA_KEYWORDS.has(text.keyword.toLowerCase())) return text.value;
    offset += 12 + length;
  }

  throw new Error('MISSING_CHARA_METADATA');
}

function readPngTextChunk(type, data) {
  if (type === 'tEXt') {
    const separator = data.indexOf(0);
    if (separator < 0) return null;
    return {
      keyword: data.subarray(0, separator).toString('latin1'),
      value: data.subarray(separator + 1).toString('latin1')
    };
  }

  if (type === 'zTXt') {
    const separator = data.indexOf(0);
    if (separator < 0) return null;
    return {
      keyword: data.subarray(0, separator).toString('latin1'),
      value: inflateSync(data.subarray(separator + 2)).toString('latin1')
    };
  }

  if (type === 'iTXt') return readInternationalTextChunk(data);
  return null;
}

function readInternationalTextChunk(data) {
  const parts = [];
  let start = 0;
  for (let index = 0; index < data.length && parts.length < 5; index += 1) {
    if (data[index] === 0) {
      parts.push(data.subarray(start, index));
      start = index + 1;
    }
  }
  if (parts.length < 5) return null;

  const keyword = parts[0].toString('utf8');
  const compressionFlag = parts[1][0] || 0;
  const textBytes = data.subarray(start);
  return {
    keyword,
    value: compressionFlag ? inflateSync(textBytes).toString('utf8') : textBytes.toString('utf8')
  };
}

function normalizeImportedCard(rawCard) {
  const sourceSpec = stringValue(rawCard?.spec) || 'tavern_card_v1';
  const usesDataEnvelope = sourceSpec === 'yaml-character-card' || /^chara_card_v\d+$/i.test(sourceSpec);
  const data = usesDataEnvelope && isPlainObject(rawCard?.data) ? rawCard.data : rawCard || {};
  const baseExtensions = isPlainObject(data.extensions) ? data.extensions : {};
  // 保留世界书书级元数据（token_budget/recursive_scanning/scan_depth）。
  // SillyTavern V2 规范：character_book.token_budget 限制世界书注入的总 token，
  // 若不在导入时保留，后续裁剪逻辑无法读到卡片作者声明的预算。
  const worldBookMeta = extractCharacterBookMeta(data.character_book);
  const localMetadata = worldBookMeta
    ? { ...(isPlainObject(baseExtensions.local_roleplay_agent) ? baseExtensions.local_roleplay_agent : {}), worldBook: worldBookMeta }
    : (isPlainObject(baseExtensions.local_roleplay_agent) ? baseExtensions.local_roleplay_agent : {});
  const characterCard = {
    name: stringValue(data.name),
    nickname: stringValue(data.nickname),
    role: stringValue(data.role),
    description: stringValue(data.description),
    personality: stringValue(data.personality),
    scenario: stringValue(data.scenario),
    firstMessage: stringValue(data.first_mes || data.firstMessage),
    exampleDialog: normalizeExampleDialog(data.mes_example || data.exampleDialog),
    creatorNotes: stringValue(data.creator_notes),
    creatorNotesMultilingual: normalizeStringRecord(data.creator_notes_multilingual),
    systemPrompt: stringValue(data.system_prompt),
    postHistoryInstructions: stringValue(data.post_history_instructions),
    alternateGreetings: normalizeStringArray(data.alternate_greetings),
    groupOnlyGreetings: normalizeStringArray(data.group_only_greetings),
    tags: normalizeStringArray(data.tags),
    creator: stringValue(data.creator),
    characterVersion: stringValue(data.character_version),
    source: normalizeStringArray(data.source),
    assets: normalizeAssets(data.assets),
    creationDate: normalizeTimestamp(data.creation_date),
    modificationDate: normalizeTimestamp(data.modification_date),
    extensions: { ...baseExtensions, local_roleplay_agent: localMetadata },
    sourceSpec,
    raw: rawCard,
    enabled: true
  };

  return {
    characterCard,
    worldBook: normalizeCharacterBook(data.character_book, sourceSpec)
  };
}

function extractCharacterBookMeta(book) {
  if (!isPlainObject(book)) return null;
  const extensions = isPlainObject(book.extensions) ? book.extensions : {};
  const tokenBudgetRaw = Number(book.token_budget ?? extensions.token_budget);
  const tokenBudget = Number.isFinite(tokenBudgetRaw) && tokenBudgetRaw > 0 ? Math.floor(tokenBudgetRaw) : null;
  const recursiveScanning = book.recursive_scanning === true || extensions.recursive_scanning === true;
  const scanDepthRaw = Number(book.scan_depth ?? extensions.scan_depth);
  const scanDepth = Number.isFinite(scanDepthRaw) && scanDepthRaw >= 0 ? Math.floor(scanDepthRaw) : null;
  if (tokenBudget === null && !recursiveScanning && scanDepth === null) return null;
  const meta = {};
  if (tokenBudget !== null) meta.tokenBudget = tokenBudget;
  if (recursiveScanning) meta.recursiveScanning = true;
  if (scanDepth !== null) meta.scanDepth = scanDepth;
  return meta;
}

function parseYamlLikeCharacterCard(text) {
  const normalized = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!/^\s*character\s*[:：]/im.test(normalized)) {
    throw new Error('UNSUPPORTED_CHARACTER_CARD_PAYLOAD');
  }

  const name = extractScalar(normalized, ['name', '姓名']);
  if (!name) throw new Error('UNSUPPORTED_CHARACTER_CARD_PAYLOAD');

  const identity = extractNamedBlock(normalized, ['identity', '身份', '身份层'], [
    'psychology',
    '心理',
    '心理层',
    'behavior',
    '行为',
    '行为层',
    'relationships',
    'relations',
    '关系',
    '关系层',
    'speech',
    'language',
    '语言',
    '语言层',
    'anti_ooc',
    'meta',
    '元控制'
  ]);
  const psychology = extractNamedBlock(normalized, ['psychology', '心理', '心理层'], [
    'behavior',
    '行为',
    '行为层',
    'relationships',
    'relations',
    '关系',
    '关系层',
    'speech',
    'language',
    '语言',
    '语言层',
    'anti_ooc',
    'meta',
    '元控制'
  ]);
  const behavior = extractNamedBlock(normalized, ['behavior', '行为', '行为层'], [
    'relationships',
    'relations',
    '关系',
    '关系层',
    'speech',
    'language',
    '语言',
    '语言层',
    'anti_ooc',
    'meta',
    '元控制'
  ]);
  const relationships = extractNamedBlock(normalized, ['relationships', 'relations', '关系', '关系层'], [
    'speech',
    'language',
    '语言',
    '语言层',
    'anti_ooc',
    'meta',
    '元控制'
  ]);
  const speech = extractNamedBlock(normalized, ['speech', 'language', '语言', '语言层'], [
    'anti_ooc',
    'meta',
    '元控制'
  ]);
  const meta = extractNamedBlock(normalized, ['anti_ooc', 'meta', '元控制'], []);
  const firstMessage = extractScalar(normalized, ['first_message', 'first_mes', 'firstMessage', '开场白']);
  const scenario = extractNamedBlock(normalized, ['scenario', '场景', '背景'], [
    'speech',
    'language',
    '语言',
    '语言层',
    'anti_ooc',
    'meta',
    '元控制'
  ]);

  return {
    spec: 'yaml-character-card',
    data: {
      name,
      description: identity || normalized,
      personality: [psychology, behavior].filter(Boolean).join('\n\n'),
      scenario: scenario || relationships,
      first_mes: firstMessage,
      system_prompt: meta,
      post_history_instructions: extractNamedBlock(normalized, ['unknown_handling', '未知情况处理'], []),
      alternate_greetings: [],
      tags: parseTagList(extractScalar(normalized, ['tags', '标签'])),
      creator_notes: 'Imported from YAML-like roleplay character text.',
      extensions: {
        import_format: 'yaml-like',
        speech
      },
      raw_yaml: normalized
    }
  };
}

function normalizeCharacterBook(book, sourceSpec = 'chara_card_v2') {
  if (!book || !Array.isArray(book.entries)) return [];
  const bookExtensions = isPlainObject(book.extensions) ? book.extensions : {};
  const fallbackDepth = normalizePositiveNumber(book.scan_depth ?? bookExtensions.scan_depth, 4);
  return book.entries
    .filter((entry) => entry && entry.enabled !== false && entry.disable !== true && stringValue(entry.content))
    .map((entry, index) => normalizeCharacterBookEntry(entry, index, fallbackDepth, sourceSpec));
}

function normalizeCharacterBookEntry(entry, index, fallbackDepth, sourceSpec) {
  const extensions = isPlainObject(entry.extensions) ? entry.extensions : {};
  const primaryTerms = normalizeStringArray(entry.keys ?? entry.key);
  const secondaryKeywords = normalizeStringArray(entry.secondary_keys ?? entry.keysecondary);
  const usesRegex = entry.use_regex === true || entry.useRegex === true;
  const usesSecondary = entry.selective === true && secondaryKeywords.length > 0;

  return {
    id: `character-book-${entry.id ?? index}-${slugify(entry.name || entry.comment || primaryTerms[0] || 'entry')}`,
    type: 'character-book',
    title: stringValue(entry.name || entry.comment || primaryTerms[0] || `角色书条目 ${index + 1}`),
    keywords: usesRegex ? [] : primaryTerms,
    secondaryKeywords,
    secondaryMatchMode: usesRegex ? 'regex' : 'keyword',
    matchMode: usesSecondary ? 'selective' : usesRegex ? 'regex' : 'keyword',
    regex: usesRegex ? primaryTerms : [],
    content: stringValue(entry.content),
    priority: normalizePositiveNumber(entry.priority ?? extensions.priority, 80),
    depth: normalizePositiveNumber(entry.depth ?? extensions.depth, fallbackDepth),
    insertionOrder: normalizePositiveNumber(entry.insertion_order ?? extensions.display_index, index),
    logic: usesSecondary
      ? normalizeSelectiveLogic(entry.selectiveLogic ?? entry.selective_logic)
      : 'any',
    constant: entry.constant === true,
    caseSensitive: entry.case_sensitive === true || entry.caseSensitive === true || extensions.case_sensitive === true,
    position: normalizeCharacterBookPosition(entry.position ?? extensions.position),
    enabled: true,
    source: sourceSpec === 'chara_card_v3' ? 'character-card-v3' : 'character-card-v2',
    extensions,
    updatedAt: new Date().toISOString()
  };
}

function normalizeSelectiveLogic(value) {
  return ['and_any', 'not_all', 'not_any', 'and_all'][Number(value)] || 'and_any';
}

function normalizeCharacterBookPosition(position) {
  return normalizeWorldBookPosition(position);
}

function normalizeExampleDialog(value) {
  if (Array.isArray(value)) return normalizeStringArray(value);
  const text = stringValue(value);
  return text ? [text] : [];
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) return value.map((item) => stringValue(item)).filter(Boolean);
  const text = stringValue(value);
  return text ? [text] : [];
}

function normalizeStringRecord(value) {
  if (!isPlainObject(value)) return {};
  const result = {};
  for (const [key, val] of Object.entries(value)) {
    const text = stringValue(val);
    if (text) result[String(key)] = text;
  }
  return result;
}

// V3 spec assets 数组：{ type, name, ext, uri }。
// uri 白名单：仅 http(s) 外链与同源相对路径；data:/javascript:/file: 等危险协议在导入层拒绝，
// 展示层（cardAssets.js）二次校验并统一走 proxy-image 代理。
const MAX_CARD_ASSETS = 50;

function isSafeAssetUri(uri) {
  if (/^(https?:)?\/\//i.test(uri)) return true; // http(s) 外链
  if (uri.startsWith('/')) return !uri.startsWith('//'); // 同源绝对路径（排除协议相对 //）
  return /^[a-z][a-z0-9+.-]*:/i.test(uri) === false; // 无协议的相对路径
}

function normalizeAssets(value) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_CARD_ASSETS)
    .map((item) => {
      if (!isPlainObject(item)) return null;
      const uri = stringValue(item.uri);
      const name = stringValue(item.name);
      if (!uri || !name || !isSafeAssetUri(uri)) return null;
      return {
        type: stringValue(item.type) || 'unknown',
        name,
        ext: stringValue(item.ext) || '',
        uri
      };
    })
    .filter(Boolean);
}

function normalizeTimestamp(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.floor(num);
}

function extractScalar(text, keys) {
  for (const key of keys) {
    const escaped = escapeRegExp(key);
    const match = text.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*[:：]\\s*(.+)`, 'i'));
    if (match) return cleanScalar(match[1]);
  }
  return '';
}

function extractNamedBlock(text, startKeys, stopKeys) {
  const lines = String(text || '').split('\n');
  const collected = [];
  let active = false;

  for (const line of lines) {
    const startValue = matchKeyLine(line, startKeys);
    if (!active && startValue !== null) {
      active = true;
      if (startValue) collected.push(startValue);
      continue;
    }

    if (!active) continue;
    if (matchKeyLine(line, stopKeys) !== null) break;
    collected.push(line);
  }

  return collected.join('\n').trim();
}

function matchKeyLine(line, keys) {
  const text = String(line || '').trim();
  for (const key of keys) {
    const escaped = escapeRegExp(key);
    const match = text.match(new RegExp(`^${escaped}\\s*[:：]\\s*(.*)$`, 'i'));
    if (match) return match[1].trim();
  }
  return null;
}

function parseTagList(value) {
  const text = stringValue(value);
  if (!text) return [];
  return text
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
