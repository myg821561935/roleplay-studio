export const INSPECTOR_GROUPS = {
  core: {
    label: '核心',
    description: '角色、世界与叙事素材',
    tabs: ['authoring', 'character', 'worldbook', 'prompt', 'persona', 'quickreplies', 'sources']
  },
  advanced: {
    label: '高级',
    description: '宏、模拟与外部能力',
    tabs: ['status', 'macro']
  },
  debug: {
    label: '调试',
    description: '健康、记忆、事实与调用观测',
    tabs: ['health', 'memory', 'facts', 'usage']
  }
};

export function createInspectorTabSelectSync({
  tabSelect,
  panel,
  workspace,
  documentObject = globalThis.document
} = {}) {
  return function syncInspectorTabSelect(activeTab) {
    if (!tabSelect) return;
    const mode = workspace?.dataset.workMode || 'creative';
    const buttons = Array.from(panel?.querySelectorAll('.tab-button[data-tab]') || [])
      .filter((button) => String(button.dataset.modeGroups || '').split(/\s+/).includes(mode));
    tabSelect.innerHTML = '';
    buttons.forEach((button) => {
      const option = documentObject.createElement('option');
      option.value = button.dataset.tab;
      option.textContent = button.textContent.trim();
      tabSelect.append(option);
    });
    if (buttons.some((button) => button.dataset.tab === activeTab)) {
      tabSelect.value = activeTab;
    }
  };
}

export const WORLD_BOOK_TYPE_OPTIONS = [
  'world-premise', 'geography', 'history', 'realm', 'rule', 'economy',
  'faction', 'character', 'location', 'item', 'event', 'quest',
  'campaign', 'story-node', 'meta', 'memory', 'other'
];

export const WORLD_BOOK_ENTRY_FIELDS = [
  { key: 'title', label: '标题', type: 'text', mode: 'simple', helpKey: 'wbFieldTitle' },
  { key: 'type', label: '类型', type: 'select', options: WORLD_BOOK_TYPE_OPTIONS, allowCustom: true, mode: 'simple', helpKey: 'wbFieldType' },
  { key: 'content', label: '内容', type: 'textarea', rows: 5, mode: 'simple', helpKey: 'wbFieldContent' },
  { key: 'keywords', label: '主关键词（逗号分隔）', type: 'csv', mode: 'simple', helpKey: 'wbFieldKeywords' },
  { key: 'priority', label: '优先级 (0-100)', type: 'number', mode: 'simple', helpKey: 'wbFieldPriority' },
  { key: 'depth', label: '插入深度', type: 'number', mode: 'simple', helpKey: 'wbFieldDepth' },
  { key: 'regex', label: '正则触发器（逗号分隔）', type: 'csv', mode: 'advanced', helpKey: 'wbFieldRegex' },
  { key: 'secondaryKeywords', label: '次关键词（逗号分隔）', type: 'csv', mode: 'advanced', helpKey: 'wbFieldSecondaryKeywords' },
  { key: 'matchMode', label: '匹配模式', type: 'select', options: ['keyword', 'regex', 'selective'], mode: 'advanced', helpKey: 'wbFieldMatchMode' },
  { key: 'logic', label: '逻辑', type: 'select', options: ['any', 'all', 'not', 'not all'], mode: 'advanced', helpKey: 'wbFieldLogic' },
  { key: 'position', label: '位置', type: 'select', options: ['after_character', 'before_character', 'at_end', 'at_start'], mode: 'advanced', helpKey: 'wbFieldPosition' },
  { key: 'insertionOrder', label: '插入顺序', type: 'number', mode: 'advanced', helpKey: 'wbFieldInsertionOrder' },
  { key: 'scope', label: '作用域', type: 'select', options: ['prompt', 'world', 'character'], mode: 'advanced', helpKey: 'wbFieldScope' }
];

