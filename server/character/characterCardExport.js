import { deflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = crc32(Buffer.concat([typeBuffer, data]));
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc, 0);
  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

function createTextChunk(keyword, value) {
  const data = Buffer.concat([
    Buffer.from(keyword, 'latin1'),
    Buffer.from([0]),
    Buffer.from(value, 'latin1')
  ]);
  return createChunk('tEXt', data);
}

function createPlaceholderPng(width, height, [r, g, b]) {
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 2;
  const ihdr = createChunk('IHDR', ihdrData);

  const rowSize = 1 + width * 3;
  const rawData = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y += 1) {
    const offset = y * rowSize;
    rawData[offset] = 0;
    for (let x = 0; x < width; x += 1) {
      const px = offset + 1 + x * 3;
      rawData[px] = r;
      rawData[px + 1] = g;
      rawData[px + 2] = b;
    }
  }
  const idat = createChunk('IDAT', deflateSync(rawData));
  const iend = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([PNG_SIGNATURE, ihdr, idat, iend]);
}

export function exportCharacterCardPng(characterCard, worldBook = [], basePng = null, {
  coreMemory = null,
  foreshadowing = [],
  forceV3 = false
} = {}) {
  const shouldExportV3 = forceV3 || String(characterCard?.sourceSpec || '').toLowerCase() === 'chara_card_v3';
  const exportedCard = shouldExportV3
    ? exportCharacterCardToV3(characterCard, { worldBook, coreMemory, foreshadowing })
    : toV2CharacterCard(characterCard, worldBook);
  const json = JSON.stringify(exportedCard);
  const base64 = Buffer.from(json, 'utf8').toString('base64');

  const png = normalizeBasePng(basePng) || createPlaceholderPng(256, 256, [45, 42, 58]);
  const keyword = String(exportedCard?.spec || '').toLowerCase() === 'chara_card_v3' ? 'ccv3' : 'chara';
  const textChunk = createTextChunk(keyword, base64);
  return replaceCharacterMetadata(png, textChunk);
}

export function exportCharacterCardToV3(card = {}, {
  worldBook = [],
  coreMemory = null,
  foreshadowing = []
} = {}) {
  const safeCard = card && typeof card === 'object' ? card : {};
  const v3Data = {
    name: String(safeCard.name || '未命名角色').trim(),
    description: String(safeCard.description || '').trim(),
    personality: String(safeCard.personality || '').trim(),
    scenario: String(safeCard.scenario || '').trim(),
    first_mes: String(safeCard.firstMessage || '').trim(),
    mes_example: Array.isArray(safeCard.exampleDialog)
      ? safeCard.exampleDialog.join('\n')
      : String(safeCard.exampleDialog || '').trim(),
    creator_notes: String(safeCard.creatorNotes || '').trim(),
    system_prompt: String(safeCard.systemPrompt || '').trim(),
    post_history_instructions: String(safeCard.postHistoryInstructions || '').trim(),
    alternate_greetings: Array.isArray(safeCard.alternateGreetings) ? safeCard.alternateGreetings : [],
    tags: Array.isArray(safeCard.tags) ? safeCard.tags : [],
    creator: String(safeCard.creator || '').trim(),
    character_version: String(safeCard.characterVersion || '1.0.0').trim(),
    extensions: {
      ...(safeCard.extensions || {}),
      local_roleplay_agent: {
        ...(safeCard.extensions?.local_roleplay_agent || {}),
        coreMemory: coreMemory || undefined,
        foreshadowing: Array.isArray(foreshadowing) && foreshadowing.length ? foreshadowing : undefined
      }
    }
  };

  if (Array.isArray(worldBook) && worldBook.length) {
    v3Data.character_book = {
      name: `${v3Data.name}的世界书`,
      entries: worldBook.map((entry, index) => ({
        id: entry.id ?? index,
        keys: Array.isArray(entry.keys)
          ? entry.keys
          : (Array.isArray(entry.keywords) ? entry.keywords : (entry.keys ? [entry.keys] : [])),
        secondary_keys: Array.isArray(entry.secondaryKeys) ? entry.secondaryKeys : [],
        content: String(entry.content || '').trim(),
        comment: String(entry.comment || entry.title || '').trim(),
        constant: Boolean(entry.constant),
        selectiveLogic: Number(entry.selectiveLogic ?? 0),
        order: Number(entry.order ?? 100),
        position: entry.position ?? 1,
        enabled: entry.enabled !== false
      }))
    };
  }

  return {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: v3Data
  };
}

function normalizeBasePng(value) {
  if (!value) return null;
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  if (!PNG_SIGNATURE.equals(buffer.subarray(0, PNG_SIGNATURE.length))) return null;
  return buffer;
}

