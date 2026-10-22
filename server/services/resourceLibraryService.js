import crypto from 'node:crypto';
import {
  normalizeCharacterCard,
  normalizePromptModule,
  normalizeWorldBookEntry
} from '../config/configService.js';
import { resolveResourceAdapter } from '../resources/resourceAdapters.js';
import { PluginRegistryService } from './pluginRegistryService.js';
import { compareSemver } from '../lib/semver.js';
import {
  contentPackFromBundle,
  createContentPackBundle,
  createContentPackManifest,
  inspectContentPackBundle,
  summarizeContentPackManifest
} from '../content/contentPackManifest.js';
import {
  aggregateResourceEvaluations,
  detectExecutionRisks,
  evaluateResourceCandidate,
  estimateResourceTokens
} from '../resources/resourceEvaluator.js';
import {
  aggregateCommunityCompatibility,
  scanCommunityDependencies
} from '../resources/communityDependencyScanner.js';
import {
  extractLightFrontendRuntime,
  mergeLightFrontendRuntimes
} from '../compat/lightFrontendRuntime.js';
import { enrichCharacterCard } from '../character/characterEnrichment.js';
import {
  applyWorldBookTagRegistry as applyWorldBookTagRegistryToPayload
} from '../character/worldBookTagRegistry.js';
import { APP_VERSION } from '../releaseInfo.js';
import { ResourceRepository } from './resourceLibrary/resourceRepository.js';
import {
  ResourceConflictService,
  createFingerprint
} from './resourceLibrary/resourceConflictService.js';
import { ResourceEvaluationService } from './resourceLibrary/resourceEvaluationService.js';
import { ResourceImportService } from './resourceLibrary/resourceImportService.js';
import { ResourceRevisionService } from './resourceLibrary/resourceRevisionService.js';
import { StoryCompositionService } from './resourceLibrary/storyCompositionService.js';
import {
  compilePlayableCharacterCard,
  compilePlayableWorldBook,
  compileStructuredWorldSystems,
  estimateWorldBookRuntimeProfile
} from '../resources/playableResourceCompiler.js';
import {
  PROMPT_BUNDLE_KIND,
  createPromptBundlePayload,
  expandPromptResourceModules
} from '../resources/promptBundle.js';
import { planLegacyPromptBundleMigrations } from '../resources/legacyPromptBundle.js';
import {
  applyScriptReview,
  getScriptGovernanceSnapshot
} from '../security/scriptGovernance.js';
import { TAVERN_COMPATIBILITY_CONTRACT_VERSION } from '../compat/compatibilityPolicy.js';
import { buildInteractionConflictReport } from '../agent/interactionContract.js';

const RESOURCE_KINDS = new Set(['character', 'worldbook', 'prompt', PROMPT_BUNDLE_KIND]);

function createPackCompatibilityReview({
  base = {},
  selected = [],
  communityCompatibility = {},
  lightFrontend = {},
  promptModules = [],
  roleplayMode = 'dm'
} = {}) {
  const governance = getScriptGovernanceSnapshot({ config: { lightFrontend } });
  const counts = {
    missing: Number(communityCompatibility?.counts?.missing || 0),
    review: Number(communityCompatibility?.counts?.review || 0),
    degraded: Number(communityCompatibility?.counts?.degraded || 0)
  };
  const rules = governance.rules.map((rule) => ({
    scriptId: rule.scriptId,
    name: rule.name,
    contentHash: rule.contentHash,
    scope: rule.scope,
    pattern: rule.pattern,
    source: rule.source,
    riskLevel: rule.riskLevel,
    risks: rule.risks
  }));
  const blockers = (Array.isArray(communityCompatibility?.acceptance?.blockers)
    ? communityCompatibility.acceptance.blockers
    : [])
    .map((item) => ({
      id: String(item?.id || 'unknown-capability'),
      label: String(item?.label || item?.id || '未知能力'),
      impact: String(item?.impact || ''),
      recommendation: String(item?.recommendation || ''),
      evidence: Array.isArray(item?.evidence) ? item.evidence.map(String).slice(0, 6) : []
    }));
  const differences = (Array.isArray(communityCompatibility?.acceptance?.differences)
    ? communityCompatibility.acceptance.differences
    : [])
    .map((item) => ({
      id: String(item?.id || 'unknown-capability'),
      label: String(item?.label || item?.id || '未知能力'),
      impact: String(item?.impact || ''),
      recommendation: String(item?.recommendation || ''),
      evidence: Array.isArray(item?.evidence) ? item.evidence.map(String).slice(0, 6) : []
    }));
  const interaction = buildInteractionConflictReport({ roleplayMode, promptModules });
  const canonical = {
    contractVersion: TAVERN_COMPATIBILITY_CONTRACT_VERSION,
    base: {
      version: String(base?.manifest?.version || base?.version || '')
    },
    resources: selected.map((resource) => ({
      id: String(resource?.id || ''),
      revisionId: String(resource?.revision?.headId || ''),
      kind: String(resource?.kind || '')
    })).sort((left, right) => left.id.localeCompare(right.id)),
    counts,
    scripts: rules.map((rule) => ({
      scriptId: rule.scriptId,
      contentHash: rule.contentHash
    })).sort((left, right) => left.scriptId.localeCompare(right.scriptId)),
    blockers: blockers.map((item) => item.id).sort(),
    differences: differences.map((item) => item.id).sort(),
    interaction: {
      roleplayMode: interaction.roleplayMode,
      signals: [
        interaction.semantics.requestsPlayerWriting ? 'player-writing' : '',
        interaction.semantics.protectsPlayerAgency ? 'player-agency' : '',
        interaction.semantics.requestsMoreDialogue ? 'dialogue-density' : ''
      ].filter(Boolean),
      conflicts: interaction.conflicts.map((item) => item.type).sort()
    }
  };
  return {
    contractVersion: TAVERN_COMPATIBILITY_CONTRACT_VERSION,
    fingerprint: `sha256:${crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex')}`,
    counts,
    rules,
    sourceRuntimeBlocked: counts.missing > 0,
    safeDerivativeAvailable: counts.missing > 0,
    blockers,
    differences,
    interaction,
    requiresScriptApproval: rules.length > 0,
    requiresCompatibilityAcknowledgement: counts.missing > 0
      || counts.degraded > 0
      || (counts.review > 0 && rules.length === 0)
  };
}

function inspectImportedContentPackCompatibility(bundle = {}) {
  const content = isRecord(bundle.content) ? bundle.content : {};
  const lightFrontend = mergeLightFrontendRuntimes([
    isRecord(content.lightFrontend) ? content.lightFrontend : {},
    extractLightFrontendRuntime(content)
  ]);
  const communityCompatibility = scanCommunityDependencies(content);
  return {
    lightFrontend,
    communityCompatibility,
    compatibilityReview: createPackCompatibilityReview({
      base: { manifest: isRecord(bundle.manifest) ? bundle.manifest : {} },
      selected: [],
      communityCompatibility,
      lightFrontend,
      promptModules: content.promptModules || [],
      roleplayMode: 'dm'
    })
  };
}

function applyPackCompatibilityReview(lightFrontend, input, review, now) {
  const requiresDecision = review.requiresScriptApproval || review.requiresCompatibilityAcknowledgement;
  if (!requiresDecision) {
    return {
      contractVersion: review.contractVersion,
      fingerprint: review.fingerprint,
      status: 'not-required',
      approvedScriptHashes: [],
      acknowledgedCompatibility: false,
      sourceRuntimeBlocked: false,
      disabledCapabilities: [],
      compatibilityDifferences: [],
      interaction: structuredClone(review.interaction),
      reviewedAt: ''
    };
  }
  const decision = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const executionMode = normalizePackScriptExecutionMode(decision.executionMode);
  if (executionMode === 'compatibility-probe' && decision.acknowledgeDeveloperRisk !== true) {
    throw createResourcePackReviewError('RESOURCE_PACK_DEVELOPER_MODE_ACK_REQUIRED');
  }
  if (decision.fingerprint && decision.fingerprint !== review.fingerprint) {
    throw createResourcePackReviewError('RESOURCE_PACK_REVIEW_STALE');
  }
  if (decision.fingerprint !== review.fingerprint) {
    throw createResourcePackReviewError('RESOURCE_PACK_REVIEW_REQUIRED');
  }
  const suppliedReviews = normalizePackScriptReviews(decision.scriptReviews);
  const reviewsByScriptId = new Map(suppliedReviews.map((item) => [item.scriptId, item]));
  const pendingRules = review.rules.filter((rule) => {
    const item = reviewsByScriptId.get(rule.scriptId);
    return !item || item.contentHash !== rule.contentHash;
  });
  if (executionMode === 'review-required' && pendingRules.length) {
    const error = createResourcePackReviewError('RESOURCE_PACK_SCRIPT_APPROVAL_REQUIRED');
    error.pendingScriptIds = pendingRules.map((rule) => rule.scriptId);
    throw error;
  }
  if (review.requiresCompatibilityAcknowledgement && decision.acknowledgeCompatibility !== true) {
    throw createResourcePackReviewError('RESOURCE_PACK_COMPATIBILITY_ACK_REQUIRED');
  }

  const reviewSession = { config: { lightFrontend } };
  reviewSession.config.lightFrontend.scriptExecutionMode = executionMode;
  const reviewedAt = now().toISOString();
  review.rules.forEach((rule) => {
    const item = reviewsByScriptId.get(rule.scriptId);
    if (!item) return;
    applyScriptReview(reviewSession, {
      scriptId: rule.scriptId,
      decision: item.decision,
      reviewer: 'local-owner',
      note: item.note
    }, { now: new Date(reviewedAt) });
  });
  const persistedScriptReviews = Array.isArray(reviewSession.config.lightFrontend?.scriptReviews)
    ? structuredClone(reviewSession.config.lightFrontend.scriptReviews)
    : [];
  const approvedScriptHashes = review.rules
    .filter((rule) => reviewsByScriptId.get(rule.scriptId)?.decision === 'approved')
    .map((rule) => rule.contentHash);
  const hasDisabledScripts = executionMode === 'review-required'
    && approvedScriptHashes.length !== review.rules.length;
  return {
    contractVersion: review.contractVersion,
    fingerprint: review.fingerprint,
    status: ['local-observe', 'compatibility-probe'].includes(executionMode)
      ? (review.sourceRuntimeBlocked
        ? executionMode === 'compatibility-probe' ? 'safe-derivative-compatibility-probe' : 'safe-derivative-local-observe'
        : executionMode)
      : (review.sourceRuntimeBlocked || hasDisabledScripts ? 'safe-derivative-approved' : 'approved'),
    executionMode,
    approvedScriptHashes,
    scriptReviews: persistedScriptReviews,
    acknowledgedCompatibility: decision.acknowledgeCompatibility === true,
    developerProbeAcknowledged: executionMode === 'compatibility-probe',
    sourceRuntimeBlocked: review.sourceRuntimeBlocked === true,
    disabledCapabilities: review.sourceRuntimeBlocked
      ? structuredClone(review.blockers || [])
      : [],
    compatibilityDifferences: structuredClone(review.differences || []),
    interaction: structuredClone(review.interaction),
    reviewedAt
  };
}

function normalizePackScriptExecutionMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  return ['local-observe', 'compatibility-probe', 'review-required'].includes(mode)
    ? mode
    : 'local-observe';
}

function normalizePackScriptReviews(value) {
  const byScriptId = new Map();
  (Array.isArray(value) ? value : []).forEach((item) => {
    if (!isRecord(item)) return;
    const scriptId = String(item.scriptId || '').trim().slice(0, 80);
    const contentHash = String(item.contentHash || '').trim().slice(0, 160);
    const decision = String(item.decision || '').trim().toLowerCase();
    const note = String(item.note || '').trim().slice(0, 500);
    if (!scriptId || !contentHash || !['approved', 'rejected'].includes(decision) || note.length < 8) return;
    byScriptId.set(scriptId, { scriptId, contentHash, decision, note });
  });
  return [...byScriptId.values()];
}