export function getInspectorGroupForTab(tab) {
  return Object.entries(INSPECTOR_GROUPS).find(([, group]) => group.tabs.includes(tab))?.[0] || 'core';
}

export function createInspectorController({
  panel,
  tabSelect,
  syncTabSelect,
  activateResourceView,
  openAdvancedTool,
  onGroupChange
} = {}) {
  function activateGroup(groupName, options = {}) {
    const safeGroup = INSPECTOR_GROUPS[groupName] ? groupName : 'core';
    if (panel) panel.dataset.inspectorGroup = safeGroup;

    const groupButtons = Array.from(panel?.querySelectorAll('.inspector-group-button[data-inspector-group]') || []);
    groupButtons.forEach((button) => {
      const active = button.dataset.inspectorGroup === safeGroup;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });

    const tabButtons = Array.from(panel?.querySelectorAll('.tab-button[data-tab]') || []);
    tabButtons.forEach((button) => {
      button.hidden = getInspectorGroupForTab(button.dataset.tab) !== safeGroup;
    });

    if (options.activateDefault !== false) {
      const activeTab = tabButtons.find((button) => button.classList.contains('active'))?.dataset.tab;
      if (getInspectorGroupForTab(activeTab) !== safeGroup) activateTab(INSPECTOR_GROUPS[safeGroup].tabs[0], { syncGroup: false });
    }
    if (options.notifyMode === true) onGroupChange?.(safeGroup);
    return safeGroup;
  }

  function activateTab(tab, options = {}) {
    const tabButtons = Array.from(panel?.querySelectorAll('.tab-button[data-tab]') || []);
    const tabPanes = Array.from(panel?.querySelectorAll('.tab-pane[data-pane]') || []);
    if (!tabButtons.some((button) => button.dataset.tab === tab)
      || !tabPanes.some((pane) => pane.dataset.pane === tab)) return false;

    if (options.syncGroup !== false) activateGroup(getInspectorGroupForTab(tab), { activateDefault: false });
    tabButtons.forEach((button) => {
      const active = button.dataset.tab === tab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    });

    tabPanes.forEach((pane) => {
      const active = pane.dataset.pane === tab;
      pane.classList.toggle('active', active);
      pane.hidden = !active;
    });
    panel?.classList.toggle('resource-workbench-open', tab === 'sources');
    panel?.classList.toggle('authoring-workbench-open', tab === 'authoring');
    if (tab === 'sources') activateResourceView?.(panel?.querySelector('[data-resource-view].active')?.dataset.resourceView || 'library');
    syncTabSelect?.(tab);
    if (tabSelect) tabSelect.value = tab;
    return true;
  }

  function bindEvents() {
    Array.from(panel?.querySelectorAll('.inspector-group-button[data-inspector-group]') || []).forEach((button) => {
      button.addEventListener('click', () => activateGroup(button.dataset.inspectorGroup, { notifyMode: true }));
    });
    Array.from(panel?.querySelectorAll('.tab-button[data-tab]') || []).forEach((button) => {
      button.addEventListener('click', () => activateTab(button.dataset.tab));
    });
    tabSelect?.addEventListener('change', () => {
      const tab = tabSelect.value;
      activateGroup(getInspectorGroupForTab(tab), { activateDefault: false, notifyMode: true });
      activateTab(tab, { syncGroup: false });
    });
    Array.from(panel?.querySelectorAll('[data-open-provider-section]') || []).forEach((button) => {
      button.addEventListener('click', () => openAdvancedTool?.(button.dataset.openProviderSection));
    });
  }

  return { activateGroup, activateTab, bindEvents };
}

