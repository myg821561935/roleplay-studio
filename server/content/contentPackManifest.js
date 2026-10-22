import { normalizeSemver, satisfiesSemver } from '../lib/semver.js';
import { APP_VERSION } from '../releaseInfo.js';
import {
  inspectSafeTemplate,
  normalizeLightFrontendRuntime
} from '../compat/lightFrontendRuntime.js';

export const CONTENT_PACK_SPEC = 'lra.content-pack/v1';
export const DEFAULT_CONTENT_PACK_ENGINE_RANGE = '>=0.2.2 <2.0.0';

const PACK_ID_PATTERN = /^[a-z][a-z0-9._-]{2,79}$/;
const EXECUTABLE_FIELDS = ['entry', 'main', 'module', 'script', 'scripts', 'command', 'hooks'];

export function isContentPackBundle(value) {
  return isPlainObject(value)
    && String(value.spec || value.schema || value.manifest?.spec || '').trim() === CONTENT_PACK_SPEC
    && isPlainObject(value.manifest)
    && isPlainObject(value.content);
}

export function createContentPackManifest(pack = {}, {
  version = '1.0.0',
  engine = DEFAULT_CONTENT_PACK_ENGINE_RANGE,
  manifestId = pack.manifest?.id || pack.id,
  dependencies = pack.manifest?.dependencies,
  publisher = pack.manifest?.publisher || 'local-roleplay-agent'
} = {}) {
  const basePackId = String(pack.resourceManifest?.basePackId || '').trim();
  const defaultDependencies = basePackId
    ? [{ kind: 'content-pack', id: basePackId, range: '^1.0.0', optional: false, scope: 'build' }]
    : [];
  return normalizeContentPackManifest({
    spec: CONTENT_PACK_SPEC,
    id: manifestId,
    version: pack.manifest?.version || version,
    title: pack.manifest?.title || pack.title,
    description: pack.manifest?.description || pack.description,
    author: pack.manifest?.author || '',
    license: pack.manifest?.license || '未声明',
    publisher,
    engine: pack.manifest?.engine || engine,
    capabilities: pack.manifest?.capabilities || inferCapabilities(pack),
    dependencies: dependencies || defaultDependencies,
    resourceRefs: pack.manifest?.resourceRefs || buildResourceRefs(pack.resourceManifest)
  }).manifest;
}

export function createContentPackBundle(pack = {}, options = {}) {
  const manifest = createContentPackManifest(pack, options);
  return {
    spec: CONTENT_PACK_SPEC,
    manifest,
    content: {
      sessionTitle: String(pack.sessionTitle || pack.title || '').trim(),
      visualPackId: String(pack.visualPackId || pack.resourceManifest?.basePackId || '').trim(),
      characterCard: structuredClone(pack.characterCard || {}),
      stageBackground: normalizeStageBackground(pack.stageBackground, pack.characterCard),
      worldBook: structuredClone(Array.isArray(pack.worldBook) ? pack.worldBook : []),
      promptModules: structuredClone(Array.isArray(pack.promptModules) ? pack.promptModules : []),
      lightFrontend: normalizeLightFrontendRuntime(pack.lightFrontend || {}),
      memory: structuredClone(pack.memory || {}),
      ruleSystem: structuredClone(pack.ruleSystem || {}),
      characterPresets: structuredClone(Array.isArray(pack.characterPresets) ? pack.characterPresets : []),
      groupMembers: structuredClone(Array.isArray(pack.groupMembers) ? pack.groupMembers : []),
      openingTemplate: isPlainObject(pack.openingTemplate) ? structuredClone(pack.openingTemplate) : null
    }
  };
}