function createResourcePackReviewError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export class ResourceLibraryService {
  constructor(store, {
    now = () => new Date(),
    appVersion = APP_VERSION,
    pluginRegistry = null,
    resolveBuiltInPack = () => null,
    listBuiltInPacks = () => [],
    repository = null,
    conflictService = null,
    evaluationService = null,
    importService = null,
    revisionService = null,
    storyCompositionService = null
  } = {}) {
    this.store = store;
    this.now = now;
    this.appVersion = appVersion;
    this.pluginRegistry = pluginRegistry || new PluginRegistryService(store, { appVersion, now });
    this.resolveBuiltInPack = resolveBuiltInPack;
    this.listBuiltInPacks = listBuiltInPacks;
    this.repository = repository || new ResourceRepository(store);
    this.conflictService = conflictService || new ResourceConflictService();
    this.evaluationService = evaluationService || new ResourceEvaluationService();
    this.importService = importService || new ResourceImportService({
      conflictService: this.conflictService,
      evaluationService: this.evaluationService,
      now
    });
    this.revisionService = revisionService || new ResourceRevisionService({ now });
    this.storyComposition = storyCompositionService || new StoryCompositionService({
      createEmptyPackSeed
    });
  }

  async listAdapters() {
    return this.pluginRegistry.listAdapters();
  }

  async listPlugins() {
    return this.pluginRegistry.listPlugins();
  }

  async listResources({ kind = '', query = '' } = {}) {
    const items = await this.repository.listResources();
    const normalizedKind = String(kind || '').trim().toLowerCase();
    const needle = String(query || '').trim().toLowerCase();
    return items
      .map((item) => withRuntimeContextEstimate(this.revisionService.withRevisionSummary(item)))
      .filter((item) => (
        !normalizedKind
        || item.kind === normalizedKind
        || (normalizedKind === 'prompt' && item.kind === PROMPT_BUNDLE_KIND)
      ))
      .filter((item) => {
        if (!needle) return true;
        return [item.title, item.summary, ...(item.tags || []), ...(item.collections || []), item.source?.site, item.source?.author]
          .some((value) => String(value || '').toLowerCase().includes(needle));
      })
      .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));
  }

  async getResource(resourceId) {
    const id = normalizeId(resourceId);
    if (!id) return null;
    return this.repository.getResource(id);
  }

  async updateResourceMetadata(resourceId, input = {}) {
    const id = normalizeId(resourceId);
    if (!id) return null;
    const current = await this.getResource(id);
    if (!current) return null;
    const timestamp = this.now().toISOString();
    const next = {
      ...current,
      title: normalizeLibraryText(input.title, current.title, 120),
      summary: normalizeLibraryText(input.summary, current.summary, 800, { allowEmpty: true }),
      tags: input.tags === undefined ? uniqueStrings(current.tags) : uniqueStrings(input.tags).slice(0, 40),
      collections: input.collections === undefined
        ? uniqueStrings(current.collections)
        : uniqueStrings(input.collections).slice(0, 20),
      favorite: input.favorite === undefined ? current.favorite === true : input.favorite === true,
      updatedAt: timestamp
    };
    await this.repository.writeResource(id, next);
    return structuredClone(next);
  }

  async updateResourcePayload(resourceId, input = {}, { changeType = 'local-edit' } = {}) {
    const id = normalizeId(resourceId);
    if (!id) return null;
    const current = await this.getResource(id);
    if (!current) return null;
    if (!['worldbook', 'prompt'].includes(current.kind)) {
      throw new Error('RESOURCE_CONTENT_KIND_UNSUPPORTED');
    }

    const sourcePayload = input.payload && typeof input.payload === 'object' && !Array.isArray(input.payload)
      ? input.payload
      : {};
    let payload;
    if (current.kind === 'worldbook') {
      const entries = Array.isArray(sourcePayload.entries) ? sourcePayload.entries : null;
      if (!entries) throw new Error('RESOURCE_WORLD_BOOK_ENTRIES_INVALID');
      if (entries.length > 2000) throw new Error('RESOURCE_WORLD_BOOK_TOO_LARGE');
      payload = {
        ...(current.payload || {}),
        entries: entries.map((entry) => normalizeWorldBookEntry(entry || {}))
      };
    } else {
      payload = normalizePromptModule({
        ...(current.payload || {}),
        ...sourcePayload,
        id: sourcePayload.id || current.payload?.id
      });
    }

    const candidate = {
      kind: current.kind,
      title: normalizeLibraryText(input.title, current.title, 120),
      summary: current.summary,
      tags: current.tags,
      payload,
      version: current.source?.version || ''
    };
    const existing = await this.listResources();
    const { fingerprint, conflicts } = this.conflictService.findConflicts(candidate, existing, {
      excludeId: id
    });
    const adapters = await this.listAdapters();
    const adapter = adapters.find((item) => item.id === current.format) || {
      id: current.format || current.source?.adapterId || 'resource-library'
    };
    const diagnostics = this.evaluationService.evaluate(candidate, {
      conflicts,
      source: current.source || {},
      adapter
    });
    const incoming = {
      ...current,
      title: candidate.title,
      payload,
      fingerprint,
      diagnostics
    };
    const update = this.revisionService.describeUpdate(current, incoming);
    if (!update?.diff?.changed) return structuredClone(this.revisionService.withRevisionSummary(current));
    return this.commitResourceRevision(current, incoming, {
      changeType,
      diff: update.diff
    });
  }

  async applyWorldBookTagRegistry(resourceId, input = {}) {
    const id = normalizeId(resourceId);
    if (!id) return null;
    const current = await this.getResource(id);
    if (!current) return null;
    if (current.kind !== 'worldbook') {
      throw new Error('RESOURCE_TAG_REGISTRY_KIND_UNSUPPORTED');
    }
    const registryDocument = isRecord(input.registryDocument)
      ? input.registryDocument
      : {};
    const mappings = Array.isArray(input.mappings) ? input.mappings : [];
    const applied = applyWorldBookTagRegistryToPayload(current.payload || {}, {
      registryDocument,
      mappings
    });
    if (!applied.report.suppliedMappingCount) {
      throw new Error('RESOURCE_TAG_REGISTRY_EMPTY');
    }
    const resource = await this.updateResourcePayload(id, {
      payload: applied.payload
    }, {
      changeType: 'tag-registry-mapping'
    });
    return {
      resource,
      report: {
        ...applied.report,
        resourceId: id,
        resourceTitle: current.title || id
      }
    };
  }

  async updateResourcesMetadata(resourceIds = [], input = {}) {
    const ids = uniqueStrings(resourceIds).map(normalizeId).filter(Boolean).slice(0, 500);
    const mode = input.mode === 'replace' ? 'replace' : 'merge';
    const incomingTags = input.tags === undefined ? null : uniqueStrings(input.tags);
    const incomingCollections = input.collections === undefined ? null : uniqueStrings(input.collections);
    const updated = [];
    const missing = [];
    for (const id of ids) {
      const current = await this.getResource(id);
      if (!current) {
        missing.push(id);
        continue;
      }
      const tags = incomingTags === null
        ? current.tags
        : mode === 'replace'
          ? incomingTags
          : uniqueStrings([...(current.tags || []), ...incomingTags]);
      const collections = incomingCollections === null
        ? current.collections
        : mode === 'replace'
          ? incomingCollections
          : uniqueStrings([...(current.collections || []), ...incomingCollections]);
      updated.push(await this.updateResourceMetadata(id, {
        tags,
        collections,
        favorite: input.favorite
      }));
    }
    return { updated, missing };
  }

  async reevaluateResource(resourceId) {
    const id = normalizeId(resourceId);
    if (!id) return null;
    const current = await this.getResource(id);
    if (!current) return null;

    const existing = await this.listResources();
    const importBatchId = String(current.source?.importBatchId || '');
    const companionWorldBooks = current.kind === 'character' && importBatchId
      ? existing
        .filter((item) => item.kind === 'worldbook' && item.source?.importBatchId === importBatchId)
        .flatMap((item) => item.payload?.entries || [])
      : [];
    const enrichment = current.kind === 'character'
      ? enrichCharacterCard(normalizeCharacterCard(current.payload || {}), {
        worldBookEntries: companionWorldBooks
      })
      : { card: structuredClone(current.payload || {}), report: null };
    const payload = enrichment.card;
    const candidate = {
      kind: current.kind,
      title: current.title,
      summary: current.summary,
      tags: current.tags,
      payload,
      version: current.source?.version || ''
    };
    const { fingerprint, conflicts } = this.conflictService.findConflicts(candidate, existing, {
      excludeId: id
    });
    const adapters = await this.listAdapters();
    const adapter = adapters.find((item) => item.id === current.format) || {
      id: current.format || current.source?.adapterId || 'resource-library'
    };
    const diagnostics = this.evaluationService.evaluate(candidate, {
      conflicts,
      source: current.source || {},
      adapter
    });
    const timestamp = this.now().toISOString();
    const next = {
      ...current,
      fingerprint,
      diagnostics,
      payload,
      updatedAt: timestamp
    };
    await this.repository.writeResource(id, next);
    return {
      resource: structuredClone(next),
      enrichment: enrichment.report
    };
  }

  async ensureCurrentRevision(resource) {
    if (!resource?.id) return null;
    const currentRevisionId = String(resource.revision?.headId || '');
    if (currentRevisionId) {
      const stored = await this.repository.getResourceRevision(resource.id, currentRevisionId);
      if (stored) return resource;
    }
    const initialized = this.revisionService.initialize(resource, {
      changeType: resource.revision?.changeType || 'legacy-import'
    });
    await this.repository.writeResourceRevision(resource.id, initialized.revision.id, initialized.revision);
    await this.repository.writeResource(resource.id, initialized.resource);
    return initialized.resource;
  }

  async persistInitialResource(resource, { changeType = 'import' } = {}) {
    const initialized = this.revisionService.initialize(resource, { changeType });
    await this.repository.writeResourceRevision(resource.id, initialized.revision.id, initialized.revision);
    await this.repository.writeResource(resource.id, initialized.resource);
    return initialized.resource;
  }

  async commitResourceRevision(current, incoming, {
    changeType = 'upstream-update',
    diff,
    restoredFromRevisionId = ''
  } = {}) {
    const base = await this.ensureCurrentRevision(current);
    const advanced = this.revisionService.advance(base, incoming, {
      changeType,
      diff,
      restoredFromRevisionId
    });
    await this.repository.writeResourceRevision(base.id, advanced.revision.id, advanced.revision);
    await this.repository.writeResource(base.id, advanced.resource);
    return structuredClone(advanced.resource);
  }

  async listResourceRevisions(resourceId) {
    const id = normalizeId(resourceId);
    if (!id) return null;
    const current = await this.getResource(id);
    if (!current) return null;
    const versioned = await this.ensureCurrentRevision(current);
    const revisions = await this.repository.listResourceRevisions(id);
    return {
      resource: structuredClone(versioned),
      revisions: revisions
        .sort((left, right) => Number(right.number || 0) - Number(left.number || 0))
        .map(({ snapshot: _snapshot, ...revision }) => ({
          ...structuredClone(revision),
          current: revision.id === versioned.revision?.headId
        }))
    };
  }

  async rollbackResource(resourceId, revisionId) {
    const id = normalizeId(resourceId);
    const targetId = normalizeId(revisionId);
    if (!id || !targetId) return null;
    const current = await this.getResource(id);
    if (!current) return null;
    const versioned = await this.ensureCurrentRevision(current);
    if (versioned.revision?.headId === targetId) {
      throw new Error('RESOURCE_REVISION_ALREADY_CURRENT');
    }
    const target = await this.repository.getResourceRevision(id, targetId);
    if (!target) throw new Error('RESOURCE_REVISION_NOT_FOUND');
    const prepared = this.revisionService.restore(versioned, target);
    await this.repository.writeResourceRevision(id, prepared.revision.id, prepared.revision);
    await this.repository.writeResource(id, prepared.resource);
    return structuredClone(prepared.resource);
  }

  async exportResourceBundle(resourceIds = []) {
    const ids = uniqueStrings(resourceIds).map(normalizeId).filter(Boolean).slice(0, 500);
    const resources = [];
    const missing = [];
    for (const id of ids) {
      const resource = await this.getResource(id);
      if (resource) resources.push(resource);
      else missing.push(id);
    }
    return {
      schema: 'local-roleplay-agent.asset-bundle/v1',
      version: '1.0.0',
      appVersion: this.appVersion,
      exportedAt: this.now().toISOString(),
      resources: structuredClone(resources),
      missing
    };
  }

  async inspectPreview(preview, source = {}) {
    const adapters = await this.listAdapters();
    const adapter = resolveResourceAdapter({ preview, source, adapters });
    if (preview?.kind === 'plugin-manifest') {
      const inspection = await this.pluginRegistry.inspectManifest(preview.importData?.pluginManifest || {});
      return packageInspection(adapter, inspection, {
        kind: 'plugin',
        title: inspection.manifest.name,
        payload: inspection.manifest
      });
    }
    if (preview?.kind === 'content-pack') {
      const inspection = await this.inspectContentPackBundle(preview.importData?.contentPackBundle || {});
      const runtimeInspection = inspectImportedContentPackCompatibility(
        preview.importData?.contentPackBundle || {}
      );
      return {
        ...packageInspection(adapter, inspection, {
          kind: 'content-pack',
          title: inspection.manifest.title,
          payload: preview.importData?.contentPackBundle || {}
        }),
        communityCompatibility: runtimeInspection.communityCompatibility,
        compatibilityReview: runtimeInspection.compatibilityReview
      };
    }
    const candidates = buildPreviewCandidates(preview, source);
    const existing = await this.listResources();
    const evaluation = this.importService.inspectCandidates(candidates, existing, {
      source,
      adapter
    });
    const resources = evaluation.resources.map((resource, index) => {
      const candidate = candidates[index];
      const target = this.revisionService.findUpdateTarget(candidate, existing, source);
      if (!target) return resource;
      const incoming = {
        ...target,
        kind: candidate.kind,
        title: candidate.title,
        summary: candidate.summary,
        tags: candidate.tags,
        payload: structuredClone(candidate.payload),
        fingerprint: resource.fingerprint,
        diagnostics: resource.diagnostics,
        source: {
          ...(target.source || {}),
          ...source,
          version: String(source.version || candidate.version || target.source?.version || '')
        }
      };
      const update = this.revisionService.describeUpdate(target, incoming);
      return update?.available ? { ...resource, update } : resource;
    });
    return {
      adapter,
      ...evaluation,
      resources,
      updateCount: resources.filter((item) => item.update?.available).length,
    };
  }

  async savePreview(preview, source = {}, { inspection: suppliedInspection = null } = {}) {
    if (preview?.kind === 'plugin-manifest' || preview?.kind === 'content-pack') {
      throw new Error('PACKAGE_PREVIEW_REQUIRES_INSTALL');
    }
    const inspection = suppliedInspection || await this.inspectPreview(preview, source);
    const candidates = buildPreviewCandidates(preview, source);
    const existing = await this.listResources();
    const { importedAt, source: batchSource } = this.importService.createImportContext(source);
    const resources = [];

    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      const inspected = inspection.resources[index];
      const duplicate = existing.find((item) => item.kind === candidate.kind && item.fingerprint === inspected.fingerprint);
      const inspectedTargetId = normalizeId(inspected.update?.targetResourceId);
      let updateTarget = inspectedTargetId ? await this.getResource(inspectedTargetId) : null;
      const portraitTarget = updateTarget || duplicate;
      const portraitChanged = candidate.kind === 'character'
        && candidate.payload?.portrait?.url
        && candidate.payload.portrait.url !== portraitTarget?.payload?.portrait?.url;
      if (!updateTarget && duplicate && portraitChanged) {
        updateTarget = await this.getResource(duplicate.id);
      }

      if (updateTarget && (inspected.update?.available || portraitChanged)) {
        const replacementConflict = this.conflictService.findConflicts(candidate, existing, {
          excludeId: updateTarget.id
        });
        const replacementDiagnostics = this.evaluationService.evaluate(candidate, {
          conflicts: replacementConflict.conflicts,
          source: batchSource,
          adapter: inspection.adapter
        });
        const imported = this.importService.createResourceRecord(
          candidate,
          {
            ...inspected,
            fingerprint: replacementConflict.fingerprint,
            diagnostics: replacementDiagnostics
          },
          inspection.adapter,
          batchSource,
          importedAt
        );
        const incoming = {
          ...imported,
          id: updateTarget.id,
          title: updateTarget.title || imported.title,
          summary: updateTarget.summary || imported.summary,
          tags: uniqueStrings([...(updateTarget.tags || []), ...(imported.tags || [])]),
          collections: uniqueStrings(updateTarget.collections),
          favorite: updateTarget.favorite === true,
          createdAt: updateTarget.createdAt || imported.createdAt
        };
        const update = this.revisionService.describeUpdate(updateTarget, incoming);
        const updated = await this.commitResourceRevision(updateTarget, incoming, {
          changeType: portraitChanged && updateTarget.fingerprint === replacementConflict.fingerprint
            ? 'portrait-update'
            : 'upstream-update',
          diff: update?.diff
        });
        resources.push({ ...updated, importStatus: 'updated' });
        const existingIndex = existing.findIndex((item) => item.id === updated.id);
        if (existingIndex >= 0) existing[existingIndex] = updated;
        continue;
      }

      if (duplicate) {
        resources.push({ ...duplicate, importStatus: 'duplicate' });
        continue;
      }

      const resource = this.importService.createResourceRecord(
        candidate,
        inspected,
        inspection.adapter,
        batchSource,
        importedAt
      );
      const versioned = await this.persistInitialResource(resource);
      existing.push(versioned);
      resources.push({ ...versioned, importStatus: 'created' });
    }

    return { inspection, resources };
  }

  async savePromptResource(input = {}) {
    const prompt = normalizePromptModule({
      ...input,
      id: input.payload?.id || input.id,
      title: input.payload?.title || input.title,
      content: input.payload?.content || input.content,
      enabled: input.payload?.enabled ?? input.enabled ?? true
    });
    const preview = {
      kind: 'prompt-module',
      importData: { promptModule: prompt }
    };
    return this.savePreview(preview, input.source || {});
  }

  async removeResource(resourceId) {
    const id = normalizeId(resourceId);
    if (!id) return false;
    const removed = await this.repository.removeResource(id);
    if (removed) await this.repository.removeResourceRevisions(id);
    return removed;
  }

  async removeResources(resourceIds = []) {
    const ids = uniqueStrings(resourceIds).map(normalizeId).filter(Boolean).slice(0, 500);
    const removed = [];
    const missing = [];
    for (const id of ids) {
      if (await this.removeResource(id)) removed.push(id);
      else missing.push(id);
    }
    return { removed, missing };
  }

  async listPacks() {
    const packs = await this.loadStoredPacks();
    const plugins = await this.listPlugins();
    const knownPacks = [...this.listBuiltInPacks(), ...packs.map((pack) => ({
      id: pack.id,
      manifest: createContentPackManifest(pack)
    }))];
    return packs
      .map((pack) => {
        const compatibility = inspectContentPackBundle(createContentPackBundle(pack), {
          appVersion: this.appVersion,
          installedPlugins: plugins,
          contentPacks: knownPacks
        });
        return summarizeCustomPack(pack, compatibility);
      })
      .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));
  }

  async listPackCompatibilityOverview() {
    const packs = await this.loadStoredPacks();
    const items = [];
    for (const pack of packs) {
      try {
        items.push(await this.inspectPackStartReadiness(pack.id));
      } catch (error) {
        items.push({
          packId: pack.id,
          title: pack.title || pack.id,
          status: 'blocked',
          label: '复审失败',
          tone: 'error',
          reason: String(error?.message || '无法读取历史组装记录'),
          canStartNewStory: false,
          action: 'inspect',
          contractVersion: Number(
            pack.resourceManifest?.composition?.compatibilityReview?.contractVersion || 0
          ),
          scriptCount: 0,
          disabledCapabilityCount: 0,
          changedRevisionCount: 0,
          unknownRevisionCount: 0,
          issues: [String(error?.code || error?.message || 'RESOURCE_PACK_UPGRADE_PREVIEW_FAILED')]
        });
      }
    }
    const summary = items.reduce((result, item) => {
      result.total += 1;
      if (item.status === 'audited') result.audited += 1;
      else if (item.status === 'safe-derivative') result.safeDerivative += 1;
      else if (item.status === 'upgrade-available') result.upgradeAvailable += 1;
      else if (item.status === 'script-review-required') result.scriptReviewRequired += 1;
      else result.blocked += 1;
      if (!item.canStartNewStory) result.attention += 1;
      return result;
    }, {
      total: 0,
      audited: 0,
      safeDerivative: 0,
      upgradeAvailable: 0,
      scriptReviewRequired: 0,
      blocked: 0,
      attention: 0
    });
    return {
      spec: 'lra.pack-compatibility-overview/v1',
      contractVersion: TAVERN_COMPATIBILITY_CONTRACT_VERSION,
      generatedAt: this.now().toISOString(),
      summary,
      packs: items.sort((left, right) => left.title.localeCompare(right.title, 'zh-CN'))
    };
  }

  async inspectPackStartReadiness(packId) {
    const pack = await this.getPack(packId);
    if (!pack) return null;
    if (pack.custom !== true) {
      return {
        packId: pack.id,
        title: pack.title || pack.id,
        status: 'native',
        label: '原生内容包',
        tone: 'native',
        reason: '由项目内置并随当前版本共同发布。',
        canStartNewStory: true,
        action: 'none',
        contractVersion: TAVERN_COMPATIBILITY_CONTRACT_VERSION,
        scriptCount: 0,
        disabledCapabilityCount: 0,
        changedRevisionCount: 0,
        unknownRevisionCount: 0,
        issues: []
      };
    }
    const audited = summarizeStoredPackCompatibilityAudit(pack);
    if (audited) return audited;
    return summarizePackCompatibilityUpgradePreview(
      await this.inspectPackCompatibilityUpgrade(pack.id)
    );
  }

  async getPack(packId) {
    const id = normalizeId(packId);
    if (!id) return null;
    const pack = await this.repository.getPack(id);
    if (!pack) return null;
    const openingTemplate = createCustomOpeningTemplate(pack);
    return {
      ...pack,
      worldSystems: pack.worldSystems || compileStructuredWorldSystems(pack.worldBook),
      openingTemplate,
      manifest: createContentPackManifest(pack)
    };
  }

  async inspectPackCompatibilityUpgrade(packId) {
    const id = normalizeId(packId);
    if (!id) return null;
    const sourcePack = await this.getPack(id);
    if (!sourcePack) return null;
    if (sourcePack.custom !== true) {
      throw createResourcePackUpgradeError('RESOURCE_PACK_UPGRADE_CUSTOM_ONLY');
    }
    const prepared = await this.preparePackCompatibilityUpgrade(sourcePack);
    const composition = prepared.rebuildable
      ? await this.inspectPackComposition(prepared.input, {
          basePack: prepared.basePack,
          resourceOverrides: prepared.resourceOverrides
        })
      : null;
    return {
      spec: 'lra.compatibility-upgrade-preview/v1',
      sourcePack: {
        id: sourcePack.id,
        title: sourcePack.title,
        version: sourcePack.manifest?.version || '1.0.0',
        createdAt: sourcePack.createdAt || '',
        compatibilityReview: structuredClone(
          sourcePack.resourceManifest?.composition?.compatibilityReview || null
        )
      },
      rebuildable: prepared.rebuildable,
      issues: structuredClone(prepared.issues),
      resourceRevisionChanges: structuredClone(prepared.resourceRevisionChanges),
      promptBundleMigration: structuredClone(prepared.promptBundleMigration),
      composition,
      compatibilityReview: structuredClone(composition?.compatibilityReview || null),
      assemblyInput: prepared.rebuildable ? structuredClone(prepared.assemblyInput) : null,
      requiresScriptApproval: Boolean(composition?.compatibilityReview?.requiresScriptApproval),
      createsNewPack: true,
      keepsExistingBindings: true
    };
  }

  async createPackCompatibilityUpgrade(packId, decision = {}) {
    const id = normalizeId(packId);
    if (!id) return null;
    const sourcePack = await this.getPack(id);
    if (!sourcePack) return null;
    if (sourcePack.custom !== true) {
      throw createResourcePackUpgradeError('RESOURCE_PACK_UPGRADE_CUSTOM_ONLY');
    }
    const prepared = await this.preparePackCompatibilityUpgrade(sourcePack);
    if (!prepared.rebuildable) {
      throw createResourcePackUpgradeError('RESOURCE_PACK_UPGRADE_NOT_REBUILDABLE', {
        issues: prepared.issues
      });
    }
    const title = normalizeLibraryText(
      decision.title,
      `${sourcePack.title || '自定义剧本'} · 兼容复审版`,
      80
    );
    const description = normalizeLibraryText(
      decision.description,
      `由“${sourcePack.title || sourcePack.id}”按酒馆兼容契约 v${TAVERN_COMPATIBILITY_CONTRACT_VERSION} 重新预检生成；旧剧本与会话未迁移。`,
      300
    );
    const pack = await this.createPack({
      ...prepared.input,
      title,
      description,
      sessionTitle: title,
      compatibilityReview: decision.compatibilityReview
    }, {
      basePack: prepared.basePack,
      resourceOverrides: prepared.resourceOverrides,
      persistResourceOverrides: true
    });
    pack.resourceManifest.compatibilityUpgrade = {
      sourcePackId: sourcePack.id,
      sourcePackTitle: sourcePack.title || sourcePack.id,
      sourcePackVersion: sourcePack.manifest?.version || '1.0.0',
      contractVersion: TAVERN_COMPATIBILITY_CONTRACT_VERSION,
      resourceRevisionChanges: structuredClone(prepared.resourceRevisionChanges),
      promptBundleMigration: structuredClone(prepared.promptBundleMigration),
      createdAt: this.now().toISOString()
    };
    await this.repository.writePack(pack.id, pack);
    return structuredClone(pack);
  }

  async preparePackCompatibilityUpgrade(sourcePack) {
    const manifest = isRecord(sourcePack?.resourceManifest) ? sourcePack.resourceManifest : {};
    const characterResourceId = normalizeId(manifest.characterResourceId);
    const worldBookResourceIds = uniqueStrings(manifest.worldBookResourceIds).map(normalizeId).filter(Boolean);
    const promptResourceIds = uniqueStrings(manifest.promptResourceIds).map(normalizeId).filter(Boolean);
    const resourceIds = uniqueStrings([
      characterResourceId,
      ...worldBookResourceIds,
      ...promptResourceIds
    ]).filter(Boolean);
    const resources = new Map();
    const issues = [];
    for (const resourceId of resourceIds) {
      const resource = await this.getResource(resourceId);
      if (resource) resources.set(resourceId, resource);
      else issues.push({
        code: 'RESOURCE_PACK_UPGRADE_RESOURCE_MISSING',
        resourceId,
        message: `原组装素材 ${resourceId} 已不在本地素材库中`
      });
    }

    const basePackId = normalizeId(manifest.basePackId);
    const basePack = basePackId
      ? this.resolveBuiltInPack(basePackId) || await this.getPack(basePackId)
      : null;
    if (basePackId && !basePack) {
      issues.push({
        code: 'RESOURCE_PACK_UPGRADE_BASE_MISSING',
        resourceId: basePackId,
        message: `原组装基线 ${basePackId} 已不存在`
      });
    }
    const expectedRevisions = isRecord(manifest.resourceRevisionIds)
      ? manifest.resourceRevisionIds
      : {};
    const sourceResources = new Map(
      (Array.isArray(manifest.sourceResources) ? manifest.sourceResources : [])
        .map((resource) => [normalizeId(resource?.id), resource])
        .filter(([resourceId]) => resourceId)
    );
    const resourceRevisionChanges = resourceIds
      .filter((resourceId) => resources.has(resourceId))
      .map((resourceId) => {
        const current = resources.get(resourceId);
        const source = sourceResources.get(resourceId);
        const expectedRevisionId = String(
          expectedRevisions[resourceId]
          || source?.revision?.id
          || ''
        );
        const currentRevisionId = String(current?.revision?.headId || '');
        const expectedFingerprint = String(source?.fingerprint || '');
        const currentFingerprint = String(current?.fingerprint || '');
        const hasRevisionComparison = Boolean(expectedRevisionId && currentRevisionId);
        const hasFingerprintComparison = Boolean(expectedFingerprint && currentFingerprint);
        const comparisonBasis = hasRevisionComparison
          ? 'revision'
          : hasFingerprintComparison
            ? 'fingerprint'
            : 'unknown';
        const changed = hasRevisionComparison
          ? expectedRevisionId !== currentRevisionId
          : hasFingerprintComparison
            ? expectedFingerprint !== currentFingerprint
            : false;
        return {
          resourceId,
          expectedRevisionId,
          currentRevisionId,
          expectedFingerprint,
          currentFingerprint,
          comparisonBasis,
          fingerprintConfirmed: comparisonBasis === 'fingerprint' && !changed,
          changed,
          revisionUnknown: comparisonBasis === 'unknown'
        };
      });
    const legacyPromptPlan = planLegacyPromptBundleMigrations(
      promptResourceIds.map((resourceId) => resources.get(resourceId)).filter(Boolean)
    );
    const preparedPromptBundles = await this.prepareLegacyPromptBundleResources(legacyPromptPlan.plans);
    const bundledPromptResourceIds = legacyPromptPlan.promptResourceIds.map((resourceId) => (
      preparedPromptBundles.targetIds.get(resourceId) || resourceId
    ));
    const baseInheritanceMode = String(manifest.baseInheritanceMode || '').trim()
      || (manifest.includeBaseContent === false ? 'none' : basePackId ? 'full' : 'none');
    const input = {
      creationMode: manifest.creationMode === 'independent-copy' ? 'independent-copy' : 'composed',
      basePackId,
      baseInheritanceMode,
      includeBaseContent: baseInheritanceMode !== 'none',
      worldBookMergeMode: manifest.worldBookMergeMode || 'smart',
      characterResourceId,
      worldBookResourceIds,
      promptResourceIds: bundledPromptResourceIds,
      visualPackId: String(sourcePack.visualPackId || 'neutral'),
      useCharacterPortraitAsBackground: manifest.useCharacterPortraitAsBackground === true
        || Boolean(
          characterResourceId
          && sourcePack.stageBackground?.url
          && sourcePack.stageBackground?.source === 'character-portrait'
        ),
      customBaseline: basePackId
        ? undefined
        : deriveCompatibilityUpgradeBaseline(sourcePack, manifest.customBaseline)
    };
    return {
      rebuildable: issues.length === 0,
      issues,
      resourceRevisionChanges,
      input,
      assemblyInput: {
        ...structuredClone(input),
        promptResourceIds
      },
      basePack,
      resourceOverrides: preparedPromptBundles.resourceOverrides,
      promptBundleMigration: preparedPromptBundles.summary
    };
  }

  async prepareLegacyPromptBundleResources(plans = []) {
    const sourcePlans = Array.isArray(plans) ? plans : [];
    const resourceOverrides = new Map();
    const targetIds = new Map();
    if (!sourcePlans.length) {
      return {
        resourceOverrides,
        targetIds,
        summary: {
          schema: 'local-roleplay-agent.prompt-bundle-migration-summary/v1',
          sourceResourceCount: 0,
          targetBundleCount: 0,
          moduleCount: 0,
          enabledModuleCount: 0,
          runtimeCompanionCount: 0,
          items: []
        }
      };
    }

    const existing = await this.listResources();
    const items = [];
    for (const plan of sourcePlans) {
      const duplicate = existing.find((resource) => (
        resource.kind === PROMPT_BUNDLE_KIND
        && resource.fingerprint === plan.fingerprint
      ));
      let resource = duplicate;
      let reusedExisting = Boolean(duplicate);
      if (!resource) {
        const adapter = {
          id: plan.sourceFormat || plan.source?.adapterId || 'sillytavern-prompt-preset'
        };
        const inspection = this.importService.inspectCandidates([plan.candidate], existing, {
          source: plan.source,
          adapter
        });
        const createdAt = String(plan.createdAt || plan.source?.importedAt || this.now().toISOString());
        const updatedAt = String(plan.updatedAt || createdAt);
        const record = this.importService.createResourceRecord(
          plan.candidate,
          inspection.resources[0],
          adapter,
          plan.source,
          createdAt
        );
        const initialized = this.revisionService.initialize({
          ...record,
          id: plan.resourceId,
          fingerprint: plan.fingerprint,
          createdAt,
          updatedAt,
          revision: {
            headId: plan.revisionId,
            number: 1,
            count: 1,
            changeType: 'legacy-prompt-bundle',
            changedAt: updatedAt
          },
          lineage: {
            kind: 'legacy-prompt-bundle',
            schema: plan.schema,
            sourceResourceIds: structuredClone(plan.sourceResourceIds)
          }
        }, { changeType: 'legacy-prompt-bundle' });
        resource = initialized.resource;
        resourceOverrides.set(resource.id, resource);
        reusedExisting = false;
      }
      targetIds.set(plan.resourceId, resource.id);
      items.push({
        title: plan.title,
        sourceResourceCount: plan.sourceResourceCount,
        targetResourceId: resource.id,
        moduleCount: plan.moduleCount,
        enabledModuleCount: plan.enabledModuleCount,
        runtimeCompanionCount: plan.runtimeCompanionCount,
        regexRuleCount: plan.regexRuleCount,
        reusedExisting
      });
    }
    return {
      resourceOverrides,
      targetIds,
      summary: {
        schema: 'local-roleplay-agent.prompt-bundle-migration-summary/v1',
        sourceResourceCount: items.reduce((sum, item) => sum + item.sourceResourceCount, 0),
        targetBundleCount: items.length,
        moduleCount: items.reduce((sum, item) => sum + item.moduleCount, 0),
        enabledModuleCount: items.reduce((sum, item) => sum + item.enabledModuleCount, 0),
        runtimeCompanionCount: items.reduce((sum, item) => sum + item.runtimeCompanionCount, 0),
        items
      }
    };
  }

  async updatePackMetadata(packId, input = {}) {
    const id = normalizeId(packId);
    if (!id) return null;
    const current = await this.getPack(id);
    if (!current) return null;
    const title = normalizeLibraryText(input.title, current.title, 80);
    const description = normalizeLibraryText(input.description, current.description, 300, { allowEmpty: true });
    const sessionTitle = normalizeLibraryText(input.sessionTitle, current.sessionTitle || title, 80);
    const next = {
      ...current,
      title,
      description,
      sessionTitle,
      manifest: {
        ...current.manifest,
        title,
        description
      },
      updatedAt: this.now().toISOString()
    };
    next.openingTemplate = createCustomOpeningTemplate(next);
    await this.repository.writePack(id, next);
    return structuredClone(next);
  }

  async createPack(input = {}, {
    basePack = null,
    resourceOverrides = new Map(),
    persistResourceOverrides = false
  } = {}) {
    const overrides = resourceOverrides instanceof Map ? resourceOverrides : new Map();
    const resolved = await this.resolvePackResources(input, { resourceOverrides: overrides });
    const selected = [];
    for (const resource of resolved.selected) {
      selected.push(overrides.has(resource.id)
        ? structuredClone(resource)
        : await this.ensureCurrentRevision(resource));
    }
    const character = selected.find((item) => item.id === input.characterResourceId && item.kind === 'character');
    const worldBooks = selected.filter((item) => item.kind === 'worldbook');
    const prompts = selected.filter((item) => item.kind === 'prompt' || item.kind === PROMPT_BUNDLE_KIND);
    const includeBaseContent = input.includeBaseContent !== false;
    const baseInheritanceMode = basePack
      ? this.storyComposition.normalizeBaseInheritanceMode(input.baseInheritanceMode, includeBaseContent)
      : includeBaseContent ? 'full' : 'none';
    const id = `custom-${crypto.randomUUID()}`;
    const timestamp = this.now().toISOString();
    const base = basePack
      ? structuredClone(basePack)
      : createCustomBaselineSeed(id, input.customBaseline, this.now);
    const inheritedWorldBook = this.storyComposition.selectInheritedWorldBook(base.worldBook, baseInheritanceMode);
    const inheritedPromptModules = this.storyComposition.selectInheritedPromptModules(base.promptModules, baseInheritanceMode);
    const worldBookMergeMode = baseInheritanceMode !== 'none'
      ? this.storyComposition.normalizeWorldBookMergeMode(input.worldBookMergeMode)
      : 'resources-only';
    const composition = this.storyComposition.composeWorldBookEntries({
      baseEntries: inheritedWorldBook,
      resourceGroups: worldBooks.map((item) => ({
        resourceId: item.id,
        title: item.title,
        entries: item.payload?.entries || []
      })),
      mode: worldBookMergeMode
    });
    const promptComposition = this.storyComposition.composePromptModules({
      baseModules: inheritedPromptModules,
      resources: prompts
    });
    const promptModules = promptComposition.modules;
    const communityCompatibility = aggregateCommunityCompatibility(
      selected.map((item) => item.diagnostics?.communityCompatibility)
    );
    const playableWorldBook = compilePlayableWorldBook(composition.entries);
    const playableCharacter = character?.payload
      ? compilePlayableCharacterCard(character.payload)
      : null;
    const characterCard = playableCharacter?.card
      || (baseInheritanceMode === 'none' ? {} : base.characterCard);
    const lightFrontend = mergeLightFrontendRuntimes([
      baseInheritanceMode === 'full' ? base.lightFrontend || {} : {},
      ...selected.flatMap((item) => {
        const promptModules = expandPromptResourceModules(item);
        const payloads = promptModules.length ? promptModules : [item.payload || {}];
        return payloads.map((payload) => extractLightFrontendRuntime(payload));
      })
    ]);
    const compatibilityReview = createPackCompatibilityReview({
      base,
      selected,
      communityCompatibility,
      lightFrontend,
      promptModules,
      roleplayMode: input.roleplayMode || 'dm'
    });
    const compatibilityReviewRecord = applyPackCompatibilityReview(
      lightFrontend,
      input.compatibilityReview,
      compatibilityReview,
      () => this.now()
    );
    if (persistResourceOverrides) {
      for (const resource of overrides.values()) {
        const current = await this.getResource(resource.id);
        if (current) {
          if (current.fingerprint !== resource.fingerprint) {
            throw createResourcePackUpgradeError('RESOURCE_PACK_UPGRADE_BUNDLE_CHANGED', {
              resourceId: resource.id
            });
          }
          continue;
        }
        await this.persistInitialResource(resource, { changeType: 'legacy-prompt-bundle' });
      }
    }
    const stageBackground = input.useCharacterPortraitAsBackground === true
      ? createCharacterStageBackground(characterCard, character?.title)
      : null;

    const pack = {
      ...base,
      id,
      title: String(input.title || '自定义剧本').trim().slice(0, 80),
      description: String(input.description || '由本地素材库组合生成。').trim().slice(0, 300),
      sessionTitle: String(input.sessionTitle || input.title || '新的故事').trim().slice(0, 80),
      characterCard: normalizeCharacterCard(characterCard || {}),
      characterPresets: baseInheritanceMode === 'full' && Array.isArray(base.characterPresets)
        ? structuredClone(base.characterPresets)
        : [],
      groupMembers: baseInheritanceMode === 'full' && Array.isArray(base.groupMembers)
        ? structuredClone(base.groupMembers)
        : [],
      stageBackground,
      worldBook: playableWorldBook.entries.map(normalizeWorldBookEntry),
      worldSystems: structuredClone(playableWorldBook.worldSystems),
      promptModules: promptModules.map(normalizePromptModule),
      lightFrontend,
      memory: this.storyComposition.createComposedMemory(base, id, baseInheritanceMode),
      ruleSystem: this.storyComposition.createComposedRuleSystem(base, id, baseInheritanceMode, basePack?.id || ''),
      visualPackId: String(input.visualPackId || base.visualPackId || base.id || 'neutral'),
      custom: true,
      resourceManifest: {
        creationMode: input.creationMode === 'independent-copy' ? 'independent-copy' : 'composed',
        customBaseline: basePack ? null : normalizeCustomBaseline(input.customBaseline),
        basePackId: baseInheritanceMode === 'none' ? '' : basePack?.id || '',
        includeBaseContent: baseInheritanceMode !== 'none',
        baseInheritanceMode,
        worldBookMergeMode,
        characterResourceId: character?.id || '',
        worldBookResourceIds: worldBooks.map((item) => item.id),
        promptResourceIds: prompts.map((item) => item.id),
        useCharacterPortraitAsBackground: input.useCharacterPortraitAsBackground === true,
        resourceRevisionIds: Object.fromEntries(selected.map((item) => [
          item.id,
          item.revision?.headId || ''
        ])),
        sourceResources: selected.map(summarizePackSourceResource),
        composition: {
          ...structuredClone(composition.report.summary),
          promptModules: structuredClone(promptComposition.report.summary),
          communityCompatibility,
          compatibilityReview: compatibilityReviewRecord,
          playableCharacter: playableCharacter?.report || null,
          playableWorldBook: playableWorldBook.report
        }
      },
      createdAt: timestamp,
      updatedAt: timestamp
    };
    pack.openingTemplate = createCustomOpeningTemplate(pack);
    pack.manifest = createContentPackManifest(pack, {
      version: input.version || '1.0.0',
      engine: input.engine || '>=0.2.2 <1.0.0',
      manifestId: id,
      dependencies: [
        ...(pack.resourceManifest.basePackId
          ? [{ kind: 'content-pack', id: pack.resourceManifest.basePackId, range: '^1.0.0', optional: false, scope: 'build' }]
          : []),
        ...(Array.isArray(input.pluginDependencies) ? input.pluginDependencies : [])
      ]
    });
    await this.repository.writePack(id, pack);
    return structuredClone(pack);
  }

  async inspectPackComposition(input = {}, { basePack = null, resourceOverrides = new Map() } = {}) {
    const overrides = resourceOverrides instanceof Map ? resourceOverrides : new Map();
    const resolved = await this.resolvePackResources(input, { resourceOverrides: overrides });
    const selected = [];
    for (const resource of resolved.selected) {
      selected.push(overrides.has(resource.id)
        ? structuredClone(resource)
        : await this.ensureCurrentRevision(resource));
    }
    const character = selected.find((item) => item.id === input.characterResourceId && item.kind === 'character');
    const worldBooks = selected.filter((item) => item.kind === 'worldbook');
    const prompts = selected.filter((item) => item.kind === 'prompt' || item.kind === PROMPT_BUNDLE_KIND);
    const includeBaseContent = input.includeBaseContent !== false;
    const baseInheritanceMode = basePack
      ? this.storyComposition.normalizeBaseInheritanceMode(input.baseInheritanceMode, includeBaseContent)
      : includeBaseContent ? 'full' : 'none';
    const base = basePack
      ? structuredClone(basePack)
      : createCustomBaselineSeed('custom-preview', input.customBaseline, this.now);
    const inheritedWorldBook = this.storyComposition.selectInheritedWorldBook(base.worldBook, baseInheritanceMode);
    const inheritedPromptModules = this.storyComposition.selectInheritedPromptModules(base.promptModules, baseInheritanceMode);
    const mode = baseInheritanceMode !== 'none'
      ? this.storyComposition.normalizeWorldBookMergeMode(input.worldBookMergeMode)
      : 'resources-only';
    const composition = this.storyComposition.composeWorldBookEntries({
      baseEntries: inheritedWorldBook,
      resourceGroups: worldBooks.map((item) => ({
        resourceId: item.id,
        title: item.title,
        entries: item.payload?.entries || []
      })),
      mode
    });
    const promptComposition = this.storyComposition.composePromptModules({
      baseModules: inheritedPromptModules,
      resources: prompts
    });
    const communityCompatibility = aggregateCommunityCompatibility(
      [character, ...worldBooks, ...prompts]
        .filter(Boolean)
        .map((item) => item.diagnostics?.communityCompatibility)
    );
    const lightFrontend = mergeLightFrontendRuntimes([
      baseInheritanceMode === 'full' ? base.lightFrontend || {} : {},
      ...selected.flatMap((item) => {
        const promptModules = expandPromptResourceModules(item);
        const payloads = promptModules.length ? promptModules : [item.payload || {}];
        return payloads.map((payload) => extractLightFrontendRuntime(payload));
      })
    ]);
    const compatibilityReview = createPackCompatibilityReview({
      base,
      selected,
      communityCompatibility,
      lightFrontend,
      promptModules: promptComposition.modules,
      roleplayMode: input.roleplayMode || 'dm'
    });
    const playableWorldBook = compilePlayableWorldBook(composition.entries);
    const playableCharacter = character?.payload
      ? compilePlayableCharacterCard(character.payload)
      : null;
    return {
      mode: composition.report.mode,
      baseInheritanceMode,
      summary: {
        ...composition.report.summary,
        ...promptComposition.report.summary
      },
      conflicts: [
        ...composition.report.conflicts,
        ...promptComposition.report.conflicts
      ],
      selected: {
        characterResourceId: character?.id || '',
        worldBookResourceIds: worldBooks.map((item) => item.id),
        promptResourceIds: prompts.map((item) => item.id)
      },
      promptModules: {
        base: inheritedPromptModules.length,
        selected: prompts.length,
        final: promptComposition.modules.length
      },
      playableCharacter: playableCharacter?.report || null,
      playableWorldBook: playableWorldBook.report,
      communityCompatibility,
      compatibilityReview
    };
  }

  async resolvePackResources(input = {}, { resourceOverrides = new Map() } = {}) {
    const overrides = resourceOverrides instanceof Map ? resourceOverrides : new Map();
    const selectedIds = uniqueStrings([
      input.characterResourceId,
      ...(Array.isArray(input.worldBookResourceIds) ? input.worldBookResourceIds : []),
      ...(Array.isArray(input.promptResourceIds) ? input.promptResourceIds : [])
    ]);
    const selected = [];
    for (const resourceId of selectedIds) {
      const resource = overrides.get(resourceId) || await this.getResource(resourceId);
      if (!resource) throw new Error(`RESOURCE_NOT_FOUND:${resourceId}`);
      selected.push(resource);
    }

    const character = selected.find((item) => item.id === input.characterResourceId && item.kind === 'character');
    const worldBooks = selected.filter((item) => item.kind === 'worldbook');
    const prompts = selected.filter((item) => item.kind === 'prompt' || item.kind === PROMPT_BUNDLE_KIND);
    return { character, worldBooks, prompts, selected };
  }

  async inspectContentPackBundle(bundle, { checkInstallConflicts = true } = {}) {
    const plugins = await this.listPlugins();
    const storedPacks = await this.loadStoredPacks();
    const builtInPacks = this.listBuiltInPacks();
    const knownPacks = [
      ...builtInPacks,
      ...storedPacks.map((pack) => ({ id: pack.id, manifest: createContentPackManifest(pack) }))
    ];
    const inspection = inspectContentPackBundle(bundle, {
      appVersion: this.appVersion,
      installedPlugins: plugins,
      contentPacks: knownPacks
    });
    const builtInConflict = checkInstallConflicts
      ? builtInPacks.find((pack) => String(pack.manifest?.id || pack.id) === inspection.manifest.id)
      : null;
    if (builtInConflict) {
      inspection.blockingIssues.push({
        code: 'content-pack-core-conflict',
        message: `内容包 ID ${inspection.manifest.id} 与内置剧本冲突。`,
        path: 'manifest.id'
      });
    }
    const existing = checkInstallConflicts
      ? storedPacks.find((pack) => createContentPackManifest(pack).id === inspection.manifest.id)
      : null;
    inspection.installAction = 'create';
    if (existing) {
      const existingManifest = createContentPackManifest(existing);
      const comparison = compareSemver(inspection.manifest.version, existingManifest.version);
      if (comparison === 0) {
        inspection.installAction = 'duplicate';
        inspection.warnings.push({
          code: 'content-pack-version-installed',
          message: `版本 ${inspection.manifest.version} 已安装。`,
          path: 'manifest.version'
        });
      } else if (comparison < 0) {
        inspection.installAction = 'downgrade';
        inspection.blockingIssues.push({
          code: 'content-pack-downgrade-blocked',
          message: `已安装 ${existingManifest.version}，默认禁止降级到 ${inspection.manifest.version}。`,
          path: 'manifest.version'
        });
      } else {
        inspection.installAction = 'update';
      }
      inspection.existingPackId = existing.id;
      inspection.existingVersion = existingManifest.version;
    }
    refreshPackageVerdict(inspection, '内容包');
    return inspection;
  }

  async inspectPackCompatibility(pack) {
    const bundle = createContentPackBundle(pack);
    return this.inspectContentPackBundle(bundle, { checkInstallConflicts: false });
  }

  async installContentPackBundle(bundle, source = {}, {
    inspection: suppliedInspection = null,
    compatibilityReview: compatibilityDecision = null
  } = {}) {
    const inspection = suppliedInspection || await this.inspectContentPackBundle(bundle);
    if (!inspection.canInstall) {
      const error = new Error('CONTENT_PACK_INCOMPATIBLE');
      error.inspection = inspection;
      throw error;
    }
    if (inspection.installAction === 'duplicate' && inspection.existingPackId) {
      return {
        pack: await this.getPack(inspection.existingPackId),
        installStatus: 'duplicate',
        inspection
      };
    }

    const internalId = inspection.existingPackId || createImportedPackId(inspection.manifest.id);
    const timestamp = this.now().toISOString();
    const existing = inspection.existingPackId ? await this.getPack(inspection.existingPackId) : null;
    const pack = contentPackFromBundle(bundle, internalId, { importedAt: timestamp, source });
    const runtimeInspection = inspectImportedContentPackCompatibility(bundle);
    pack.lightFrontend = runtimeInspection.lightFrontend;
    const compatibilityReview = applyPackCompatibilityReview(
      pack.lightFrontend,
      compatibilityDecision,
      runtimeInspection.compatibilityReview,
      () => this.now()
    );
    pack.resourceManifest.composition = {
      communityCompatibility: runtimeInspection.communityCompatibility,
      compatibilityReview
    };
    if (!pack.openingTemplate) pack.openingTemplate = createCustomOpeningTemplate(pack);
    if (existing?.createdAt) pack.createdAt = existing.createdAt;
    await this.repository.writePack(internalId, pack);
    return {
      pack: structuredClone(pack),
      installStatus: inspection.installAction === 'update' ? 'updated' : 'created',
      inspection
    };
  }

  async installPluginManifest(manifest) {
    return this.pluginRegistry.installManifest(manifest);
  }

  async setPluginEnabled(pluginId, enabled) {
    return this.pluginRegistry.setEnabled(pluginId, enabled);
  }

  async removePlugin(pluginId) {
    return this.pluginRegistry.removePlugin(pluginId);
  }

  async exportPackBundle(packId) {
    const pack = this.resolveBuiltInPack(packId) || await this.getPack(packId);
    return pack ? createContentPackBundle(pack) : null;
  }

  async removePack(packId) {
    const id = normalizeId(packId);
    if (!id || !await this.getPack(id)) return false;
    return this.repository.removePack(id);
  }

  async loadStoredPacks() {
    return this.repository.listPacks();
  }
}

