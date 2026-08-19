import { extractCharacterCardImage, importCharacterCardFromPayload } from './characterCardImport.js';
import { importSillyTavernPreset } from './presetImport.js';
import { importSillyTavernRegexPreset } from './regexPresetImport.js';
import { importWorldBookFromPayload } from './worldBookImport.js';
import { CONTENT_PACK_SPEC, isContentPackBundle } from '../content/contentPackManifest.js';
import { PLUGIN_SPEC } from '../plugins/pluginManifest.js';

export function previewImportPayload(payload = {}) {
  const structured = tryReadStructuredDocument(payload);
  const structuredPayload = normalizeStructuredPayload(payload, structured);
  if (isContentPackBundle(structured)) return buildContentPackPreview(structured);
  if (isPluginManifestDocument(structured)) return buildPluginManifestPreview(structured);

  const promptPreset = importSillyTavernPreset(structured, { fileName: payload.fileName });
  if (promptPreset) return buildPromptPresetPreview(promptPreset);

  const regexPreset = importSillyTavernRegexPreset(structured, { fileName: payload.fileName });
  if (regexPreset) return buildRegexPresetPreview(regexPreset);

  if (hasStandaloneWorldBookSignal(structured)) {
    const standaloneWorldBook = importWorldBookFromPayload(structuredPayload);
    if (standaloneWorldBook.length) return buildWorldBookPreview(standaloneWorldBook);
  }

  const characterImport = tryImportCharacterCard(structuredPayload);
  if (characterImport && hasCharacterCardSignal(characterImport)) {
    return buildCharacterCardPreview(characterImport, structuredPayload);
  }

  const worldBook = importWorldBookFromPayload(structuredPayload);
  if (!worldBook.length) throw new Error('UNSUPPORTED_IMPORT_PAYLOAD');
  return buildWorldBookPreview(worldBook);
}

function buildPromptPresetPreview(preset) {
  return {
    kind: 'prompt-preset',
    title: preset.title,
    summary: {
      sourceFormat: preset.sourceFormat,
      promptModuleCount: preset.counts.modules,
      enabledPromptCount: preset.counts.enabled,
      placeholderCount: preset.counts.placeholders,
      regexScriptCount: preset.counts.regexScripts,
      safeRegexScriptCount: preset.counts.safeRegexScripts,
      degradedRegexScriptCount: preset.counts.degradedRegexScripts,
      sandboxedRegexScriptCount: preset.counts.sandboxedRegexScripts,
      blockedRegexScriptCount: preset.counts.blockedRegexScripts,
      truncatedRegexScriptCount: preset.counts.truncatedRegexScripts,
      runtimeCompanionCount: preset.counts.runtimeCompanions,
      tavernHelperScriptCount: preset.counts.tavernHelperScripts,
      generationSettings: preset.generationSettings,
      hasExecutableExtensions: preset.counts.tavernHelperScripts > 0
    },
    importData: {
      promptModules: preset.promptModules,
      promptPreset: {
        title: preset.title,
        sourceFormat: preset.sourceFormat,
        generationSettings: preset.generationSettings,
        promptLayout: preset.promptLayout,
        dependencySignals: preset.dependencySignals
      }
    }
  };
}

function buildRegexPresetPreview(preset) {
  return {
    kind: 'regex-preset',
    title: preset.title,
    summary: {
      sourceFormat: preset.sourceFormat,
      regexScriptCount: preset.counts.total,
      enabledRegexScriptCount: preset.counts.enabled,
      safeRegexScriptCount: preset.counts.safe,
      degradedRegexScriptCount: preset.counts.degraded,
      sandboxedRegexScriptCount: preset.counts.sandboxed,
      blockedRegexScriptCount: preset.counts.blocked,
      truncatedRegexScriptCount: preset.counts.truncated,
      runtimeCompanionCount: 1,
      hasExecutableExtensions: preset.counts.sandboxed > 0 || preset.counts.blocked > 0
    },
    importData: {
      promptModules: [preset.runtimeCompanion],
      promptPreset: {
        title: preset.title,
        sourceFormat: preset.sourceFormat,
        regexCompatibility: preset.compatibility
      }
    }
  };
}

function buildContentPackPreview(bundle) {
  const manifest = bundle.manifest || {};
  const content = bundle.content || {};
  return {
    kind: 'content-pack',
    title: manifest.title || manifest.name || manifest.id || '未命名内容包',
    summary: {
      packId: manifest.id || '',
      version: manifest.version || '',
      engine: manifest.engine || '',
      worldBookCount: Array.isArray(content.worldBook) ? content.worldBook.length : 0,
      promptModuleCount: Array.isArray(content.promptModules) ? content.promptModules.length : 0,
      dependencyCount: Array.isArray(manifest.dependencies) ? manifest.dependencies.length : 0,
      characterName: content.characterCard?.name || '',
      willReplaceCharacterCard: false
    },
    importData: { contentPackBundle: structuredClone(bundle) }
  };
}

function buildPluginManifestPreview(document) {
  const manifest = document.manifest || document;
  return {
    kind: 'plugin-manifest',
    title: manifest.name || manifest.title || manifest.id || '未命名插件',
    summary: {
      pluginId: manifest.id || '',
      version: manifest.version || '',
      engine: manifest.engine || '',
      adapterCount: Array.isArray(manifest.adapters) ? manifest.adapters.length : 0,
      dependencyCount: Array.isArray(manifest.dependencies) ? manifest.dependencies.length : 0
    },
    importData: { pluginManifest: structuredClone(manifest) }
  };
}

function tryImportCharacterCard(payload) {
  try {
    return importCharacterCardFromPayload(payload);
  } catch {
    return null;
  }
}

