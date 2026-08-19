export function getCustomStoryInteractionReview(compatibilityReview = {}) {
  const interaction = compatibilityReview?.interaction;
  return interaction && typeof interaction === 'object'
    ? interaction
    : {
        roleplayMode: 'dm',
        roleplayModeLabel: '标准 DM 叙事流',
        semantics: {},
        conflicts: [],
        hasConflict: false
      };
}

export function getCustomStoryInteractionConflicts(report = {}) {
  const conflicts = report?.compatibilityReview?.interaction?.conflicts;
  return Array.isArray(conflicts) ? conflicts : [];
}

export function renderCustomStoryConflictSummary({
  element,
  composition = {},
  readiness = {},
  documentObject = globalThis.document
} = {}) {
  if (!element) return;
  if (composition.status === 'loading') {
    element.className = 'story-custom-conflicts is-loading';
    element.textContent = '正在比对基线与所选世界书...';
    return;
  }
  if (composition.status === 'error') {
    element.className = 'story-custom-conflicts is-error';
    element.textContent = `冲突预检暂不可用：${composition.error}`;
    return;
  }
  const report = composition.report;
  if (!report) {
    element.className = 'story-custom-conflicts';
    element.textContent = '选择素材后将自动检查同名设定、常驻规则、触发词重叠与互动控制权。';
    return;
  }

  const summary = report.summary || {};
  const interactionConflicts = getCustomStoryInteractionConflicts(report);
  const reviewCount = Number(summary.sameTitleConflicts || 0)
    + Number(summary.constantConflicts || 0)
    + Number(summary.triggerOverlaps || 0)
    + Number(summary.promptIdConflicts || 0)
    + interactionConflicts.length;
  element.className = `story-custom-conflicts ${reviewCount ? 'is-review' : 'is-clean'}`;
  element.replaceChildren();
  const title = documentObject.createElement('strong');
  const finalEntries = Number(summary.finalEntries || 0);
  title.textContent = reviewCount
    ? `发现 ${reviewCount} 组需留意的设定重叠`
    : finalEntries > 0
      ? '世界书合并检查通过'
      : readiness.baseInheritanceMode === 'genre'
        ? '当前仅继承题材框架'
        : '本次没有合并世界书条目';
  const meta = documentObject.createElement('span');
  meta.textContent = [
    `最终 ${finalEntries} 条`,
    Number(summary.exactDuplicates || 0) ? `去重 ${summary.exactDuplicates}` : '',
    Number(summary.sameTitleConflicts || 0) ? `同名 ${summary.sameTitleConflicts}` : '',
    Number(summary.constantConflicts || 0) ? `常驻冲突 ${summary.constantConflicts}` : '',
    Number(summary.triggerOverlaps || 0) ? `触发重叠 ${summary.triggerOverlaps}` : '',
    Number(summary.promptIdConflicts || 0) ? `Prompt 重名 ${summary.promptIdConflicts}` : '',
    interactionConflicts.length ? `互动冲突 ${interactionConflicts.length}` : ''
  ].filter(Boolean).join(' · ');
  element.append(title, meta);

  const samples = [
    ...(Array.isArray(report.conflicts) ? report.conflicts : []),
    ...interactionConflicts
  ].slice(0, 4);
  if (!samples.length) return;
  const list = documentObject.createElement('ul');
  samples.forEach((item) => {
    const row = documentObject.createElement('li');
    row.textContent = item.message || item.title || '设定重叠';
    list.append(row);
  });
  element.append(list);
}