function createEditorInput(field, entry) {
  let input;
  if (field.type === 'textarea') {
    input = document.createElement('textarea');
    input.rows = field.rows || 3;
    input.value = entry[field.key] || '';
  } else if (field.type === 'select') {
    input = document.createElement('select');
    const currentValue = String(entry[field.key] || '');
    const options = Array.isArray(field.options) ? field.options : [];
    if (field.allowCustom && currentValue && !options.includes(currentValue)) {
      const customOption = document.createElement('option');
      customOption.value = currentValue;
      customOption.textContent = `${currentValue}（自定义）`;
      input.append(customOption);
    }
    options.forEach((optionValue) => {
      const option = document.createElement('option');
      option.value = optionValue;
      option.textContent = optionValue;
      if (currentValue === optionValue) option.selected = true;
      input.append(option);
    });
    if (field.allowCustom) {
      const customOption = document.createElement('option');
      customOption.value = '__custom__';
      customOption.textContent = '自定义…';
      input.append(customOption);
      const customInput = document.createElement('input');
      customInput.type = 'text';
      customInput.className = 'form-input wb-editor-custom-input is-hidden';
      customInput.value = currentValue && !options.includes(currentValue) ? currentValue : '';
      customInput.placeholder = '输入自定义值';
      const handleSelectChange = () => {
        const isCustom = input.value === '__custom__';
        customInput.classList.toggle('is-hidden', !isCustom);
        if (isCustom) customInput.focus();
      };
      input.addEventListener('change', handleSelectChange);
      if (currentValue && !options.includes(currentValue)) {
        input.value = currentValue;
      }
      input.dataset.customInputKey = field.key;
      input._customInput = customInput;
    }
    if (!entry[field.key] && field.key === 'matchMode') input.value = 'keyword';
    if (!entry[field.key] && field.key === 'logic') input.value = 'any';
    if (!entry[field.key] && field.key === 'position') input.value = 'after_character';
    if (!entry[field.key] && field.key === 'scope') input.value = 'prompt';
  } else {
    input = document.createElement('input');
    input.type = field.type === 'number' ? 'number' : 'text';
    if (field.type === 'csv') input.value = Array.isArray(entry[field.key]) ? entry[field.key].join(', ') : '';
    else if (field.type === 'number') {
      const fallback = field.key === 'priority' ? 50 : (field.key === 'depth' ? 4 : 0);
      input.value = entry[field.key] ?? fallback;
    }
    else input.value = entry[field.key] || '';
    if (field.placeholder) input.placeholder = field.placeholder;
  }
  input.className = 'form-input';
  return input;
}