function buildPreviewCandidates(preview, source) {
  if (preview?.kind === 'character-card') {
    const entries = Array.isArray(preview.importData?.worldBook) ? preview.importData.worldBook : [];
    const card = enrichCharacterCard(
      normalizeCharacterCard(preview.importData?.characterCard || {}),
      { worldBookEntries: entries }
    ).card;
    const candidates = [{
      kind: 'character',
      title: card.name || '未命名角色',
      summary: summarizeText(card.description || card.personality || card.scenario),
      tags: card.tags || [],
      payload: card,
      hasEmbeddedPortrait: preview.summary?.hasEmbeddedPortrait === true,
      version: card.characterVersion
    }];
    if (entries.length) candidates.push(buildWorldBookCandidate(entries, source.title || `${card.name}的设定集`));
    return candidates;
  }

  if (preview?.kind === 'world-book') {
    return [buildWorldBookCandidate(preview.importData?.worldBook || [], source.title || preview.title || '导入的世界书')];
  }

  if (preview?.kind === 'prompt-module') {
    const prompt = normalizePromptModule(preview.importData?.promptModule || {});
    return [{
      kind: 'prompt',
      title: prompt.title,
      summary: summarizeText(prompt.content),
      tags: [],
      payload: prompt,
      version: source.version
    }];
  }

  if (preview?.kind === 'prompt-preset' || preview?.kind === 'regex-preset') {
    const preset = preview.importData?.promptPreset || {};
    const prompts = Array.isArray(preview.importData?.promptModules)
      ? preview.importData.promptModules
      : [];
    const promptModules = prompts.map((item) => normalizePromptModule(item));
    const runtimeCompanions = promptModules.filter((prompt) => (
      prompt.extensions?.sillyTavernRuntimeCompanion
    ));
    const regexRuleCount = runtimeCompanions.reduce((sum, prompt) => (
      sum + Number(prompt.extensions?.sillyTavernRuntimeCompanion?.ruleCount || 0)
    ), 0);
    const title = String(preset.title || preview.title || source.title || '导入的预设').trim();
    return [{
      kind: PROMPT_BUNDLE_KIND,
      title,
      summary: [
        `${promptModules.length} 个内部模块`,
        runtimeCompanions.length ? `${runtimeCompanions.length} 个运行伴侣` : '',
        regexRuleCount ? `${regexRuleCount} 条 Regex 规则` : ''
      ].filter(Boolean).join(' · '),
      tags: uniqueStrings([
        'SillyTavern',
        preview.kind === 'regex-preset' ? 'Regex 配套' : '提示词预设',
        runtimeCompanions.length ? '安全运行时' : '',
        preset.sourceFormat
      ]),
      collections: uniqueStrings([title]),
      payload: createPromptBundlePayload({
        title,
        sourceKind: preview.kind,
        preset,
        promptModules
      }),
      version: source.version
    }];
  }

  throw new Error('UNSUPPORTED_RESOURCE_PREVIEW');
}

