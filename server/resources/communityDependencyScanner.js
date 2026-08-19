import {
  extractLightFrontendRuntime,
  inspectSafeTemplate
} from '../compat/lightFrontendRuntime.js';
import { buildCompatibilityAcceptance } from '../compat/compatibilityPolicy.js';
import { inspectWorldBookCharacterFilterTags } from '../character/worldBookTagRegistry.js';

const STATUS_PRIORITY = {
  supported: 0,
  degraded: 1,
  review: 2,
  missing: 3
};

const RUNTIME_RULES = [
  {
    id: 'tavern-helper',
    label: '酒馆助手运行时',
    category: 'runtime',
    status: 'missing',
    pathPatterns: [/tavern[._-]?helper/i, /酒馆助手/i],
    textPatterns: [/\btavern\s*helper\b/i, /酒馆助手/u],
    impact: '依赖酒馆助手提供的事件钩子、变量 API 或脚本生命周期；本项目不会执行这些扩展逻辑。',
    recommendation: '保留原卡并降级导入；需要逐项转换为声明式状态、动作协议或安全宏。'
  },
  {
    id: 'xiaobai-x',
    label: '小白 X 运行时',
    category: 'runtime',
    status: 'missing',
    pathPatterns: [/xiaobai[._-]?x/i, /小白\s*[xXＸ]/u],
    textPatterns: [/\bxiaobai[\s_-]*x\b/i, /小白\s*[xXＸ]/u],
    impact: '依赖小白 X 的变量协议、模板解析或专用面板；可映射的声明式部分会降级运行。',
    recommendation: '将角色变量和面板定义转换为本项目的世界状态、事实卡和侧栏组件。'
  },
  {
    id: 'stscript',
    label: 'STscript / 斜杠脚本',
    category: 'script',
    status: 'missing',
    pathPatterns: [/(?:^|\.)(?:stscript|slash_commands?|slashcommands?)(?:\.|$)/i],
    textPatterns: [
      /\bstscript\b/i,
      /(?:^|\s)\/(?:setvar|getvar|addvar|if|elseif|while|run|trigger)(?:\s|$)/im
    ],
    impact: '卡片包含酒馆脚本命令或变量读写，当前宏引擎不会执行这些命令。',
    recommendation: '改写为本项目宏、动作协议或世界状态更新规则。'
  },
  {
    id: 'executable-extension',
    label: '可执行 JavaScript / 事件钩子',
    category: 'script',
    status: 'missing',
    pathPatterns: [/(?:^|\.)(?:scripts?|javascript|scriptcode|onload|onmessage|hooks?)(?:\.|$)/i],
    textPatterns: [/<script(?:\s|>)/i, /javascript:\s*/i],
    impact: '检测到可执行脚本或事件钩子。未审核代码保持禁用；通过人工审核、内容哈希绑定和本地审计后，受支持的正则脚本可进入隔离沙箱。',
    recommendation: '逐条审核脚本来源、能力与副作用；只有审核通过且哈希未变化的脚本才能启用。'
  },
  {
    id: 'regex-scripts',
    label: '酒馆正则脚本',
    category: 'transform',
    status: 'degraded',
    pathPatterns: [/(?:^|\.)(?:regex[_-]?scripts?|regexscripts?)(?:\.|$)/i],
    textPatterns: [/\bregex\s*script(?:s)?\b/i, /正则脚本/u],
    impact: '世界书正则触发可以使用，但酒馆的输出替换、显示过滤和脚本链不会自动执行。',
    recommendation: '将触发规则保留在世界书；将输出替换单独转换为安全渲染规则。'
  },
  {
    id: 'quick-replies',
    label: 'Quick Reply / 快捷回复定义',
    category: 'interaction',
    status: 'degraded',
    pathPatterns: [/(?:^|\.)(?:quick[_-]?repl(?:y|ies)|quickrepl(?:y|ies))(?:\.|$)/i],
    textPatterns: [/\bquick\s*repl(?:y|ies)\b/i, /快捷回复脚本/u],
    impact: '本项目有原生推荐选项，但不会直接载入酒馆 Quick Reply 的按钮脚本与命令链。',
    recommendation: '保留文案类选项；把命令型按钮转换为动作协议。'
  },
  {
    id: 'mvu-state',
    label: 'MVU / 变量状态',
    category: 'state',
    status: 'degraded',
    pathPatterns: [/(?:^|\.)(?:mvu|mvu[_-]?state|variables?|variable[_-]?state)(?:\.|$)/i],
    textPatterns: [/\bMVU\b/, /变量状态/u],
    impact: '可导入安全 JSON 初始状态并通过版本化补丁更新；只读 EJS 可渲染，酒馆助手脚本与事件钩子不会执行。',
    recommendation: '将脚本更新逻辑改写为 set、increment 或 delete 三类声明式状态操作。'
  },
  {
    id: 'safe-ejs-template',
    label: 'EJS 轻前端模板',
    category: 'template',
    status: 'degraded',
    pathPatterns: [/(?:^|\.)(?:ejs|template|display[_-]?template)(?:\.|$)/i],
    textPatterns: [/<%[=-]?[\s\S]*?%>/],
    impact: '只运行变量插值和只读条件分支；赋值、循环、函数调用与任意 JavaScript 不会执行。',
    recommendation: '将复杂模板逻辑改写为声明式 MVU 状态、显示规则或原生侧栏。'
  },
  {
    id: 'sidebar-panels',
    label: '声明式侧栏面板',
    category: 'presentation',
    status: 'degraded',
    pathPatterns: [
      /(?:^|\.)(?:status[_-]?panels?|sidebar[_-]?panels?)(?:\.|$)/i,
      /(?:light[_-]?frontend|tavern[._-]?helper|xiaobai[._-]?x)\.(?:panels?|widgets?)(?:\.|$)/i
    ],
    textPatterns: [/状态面板|侧栏面板/u],
    impact: '可将状态字段、条目列表和 Markdown 说明渲染为原生沉浸侧栏；不接受自定义 DOM 事件。',
    recommendation: '保留信息层级与只读变量路径；将点击逻辑改写为快捷回复或动作协议。'
  },
  {
    id: 'prompt-preset-order',
    label: '酒馆 Prompt 预设顺序',
    category: 'prompt',
    status: 'degraded',
    pathPatterns: [/(?:^|\.)(?:prompt[_-]?(?:order|layout)|promptmanager|instruct[_-]?template|context[_-]?template|preset)(?:\.|$)/i],
    textPatterns: [/提示词预设顺序/u, /prompt\s*(?:manager|order|preset)/i],
    impact: '普通系统提示和历史后指令可以使用，但酒馆预设的精确插入锚点与排序不会完全复现。',
    recommendation: '导入后在 Prompt 检查器中核对系统层、角色层和历史后指令的顺序。'
  },
  {
    id: 'declarative-lifecycle',
    label: '声明式生命周期',
    category: 'state',
    status: 'degraded',
    pathPatterns: [/(?:^|\.)(?:onImport|onUser|onAssistant|lifecycle_events?)(?:\.|$)/i],
    textPatterns: [],
    impact: '事件只允许在统一预算内执行白名单状态补丁，不执行原始脚本。',
    recommendation: '复核事件次数、状态路径、操作数量和失败回滚报告。'
  },
  {
    id: 'custom-html-ui',
    label: 'HTML / CSS 交互面板',
    category: 'presentation',
    status: 'missing',
    pathPatterns: [/(?:^|\.)(?:custom[_-]?html|custom[_-]?css|display[_-]?panel)(?:\.|$)/i],
    textPatterns: [/<(?:button|style|iframe|form)(?:\s|>)/i],
    impact: '原始 HTML、CSS 与表单会被安全转义，不会按酒馆扩展面板运行。',
    recommendation: '将需要长期展示的信息映射到主角信息、互动角色、榜单或记忆侧栏。'
  }
];

