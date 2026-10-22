import crypto from 'node:crypto';
import { defaultCharacterCard, defaultPersona, defaultPromptModules, defaultProviders, defaultQuickReplies, defaultWorldBook } from './defaults.js';
import { dedupeWorldBookEntries } from '../agent/factCards.js';

const CONFIG_CACHE_TTL_MS = 200;

export class ConfigService {
  constructor(store) {
    this.store = store;
    this._cache = null;
    this._cacheExpiresAt = 0;
  }

  _invalidateCache() {
    this._cache = null;
    this._cacheExpiresAt = 0;
  }

  async getAll() {
    if (this._cache && Date.now() < this._cacheExpiresAt) return this._cache;
    const providers = await this.store.read('config/providers.local.json', defaultProviders);
    const promptModules = await this.store.read('config/prompt-modules.json', defaultPromptModules);
    const worldBook = await this.store.read('config/world-book.json', defaultWorldBook);
    const characterCard = await this.store.read('config/character-card.json', defaultCharacterCard);
    const persona = await this.store.read('config/persona.json', defaultPersona);
    const quickReplies = await this.store.read('config/quick-replies.json', defaultQuickReplies);
    const characterPresets = await this.store.read('config/character-presets.json', []);
    const promptPresets = await this.store.read('config/prompt-presets.json', []);
    const groupMembers = await this.store.read('config/group-members.json', []);
    const macroTemplates = await this.store.read('config/macro-templates.json', []);
    const vectorMemory = await this.store.read('config/vector-memory.json', { enabled: false, providerId: '', topK: 5 });
    const mcpServers = await this.store.read('config/mcp-servers.json', []);
    this._cache = { providers, promptModules, worldBook, characterCard, persona, quickReplies, characterPresets, promptPresets, groupMembers, macroTemplates, vectorMemory, mcpServers };
    this._cacheExpiresAt = Date.now() + CONFIG_CACHE_TTL_MS;
    return this._cache;
  }

  async saveMacroTemplates(macroTemplates) {
    const normalized = (Array.isArray(macroTemplates) ? macroTemplates : [])
      .filter((t) => isPlainObject(t) && String(t.name || '').trim() && String(t.content || '').trim())
      .map((t) => ({
        name: String(t.name).trim().slice(0, 30),
        content: String(t.content),
        description: String(t.description || '').trim(),
        createdAt: t.createdAt || new Date().toISOString()
      }));
    const result = await this.store.write('config/macro-templates.json', normalized);
    this._invalidateCache();
    return result;
  }

  async saveVectorMemory(vectorMemory) {
    const source = isPlainObject(vectorMemory) ? vectorMemory : {};
    const result = await this.store.write('config/vector-memory.json', normalizeVectorMemory(source));
    this._invalidateCache();
    return result;
  }

  async saveMcpServers(mcpServers) {
    const source = Array.isArray(mcpServers) ? mcpServers : [];
    const normalized = source
      .filter((s) => isPlainObject(s) && String(s.id || '').trim())
      .map((s) => normalizeMcpServer(s));
    const result = await this.store.write('config/mcp-servers.json', normalized);
    this._invalidateCache();
    return result;
  }

  async saveGroupMembers(groupMembers) {
    const normalized = (Array.isArray(groupMembers) ? groupMembers : [])
      .filter((m) => isPlainObject(m) && String(m.name || '').trim())
      .map(normalizeGroupMember);
    const result = await this.store.write('config/group-members.json', normalized);
    this._invalidateCache();
    return result;
  }

  async savePromptPresets(promptPresets) {
    const normalized = (Array.isArray(promptPresets) ? promptPresets : [])
      .filter((p) => isPlainObject(p) && Array.isArray(p.promptModules))
      .map((p) => ({
        id: String(p.id || `prompt-preset-${Date.now()}`),
        name: String(p.name || '未命名预设').trim().slice(0, 30),
        promptModules: p.promptModules.map(normalizePromptModule),
        createdAt: p.createdAt || new Date().toISOString()
      }));
    const result = await this.store.write('config/prompt-presets.json', normalized);
    this._invalidateCache();
    return result;
  }

  async saveCharacterPresets(presets) {
    const normalized = (Array.isArray(presets) ? presets : [])
      .filter((p) => isPlainObject(p) && p.characterCard)
      .map((p) => ({
        id: String(p.id || `preset-${Date.now()}`),
        name: String(p.name || p.characterCard?.name || '未命名').trim().slice(0, 30),
        characterCard: p.characterCard,
        worldBook: Array.isArray(p.worldBook) ? p.worldBook : [],
        promptModules: Array.isArray(p.promptModules) ? p.promptModules : [],
        createdAt: p.createdAt || new Date().toISOString()
      }));
    const result = await this.store.write('config/character-presets.json', normalized);
    this._invalidateCache();
    return result;
  }

