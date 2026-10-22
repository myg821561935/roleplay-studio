import crypto from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { prepareHeavyFrontendBundle, safeHeavyFrontendPath } from './heavyFrontendScanner.js';

const PACKAGES_PATH = 'heavy-frontends/packages.json';
const AUDIT_PATH = 'heavy-frontends/audit.json';
const RUNTIME_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024;
const DEFAULT_BUDGET = Object.freeze({
  maxCalls: 40,
  maxInputChars: 2_000_000,
  maxOutputChars: 1_000_000,
  maxOutputTokensPerCall: 16_000
});

const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.htm', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'], ['.mjs', 'text/javascript; charset=utf-8'],
  ['.cjs', 'text/javascript; charset=utf-8'], ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'], ['.map', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'], ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'], ['.webp', 'image/webp'], ['.avif', 'image/avif'], ['.ico', 'image/x-icon'],
  ['.mp3', 'audio/mpeg'], ['.wav', 'audio/wav'], ['.ogg', 'audio/ogg'], ['.m4a', 'audio/mp4'],
  ['.mp4', 'video/mp4'], ['.webm', 'video/webm'],
  ['.woff', 'font/woff'], ['.woff2', 'font/woff2'], ['.ttf', 'font/ttf'], ['.otf', 'font/otf'],
  ['.wasm', 'application/wasm'], ['.txt', 'text/plain; charset=utf-8'], ['.md', 'text/markdown; charset=utf-8'],
  ['.yaml', 'text/yaml; charset=utf-8'], ['.yml', 'text/yaml; charset=utf-8'], ['.xml', 'application/xml; charset=utf-8']
]);

export class HeavyFrontendError extends Error {
  constructor(statusCode, code, detail = '') {
    super(code);
    this.statusCode = statusCode;
    this.code = code;
    this.detail = String(detail || '');
  }
}

export class HeavyFrontendRuntimeService {
  constructor({ rootDir, store, configService, providerClient, fetchImpl = globalThis.fetch, now = () => new Date() }) {
    this.rootDir = path.resolve(rootDir);
    this.bundleRoot = path.join(this.rootDir, 'private-content', 'heavy-frontends');
    this.store = store;
    this.configService = configService;
    this.providerClient = providerClient;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.instances = new Map();
    this.auditQueue = Promise.resolve();
  }

  async listPackages() {
    const packages = await this._readPackages();
    return packages.map((item) => publicPackage(item));
  }

  async getPackage(packageId) {
    const packages = await this._readPackages();
    const item = packages.find((entry) => entry.id === packageId);
    return item ? publicPackage(item) : null;
  }

  async importPackage(input) {
    let prepared;
    try {
      prepared = prepareHeavyFrontendBundle(input);
    } catch (error) {
      throw mapBundleError(error);
    }

    const packages = await this._readPackages();
    const packageId = createPackageId(prepared.sourceName, prepared.entryPath);
    const current = packages.find((item) => item.id === packageId);
    const existingRevision = current?.revisions?.find((revision) => revision.contentHash === prepared.contentHash);
    const now = this.now().toISOString();

    if (existingRevision) {
      current.currentRevisionId = existingRevision.id;
      current.title = prepared.title;
      current.updatedAt = now;
      await this.store.write(PACKAGES_PATH, packages);
      await this.appendAudit({
        event: 'package-import-existing-revision',
        packageId,
        revisionId: existingRevision.id,
        contentHash: existingRevision.contentHash,
        status: 'ok'
      });
      return { package: publicPackage(current), duplicate: true };
    }

    const revisionId = `rev-${prepared.contentHash.slice(0, 16)}`;
    await this._writeBundleFiles(packageId, revisionId, prepared.files);
    const revision = {
      id: revisionId,
      contentHash: prepared.contentHash,
      importedAt: now,
      entryPath: prepared.entryPath,
      fileCount: prepared.fileCount,
      totalBytes: prepared.totalBytes,
      files: prepared.files.map(({ path: filePath, mimeType, sizeBytes, sha256 }) => ({
        path: filePath,
        mimeType,
        sizeBytes,
        sha256
      })),
      findings: prepared.findings,
      review: {
        status: 'local-observe',
        reviewedAt: '',
        reviewer: '',
        note: '',
        contentHash: prepared.contentHash
      }
    };

    let nextPackage;
    if (current) {
      current.title = prepared.title;
      current.sourceName = prepared.sourceName;
      current.entryPath = prepared.entryPath;
      current.currentRevisionId = revision.id;
      current.updatedAt = now;
      current.revisions = [...(current.revisions || []), revision];
      nextPackage = current;
    } else {
      nextPackage = {
        spec: 'lra.heavy-frontend-pack/v1',
        id: packageId,
        title: prepared.title,
        sourceName: prepared.sourceName,
        entryPath: prepared.entryPath,
        currentRevisionId: revision.id,
        createdAt: now,
        updatedAt: now,
        revisions: [revision]
      };
      packages.push(nextPackage);
    }

    await this.store.write(PACKAGES_PATH, packages);
    await this.appendAudit({
      event: 'package-import',
      packageId,
      revisionId,
      contentHash: prepared.contentHash,
      status: 'observation-ready',
      metrics: {
        fileCount: prepared.fileCount,
        totalBytes: prepared.totalBytes,
        findingCount: prepared.findings.length
      }
    });
    return { package: publicPackage(nextPackage), duplicate: false };
  }

