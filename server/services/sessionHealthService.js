import { estimateTokens } from '../agent/token.js';
import { hasCompleteSessionConfig } from '../config/sessionScopedConfig.js';
import { getScriptGovernanceSnapshot } from '../security/scriptGovernance.js';
import { TAVERN_COMPATIBILITY_CONTRACT_VERSION } from '../compat/compatibilityPolicy.js';

const SESSION_HEALTH_SPEC = 'lra.session-health/v1';
const CONFIG_FIELDS = Object.freeze([
  'characterCard',
  'promptModules',
  'worldBook',
  'persona',
  'lightFrontend'
]);
const CONTROL_TAGS = Object.freeze([
  'think',
  'analysis',
  'reasoning',
  'descriptive_analysis',
  'planning',
  'planing',
  'plot',
  'recommended_actions',
  'w2g',
  'catsay',
  'normal_status',
  'relationship_status',
  'special_status',
  'nextcharacterpanel',
  'bginfor'
]);
const RECOMMENDATION_PROTOCOL_PATTERN = /(?:step\s*\d+|正文前注释|recommended_actions|ira-actions|nextcharacterpanel|天机选项|<\/?(?:plot|think|normal_status|relationship_status|special_status)\b|<!--)/iu;

export class SessionHealthService {
  constructor({
    sessionService,
    storyProjectService,
    resourceLibraryService,
    resolveBuiltInPack = () => null,
    listBuiltInPacks = () => [],
    now = () => new Date()
  } = {}) {
    if (!sessionService) throw new TypeError('sessionService is required');
    this.sessionService = sessionService;
    this.storyProjectService = storyProjectService;
    this.resourceLibraryService = resourceLibraryService;
    this.resolveBuiltInPack = resolveBuiltInPack;
    this.listBuiltInPacks = listBuiltInPacks;
    this.now = now;
  }

  async inspect(sessionId = 'main') {
    const session = await this.sessionService.getSession(sessionId);
    const context = await this.resolveContext(session);
    return inspectSessionHealth(session, {
      ...context,
      generatedAt: this.now().toISOString()
    });
  }

  async resolveContext(session) {
    const packReferences = collectPackReferences(session);
    const primaryPackId = selectPrimaryPackId(session, packReferences);
    const builtInSummaries = this.listBuiltInPacks() || [];
    const builtInPacks = builtInSummaries
      .map((summary) => this.resolveBuiltInPack(summary?.id))
      .filter(Boolean);
    const currentPack = primaryPackId
      ? this.resolveBuiltInPack(primaryPackId)
        || await this.resourceLibraryService?.getPack?.(primaryPackId)
      : null;
    const projectId = String(session?.storyProjectId || '').trim();
    const project = projectId
      ? await this.storyProjectService?.getProject?.(projectId)
      : null;
    return {
      builtInPacks,
      currentPack,
      packReferences,
      primaryPackId,
      project,
      projectId
    };
  }
}

export function inspectSessionHealth(session, {
  builtInPacks = [],
  currentPack = null,
  packReferences = collectPackReferences(session),
  primaryPackId = selectPrimaryPackId(session, packReferences),
  project = null,
  projectId = String(session?.storyProjectId || '').trim(),
  generatedAt = new Date().toISOString()
} = {}) {
  const checks = [
    inspectConfigBoundary(session),
    inspectReferenceIntegrity({ session, currentPack, packReferences, primaryPackId, project, projectId }),
    inspectResourceCompatibility({ currentPack, primaryPackId }),
    inspectBuiltInBoundary({ session, currentPack, primaryPackId, builtInPacks }),
    inspectPromptStack(session),
    inspectScriptGovernance(session),
    inspectConversationIntegrity(session)
  ];
  const summary = checks.reduce((result, check) => {
    if (check.status === 'error') result.errors += 1;
    else if (check.status === 'warning') result.warnings += 1;
    else result.passes += 1;
    return result;
  }, { errors: 0, warnings: 0, passes: 0, total: checks.length });
  return {
    spec: SESSION_HEALTH_SPEC,
    sessionId: String(session?.id || ''),
    generatedAt,
    status: summary.errors ? 'blocked' : summary.warnings ? 'warning' : 'healthy',
    summary,
    checks
  };
}