function buildWorldBookCandidate(entries, title) {
  const normalized = (Array.isArray(entries) ? entries : []).map(normalizeWorldBookEntry);
  return {
    kind: 'worldbook',
    title: String(title || '导入的世界书').trim(),
    summary: `${normalized.length} 条设定 · ${uniqueStrings(normalized.flatMap((entry) => entry.keywords || [])).slice(0, 4).join('、') || '常驻规则'}`,
    tags: uniqueStrings(normalized.flatMap((entry) => entry.keywords || [])).slice(0, 12),
    payload: { entries: normalized },
    version: ''
  };
}

function diagnoseCandidate(candidate, conflicts, options = {}) {
  return evaluateResourceCandidate(candidate, { conflicts, ...options });
}

function withRuntimeContextEstimate(resource = {}) {
  if (resource.kind === 'worldbook') {
    const runtimeProfile = estimateWorldBookRuntimeProfile(resource.payload?.entries || []);
    const storedPayloadEstimatedTokens = Number(resource.diagnostics?.storedPayloadEstimatedTokens
      ?? resource.diagnostics?.estimatedTokens
      ?? 0);
    return {
      ...resource,
      diagnostics: {
        ...(resource.diagnostics || {}),
        estimatedTokens: runtimeProfile.estimatedPerTurnTokens,
        storedPayloadEstimatedTokens,
        worldBookRuntime: runtimeProfile
      }
    };
  }
  if (resource.kind !== 'character') return resource;
  const runtimeEstimatedTokens = estimateResourceTokens(resource.payload, { kind: 'character' });
  const storedPayloadEstimatedTokens = Number(resource.diagnostics?.estimatedTokens || 0);
  if (!storedPayloadEstimatedTokens || storedPayloadEstimatedTokens === runtimeEstimatedTokens) return resource;
  return {
    ...resource,
    diagnostics: {
      ...(resource.diagnostics || {}),
      estimatedTokens: runtimeEstimatedTokens,
      storedPayloadEstimatedTokens
    }
  };
}