function replaceCharacterMetadata(png, textChunk) {
  const chunks = [];
  let offset = PNG_SIGNATURE.length;
  let inserted = false;
  let hasHeader = false;

  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > png.length) return replaceCharacterMetadata(createPlaceholderPng(256, 256, [45, 42, 58]), textChunk);
    const type = png.subarray(offset + 4, offset + 8).toString('ascii');
    const data = png.subarray(offset + 8, offset + 8 + length);
    const chunk = png.subarray(offset, end);
    if (type === 'IHDR') hasHeader = true;
    if (!isCharacterTextChunk(type, data)) chunks.push(chunk);
    if (type === 'IHDR' && !inserted) {
      chunks.push(textChunk);
      inserted = true;
    }
    offset = end;
    if (type === 'IEND') break;
  }

  if (!hasHeader || !inserted) {
    return replaceCharacterMetadata(createPlaceholderPng(256, 256, [45, 42, 58]), textChunk);
  }
  return Buffer.concat([PNG_SIGNATURE, ...chunks]);
}

const CHARA_KEYWORDS = new Set(['chara', 'ccv3']);

function isCharacterTextChunk(type, data) {
  if (!['tEXt', 'zTXt', 'iTXt'].includes(type)) return false;
  const separator = data.indexOf(0);
  if (separator < 0) return false;
  return CHARA_KEYWORDS.has(data.subarray(0, separator).toString(type === 'iTXt' ? 'utf8' : 'latin1').toLowerCase());
}

function toV2CharacterCard(characterCard, worldBook = []) {
  const card = characterCard || {};
  const isV3 = String(card.sourceSpec || '').toLowerCase() === 'chara_card_v3';
  const data = {
    name: card.name || '',
    description: card.description || '',
    personality: card.personality || '',
    scenario: card.scenario || '',
    first_mes: card.firstMessage || '',
    mes_example: Array.isArray(card.exampleDialog) ? card.exampleDialog.join('\n') : '',
    creator_notes: card.creatorNotes || '',
    system_prompt: card.systemPrompt || '',
    post_history_instructions: card.postHistoryInstructions || '',
    alternate_greetings: Array.isArray(card.alternateGreetings) ? card.alternateGreetings : [],
    tags: Array.isArray(card.tags) ? card.tags : [],
    creator: card.creator || '',
    character_version: card.characterVersion || '1.0',
    extensions: card.extensions || {},
    character_book: toV2CharacterBook(worldBook)
  };
  if (isV3) {
    Object.assign(data, {
      nickname: card.nickname || '',
      group_only_greetings: Array.isArray(card.groupOnlyGreetings) ? card.groupOnlyGreetings : [],
      creator_notes_multilingual: isPlainObject(card.creatorNotesMultilingual) ? card.creatorNotesMultilingual : {},
      source: Array.isArray(card.source) ? card.source : [],
      assets: Array.isArray(card.assets) ? card.assets : [],
      creation_date: Number.isFinite(Number(card.creationDate)) ? Math.floor(Number(card.creationDate)) : undefined,
      modification_date: Number.isFinite(Number(card.modificationDate)) ? Math.floor(Number(card.modificationDate)) : undefined
    });
    return { spec: 'chara_card_v3', spec_version: '3.0', data };
  }
  return { spec: 'chara_card_v2', spec_version: '2.0', data };
}

function toV2CharacterBook(worldBook) {
  if (!Array.isArray(worldBook) || !worldBook.length) return undefined;
  return {
    entries: worldBook.map((entry, index) => ({
      id: index,
      name: entry.title || '',
      comment: entry.title || '',
      keys: Array.isArray(entry.keywords) ? entry.keywords : [],
      secondary_keys: Array.isArray(entry.secondaryKeywords) ? entry.secondaryKeywords : [],
      content: entry.content || '',
      priority: entry.priority ?? 80,
      scan_depth: entry.depth ?? 4,
      insertion_order: entry.insertionOrder ?? index,
      selective: entry.matchMode === 'selective'
        || ['and_any', 'not_all', 'not_any', 'and_all', 'selective'].includes(String(entry.logic || '')),
      selectiveLogic: toSelectiveLogicNumber(entry.logic),
      constant: entry.constant === true,
      case_sensitive: entry.caseSensitive === true,
      position: entry.position || 'after_character',
      enabled: entry.enabled !== false,
      extensions: entry.extensions || {}
    }))
  };
}

function toSelectiveLogicNumber(logic) {
  const normalized = String(logic || '').toLowerCase().replace(/[\s-]+/g, '_');
  const index = ['and_any', 'not_all', 'not_any', 'and_all'].indexOf(normalized);
  return index >= 0 ? index : 0;
}