function inspectResourceCompatibility({ currentPack, primaryPackId }) {
  const isCustomPack = currentPack?.custom === true || String(primaryPackId || '').startsWith('custom-');
  if (!isCustomPack) {
    return check('resource-compatibility', '素材兼容', 'pass',
      '当前剧本不需要安全派生审计',
      primaryPackId
        ? '当前使用原生或已封装素材包，没有自定义组装产生的禁用能力记录。'
        : '当前会话没有绑定自定义素材包。');
  }

  const review = currentPack?.resourceManifest?.composition?.compatibilityReview;
  if (!isRecord(review)) {
    return check('resource-compatibility', '素材兼容', 'warning',
      '历史自定义剧本缺少 v2 组装审计',
      '当前内容仍可继续使用，但无法从剧本清单确认曾禁用或批准过哪些社区扩展能力。', {
        recommendation: '重新使用当前素材完成一次组装前预检；不要仅凭剧本可打开就推断社区扩展已兼容。',
        action: {
          kind: 'upgrade-compatibility-audit',
          packId: String(primaryPackId || currentPack?.id || '')
        }
      });
  }

  const contractVersion = Number(review.contractVersion || 0);
  const disabledCapabilities = Array.isArray(review.disabledCapabilities)
    ? review.disabledCapabilities.filter(isRecord)
    : [];
  const sourceRuntimeBlocked = review.sourceRuntimeBlocked === true;
  const executionMode = ['local-observe', 'compatibility-probe', 'review-required']
    .includes(String(review.executionMode || ''))
    ? String(review.executionMode)
    : 'local-observe';
  const safeDerivativeAccepted = ['safe-derivative-approved', 'safe-derivative-local-observe', 'safe-derivative-compatibility-probe']
    .includes(String(review.status || ''))
    && review.acknowledgedCompatibility === true;
  if (sourceRuntimeBlocked && (!safeDerivativeAccepted || !disabledCapabilities.length)) {
    const evidence = [
      !safeDerivativeAccepted ? '缺少有效的安全派生确认状态' : '',
      !disabledCapabilities.length ? '没有记录被禁用的源运行时能力' : ''
    ].filter(Boolean);
    return check('resource-compatibility', '素材兼容', 'error',
      '素材包的安全派生审计不完整',
      '原资源运行时包含阻断能力，但当前剧本清单不能证明这些能力已被明确剥离并确认。', {
        evidence,
        recommendation: '停止依赖相关扩展行为，并从原始只读素材重新执行组装前兼容预检。',
        metrics: { contractVersion, disabledCount: disabledCapabilities.length }
      });
  }

  const evidence = disabledCapabilities.map((item) => {
    const label = String(item.label || item.id || '未知能力');
    const impact = String(item.impact || item.recommendation || '已从安全派生版禁用');
    return `${label}：${impact}`;
  });
  if (safeDerivativeAccepted) {
    return check('resource-compatibility', '素材兼容', 'warning',
      executionMode === 'compatibility-probe'
        ? '当前剧本运行的是安全派生版（开发兼容探针）'
        : executionMode === 'local-observe' ? '当前剧本运行的是安全派生版（本地观察）' : '当前剧本运行的是安全派生版',
      `${executionMode === 'compatibility-probe'
        ? '可隔离脚本可使用子 iframe 的外部资源与网络，并记录启动、加载与错误；'
        : executionMode === 'local-observe' ? '可隔离脚本会在本地沙箱中观察运行并记录；' : ''}原资源不能直接运行；已明确禁用 ${disabledCapabilities.length} 项源运行时能力：${disabledCapabilities
        .map((item) => String(item.label || item.id || '未知能力'))
        .join('、')}。`, {
        evidence,
        recommendation: executionMode === 'compatibility-probe'
          ? '仅用于本地兼容调试；重点检查审计中的网络、加载与异常事件。原资源仍不能接管主页面或读取密钥；完整网页、DOM 或宿主交互需改走受控重前端。'
          : executionMode === 'local-observe'
            ? '测试阶段可继续观察本地审计记录；需要完整网页、DOM 或宿主交互时改走受控重前端。'
            : '需要完整网页、DOM 或宿主交互时改走受控重前端；当前会话只依赖保留下来的角色卡、世界书、Prompt 与已批准沙箱能力。',
        metrics: {
          contractVersion,
          executionMode,
          disabledCount: disabledCapabilities.length,
          approvedScriptCount: Array.isArray(review.approvedScriptHashes) ? review.approvedScriptHashes.length : 0
        }
      });
  }

  if (contractVersion !== TAVERN_COMPATIBILITY_CONTRACT_VERSION) {
    return check('resource-compatibility', '素材兼容', 'warning',
      '素材兼容审计使用旧契约版本',
      `当前记录版本为 ${contractVersion || '未知'}，运行时契约版本为 ${TAVERN_COMPATIBILITY_CONTRACT_VERSION}。`, {
        recommendation: '在修改或更新素材前重新执行组装预检；旧剧本不会被健康检查自动改写。',
        metrics: { contractVersion, currentContractVersion: TAVERN_COMPATIBILITY_CONTRACT_VERSION },
        action: {
          kind: 'upgrade-compatibility-audit',
          packId: String(primaryPackId || currentPack?.id || '')
        }
      });
  }

  const approvedScriptCount = Array.isArray(review.approvedScriptHashes)
    ? review.approvedScriptHashes.length
    : 0;
  return check('resource-compatibility', '素材兼容', 'pass',
    approvedScriptCount ? '素材兼容与脚本审批记录完整' : '素材兼容记录完整',
    approvedScriptCount
      ? `${approvedScriptCount} 个脚本内容哈希已在组装前批准；没有被静默剥离的源运行时能力。`
      : '当前素材包不依赖被禁用的源运行时能力。', {
      metrics: { contractVersion, disabledCount: 0, approvedScriptCount }
    });
}

