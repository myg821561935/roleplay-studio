export function getSetupRandomContext(inputByKey) {
  const context = {};
  if (!inputByKey || typeof inputByKey.forEach !== 'function') return context;
  inputByKey.forEach((input, key) => {
    context[key] = input?.value?.trim?.() || '';
  });
  return context;
}

export function createJourneySetupController({
  state = {},
  inferPrologueGenreFromTemplate = () => '',
  getOpeningGenreOption = (genre) => ({ title: genre, hint: '' }),
  getCurrentStoryPresentation = () => ({ sourceLabel: '当前剧本' }),
  canRandomizeSetupField = () => false,
  buildJourneyWorldbookSnapshot = () => ({ entries: [], total: 0, publicTotal: 0, hiddenTotal: 0 }),
  generateSetupFieldValue = () => '',
  createCharacterPortraitImage = () => null,
  startJourney = async () => {},
  documentObject = globalThis.document,
  windowObject = globalThis.window
} = {}) {
  function appendDossierContent(parent, content) {
    const lines = String(content || '')
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (!lines.length) {
      const empty = documentObject.createElement('p');
      empty.className = 'epic-dossier-prose';
      empty.textContent = '暂无公开设定。';
      parent.append(empty);
      return;
    }

    lines.forEach((line) => {
      const match = line.match(/^【([^】]+)】\s*(.*)$/);
      if (!match) {
        const prose = documentObject.createElement('p');
        prose.className = 'epic-dossier-prose';
        prose.textContent = line;
        parent.append(prose);
        return;
      }

      const entry = documentObject.createElement('article');
      entry.className = 'epic-dossier-entry';
      const title = documentObject.createElement('h3');
      title.textContent = match[1];
      const body = documentObject.createElement('p');
      body.textContent = match[2] || '暂无公开内容。';
      entry.append(title, body);
      parent.append(entry);
    });
  }

  function renderSetupPanel(tpl) {
    if (!tpl || typeof tpl !== 'object') return;

    const setupGenre = inferPrologueGenreFromTemplate(tpl);
    const selectedGenre = getOpeningGenreOption(setupGenre);
    const customOpening = tpl.source === 'custom-pack';
    const allowSystemRandom = !customOpening || tpl.protagonist?.allowSystemRandom === true;
    const presentation = getCurrentStoryPresentation(tpl, setupGenre);
    const fields = tpl.fields && typeof tpl.fields === 'object' ? tpl.fields : {};
    const tabs = tpl.tabs && typeof tpl.tabs === 'object' ? tpl.tabs : {};
    const fieldEntries = Object.entries(fields);
    const randomizableFieldEntries = fieldEntries.filter(([, field]) => {
      return canRandomizeSetupField(field, { allowSystemFallback: allowSystemRandom });
    });
    const tabEntries = Object.entries(tabs);
    const destinyCards = Array.isArray(tpl.destinyCards?.cards) ? tpl.destinyCards.cards : [];
    const configuredMaxSelections = Number(tpl.destinyCards?.maxSelections);
    const maxDestinySelections = Number.isFinite(configuredMaxSelections)
      ? Math.max(0, Math.min(destinyCards.length, Math.floor(configuredMaxSelections)))
      : Math.min(destinyCards.length, customOpening ? 2 : 3);
    const choiceStepLabel = tpl.destinyCards?.stepLabel || (customOpening ? '开局要素' : '天命抉择');
    const choiceCounterLabel = tpl.destinyCards?.counterLabel || (customOpening ? '要素' : '天命');
    const worldbookSnapshot = buildJourneyWorldbookSnapshot(6);
    const paneDefs = [
      { key: 'dossier', label: '开局卷宗', step: '01' },
      { key: 'protagonist', label: customOpening ? '主角确认' : '主角塑成', step: '02' },
      ...(destinyCards.length
        ? [{ key: 'destiny', label: choiceStepLabel, step: '03' }]
        : [])
    ];
    const inputByKey = new Map();
    const paneByKey = new Map();
    let activePaneKey = paneDefs[0].key;
    let previousButton;
    let nextButton;
    let sealButton;
    let progressLabel;
    let selectionSummary;
    let destinyCounter;

    const overlay = documentObject.createElement('div');
    overlay.className = 'epic-setup-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'epic-setup-title');

    const modal = documentObject.createElement('div');
    modal.className = 'epic-setup-modal epic-dossier-modal';

    const header = documentObject.createElement('header');
    header.className = 'epic-setup-header';
    const headerTopline = documentObject.createElement('div');
    headerTopline.className = 'epic-setup-topline';
    const kicker = documentObject.createElement('span');
    kicker.className = 'epic-setup-kicker';
    kicker.textContent = `开局案牍 · ${presentation.sourceLabel}`;
    const closeButton = documentObject.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'epic-setup-close';
    closeButton.setAttribute('aria-label', '关闭开局卷宗');
    closeButton.title = '关闭';
    closeButton.textContent = '×';
    closeButton.addEventListener('click', closePanel);
    headerTopline.append(kicker, closeButton);

    const title = documentObject.createElement('h1');
    title.id = 'epic-setup-title';
    title.textContent = tpl.title || '命途开启';
    const subtitle = documentObject.createElement('p');
    subtitle.className = 'epic-setup-subtitle';
    subtitle.textContent = [tpl.subtitle, tpl.tagline].filter(Boolean).join(' · ');
    header.append(headerTopline, title, subtitle);

    const stats = documentObject.createElement('div');
    stats.className = 'epic-setup-stats';
    const statItems = [
      ['卷宗篇章', tabEntries.length],
      ['公开世界书', worldbookSnapshot.publicTotal],
      ['主角字段', fieldEntries.length]
    ];
    if (destinyCards.length) statItems.push([`${choiceCounterLabel}候选`, destinyCards.length]);
    statItems.forEach(([label, value]) => {
      const item = documentObject.createElement('span');
      item.append(documentObject.createTextNode(`${label} `));
      const highlight = documentObject.createElement('strong');
      highlight.className = 'highlight';
      highlight.textContent = String(value);
      item.append(highlight);
      stats.append(item);
    });

    const tabHeader = documentObject.createElement('div');
    tabHeader.className = 'epic-setup-tabs-header';
    tabHeader.setAttribute('role', 'tablist');
    tabHeader.setAttribute('aria-label', '开局流程');
    const tabContent = documentObject.createElement('div');
    tabContent.className = 'epic-setup-tabs-content';

    paneDefs.forEach((paneDef, index) => {
      const tabButton = documentObject.createElement('button');
      tabButton.type = 'button';
      tabButton.className = 'epic-tab-btn';
      tabButton.dataset.pane = paneDef.key;
      tabButton.id = `epic-setup-tab-${paneDef.key}`;
      tabButton.setAttribute('role', 'tab');
      tabButton.setAttribute('aria-controls', `epic-setup-pane-${paneDef.key}`);
      const step = documentObject.createElement('span');
      step.className = 'epic-tab-step';
      step.textContent = paneDef.step;
      const label = documentObject.createElement('span');
      label.textContent = paneDef.label;
      tabButton.append(step, label);
      tabButton.addEventListener('click', () => activatePane(paneDef.key));
      tabHeader.append(tabButton);

      const pane = documentObject.createElement('section');
      pane.className = 'epic-tab-pane';
      pane.dataset.pane = paneDef.key;
      pane.id = `epic-setup-pane-${paneDef.key}`;
      pane.setAttribute('role', 'tabpanel');
      pane.setAttribute('aria-labelledby', tabButton.id);
      paneByKey.set(paneDef.key, pane);
      tabContent.append(pane);
    });

    const dossierPane = paneByKey.get('dossier');
    const dossierHeading = documentObject.createElement('div');
    dossierHeading.className = 'epic-pane-heading';
    const dossierTitleWrap = documentObject.createElement('div');
    const dossierEyebrow = documentObject.createElement('span');
    dossierEyebrow.className = 'epic-pane-eyebrow';
    dossierEyebrow.textContent = 'WORLD DOSSIER';
    const dossierTitle = documentObject.createElement('h2');
    dossierTitle.textContent = tpl.subtitle || '世界卷宗';
    const dossierLead = documentObject.createElement('p');
    dossierLead.textContent = tpl.tagline || selectedGenre.hint;
    dossierTitleWrap.append(dossierEyebrow, dossierTitle, dossierLead);
    dossierHeading.append(dossierTitleWrap);

    const dossierGrid = documentObject.createElement('div');
    dossierGrid.className = 'epic-dossier-grid';
    tabEntries.forEach(([key, tab], index) => {
      const section = documentObject.createElement('section');
      section.className = 'epic-dossier-section';
      section.dataset.dossierKey = key;
      const sectionHeader = documentObject.createElement('header');
      const sectionIndex = documentObject.createElement('span');
      sectionIndex.textContent = String(index + 1).padStart(2, '0');
      const sectionTitle = documentObject.createElement('h2');
      sectionTitle.textContent = tab?.label || key;
      sectionHeader.append(sectionIndex, sectionTitle);
      section.append(sectionHeader);
      appendDossierContent(section, tab?.content);
      dossierGrid.append(section);
    });

    const worldbookBand = documentObject.createElement('section');
    worldbookBand.className = 'epic-dossier-worldbook';
    const worldbookHeading = documentObject.createElement('header');
    const worldbookTitle = documentObject.createElement('h2');
    worldbookTitle.textContent = '当前载入世界书';
    const worldbookCount = documentObject.createElement('span');
    worldbookCount.textContent = `公开 ${worldbookSnapshot.publicTotal} · 隐藏 ${worldbookSnapshot.hiddenTotal}`;
    worldbookHeading.append(worldbookTitle, worldbookCount);
    const worldbookList = documentObject.createElement('ul');
    if (worldbookSnapshot.entries.length) {
      worldbookSnapshot.entries.forEach((entry) => {
        const item = documentObject.createElement('li');
        const itemHeader = documentObject.createElement('div');
        const itemTitle = documentObject.createElement('strong');
        itemTitle.textContent = entry.title;
        const itemMeta = documentObject.createElement('span');
        itemMeta.textContent = `${entry.type}${entry.constant ? ' · 常驻' : ''} · Depth ${entry.depth}`;
        itemHeader.append(itemTitle, itemMeta);
        const itemContent = documentObject.createElement('p');
        itemContent.textContent = entry.content || '暂无公开内容。';
        item.append(itemHeader, itemContent);
        worldbookList.append(item);
      });
    } else {
      const item = documentObject.createElement('li');
      item.textContent = worldbookSnapshot.total ? '当前条目均处于 GM 隐藏层。' : '当前未载入世界书条目。';
      worldbookList.append(item);
    }
    worldbookBand.append(worldbookHeading, worldbookList);

    const rawCard = state.config?.characterCard || {};
    const cardGreetings = Array.isArray(tpl.alternateGreetings) && tpl.alternateGreetings.length
      ? tpl.alternateGreetings
      : (Array.isArray(rawCard.alternateGreetings) && rawCard.alternateGreetings.length
          ? rawCard.alternateGreetings
          : (Array.isArray(rawCard.alternate_greetings) ? rawCard.alternate_greetings : []));
    const allGreetings = [
      tpl.first_mes || rawCard.firstMessage || rawCard.first_mes || '',
      ...cardGreetings
    ].filter(Boolean);
    let selectedGreetingText = allGreetings[0] || '';

    if (allGreetings.length > 1) {
      const greetingsBand = documentObject.createElement('section');
      greetingsBand.className = 'epic-dossier-greetings';
      const gHead = documentObject.createElement('header');
      const gTitle = documentObject.createElement('h2');
      gTitle.textContent = '备选开场切入点';
      const gCount = documentObject.createElement('span');
      gCount.textContent = `共 ${allGreetings.length} 幕可选`;
      gHead.append(gTitle, gCount);
      const gGrid = documentObject.createElement('div');
      gGrid.className = 'epic-greetings-grid';
      allGreetings.forEach((greeting, gIndex) => {
        const gCard = documentObject.createElement('button');
        gCard.type = 'button';
        gCard.className = `epic-greeting-card${gIndex === 0 ? ' is-selected' : ''}`;
        const b = documentObject.createElement('strong');
        b.textContent = gIndex === 0 ? '默认主开场' : `切入分支 ${gIndex}`;
        const p = documentObject.createElement('p');
        p.textContent = greeting.slice(0, 150) + (greeting.length > 150 ? '…' : '');
        gCard.append(b, p);
        gCard.addEventListener('click', () => {
          selectedGreetingText = greeting;
          gGrid.querySelectorAll('.epic-greeting-card').forEach((c) => c.classList.remove('is-selected'));
          gCard.classList.add('is-selected');
        });
        gGrid.append(gCard);
      });
      greetingsBand.append(gHead, gGrid);
      dossierPane.append(dossierHeading, dossierGrid, worldbookBand, greetingsBand);
    } else {
      dossierPane.append(dossierHeading, dossierGrid, worldbookBand);
    }

    const protagonistPane = paneByKey.get('protagonist');
    const protagonistHeading = documentObject.createElement('div');
    protagonistHeading.className = 'epic-pane-heading';
    const protagonistTitleWrap = documentObject.createElement('div');
    const protagonistEyebrow = documentObject.createElement('span');
    protagonistEyebrow.className = 'epic-pane-eyebrow';
    protagonistEyebrow.textContent = 'PROTAGONIST DOSSIER';
    const protagonistTitle = documentObject.createElement('h2');
    protagonistTitle.textContent = customOpening ? '主角资料' : '主角塑成';
    const protagonistLead = documentObject.createElement('p');
    protagonistLead.textContent = customOpening
      ? `${tpl.protagonist?.label || '资料来自当前角色卡与世界书'} · ${fieldEntries.length} 项`
      : `${selectedGenre.title} · ${fieldEntries.length} 项剧本锚点`;
    protagonistTitleWrap.append(protagonistEyebrow, protagonistTitle, protagonistLead);
    protagonistHeading.append(protagonistTitleWrap);
    if (randomizableFieldEntries.length) {
      const randomButton = documentObject.createElement('button');
      randomButton.type = 'button';
      randomButton.className = 'epic-secondary-btn epic-random-all';
      randomButton.textContent = customOpening ? '骰 换一组卡内候选' : '骰 随机生成主角';
      randomButton.addEventListener('click', fillRandomFields);
      protagonistHeading.append(randomButton);
    } else if (customOpening) {
      const sourceBadge = documentObject.createElement('span');
      sourceBadge.className = 'epic-destiny-counter';
      sourceBadge.textContent = '角色卡已定义';
      protagonistHeading.append(sourceBadge);
    }

    const grid = documentObject.createElement('div');
    grid.className = 'epic-form-grid';
    if (fieldEntries.length) {
      fieldEntries.forEach(([key, field]) => {
        const row = documentObject.createElement('div');
        row.className = 'epic-form-row';
        const label = documentObject.createElement('label');
        label.setAttribute('for', `setup-${key}`);
        label.textContent = field?.label || key;
        const wrap = documentObject.createElement('div');
        wrap.className = 'epic-input-wrap';
        const input = documentObject.createElement('input');
        input.id = `setup-${key}`;
        input.type = 'text';
        input.dataset.setupField = key;
        input.placeholder = field?.placeholder || '';
        input.autocomplete = 'off';
        const fieldDefault = String(field?.defaultValue || '').trim();
        if (fieldDefault) {
          input.value = fieldDefault;
        } else if (/^name$/i.test(key) && state.config?.characterCard?.name) {
          input.value = state.config.characterCard.name;
        } else if (/^role$/i.test(key) && state.config?.characterCard?.role) {
          input.value = state.config.characterCard.role;
        }
        input.addEventListener('input', updateSelectionSummary);
        inputByKey.set(key, input);
        wrap.append(input);
        if (canRandomizeSetupField(field, { allowSystemFallback: allowSystemRandom })) {
          const rollButton = documentObject.createElement('button');
          rollButton.type = 'button';
          rollButton.className = 'epic-roll-btn';
          rollButton.textContent = '骰';
          rollButton.setAttribute('aria-label', `随机生成${field?.label || key}`);
          rollButton.title = customOpening ? `从角色卡候选中更换${field?.label || key}` : `随机生成${field?.label || key}`;
          rollButton.addEventListener('click', () => {
            input.value = generateSetupFieldValue(
              setupGenre,
              key,
              field,
              getSetupRandomContext(inputByKey),
              { allowSystemFallback: allowSystemRandom }
            );
            updateSelectionSummary();
            input.focus();
          });
          wrap.append(rollButton);
        }
        row.append(label, wrap);
        grid.append(row);
      });
    } else {
      const empty = documentObject.createElement('p');
      empty.className = 'epic-text-content';
      empty.textContent = '当前模板还没有配置主角字段。';
      grid.append(empty);
    }
    const protagonistPortrait = createCharacterPortraitImage(
      state.config?.characterCard,
      'epic-protagonist-portrait',
      state.config?.characterCard?.name
    );
    if (protagonistPortrait) {
      const protagonistLayout = documentObject.createElement('div');
      protagonistLayout.className = 'epic-protagonist-layout';
      const portraitPanel = documentObject.createElement('aside');
      portraitPanel.className = 'epic-protagonist-portrait-panel';
      const portraitCaption = documentObject.createElement('span');
      portraitCaption.textContent = state.config?.characterCard?.name || '当前角色';
      portraitPanel.append(protagonistPortrait, portraitCaption);
      protagonistLayout.append(portraitPanel, grid);
      protagonistPane.append(protagonistHeading, protagonistLayout);
    } else {
      protagonistPane.append(protagonistHeading, grid);
    }

    const destinyPane = paneByKey.get('destiny');
    if (destinyPane) {
      const destinyHeading = documentObject.createElement('div');
      destinyHeading.className = 'epic-pane-heading';
      const destinyTitleWrap = documentObject.createElement('div');
      const destinyEyebrow = documentObject.createElement('span');
      destinyEyebrow.className = 'epic-pane-eyebrow';
      destinyEyebrow.textContent = customOpening ? 'OPENING ELEMENTS' : 'FATE DOSSIER';
      const destinyTitle = documentObject.createElement('h2');
      destinyTitle.textContent = tpl.destinyCards?.label || choiceStepLabel;
      const destinyHint = documentObject.createElement('p');
      destinyHint.textContent = tpl.destinyCards?.hint || `${choiceCounterLabel}会写入开局设定。`;
      destinyTitleWrap.append(destinyEyebrow, destinyTitle, destinyHint);
      destinyCounter = documentObject.createElement('span');
      destinyCounter.className = 'epic-destiny-counter';
      destinyHeading.append(destinyTitleWrap, destinyCounter);
      const destinyGrid = documentObject.createElement('div');
      destinyGrid.className = 'epic-destiny-grid';
      destinyCards.forEach((card) => {
        const label = documentObject.createElement('label');
        label.className = 'epic-destiny-card';
        const checkbox = documentObject.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = card.id || card.title || '';
        checkbox.checked = Boolean(card.defaultSelected);
        checkbox.dataset.destinyCard = card.id || card.title || '';
        checkbox.dataset.cardTitle = card.title || card.id || '';
        checkbox.dataset.cardContent = card.content || '';
        checkbox.addEventListener('change', () => {
          if (checkbox.checked && collectSelectedDestinyCards().length > maxDestinySelections) {
            checkbox.checked = false;
            destinyCounter.classList.add('is-limit');
            windowObject.setTimeout(() => destinyCounter.classList.remove('is-limit'), 900);
          }
          updateSelectionSummary();
        });
        const cardBody = documentObject.createElement('span');
        cardBody.className = 'epic-destiny-card-body';
        const cardTitle = documentObject.createElement('strong');
        cardTitle.textContent = card.title || card.id || `未命名${choiceCounterLabel}`;
        const cardContent = documentObject.createElement('span');
        cardContent.textContent = card.content || '';
        cardBody.append(cardTitle, cardContent);
        label.append(checkbox, cardBody);
        destinyGrid.append(label);
      });
      destinyPane.append(destinyHeading, destinyGrid);
    }

    const footer = documentObject.createElement('footer');
    footer.className = 'epic-setup-footer';
    const footerStatus = documentObject.createElement('div');
    footerStatus.className = 'epic-setup-footer-status';
    progressLabel = documentObject.createElement('strong');
    selectionSummary = documentObject.createElement('span');
    footerStatus.append(progressLabel, selectionSummary);
    const footerActions = documentObject.createElement('div');
    footerActions.className = 'epic-setup-footer-actions';
    const cancelButton = documentObject.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'epic-secondary-btn';
    cancelButton.textContent = '返回创作台';
    cancelButton.addEventListener('click', closePanel);
    previousButton = documentObject.createElement('button');
    previousButton.type = 'button';
    previousButton.className = 'epic-secondary-btn';
    previousButton.textContent = '← 上一步';
    previousButton.addEventListener('click', () => movePane(-1));
    nextButton = documentObject.createElement('button');
    nextButton.type = 'button';
    nextButton.className = 'epic-secondary-btn epic-next-btn';
    nextButton.textContent = '下一步 →';
    nextButton.addEventListener('click', () => movePane(1));
    sealButton = documentObject.createElement('button');
    sealButton.type = 'button';
    sealButton.className = 'epic-start-btn epic-seal-btn';
    const sealTitle = documentObject.createElement('span');
    sealTitle.className = 'epic-seal-title';
    sealTitle.textContent = tpl.buttonText || '[ 封存卷轴 · 开启征途 ]';
    const sealHint = documentObject.createElement('small');
    sealHint.className = 'epic-seal-hint';
    sealHint.textContent = '开始剧情';
    sealButton.append(sealTitle, sealHint);
    sealButton.addEventListener('click', finishJourney);
    footerActions.append(cancelButton, previousButton, nextButton, sealButton);
    footer.append(footerStatus, footerActions);

    function collectFormData() {
      const formData = {};
      inputByKey.forEach((input, key) => {
        const value = input.value.trim();
        if (value) formData[key] = value;
      });
      if (selectedGreetingText) formData.selectedGreeting = selectedGreetingText;
      return formData;
    }

    function collectSelectedDestinyCards() {
      return Array.from(overlay.querySelectorAll('[data-destiny-card]:checked')).map((input) => ({
        id: input.value,
        title: input.dataset.cardTitle || input.value,
        content: input.dataset.cardContent || ''
      }));
    }

    function fillRandomFields() {
      randomizableFieldEntries.forEach(([key, field]) => {
        const input = inputByKey.get(key);
        if (!input) return;
        input.value = generateSetupFieldValue(
          setupGenre,
          key,
          field,
          getSetupRandomContext(inputByKey),
          { allowSystemFallback: allowSystemRandom }
        );
      });
      updateSelectionSummary();
    }

    function updateSelectionSummary() {
      const formData = collectFormData();
      const filledCount = Object.keys(formData).length;
      const selectedDestiny = collectSelectedDestinyCards().length;
      const protagonistName = formData.name || state.config?.characterCard?.name || '未命名主角';
      if (selectionSummary) {
        const choiceSummary = destinyCards.length
          ? ` · ${choiceCounterLabel} ${selectedDestiny}/${maxDestinySelections}`
          : '';
        selectionSummary.textContent = `${protagonistName} · 人物 ${filledCount}/${fieldEntries.length}${choiceSummary}`;
      }
      if (destinyCounter) destinyCounter.textContent = `已选 ${selectedDestiny}/${maxDestinySelections}`;
    }

    function activatePane(key) {
      const index = paneDefs.findIndex((pane) => pane.key === key);
      if (index < 0) return;
      activePaneKey = key;
      modal.querySelectorAll('.epic-tab-btn').forEach((button) => {
        const active = button.dataset.pane === key;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', String(active));
        button.tabIndex = active ? 0 : -1;
      });
      modal.querySelectorAll('.epic-tab-pane').forEach((pane) => {
        const active = pane.dataset.pane === key;
        pane.classList.toggle('active', active);
        pane.hidden = !active;
      });
      if (progressLabel) progressLabel.textContent = `${String(index + 1).padStart(2, '0')} / ${String(paneDefs.length).padStart(2, '0')} · ${paneDefs[index].label}`;
      if (previousButton) previousButton.hidden = index === 0;
      if (nextButton) nextButton.hidden = index === paneDefs.length - 1;
      if (sealButton) sealButton.hidden = index !== paneDefs.length - 1;
      if (key === 'protagonist') {
        windowObject.requestAnimationFrame(() => overlay.querySelector('[data-setup-field]')?.focus());
      }
      tabContent.scrollTop = 0;
    }

    function movePane(direction) {
      const index = paneDefs.findIndex((pane) => pane.key === activePaneKey);
      const nextIndex = Math.min(paneDefs.length - 1, Math.max(0, index + direction));
      activatePane(paneDefs[nextIndex].key);
    }

    async function finishJourney() {
      if (!Object.keys(collectFormData()).length && randomizableFieldEntries.length) fillRandomFields();
      const formData = collectFormData();
      const destiny = collectSelectedDestinyCards();
      closePanel();
      await startJourney(formData, tpl, destiny, { autoSend: true });
    }

    function closePanel() {
      documentObject.removeEventListener('keydown', handleKeydown);
      overlay.remove();
    }

    function handleKeydown(event) {
      if (event.key === 'Escape') closePanel();
    }

    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) closePanel();
    });
    modal.append(header, stats, tabHeader, tabContent, footer);
    overlay.append(modal);
    documentObject.body.append(overlay);
    documentObject.addEventListener('keydown', handleKeydown);
    updateSelectionSummary();
    activatePane('dossier');
    tabHeader.querySelector('.epic-tab-btn')?.focus();
  }

  return {
    renderSetupPanel
  };
}
