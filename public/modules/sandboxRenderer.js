// 沙箱渲染模块：将第三方 HTML/JavaScript replacement 在隔离 iframe 中渲染。
// 安全策略：
// - iframe 始终不带 allow-same-origin，阻止访问父页面 DOM、Cookie、localStorage
// - CSP 默认拒绝网络、外部资源、嵌套 frame、表单和对象；开发兼容探针才会显式放开浏览器侧能力
// - 本地探索与开发兼容探针允许未拒绝的当前内容进入沙箱；严格模式要求哈希审核
// - assessScriptRisk() 评估脚本风险等级，审核和运行时 UI 均展示风险

const SANDBOX_IFRAME_STYLE = 'width:100%;border:none;border-radius:6px;overflow:hidden;background:transparent;';
const MAX_SANDBOX_FRAGMENTS = 16;
const LOCAL_OBSERVE_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  "connect-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "worker-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ');
const COMPATIBILITY_PROBE_CSP = [
  'default-src * data: blob:',
  "script-src * data: blob: 'unsafe-inline' 'unsafe-eval'",
  "style-src * 'unsafe-inline'",
  'img-src * data: blob:',
  'font-src * data: blob:',
  'media-src * data: blob:',
  'connect-src *',
  'frame-src *',
  'child-src *',
  'worker-src * data: blob:',
  'object-src *',
  'base-uri *',
  'form-action *'
].join('; ');
const SANDBOX_BOOTSTRAP_SCRIPT = `<script>
(function(){
  var pendingHeight = 0;
  function notifyHeight() {
    var h = document.documentElement.scrollHeight || document.body.scrollHeight;
    if (h !== pendingHeight) {
      pendingHeight = h;
      parent.postMessage({ __lraSandbox: true, type: 'height', height: h }, '*');
    }
  }
  window.addEventListener('load', function() {
    notifyAudit('loaded', '');
    notifyHeight();
    setTimeout(notifyHeight, 200);
    setTimeout(notifyHeight, 1000);
  });
  var mo = new MutationObserver(function() { notifyHeight(); });
  var auditCount = 0;
  function notifyAudit(status, errorCode) {
    if (auditCount >= 3) return;
    auditCount += 1;
    parent.postMessage({ __lraSandbox: true, type: 'audit', status: status, errorCode: errorCode }, '*');
  }
  window.addEventListener('error', function() { notifyAudit('failed', 'SANDBOX_RUNTIME_ERROR'); });
  window.addEventListener('unhandledrejection', function() { notifyAudit('failed', 'SANDBOX_UNHANDLED_REJECTION'); });
  document.addEventListener('DOMContentLoaded', function() {
    mo.observe(document.body, { childList: true, subtree: true, attributes: true });
  });
})();
</script>`;

/**
 * 评估脚本/HTML 内容的风险等级
 * @param {string} htmlContent - 要评估的 HTML/JS 内容
 * @returns {{ level: 'low'|'medium'|'high', risks: string[], summary: string }}
 */