function inspectConfigBoundary(session) {
  const config = session?.config;
  if (hasCompleteSessionConfig(config)) {
    return check('session-config-boundary', '配置边界', 'pass',
      '会话配置完整',
      '角色卡、Prompt、世界书、人设与轻前端均由当前会话独立持有。');
  }
  const missing = CONFIG_FIELDS.filter((field) => {
    if (field === 'promptModules' || field === 'worldBook') return !Array.isArray(config?.[field]);
    return !isRecord(config?.[field]);
  });
  return check('session-config-boundary', '配置边界', 'error',
    '会话配置不完整，可能回落到全局默认值',
    `缺少或格式异常：${missing.join('、') || '未知字段'}。`, {
      evidence: missing,
      recommendation: '补齐当前会话配置后再继续生成，避免其他剧本或系统默认配置串入。'
    });
}

function inspectReferenceIntegrity({ session, currentPack, packReferences, primaryPackId, project, projectId }) {
  const issues = [];
  const values = [...new Set(Object.values(packReferences).filter(Boolean))];
  if (values.length > 1) {
    issues.push(`素材包引用不一致：${Object.entries(packReferences)
      .filter(([, value]) => value)
      .map(([key, value]) => `${key}=${value}`)
      .join('；')}`);
  }
  if (primaryPackId && !currentPack) issues.push(`素材包 ${primaryPackId} 已不存在或无法解析`);
  if (projectId && !project) issues.push(`创作项目 ${projectId} 已不存在或无法解析`);
  if (project?.basePackId && primaryPackId && project.basePackId !== primaryPackId) {
    issues.push(`创作项目绑定 ${project.basePackId}，会话绑定 ${primaryPackId}`);
  }
  if (issues.length) {
    return check('session-reference-integrity', '引用完整性', values.length > 1 ? 'error' : 'warning',
      '会话存在失效或冲突的项目/素材包引用',
      issues.join('；'), {
        evidence: issues,
        recommendation: '核对当前剧本的项目与素材包绑定；健康检查不会自动改写这些引用。'
      });
  }
  const detail = primaryPackId
    ? `素材包 ${primaryPackId}${projectId ? ` 与项目 ${projectId}` : ''} 均可解析。`
    : '当前为独立会话，没有外部素材包引用。';
  return check('session-reference-integrity', '引用完整性', 'pass', '项目与素材引用一致', detail);
}

