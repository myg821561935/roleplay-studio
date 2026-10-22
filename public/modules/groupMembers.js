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
    if (els.groupSpeakerStrategy) {
      const strategy = state.config?.settings?.groupSpeakerStrategy
        || state.session?.settings?.groupSpeakerStrategy
        || 'talkativeness';
      els.groupSpeakerStrategy.value = strategy;
    }
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

      const removeBtn = documentObject.createElement('button');
      removeBtn.className = 'ghost-button compact danger-text';
      removeBtn.type = 'button';
      removeBtn.textContent = '删除';
      removeBtn.dataset.removeMemberIndex = String(index);
      header.append(removeBtn);
      row.append(header);

      const talkRow = documentObject.createElement('div');
      talkRow.style.cssText = 'display: flex; gap: 8px; align-items: center; margin-bottom: 6px; font-size: 12px; color: var(--text-muted);';
      const talkLabel = documentObject.createElement('label');
      talkLabel.textContent = '话唠度：';
      const talkInput = documentObject.createElement('input');
      talkInput.type = 'number';
      talkInput.className = 'form-input compact';
      talkInput.style.width = '70px';
      talkInput.min = '0';
      talkInput.max = '1';
      talkInput.step = '0.1';
      talkInput.value = String(member.talkativeness ?? member.extensions?.talkativeness ?? 0.5);
      talkInput.dataset.memberField = 'talkativeness';
      talkInput.dataset.memberIndex = String(index);
      talkRow.append(talkLabel, talkInput);
      row.append(talkRow);

      const desc = createTextControl('textarea', member, index, 'description', '角色设定 / 描述', 2);
      row.append(desc);

      const personality = createTextControl('input', member, index, 'personality', '性格（如：冷酷、多疑）');
      row.append(personality);

      const scenario = createTextControl('input', member, index, 'scenario', '在场动机 / 场景目标');
      row.append(scenario);

      const systemPrompt = createTextControl('textarea', member, index, 'systemPrompt', '专属指令（可选）', 2);
      row.append(systemPrompt);

      els.groupMembersList.append(row);
    });
  }

  function updateMemberFromControl(control) {
    const field = control?.dataset?.memberField;
    const index = Number(control?.dataset?.memberIndex);
    if (!field || !Number.isInteger(index)) return;
    const members = getMembers();
    if (!members[index]) return;
    let nextValue;
    if (control.type === 'checkbox') {
      nextValue = Boolean(control.checked);
    } else if (field === 'talkativeness') {
      const num = Number(control.value);
      nextValue = Number.isFinite(num) ? Math.max(0, Math.min(1, num)) : 0.5;
    } else {
      nextValue = String(control.value || '');
    }
    members[index] = { ...members[index], [field]: nextValue };
    replaceMembers(members);
  }

  function removeGroupMember(index) {
    const members = getMembers();
    if (!members[index]) return;
    members.splice(index, 1);
    replaceMembers(members);
    renderGroupMembers();
  }

  function addGroupMemberRow() {
    const members = [...getMembers(), {
      id: createMemberId(),
      name: '',
      role: '',
      description: '',
      personality: '',
      scenario: '',
      talkativeness: 0.5,
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
      const strategy = els.groupSpeakerStrategy?.value || 'talkativeness';
      const payload = await apiRequest('/api/group-members', {
        method: 'PUT',
        body: {
          groupMembers: members,
          groupSpeakerStrategy: strategy,
          sessionId: getSessionId()
        }
      });
      if (!Array.isArray(payload?.groupMembers)) throw new Error('INVALID_GROUP_MEMBERS_RESPONSE');
      replaceMembers(payload.groupMembers);
      if (strategy) {
        if (!state.config) state.config = {};
        if (!state.config.settings) state.config.settings = {};
        state.config.settings.groupSpeakerStrategy = strategy;
        if (state.session?.settings) state.session.settings.groupSpeakerStrategy = strategy;
      }
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
    els.groupSpeakerStrategy?.addEventListener('change', () => {
      const val = els.groupSpeakerStrategy.value;
      if (!state.config) state.config = {};
      if (!state.config.settings) state.config.settings = {};
      state.config.settings.groupSpeakerStrategy = val;
      if (state.session?.settings) state.session.settings.groupSpeakerStrategy = val;
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