export function scanCommunityDependencies(payload, { kind = '' } = {}) {
  const records = collectRecords(payload);
  const requirements = [];
  const normalizedKind = String(kind || '').trim().toLowerCase();
  const lightFrontend = extractLightFrontendRuntime(payload);
  const templateReport = inspectCommunityTemplates(records);

  if (normalizedKind === 'character') {
    requirements.push(requirement({
      id: 'character-card-core',
      label: '标准角色卡字段',
      category: 'character',
      status: 'supported',
      evidence: ['角色描述、场景、开场白与角色提示词'],
      impact: '由本项目角色卡装配器原生加载。',
      recommendation: '无需额外扩展。'
    }));
  } else if (normalizedKind === 'worldbook') {
    requirements.push(requirement({
      id: 'worldbook-core',
      label: '世界书触发与插入深度',
      category: 'worldbook',
      status: 'supported',
      evidence: ['关键词、正则、逻辑、常驻与 Depth'],
      impact: '由本项目世界书检索器原生加载。',
      recommendation: '无需额外扩展。'
    }));
    const tagFilterReport = inspectWorldBookCharacterFilterTags(payload);
    if (tagFilterReport.unresolved.length) {
      requirements.push(requirement({
        id: 'worldbook-character-filter-tag-registry',
        label: 'Character Filter 标签注册表',
        category: 'worldbook',
        status: 'degraded',
        evidence: tagFilterReport.unresolved.slice(0, 6).map((item) => `${item.title}：${item.id}`),
        impact: `发现 ${tagFilterReport.unresolved.length} 个无法解析的 SillyTavern 私有标签 ID；包含过滤条目会保持不激活，排除过滤也无法可靠命中。`,
        recommendation: '从原 SillyTavern 用户设置导出对应 Tag Registry（ID 与名称），与世界书一起导入；或把过滤条件改为可移植标签名。'
      }));
    } else if (tagFilterReport.resolvedMappings.length) {
      requirements.push(requirement({
        id: 'worldbook-character-filter-tag-registry',
        label: 'Character Filter 标签注册表',
        category: 'worldbook',
        status: 'supported',
        evidence: tagFilterReport.resolvedMappings.slice(0, 6).map((item) => `${item.id} → ${item.name}`),
        impact: `已恢复 ${tagFilterReport.resolvedMappings.length} 个标签 ID 与可移植名称的映射。`,
        recommendation: '无需额外处理；运行时同时保留原 ID 和标签名匹配。'
      }));
    }
  } else if (normalizedKind === 'prompt') {
    requirements.push(requirement({
      id: 'prompt-module-core',
      label: '文本 Prompt 模块',
      category: 'prompt',
      status: 'supported',
      evidence: ['模块标题与文本内容'],
      impact: '由本项目 Prompt 装配器原生加载。',
      recommendation: '无需额外扩展。'
    }));
  }

  RUNTIME_RULES.forEach((rule) => {
    const evidence = findRuleEvidence(records, rule);
    if (!evidence.length) return;
    requirements.push(requirement(resolveLightFrontendRule(rule, lightFrontend, evidence, templateReport)));
  });

  const macroReport = inspectMacros(records);
  if (macroReport.supported.length) {
    requirements.push(requirement({
      id: 'native-macros',
      label: '本项目原生宏',
      category: 'prompt',
      status: 'supported',
      evidence: macroReport.supported.slice(0, 5).map((macro) => `{{${macro}}}`),
      impact: '这些宏会在角色卡、世界书和 Prompt 模块中展开。',
      recommendation: '无需额外扩展。'
    }));
  }
  if (macroReport.unsupported.length) {
    requirements.push(requirement({
      id: 'unknown-macros',
      label: '未识别的模板宏',
      category: 'prompt',
      status: 'degraded',
      evidence: macroReport.unsupported.slice(0, 5).map((macro) => `{{${macro}}}`),
      impact: '未识别宏会原样保留，模型可能看到未展开的模板文本。',
      recommendation: '在导入后将这些宏改写为本项目宏，或新增经过审计的宏适配器。'
    }));
  }

  return summarizeRequirements(requirements);
}