  async reviewPackage(packageId, { contentHash, decision, note = '' } = {}) {
    const normalizedDecision = String(decision || '').toLowerCase();
    if (!['approved', 'rejected'].includes(normalizedDecision)) {
      throw new HeavyFrontendError(400, 'HEAVY_FRONTEND_REVIEW_DECISION_INVALID');
    }
    const packages = await this._readPackages();
    const item = packages.find((entry) => entry.id === packageId);
    if (!item) throw new HeavyFrontendError(404, 'HEAVY_FRONTEND_PACKAGE_NOT_FOUND');
    const revision = getCurrentRevision(item);
    if (!revision) throw new HeavyFrontendError(409, 'HEAVY_FRONTEND_REVISION_MISSING');
    if (!contentHash || !timingSafeEqualString(contentHash, revision.contentHash)) {
      throw new HeavyFrontendError(409, 'HEAVY_FRONTEND_REVIEW_HASH_CHANGED');
    }
    const normalizedNote = String(note || '').trim().slice(0, 2000);
    if (normalizedDecision === 'approved' && normalizedNote.length < 8) {
      throw new HeavyFrontendError(400, 'HEAVY_FRONTEND_REVIEW_NOTE_REQUIRED');
    }
    revision.review = {
      status: normalizedDecision,
      reviewedAt: this.now().toISOString(),
      reviewer: 'local-user',
      note: normalizedNote,
      contentHash: revision.contentHash
    };
    item.updatedAt = this.now().toISOString();
    await this.store.write(PACKAGES_PATH, packages);
    await this.appendAudit({
      event: 'package-review',
      packageId,
      revisionId: revision.id,
      contentHash: revision.contentHash,
      status: normalizedDecision,
      note: revision.review.note
    });
    return { package: publicPackage(item) };
  }

