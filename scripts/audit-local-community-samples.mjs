import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { importCharacterCardFromPayload } from '../server/character/characterCardImport.js';
import { scanCommunityDependencies } from '../server/resources/communityDependencyScanner.js';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_MANIFEST_PATH = path.join(
  ROOT_DIR,
  'data/community/compatibility-samples/manifest.json'
);

const VALID_RESOURCE_TYPES = new Set(['character', 'worldbook', 'preset']);
const VALID_CONTENT_TIERS = new Set(['sfw', 'nsfw', 'general']);
const VALID_FRONTEND_TIERS = new Set(['text', 'light', 'heavy', 'not-applicable']);
const VALID_STATUSES = new Set(['ready', 'candidate', 'pending', 'not-applicable']);

export async function auditLocalCommunitySamples(
  manifestPath = DEFAULT_MANIFEST_PATH,
  { requireComplete = false } = {}
) {
  const absoluteManifestPath = path.resolve(manifestPath);
  const manifest = JSON.parse(stripBom(await readFile(absoluteManifestPath, 'utf8')));
  validateManifest(manifest);

  const results = [];
  for (const sample of manifest.samples) {
    if (sample.status !== 'ready') {
      results.push({
        id: sample.id,
        resourceType: sample.resourceType,
        contentTier: sample.contentTier,
        frontendTier: sample.frontendTier,
        status: sample.status,
        matrixSlot: sample.matrixSlot !== false,
        note: String(sample.note || '')
      });
      continue;
    }

    results.push(await auditReadySample(sample));
  }

  const failures = results.filter((item) => item.status === 'failed');
  const incomplete = results.filter((item) => (
    item.matrixSlot !== false && ['candidate', 'pending'].includes(item.status)
  ));
  return {
    manifestPath: absoluteManifestPath,
    schemaVersion: manifest.schemaVersion,
    results,
    summary: summarizeResults(results),
    requireComplete,
    complete: incomplete.length === 0,
    incomplete: incomplete.map((item) => item.id),
    ok: failures.length === 0 && (!requireComplete || incomplete.length === 0)
  };
}

async function auditReadySample(sample) {
  try {
    const sourcePath = path.resolve(String(sample.sourcePath || ''));
    const sourceStat = await stat(sourcePath);
    if (!sourceStat.isFile()) throw new Error('sourcePath 不是普通文件');

    const bytes = await readFile(sourcePath);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sample.sha256 && sha256 !== sample.sha256) {
      throw new Error(`文件哈希已变化：期望 ${sample.sha256}，实际 ${sha256}`);
    }

    const inspected = inspectResource(sample.resourceType, sourcePath, bytes);
    const actualOutcome = inspected.compatibility?.acceptance?.outcome || 'unknown';
    if (sample.expectedOutcome && actualOutcome !== sample.expectedOutcome) {
      throw new Error(`兼容结果漂移：期望 ${sample.expectedOutcome}，实际 ${actualOutcome}`);
    }

    return {
      id: sample.id,
      resourceType: sample.resourceType,
      contentTier: sample.contentTier,
      frontendTier: sample.frontendTier,
      status: 'passed',
      bytes: sourceStat.size,
      sha256,
      outcome: actualOutcome,
      details: inspected.details
    };
  } catch (error) {
    return {
      id: sample.id,
      resourceType: sample.resourceType,
      contentTier: sample.contentTier,
      frontendTier: sample.frontendTier,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function inspectResource(resourceType, sourcePath, bytes) {
  if (resourceType === 'character') {
    const imported = importCharacterCardFromPayload({
      mimeType: path.extname(sourcePath).toLowerCase() === '.png' ? 'image/png' : 'application/json',
      data: bytes
    });
    const payload = imported.characterCard.raw || imported.characterCard;
    return {
      compatibility: scanCommunityDependencies(payload, { kind: 'character' }),
      details: {
        name: imported.characterCard.name || path.basename(sourcePath),
        sourceSpec: imported.characterCard.sourceSpec,
        worldBookEntries: countEntries(Array.isArray(imported.worldBook) ? imported.worldBook : imported.worldBook?.entries)
      }
    };
  }

  const payload = JSON.parse(stripBom(bytes.toString('utf8')));
  const compatibilityKind = resourceType === 'preset' ? 'prompt' : 'worldbook';
  const arrays = collectNamedArrays(payload);
  return {
    compatibility: scanCommunityDependencies(payload, { kind: compatibilityKind }),
    details: resourceType === 'worldbook'
      ? {
          name: stringName(payload, sourcePath),
          entries: countEntries(payload.entries ?? payload.data?.entries)
        }
      : {
          name: stringName(payload, sourcePath),
          prompts: arrays.prompts.length,
          enabledPrompts: countEnabledPrompts(payload, arrays.prompts),
          regexRules: arrays.regexRules.length,
          enabledRegexRules: arrays.regexRules.filter((item) => item?.disabled !== true).length,
          scriptLikeRules: arrays.regexRules.filter(isScriptLikeRule).length,
          htmlLikeRules: arrays.regexRules.filter(isHtmlLikeRule).length
        }
  };
}

function collectNamedArrays(payload) {
  const prompts = [];
  const regexRules = [];
  const seen = new Set();

  function visit(value, depth = 0) {
    if (!value || typeof value !== 'object' || seen.has(value) || depth > 12) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth + 1));
      return;
    }
    for (const [key, item] of Object.entries(value)) {
      const normalized = key.toLowerCase().replaceAll('-', '_');
      if (Array.isArray(item) && ['prompts', 'prompt_order'].includes(normalized)) {
        if (normalized === 'prompts') prompts.push(...item.filter(isObject));
      }
      if (Array.isArray(item) && ['regex_scripts', 'regexscripts'].includes(normalized)) {
        regexRules.push(...item.filter(isObject));
      }
      visit(item, depth + 1);
    }
  }

  visit(payload);
  return { prompts: uniqueObjects(prompts), regexRules: uniqueObjects(regexRules) };
}