function summarizePackSourceResource(resource = {}) {
  const source = resource.source || {};
  return {
    id: String(resource.id || '').trim(),
    kind: String(resource.kind || '').trim(),
    title: String(resource.title || '').trim(),
    fingerprint: String(resource.fingerprint || '').trim(),
    revision: {
      id: String(resource.revision?.headId || '').trim(),
      number: Number(resource.revision?.number || 1),
      changedAt: String(resource.revision?.changedAt || resource.updatedAt || '').trim(),
      securityReview: structuredClone(resource.revision?.securityReview || {})
    },
    source: {
      adapterId: String(source.adapterId || '').trim(),
      community: String(source.community || '').trim(),
      site: String(source.site || '').trim(),
      url: String(source.url || '').trim(),
      author: String(source.author || '').trim(),
      license: String(source.license || '').trim(),
      version: String(source.version || '').trim(),
      fileName: String(source.fileName || '').trim(),
      importedAt: String(source.importedAt || '').trim(),
      originalHash: String(source.originalHash || '').trim()
    }
  };
}

function summarizeCustomPack(pack, compatibility = null) {
  const manifest = summarizeContentPackManifest(pack);
  const openingTemplate = createCustomOpeningTemplate(pack);
  return {
    id: pack.id,
    title: pack.title,
    description: pack.description,
    sessionTitle: pack.sessionTitle,
    characterName: pack.characterCard?.name || '',
    characterPortrait: structuredClone(pack.characterCard?.portrait || null),
    stageBackground: structuredClone(pack.stageBackground || null),
    openingTemplate: structuredClone(openingTemplate),
    custom: true,
    visualPackId: pack.visualPackId || pack.resourceManifest?.basePackId || '',
    basePackId: pack.resourceManifest?.basePackId || '',
    updatedAt: pack.updatedAt,
    manifest,
    version: manifest.version,
    compatibility: compatibility ? {
      compatible: compatibility.compatible,
      verdict: compatibility.verdict,
      verdictLabel: compatibility.verdictLabel,
      blockingCount: compatibility.blockingIssues.length,
      warningCount: compatibility.warnings.length
    } : null,
    counts: {
      promptModules: pack.promptModules?.length || 0,
      worldBook: pack.worldBook?.length || 0,
      memoryCards: pack.memory?.memoryCards?.length || 0,
      characterPresets: 1
    },
    resourceManifest: structuredClone(pack.resourceManifest || {})
  };
}