export function normalizeContentPackManifest(input = {}) {
  const blockingIssues = [];
  const warnings = [];
  const source = isPlainObject(input?.manifest) ? input.manifest : input;
  const spec = String(source.spec || input.spec || input.schema || '').trim();
  if (spec !== CONTENT_PACK_SPEC) blockingIssues.push(issue('content-pack-spec-invalid', `必须声明 spec: ${CONTENT_PACK_SPEC}。`, 'spec'));
  for (const field of EXECUTABLE_FIELDS) {
    if (Object.hasOwn(source, field)) blockingIssues.push(issue('content-pack-executable-unsupported', `内容包不能声明 ${field}。`, field));
  }
  const id = String(source.id || '').trim().toLowerCase();
  if (!PACK_ID_PATTERN.test(id)) blockingIssues.push(issue('content-pack-id-invalid', '内容包 ID 需使用小写字母、数字、点、短横线或下划线。', 'id'));
  const version = normalizeSemver(source.version);
  if (!version) blockingIssues.push(issue('content-pack-version-invalid', '内容包版本必须是 x.y.z。', 'version'));
  const title = String(source.title || source.name || id || '未命名内容包').trim().slice(0, 80);
  const engine = String(source.engine || DEFAULT_CONTENT_PACK_ENGINE_RANGE).trim();
  const dependencies = (Array.isArray(source.dependencies) ? source.dependencies : [])
    .map((dependency) => normalizeDependency(dependency, blockingIssues))
    .filter(Boolean);
  const resourceRefs = (Array.isArray(source.resourceRefs) ? source.resourceRefs : [])
    .map(normalizeResourceRef)
    .filter(Boolean);
  return {
    manifest: {
      spec: CONTENT_PACK_SPEC,
      id,
      version: version || '0.0.0',
      title,
      description: String(source.description || '').trim().slice(0, 500),
      author: String(source.author || '').trim().slice(0, 80),
      publisher: String(source.publisher || '').trim().slice(0, 80),
      license: String(source.license || '未声明').trim().slice(0, 80),
      engine,
      capabilities: uniqueStrings(source.capabilities),
      dependencies,
      resourceRefs
    },
    blockingIssues,
    warnings
  };
}

export function inspectContentPackBundle(input = {}, {
  appVersion = APP_VERSION,
  installedPlugins = [],
  contentPacks = []
} = {}) {
  const blockingIssues = [];
  const warnings = [];
  const normalized = normalizeContentPackManifest(input);
  blockingIssues.push(...normalized.blockingIssues);
  warnings.push(...normalized.warnings);
  const manifest = normalized.manifest;
  const content = isPlainObject(input.content) ? input.content : {};

  for (const field of EXECUTABLE_FIELDS) {
    if (Object.hasOwn(input, field)) blockingIssues.push(issue('content-pack-executable-unsupported', `内容包根节点不能声明 ${field}。`, field));
  }
  if (!isPlainObject(input.content)) blockingIssues.push(issue('content-pack-content-missing', '缺少 content 数据。', 'content'));
  if (!isPlainObject(content.characterCard)) blockingIssues.push(issue('content-pack-character-missing', '缺少 characterCard。', 'content.characterCard'));
  if (!Array.isArray(content.worldBook)) blockingIssues.push(issue('content-pack-worldbook-invalid', 'worldBook 必须是数组。', 'content.worldBook'));
  if (!Array.isArray(content.promptModules)) blockingIssues.push(issue('content-pack-prompts-invalid', 'promptModules 必须是数组。', 'content.promptModules'));
  if (!isPlainObject(content.memory)) warnings.push(issue('content-pack-memory-empty', '未提供初始记忆，将使用空记忆。', 'content.memory'));
  if (!isPlainObject(content.ruleSystem)) warnings.push(issue('content-pack-rules-empty', '未提供规则系统，叙事约束会较弱。', 'content.ruleSystem'));

  if (!satisfiesSemver(appVersion, manifest.engine)) {
    blockingIssues.push(issue('content-pack-engine-incompatible', `内容包要求引擎 ${manifest.engine}，当前版本为 ${appVersion}。`, 'manifest.engine'));
  }

  const dependencies = manifest.dependencies.map((dependency) => {
    const installed = dependency.kind === 'plugin'
      ? installedPlugins.find((item) => identityOf(item) === dependency.id)
      : contentPacks.find((item) => identityOf(item) === dependency.id || String(item.id || '') === dependency.id);
    const installedVersion = versionOf(installed);
    const matched = Boolean(installedVersion && satisfiesSemver(installedVersion, dependency.range));
    const status = matched ? 'ready' : installedVersion ? 'version-mismatch' : 'missing';
    if (!matched) {
      const isBlocking = !dependency.optional && dependency.scope === 'runtime';
      const target = isBlocking ? blockingIssues : warnings;
      target.push(issue(
        status === 'missing' ? 'content-pack-dependency-missing' : 'content-pack-dependency-version',
        `${dependency.kind} ${dependency.id} 需要 ${dependency.range}${installedVersion ? `，当前为 ${installedVersion}` : '，当前未安装'}。`,
        `manifest.dependencies.${dependency.id}`
      ));
    }
    return { ...dependency, installedVersion, status };
  });

  const counts = {
    worldBook: Array.isArray(content.worldBook) ? content.worldBook.length : 0,
    promptModules: Array.isArray(content.promptModules) ? content.promptModules.length : 0,
    characterPresets: Array.isArray(content.characterPresets) && content.characterPresets.length ? content.characterPresets.length : 1,
    memoryCards: Array.isArray(content.memory?.memoryCards) ? content.memory.memoryCards.length : 0
  };
  const estimatedTokens = Math.max(1, Math.ceil(JSON.stringify(content).length / 2.8));
  const score = Math.max(0, 100 - (blockingIssues.length * 25) - (warnings.length * 5));
  const verdict = blockingIssues.length ? 'blocked' : warnings.length ? 'review' : 'recommended';
  return {
    manifest,
    content: structuredClone(content),
    score,
    grade: verdict === 'recommended' ? 'A' : verdict === 'review' ? 'B' : 'D',
    verdict,
    verdictLabel: verdict === 'recommended' ? '兼容可用' : verdict === 'review' ? '建议审阅' : '不兼容',
    summary: blockingIssues.length
      ? `发现 ${blockingIssues.length} 项兼容性阻断。`
      : `${manifest.title} ${manifest.version} 可安装。`,
    canInstall: blockingIssues.length === 0,
    canImport: blockingIssues.length === 0,
    compatible: blockingIssues.length === 0,
    dependencies,
    counts,
    estimatedTokens,
    blockingIssues,
    warnings,
    riskFlags: [],
    dimensions: [
      dimension('manifest', '清单结构', normalized.blockingIssues.length ? 30 : 100, CONTENT_PACK_SPEC),
      dimension('engine', '引擎兼容', blockingIssues.some((item) => item.code === 'content-pack-engine-incompatible') ? 0 : 100, manifest.engine),
      dimension('dependencies', '依赖完整', dependencies.some((item) => item.status !== 'ready' && !item.optional && item.scope === 'runtime') ? 20 : 100, `${dependencies.length} 项依赖`),
      dimension('content', '内容完整', counts.worldBook || counts.promptModules ? 100 : 60, `${counts.worldBook} 条世界书 · ${counts.promptModules} 个 Prompt`)
    ]
  };
}