export function aggregateCommunityCompatibility(reports = []) {
  const byId = new Map();
  for (const report of reports.filter(Boolean)) {
    for (const item of report.requirements || []) {
      const existing = byId.get(item.id);
      if (!existing) {
        byId.set(item.id, { ...item, evidence: [...(item.evidence || [])] });
        continue;
      }
      if (STATUS_PRIORITY[item.status] > STATUS_PRIORITY[existing.status]) {
        existing.status = item.status;
        existing.impact = item.impact;
        existing.recommendation = item.recommendation;
      }
      existing.evidence = uniqueStrings([...(existing.evidence || []), ...(item.evidence || [])]).slice(0, 6);
    }
  }
  return summarizeRequirements([...byId.values()]);
}

function collectRecords(value) {
  const records = [];
  const seen = new Set();

  function visit(current, path = '$', depth = 0) {
    if (records.length >= 1200 || depth > 16 || current === null || current === undefined) return;
    if (typeof current === 'string' || typeof current === 'number' || typeof current === 'boolean') {
      records.push({ path, key: path.split('.').pop() || '', text: String(current).slice(0, 120000) });
      return;
    }
    if (typeof current !== 'object' || seen.has(current)) return;
    seen.add(current);
    if (Array.isArray(current)) {
      current.slice(0, 500).forEach((item, index) => visit(item, `${path}[${index}]`, depth + 1));
      return;
    }
    Object.entries(current).slice(0, 500).forEach(([key, item]) => {
      const nextPath = `${path}.${key}`;
      records.push({ path: nextPath, key, text: '' });
      visit(item, nextPath, depth + 1);
    });
  }

  visit(value);
  return records;
}