function countEnabledPrompts(payload, prompts) {
  const promptOrder = Array.isArray(payload?.prompt_order) ? payload.prompt_order : [];
  const enabledIds = new Set();
  for (const group of promptOrder) {
    const entries = Array.isArray(group?.order) ? group.order : [];
    for (const item of entries) {
      if (item?.enabled === false || item?.identifier === undefined) continue;
      enabledIds.add(String(item.identifier));
    }
  }
  if (!enabledIds.size) return prompts.filter((item) => item?.enabled !== false).length;
  return prompts.filter((item) => enabledIds.has(String(item?.identifier ?? item?.id ?? ''))).length;
}

function isScriptLikeRule(rule) {
  const text = ruleText(rule);
  return /<script(?:\s|>)|javascript\s*:|\b(?:eval|function|import)\s*\(/i.test(text);
}

function isHtmlLikeRule(rule) {
  return /<(?:div|style|button|form|iframe)(?:\s|>)/i.test(ruleText(rule));
}

function ruleText(rule) {
  return [rule?.replaceString, rule?.replacement, rule?.replace_string, rule?.script]
    .filter((value) => typeof value === 'string')
    .join('\n');
}

function stringName(payload, sourcePath) {
  const candidates = [payload?.name, payload?.preset_name, payload?.title, payload?.data?.name];
  return String(candidates.find((item) => typeof item === 'string' && item.trim()) || path.basename(sourcePath));
}

function countEntries(entries) {
  if (Array.isArray(entries)) return entries.length;
  if (entries && typeof entries === 'object') return Object.keys(entries).length;
  return 0;
}

function validateManifest(manifest) {
  if (manifest?.schemaVersion !== 1) throw new Error('仅支持 schemaVersion=1 的本地样本清单');
  if (!Array.isArray(manifest.samples)) throw new Error('manifest.samples 必须是数组');

  const ids = new Set();
  for (const sample of manifest.samples) {
    if (!sample?.id || ids.has(sample.id)) throw new Error(`样本 id 缺失或重复：${sample?.id || '(empty)'}`);
    ids.add(sample.id);
    if (!VALID_RESOURCE_TYPES.has(sample.resourceType)) throw new Error(`${sample.id}: resourceType 无效`);
    if (!VALID_CONTENT_TIERS.has(sample.contentTier)) throw new Error(`${sample.id}: contentTier 无效`);
    if (!VALID_FRONTEND_TIERS.has(sample.frontendTier)) throw new Error(`${sample.id}: frontendTier 无效`);
    if (!VALID_STATUSES.has(sample.status)) throw new Error(`${sample.id}: status 无效`);
    if (sample.status === 'ready' && !sample.sourcePath) throw new Error(`${sample.id}: ready 样本缺少 sourcePath`);
  }
}

function summarizeResults(results) {
  const summary = { total: results.length, passed: 0, failed: 0, candidate: 0, pending: 0, notApplicable: 0 };
  for (const item of results) {
    if (item.status === 'passed') summary.passed += 1;
    else if (item.status === 'failed') summary.failed += 1;
    else if (item.status === 'candidate') summary.candidate += 1;
    else if (item.status === 'pending') summary.pending += 1;
    else if (item.status === 'not-applicable') summary.notApplicable += 1;
  }
  return summary;
}

function uniqueObjects(values) {
  return [...new Set(values)];
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stripBom(text) {
  return String(text || '').replace(/^\uFEFF/, '');
}

function printReport(report) {
  console.log('本地社区兼容样本审计');
  console.log(`清单：${report.manifestPath}`);
  for (const item of report.results) {
    const slot = `${item.resourceType}/${item.contentTier}/${item.frontendTier}`;
    if (item.status === 'passed') {
      console.log(`OK    ${slot}  ${item.id}  compatibility=${item.outcome}  ${item.bytes} bytes`);
    } else if (item.status === 'failed') {
      console.log(`FAIL  ${slot}  ${item.id}  ${item.error}`);
    } else {
      console.log(`${item.status.toUpperCase().padEnd(7)} ${slot}  ${item.id}${item.note ? `  ${item.note}` : ''}`);
    }
  }
  const value = report.summary;
  console.log(
    `汇总：${value.passed} 通过，${value.failed} 失败，${value.candidate} 候选，`
    + `${value.pending} 待补，${value.notApplicable} 不适用`
  );
  if (report.requireComplete && !report.complete) {
    console.log(`签发阻断：${report.incomplete.length} 个必填样例尚未就绪（${report.incomplete.join('、')}）`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const requireComplete = args.includes('--require-complete');
  const manifestPath = args.find((item) => !item.startsWith('--')) || DEFAULT_MANIFEST_PATH;
  const report = await auditLocalCommunitySamples(manifestPath, { requireComplete });
  printReport(report);
  if (!report.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
