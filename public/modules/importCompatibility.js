const STATUS_LABELS = {
  supported: '原生支持',
  degraded: '沙箱兼容',
  review: '本地观察',
  missing: '沙箱隔离'
};

const ACCEPTANCE_LABELS = {
  'full-mapping': '完整映射',
  'safe-degradation': '安全降级',
  'review-required': '可运行 · 本地观察',
  blocked: '阻断运行'
};

export function createCommunityCompatibilitySection(report = {}, { storyImport = false, onStrategyChange = () => {} } = {}) {
  const requirements = Array.isArray(report.requirements) ? report.requirements : [];
  if (!requirements.length) return null;

  const section = document.createElement('section');
  section.className = `import-community-compatibility is-${report.level || 'native'}`;

  const heading = document.createElement('div');
  heading.className = 'import-section-heading';
  const title = document.createElement('strong');
  title.textContent = '社区扩展兼容与本地探索';
  const label = document.createElement('span');
  label.className = 'import-community-verdict';
  label.textContent = report.label || '已支持酒馆生态';
  heading.append(title, label);

  const playability = document.createElement('span');
  const outcome = report.acceptance?.outcome || '';
  const readyToPlay = report.acceptance
    ? report.acceptance.canRun === true
    : report.readyToPlay !== false && !Number(report.counts?.missing || 0);
  playability.className = [
    'import-community-playability',
    readyToPlay ? 'is-ready' : 'is-store-only',
    outcome ? `is-${outcome}` : ''
  ].filter(Boolean).join(' ');
  playability.textContent = ACCEPTANCE_LABELS[outcome]
    || (readyToPlay ? '已接入酒馆兼容沙箱（支持 MVU、宏与轻前端）' : '安全保存，可配置策略');

  const summary = document.createElement('p');
  summary.className = 'import-community-summary';
  summary.textContent = report.summary || '系统已内置酒馆扩展运行时（MVU 状态机、动态宏与安全沙箱）。您可以在下方针对检测到的社区扩展逐项审核或切换执行策略。';

  // 本地探索策略：默认在隔离沙箱中观察运行；需要时可一键转为纯状态映射。
  const quickActions = document.createElement('div');
  quickActions.className = 'import-community-quick-actions';
  quickActions.style.cssText = 'display:flex;gap:8px;margin:8px 0;flex-wrap:wrap;';

  const observeAllBtn = document.createElement('button');
  observeAllBtn.type = 'button';
  observeAllBtn.className = 'ghost-button compact';
  observeAllBtn.textContent = '◉ 全部采用本地观察运行';

  const sanitizeAllBtn = document.createElement('button');
  sanitizeAllBtn.type = 'button';
  sanitizeAllBtn.className = 'ghost-button compact';
  sanitizeAllBtn.textContent = '⚙ 全部映射为状态变量（不运行代码）';

  quickActions.append(observeAllBtn, sanitizeAllBtn);

  const list = document.createElement('div');
  list.className = 'import-community-list';

  const requirementNodes = requirements.map((item) => {
    return createRequirementRow(item, () => {
      onStrategyChange(collectDecisions());
    });
  });

  requirementNodes.forEach((node) => list.append(node.element));

  function collectDecisions() {
    return requirementNodes.map((n) => ({
      id: n.item.id,
      strategy: n.getStrategy()
    }));
  }

  observeAllBtn.addEventListener('click', () => {
    requirementNodes.forEach((n) => n.setStrategy('disable'));
    onStrategyChange(collectDecisions());
  });

  sanitizeAllBtn.addEventListener('click', () => {
    requirementNodes.forEach((n) => n.setStrategy('disable'));
    onStrategyChange(collectDecisions());
  });

  const safety = document.createElement('p');
  safety.className = 'import-community-safety';
  safety.textContent = getCommunityCompatibilitySafetyText(report, { storyImport });

  section.append(heading, playability, summary, quickActions, list, safety);
  return section;
}

export function getCommunityCompatibilitySafetyText(report = {}, { storyImport = false } = {}) {
  const outcome = report.acceptance?.outcome || '';
  if (outcome === 'blocked') {
    const reason = report.acceptance?.blockers?.[0]?.label || '资源依赖不受控运行时';
    return `已阻断运行：${reason}。原件可保存审阅，但不会执行第三方 JavaScript、DOM 或 iframe。`;
  }
  if (outcome === 'safe-degradation') {
    const differenceCount = Number(report.acceptance?.differences?.length || 0);
    return `已保留静态内容并禁用不安全部分，共 ${differenceCount} 项差异；导入后请按差异清单审阅。`;
  }
  if (outcome === 'review-required') {
    const reviewCount = Number(report.acceptance?.reviews?.length || report.counts?.review || 0);
    return `检测到 ${reviewCount} 项脚本能力：默认可在本地隔离沙箱中观察运行并记录；若切换为严格模式，则需逐项确认内容哈希后才会运行。`;
  }
  return report.counts?.missing
    ? `${storyImport ? '可以保存并创建待完善副本，但' : '可以安全保存原件，但'}缺失能力不会因此恢复；不能放入隔离运行时的代码仍不会执行。`
    : '主要交互语义已映射；静态内容可直接入库。可隔离的第三方脚本默认本地观察运行并写入审计，严格模式下再要求逐项确认与内容哈希绑定。';
}

function createRequirementRow(item = {}, onChange = () => {}) {
  const row = document.createElement('article');
  row.className = `import-community-item is-${item.status || 'degraded'}`;

  const status = document.createElement('span');
  status.className = 'import-community-status';
  status.textContent = STATUS_LABELS[item.status] || '需审阅';

  const copy = document.createElement('div');
  copy.className = 'import-community-copy';
  const title = document.createElement('strong');
  title.textContent = item.label || item.id || '未命名能力';
  const impact = document.createElement('p');
  impact.textContent = item.impact || '';
  copy.append(title, impact);

  if (Array.isArray(item.evidence) && item.evidence.length) {
    const evidence = document.createElement('small');
    evidence.textContent = `依据：${item.evidence.slice(0, 3).join(' · ')}`;
    copy.append(evidence);
  }
  if (item.recommendation && item.status !== 'supported') {
    const recommendation = document.createElement('small');
    recommendation.className = 'import-community-recommendation';
    recommendation.textContent = `处理：${item.recommendation}`;
    copy.append(recommendation);
  }

  // 逐项审核控制栏
  const control = document.createElement('div');
  control.className = 'import-community-controls';
  control.style.cssText = 'margin-top:6px;display:flex;gap:6px;align-items:center;';

  const select = document.createElement('select');
  select.className = 'form-input compact';
  select.style.cssText = 'padding:2px 8px;font-size:12px;';

  const optMap = document.createElement('option');
  optMap.value = 'mapping';
  optMap.textContent = '⚙ 映射为状态变量（不执行代码）';

  const optDisable = document.createElement('option');
  optDisable.value = 'disable';
  optDisable.textContent = '◉ 本地探索沙箱（运行并记录）';

  select.append(optMap, optDisable);
  select.value = 'disable';

  select.addEventListener('change', () => {
    onChange();
  });

  const controlLabel = document.createElement('span');
  controlLabel.textContent = '运行策略：';
  controlLabel.style.cssText = 'font-size:12px;color:var(--text-muted, #888);';

  control.append(controlLabel, select);
  copy.append(control);

  row.append(status, copy);

  return {
    item,
    element: row,
    getStrategy: () => select.value,
    setStrategy: (val) => { select.value = val; }
  };
}