  async createLaunch(packageId, options = {}) {
    this.pruneExpiredInstances();
    const packages = await this._readPackages();
    const item = packages.find((entry) => entry.id === packageId);
    if (!item) throw new HeavyFrontendError(404, 'HEAVY_FRONTEND_PACKAGE_NOT_FOUND');
    const revision = getCurrentRevision(item);
    if (!revision) throw new HeavyFrontendError(409, 'HEAVY_FRONTEND_REVISION_MISSING');
    if (revision.review?.contentHash !== revision.contentHash) {
      throw new HeavyFrontendError(409, 'HEAVY_FRONTEND_REVIEW_REQUIRED');
    }
    if (revision.review?.status === 'rejected') {
      throw new HeavyFrontendError(409, 'HEAVY_FRONTEND_REJECTED');
    }
    if (!['approved', 'local-observe'].includes(revision.review?.status)) {
      throw new HeavyFrontendError(409, 'HEAVY_FRONTEND_REVIEW_REQUIRED');
    }

    const provider = await this._resolveProvider(options.providerId);
    const instanceId = crypto.randomUUID();
    const runtimeSessionId = crypto.randomUUID();
    const launchToken = crypto.randomBytes(32).toString('base64url');
    const bridgeNonce = crypto.randomBytes(24).toString('base64url');
    const createdAt = this.now();
    const expiresAt = new Date(createdAt.getTime() + RUNTIME_TTL_MS);
    const budget = normalizeBudget(options.budget, provider);
    const instance = {
      id: instanceId,
      runtimeSessionId,
      packageId: item.id,
      packageTitle: item.title,
      revisionId: revision.id,
      contentHash: revision.contentHash,
      entryPath: revision.entryPath,
      provider,
      providerPublic: { id: provider.id, kind: provider.kind, model: provider.model },
      expectedHostname: `hf-${instanceId.slice(0, 8)}.heavy.localhost`,
      parentOrigin: normalizeParentOrigin(options.parentOrigin),
      launchTokenHash: hashToken(launchToken),
      launchTokenConsumed: false,
      bridgeNonce,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      budget,
      usage: { calls: 0, inputChars: 0, outputChars: 0 },
      inFlight: false
    };
    this.instances.set(instanceId, instance);
    await this.appendAudit({
      event: 'runtime-launch',
      packageId: item.id,
      revisionId: revision.id,
      contentHash: revision.contentHash,
      runtimeSessionId,
      instanceId,
      providerId: provider.id,
      model: provider.model,
      status: 'created',
      budget,
      executionMode: revision.review.status === 'approved' ? 'approved' : 'local-observe',
      metrics: {
        findingCount: revision.findings.length,
        criticalFindingCount: revision.findings.filter((finding) => finding.severity === 'critical').length
      }
    });
    return {
      instance: publicInstance(instance),
      launchToken,
      bridgeNonce
    };
  }

  getInstance(instanceId) {
    this.pruneExpiredInstances();
    const instance = this.instances.get(instanceId);
    if (!instance) throw new HeavyFrontendError(404, 'HEAVY_FRONTEND_RUNTIME_NOT_FOUND');
    return instance;
  }

  getPublicInstance(instanceId) {
    return publicInstance(this.getInstance(instanceId));
  }

  authorizeRuntime(instanceId, { hostname, launchToken = '', capabilityToken = '', cookieToken = '' } = {}) {
    const instance = this.getInstance(instanceId);
    if (String(hostname || '').toLowerCase() !== instance.expectedHostname) {
      throw new HeavyFrontendError(403, 'HEAVY_FRONTEND_RUNTIME_HOST_MISMATCH');
    }
    const cookieValid = cookieToken && timingSafeEqualString(hashToken(cookieToken), instance.launchTokenHash);
    if (cookieValid) return { instance, setCookie: false };
    const capabilityValid = capabilityToken
      && timingSafeEqualString(hashToken(capabilityToken), instance.launchTokenHash);
    if (capabilityValid) return { instance, setCookie: true };
    const launchValid = launchToken
      && !instance.launchTokenConsumed
      && timingSafeEqualString(hashToken(launchToken), instance.launchTokenHash);
    if (!launchValid) throw new HeavyFrontendError(401, 'HEAVY_FRONTEND_RUNTIME_UNAUTHORIZED');
    instance.launchTokenConsumed = true;
    return { instance, setCookie: true };
  }

  async readRuntimeFile(instance, requestPath) {
    const normalizedPath = safeRuntimeRequestPath(requestPath || instance.entryPath);
    const packages = await this._readPackages();
    const item = packages.find((entry) => entry.id === instance.packageId);
    const revision = item?.revisions?.find((entry) => entry.id === instance.revisionId);
    if (!revision || revision.contentHash !== instance.contentHash) {
      throw new HeavyFrontendError(409, 'HEAVY_FRONTEND_RUNTIME_REVISION_CHANGED');
    }
    const metadata = revision.files.find((file) => file.path === normalizedPath);
    if (!metadata) throw new HeavyFrontendError(404, 'HEAVY_FRONTEND_FILE_NOT_FOUND');
    const filePath = this._bundleFilePath(instance.packageId, instance.revisionId, normalizedPath);
    let body;
    try {
      body = await readFile(filePath);
    } catch (error) {
      if (error.code === 'ENOENT') throw new HeavyFrontendError(404, 'HEAVY_FRONTEND_FILE_MISSING_LOCAL');
      throw error;
    }
    const actualHash = crypto.createHash('sha256').update(body).digest('hex');
    if (!timingSafeEqualString(actualHash, metadata.sha256)) {
      await this.appendAudit({
        event: 'runtime-integrity-failure',
        packageId: instance.packageId,
        revisionId: instance.revisionId,
        runtimeSessionId: instance.runtimeSessionId,
        status: 'blocked',
        path: normalizedPath
      });
      throw new HeavyFrontendError(409, 'HEAVY_FRONTEND_FILE_INTEGRITY_FAILED');
    }
    if (normalizedPath === instance.entryPath && /\.html?$/i.test(normalizedPath)) {
      body = Buffer.from(injectRuntimeBootstrap(body.toString('utf8'), instance), 'utf8');
    }
    return {
      body,
      contentType: MIME_TYPES.get(path.extname(normalizedPath).toLowerCase()) || 'application/octet-stream',
      isEntry: normalizedPath === instance.entryPath
    };
  }