function inspectBuiltInBoundary({ session, currentPack, primaryPackId, builtInPacks }) {
  const builtInIds = new Set(builtInPacks.map((pack) => String(pack?.id || '')).filter(Boolean));
  const isCustom = currentPack?.custom === true || String(primaryPackId || '').startsWith('custom-');
  if (!isCustom) {
    return check('builtin-content-boundary', '原生内容边界', 'pass',
      '当前不是独立自定义素材包',
      primaryPackId ? '当前会话使用原生或兼容素材包，允许包含其自带内容。' : '当前会话没有素材包继承关系。');
  }
  const inheritanceMode = String(currentPack?.resourceManifest?.baseInheritanceMode || '').trim();
  const hasExplicitInheritance = inheritanceMode && inheritanceMode !== 'none';
  if (hasExplicitInheritance) {
    return check('builtin-content-boundary', '原生内容边界', 'pass',
      '原生内容继承已显式声明',
      `自定义素材包使用 ${inheritanceMode} 继承模式，原生内容属于预期组成。`);
  }

  const identityLeaks = [
    session?.memory?.resourcePackId,
    session?.memory?.ruleSystem?.contentPackId,
    session?.memory?.ruleSystem?.sourceContentPackId,
    session?.memory?.narrativeState?.lockedGenre
  ].map((value) => String(value || '').trim()).filter((value) => builtInIds.has(value));
  const matches = findExactBuiltInMatches(session?.config || {}, builtInPacks);
  const totalMatches = matches.reduce((sum, item) => sum + item.worldBook + item.promptModules + item.characterCard, 0);
  if (!identityLeaks.length && !totalMatches) {
    return check('builtin-content-boundary', '原生内容边界', 'pass',
      '未发现系统默认剧本串入',
      '独立自定义素材包未携带原生素材包身份或完整内容副本。');
  }
  const evidence = [
    ...identityLeaks.map((id) => `记忆或规则仍指向原生素材包 ${id}`),
    ...matches.map((item) => (
      `${item.packId}：世界书 ${item.worldBook}、Prompt ${item.promptModules}、角色卡 ${item.characterCard}`
    ))
  ];
  const status = identityLeaks.length || totalMatches > 1 ? 'error' : 'warning';
  return check('builtin-content-boundary', '原生内容边界', status,
    '独立自定义剧本中检测到原生内容残留',
    evidence.join('；'), {
      evidence,
      recommendation: '确认是否需要继承；需要时显式设置继承模式，否则移除原生身份与完整内容副本。'
    });
}

function inspectPromptStack(session) {
  const modules = Array.isArray(session?.config?.promptModules) ? session.config.promptModules : [];
  const enabled = modules.filter((module) => module?.enabled !== false && String(module?.content || '').trim());
  const tokenEstimate = estimateTokens(enabled.map((module) => String(module.content || '')).join('\n'));
  const configuredBudget = Number(session?.settings?.maxPromptTokens);
  const maxPromptTokens = Number.isFinite(configuredBudget) && configuredBudget > 0 ? configuredBudget : 8000;
  const groups = new Map();
  modules.forEach((module, index) => {
    const id = String(module?.id || '').trim();
    if (!id) return;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push({ module, index });
  });
  const duplicates = [...groups.entries()].filter(([, items]) => items.length > 1);
  const conflicting = duplicates.filter(([, items]) => (
    new Set(items.map(({ module }) => JSON.stringify([
      String(module?.content || ''),
      String(module?.role || ''),
      String(module?.position || ''),
      Number(module?.depth || 0),
      Number(module?.order || 0)
    ]))).size > 1
  ));
  const issues = [];
  let status = 'pass';
  if (conflicting.length) {
    status = 'error';
    issues.push(`同 ID 不同内容：${conflicting.map(([id]) => id).slice(0, 8).join('、')}`);
  } else if (duplicates.length) {
    status = 'warning';
    issues.push(`重复模块：${duplicates.map(([id]) => id).slice(0, 8).join('、')}`);
  }
  if (tokenEstimate > maxPromptTokens) {
    if (status === 'pass') status = 'warning';
    issues.push(`启用模块约 ${tokenEstimate} tokens，已超过会话维护阈值 ${maxPromptTokens}`);
  } else if (tokenEstimate >= Math.floor(maxPromptTokens * 0.65)) {
    if (status === 'pass') status = 'warning';
    issues.push(`启用模块约占会话预算 ${Math.round((tokenEstimate / maxPromptTokens) * 100)}%`);
  }
  if (modules.length >= 80) {
    if (status === 'pass') status = 'warning';
    issues.push(`共 ${modules.length} 个模块，建议按预设包折叠管理`);
  }
  if (!issues.length) {
    return check('prompt-stack', 'Prompt 栈', 'pass',
      'Prompt 栈规模与标识正常',
      `${enabled.length}/${modules.length} 个模块启用，约 ${tokenEstimate}/${maxPromptTokens} tokens。`, {
        metrics: { moduleCount: modules.length, enabledCount: enabled.length, tokenEstimate, maxPromptTokens }
      });
  }
  return check('prompt-stack', 'Prompt 栈', status,
    status === 'error' ? 'Prompt 栈存在同 ID 内容冲突' : 'Prompt 栈可运行，但需要整理',
    issues.join('；'), {
      evidence: issues,
      metrics: { moduleCount: modules.length, enabledCount: enabled.length, tokenEstimate, maxPromptTokens },
      recommendation: '优先处理同 ID 冲突并精简启用模块；超过维护阈值会更频繁触发记忆整理，但不等于导入失败。'
    });
}