function hasCharacterCardSignal(imported) {
  const card = imported?.characterCard || {};
  return Boolean(
    card.sourceSpec === 'chara_card_v2'
    || card.sourceSpec === 'chara_card_v3'
    || card.name
    || card.description
    || card.personality
    || card.scenario
    || card.firstMessage
    || card.systemPrompt
    || (Array.isArray(card.assets) && card.assets.length > 0)
  );
}

function hasStandaloneWorldBookSignal(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) return false;
  const entries = document.entries;
  const hasEntries = Array.isArray(entries)
    ? entries.length > 0
    : Boolean(entries && typeof entries === 'object');
  if (!hasEntries) return false;

  const characterSignals = [
    document.description,
    document.personality,
    document.scenario,
    document.first_mes,
    document.firstMessage,
    document.system_prompt,
    document.systemPrompt,
    document.data?.description,
    document.data?.personality,
    document.data?.scenario,
    document.data?.first_mes,
    document.data?.firstMessage,
    document.data?.system_prompt,
    document.data?.systemPrompt,
    document.data?.post_history_instructions
  ];
  return !characterSignals.some((value) => String(value || '').trim());
}

function buildCharacterCardPreview(importData, payload) {
  const card = importData.characterCard || {};
  const worldBook = Array.isArray(importData.worldBook) ? importData.worldBook : [];
  const portrait = extractCharacterCardImage(payload);
  const declaredContentPacks = collectDeclaredContentPacks(card);
  return {
    kind: 'character-card',
    summary: {
      characterName: card.name || '未命名角色',
      firstMessage: card.firstMessage || '',
      tags: Array.isArray(card.tags) ? card.tags : [],
      worldBookCount: worldBook.length,
      keywordSamples: collectKeywordSamples(worldBook),
      hasEmbeddedPortrait: Boolean(portrait),
      portraitWidth: portrait?.width || 0,
      portraitHeight: portrait?.height || 0,
      declaredContentPacks,
      declaredGenre: collectDeclaredGenre(card),
      spec: String(card.sourceSpec || ''),
      assetCount: Array.isArray(card.assets) ? card.assets.length : 0,
      selfContained: Boolean(worldBook.length && (card.systemPrompt || card.postHistoryInstructions || card.scenario)),
      willReplaceCharacterCard: true,
      worldBookMode: 'append-dedupe'
    },
    importData
  };
}

function buildWorldBookPreview(worldBook) {
  return {
    kind: 'world-book',
    summary: {
      worldBookCount: worldBook.length,
      titles: worldBook.slice(0, 8).map((entry) => entry.title),
      keywordSamples: collectKeywordSamples(worldBook),
      worldBookMode: 'append-dedupe'
    },
    importData: {
      characterCard: null,
      worldBook
    }
  };
}

function collectKeywordSamples(worldBook) {
  const samples = [];
  for (const entry of worldBook) {
    for (const keyword of entry.keywords || []) {
      if (keyword && !samples.includes(keyword)) samples.push(keyword);
      if (samples.length >= 8) return samples;
    }
  }
  return samples;
}

function collectDeclaredContentPacks(card = {}) {
  const extensions = card.extensions && typeof card.extensions === 'object' && !Array.isArray(card.extensions)
    ? card.extensions
    : {};
  return uniqueStrings([
    extensions.contentPack,
    extensions.content_pack,
    extensions.contentPackId,
    card.raw?.metadata?.contentPack,
    card.raw?.metadata?.content_pack
  ]);
}

function collectDeclaredGenre(card = {}) {
  const extensions = card.extensions && typeof card.extensions === 'object' && !Array.isArray(card.extensions)
    ? card.extensions
    : {};
  return uniqueStrings([
    extensions.genre,
    extensions.category,
    card.raw?.metadata?.genre,
    ...(Array.isArray(card.tags) ? card.tags : [])
  ]).join(' · ');
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function isPluginManifestDocument(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return String(value.spec || value.schema || value.manifest?.spec || '').trim() === PLUGIN_SPEC;
}

function tryReadStructuredDocument(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  if (String(payload.spec || payload.schema || payload.manifest?.spec || '').trim() === CONTENT_PACK_SPEC) return payload;
  if (String(payload.spec || payload.schema || payload.manifest?.spec || '').trim() === PLUGIN_SPEC) return payload;
  if (String(payload.mimeType || '').toLowerCase().includes('png')) return null;
  const decodedBinary = decodeStructuredPayloadBytes(payload.data);
  if (decodedBinary === null && isStructuredJsonValue(payload.data)) return payload.data;
  const raw = String(decodedBinary ?? payload.data ?? '').trim();
  if (!raw) return null;
  let text = raw;
  if (raw.startsWith('data:')) {
    const [, encoded = ''] = raw.split(',', 2);
    text = Buffer.from(encoded, 'base64').toString('utf8');
  } else if (payload.encoding === 'base64') {
    text = Buffer.from(raw, 'base64').toString('utf8');
  }
  try {
    return JSON.parse(text);
  } catch {
    try {
      return JSON.parse(Buffer.from(text, 'base64').toString('utf8'));
    } catch {
      return null;
    }
  }
}

function normalizeStructuredPayload(payload, structured) {
  if (structured === null || structured === undefined) return payload;
  return {
    ...payload,
    data: JSON.stringify(structured),
    encoding: 'utf8'
  };
}

function decodeStructuredPayloadBytes(data) {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (isSerializedBuffer(data)) return Buffer.from(data.data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8');
  }
  return null;
}

function isSerializedBuffer(value) {
  return value
    && value.type === 'Buffer'
    && Array.isArray(value.data)
    && value.data.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255);
}

function isStructuredJsonValue(value) {
  if (Array.isArray(value)) return true;
  if (!value || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