  async completeChat(instance, body, { onToken } = {}) {
    const messages = normalizeMessages(body?.messages);
    const inputChars = messages.reduce((sum, message) => sum + message.content.length, 0);
    const requestedMaxTokens = finiteInteger(body?.max_tokens, instance.budget.maxOutputTokensPerCall);
    const maxTokens = clamp(requestedMaxTokens, 64, instance.budget.maxOutputTokensPerCall);
    const temperature = clamp(Number(body?.temperature ?? instance.provider.temperature ?? 0.9), 0, 2);
    const requestId = `hfc-${crypto.randomUUID()}`;
    const startedAt = Date.now();
    try {
      this._beginRuntimeCall(instance, inputChars);
    } catch (error) {
      await this.appendAudit({
        event: 'provider-call',
        requestId,
        packageId: instance.packageId,
        revisionId: instance.revisionId,
        runtimeSessionId: instance.runtimeSessionId,
        instanceId: instance.id,
        providerId: instance.provider.id,
        model: instance.provider.model,
        status: 'blocked',
        errorCode: error instanceof HeavyFrontendError ? error.code : 'HEAVY_FRONTEND_REQUEST_BLOCKED',
        metrics: { messageCount: messages.length, inputChars, outputChars: 0, maxTokens, durationMs: 0 }
      });
      throw error;
    }
    let output = '';
    let status = 'ok';
    let errorCode = '';
    try {
      const provider = { ...instance.provider, maxTokens, temperature };
      let result;
      if (typeof onToken === 'function' && typeof this.providerClient.stream === 'function') {
        result = await this.providerClient.stream({
          provider,
          messages,
          fetchImpl: this.fetchImpl,
          onToken: async (token) => {
            const text = String(token || '');
            output += text;
            if (instance.usage.outputChars + output.length > instance.budget.maxOutputChars) {
              throw new HeavyFrontendError(429, 'HEAVY_FRONTEND_OUTPUT_BUDGET_EXCEEDED');
            }
            await onToken(text);
          }
        });
        if (!output) output = String(result?.content || '');
      } else {
        result = await this.providerClient.complete({
          provider,
          messages,
          fetchImpl: this.fetchImpl
        });
        output = String(result?.content || '');
      }
      if (!output.trim()) throw new HeavyFrontendError(502, 'HEAVY_FRONTEND_PROVIDER_EMPTY_RESPONSE');
      if (instance.usage.outputChars + output.length > instance.budget.maxOutputChars) {
        throw new HeavyFrontendError(429, 'HEAVY_FRONTEND_OUTPUT_BUDGET_EXCEEDED');
      }
      instance.usage.outputChars += output.length;
      return {
        requestId,
        content: output,
        model: instance.provider.model,
        usage: estimateUsage(inputChars, output.length)
      };
    } catch (error) {
      status = 'error';
      errorCode = error instanceof HeavyFrontendError
        ? error.code
        : 'HEAVY_FRONTEND_PROVIDER_ERROR';
      throw error instanceof HeavyFrontendError
        ? error
        : new HeavyFrontendError(502, 'HEAVY_FRONTEND_PROVIDER_ERROR');
    } finally {
      instance.inFlight = false;
      await this.appendAudit({
        event: 'provider-call',
        requestId,
        packageId: instance.packageId,
        revisionId: instance.revisionId,
        runtimeSessionId: instance.runtimeSessionId,
        instanceId: instance.id,
        providerId: instance.provider.id,
        model: instance.provider.model,
        status,
        errorCode,
        metrics: {
          messageCount: messages.length,
          inputChars,
          outputChars: output.length,
          maxTokens,
          durationMs: Date.now() - startedAt
        }
      });
    }
  }