function inspectScriptGovernance(session) {
  const governance = getScriptGovernanceSnapshot(session);
  const executionMode = ['local-observe', 'compatibility-probe', 'review-required']
    .includes(governance.executionMode)
    ? governance.executionMode
    : 'local-observe';
  const pending = governance.rules.filter((rule) => !rule.approved && !rule.latestReview);
  const stale = governance.rules.filter((rule) => (
    !rule.approved && rule.latestReview?.decision === 'approved'
  ));
  if (!governance.rules.length) {
    return check('script-governance', '第三方脚本', 'pass',
      '当前会话没有待审核脚本',
      '没有启用需要沙箱执行的第三方脚本。', {
        metrics: { ruleCount: 0, approvedCount: 0, executionMode }
      });
  }
  if (executionMode === 'compatibility-probe') {
    const executable = governance.rules.filter((rule) => rule.executable).length;
    const rejected = governance.rules.filter((rule) => ['rejected', 'revoked'].includes(rule.latestReview?.decision)).length;
    const evidence = [
      ...pending.map((rule) => `${rule.name}：开发兼容探针中，尚未留下长期结论`),
      ...stale.map((rule) => `${rule.name}：旧授权已随内容变化失效，当前版本在开发兼容探针中测试`),
      ...governance.rules
        .filter((rule) => ['rejected', 'revoked'].includes(rule.latestReview?.decision))
        .map((rule) => `${rule.name}：当前内容已明确拒绝，不会执行`)
    ];
    return check('script-governance', '第三方脚本', 'warning',
      `${executable} 个第三方脚本处于开发兼容探针`,
      rejected
        ? `${rejected} 个当前版本已被明确拒绝；其余脚本可在隔离 iframe 内加载外部资源、使用网络、表单、嵌套页面与 Worker，所有启动、加载和错误会审计。`
        : '脚本可在隔离 iframe 内加载外部资源、使用网络、表单、嵌套页面与 Worker，所有启动、加载和错误会审计；不会获得主页面、存档、Provider 密钥或本机命令权限。', {
        evidence,
        recommendation: '仅用于本地角色卡兼容调试。查看审计中的网络/加载/错误后，完成验证请切回本地探索或严格逐项确认。',
        action: {
          kind: 'open-script-audit',
          scriptIds: governance.rules.map((rule) => rule.scriptId)
        },
        metrics: {
          ruleCount: governance.rules.length,
          executableCount: executable,
          rejectedCount: rejected,
          approvedCount: governance.trustedScriptIds.length,
          executionMode
        }
      });
  }
  if (executionMode === 'local-observe') {
    const observed = governance.rules.filter((rule) => rule.executable).length;
    const rejected = governance.rules.filter((rule) => rule.latestReview?.decision === 'rejected').length;
    const evidence = [
      ...pending.map((rule) => `${rule.name}：本地观察中，尚未留下长期结论`),
      ...stale.map((rule) => `${rule.name}：旧授权已随内容变化失效，当前版本按本地观察运行`),
      ...governance.rules
        .filter((rule) => rule.latestReview?.decision === 'rejected')
        .map((rule) => `${rule.name}：当前内容已明确拒绝，不会执行`)
    ];
    return check('script-governance', '第三方脚本', 'warning',
      `${observed} 个第三方脚本以本地观察模式运行`,
      rejected
        ? `${rejected} 个当前版本已被明确拒绝；其余可隔离脚本只在无网络、无父页面权限的沙箱中运行并记录。`
        : '可隔离脚本只在无网络、无父页面权限的沙箱中运行并记录；可随时切换为严格逐项确认。', {
        evidence,
        recommendation: '测试阶段关注启动、错误和异常行为审计；需要收敛时切换为严格逐项确认。',
        action: {
          kind: 'open-script-audit',
          scriptIds: governance.rules.map((rule) => rule.scriptId)
        },
        metrics: {
          ruleCount: governance.rules.length,
          observedCount: observed,
          rejectedCount: rejected,
          approvedCount: governance.trustedScriptIds.length,
          executionMode
        }
      });
  }
  if (!pending.length && !stale.length) {
    return check('script-governance', '第三方脚本', 'pass',
      '第三方脚本严格审核状态明确',
      `${governance.trustedScriptIds.length}/${governance.rules.length} 个脚本已通过当前内容哈希与策略校验。`, {
        metrics: { ruleCount: governance.rules.length, approvedCount: governance.trustedScriptIds.length, executionMode }
      });
  }
  const evidence = [
    ...pending.map((rule) => `${rule.name}：尚未审核`),
    ...stale.map((rule) => `${rule.name}：内容或审核策略已变化，需要复审`)
  ];
  return check('script-governance', '第三方脚本', 'warning',
    `${pending.length + stale.length} 个第三方脚本等待审核`,
    '这些脚本本次不会执行；可进入审核面板查看内容、风险、哈希与历史决定。', {
      evidence,
      recommendation: '逐项审核并记录决定；不要仅按脚本名称放行。',
      action: {
        kind: 'open-script-audit',
        scriptIds: [...pending, ...stale].map((rule) => rule.scriptId)
      },
      metrics: { ruleCount: governance.rules.length, approvedCount: governance.trustedScriptIds.length, executionMode }
    });
}