export function assessScriptRisk(htmlContent) {
  const source = String(htmlContent || '');
  const risks = [];
  let level = 'low';

  // 高危：明确的网络请求
  if (/fetch\s*\(|XMLHttpRequest|new\s+WebSocket|navigator\.sendBeacon|<img[^>]+src\s*=/i.test(source)) {
    risks.push('脚本可能发起网络请求（fetch/XHR/WebSocket/img），存在数据外泄风险');
    level = 'high';
  }
  // 高危：访问 cookie/storage
  if (/document\.cookie|localStorage|sessionStorage/i.test(source)) {
    risks.push('脚本尝试访问 Cookie 或本地存储（沙箱已隔离，无法读取父页面数据）');
    level = 'high';
  }
  // 高危：动态代码执行
  if (/eval\s*\(|new\s+Function|setTimeout\s*\(\s*['"]|setInterval\s*\(\s*['"]/i.test(source)) {
    risks.push('脚本包含动态代码执行（eval/new Function），行为难以静态分析');
    level = 'high';
  }
  // 中危：外部资源加载
  if (/<\s*(?:script|link|iframe|object|embed)[^>]+src\s*=/i.test(source) || /https?:\/\//i.test(source)) {
    risks.push('脚本引用外部资源（URL），实际行为取决于外部内容');
    if (level !== 'high') level = 'medium';
  }
  // 中危：postMessage 通信
  if (/postMessage|window\.parent|window\.top/i.test(source)) {
    risks.push('脚本尝试与父窗口通信（postMessage，沙箱已限制跨域）');
    if (level !== 'high') level = 'medium';
  }
  // 基础风险：包含可执行脚本
  if (/<\s*script/i.test(source)) {
    risks.push('包含 <script> 标签，将在隔离沙箱中执行');
    if (level === 'low') level = 'medium';
  }
  // 基础风险：事件处理器
  if (/\son[a-z]+\s*=/i.test(source)) {
    risks.push('包含内联事件处理器（onclick 等），将在隔离沙箱中执行');
    if (level === 'low') level = 'medium';
  }
  // 基础风险：javascript: 协议
  if (/javascript\s*:/i.test(source)) {
    risks.push('包含 javascript: 协议链接');
    if (level === 'low') level = 'medium';
  }

  const summary = level === 'high'
    ? '高风险：脚本包含网络、存储访问或动态执行；默认仅在隔离沙箱中本地观察，并建议切换严格审核'
    : level === 'medium'
      ? '中风险：脚本仅在无网络、无父页面权限的受限沙箱中观察运行；建议核对其行为'
      : '低风险：未识别高危能力，仍仅在受控沙箱中本地观察运行';

  return { level, risks, summary };
}

/**
 * 创建沙箱 iframe 元素
 * @param {string} htmlContent - 要渲染的 HTML 内容（含 script/style）
 * @param {object} context - 渲染上下文（user/char/mvu 等变量）
 * @param {object} options - 运行策略；compatibility-probe 只放开子 iframe 浏览器能力
 * @returns {HTMLIFrameElement}
 */
export function createSandboxedFrame(htmlContent, context = {}, { executionMode = 'local-observe' } = {}) {
  const mode = normalizeSandboxExecutionMode(executionMode);
  const isCompatibilityProbe = mode === 'compatibility-probe';
  const policy = isCompatibilityProbe ? COMPATIBILITY_PROBE_CSP : LOCAL_OBSERVE_CSP;
  const iframe = document.createElement('iframe');
  iframe.setAttribute(
    'sandbox',
    isCompatibilityProbe
      ? 'allow-scripts allow-forms allow-modals allow-popups allow-downloads'
      : 'allow-scripts'
  );
  iframe.setAttribute('style', SANDBOX_IFRAME_STYLE);
  iframe.setAttribute('scrolling', 'no');
  iframe.setAttribute('frameborder', '0');
  iframe.setAttribute('referrerpolicy', 'no-referrer');
  iframe.setAttribute('csp', policy);
  iframe.dataset.sandboxExecutionMode = mode;

  // 注入上下文变量
  const contextScript = `<script>window.__lraContext = ${serializeForInlineScript(sanitizeContext(context))};</script>`;

  // 构建完整文档
  const fullDoc = buildSandboxDocument(htmlContent, contextScript, policy);

  // 使用 srcdoc 而非 blob URL，确保无网络请求
  iframe.setAttribute('srcdoc', fullDoc);

  // 监听高度变化
  const messageId = `sandbox-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  iframe.dataset.sandboxId = messageId;

  return iframe;
}

/**
 * 将消息容器替换为沙箱 iframe
 * @param {HTMLElement} container - 消息内容容器
 * @param {string} htmlContent - HTML 内容
 * @param {object} context - 渲染上下文
 */
export function mountSandboxedContent(container, htmlContent, context = {}, {
  onAudit,
  executionMode = context?.scriptExecutionMode
} = {}) {
  // 清空容器
  container.innerHTML = '';
  const frame = createSandboxedFrame(htmlContent, context, { executionMode });
  if (typeof onAudit === 'function') onAudit({ status: 'launched' });
  container.appendChild(frame);

  // 监听 postMessage 调整高度
  const messageHandler = (event) => {
    if (!event.data || event.data.__lraSandbox !== true) return;
    if (event.source !== frame.contentWindow) return;
    if (event.data.type === 'audit') {
      if (typeof onAudit === 'function') onAudit({ status: event.data.status, errorCode: event.data.errorCode });
      return;
    }
    if (event.data.type !== 'height') return;
    const height = Number(event.data.height) || 0;
    if (height > 0 && height < 10000) {
      frame.style.height = `${height + 8}px`;
    }
  };
  window.addEventListener('message', messageHandler);

  // 清理函数（在 iframe 移除时调用）
  frame._cleanup = () => window.removeEventListener('message', messageHandler);
}

/**
 * 检查 HTML 内容是否需要沙箱渲染
 */
export function requiresSandbox(htmlContent) {
  const source = String(htmlContent || '');
  return /<\s*(?:script|iframe|object|embed)(?:\s|>)/i.test(source)
    || /javascript\s*:/i.test(source)
    || /\son[a-z]+\s*=/i.test(source);
}

/**
 * 应用沙箱渲染：本地观察模式下运行可隔离规则；严格模式下仅运行通过当前内容哈希审核的规则
 * @param {string} text - 原始文本
 * @param {object[]} rules - regex 规则列表
 * @param {object[]} reviews - 内容哈希绑定的审核记录
 * @param {object} context - 渲染上下文
 * @returns {{ text: string, sandboxFragments: Map<string, object>, riskAssessments: object[], blockedAssessments: object[] }}
 *   sandboxFragments: 占位符 → 受审核脚本描述的映射，前端在 DOM 渲染后替换为 iframe
 *   riskAssessments: 每条规则的风险评估结果，用于 UI 告知
 */
export function applySandboxTransforms(text, rules = [], reviews = [], context = {}) {
  let output = String(text || '');
  const sandboxFragments = new Map();
  const riskAssessments = [];
  const blockedAssessments = [];
  let sandboxIndex = 0;

  for (const rule of Array.isArray(rules) ? rules.slice(0, 32) : []) {
    if (!rule || rule.enabled === false) continue;
    if (!rule.requiresSandbox) continue;

    const scope = ['assistant', 'user', 'all'].includes(rule.scope) ? rule.scope : 'assistant';
    if (scope !== 'all' && scope !== (context.role || 'assistant')) continue;

    const pattern = String(rule.pattern || '');
    if (!pattern || pattern.length > 500) continue;

    const scriptId = String(rule.id || '').trim();
    const contentHash = String(rule.contentHash || '').trim();
    const risk = assessScriptRisk(String(rule.replacement || ''));
    const assessment = {
      id: scriptId || `rule-${sandboxIndex}`,
      name: String(rule.name || rule.id || ''),
      contentHash,
      level: risk.level,
      summary: risk.summary,
      risks: risk.risks
    };
    try {
      const flags = normalizeFlags(rule.flags);
      const regex = new RegExp(pattern, flags);
      const execution = resolveRuleExecution(rule, reviews, context.scriptExecutionMode);
      if (!execution.allowed) {
        const probe = new RegExp(pattern, flags.replace(/g/g, ''));
        if (probe.test(output)) blockedAssessments.push({ ...assessment, blockedReason: execution.reason });
        continue;
      }
      const replacement = String(rule.replacement || '').slice(0, 524288);
      const expanded = expandContextMacros(replacement, context);

      output = output.replace(regex, (matchedText) => {
        if (sandboxIndex >= MAX_SANDBOX_FRAGMENTS) return matchedText;
        const placeholder = `LRA-SANDBOX-FRAGMENT-${sandboxIndex}`;
        const expandedRisk = assessScriptRisk(expanded);
        const fragmentAssessment = {
          ...assessment,
          level: expandedRisk.level,
          summary: expandedRisk.summary,
          risks: expandedRisk.risks
        };
        sandboxFragments.set(placeholder, {
          html: expanded,
          scriptId,
          contentHash,
          risk: fragmentAssessment
        });
        riskAssessments.push(fragmentAssessment);
        sandboxIndex += 1;
        return placeholder;
      });
    } catch {
      // 无效正则跳过
    }
  }

  return { text: output, sandboxFragments, riskAssessments, blockedAssessments };
}

function buildSandboxDocument(htmlContent, contextScript, policy) {
  const policyHead = `<meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer"><style>html,body{margin:0;padding:0;background:transparent;}</style>`;
  const policyBootstrap = `${policyHead}${contextScript}${SANDBOX_BOOTSTRAP_SCRIPT}`;
  // 检测是否已经是完整 HTML 文档
  const isFullDoc = /<\s*!doctype|<\s*html[\s>]/i.test(htmlContent);
  if (isFullDoc) {
    if (/<\s*head[\s>]/i.test(htmlContent)) {
      return htmlContent.replace(/<\s*head([^>]*)>/i, (head) => `${head}${policyBootstrap}`);
    }
    return htmlContent.replace(/<\s*html([^>]*)>/i, (html) => `${html}<head>${policyBootstrap}</head>`);
  }
  // 非完整文档，包装为完整 HTML
  return `<!DOCTYPE html><html><head>${policyBootstrap}</head><body><div id="__sandbox_mount__">${htmlContent}</div></body></html>`;
}

function sanitizeContext(context = {}) {
  // 只传递安全的上下文变量
  const safe = {};
  const allowed = ['user', 'char', 'scene', 'location', 'time'];
  for (const key of allowed) {
    if (context[key] !== undefined) safe[key] = String(context[key]).slice(0, 200);
  }
  // MVU 状态（只读）
  const mvu = context.mvu ?? context.state ?? context.variables;
  if (mvu && typeof mvu === 'object') {
    const safeMvu = sanitizeSerializable(mvu);
    safe.mvu = safeMvu;
    safe.variables = safeMvu;
    safe.state = safeMvu;
  }
  return safe;
}

function sanitizeSerializable(value, depth = 0) {
  if (depth > 5) return null;
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return value.slice(0, 4000);
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeSerializable(item, depth + 1));
  if (!value || typeof value !== 'object') return null;
  const result = {};
  for (const [key, item] of Object.entries(value).slice(0, 100)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) continue;
    result[String(key).slice(0, 100)] = sanitizeSerializable(item, depth + 1);
  }
  return result;
}

function serializeForInlineScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function resolveRuleExecution(rule, reviews, executionMode = 'local-observe') {
  const scriptId = String(rule?.id || '').trim();
  const contentHash = String(rule?.contentHash || '').trim();
  if (!scriptId || !/^sha256:[a-f0-9]{64}$/.test(contentHash)) {
    return { allowed: false, reason: 'invalid-script-identity' };
  }
  const values = Array.isArray(reviews) ? reviews : [];
  let latest = null;
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const review = values[index];
    if (String(review?.scriptId || '') === scriptId) {
      latest = review;
      break;
    }
  }
  const currentReview = latest
    && latest.contentHash === contentHash
    && Number(latest.policyVersion) === 1
    ? latest
    : null;
  if (currentReview && ['rejected', 'revoked'].includes(currentReview.decision)) {
    return { allowed: false, reason: 'explicitly-rejected' };
  }
  if (String(executionMode || '') === 'review-required') {
    return currentReview?.decision === 'approved'
      ? { allowed: true, reason: 'approved' }
      : { allowed: false, reason: 'review-required' };
  }
  const mode = normalizeSandboxExecutionMode(executionMode);
  return {
    allowed: true,
    reason: currentReview?.decision === 'approved'
      ? 'approved'
      : mode === 'compatibility-probe' ? 'compatibility-probe' : 'local-observe'
  };
}

export function normalizeSandboxExecutionMode(value) {
  return String(value || '').trim().toLowerCase() === 'compatibility-probe'
    ? 'compatibility-probe'
    : 'local-observe';
}

function expandContextMacros(text, context = {}) {
  let result = String(text || '');
  const values = {
    user: context.user || '',
    char: context.char || '',
    scene: context.scene || '',
    location: context.location || '',
    time: context.time || ''
  };
  result = result.replace(/\{\{\s*(user|char|scene|location|time)\s*\}\}/gi, (_, key) => {
    return String(values[String(key).toLowerCase()] || '');
  });
  return result;
}

function normalizeFlags(value) {
  const flags = [...new Set(String(value || 'g').split('').filter((flag) => 'gimsu'.includes(flag)))].join('');
  return flags || 'g';
}