export function openWorldbookEntryEditor(entry, onDone) {
  const overlay = document.createElement('div');
  overlay.className = 'wb-editor-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'wb-editor-dialog';
  dialog.dataset.editorMode = 'simple';

  const heading = document.createElement('div');
  heading.className = 'wb-editor-heading';
  const headingCopy = document.createElement('div');
  const title = document.createElement('h4');
  title.textContent = '编辑世界书条目';
  const hint = document.createElement('p');
  hint.textContent = '简化模式适合日常设定；高级模式用于精确触发与插入控制。';
  headingCopy.append(title, hint);

  const modeSwitch = document.createElement('div');
  modeSwitch.className = 'wb-editor-mode-switch';
  modeSwitch.setAttribute('role', 'group');
  modeSwitch.setAttribute('aria-label', '世界书编辑模式');
  ['simple', 'advanced'].forEach((mode) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.wbEditorMode = mode;
    button.className = `wb-editor-mode-button${mode === 'simple' ? ' active' : ''}`;
    button.textContent = mode === 'simple' ? '简化' : '高级';
    button.setAttribute('aria-pressed', String(mode === 'simple'));
    button.addEventListener('click', () => {
      dialog.dataset.editorMode = mode;
      modeSwitch.querySelectorAll('[data-wb-editor-mode]').forEach((item) => {
        const active = item.dataset.wbEditorMode === mode;
        item.classList.toggle('active', active);
        item.setAttribute('aria-pressed', String(active));
      });
    });
    modeSwitch.append(button);
  });
  heading.append(headingCopy, modeSwitch);
  dialog.append(heading);

  const body = document.createElement('div');
  body.className = 'wb-editor-body';
  dialog.append(body);

  const inputs = {};
  WORLD_BOOK_ENTRY_FIELDS.forEach((field) => {
    const label = document.createElement('label');
    label.className = `wb-editor-field is-${field.mode}`;
    label.dataset.field = field.key;
    const span = document.createElement('span');
    span.textContent = field.label;
    if (field.helpKey) {
      span.className = 'wb-term';
      span.dataset.helpKey = field.helpKey;
      span.setAttribute('role', 'button');
      span.setAttribute('tabindex', '0');
      span.setAttribute('aria-label', `${field.label}（点击查看说明）`);
    }
    label.append(span);
    const input = createEditorInput(field, entry);
    label.append(input);
    if (input._customInput) {
      label.append(input._customInput);
    }
    body.append(label);
    inputs[field.key] = input;
  });

  const checkboxRow = document.createElement('div');
  checkboxRow.className = 'wb-editor-checkboxes';
  [
    { key: 'enabled', label: '启用', default: true, mode: 'simple', helpKey: 'wbFieldEnabled' },
    { key: 'constant', label: '常驻', default: false, mode: 'simple', helpKey: 'wbFieldConstant' },
    { key: 'caseSensitive', label: '区分大小写', default: false, mode: 'advanced', helpKey: 'wbFieldCaseSensitive' }
  ].forEach((option) => {
    const label = document.createElement('label');
    label.className = `wb-editor-checkbox is-${option.mode}`;
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = entry[option.key] !== undefined ? entry[option.key] : option.default;
    const text = document.createElement('span');
    text.textContent = option.label;
    if (option.helpKey) {
      text.className = 'wb-term';
      text.dataset.helpKey = option.helpKey;
      text.setAttribute('role', 'button');
      text.setAttribute('tabindex', '0');
      text.setAttribute('aria-label', `${option.label}（点击查看说明）`);
    }
    label.append(checkbox, text);
    checkboxRow.append(label);
    inputs[option.key] = checkbox;
  });
  body.append(checkboxRow);

  const actions = document.createElement('div');
  actions.className = 'wb-editor-actions';
  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'ghost-button compact';
  cancelButton.textContent = '取消';
  cancelButton.addEventListener('click', () => {
    overlay.remove();
    onDone(null);
  });
  const confirmButton = document.createElement('button');
  confirmButton.type = 'button';
  confirmButton.className = 'primary-button compact';
  confirmButton.textContent = '保存条目';
  confirmButton.addEventListener('click', () => {
    const updated = { ...entry };
    WORLD_BOOK_ENTRY_FIELDS.forEach((field) => {
      const input = inputs[field.key];
      let value = input.value;
      if (field.allowCustom && value === '__custom__' && input._customInput) {
        value = input._customInput.value;
      }
      if (field.type === 'csv') updated[field.key] = String(value).split(',').map((item) => item.trim()).filter(Boolean);
      else if (field.type === 'number') {
        const number = Number(value);
        const fallback = field.key === 'priority' ? 50 : (field.key === 'depth' ? 4 : 0);
        updated[field.key] = Number.isFinite(number) ? number : fallback;
      } else updated[field.key] = String(value).trim();
    });
    updated.enabled = inputs.enabled.checked;
    updated.constant = inputs.constant.checked;
    updated.caseSensitive = inputs.caseSensitive.checked;
    overlay.remove();
    onDone(updated);
  });
  actions.append(cancelButton, confirmButton);
  dialog.append(actions);
  overlay.append(dialog);
  document.body.append(overlay);
  queueMicrotask(() => inputs.title?.focus());
}