function inspectConversationIntegrity(session) {
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  const issues = [];
  const ids = new Set();
  const duplicatedIds = new Set();
  messages.forEach((message, index) => {
    const id = String(message?.id || '').trim();
    if (id && ids.has(id)) duplicatedIds.add(id);
    if (id) ids.add(id);
    const role = String(message?.role || '');
    if (!['user', 'assistant', 'system'].includes(role)) issues.push(`第 ${index + 1} 条消息角色无效：${role || '空'}`);
    if (role === 'assistant' && !String(message?.content || '').trim()) issues.push(`第 ${index + 1} 条旁白消息正文为空`);
    inspectSwipe(message, index, issues);
    inspectProtocolContent(message, index, issues);
  });
  if (duplicatedIds.size) issues.push(`消息 ID 重复：${[...duplicatedIds].slice(0, 8).join('、')}`);
  if (!issues.length) {
    return check('conversation-integrity', '对话与分支', 'pass',
      '消息、选项与 Swipe 分支结构正常',
      `已检查 ${messages.length} 条消息，未发现空正文、协议泄漏或分支索引错位。`, {
        metrics: { messageCount: messages.length }
      });
  }
  const severe = issues.some((item) => /正文为空|索引越界|内容与当前 Swipe|消息 ID 重复|只包含推理过程/u.test(item));
  return check('conversation-integrity', '对话与分支', severe ? 'error' : 'warning',
    '对话记录存在结构或展示风险',
    issues.slice(0, 6).join('；'), {
      evidence: issues.slice(0, 20),
      recommendation: '先定位对应消息再编辑或重生成；健康检查不会删除正文或重写分支。',
      metrics: { messageCount: messages.length }
    });
}

function inspectSwipe(message, index, issues) {
  const swipes = Array.isArray(message?.swipes) ? message.swipes : [];
  if (!swipes.length) return;
  const activeIndex = Number(message?.activeSwipeIndex ?? 0);
  if (!Number.isInteger(activeIndex) || activeIndex < 0 || activeIndex >= swipes.length) {
    issues.push(`第 ${index + 1} 条消息 Swipe 索引越界`);
    return;
  }
  if (String(message?.content || '') !== String(swipes[activeIndex] || '')) {
    issues.push(`第 ${index + 1} 条消息内容与当前 Swipe 不一致`);
  }
  if (Array.isArray(message?.swipeMetadata) && message.swipeMetadata.length !== swipes.length) {
    issues.push(`第 ${index + 1} 条消息 Swipe 元数据数量不一致`);
  }
}

