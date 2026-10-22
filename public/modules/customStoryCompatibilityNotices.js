export function createCompatibilityHeading(complete, { createElement }) {
  const heading = createElement('div');
  heading.className = 'story-custom-approval-heading';
  heading.append(
    createElement('strong', complete ? '兼容审查已完成' : '创建前兼容审查'),
    createElement('span', complete ? '兼容处理已写入本地组装记录。' : '请先确认兼容差异；脚本可选择本地观察、开发兼容探针或严格逐项审批。')
  );
  return heading;
}

export function createSafeDerivativeNotice(review, { createElement }) {
  const wrapper = createElement('div');
  wrapper.className = 'story-custom-compatibility-blockers';
  wrapper.append(
    createElement('strong', '原资源不能直接运行，可创建安全派生版'),
    createElement('p', '系统仅保留可声明映射的状态与样式。原始宿主运行时不会接管本项目；可转换片段可在无网络、无宿主数据权限的隔离 iframe 中本地观察运行，所有启动与错误均写入审计。')
  );
  const blockers = Array.isArray(review?.blockers) ? review.blockers : [];
  if (blockers.length) {
    const list = createElement('ul');
    blockers.forEach((item) => {
      const row = createElement('li');
      row.append(
        createElement('strong', String(item.label || item.id || '未知能力')),
        createElement('span', String(item.impact || item.recommendation || '已接入智能沙箱托管'))
      );
      list.append(row);
    });
    wrapper.append(list);
  }
  return wrapper;
}

export function createCompatibilityAcknowledgement(review, acknowledged, { createElement, createButton }) {
  const counts = review.counts || {};
  const row = createElement('div');
  row.className = `story-custom-compatibility-ack ${acknowledged ? 'is-approved' : 'is-pending'}`;
  const sourceRuntimeBlocked = Boolean(review?.sourceRuntimeBlocked || Number(counts.missing || 0) > 0);
  const copy = [
    Number(counts.missing || 0) ? `禁用 ${Number(counts.missing)} 项源运行时能力` : '',
    Number(counts.degraded || 0) ? `降级 ${Number(counts.degraded)}` : '',
    Number(counts.review || 0) && !review.rules?.length ? `待转换 ${Number(counts.review)}` : ''
  ].filter(Boolean).join(' · ') || '存在需确认的兼容处理';
  const button = createButton(
    acknowledged
      ? (sourceRuntimeBlocked ? '已确认安全派生版' : '已确认安全处理')
      : (sourceRuntimeBlocked ? '确认创建安全派生版' : '确认禁用 / 降级处理')
  );
  button.disabled = acknowledged;
  button.dataset.storyCompatibilityAck = 'true';
  row.append(createElement('span', copy), button);
  return row;
}
