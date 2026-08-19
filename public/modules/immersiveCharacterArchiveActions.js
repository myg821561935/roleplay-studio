export function appendImmersiveCharacterArchiveActions(container, memberCount, {
  documentObject = globalThis.document
} = {}) {
  if (!container) return;
  const section = documentObject.createElement('section');
  section.className = 'immersive-character-archive-actions';
  const summary = documentObject.createElement('p');
  summary.textContent = memberCount
    ? '档案以当前角色卡、已登场记录和会话状态为准；编辑后会影响后续的角色编排。'
    : '可从角色创作台补充互动角色；角色进入剧情后会在此形成可追溯档案。';
  const manage = documentObject.createElement('button');
  manage.type = 'button';
  manage.className = 'ghost-button compact';
  manage.dataset.immersiveCharacterAction = 'manage';
  manage.textContent = memberCount ? '管理角色档案' : '添加互动角色';
  section.append(summary, manage);
  container.append(section);
}