function inspectProtocolContent(message, index, issues) {
  if (message?.role !== 'assistant') return;
  const content = String(message?.content || '');
  const thinkingPattern = /<(think|analysis|reasoning|descriptive_analysis|planning|planing)\b[^>]*>[\s\S]*?<\/\1>/giu;
  if (thinkingPattern.test(content) && !content.replace(thinkingPattern, '').trim()) {
    issues.push(`第 ${index + 1} 条旁白只包含推理过程，没有剧情正文`);
  }
  for (const tag of CONTROL_TAGS) {
    const escaped = escapeRegExp(tag);
    const openings = content.match(new RegExp(`<${escaped}(?=[\\s>])`, 'giu'))?.length || 0;
    const closings = content.match(new RegExp(`</${escaped}>`, 'giu'))?.length || 0;
    if (openings !== closings) {
      issues.push(`第 ${index + 1} 条旁白的 <${tag}> 协议标签未闭合`);
      break;
    }
  }
  const recommendations = Array.isArray(message?.recommendedActions) ? message.recommendedActions : [];
  const leaked = recommendations
    .map(recommendationText)
    .filter((value) => RECOMMENDATION_PROTOCOL_PATTERN.test(value));
  if (leaked.length) issues.push(`第 ${index + 1} 条旁白的行动选项混入 Prompt/协议指令`);
}

function findExactBuiltInMatches(config, builtInPacks) {
  const worldBook = Array.isArray(config?.worldBook) ? config.worldBook : [];
  const promptModules = Array.isArray(config?.promptModules) ? config.promptModules : [];
  return builtInPacks.map((pack) => {
    const worldBookSignatures = new Set((pack.worldBook || []).map(worldBookSignature));
    const promptSignatures = new Set((pack.promptModules || []).map(promptSignature));
    const characterMatch = characterSignature(config?.characterCard) === characterSignature(pack.characterCard) ? 1 : 0;
    return {
      packId: String(pack.id || ''),
      worldBook: worldBook.filter((item) => worldBookSignatures.has(worldBookSignature(item))).length,
      promptModules: promptModules.filter((item) => promptSignatures.has(promptSignature(item))).length,
      characterCard: characterMatch
    };
  }).filter((item) => item.worldBook || item.promptModules || item.characterCard);
}

function worldBookSignature(entry) {
  return JSON.stringify([
    String(entry?.id || ''),
    String(entry?.type || ''),
    String(entry?.title || ''),
    Array.isArray(entry?.keywords) ? entry.keywords.map(String) : [],
    String(entry?.content || '')
  ]);
}

function promptSignature(module) {
  return JSON.stringify([
    String(module?.id || ''),
    String(module?.title || ''),
    String(module?.content || '')
  ]);
}

function characterSignature(card) {
  if (!isRecord(card)) return '';
  return JSON.stringify([
    String(card.name || ''),
    String(card.description || ''),
    String(card.personality || ''),
    String(card.scenario || ''),
    String(card.firstMessage || card.first_mes || ''),
    String(card.systemPrompt || card.system_prompt || '')
  ]);
}

function collectPackReferences(session) {
  return {
    session: String(session?.basePackId || '').trim(),
    config: String(session?.config?.contentPackId || '').trim(),
    memory: String(session?.memory?.resourcePackId || '').trim(),
    rules: String(session?.memory?.ruleSystem?.contentPackId || '').trim()
  };
}

function selectPrimaryPackId(session, references) {
  return String(
    session?.basePackId
    || session?.config?.contentPackId
    || session?.memory?.resourcePackId
    || session?.memory?.ruleSystem?.contentPackId
    || ''
  ).trim() || Object.values(references).find(Boolean) || '';
}

function recommendationText(value) {
  if (typeof value === 'string') return value;
  if (!isRecord(value)) return '';
  return String(value.action || value.text || value.label || value.title || '');
}

function check(id, category, status, title, detail, extras = {}) {
  return { id, category, status, title, detail, ...extras };
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