  async saveSnapshot(runtimeSessionId, payload) {
    const instance = [...this.instances.values()].find((entry) => entry.runtimeSessionId === runtimeSessionId);
    if (!instance) throw new HeavyFrontendError(404, 'HEAVY_FRONTEND_RUNTIME_NOT_FOUND');
    const json = JSON.stringify(payload);
    if (!json || Buffer.byteLength(json) > MAX_SNAPSHOT_BYTES) {
      throw new HeavyFrontendError(413, 'HEAVY_FRONTEND_SNAPSHOT_TOO_LARGE');
    }
    const snapshot = {
      spec: 'lra.heavy-frontend-snapshot/v1',
      runtimeSessionId,
      packageId: instance.packageId,
      revisionId: instance.revisionId,
      contentHash: instance.contentHash,
      savedAt: this.now().toISOString(),
      payload
    };
    await this.store.write(`heavy-frontends/snapshots/${runtimeSessionId}.json`, snapshot);
    await this.appendAudit({
      event: 'runtime-snapshot',
      packageId: instance.packageId,
      revisionId: instance.revisionId,
      runtimeSessionId,
      status: 'saved',
      metrics: { bytes: Buffer.byteLength(json) }
    });
    return { snapshot: publicSnapshot(snapshot) };
  }

  async getSnapshot(runtimeSessionId) {
    const snapshot = await this.store.read(`heavy-frontends/snapshots/${safeId(runtimeSessionId)}.json`, null);
    return snapshot ? { snapshot } : { snapshot: null };
  }

  async closeRuntime(runtimeSessionId) {
    const instance = [...this.instances.values()].find((entry) => entry.runtimeSessionId === runtimeSessionId);
    if (!instance) return { closed: false };
    this.instances.delete(instance.id);
    await this.appendAudit({
      event: 'runtime-close',
      packageId: instance.packageId,
      revisionId: instance.revisionId,
      runtimeSessionId,
      instanceId: instance.id,
      status: 'closed',
      metrics: { ...instance.usage }
    });
    return { closed: true };
  }

  async listAudits({ packageId = '', limit = 200 } = {}) {
    const entries = await this.store.read(AUDIT_PATH, []);
    return entries
      .filter((entry) => !packageId || entry.packageId === packageId)
      .slice(-clamp(finiteInteger(limit, 200), 1, 1000))
      .reverse();
  }

  appendAudit(event) {
    const record = {
      id: crypto.randomUUID(),
      at: this.now().toISOString(),
      ...sanitizeAuditEvent(event)
    };
    this.auditQueue = this.auditQueue.then(async () => {
      const entries = await this.store.read(AUDIT_PATH, []);
      entries.push(record);
      await this.store.write(AUDIT_PATH, entries.slice(-5000));
    }).catch((error) => {
      // 审计写入失败不应阻塞后续写入，也不应产生未处理的 rejection
      this.lastAuditError = error?.message || 'AUDIT_WRITE_FAILED';
    });
    return this.auditQueue.then(() => record);
  }

  pruneExpiredInstances() {
    const now = this.now().getTime();
    for (const [instanceId, instance] of this.instances) {
      if (new Date(instance.expiresAt).getTime() <= now) this.instances.delete(instanceId);
    }
  }

  async _readPackages() {
    const value = await this.store.read(PACKAGES_PATH, []);
    return Array.isArray(value) ? value : [];
  }

