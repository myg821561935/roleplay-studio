import { extractLightFrontendRuntime } from '../compat/lightFrontendRuntime.js';

const MAX_IMPORTED_REGEX_RULES = 128;

export function importSillyTavernRegexPreset(document, { fileName = '' } = {}) {
  const rules = collectSillyTavernRegexRules(document);
  if (!rules.length) return null;

  const title = resolveRegexPresetTitle(document, fileName);
  const runtimeCompanion = createSillyTavernRegexCompanion(rules, {
    title,
    sourceFormat: 'sillytavern-regex-preset'
  });
  const compatibility = summarizeRegexCompatibility(rules);

  return {
    title,
    sourceFormat: 'sillytavern-regex-preset',
    rules,
    runtimeCompanion,
    compatibility,
    counts: {
      total: rules.length,
      safe: compatibility.safe,
      degraded: compatibility.degraded,
      sandboxed: compatibility.sandboxed,
      blocked: compatibility.blocked,
      truncated: compatibility.truncated,
      enabled: rules.filter((rule) => rule.disabled !== true && rule.enabled !== false).length
    }
  };
}

export function createSillyTavernRegexCompanion(documentOrRules, {
  title = 'SillyTavern Regex 配套规则',
  sourceFormat = 'sillytavern-regex-preset'
} = {}) {
  const rules = Array.isArray(documentOrRules)
    ? documentOrRules.filter(isRegexRule).slice(0, MAX_IMPORTED_REGEX_RULES)
    : collectSillyTavernRegexRules(documentOrRules);
  if (!rules.length) return null;

  return {
    id: 'st-regex-runtime-companion',
    title: `${title} · Regex 配套`,
    enabled: false,
    content: '配套 Regex 声明式运行时。该资源不注入模型提示词；安全规则按作用域运行，可隔离脚本在本地观察模式中运行并记录。',
    role: 'system',
    position: 'relative',
    depth: 0,
    order: 0,
    source: sourceFormat,
    extensions: {
      regex_scripts: structuredClone(rules),
      sillyTavernPreset: {
        presetTitle: title,
        sourceFormat,
        runtimeCompanion: true
      },
      sillyTavernRuntimeCompanion: {
        kind: 'regex',
        sourceFormat,
        ruleCount: rules.length,
        executesThirdPartyCode: false
      }
    }
  };
}

export function collectSillyTavernRegexRules(document) {
  const candidates = [];
  if (Array.isArray(document)) candidates.push(...document);
  if (isPlainObject(document)) {
    if (isRegexRule(document)) candidates.push(document);
    const extensions = isPlainObject(document.extensions) ? document.extensions : {};
    for (const value of [
      document.regex_scripts,
      document.regexScripts,
      document.regex,
      extensions.regex_scripts,
      extensions.regexScripts,
      extensions.regex
    ]) {
      if (Array.isArray(value)) candidates.push(...value);
    }
  }
  return candidates.filter(isRegexRule).slice(0, MAX_IMPORTED_REGEX_RULES).map((rule) => structuredClone(rule));
}

function summarizeRegexCompatibility(rules) {
  const runtime = extractLightFrontendRuntime({ extensions: { regex_scripts: rules } });
  const diagnostics = dedupeRegexDiagnostics(runtime.diagnostics);
  const blocked = diagnostics.filter((item) => [
    'unsafe-regex-disabled',
    'invalid-regex-disabled'
  ].includes(item.code)).length;
  const degraded = diagnostics.filter((item) => item.code === 'html-regex-replacement-degraded').length;
  const sandboxed = runtime.regexTransforms.filter((item) => item.requiresSandbox === true).length;
  const safe = runtime.regexTransforms.filter((item) => item.requiresSandbox !== true).length;
  // extractLightFrontendRuntime 内部 MAX_REGEX_RULES=32 截断，超出部分未分类
  const processed = safe + sandboxed;
  const truncated = Math.max(0, rules.length - processed - blocked - degraded);
  return {
    safe,
    degraded,
    sandboxed,
    blocked,
    truncated,
    diagnostics,
    executesThirdPartyCode: false
  };
}

function dedupeRegexDiagnostics(diagnostics = []) {
  const seen = new Set();
  return diagnostics.filter((item) => {
    const key = JSON.stringify([
      item?.code || '',
      Number.isInteger(item?.index) ? item.index : '',
      item?.label || '',
      item?.message || '',
      Array.isArray(item?.markers) ? item.markers : []
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function resolveRegexPresetTitle(document, fileName) {
  const fromFile = String(fileName || '').replace(/\.(?:json|ya?ml)$/i, '').trim();
  return String(
    (isPlainObject(document) && (document.name || document.title || document.preset_name))
    || (isPlainObject(document) && document.scriptName)
    || fromFile
    || '导入的 Regex 配套规则'
  ).trim().slice(0, 120);
}

function isRegexRule(value) {
  if (!isPlainObject(value)) return false;
  const pattern = String(value.findRegex ?? value.pattern ?? value.regex ?? '').trim();
  if (!pattern) return false;
  return Boolean(
    value.scriptName
    || value.name
    || Object.hasOwn(value, 'replaceString')
    || Object.hasOwn(value, 'replacement')
    || Object.hasOwn(value, 'replace')
    || Object.hasOwn(value, 'placement')
  );
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