export function contentPackFromBundle(bundle, internalId, { importedAt = new Date().toISOString(), source = {} } = {}) {
  const manifest = normalizeContentPackManifest(bundle).manifest;
  const content = isPlainObject(bundle.content) ? bundle.content : {};
  return {
    id: internalId,
    title: manifest.title,
    description: manifest.description,
    sessionTitle: String(content.sessionTitle || manifest.title).trim(),
    visualPackId: String(content.visualPackId || 'neutral').trim(),
    characterCard: structuredClone(content.characterCard || {}),
    stageBackground: normalizeStageBackground(content.stageBackground, content.characterCard),
    worldBook: structuredClone(Array.isArray(content.worldBook) ? content.worldBook : []),
    promptModules: structuredClone(Array.isArray(content.promptModules) ? content.promptModules : []),
    lightFrontend: normalizeLightFrontendRuntime(content.lightFrontend || {}),
    memory: structuredClone(content.memory || {}),
    ruleSystem: structuredClone(content.ruleSystem || {}),
    characterPresets: structuredClone(Array.isArray(content.characterPresets) ? content.characterPresets : []),
    groupMembers: structuredClone(Array.isArray(content.groupMembers) ? content.groupMembers : []),
    openingTemplate: isPlainObject(content.openingTemplate) ? structuredClone(content.openingTemplate) : null,
    manifest,
    custom: true,
    imported: true,
    source: {
      site: String(source.site || source.sourceId || 'local-file').trim(),
      url: String(source.url || '').trim(),
      fileName: String(source.fileName || '').trim(),
      importedAt
    },
    resourceManifest: {
      creationMode: 'independent-copy',
      basePackId: manifest.dependencies.find((item) => item.kind === 'content-pack')?.id || '',
      includeBaseContent: true,
      importedBundle: true
    },
    createdAt: importedAt,
    updatedAt: importedAt
  };
}

export function summarizeContentPackManifest(pack = {}) {
  const manifest = createContentPackManifest(pack);
  return {
    spec: manifest.spec,
    id: manifest.id,
    version: manifest.version,
    engine: manifest.engine,
    publisher: manifest.publisher,
    license: manifest.license,
    capabilities: structuredClone(manifest.capabilities),
    dependencies: structuredClone(manifest.dependencies)
  };
}

function normalizeDependency(input, blockingIssues) {
  if (!isPlainObject(input)) return null;
  const kind = String(input.kind || 'plugin').trim().toLowerCase();
  if (!['plugin', 'content-pack'].includes(kind)) {
    blockingIssues.push(issue('content-pack-dependency-kind-invalid', '依赖 kind 仅支持 plugin 或 content-pack。', 'dependencies'));
    return null;
  }
  const id = String(input.id || '').trim().toLowerCase();
  if (!PACK_ID_PATTERN.test(id)) {
    blockingIssues.push(issue('content-pack-dependency-id-invalid', '依赖 ID 无效。', 'dependencies'));
    return null;
  }
  return {
    kind,
    id,
    range: String(input.range || '*').trim(),
    optional: input.optional === true,
    scope: input.scope === 'build' ? 'build' : 'runtime'
  };
}