  async _resolveProvider(requestedId) {
    const config = await this.configService.getAll();
    const providerConfig = config.providers || {};
    const providerId = String(requestedId || providerConfig.activeProviderId || providerConfig.taskProviders?.chat || '').trim();
    const provider = (providerConfig.providers || []).find((entry) => entry.id === providerId);
    if (!provider) throw new HeavyFrontendError(409, 'HEAVY_FRONTEND_PROVIDER_NOT_CONFIGURED');
    if (!String(provider.apiKey || '').trim()) throw new HeavyFrontendError(409, 'HEAVY_FRONTEND_PROVIDER_SECRET_MISSING');
    if (!String(provider.model || '').trim()) throw new HeavyFrontendError(409, 'HEAVY_FRONTEND_PROVIDER_MODEL_MISSING');
    return structuredClone(provider);
  }

  _beginRuntimeCall(instance, inputChars) {
    if (instance.inFlight) throw new HeavyFrontendError(429, 'HEAVY_FRONTEND_CONCURRENT_CALL_BLOCKED');
    if (instance.usage.calls >= instance.budget.maxCalls) {
      throw new HeavyFrontendError(429, 'HEAVY_FRONTEND_CALL_BUDGET_EXCEEDED');
    }
    if (instance.usage.inputChars + inputChars > instance.budget.maxInputChars) {
      throw new HeavyFrontendError(429, 'HEAVY_FRONTEND_INPUT_BUDGET_EXCEEDED');
    }
    instance.inFlight = true;
    instance.usage.calls += 1;
    instance.usage.inputChars += inputChars;
  }

  async _writeBundleFiles(packageId, revisionId, files) {
    const packageRoot = path.join(this.bundleRoot, packageId);
    const target = path.join(packageRoot, revisionId);
    const temp = path.join(packageRoot, `.incoming-${revisionId}-${crypto.randomBytes(6).toString('hex')}`);
    await mkdir(temp, { recursive: true });
    try {
      for (const file of files) {
        const targetFile = path.join(temp, ...file.path.split('/'));
        await mkdir(path.dirname(targetFile), { recursive: true });
        await writeFile(targetFile, file.buffer);
      }
      await rename(temp, target);
    } catch (error) {
      await rm(temp, { recursive: true, force: true }).catch(() => {});
      if (error.code === 'EEXIST') return;
      throw error;
    }
  }

  _bundleFilePath(packageId, revisionId, relativePath) {
    const root = path.resolve(this.bundleRoot, packageId, revisionId);
    const absolute = path.resolve(root, ...relativePath.split('/'));
    if (!absolute.startsWith(`${root}${path.sep}`) && absolute !== root) {
      throw new HeavyFrontendError(400, 'HEAVY_FRONTEND_INVALID_PATH');
    }
    return absolute;
  }
}

function publicPackage(item) {
  const revisions = (item.revisions || []).map((revision) => ({
    id: revision.id,
    contentHash: revision.contentHash,
    importedAt: revision.importedAt,
    entryPath: revision.entryPath,
    fileCount: revision.fileCount,
    totalBytes: revision.totalBytes,
    findings: revision.findings || [],
    review: revision.review || { status: 'required', contentHash: revision.contentHash }
  }));
  const currentRevision = revisions.find((revision) => revision.id === item.currentRevisionId) || null;
  return {
    spec: item.spec,
    id: item.id,
    title: item.title,
    sourceName: item.sourceName,
    entryPath: item.entryPath,
    currentRevisionId: item.currentRevisionId,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    currentRevision,
    revisions
  };
}

function publicInstance(instance) {
  return {
    id: instance.id,
    runtimeSessionId: instance.runtimeSessionId,
    packageId: instance.packageId,
    packageTitle: instance.packageTitle,
    revisionId: instance.revisionId,
    contentHash: instance.contentHash,
    expectedHostname: instance.expectedHostname,
    provider: instance.providerPublic,
    createdAt: instance.createdAt,
    expiresAt: instance.expiresAt,
    budget: instance.budget,
    usage: { ...instance.usage },
    inFlight: instance.inFlight
  };
}

function publicSnapshot(snapshot) {
  return {
    spec: snapshot.spec,
    runtimeSessionId: snapshot.runtimeSessionId,
    packageId: snapshot.packageId,
    revisionId: snapshot.revisionId,
    contentHash: snapshot.contentHash,
    savedAt: snapshot.savedAt
  };
}

function getCurrentRevision(item) {
  return item.revisions?.find((revision) => revision.id === item.currentRevisionId) || null;
}