  async saveProviders(providers) {
    const result = await this.store.write('config/providers.local.json', normalizeProviders(providers));
    this._invalidateCache();
    return result;
  }

  async savePromptModules(promptModules) {
    const result = await this.store.write('config/prompt-modules.json', promptModules.map(normalizePromptModule));
    this._invalidateCache();
    return result;
  }

  async saveWorldBook(worldBook) {
    const result = await this.store.write('config/world-book.json', worldBook.map(normalizeWorldBookEntry));
    this._invalidateCache();
    return result;
  }

  async saveCharacterCard(characterCard) {
    const result = await this.store.write('config/character-card.json', normalizeCharacterCard(characterCard));
    this._invalidateCache();
    return result;
  }

  async savePersona(persona) {
    const result = await this.store.write('config/persona.json', normalizePersona(persona));
    this._invalidateCache();
    return result;
  }

  async saveQuickReplies(quickReplies) {
    const result = await this.store.write('config/quick-replies.json', normalizeQuickReplies(quickReplies));
    this._invalidateCache();
    return result;
  }

  async importCharacterCard({ characterCard, worldBook = [] }) {
    const currentWorldBook = await this.store.read('config/world-book.json', defaultWorldBook);
    const savedCharacterCard = await this.saveCharacterCard(characterCard);
    const importedEntries = worldBook.map(normalizeWorldBookEntry);
    const nextImportedEntries = dedupeWorldBookEntries(currentWorldBook, importedEntries);
    const nextWorldBook = await this.saveWorldBook([...currentWorldBook, ...nextImportedEntries]);
    return { characterCard: savedCharacterCard, worldBook: nextWorldBook, importedWorldBookCount: nextImportedEntries.length };
  }

  async importWorldBook(worldBook = []) {
    const currentWorldBook = await this.store.read('config/world-book.json', defaultWorldBook);
    const importedEntries = worldBook.map(normalizeWorldBookEntry);
    const nextImportedEntries = dedupeWorldBookEntries(currentWorldBook, importedEntries);
    const nextWorldBook = await this.saveWorldBook([...currentWorldBook, ...nextImportedEntries]);
    return { worldBook: nextWorldBook, importedWorldBookCount: nextImportedEntries.length };
  }
}

function normalizeOptionalSampling(provider) {
  const result = {};
  for (const [key, min, max] of [['topP', 0, 1], ['frequencyPenalty', -2, 2], ['presencePenalty', -2, 2], ['seed', Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]]) {
    if (provider[key] === undefined || provider[key] === null || provider[key] === '') continue;
    const value = Number(provider[key]);
    if (!Number.isFinite(value) || value < min || value > max || (key === 'seed' && !Number.isSafeInteger(value))) throw new Error(`Invalid provider ${key}`);
    result[key] = value;
  }
  return result;
}

function normalizeProviders(value) {
  const source = isPlainObject(value) ? value : {};
  return {
    activeProviderId: String(source.activeProviderId || ''),
    taskProviders: {
      chat: String(source.taskProviders?.chat || ''),
      rewrite: String(source.taskProviders?.rewrite || ''),
      fact: String(source.taskProviders?.fact || ''),
      summary: String(source.taskProviders?.summary || '')
    },
    taskFallbackChains: normalizeTaskFallbackChains(source.taskFallbackChains),
    fallbackChain: Array.isArray(source.fallbackChain) ? source.fallbackChain.map((id) => String(id || '')).filter(Boolean) : [],
    providers: Array.isArray(source.providers) ? source.providers.map((provider) => ({
      id: String(provider.id || ''),
      kind: normalizeProviderKind(provider.kind),
      preset: String(provider.preset || ''),
      baseUrl: String(provider.baseUrl || ''),
      apiKey: String(provider.apiKey || ''),
      model: String(provider.model || ''),
      ttsModel: String(provider.ttsModel || ''),
      sttModel: String(provider.sttModel || ''),
      temperature: normalizeFiniteNumber(provider.temperature, 0.9),
      ...normalizeOptionalSampling(provider),
      maxTokens: normalizePositiveFiniteNumber(provider.maxTokens, 2000),
      reasoningMode: normalizeReasoningMode(provider.reasoningMode),
      headers: isPlainObject(provider.headers) ? provider.headers : {}
    })) : []
  };
}

function normalizeTaskFallbackChains(value) {
  const source = isPlainObject(value) ? value : {};
  return Object.fromEntries(['chat', 'rewrite', 'fact', 'summary'].map((taskKey) => [
    taskKey,
    Array.isArray(source[taskKey])
      ? source[taskKey].map((id) => String(id || '')).filter(Boolean)
      : []
  ]));
}