function normalizeResourceRef(input) {
  if (!isPlainObject(input)) return null;
  const id = String(input.id || '').trim();
  if (!id) return null;
  return {
    id,
    kind: String(input.kind || '').trim(),
    fingerprint: String(input.fingerprint || '').trim(),
    version: String(input.version || '').trim()
  };
}

function buildResourceRefs(resourceManifest = {}) {
  const refs = [];
  if (resourceManifest.characterResourceId) refs.push({ id: resourceManifest.characterResourceId, kind: 'character' });
  for (const id of resourceManifest.worldBookResourceIds || []) refs.push({ id, kind: 'worldbook' });
  for (const id of resourceManifest.promptResourceIds || []) refs.push({ id, kind: 'prompt' });
  return refs;
}

function inferCapabilities(pack) {
  const capabilities = ['character'];
  const lightFrontend = normalizeLightFrontendRuntime(pack.lightFrontend || {});
  if (pack.worldBook?.length) capabilities.push('worldbook');
  if (pack.promptModules?.length) capabilities.push('prompt');
  if (lightFrontend.regexTransforms.length) capabilities.push('safe-regex-display');
  if (lightFrontend.quickReplies.length) capabilities.push('quick-replies');
  if (lightFrontend.panels.length) capabilities.push('sidebar-panels');
  if (lightFrontend.mvu.enabled) capabilities.push('mvu-state');
  if (lightFrontend.adapters.some((adapter) => adapter.mode === 'declarative-partial')) {
    capabilities.push('community-light-adapters');
  }
  if (hasSafeTemplateContent(pack)) capabilities.push('safe-ejs-template');
  if (pack.ruleSystem) capabilities.push('rule-system');
  if (pack.memory) capabilities.push('memory-seed');
  if ((pack.characterPresets || []).some((preset) => {
    const extensions = preset?.characterCard?.extensions || preset?.extensions || {};
    return extensions.npcCard
      || extensions.privateKnowledge?.length
      || extensions.schedule?.length
      || extensions.agenda?.length;
  })) capabilities.push('world-simulation');
  return capabilities;
}

function hasSafeTemplateContent(pack) {
  const values = [
    pack.characterCard,
    ...(Array.isArray(pack.worldBook) ? pack.worldBook : []),
    ...(Array.isArray(pack.promptModules) ? pack.promptModules : []),
    ...(Array.isArray(pack.lightFrontend?.quickReplies) ? pack.lightFrontend.quickReplies : []),
    ...(Array.isArray(pack.lightFrontend?.panels) ? pack.lightFrontend.panels : [])
  ];
  let detected = false;
  for (const value of values) {
    for (const text of collectTemplateStrings(value)) {
      const report = inspectSafeTemplate(text);
      if (!report.hasTemplate) continue;
      detected = true;
      if (!report.supported) return false;
    }
  }
  return detected;
}

function collectTemplateStrings(value) {
  const strings = [];
  const queue = [value];
  const seen = new Set();
  while (queue.length && strings.length < 500) {
    const current = queue.shift();
    if (typeof current === 'string') {
      strings.push(current);
      continue;
    }
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) queue.push(...current.slice(0, 200));
    else queue.push(...Object.values(current).slice(0, 200));
  }
  return strings;
}

function identityOf(item) {
  return String(item?.manifest?.id || item?.id || '').trim().toLowerCase();
}

function versionOf(item) {
  return normalizeSemver(item?.manifest?.version || item?.version || '');
}

function issue(code, message, path = '') {
  return { code, message, path };
}

function dimension(id, label, score, summary) {
  return { id, label, score, summary, status: score >= 80 ? 'ready' : score >= 50 ? 'review' : 'blocked' };
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter(Boolean))];
}

function normalizeStageBackground(value, characterCard = {}) {
  if (!isPlainObject(value) || String(value.source || '') !== 'character-portrait') return null;
  const portrait = isPlainObject(characterCard?.portrait) ? characterCard.portrait : {};
  const assetId = String(portrait.assetId || '').trim().toLowerCase();
  const url = String(portrait.url || '').trim();
  if (!/^[a-f0-9]{64}$/.test(assetId) || url !== `/api/character-images/${assetId}.png`) return null;
  return {
    url,
    assetId,
    source: 'character-portrait',
    fit: 'portrait',
    label: String(value.label || `${characterCard.name || '角色'}立绘`).trim().slice(0, 80)
  };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