function createCustomOpeningTemplate(pack = {}) {
  const character = pack.characterCard || {};
  const visibleEntries = (Array.isArray(pack.worldBook) ? pack.worldBook : [])
    .filter((entry) => entry && entry.enabled !== false)
    .filter((entry) => {
      const visibility = entry?.extensions?.visibility || entry?.visibility || 'player';
      return visibility !== 'gm' && entry?.extensions?.gmOnly !== true;
    })
    .map((entry, index) => {
      const title = normalizeOpeningEntryTitle(entry.title || entry.id, character.name);
      const content = summarizeOpeningText(entry.content, 260);
      return {
        entry,
        index,
        title,
        content,
        score: scoreOpeningEntry(entry, title, content)
      };
    })
    .filter((item) => item.title && item.content)
    .filter((item) => !isOpeningMetaEntry(item.title))
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const genre = inferCustomOpeningGenre(pack, visibleEntries);
  const protagonist = inferCustomOpeningProtagonist(character, visibleEntries);
  const packTitle = String(pack.title || character.name || '自定义剧本').trim().slice(0, 80);
  const characterName = String(character.name || '').trim();
  const narrativeLead = summarizeOpeningText(
    character.scenario
      || pack.description
      || visibleEntries[0]?.content
      || character.description
      || character.firstMessage,
    140
  );
  const tabs = buildCustomOpeningTabs(visibleEntries, character);
  const destinyCards = buildCustomDestinyCards(visibleEntries);

  return {
    source: 'custom-pack',
    packId: String(pack.id || ''),
    genre,
    genreLabel: '角色卡原生剧本',
    title: packTitle,
    subtitle: protagonist.mode === 'scenario-role'
      ? `${protagonist.role || protagonist.name || '玩家身份'} · ${characterName || '场景角色卡'}`
      : (characterName ? `${characterName} · 独立角色剧本` : '角色卡世界 · 独立开局'),
    tagline: narrativeLead || '以当前角色卡、世界书与已选设定为边界，生成这段故事的第一幕。',
    buttonText: '[ 封存当前设定 · 开始故事 ]',
    tabs,
    protagonist,
    fields: buildCustomOpeningFields(character, visibleEntries, protagonist),
    destinyCards: {
      stepLabel: '开局要素',
      counterLabel: '要素',
      sectionLabel: '已选开局要素',
      label: `开局要素 · ${packTitle}`,
      hint: destinyCards.length
        ? '基础设定会自动加载；这里只选择真正可选的开局目标、危机、关系或机缘。'
        : '基础设定会自动加载；当前角色卡没有定义额外的可选开局要素。',
      maxSelections: Math.min(2, destinyCards.length),
      cards: destinyCards
    },
    sidebar: {
      tabs: customOpeningSidebarTabs(genre, protagonist)
    }
  };
}

function inferCustomOpeningGenre(pack, entries = []) {
  const character = pack.characterCard || {};
  const primaryEvidence = [
    pack.title,
    pack.description,
    pack.sessionTitle,
    character.name,
    character.description,
    character.personality,
    character.scenario,
    ...(character.tags || [])
  ].filter(Boolean).join(' ');
  const entryTitles = entries.slice(0, 32).map((item) => item.title).filter(Boolean).join(' ');
  const entryContents = entries.slice(0, 20).map((item) => item.content).filter(Boolean).join(' ');
  const visualGenre = String(pack.visualPackId || pack.resourceManifest?.basePackId || '').trim();
  const patterns = {
    yingxiongzhi: /英雄志|怒苍|正统军|五朝旧账/,
    mingmo: /明末|崇祯|大明|辽东|密诏|饷银|东林/,
    lingyi: /灵异|恐怖|诡异|怪谈|鬼怪|鬼物|鬼魂|阴阳|禁忌|凶宅|民俗|邪祟|诅咒/,
    xianxia: /修仙|仙侠|仙途|飞升|灵根|金丹|元婴|宗门|道侣|炉鼎|灵气|渡劫|境界|功法|法宝/,
    xuanhuan: /玄幻|武道|斗气|魔法|异界|神荒|江湖|武侠/
  };
  const scores = Object.fromEntries(Object.keys(patterns).map((genre) => [genre, 0]));
  Object.entries(patterns).forEach(([genre, pattern]) => {
    scores[genre] += countOpeningGenreMatches(primaryEvidence, pattern) * 5;
    scores[genre] += countOpeningGenreMatches(entryTitles, pattern) * 2;
    scores[genre] += Math.min(8, countOpeningGenreMatches(entryContents, pattern) * 0.25);
  });
  if (Object.hasOwn(scores, visualGenre)) scores[visualGenre] += 4;
  return Object.entries(scores)
    .sort((left, right) => right[1] - left[1])
    .find(([, score]) => score > 0)?.[0] || 'xuanhuan';
}

function inferCustomOpeningProtagonist(character, entries = []) {
  const openingConfig = character.extensions?.local_roleplay_agent?.opening || {};
  const profileEntry = findCustomProtagonistEntry(entries);
  const profileText = String(profileEntry?.entry?.content || '');
  const sourceText = [
    character.scenario,
    character.firstMessage,
    ...(Array.isArray(character.alternateGreetings) ? character.alternateGreetings : [])
  ].filter(Boolean).join('\n');
  const authoredName = extractOpeningProfileValue(profileText, ['姓名', '名字', '称谓']);
  const authoredRole = extractOpeningProfileValue(profileText, ['角色', '当前身份', '身份']);
  const configuredMode = String(openingConfig.protagonistMode || '').trim().toLowerCase();
  const placeholderRole = !character.role || character.role === '个人创作主角';
  const addressee = inferOpeningAddressee(sourceText);
  const looksLikeScenarioCard = /之家|庄园|世界|群像|剧本|沙盒|模拟/.test(String(character.name || ''))
    || /收件人|提交人|部门架构|人员配置|财务报表|庄园当前/.test(sourceText);
  const scenarioRole = ['scenario', 'scenario-role', 'world', 'group'].includes(configuredMode)
    || (!profileEntry && placeholderRole && Boolean(addressee) && looksLikeScenarioCard);
  const fixed = configuredMode === 'fixed' || openingConfig.requiresGeneration === false;

  if (scenarioRole) {
    const name = authoredName || addressee || '主角';
    const role = authoredRole || inferScenarioPlayerRole(name, sourceText);
    return {
      mode: 'scenario-role',
      label: '角色卡已定义玩家身份，可直接确认或编辑',
      name,
      role,
      allowSystemRandom: false,
      canSkipGeneration: true
    };
  }

  return {
    mode: fixed ? 'fixed' : (profileEntry ? 'authored' : 'character'),
    label: fixed ? '角色卡已给定主角资料，可直接开始' : '资料来自当前角色卡与同批世界书',
    name: authoredName || String(character.name || '').trim(),
    role: authoredRole || (placeholderRole ? '' : summarizeOpeningText(character.role, 90)),
    allowSystemRandom: openingConfig.allowSystemRandom === true,
    canSkipGeneration: true
  };
}