function normalizeProviderKind(kind) {
  const value = String(kind || 'openai-compatible').toLowerCase();
  return ['openai-compatible', 'anthropic', 'gemini'].includes(value) ? value : 'openai-compatible';
}

function normalizeReasoningMode(value) {
  const mode = String(value || 'auto').trim().toLowerCase();
  return ['auto', 'enabled', 'disabled'].includes(mode) ? mode : 'auto';
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

const GROUP_MEMBER_COMPATIBILITY_FIELDS = [
  'talkativeness',
  'speechStyle',
  'exampleDialog',
  'knowledge',
  'goals',
  'relationships',
  'relationship',
  'location',
  'status',
  'publicKnowledge',
  'privateKnowledge',
  'schedule',
  'agenda',
  'extensions'
];

function normalizeGroupMember(member) {
  const normalized = {
    id: String(member.id || `member-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`),
    name: String(member.name).trim().slice(0, 30),
    role: String(member.role || '').trim().slice(0, 60),
    description: String(member.description || '').trim(),
    personality: String(member.personality || '').trim(),
    systemPrompt: String(member.systemPrompt || '').trim(),
    enabled: member.enabled !== false
  };

  for (const field of GROUP_MEMBER_COMPATIBILITY_FIELDS) {
    if (!Object.hasOwn(member, field)) continue;
    const value = normalizeJsonMetadata(member[field]);
    if (value !== undefined) normalized[field] = value;
  }
  // 话唠度：clamp 到 (0, 1]，非法值丢弃（选择器侧默认 0.5）
  const talkativeness = Number(normalized.talkativeness);
  if (Number.isFinite(talkativeness) && talkativeness > 0 && talkativeness <= 1) {
    normalized.talkativeness = talkativeness;
  } else {
    delete normalized.talkativeness;
  }
  return normalized;
}

function normalizeJsonMetadata(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    return value
      .map(normalizeJsonMetadata)
      .filter((item) => item !== undefined);
  }
  if (!isPlainObject(value)) return undefined;

  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['__proto__', 'constructor', 'prototype'].includes(key))
    .map(([key, item]) => [key, normalizeJsonMetadata(item)])
    .filter(([, item]) => item !== undefined));
}

export function normalizePersona(value) {
  const persona = isPlainObject(value) ? value : {};
  return {
    name: String(persona.name || '').trim(),
    description: String(persona.description || '').trim(),
    background: String(persona.background || '').trim(),
    personality: String(persona.personality || '').trim(),
    enabled: persona.enabled === true
  };
}

function normalizeVectorMemory(value) {
  const source = isPlainObject(value) ? value : {};
  const topK = normalizeFiniteNumber(source.topK, 5);
  return {
    enabled: source.enabled === true,
    providerId: String(source.providerId || '').trim(),
    topK: Math.min(20, Math.max(1, topK))
  };
}

function normalizeMcpServer(server) {
  const id = String(server.id || '').trim();
  const name = String(server.name || id).trim().slice(0, 60);
  const transport = ['stdio', 'sse', 'http'].includes(String(server.transport || '')) ? server.transport : 'stdio';
  return {
    id,
    name,
    transport,
    command: String(server.command || '').trim(),
    args: Array.isArray(server.args) ? server.args.map(String) : [],
    env: isPlainObject(server.env) ? server.env : {},
    url: String(server.url || '').trim(),
    enabled: server.enabled !== false
  };
}

function normalizeQuickReplies(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => isPlainObject(item) && String(item.content || '').trim())
    .map((item) => ({
      label: String(item.label || item.content || '').trim().slice(0, 20),
      content: String(item.content || '').trim(),
      enabled: item.enabled !== false
    }));
}

function normalizeFiniteNumber(value, fallback) {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) ? number : fallback;
}

function normalizePositiveFiniteNumber(value, fallback) {
  const number = normalizeFiniteNumber(value, fallback);
  return number > 0 ? number : fallback;
}

export function normalizePromptModule(module) {
  const normalized = {
    id: String(module.id || crypto.randomUUID()),
    title: String(module.title || '未命名模块'),
    enabled: Boolean(module.enabled),
    content: String(module.content || '')
  };
  const role = String(module.role || '').trim().toLowerCase();
  const position = String(module.position || '').trim().toLowerCase();
  if (['system', 'user', 'assistant'].includes(role)) normalized.role = role;
  if (['relative', 'in_chat'].includes(position)) normalized.position = position;
  if (module.depth !== undefined) normalized.depth = normalizeFiniteNumber(module.depth, 0);
  if (module.order !== undefined) normalized.order = normalizeFiniteNumber(module.order, 0);
  if (module.source) normalized.source = String(module.source);
  if (isPlainObject(module.extensions)) normalized.extensions = normalizePromptModuleExtensions(module.extensions);
  return normalized;
}