function createPackageId(sourceName, entryPath) {
  const slug = String(sourceName || 'heavy-frontend')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'heavy-frontend';
  const identity = crypto.createHash('sha256').update(`${String(sourceName).toLowerCase()}\0${entryPath}`).digest('hex');
  return `${slug}-${identity.slice(0, 12)}`;
}

function normalizeBudget(value, provider) {
  const source = value && typeof value === 'object' ? value : {};
  const providerMax = finiteInteger(provider.maxTokens, DEFAULT_BUDGET.maxOutputTokensPerCall);
  return {
    maxCalls: clamp(finiteInteger(source.maxCalls, DEFAULT_BUDGET.maxCalls), 1, 100),
    maxInputChars: clamp(finiteInteger(source.maxInputChars, DEFAULT_BUDGET.maxInputChars), 10_000, 5_000_000),
    maxOutputChars: clamp(finiteInteger(source.maxOutputChars, DEFAULT_BUDGET.maxOutputChars), 10_000, 3_000_000),
    maxOutputTokensPerCall: clamp(
      finiteInteger(source.maxOutputTokensPerCall, Math.max(providerMax, DEFAULT_BUDGET.maxOutputTokensPerCall)),
      256,
      32_768
    )
  };
}

function normalizeMessages(value) {
  if (!Array.isArray(value) || !value.length || value.length > 240) {
    throw new HeavyFrontendError(400, 'HEAVY_FRONTEND_MESSAGES_INVALID');
  }
  return value.map((message) => {
    const role = String(message?.role || '').toLowerCase();
    if (!['system', 'user', 'assistant', 'tool'].includes(role)) {
      throw new HeavyFrontendError(400, 'HEAVY_FRONTEND_MESSAGE_ROLE_INVALID');
    }
    const content = normalizeMessageContent(message?.content);
    if (!content) throw new HeavyFrontendError(400, 'HEAVY_FRONTEND_MESSAGE_CONTENT_REQUIRED');
    return { role, content };
  });
}

function normalizeMessageContent(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((part) => typeof part === 'string' ? part : String(part?.text || '')).join('\n');
  }
  return '';
}

function estimateUsage(inputChars, outputChars) {
  const promptTokens = Math.ceil(inputChars / 4);
  const completionTokens = Math.ceil(outputChars / 4);
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
    estimated: true
  };
}