export function createWorldbookController({ state, els, typeLabels, prettyJson, setStatus, confirmAction = globalThis.confirm } = {}) {
  const normalizeType = (type) => {
    const safeType = String(type || 'other').trim() || 'other';
    return typeLabels[safeType] ? safeType : 'other';
  };

  function createEntryRow(entry, index) {
    const row = document.createElement('div');
    row.className = 'immersive-worldbook-card';
    if (entry.enabled === false) row.classList.add('is-disabled');
    if (entry.constant) row.classList.add('is-constant');

    const head = document.createElement('div');
    head.className = 'immersive-worldbook-card-head';

    const title = document.createElement('strong');
    title.className = 'immersive-worldbook-card-title';
    title.textContent = entry.title || '未命名条目';

    const metaTop = document.createElement('div');
    metaTop.className = 'immersive-worldbook-card-meta-top';
    const mode = document.createElement('span');
    mode.className = 'wb-badge';
    mode.textContent = entry.constant ? '常驻 (Constant)' : (entry.matchMode || 'keyword');
    metaTop.append(mode);

    if (entry.enabled === false) {
      const disabled = document.createElement('span');
      disabled.className = 'wb-badge disabled-badge';
      disabled.textContent = '已禁用';
      metaTop.append(disabled);
    }

    head.append(title, metaTop);

    const meta = document.createElement('div');
    meta.className = 'immersive-worldbook-card-meta';
    const parts = [];
    if (Array.isArray(entry.keywords) && entry.keywords.length) parts.push(`关键词: ${entry.keywords.slice(0, 3).join('、')}${entry.keywords.length > 3 ? '…' : ''}`);
    if (Array.isArray(entry.regex) && entry.regex.length) parts.push(`正则: ${entry.regex.slice(0, 2).join(' | ')}`);
    if (Array.isArray(entry.secondaryKeywords) && entry.secondaryKeywords.length) parts.push(`次关键词: ${entry.secondaryKeywords.slice(0, 2).join('、')}`);
    parts.push(`优先级: ${entry.priority ?? 50}`);
    parts.push(`深度: ${entry.depth ?? 4}`);
    if (entry.logic && entry.logic !== 'any') parts.push(`逻辑: ${entry.logic}`);
    meta.textContent = parts.join(' · ');

    const preview = document.createElement('p');
    preview.className = 'immersive-worldbook-card-preview';
    preview.textContent = String(entry.content || '').trim();

    const actions = document.createElement('div');
    actions.className = 'immersive-worldbook-card-actions';
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'ghost-button compact';
    edit.textContent = '编辑';
    edit.dataset.editEntry = String(index);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'ghost-button compact';
    remove.textContent = '删除';
    remove.dataset.delEntry = String(index);
    actions.append(edit, remove);

    row.append(head, meta, preview, actions);
    return row;
  }

  function syncTypeFilter(entries) {
    if (!els.worldbookTypeFilter) return;
    const selected = els.worldbookTypeFilter.value;
    const types = [...new Set(entries.map((entry) => normalizeType(entry?.type)))];
    const typeOrder = Object.keys(typeLabels);
    types.sort((left, right) => typeOrder.indexOf(left) - typeOrder.indexOf(right));
    els.worldbookTypeFilter.innerHTML = '';
    const all = document.createElement('option');
    all.value = '';
    all.textContent = '全部类型';
    els.worldbookTypeFilter.append(all);
    types.forEach((type) => {
      const option = document.createElement('option');
      option.value = type;
      option.textContent = typeLabels[type] || type;
      els.worldbookTypeFilter.append(option);
    });
    if (!selected || types.includes(selected)) els.worldbookTypeFilter.value = selected;
  }

  function renderWorldbookEntries() {
    if (!els.worldbookEntriesList) return;
    const entries = Array.isArray(state.config?.worldBook) ? state.config.worldBook : [];
    els.worldbookEntriesList.innerHTML = '';
    syncTypeFilter(entries);
    const query = String(els.worldbookSearch?.value || '').trim().toLowerCase();
    const typeFilter = String(els.worldbookTypeFilter?.value || '');
    const visibleEntries = entries.map((entry, index) => ({ entry, index })).filter(({ entry }) => {
      const type = normalizeType(entry?.type);
      if (typeFilter && type !== typeFilter) return false;
      if (!query) return true;
      const haystack = [
        entry?.title,
        entry?.content,
        typeLabels[type],
        ...(Array.isArray(entry?.keywords) ? entry.keywords : []),
        ...(Array.isArray(entry?.secondaryKeywords) ? entry.secondaryKeywords : [])
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(query);
    });

    if (els.worldbookBrowserCount) {
      const typeCount = new Set(entries.map((entry) => normalizeType(entry?.type))).size;
      els.worldbookBrowserCount.textContent = query || typeFilter
        ? `${visibleEntries.length} / ${entries.length} 条`
        : `${entries.length} 条 · ${typeCount} 类`;
    }
    if (!entries.length || !visibleEntries.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.style.padding = '12px';
      empty.textContent = entries.length ? '没有符合当前搜索或类型筛选的条目。' : '暂无世界书条目，点击「新增条目」创建。';
      els.worldbookEntriesList.append(empty);
      return;
    }

    const groupedEntries = new Map();
    visibleEntries.forEach((item) => {
      const type = normalizeType(item.entry?.type);
      if (!groupedEntries.has(type)) groupedEntries.set(type, []);
      groupedEntries.get(type).push(item);
    });
    const typeOrder = Object.keys(typeLabels);
    [...groupedEntries.entries()].sort(([left], [right]) => {
      const leftIndex = typeOrder.indexOf(left);
      const rightIndex = typeOrder.indexOf(right);
      return (leftIndex < 0 ? typeOrder.length : leftIndex) - (rightIndex < 0 ? typeOrder.length : rightIndex);
    }).forEach(([type, items], groupIndex) => {
      const group = document.createElement('details');
      group.className = 'worldbook-entry-group';
      group.open = Boolean(query || typeFilter || groupIndex < 2);
      const summary = document.createElement('summary');
      summary.className = 'worldbook-entry-group-summary';
      const label = document.createElement('span');
      label.textContent = typeLabels[type] || type;
      const count = document.createElement('span');
      count.className = 'worldbook-entry-group-count';
      count.textContent = `${items.length} 条`;
      summary.append(label, count);
      const body = document.createElement('div');
      body.className = 'immersive-worldbook-group-grid';
      items.forEach(({ entry, index }) => body.append(createEntryRow(entry, index)));
      group.append(summary, body);
      els.worldbookEntriesList.append(group);
    });
    els.worldbookEntriesList.querySelectorAll('[data-edit-entry]').forEach((button) => {
      button.addEventListener('click', () => editWorldbookEntry(Number(button.dataset.editEntry)));
    });
    els.worldbookEntriesList.querySelectorAll('[data-del-entry]').forEach((button) => {
      button.addEventListener('click', () => deleteWorldbookEntry(Number(button.dataset.delEntry)));
    });
  }

  function editWorldbookEntry(index) {
    const entries = Array.isArray(state.config?.worldBook) ? [...state.config.worldBook] : [];
    if (!entries[index]) return;
    openWorldbookEntryEditor(entries[index], (updated) => {
      if (updated === null) return;
      entries[index] = updated;
      state.config.worldBook = entries;
      els.worldbookEditor.value = prettyJson(entries);
      renderWorldbookEntries();
    });
  }

  function deleteWorldbookEntry(index) {
    const entries = Array.isArray(state.config?.worldBook) ? [...state.config.worldBook] : [];
    if (!entries[index]) return;
    if (!confirmAction(`确认删除「${entries[index].title || '未命名条目'}」？`)) return;
    entries.splice(index, 1);
    state.config.worldBook = entries;
    els.worldbookEditor.value = prettyJson(entries);
    renderWorldbookEntries();
    setStatus(els.worldbookStatus, '已删除条目（请点击「保存世界书」持久化）', 'ok');
  }

  return { renderWorldbookEntries, editWorldbookEntry, deleteWorldbookEntry, openWorldbookEntryEditor };
}