function findRuleEvidence(records, rule) {
  const evidence = [];
  for (const record of records) {
    const pathMatch = (rule.pathPatterns || []).some((pattern) => pattern.test(record.path) || pattern.test(record.key));
    const textMatch = record.text && (rule.textPatterns || []).some((pattern) => pattern.test(record.text));
    if (!pathMatch && !textMatch) continue;
    const marker = pathMatch
      ? record.path.replace(/^\$\.?/, '')
      : `${record.path.replace(/^\$\.?/, '')}: ${matchingSnippet(record.text, rule.textPatterns)}`;
    if (marker && !evidence.includes(marker)) evidence.push(marker);
    if (evidence.length >= 4) break;
  }
  return evidence;
}

function inspectMacros(records) {
  const supported = [];
  const unsupported = [];
  for (const record of records) {
    if (!record.text) continue;
    for (const match of record.text.matchAll(/\{\{([^{}]+)\}\}/g)) {
      const body = String(match[1] || '').trim();
      if (!body) continue;
      const target = isNativeMacro(body) ? supported : unsupported;
      if (!target.includes(body)) target.push(body);
      if (supported.length + unsupported.length >= 80) return { supported, unsupported };
    }
  }
  return { supported, unsupported };
}

function isNativeMacro(body) {
  const lower = String(body || '').trim().toLowerCase();
  if ([
    'user', 'char', 'model', 'slot', 'scenario', 'original', 'charifnotgroup',
    'time', 'date', 'datetime', 'timestamp', 'trim',
    'message_count', 'word_count', 'last_user_message', 'lastusermessage',
    'last_char_message', 'lastcharmessage', 'lastmessage'
  ].includes(lower)) return true;
  return [
    'persona_', 'char_', 'random:', 'random::', 'roll:', 'roll::', 'get_worldbook:',
    'pick:', 'pick::', 'template:', 'getvar::', 'globalvar::', 'getglobalvar::',
    'setvar::', 'addvar::', 'incvar::', 'decvar::', 'setglobalvar::',
    'eval::', 'if::', 'eq::', 'gt::', 'lt::', 'not::', 'stat::', 'attr::', 'xiaobai_state::'
  ].some((prefix) => lower.startsWith(prefix));
}

function summarizeRequirements(requirements) {
  const normalized = requirements.map(requirement);
  const counts = {
    supported: normalized.filter((item) => item.status === 'supported').length,
    degraded: normalized.filter((item) => item.status === 'degraded').length,
    review: normalized.filter((item) => item.status === 'review').length,
    missing: normalized.filter((item) => item.status === 'missing').length
  };
  const level = counts.missing
    ? 'external-runtime'
    : counts.review
      ? 'review-required'
      : counts.degraded
        ? 'degraded'
        : 'native';
  const label = level === 'external-runtime'
    ? '仅可安全保存'
    : level === 'review-required'
      ? '可运行 · 脚本待审核'
      : level === 'degraded'
        ? '可降级游玩'
        : '可直接游玩';
  const summary = level === 'external-runtime'
    ? `检测到 ${counts.missing} 项当前无法执行的社区扩展能力；角色与设定可以安全保存，但不能视为可直接游玩的完整卡。`
    : level === 'review-required'
      ? `检测到 ${counts.review} 项可进入隔离沙箱的脚本能力；默认保持禁用，需完成人工审核、内容哈希绑定与本地审计后才能启用。`
    : level === 'degraded'
      ? `检测到 ${counts.degraded} 项需要转换的社区能力；核心内容可以游玩，降级项需要复核。`
      : '未发现必须依赖酒馆助手、小白 X 或第三方脚本的能力。';
  const acceptance = buildCompatibilityAcceptance(normalized);
  return {
    schemaVersion: 1,
    level,
    label,
    summary,
    safeToStore: true,
    readyToPlay: counts.missing === 0,
    fullyCompatible: counts.missing === 0 && counts.review === 0 && counts.degraded === 0,
    requiresReview: counts.missing > 0 || counts.review > 0 || counts.degraded > 0,
    safeToImport: true,
    executesThirdPartyCode: false,
    acceptance,
    counts,
    requirements: normalized
  };
}