function injectRuntimeBootstrap(html, instance) {
  const managedConfig = {
    endpoint: '',
    apiKey: 'managed-by-narrative-engine',
    model: instance.provider.model,
    type: 'openai',
    corsProxyUrl: '',
    maxOutputTokens: instance.budget.maxOutputTokensPerCall,
    streamMode: 'stream'
  };
  const publicRuntime = {
    spec: 'lra.heavy-frontend-runtime/v1',
    packageId: instance.packageId,
    revisionId: instance.revisionId,
    contentHash: instance.contentHash,
    runtimeSessionId: instance.runtimeSessionId,
    provider: instance.providerPublic,
    budget: instance.budget
  };
  const script = `<script data-lra-heavy-runtime>\n(() => {\n  'use strict';\n  const managed = ${safeJsonForInlineScript(managedConfig)};\n  const runtimeBase = location.pathname.includes('/files/') ? location.pathname.slice(0, location.pathname.indexOf('/files/')) : '';\n  managed.endpoint = runtimeBase + '/v1';\n  managed.corsProxyUrl = runtimeBase + '/proxy';\n  const runtime = ${safeJsonForInlineScript(publicRuntime)};\n  const nonce = ${safeJsonForInlineScript(instance.bridgeNonce)};\n  const parentOrigin = ${safeJsonForInlineScript(instance.parentOrigin)};\n  const originalSetItem = Storage.prototype.setItem;\n  const enforce = (value) => {\n    let parsed = {};\n    try { parsed = JSON.parse(String(value || '{}')); } catch {}\n    return JSON.stringify({ ...parsed, ...managed });\n  };\n  Storage.prototype.setItem = function(key, value) {\n    if (this === localStorage && key === 'jxz_apiConfig') return originalSetItem.call(this, key, enforce(value));\n    if (this === localStorage && key === 'jxz_embeddingConfig') {\n      return originalSetItem.call(this, key, JSON.stringify({ enabled: false, apiKey: '', managedBy: 'Narrative Roleplay Engine' }));\n    }\n    return originalSetItem.call(this, key, value);\n  };\n  originalSetItem.call(localStorage, 'jxz_apiConfig', JSON.stringify(managed));\n  originalSetItem.call(localStorage, 'jxz_embeddingConfig', JSON.stringify({ enabled: false, apiKey: '', managedBy: 'Narrative Roleplay Engine' }));\n  Object.defineProperty(window, '__LRA_HEAVY_RUNTIME__', { value: Object.freeze(runtime), configurable: false });\n  const send = (message) => parent.postMessage({ ...message, nonce }, parentOrigin);\n  const bindKnownApi = () => {\n    if (!window.apiService || window.apiService.__lraManaged) return;\n    const originalUpdate = window.apiService.updateConfig?.bind(window.apiService);\n    if (originalUpdate) window.apiService.updateConfig = (next) => originalUpdate({ ...(next || {}), ...managed });\n    Object.defineProperty(window.apiService, '__lraManaged', { value: true });\n  };\n  addEventListener('DOMContentLoaded', () => { bindKnownApi(); send({ type: 'lra-heavy:ready', runtime }); }, { once: true });\n  addEventListener('message', (event) => {\n    if (event.source !== parent || event.origin !== parentOrigin || event.data?.nonce !== nonce) return;\n    if (event.data?.type !== 'lra-heavy:snapshot-request') return;\n    try {\n      if (!window.storageService?.buildSavePayload) throw new Error('当前应用未公开兼容存档接口');\n      const payload = window.storageService.buildSavePayload('叙界托管快照', false);\n      send({ type: 'lra-heavy:snapshot', requestId: event.data.requestId, payload });\n    } catch (error) {\n      send({ type: 'lra-heavy:snapshot-error', requestId: event.data.requestId, error: String(error?.message || error) });\n    }\n  });\n})();\n</script>`;
  if (/<head(?:\s[^>]*)?>/i.test(html)) return html.replace(/<head(?:\s[^>]*)?>/i, (match) => `${match}\n${script}`);
  return `${script}\n${html}`;
}

function safeJsonForInlineScript(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

function normalizeParentOrigin(value) {
  try {
    const url = new URL(String(value || 'http://127.0.0.1:5178'));
    if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname)) throw new Error('not local');
    return url.origin;
  } catch {
    throw new HeavyFrontendError(403, 'HEAVY_FRONTEND_PARENT_ORIGIN_INVALID');
  }
}

function safeRuntimeRequestPath(value) {
  try {
    return safeHeavyFrontendPath(value);
  } catch (error) {
    throw new HeavyFrontendError(400, error.code || 'HEAVY_FRONTEND_INVALID_PATH', error.detail);
  }
}

function safeId(value) {
  const normalized = String(value || '');
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(normalized)) throw new HeavyFrontendError(400, 'HEAVY_FRONTEND_ID_INVALID');
  return normalized;
}

function mapBundleError(error) {
  const code = String(error?.code || error?.message || 'HEAVY_FRONTEND_IMPORT_INVALID');
  const status = code.includes('TOO_LARGE') || code.includes('TOO_MANY') ? 413 : 400;
  return new HeavyFrontendError(status, code, error?.detail || '');
}

function hashToken(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function timingSafeEqualString(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function finiteInteger(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sanitizeAuditEvent(value) {
  return JSON.parse(JSON.stringify(value, (key, item) => {
    if (/^(?:prompt|messages|content|apiKey|authorization|secret)$/i.test(key)) return undefined;
    if (typeof item === 'string') return item.slice(0, 2000);
    return item;
  }));
}

function createContentSecurityPolicy() {
  return [
    "default-src 'none'",
    "script-src 'self' 'unsafe-inline' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' data: blob:",
    "connect-src 'self'",
    "worker-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "frame-ancestors http://127.0.0.1:* http://localhost:*"
  ].join('; ');
}

export const HEAVY_FRONTEND_RUNTIME_HEADERS = Object.freeze({
  'content-security-policy': createContentSecurityPolicy(),
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), clipboard-read=(), clipboard-write=()'
});