function normalizePromptModuleExtensions(extensions) {
  const normalized = structuredClone(extensions);
  const preset = normalized.sillyTavernPreset;
  if (isPlainObject(preset)) {
    // Bundle-level metadata is stored once on prompt-bundle.payload. Keeping the
    // same layout/settings copy on every module made large community presets grow
    // quadratically on disk and in memory.
    delete preset.generationSettings;
    delete preset.promptLayout;
    delete preset.dependencySignals;
    delete preset.regexCompatibility;
  }
  return normalized;
}

export function normalizeWorldBookEntry(entry) {
  return {
    id: String(entry.id || crypto.randomUUID()),
    type: String(entry.type || 'memory'),
    title: String(entry.title || '未命名条目'),
    keywords: Array.isArray(entry.keywords) ? entry.keywords.map(String) : [],
    secondaryKeywords: Array.isArray(entry.secondaryKeywords) ? entry.secondaryKeywords.map(String) : [],
    matchMode: String(entry.matchMode || 'keyword'),
    regex: Array.isArray(entry.regex) ? entry.regex.map(String) : [],
    logic: String(entry.logic || 'any'),
    content: String(entry.content || ''),
    priority: normalizeFiniteNumber(entry.priority, 50),
    depth: normalizeFiniteNumber(entry.depth, 4),
    insertionOrder: normalizeFiniteNumber(entry.insertionOrder ?? entry.insertion_order, 0),
    constant: entry.constant === true,
    caseSensitive: entry.caseSensitive === true,
    position: String(entry.position || 'after_character'),
    scope: String(entry.scope || 'prompt'),
    enabled: Boolean(entry.enabled),
    source: String(entry.source || 'manual'),
    extensions: isPlainObject(entry.extensions) ? entry.extensions : {},
    updatedAt: String(entry.updatedAt || new Date().toISOString())
  };
}

export function normalizeCharacterCard(card = {}) {
  return {
    name: String(card.name || '未命名主角'),
    nickname: String(card.nickname || ''),
    role: String(card.role || '个人创作主角'),
    description: String(card.description || ''),
    personality: String(card.personality || ''),
    scenario: String(card.scenario || ''),
    firstMessage: String(card.firstMessage || ''),
    exampleDialog: Array.isArray(card.exampleDialog) ? card.exampleDialog.map(String) : [],
    creatorNotes: String(card.creatorNotes || ''),
    creatorNotesMultilingual: isPlainObject(card.creatorNotesMultilingual) ? card.creatorNotesMultilingual : {},
    systemPrompt: String(card.systemPrompt || ''),
    postHistoryInstructions: String(card.postHistoryInstructions || ''),
    alternateGreetings: Array.isArray(card.alternateGreetings) ? card.alternateGreetings.map(String) : [],
    groupOnlyGreetings: Array.isArray(card.groupOnlyGreetings) ? card.groupOnlyGreetings.map(String) : [],
    tags: Array.isArray(card.tags) ? card.tags.map(String) : [],
    creator: String(card.creator || ''),
    characterVersion: String(card.characterVersion || ''),
    source: Array.isArray(card.source) ? card.source.map(String) : [],
    assets: Array.isArray(card.assets) ? card.assets : [],
    creationDate: Number.isFinite(Number(card.creationDate)) ? Math.floor(Number(card.creationDate)) : null,
    modificationDate: Number.isFinite(Number(card.modificationDate)) ? Math.floor(Number(card.modificationDate)) : null,
    sourceSpec: String(card.sourceSpec || ''),
    portrait: normalizeCharacterPortrait(card.portrait),
    expressions: normalizeCharacterExpressions(card.expressions),
    extensions: isPlainObject(card.extensions) ? card.extensions : {},
    raw: isPlainObject(card.raw) ? card.raw : undefined,
    enabled: card.enabled !== false
  };
}

function normalizeCharacterPortrait(value) {
  if (!isPlainObject(value)) return undefined;
  const assetId = String(value.assetId || '').trim().toLowerCase();
  const url = String(value.url || '').trim();
  if (!/^[a-f0-9]{64}$/.test(assetId) || !/^\/api\/character-images\/[a-f0-9]{64}\.png$/.test(url)) {
    return undefined;
  }
  return {
    assetId,
    url,
    mimeType: 'image/png',
    width: Math.max(0, Math.trunc(normalizeFiniteNumber(value.width, 0))),
    height: Math.max(0, Math.trunc(normalizeFiniteNumber(value.height, 0))),
    source: String(value.source || 'embedded-character-card')
  };
}

function normalizeCharacterExpressions(value) {
  if (!isPlainObject(value)) return undefined;
  const result = {};
  for (const [emotion, portrait] of Object.entries(value)) {
    const normalized = normalizeCharacterPortrait(portrait);
    if (normalized) {
      result[String(emotion).trim().toLowerCase()] = normalized;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}