function resolveLightFrontendRule(rule, runtime, evidence, templateReport) {
  if (rule.id === 'tavern-helper' || rule.id === 'xiaobai-x') {
    const adapter = runtime.adapters?.find((item) => item.id === rule.id);
    if (adapter?.mode === 'declarative-partial') {
      return {
        ...rule,
        status: 'degraded',
        evidence,
        impact: `已映射 ${adapter.mappedCapabilities.join('、')}；原扩展脚本和生命周期不会执行。`,
        recommendation: adapter.unsupportedCapabilities.length
          ? `仍需转换：${adapter.unsupportedCapabilities.join('、')}。`
          : '建议导入后复核变量、快捷回复和显示规则。'
      };
    }
    const isPromptPresetLayout = evidence.every((e) => /^(?:promptLayout|prompts?|prompt_order)\b/i.test(e));
    if (isPromptPresetLayout && !adapter) {
      return {
        ...rule,
        status: 'degraded',
        evidence,
        impact: '已安全映射 Prompt 排版、语音与声明式宏；原扩展外部脚本和生命周期不会执行。',
        recommendation: '可在兼容报告中复核变量、快捷回复和显示规则。'
      };
    }
  }
  if (rule.id === 'executable-extension') {
    const sandboxTransforms = runtime.regexTransforms.filter((item) => item.requiresSandbox && item.enabled !== false);
    if (sandboxTransforms.length) {
      return {
        ...rule,
        status: 'review',
        evidence,
        impact: `识别到 ${sandboxTransforms.length} 条需要隔离沙箱的正则脚本；导入后默认禁用，不再误报为“运行时缺失”。`,
        recommendation: '逐条人工审核后生成内容哈希并写入本地审计；脚本内容变化时自动撤销授权。'
      };
    }
  }
  if (rule.id === 'regex-scripts' && runtime.regexTransforms.length) {
    const sandboxCount = runtime.regexTransforms.filter((item) => item.requiresSandbox && item.enabled !== false).length;
    const safeCount = runtime.regexTransforms.length - sandboxCount;
    return {
      ...rule,
      status: sandboxCount ? 'review' : 'supported',
      evidence,
      impact: sandboxCount
        ? `已识别 ${safeCount} 条安全显示规则与 ${sandboxCount} 条待审核沙箱规则；未审核规则保持禁用。`
        : `已识别 ${safeCount} 条安全显示规则；只影响页面呈现，不改写原始消息与记忆。`,
      recommendation: sandboxCount
        ? '在脚本治理面板逐条审核沙箱规则；内容哈希变化后必须重新审核。'
        : '导入后可在兼容报告中复核被禁用的高风险表达式。'
    };
  }
  if (rule.id === 'quick-replies' && runtime.quickReplies.length) {
    const stateActions = runtime.quickReplies.filter((item) => item.actionType === 'mvu-patch').length;
    return {
      ...rule,
      status: 'supported',
      evidence,
      impact: `已识别 ${runtime.quickReplies.length} 个快捷回复，其中 ${stateActions} 个白名单变量命令转换为 MVU 补丁。`,
      recommendation: '未知斜杠命令仍保持禁用，并会出现在兼容差异中。'
    };
  }
  if (rule.id === 'sidebar-panels' && runtime.panels.length) {
    return {
      ...rule,
      status: 'supported',
      evidence,
      impact: `已识别 ${runtime.panels.length} 个声明式面板，并映射到沉浸侧栏的原生卡片与列表。`,
      recommendation: '自定义 HTML、CSS 与事件绑定仍保持禁用。'
    };
  }
  if (rule.id === 'mvu-state' && runtime.mvu.enabled) {
    return {
      ...rule,
      status: 'supported',
      evidence,
      impact: '已识别安全 JSON 初始状态；状态更新使用带 revision 的声明式补丁。',
      recommendation: '第三方 JavaScript、EJS 与事件钩子仍保持禁用。'
    };
  }
  if (rule.id === 'stscript') {
    const hasLoopsOrComplexCommands = evidence.some((item) => /\/(?:while|run|trigger|eval)\b/i.test(item));
    if (!hasLoopsOrComplexCommands) {
      return {
        ...rule,
        status: 'degraded',
        evidence,
        impact: '已将声明式变量读写与宏命令转换为白名单变量操作；高级循环与未受控控制流保持禁用。',
        recommendation: '可在兼容报告中复核变量、快捷回复和显示规则。'
      };
    }
    const stateActions = runtime.quickReplies.filter((item) => item.actionType === 'mvu-patch').length;
    if (stateActions) {
      return {
        ...rule,
        status: 'degraded',
        evidence,
        impact: `已将 ${stateActions} 个 /setvar 或 /incvar 命令转换为白名单 MVU 补丁；其他脚本命令不执行。`,
        recommendation: '逐项复核被禁用命令；不要把存在函数、循环或外部调用的脚本视为已兼容。'
      };
    }
  }
  if (rule.id === 'declarative-lifecycle') {
    const events = Object.keys(runtime.lifecycle?.events || {});
    if (events.length) {
      const lifecycleDiagnostics = (runtime.diagnostics || [])
        .filter((item) => String(item?.code || '').startsWith('lifecycle-'));
      return {
        ...rule,
        status: lifecycleDiagnostics.length ? 'degraded' : 'supported',
        evidence,
        impact: lifecycleDiagnostics.length
          ? `已映射 ${events.join('、')}，但有 ${lifecycleDiagnostics.length} 项步骤因预算或白名单限制被禁用。`
          : `已映射 ${events.join('、')}；统一限制执行次数、状态路径、补丁类型、递归深度和单轮变更数。`,
        recommendation: lifecycleDiagnostics.length
          ? '按兼容差异修正被禁用步骤；运行时不会静默执行超预算内容。'
          : '任一步失败时整次事件回滚，原始 JavaScript 不会执行。'
      };
    }
  }
  if (rule.id === 'custom-html-ui' && runtime.panels.length && !evidence.some((item) => /iframe/i.test(item))) {
    return {
      ...rule,
      status: 'degraded',
      evidence,
      impact: `静态内容已转换为 ${runtime.panels.length} 个原生侧栏面板；原 CSS、DOM 事件和表单行为被禁用。`,
      recommendation: '对照原卡复核信息层级；需要交互的部分改写为声明式快捷动作。'
    };
  }
  if (rule.id === 'prompt-preset-order' && evidence.some((item) => /sillyTavernPreset|promptLayout/.test(item))) {
    return {
      ...rule,
      status: 'supported',
      evidence,
      impact: '提示词顺序、消息角色、相对位置和历史内插入深度会保留，并由内部 Prompt 装配器实际应用。',
      recommendation: '生成参数只作为预设建议保存，不会静默覆盖当前 Provider 配置。'
    };
  }
  if (rule.id === 'safe-ejs-template' && templateReport?.detected) {
    return {
      ...rule,
      status: templateReport.unsupportedCount ? 'degraded' : 'supported',
      evidence,
      impact: templateReport.unsupportedCount
        ? `可安全渲染 ${templateReport.supportedCount} 个模板标签；另有 ${templateReport.unsupportedCount} 个代码标签保持禁用。`
        : `已识别 ${templateReport.supportedCount} 个只读插值或条件标签，可由安全模板引擎渲染。`,
      recommendation: templateReport.unsupportedCount
        ? '把赋值、循环和函数逻辑改写为 MVU 声明式补丁。'
        : '无需执行第三方 JavaScript。'
    };
  }
  return { ...rule, evidence };
}

