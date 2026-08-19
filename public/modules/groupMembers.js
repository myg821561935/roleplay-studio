export function getEnabledGroupMemberNames(groupMembers) {
  const names = Array.isArray(groupMembers)
    ? groupMembers
      .filter((member) => member?.enabled !== false)
      .map((member) => String(member?.name || '').trim())
      .filter(Boolean)
    : [];
  return [...new Set(names)];
}

export function validateGroupMembers(groupMembers) {
  const members = Array.isArray(groupMembers) ? groupMembers : [];
  const knownNames = new Set();

  for (let index = 0; index < members.length; index += 1) {
    const name = String(members[index]?.name || '').trim();
    if (!name) {
      return {
        valid: false,
        message: `第 ${index + 1} 位成员缺少角色名`
      };
    }

    const key = name.toLocaleLowerCase('zh-CN');
    if (knownNames.has(key)) {
      return {
        valid: false,
        message: `角色名「${name}」重复，请保持唯一`
      };
    }
    knownNames.add(key);
  }

  return { valid: true, message: '' };
}

export function createGroupMembersController({
  state = {},
  els = {},
  apiRequest = async () => ({}),
  getSessionId = () => 'main',
  setStatus = () => {},
  humanizeApiError = (error) => error?.message || String(error),
  onMembersChanged = () => {},
  documentObject = globalThis.document,
  createMemberId = () => `member-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`}`
} = {}) {
  let eventsBound = false;
  let operationPending = false;

  function getMembers() {
    return Array.isArray(state.config?.groupMembers) ? state.config.groupMembers : [];
  }

  function replaceMembers(groupMembers, { notify = true } = {}) {
    if (!state.config || typeof state.config !== 'object') state.config = {};
    state.config.groupMembers = Array.isArray(groupMembers) ? groupMembers : [];
    if (notify) onMembersChanged(state.config.groupMembers);
    return state.config.groupMembers;
  }

  function createTextControl(tagName, member, index, field, placeholder, rows) {
    const control = documentObject.createElement(tagName);
    control.className = 'form-input';
    control.value = String(member?.[field] || '');
    control.placeholder = placeholder;
    control.dataset.memberField = field;
    control.dataset.memberIndex = String(index);
    if (rows) control.rows = rows;
    return control;
  }

  function renderGroupMembers() {
    if (!els.groupMembersList) return;
    const members = getMembers();
    els.groupMembersList.replaceChildren();

    if (!members.length) {
      const empty = documentObject.createElement('div');
      empty.className = 'empty-state';
      empty.style.padding = '12px';
      empty.textContent = '暂无互动角色，点击「+ 添加角色」创建。';
      els.groupMembersList.append(empty);
      return;
    }

    members.forEach((rawMember, index) => {
      const member = rawMember && typeof rawMember === 'object' ? rawMember : {};
      const row = documentObject.createElement('div');
      row.className = 'group-member-row';
      row.dataset.memberIndex = String(index);

      const header = documentObject.createElement('div');
      header.style.cssText = 'display: flex; gap: 8px; align-items: center; margin-bottom: 6px;';

      const name = createTextControl('input', member, index, 'name', '角色名');
      name.style.flex = '1';
      header.append(name);

      const role = createTextControl('input', member, index, 'role', '身份（如：剑客/掌柜）');
      role.style.flex = '1';
      header.append(role);

      const enabledLabel = documentObject.createElement('label');
      enabledLabel.className = 'group-member-enabled';
      enabledLabel.style.cssText = 'display: inline-flex; gap: 4px; align-items: center; white-space: nowrap;';
      const enabled = documentObject.createElement('input');
      enabled.type = 'checkbox';
      enabled.checked = member.enabled !== false;
      enabled.dataset.memberField = 'enabled';
      enabled.dataset.memberIndex = String(index);
      const enabledText = documentObject.createElement('span');
      enabledText.textContent = '启用';
      enabledLabel.append(enabled, enabledText);
      header.append(enabledLabel);

      const remove = documentObject.createElement('button');
      remove.type = 'button';
      remove.className = 'ghost-button compact';
      remove.textContent = '删除';
      remove.dataset.removeMemberIndex = String(index);
      header.append(remove);
      row.append(header);

      const description = createTextControl('textarea', member, index, 'description', '描述', 2);
      description.style.cssText = 'width: 100%; margin-bottom: 6px;';
      row.append(description);

      const personality = createTextControl('textarea', member, index, 'personality', '性格', 2);
      personality.style.cssText = 'width: 100%; margin-bottom: 6px;';
      row.append(personality);

      const systemPrompt = createTextControl('textarea', member, index, 'systemPrompt', '专属指令（可选）', 2);
      systemPrompt.style.width = '100%';
      row.append(systemPrompt);

      els.groupMembersList.append(row);
    });
  }

  function updateMemberFromControl(control) {
    const field = control?.dataset?.memberField;
    const index = Number(control?.dataset?.memberIndex);
    if (!field || !Number.isInteger(index)) return false;

    const members = [...getMembers()];
    if (!members[index] || typeof members[index] !== 'object') return false;
    const nextValue = field === 'enabled' ? Boolean(control.checked) : control.value;
    if (Object.is(members[index][field], nextValue)) return false;
    members[index] = {
      ...members[index],
      [field]: nextValue
    };
    replaceMembers(members);
    return true;
  }

  function removeGroupMember(index) {
    if (!Number.isInteger(index) || index < 0) return false;
    const members = [...getMembers()];
    if (index >= members.length) return false;
    members.splice(index, 1);
    replaceMembers(members);
    renderGroupMembers();
    return true;
  }

  function addGroupMemberRow() {
    const members = [...getMembers(), {
      id: createMemberId(),
      name: '',
      role: '',
      description: '',
      personality: '',
      systemPrompt: '',
      enabled: true
    }];
    replaceMembers(members);
    renderGroupMembers();
    return members.at(-1);
  }

  async function saveGroupMembersConfig() {
    if (operationPending) return null;
    const members = getMembers();
    const validation = validateGroupMembers(members);
    if (!validation.valid) {
      setStatus(els.groupMembersStatus, validation.message, 'error');
      return null;
    }

    operationPending = true;
    if (els.saveGroupMembers) els.saveGroupMembers.disabled = true;
    setStatus(els.groupMembersStatus, '正在保存...', 'busy');
    try {
      const payload = await apiRequest('/api/group-members', {
        method: 'PUT',
        body: { groupMembers: members, sessionId: getSessionId() }
      });
      if (!Array.isArray(payload?.groupMembers)) throw new Error('INVALID_GROUP_MEMBERS_RESPONSE');
      replaceMembers(payload.groupMembers);
      renderGroupMembers();
      setStatus(els.groupMembersStatus, `已保存 ${payload.groupMembers.length} 位成员`, 'ok');
      return payload.groupMembers;
    } catch (error) {
      setStatus(els.groupMembersStatus, `保存失败：${humanizeApiError(error)}`, 'error');
      return null;
    } finally {
      operationPending = false;
      if (els.saveGroupMembers) els.saveGroupMembers.disabled = false;
    }
  }

  function handleListClick(event) {
    const index = Number(event.target?.dataset?.removeMemberIndex);
    if (Number.isInteger(index)) removeGroupMember(index);
  }

  function handleListInput(event) {
    updateMemberFromControl(event.target);
  }

  function bindEvents() {
    if (eventsBound) return;
    eventsBound = true;
    els.addGroupMember?.addEventListener('click', addGroupMemberRow);
    els.saveGroupMembers?.addEventListener('click', () => {
      void saveGroupMembersConfig();
    });
    els.groupMembersList?.addEventListener('click', handleListClick);
    els.groupMembersList?.addEventListener('input', handleListInput);
    els.groupMembersList?.addEventListener('change', handleListInput);
  }

  return {
    addGroupMemberRow,
    bindEvents,
    removeGroupMember,
    renderGroupMembers,
    saveGroupMembersConfig,
    updateMemberFromControl
  };
}