function inferOpeningAddressee(content) {
  const source = String(content || '').replace(/[*_`【】]/g, '');
  const explicit = source.match(/(?:收件人|玩家身份|用户身份|对用户称呼|称呼)\s*[：:]\s*([^\s，,。；;：:\n]{1,16})/);
  if (explicit?.[1]) return explicit[1].trim();
  if (/\{\{\s*user\s*\}\}/i.test(source)) return '主角';
  if (/(?:^|[，。；：:\s])主人(?:[，。；：:\s]|$)/.test(source)) return '主人';
  return '';
}

function inferScenarioPlayerRole(addressee, content) {
  const source = String(content || '');
  if (addressee === '主人' && /庄园/.test(source)) return '庄园主人';
  if (/调查|案件|证据|现场/.test(source)) return `${addressee || '主角'} / 调查参与者`;
  return `${addressee || '主角'} / 当前故事参与者`;
}

function countOpeningGenreMatches(text, pattern) {
  const matches = String(text || '').match(new RegExp(pattern.source, 'g'));
  return matches?.length || 0;
}

function buildCustomOpeningTabs(entries, character) {
  const selected = entries.slice(0, 5);
  const fallbacks = [
    ['character', '角色底稿', character.description],
    ['personality', '性格与边界', character.personality],
    ['scenario', '开局场景', character.scenario],
    ['first-message', '初始引子', character.firstMessage]
  ].filter(([, , content]) => summarizeOpeningText(content, 260));
  const sections = selected.length ? selected.map((item, index) => [
    `worldbook-${index + 1}`,
    item.title,
    item.content
  ]) : fallbacks;

  return Object.fromEntries(sections.map(([key, label, content]) => [
    key,
    { label, content: summarizeOpeningText(content, 260) }
  ]));
}

function buildCustomOpeningFields(character, entries = [], protagonist = inferCustomOpeningProtagonist(character, entries)) {
  const profileText = findCustomProtagonistEntry(entries)?.entry?.content || '';
  const openingText = selectCharacterOpeningText(character);
  const generatedFields = character.extensions?.local_roleplay_agent?.enrichment?.generatedFields || [];
  const authoredScenario = generatedFields.includes('scenario')
    ? ''
    : summarizeOpeningText(character.scenario, 110);
  const role = protagonist.role
    || extractOpeningProfileValue(profileText, ['角色', '当前身份', '身份'])
    || summarizeOpeningText(character.role === '个人创作主角' ? character.description : (character.role || character.description), 90);
  const background = extractOpeningProfileValue(profileText, ['背景与家庭生活', '背景经历', '背景', '来历', '出身'])
    || summarizeOpeningText(character.description, 110);
  const appearance = extractOpeningProfileValue(profileText, ['外貌与衣着', '外貌', '容貌', '形貌'])
    || summarizeOpeningText(character.appearance, 90);
  const personality = extractOpeningProfileValue(profileText, ['性格与底线', '性格', '心性', '人格'])
    || summarizeOpeningText(character.personality, 90);
  const ability = extractOpeningProfileValue(profileText, ['特殊体质', '能力与境界', '能力', '修为境界', '修为', '境界', '体质'])
    || inferOpeningAbility(profileText);
  const faction = extractOpeningProfileValue(profileText, ['阵营与归属', '阵营', '归属', '宗门', '门派'])
    || inferOpeningFaction(role);
  const inventory = extractOpeningProfileValue(profileText, ['随身物品', '重要物品', '物品', '法宝', '装备']);
  const relationship = extractOpeningProfileValue(profileText, ['关系模式', '重要关系', '人物关系', '关系'])
    || findOpeningSentence(profileText, /相依为命|青梅竹马|师徒|道侣|盟友|宿敌|仇敌|亲友|同伴/);
  const explicitGoal = authoredScenario
    || extractOpeningProfileValue(profileText, ['当前目标', '核心目标', '主线目标', '目标', '动机'])
    || findOpeningEntryValue(entries, /目标|任务|主线|诉求|目的/, /目标|任务|必须|想要|寻找|查清|守住|逃离|完成/);
  const goal = explicitGoal || buildOpeningGoal({ role, ability, relationship });
  const explicitRisk = extractOpeningProfileValue(profileText, ['秘密与风险', '秘密', '风险', '弱点', '禁忌'])
    || findOpeningEntryValue(
      entries,
      /风险|秘密|发现与后果|禁忌|弱点|代价|限制/,
      /暴露|发现|争夺|抢夺|追杀|圈养|控制|危险|代价|限制|禁忌/,
      /一旦暴露|保密的重要性|整个修真界/
    );
  const secret = explicitRisk || buildOpeningRisk(ability);
  const explicitOpening = findOpeningEntryValue(entries, /开局|当前处境|起始|第一幕|初始场景/, /开局|当前|正在|即将|必须|危机|处境/);
  const openingPressure = explicitOpening || openingText;

  if (protagonist.mode === 'scenario-role') {
    const scenarioGoal = inferScenarioOpeningGoal(character, openingText);
    return compactCustomOpeningFields({
      name: createCustomOpeningField('称谓', '输入你在故事中的称谓', protagonist.name),
      role: createCustomOpeningField('当前身份', '角色卡定义的玩家身份', protagonist.role),
      goal: createCustomOpeningField('当前目标', '回应角色卡给出的开局事件', scenarioGoal),
      relationshipStyle: createCustomOpeningField(
        '关系模式',
        '你与当前角色群体的关系',
        inferScenarioRelationship(protagonist, character)
      ),
      openingPressure: createCustomOpeningField('开局处境', '角色卡给出的第一幕', openingPressure)
    });
  }

  return compactCustomOpeningFields({
    name: createCustomOpeningField('姓名 / 称谓', '输入角色姓名', protagonist.name || character.name),
    role: createCustomOpeningField('当前身份', '在当前世界中的公开身份', role),
    background: createCustomOpeningField('来历与经历', '从何处来，背负什么旧事', background),
    appearance: createCustomOpeningField('外貌与衣着', '外貌、服饰与显眼特征', appearance),
    personality: createCustomOpeningField('性格与底线', '行事方式、欲望与不可触碰的底线', personality),
    ability: createCustomOpeningField('能力 / 境界', '当前真正掌握的能力及其代价', ability),
    faction: createCustomOpeningField('阵营 / 归属', '门派、家族、组织或独行身份', faction),
    inventory: createCustomOpeningField('随身物品', '开局能够实际使用的重要物品', inventory),
    goal: createCustomOpeningField('当前目标', '此刻最想完成的事情', goal),
    secret: createCustomOpeningField('秘密 / 风险', '不愿公开的事实或迫近的危险', secret),
    relationshipStyle: createCustomOpeningField('关系模式', '角色与他人建立关系的方式', relationship),
    openingPressure: createCustomOpeningField('开局处境', '第一幕发生时正在面对的压力', openingPressure)
  });
}

function compactCustomOpeningFields(fields) {
  return Object.fromEntries(Object.entries(fields).filter(([, field]) => {
    return Boolean(String(field?.defaultValue || '').trim())
      || (Array.isArray(field?.values) && field.values.length > 1)
      || (Array.isArray(field?.rolls) && field.rolls.length);
  }));
}

function inferScenarioOpeningGoal(character, openingText) {
  const source = [character.scenario, character.firstMessage, openingText].filter(Boolean).join('\n');
  if (/庄园/.test(source) && /报告|人员配置|部门架构|预算|财务/.test(source)) {
    return '审阅庄园人员配置与财务报告，处理当前待决事项。';
  }
  return findOpeningSentence(source, /必须|需要|目标|任务|审阅|调查|处理|决定|寻找|逃离|保护/)
    || '回应角色卡给出的开局事件，并决定下一步行动。';
}

function inferScenarioRelationship(protagonist, character) {
  const source = [character.scenario, character.firstMessage].filter(Boolean).join('\n');
  if (protagonist.name === '主人' && /庄园|女仆|管家/.test(source)) {
    return '作为庄园主人，与管家及庄园成员保持管理、雇佣与私人关系。';
  }
  return '';
}

function createCustomOpeningField(label, placeholder, value, alternatives = []) {
  const values = uniqueStrings([value, ...alternatives])
    .map((item) => summarizeOpeningText(item, 110))
    .filter(Boolean);
  return {
    label,
    placeholder: values[0] || placeholder,
    ...(values.length ? { defaultValue: values[0], values } : {})
  };
}

function findCustomProtagonistEntry(entries) {
  return entries.find((item) => /^(?:主角|男主角|女主角).*(?:人设|设定|档案)?$/.test(item.title))
    || entries.find((item) => /\[\s*(?:角色|身份)\s*[：:]/.test(String(item.entry?.content || '')))
    || null;
}

function extractOpeningProfileValue(content, labels = []) {
  const source = String(content || '');
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const bracketMatch = source.match(new RegExp(`\\[\\s*${escaped}\\s*[：:]\\s*([\\s\\S]*?)\\]`, 'i'));
    const lineMatch = source.match(new RegExp(`(?:^|[\\r\\n])\\s*[-*]?\\s*${escaped}\\s*[：:]\\s*([^\\r\\n]+)`, 'i'));
    const value = summarizeOpeningText(bracketMatch?.[1] || lineMatch?.[1], 110);
    if (value) return value;
  }
  return '';
}

function selectCharacterOpeningText(character) {
  const candidates = [
    character.firstMessage,
    ...(Array.isArray(character.alternateGreetings) ? character.alternateGreetings : []),
    character.scenario
  ];
  for (const candidate of candidates) {
    const raw = String(candidate || '').trim();
    if (!raw || /^【[^】]{1,40}】$/.test(raw)) continue;
    const paragraphs = raw
      .split(/(?:<UpdateVariable>|<StatusPlaceHolderImpl)/i)[0]
      .replace(/<SFW_IMG>[\s\S]*?<\/SFW_IMG>/gi, ' ')
      .replace(/<NSFW_IMG>[\s\S]*?<\/NSFW_IMG>/gi, ' ')
      .replace(/\{\{\s*user\s*\}\}/gi, '主角')
      .split(/\r?\n\s*\r?\n/)
      .map((item) => summarizeOpeningText(item, 90))
      .filter((item) => item.length >= 8)
      .slice(0, 3);
    const opening = summarizeOpeningText(paragraphs.join(' '), 110);
    if (opening) return opening;
  }
  return '';
}

function findOpeningEntryValue(entries, titlePattern, sentencePattern, preferredPattern = null) {
  const matched = entries.find((item) => titlePattern.test(item.title));
  if (!matched) return '';
  return findOpeningSentence(matched.entry?.content || matched.content, sentencePattern, {
    exclude: [matched.title],
    preferredPattern
  })
    || summarizeOpeningText(matched.entry?.content || matched.content, 110);
}

function findOpeningSentence(content, pattern, { exclude = [], preferredPattern = null } = {}) {
  const excluded = new Set(exclude.map((item) => normalizeOpeningComparable(item)).filter(Boolean));
  const sentences = String(content || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\{\{\s*user\s*\}\}/gi, '主角')
    .split(/(?<=[。！？；])|\r?\n/)
    .map((item) => summarizeOpeningText(item, 110))
    .filter((item) => item.length >= 6)
    .filter((item) => !excluded.has(normalizeOpeningComparable(item)));
  const matches = sentences.filter((item) => pattern.test(item));
  return (preferredPattern && matches.find((item) => preferredPattern.test(item)))
    || matches[0]
    || '';
}

function normalizeOpeningComparable(value) {
  return String(value || '')
    .replace(/^[#>*_【】\s-]+|[#>*_【】\s-]+$/g, '')
    .replace(/[：:。；;，,！？!?]/g, '')
    .trim();
}

function inferOpeningAbility(profileText) {
  const source = summarizeOpeningText(profileText, 500);
  const match = source.match(/(?:拥有|身负|觉醒)(?:修真界第一)?(?:特殊)?体质[“"：:\s]*([^”"'，,。；\s]{2,24})/);
  return match ? match[1] : '';
}

function inferOpeningFaction(role) {
  const match = String(role || '').match(/([\u4e00-\u9fff]{2,12}(?:宗|门|宫|派|阁|教|府|司|军|族))/);
  return match?.[1] || '';
}

function buildOpeningGoal({ role, ability, relationship }) {
  if (!role && !ability && !relationship) return '';
  const parts = [role ? `以${trimOpeningClause(role, 52)}的身份在当前局势中立足` : '在当前局势中立足'];
  if (ability) parts.push(`守住${trimOpeningClause(ability, 28)}的秘密`);
  if (relationship) parts.push(`维系${trimOpeningClause(relationship, 34)}`);
  return `${parts.join('，')}。`;
}

function buildOpeningRisk(ability) {
  if (!ability) return '';
  return `${trimOpeningClause(ability, 36)}一旦暴露，可能引来知情势力的争夺与控制。`;
}

function trimOpeningClause(value, maxLength) {
  return summarizeOpeningText(value, maxLength)
    .replace(/[”"'，,。；;！？!?\s]+$/g, '')
    .trim();
}

function buildCustomDestinyCards(entries) {
  const optionalHookPattern = /开局|危机|事件|任务|目标|秘密|线索|关系|机缘|抉择|困境|压力|选择|路线|契约|委托|追索/;
  const mandatorySettingPattern = /世界法则|世界观|角色速览|人物总览|历史年表|地图|势力|宗门|设定|规则|运行契约|状态栏|格式|模板/;
  const prioritized = entries.filter((item) => (
    optionalHookPattern.test(item.title)
    && !mandatorySettingPattern.test(item.title)
  ));
  const seen = new Set();
  const cards = [];
  prioritized.forEach((item) => {
    const identity = item.title.toLowerCase();
    if (seen.has(identity) || cards.length >= 8) return;
    seen.add(identity);
    cards.push({
      id: `custom-world-hook-${cards.length + 1}`,
      title: item.title,
      content: summarizeOpeningText(item.content, 180),
      defaultSelected: false
    });
  });

  return cards;
}

function normalizeOpeningEntryTitle(value, characterName = '') {
  return String(value || '')
    .replace(/\{\{\s*user\s*\}\}/gi, '主角')
    .replace(/\{\{\s*char\s*\}\}/gi, characterName || '角色')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^[#*_\-\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64);
}

function summarizeOpeningText(value, maxLength = 180) {
  const text = String(value || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<\/?[^>]+>/g, ' ')
    .replace(/\{\{[\s\S]*?\}\}/g, ' ')
    .replace(/^[#>*_\-\s]+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, Math.max(1, maxLength - 1)).trim()}…` : text;
}

function isOpeningMetaEntry(title) {
  return /选开|COT|思维链|变量更新|插图|格式规则|正则|状态栏模板|生成模板|快速生成|免责声明|输出规则|破甲|NSFW|SFW|提示词模板/i.test(title);
}

function scoreOpeningEntry(entry, title, content) {
  const constantWeight = entry.constant ? 24 : 0;
  const priorityWeight = Math.max(0, Math.min(100, Number(entry.priority ?? 50))) / 5;
  const hookWeight = /世界|基调|主角|人设|角色|地点|物品|体质|境界|势力|关系|危机|事件|任务|开局|规则|秘密|线索|因果|目标|禁忌/.test(title) ? 32 : 0;
  const contentWeight = Math.min(content.length, 260) / 26;
  return constantWeight + priorityWeight + hookWeight + contentWeight;
}

function customOpeningSidebarTabs(genre, protagonist = {}) {
  return ['当前态势', '决策线索', '角色档案', '人物网络', '成长轨迹', '叙事记忆', '世界规则'];
}

function createCharacterStageBackground(characterCard, resourceTitle = '') {
  const portrait = characterCard?.portrait;
  const url = String(portrait?.url || '').trim();
  const assetId = String(portrait?.assetId || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(assetId) || url !== `/api/character-images/${assetId}.png`) return null;
  const characterName = String(characterCard?.name || resourceTitle || '角色').trim().slice(0, 60);
  return {
    url,
    assetId,
    source: 'character-portrait',
    fit: 'portrait',
    label: `${characterName}立绘`
  };
}

function packageInspection(adapter, inspection, candidate) {
  const fingerprint = createFingerprint(candidate.payload);
  return {
    adapter,
    ...inspection,
    resources: [{
      kind: candidate.kind,
      title: candidate.title,
      fingerprint,
      diagnostics: {
        score: inspection.score,
        verdict: inspection.verdict,
        summary: inspection.summary,
        blockingIssues: inspection.blockingIssues,
        warnings: inspection.warnings,
        riskFlags: inspection.riskFlags || []
      }
    }]
  };
}

function refreshPackageVerdict(inspection, label) {
  inspection.canInstall = inspection.blockingIssues.length === 0;
  inspection.canImport = inspection.canInstall;
  inspection.compatible = inspection.canInstall;
  inspection.verdict = inspection.blockingIssues.length ? 'blocked' : inspection.warnings.length ? 'review' : 'recommended';
  inspection.verdictLabel = inspection.verdict === 'recommended' ? '兼容可用' : inspection.verdict === 'review' ? '建议审阅' : '不兼容';
  inspection.score = Math.max(0, 100 - (inspection.blockingIssues.length * 25) - (inspection.warnings.length * 5));
  inspection.summary = inspection.blockingIssues.length
    ? `${label}存在 ${inspection.blockingIssues.length} 项阻断问题。`
    : `${label} ${inspection.installAction === 'update' ? '可更新' : inspection.installAction === 'duplicate' ? '已安装' : '可安装'}。`;
}

function createImportedPackId(manifestId) {
  const slug = String(manifestId || 'pack').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return `custom-imported-${slug || crypto.randomUUID()}`;
}

function createEmptyPackSeed(id) {
  return {
    id,
    promptModules: [],
    worldBook: [],
    characterCard: {},
    characterPresets: [],
    groupMembers: [],
    memory: {
      rollingSummary: '',
      unsummarizedTurnCount: 0,
      worldState: { flags: { genre: 'custom' } },
      memoryCards: [],
      archivedSummaries: []
    },
    ruleSystem: {
      id: `${id}-rules`,
      title: '自定义剧本规则',
      boundary: '以所选角色卡、世界书和 Prompt 为边界推进。',
      panels: []
    }
  };
}

function createCustomBaselineSeed(id, input = {}, now = () => new Date()) {
  const baseline = normalizeCustomBaseline(input);
  const seed = createEmptyPackSeed(id);
  const timestamp = now().toISOString();
  const worldBook = [];
  if (baseline.premise) {
    worldBook.push({
      id: `${id}-world-premise`,
      type: 'rule',
      title: `${baseline.worldName || '原创世界'} · 世界总纲`,
      content: [baseline.genre ? `类型与时代：${baseline.genre}` : '', baseline.premise].filter(Boolean).join('\n\n'),
      keywords: [],
      constant: true,
      priority: 95,
      depth: 1,
      enabled: true,
      source: 'custom-baseline',
      updatedAt: timestamp
    });
  }
  if (baseline.hardRules) {
    worldBook.push({
      id: `${id}-hard-rules`,
      type: 'rule',
      title: `${baseline.worldName || '原创世界'} · 不可违背规则`,
      content: baseline.hardRules,
      keywords: [],
      constant: true,
      priority: 100,
      depth: 0,
      enabled: true,
      source: 'custom-baseline',
      updatedAt: timestamp
    });
  }
  const promptContent = [
    baseline.genre ? `题材边界：${baseline.genre}` : '',
    baseline.proseStyle ? `叙事风格：${baseline.proseStyle}` : '',
    baseline.hardRules ? `硬性规则：${baseline.hardRules}` : ''
  ].filter(Boolean).join('\n\n');
  return {
    ...seed,
    title: baseline.worldName || '原创世界',
    visualPackId: baseline.visualPackId,
    worldBook,
    promptModules: promptContent ? [{
      id: `${id}-narrative-baseline`,
      title: '原创世界叙事基线',
      enabled: true,
      content: promptContent
    }] : [],
    memory: {
      ...seed.memory,
      worldState: {
        ...seed.memory.worldState,
        worldName: baseline.worldName,
        genre: baseline.genre,
        flags: {
          ...(seed.memory.worldState?.flags || {}),
          genre: baseline.genre || 'custom'
        }
      }
    },
    ruleSystem: {
      ...seed.ruleSystem,
      title: `${baseline.worldName || '原创世界'}规则`,
      boundary: baseline.hardRules || baseline.premise || seed.ruleSystem.boundary,
      panels: [
        ...(baseline.premise ? [{ id: 'world-premise', title: '世界总纲', content: baseline.premise }] : []),
        ...(baseline.hardRules ? [{ id: 'hard-rules', title: '硬性规则', content: baseline.hardRules }] : [])
      ]
    }
  };
}

function normalizeCustomBaseline(input = {}) {
  return {
    worldName: String(input?.worldName || '').trim().slice(0, 80),
    genre: String(input?.genre || '').trim().slice(0, 100),
    premise: String(input?.premise || '').trim().slice(0, 5000),
    proseStyle: String(input?.proseStyle || '').trim().slice(0, 2500),
    hardRules: String(input?.hardRules || '').trim().slice(0, 2500),
    visualPackId: String(input?.visualPackId || 'neutral').trim() || 'neutral'
  };
}

function summarizeStoredPackCompatibilityAudit(pack = {}) {
  const review = pack.resourceManifest?.composition?.compatibilityReview;
  if (!isRecord(review) || Number(review.contractVersion || 0) !== TAVERN_COMPATIBILITY_CONTRACT_VERSION) {
    return null;
  }
  const disabledCapabilities = Array.isArray(review.disabledCapabilities)
    ? review.disabledCapabilities.filter(isRecord)
    : [];
  const approvedScriptHashes = Array.isArray(review.approvedScriptHashes)
    ? review.approvedScriptHashes.filter(Boolean)
    : [];
  const sourceRuntimeBlocked = review.sourceRuntimeBlocked === true;
  const executionMode = normalizePackScriptExecutionMode(review.executionMode);
  const safeDerivative = sourceRuntimeBlocked
    && ['safe-derivative-approved', 'safe-derivative-local-observe', 'safe-derivative-compatibility-probe'].includes(String(review.status || ''))
    && review.acknowledgedCompatibility === true
    && disabledCapabilities.length > 0;
  const directlyAudited = !sourceRuntimeBlocked
    && ['not-required', 'approved', 'local-observe', 'compatibility-probe'].includes(String(review.status || ''))
    && Boolean(review.fingerprint);
  if (!safeDerivative && !directlyAudited) return null;
  return {
    packId: pack.id,
    title: pack.title || pack.id,
    status: safeDerivative ? 'safe-derivative' : 'audited',
    label: safeDerivative
      ? (executionMode === 'compatibility-probe'
        ? '安全派生 · 开发探针'
        : executionMode === 'local-observe' ? '安全派生 · 本地观察' : '安全派生已审核')
      : (executionMode === 'compatibility-probe'
        ? 'v2 开发探针'
        : executionMode === 'local-observe' ? 'v2 本地观察' : 'v2 已审核'),
    tone: safeDerivative ? 'warning' : 'ok',
    reason: safeDerivative
      ? executionMode === 'compatibility-probe'
        ? `原资源运行时已阻断，明确禁用 ${disabledCapabilities.length} 项能力；其余可隔离脚本正在开发兼容探针中运行并记录。`
        : executionMode === 'local-observe'
          ? `原资源运行时已阻断，明确禁用 ${disabledCapabilities.length} 项能力；其余可隔离脚本以本地观察模式运行并记录。`
          : `原资源运行时已阻断，并明确禁用 ${disabledCapabilities.length} 项能力。`
      : approvedScriptHashes.length
        ? `${approvedScriptHashes.length} 个第三方脚本哈希已在组装前逐项批准。`
        : executionMode === 'compatibility-probe'
          ? '组装记录符合当前酒馆兼容契约，脚本将以开发兼容探针运行并记录。'
          : executionMode === 'local-observe'
            ? '组装记录符合当前酒馆兼容契约，脚本将以本地观察模式运行并记录。'
            : '组装记录符合当前酒馆兼容契约。',
    canStartNewStory: true,
    action: 'none',
    contractVersion: Number(review.contractVersion || 0),
    reviewedAt: String(review.reviewedAt || ''),
    scriptCount: approvedScriptHashes.length,
    disabledCapabilityCount: disabledCapabilities.length,
    changedRevisionCount: 0,
    unknownRevisionCount: 0,
    issues: []
  };
}

function summarizePackCompatibilityUpgradePreview(preview = {}) {
  const review = isRecord(preview.compatibilityReview) ? preview.compatibilityReview : {};
  const promptBundleMigration = isRecord(preview.promptBundleMigration)
    ? preview.promptBundleMigration
    : {};
  const revisionChanges = Array.isArray(preview.resourceRevisionChanges)
    ? preview.resourceRevisionChanges
    : [];
  const issues = Array.isArray(preview.issues)
    ? preview.issues.map((item) => String(item?.message || item?.code || item)).filter(Boolean)
    : [];
  const common = {
    packId: String(preview.sourcePack?.id || ''),
    title: String(preview.sourcePack?.title || preview.sourcePack?.id || '历史自定义剧本'),
    contractVersion: Number(preview.sourcePack?.compatibilityReview?.contractVersion || 0),
    reviewedAt: String(preview.sourcePack?.compatibilityReview?.reviewedAt || ''),
    scriptCount: Array.isArray(review.rules) ? review.rules.length : 0,
    disabledCapabilityCount: Array.isArray(review.blockers) ? review.blockers.length : 0,
    changedRevisionCount: revisionChanges.filter((item) => item.changed).length,
    fingerprintConfirmedCount: revisionChanges.filter((item) => item.fingerprintConfirmed).length,
    unknownRevisionCount: revisionChanges.filter((item) => item.revisionUnknown).length,
    legacyPromptSourceCount: Number(promptBundleMigration.sourceResourceCount || 0),
    promptBundleTargetCount: Number(promptBundleMigration.targetBundleCount || 0),
    issues
  };
  const migrationReason = common.legacyPromptSourceCount
    ? `${common.legacyPromptSourceCount} 个旧预设分片将在新剧本中折叠为 ${common.promptBundleTargetCount} 个预设包。`
    : '';
  if (preview.rebuildable !== true) {
    return {
      ...common,
      status: 'blocked',
      label: '素材缺失',
      tone: 'error',
      reason: issues.join('；') || '原组装素材或基线缺失，不能可靠生成兼容新版。',
      canStartNewStory: false,
      action: 'inspect'
    };
  }
  if (preview.requiresScriptApproval === true) {
    return {
      ...common,
      status: 'script-review-required',
      label: '脚本待逐项审核',
      tone: 'review',
      reason: [
        `发现 ${common.scriptCount} 个第三方脚本候选，必须查看源码并按内容哈希逐项批准。`,
        common.fingerprintConfirmedCount
          ? `${common.fingerprintConfirmedCount} 份历史素材已通过内容指纹确认未变化。`
          : '',
        migrationReason
      ].filter(Boolean).join(' '),
      canStartNewStory: false,
      action: 'review-scripts'
    };
  }
  return {
    ...common,
    status: 'upgrade-available',
    label: '需要 v2 复审',
    tone: 'warning',
    reason: [
      common.changedRevisionCount || common.unknownRevisionCount
        ? `可以生成兼容新版；${common.changedRevisionCount} 份素材已更新，${common.unknownRevisionCount} 份缺少历史 revision。`
        : '历史包缺少当前契约审计，可以无损生成兼容新版。',
      migrationReason
    ].filter(Boolean).join(' '),
    canStartNewStory: false,
    action: 'upgrade'
  };
}

function deriveCompatibilityUpgradeBaseline(pack = {}, storedBaseline = null) {
  if (isRecord(storedBaseline)) return normalizeCustomBaseline(storedBaseline);
  const worldState = isRecord(pack.memory?.worldState) ? pack.memory.worldState : {};
  const worldBook = Array.isArray(pack.worldBook) ? pack.worldBook : [];
  const promptModules = Array.isArray(pack.promptModules) ? pack.promptModules : [];
  const premiseEntry = worldBook.find((entry) => (
    String(entry?.id || '').endsWith('-world-premise')
    || (String(entry?.source || '') === 'custom-baseline' && /世界总纲/u.test(String(entry?.title || '')))
  ));
  const hardRulesEntry = worldBook.find((entry) => (
    String(entry?.id || '').endsWith('-hard-rules')
    || (String(entry?.source || '') === 'custom-baseline' && /不可违背规则/u.test(String(entry?.title || '')))
  ));
  const narrativeModule = promptModules.find((module) => (
    String(module?.id || '').endsWith('-narrative-baseline')
    || String(module?.title || '') === '原创世界叙事基线'
  ));
  const narrativeContent = String(narrativeModule?.content || '');
  const inferredGenre = String(
    worldState.genre
    || worldState.flags?.genre
    || extractBaselineField(narrativeContent, '题材边界')
    || ''
  ).trim();
  const premiseContent = String(premiseEntry?.content || '').trim();
  const premisePrefix = inferredGenre ? `类型与时代：${inferredGenre}` : '';
  const premise = premisePrefix && premiseContent.startsWith(premisePrefix)
    ? premiseContent.slice(premisePrefix.length).trim()
    : premiseContent.replace(/^类型与时代：[^\n]+\n*/u, '').trim();
  return normalizeCustomBaseline({
    worldName: worldState.worldName || pack.title || '',
    genre: inferredGenre === 'custom' ? '' : inferredGenre,
    premise,
    proseStyle: extractBaselineField(narrativeContent, '叙事风格'),
    hardRules: String(hardRulesEntry?.content || '').trim()
      || extractBaselineField(narrativeContent, '硬性规则'),
    visualPackId: pack.visualPackId || 'neutral'
  });
}

function extractBaselineField(content, label) {
  const escaped = String(label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(content || '').match(new RegExp(
    `(?:^|\\n\\n)${escaped}：([\\s\\S]*?)(?=\\n\\n(?:题材边界|叙事风格|硬性规则)：|$)`,
    'u'
  ));
  return String(match?.[1] || '').trim();
}

function createResourcePackUpgradeError(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function dedupeByFingerprint(items) {
  const seen = new Set();
  return (items || []).filter((item) => {
    const fingerprint = createFingerprint(item);
    if (seen.has(fingerprint)) return false;
    seen.add(fingerprint);
    return true;
  });
}

function normalizeLibraryText(value, fallback, maxLength, { allowEmpty = false } = {}) {
  if (value === undefined) return String(fallback || '');
  const normalized = String(value || '').trim().slice(0, maxLength);
  if (normalized || allowEmpty) return normalized;
  return String(fallback || '');
}

function uniqueStrings(values) {
  const list = Array.isArray(values) ? values : values === undefined || values === null ? [] : [values];
  return [...new Set(list.map((value) => String(value || '').trim()).filter(Boolean))];
}

function normalizeId(value) {
  const id = String(value || '').trim();
  return /^[a-zA-Z0-9_-]+$/.test(id) ? id : '';
}

function summarizeText(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > 140 ? `${text.slice(0, 137)}...` : text;
}

export const resourceLibraryInternals = {
  createFingerprint,
  detectExecutionRisks,
  diagnoseCandidate,
  estimateResourceTokens
};