function inspectCommunityTemplates(records) {
  let supportedCount = 0;
  let unsupportedCount = 0;
  let detected = false;
  for (const record of records) {
    if (!record.text || !record.text.includes('<%')) continue;
    const report = inspectSafeTemplate(record.text);
    if (!report.hasTemplate) continue;
    detected = true;
    supportedCount += report.supportedCount;
    unsupportedCount += report.unsupportedCount;
  }
  return { detected, supportedCount, unsupportedCount };
}

function requirement(value = {}) {
  return {
    id: String(value.id || 'unknown'),
    label: String(value.label || value.id || '未命名能力'),
    category: String(value.category || 'runtime'),
    status: ['supported', 'degraded', 'review', 'missing'].includes(value.status) ? value.status : 'degraded',
    evidence: uniqueStrings(value.evidence || []).slice(0, 6),
    impact: String(value.impact || ''),
    recommendation: String(value.recommendation || '')
  };
}

function matchingSnippet(text, patterns = []) {
  const source = String(text || '').replace(/\s+/g, ' ').trim();
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (!match) continue;
    const index = Math.max(0, match.index - 20);
    return source.slice(index, index + Math.max(48, match[0].length + 40));
  }
  return source.slice(0, 64);
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : [values]).map((value) => String(value || '').trim()).filter(Boolean))];
}
