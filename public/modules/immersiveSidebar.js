import {
  cleanImmersiveSidebarText,
  findImmersiveStatusValue,
  getCustomOpeningProtagonistSnapshot,
  inferStatusField,
  inferStatusProtagonistName,
  mergeImmersiveFacts,
  parseImmersiveStatusFields,
  resolveLatestRoleplayPanels,
  splitDirectorNoteSections,
  toImmersiveWorldBookRecord
} from './immersiveDossier.js';
import { buildImmersiveCharacterGroups } from './relationshipGraph.js';
import { appendImmersiveCharacterArchiveActions } from './immersiveCharacterArchiveActions.js';
import { appendImmersiveCharacterGroup } from './immersiveCharacterRoster.js';
import {
  excludeImmersiveStructuredWorldBookEntries,
  getImmersiveWorldSystemGroups
} from './immersiveWorldRules.js';
export const DEFAULT_INTERACTION_TABS = Object.freeze([
  '当前态势',
  '决策线索',
  '角色档案',
  '人物网络',
  '成长轨迹',
  '叙事记忆',
  '世界规则'
]);
const INTERACTION_TAB_ALIASES = Object.freeze([
  ['当前态势', /当前态势|场景态势|当前局势|局势|状态/],
  ['决策线索', /线索|榜单|传闻|清单|账目|证据|任务|事件|进度|倒计时|风向|节点/],
  ['角色档案', /互动角色|人物档案|角色档案|角色列表|登场人物/],
  ['人物网络', /人物网络|人物关系|关系与势力|关系图|势力|旧账关系/],
  ['成长轨迹', /主角|调查者|文书|神府造化|神机造化|造化|秘籍|武学|修为|功法|资源|装备|成长/],
  ['叙事记忆', /梦入神机|梦如神机|记忆|回忆|纪事/],
  ['世界规则', /世界规则|禁忌规则|规则/]
]);
export function normalizeImmersiveInteractionTab(label) {
  const value = String(label || '').trim();
  if (!value) return '';
  return INTERACTION_TAB_ALIASES.find(([, pattern]) => pattern.test(value))?.[0] || value;
}

export function extractCharacterPanelExcerpt(value, name) {
  const normalized = String(value || '')
    .replace(/<\/?[A-Za-z][^>]*>/g, '')
    .replace(/^\s*#{1,6}\s*/gm, '')
    .replace(/\*\*/g, '');
  const escapedName = String(name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const statusMarker = new RegExp(`[『【\\[]${escapedName}(?:[·\\s]*(?:(?:主角|角色)[·\\s]*)?(?:状态|档案))[』】\\]]`);
  const statusMatch = normalized.match(statusMarker);
  if (statusMatch?.index !== undefined) {
    const contentStart = statusMatch.index + statusMatch[0].length;
    const remainder = normalized.slice(contentStart);
    const nextMarker = remainder.search(/^[『【\[][^\n『』【】[\]]+(?:[·\s]*(?:(?:主角|角色)[·\s]*)?(?:状态|档案))[』】\]]/m);
    const statusBlock = nextMarker >= 0 ? remainder.slice(0, nextMarker) : remainder;
    return `${statusMatch[0]}\n${statusBlock}`.trim().slice(0, 900);
  }

  const plainText = normalized.replace(/\s+/g, ' ').trim();
  const index = plainText.indexOf(name);
  if (index < 0) return '';
  const nextCharacter = plainText.indexOf('当前角色「', index + name.length);
  const end = nextCharacter > index ? nextCharacter : index + 280;
  return plainText.slice(index, end).trim().slice(0, 280);
}

export function createImmersiveSidebarController({
  state = {},
  els = {},
  dossier = {},
  ledgers = {},
  resolvePrologueTemplate = () => ({ genre: '', tpl: {} }),
  getCurrentStoryPresentation = () => ({ title: '当前剧本' }),
  getLightFrontendPanels = () => [],
  resolveLightFrontendPanel = (panel) => panel,
  getLightFrontendContext = () => ({}),
  renderSafeMarkdown = (value) => String(value || ''),
  splitCharacterStatus = () => ({ protagonist: '', interactive: '' }),
  extractRoleplayPresentation = () => ({ content: '', panels: {} }),
  createCharacterPortraitImage = () => null,
  getCharacterPortraitUrl = () => '',
  openCharacterManagement = () => {},
  truncateText = (value) => String(value || ''),
  documentObject = globalThis.document
} = {}) {
  const {
    appendImmersiveDossierEmpty = () => {},
    appendImmersiveFactGrid = () => {},
    appendImmersiveLedgerSection = () => {},
    createImmersiveDossier = () => ({ root: null, body: null })
  } = dossier;
  const {
    renderImmersiveIntelligenceLedger = () => {},
    renderImmersiveRelationshipLedger = () => {},
    renderImmersiveMemoryLedger = () => {},
    renderImmersiveGrowthLedger = () => {},
    renderImmersiveProgressLedger = () => {},
    renderImmersiveSituationLedger = () => {}
  } = ledgers;

  const getLatestPanels = () => resolveLatestRoleplayPanels(
    Array.isArray(state.session?.messages) ? state.session.messages : [],
    extractRoleplayPresentation,
    state.session?.turnViewSnapshot
  );

  function bindEvents() {
    els.immersiveSidebarClose?.addEventListener('click', closeImmersiveSidebar);
    els.immersiveSidebarTabs?.addEventListener('click', (event) => {
      const tabButton = event.target.closest('[data-immersive-tab]');
      if (tabButton) selectImmersiveSidebarTab(tabButton.dataset.immersiveTab);
    });
    els.immersiveSidebarBody?.addEventListener?.('click', (event) => {
      const action = event.target?.closest?.('[data-immersive-character-action]');
      if (!action) return;
      if (action.dataset.immersiveCharacterAction === 'open-archive') {
        selectImmersiveSidebarTab('角色档案');
      } else if (action.dataset.immersiveCharacterAction === 'manage') {
        openCharacterManagement();
      }
    });
  }

  function renderImmersiveSidebar() {
    if (!els.immersiveRightSidebar || !els.immersiveSidebarTabs) return;
    const { genre, tpl } = resolvePrologueTemplate();
    const sidebar = tpl?.sidebar || {};
    const builtInTabs = Array.isArray(sidebar.tabs) ? sidebar.tabs.filter(Boolean) : [];
    const latestPanels = getLatestPanels();
    const lightPanels = getLightFrontendPanels(state.config?.lightFrontend)
      .map((panel) => resolveLightFrontendPanel(panel, getLightFrontendContext()))
      .filter(Boolean);
    const tabs = [...new Set([
      ...DEFAULT_INTERACTION_TABS,
      ...builtInTabs.map(normalizeImmersiveInteractionTab).filter(Boolean),
      ...(latestPanels.directorNotes ? ['导演注记'] : []),
      ...lightPanels.map((panel) => panel.title).filter((title) => title && !builtInTabs.includes(title))
    ])];

    if (!tabs.length) {
      els.immersiveRightSidebar.classList.add('hidden');
      return;
    }

    if (state.immersiveSidebarTab) {
      const normalizedTab = normalizeImmersiveInteractionTab(state.immersiveSidebarTab);
      state.immersiveSidebarTab = tabs.includes(normalizedTab) ? normalizedTab : '';
    }

    els.immersiveRightSidebar.classList.remove('hidden');
    els.immersiveRightSidebar.classList.add('reader-rail-managed');
    els.immersiveSidebarTabs.innerHTML = '';
    tabs.forEach((label) => {
      const button = documentObject.createElement('button');
      button.type = 'button';
      button.className = `immersive-sidebar-tab${label === state.immersiveSidebarTab ? ' active' : ''}`;
      button.dataset.immersiveTab = label;
      button.textContent = label;
      button.title = label;
      button.setAttribute('aria-pressed', String(label === state.immersiveSidebarTab));
      els.immersiveSidebarTabs.append(button);
    });

    const expanded = Boolean(state.immersiveSidebarTab);
    els.immersiveRightSidebar.classList.toggle('expanded', expanded);
    els.immersiveSidebarContent?.classList.toggle('hidden', !expanded);
    if (!expanded) return;

    els.immersiveSidebarTitle.textContent = state.immersiveSidebarTab;
    const lightPanel = lightPanels.find((panel) => panel.title === state.immersiveSidebarTab);
    if (lightPanel) {
      renderImmersiveCommunityPanel(lightPanel);
      return;
    }
    if (state.immersiveSidebarTab === '叙事记忆') {
      renderImmersiveMemoryLedger(state.immersiveSidebarTab, genre);
      return;
    }
    if (state.immersiveSidebarTab === '成长轨迹') {
      renderImmersiveGrowthLedger(state.immersiveSidebarTab, tpl, genre);
      return;
    }
    if (state.immersiveSidebarTab === '世界规则') {
      renderImmersiveWorldRules(state.immersiveSidebarTab, tpl, genre);
      return;
    }
    if (/导演注记|模型注记|叙事依据/.test(state.immersiveSidebarTab)) {
      renderImmersiveDirectorNotes(latestPanels.directorNotes);
      return;
    }
    if (state.immersiveSidebarTab === '角色档案') {
      renderImmersiveCharacterCards(tpl);
      return;
    }
    if (state.immersiveSidebarTab === '人物网络') {
      renderImmersiveRelationshipLedger(state.immersiveSidebarTab, tpl, genre);
      return;
    }
    if (state.immersiveSidebarTab === '当前态势') {
      renderImmersiveSituationLedger(state.immersiveSidebarTab, tpl, genre);
      return;
    }
    if (state.immersiveSidebarTab === '决策线索') {
      renderImmersiveIntelligenceLedger(state.immersiveSidebarTab, tpl, genre);
      return;
    }
    els.immersiveSidebarBody.innerHTML = renderSafeMarkdown(
      buildImmersiveSidebarText(state.immersiveSidebarTab, tpl, genre)
    );
  }

  function renderImmersiveDirectorNotes(value) {
    const source = String(value || '').trim();
    els.immersiveSidebarBody.innerHTML = '';
    if (!source) {
      els.immersiveSidebarBody.innerHTML = '<div class="immersive-sidebar-empty">当前回复没有可审阅的导演注记。</div>';
      return;
    }

    const intro = documentObject.createElement('div');
    intro.className = 'immersive-sidebar-note';
    intro.innerHTML = '<h4>生成记录</h4><p>模型主动输出的规划与控制块已从故事正文分离。内容默认收起，仅供创作者按需审阅；其中的 HTML、CSS 或脚本不会在这里执行。</p>';
    els.immersiveSidebarBody.append(intro);

    splitDirectorNoteSections(source).forEach((section, index) => {
      const details = documentObject.createElement('details');
      details.className = 'immersive-ledger-section immersive-director-note';
      const summary = documentObject.createElement('summary');
      summary.textContent = section.title;
      const content = documentObject.createElement('div');
      content.className = 'immersive-director-note-content';
      content.innerHTML = renderSafeMarkdown(section.content);
      details.append(summary, content);
      els.immersiveSidebarBody.append(details);
    });
  }

  function renderImmersiveCommunityPanel(panel) {
    if (!els.immersiveSidebarBody || !panel) return;
    const view = createImmersiveDossier({
      kind: 'community',
      eyebrow: panel.subtitle || '社区轻前端 · 声明式面板',
      title: panel.title || '社区面板',
      summary: panel.summary || '这个面板由导入素材的安全声明式配置生成。',
      metrics: [
        ['字段', panel.fields?.length || 0],
        ['条目', panel.items?.length || 0],
        ['说明', panel.content ? 1 : 0]
      ]
    });
    view.root.classList.add(`is-${panel.tone || 'default'}`);

    if (panel.fields?.length) {
      appendImmersiveFactGrid(
        view.body,
        panel.fields.map((field) => ({ label: field.label, value: field.value })),
        'immersive-progress-facts community-panel-fields'
      );
    }
    if (panel.items?.length) {
      appendImmersiveLedgerSection(view.body, '当前条目', panel.items, {
        numbered: true,
        tone: panel.tone === 'default' ? '' : panel.tone
      });
    }
    if (panel.content) {
      const section = documentObject.createElement('section');
      section.className = 'immersive-community-prose';
      const heading = documentObject.createElement('h4');
      heading.textContent = '面板说明';
      const body = documentObject.createElement('div');
      body.innerHTML = renderSafeMarkdown(panel.content);
      section.append(heading, body);
      view.body.append(section);
    }
    appendImmersiveDossierEmpty(view.body, '暂无可显示的社区面板数据。');
    els.immersiveSidebarBody.replaceChildren(view.root);
  }

  function renderImmersiveWorldRules(label, tpl, genre) {
    if (!els.immersiveSidebarBody) return;
    const presentation = getCurrentStoryPresentation(tpl, genre);
    const systems = state.session?.memory?.simulation?.systems || {};
    const systemGroups = getImmersiveWorldSystemGroups(systems, truncateText);
    const structuredCount = systemGroups.reduce((sum, group) => sum + group.items.length, 0);
    const entries = (Array.isArray(state.config?.worldBook) ? state.config.worldBook : [])
      .filter((entry) => entry && entry.enabled !== false)
      .filter((entry) => {
        const visibility = entry?.extensions?.visibility || entry?.visibility || 'player';
        return visibility !== 'gm' && entry?.extensions?.gmOnly !== true;
      })
      .sort((left, right) => {
        const constantDiff = Number(Boolean(right.constant)) - Number(Boolean(left.constant));
        if (constantDiff) return constantDiff;
        return Number(right.priority ?? 50) - Number(left.priority ?? 50);
      });
    const unstructuredEntries = excludeImmersiveStructuredWorldBookEntries(entries, systemGroups);
    const constantRules = unstructuredEntries.filter((entry) => entry.constant).slice(0, 8);
    const triggeredRules = unstructuredEntries.filter((entry) => !entry.constant).slice(0, 8);
    const view = createImmersiveDossier({
      kind: 'world-rules',
      eyebrow: `${presentation.title} · 当前剧本`,
      title: label,
      summary: presentation.pack?.description
        || tpl?.tagline
        || '这里只展示当前剧本实际载入的世界书，不使用阅读模式对应的题材占位。',
      metrics: [
        ['世界书', entries.length],
        ['常驻', entries.filter((entry) => entry.constant).length],
        ['触发', entries.filter((entry) => !entry.constant).length],
        ['结构化', structuredCount]
      ]
    });

    systemGroups.forEach((group) => {
      appendImmersiveLedgerSection(view.body, group.title, group.items, {
        numbered: true,
        tone: group.tone || ''
      });
    });
    appendImmersiveLedgerSection(
      view.body,
      '常驻规则',
      constantRules.map((entry) => toImmersiveWorldBookRecord(entry, truncateText)),
      { numbered: true, tone: 'active' }
    );
    appendImmersiveLedgerSection(
      view.body,
      '按情境触发',
      triggeredRules.map((entry) => toImmersiveWorldBookRecord(entry, truncateText)),
      { numbered: true }
    );
    appendImmersiveDossierEmpty(view.body, '当前剧本尚未载入可公开展示的世界书。');
    els.immersiveSidebarBody.replaceChildren(view.root);
  }

  function renderImmersiveProtagonistCard(genre) {
    if (!els.immersiveSidebarBody) return;
    const { tpl } = resolvePrologueTemplate();
    const presentation = getCurrentStoryPresentation(tpl, genre);
    const opening = getCustomOpeningProtagonistSnapshot(tpl);
    const character = state.config?.characterCard || {};
    const memory = state.session?.memory || {};
    const worldState = memory.worldState || {};
    const panels = getLatestPanels();
    const statusName = inferStatusProtagonistName(panels.characterStatus);
    const protagonistName = statusName || opening.name || worldState.protagonist?.name || character.name || '未命名主角';
    const protagonistNames = [protagonistName, character.name, worldState.protagonist?.name].filter(Boolean);
    const status = splitCharacterStatus(panels.characterStatus, protagonistNames).protagonist;
    const statusFields = parseImmersiveStatusFields(status);
    const explicitRole = character.role && character.role !== character.creator ? character.role : '';
    const identity = findImmersiveStatusValue(statusFields, ['身份', '身份/境界', '境界'])
      || opening.role
      || explicitRole
      || worldState.protagonist?.realm
      || '身份待定';

    els.immersiveSidebarBody.innerHTML = '';
    const profile = documentObject.createElement('article');
    profile.className = 'immersive-protagonist-card';
    const hero = documentObject.createElement('header');
    hero.className = 'immersive-protagonist-hero';
    const portrait = opening.scenarioRole
      ? null
      : createCharacterPortraitImage(character, 'immersive-protagonist-portrait', protagonistName);
    if (portrait) {
      hero.append(portrait);
    } else {
      const monogram = documentObject.createElement('div');
      monogram.className = 'immersive-protagonist-monogram';
      monogram.textContent = protagonistName.slice(0, 1);
      hero.append(monogram);
    }

    const heading = documentObject.createElement('div');
    heading.className = 'immersive-protagonist-heading';
    const eyebrow = documentObject.createElement('span');
    eyebrow.textContent = `${presentation.title} · 主角档案`;
    const name = documentObject.createElement('h3');
    name.textContent = protagonistName;
    const role = documentObject.createElement('p');
    role.textContent = identity;
    heading.append(eyebrow, name, role);
    hero.append(heading);
    profile.append(hero);

    const facts = mergeImmersiveFacts([
      ['身份', identity],
      ['性格', opening.personality || character.personality || worldState.protagonist?.traits],
      ['当前目标', opening.goal],
      ['关系模式', opening.relationshipStyle],
      ['当前地点', worldState.location?.current || findImmersiveStatusValue(statusFields, ['地点'])],
      ['随身物品', worldState.inventory || findImmersiveStatusValue(statusFields, ['拥有物品', '物品栏', '物品'])],
      ...statusFields.map(({ label, value }) => [label, value])
    ], 12);
    appendImmersiveFactGrid(profile, facts, 'immersive-protagonist-facts');

    const description = cleanImmersiveSidebarText(character.description);
    if (description) appendImmersiveProfileSection(profile, opening.scenarioRole ? '剧本说明' : '人物说明', description);
    const scenario = cleanImmersiveSidebarText(character.scenario);
    if (scenario) appendImmersiveProfileSection(profile, '关系与处境', scenario);
    if (panels.sceneStatus) appendImmersiveProfileSection(profile, '本幕坐标', cleanImmersiveSidebarText(panels.sceneStatus));
    els.immersiveSidebarBody.append(profile);
  }

  function renderImmersiveCharacterCards(tpl) {
    if (!els.immersiveSidebarBody) return;
    const panels = getLatestPanels();
    const protagonistNames = [
      inferStatusProtagonistName(panels.characterStatus),
      state.session?.memory?.worldState?.protagonist?.name,
      state.config?.characterCard?.name
    ].filter(Boolean);
    const characterPanels = splitCharacterStatus(panels.characterStatus, protagonistNames);
    const castTab = Object.values(tpl?.tabs || {}).find((tab) => /互动|角色/.test(tab?.label || ''));
    const groups = buildImmersiveCharacterGroups({
      configured: state.config?.groupMembers,
      protagonistNames,
      registry: state.session?.memory?.characterRegistry,
      characterCard: state.config?.characterCard,
      worldState: state.session?.memory?.worldState
    });
    els.immersiveSidebarBody.innerHTML = '';
    const roster = documentObject.createElement('div');
    roster.className = 'immersive-character-roster';
    appendImmersiveCharacterGroup(roster, {
      kind: 'protagonist',
      title: '主角',
      hint: '由当前剧本与会话状态共同确定。',
      members: groups.protagonist,
      empty: '当前剧本尚未确定主角。'
    }, { documentObject, createCharacterCard: createImmersiveCharacterCard });
    appendImmersiveCharacterGroup(roster, {
      kind: 'current-act',
      title: '当前幕角色',
      hint: '只显示本轮场景中已在场、提及或待进入本幕的角色。',
      members: groups.currentAct,
      empty: '本幕尚未登记其他角色。'
    }, {
      documentObject,
      createCharacterCard: createImmersiveCharacterCard,
      resolveCard: (member) => ({
        status: extractCharacterPanelExcerpt(characterPanels.interactive, member.name),
        relationship: member.relationship || extractCharacterPanelExcerpt(panels.relationshipStatus, member.name)
      })
    });
    appendImmersiveCharacterGroup(roster, {
      kind: 'declared',
      title: '角色卡与世界书角色',
      hint: '这是当前素材已声明的人物资料；未标注“当前在场”不代表其已经登场。',
      members: groups.declared,
      empty: cleanImmersiveSidebarText(castTab?.content)
        ? '当前素材中尚无可结构化识别的角色资料。'
        : '角色卡或世界书中的人物资料会在素材同步后显示。'
    }, { documentObject, createCharacterCard: createImmersiveCharacterCard });
    els.immersiveSidebarBody.append(roster);
    appendImmersiveCharacterArchiveActions(els.immersiveSidebarBody, groups.currentAct.length + groups.declared.length, { documentObject });
  }
  function createImmersiveCharacterCard(member, { status = '', relationship = '' } = {}) {
    const card = documentObject.createElement('article');
    card.className = 'immersive-character-card';
    const portraitSource = resolveImmersiveCharacterPortrait(member);
    const portrait = createCharacterPortraitImage(portraitSource, 'immersive-character-portrait', member.name);
    if (portrait) {
      card.append(portrait);
    } else {
      const monogram = documentObject.createElement('div');
      monogram.className = 'immersive-character-monogram';
      monogram.textContent = String(member.name || '角').slice(0, 1);
      monogram.setAttribute('aria-label', `${member.name || '角色'}暂无立绘`);
      card.append(monogram);
    }

    const content = documentObject.createElement('div');
    content.className = 'immersive-character-copy';
    const heading = documentObject.createElement('div');
    heading.className = 'immersive-character-heading';

    // Add faction indicator based on relationship text
    const factionIndicator = documentObject.createElement('span');
    factionIndicator.className = 'immersive-faction-indicator';
    const relText = String(relationship || '').toLowerCase();
    if (/敌|仇|杀|反|恶|叛/.test(relText)) {
      factionIndicator.classList.add('is-hostile');
    } else if (/友|盟|喜|爱|亲|忠|善/.test(relText)) {
      factionIndicator.classList.add('is-allied');
    } else {
      factionIndicator.classList.add('is-neutral');
    }

    const name = documentObject.createElement('strong');
    name.textContent = member.name || '未命名角色';
    const role = documentObject.createElement('span');
    role.textContent = member.role || '互动角色';

    heading.append(factionIndicator, name, role);
    content.append(heading);

    const statusFields = parseImmersiveStatusFields(status);
    const facts = mergeImmersiveFacts([
      ['身份', member.role],
      ['本幕', member.actState === 'on-stage' ? '当前在场' : member.actState === 'off-stage' ? '暂未在场' : member.actState === 'mentioned' ? '本幕提及' : member.actState === 'pending' ? '待登场' : ''],
      ['资料来源', member.sourceLabel],
      ['状态', member.rosterStatus],
      ['性格', member.personality],
      ...statusFields.map(({ label, value }) => [label, value])
    ], 7);
    appendImmersiveFactGrid(content, facts, 'immersive-character-facts');

    const description = cleanImmersiveSidebarText(member.description || member.personality);
    if (description) appendImmersiveCharacterDetail(content, '人物', description, 'description');
    const relationshipText = cleanImmersiveSidebarText(relationship);
    if (relationshipText) appendImmersiveCharacterDetail(content, '关系', relationshipText, 'relationship');
    const statusText = cleanImmersiveSidebarText(status);
    if (!statusFields.length && statusText && statusText !== description) {
      appendImmersiveCharacterDetail(content, '本幕', statusText, 'status');
    }
    if ([description, relationshipText, statusText].join(' ').length > 180) {
      const expand = documentObject.createElement('button');
      expand.type = 'button';
      expand.className = 'immersive-character-expand';
      expand.textContent = '+';
      expand.title = '展开人物详情';
      expand.setAttribute('aria-label', `展开${member.name || '角色'}详情`);
      expand.setAttribute('aria-expanded', 'false');
      expand.addEventListener('click', () => {
        const expanded = card.classList.toggle('is-expanded');
        expand.textContent = expanded ? '−' : '+';
        expand.title = expanded ? '收起人物详情' : '展开人物详情';
        expand.setAttribute('aria-expanded', String(expanded));
      });
      content.append(expand);
    }
    card.append(content);
    return card;
  }

  function resolveImmersiveCharacterPortrait(member) {
    if (getCharacterPortraitUrl(member)) return member;
    const name = String(member?.name || '').trim();
    if (!name) return member;
    const activeCharacter = state.config?.characterCard;
    if (activeCharacter?.name === name && getCharacterPortraitUrl(activeCharacter)) return activeCharacter;
    const preset = Object.values(state.contentPackCharacterPresets || {})
      .map((item) => item?.characterCard)
      .find((card) => card?.name === name && getCharacterPortraitUrl(card));
    if (preset) return preset;
    const resource = (Array.isArray(state.resourceLibrary) ? state.resourceLibrary : [])
      .find((item) => item?.kind === 'character'
        && item?.payload?.name === name
        && getCharacterPortraitUrl(item.payload));
    return resource?.payload || member;
  }

  function appendImmersiveCharacterDetail(container, label, value, kind) {
    const block = documentObject.createElement('div');
    block.className = `immersive-character-detail immersive-character-${kind}`;
    const title = documentObject.createElement('span');
    title.textContent = label;
    const text = documentObject.createElement('p');
    text.textContent = value;
    block.append(title, text);
    container.append(block);
  }

  function appendImmersiveProfileSection(container, label, value) {
    if (!value) return;
    const section = documentObject.createElement('section');
    section.className = 'immersive-profile-section';
    const heading = documentObject.createElement('h4');
    heading.textContent = label;
    const body = documentObject.createElement('p');
    body.textContent = value;
    section.append(heading, body);
    container.append(section);
  }

  function appendImmersiveSidebarNote(label, value, kind) {
    const text = cleanImmersiveSidebarText(value);
    if (!text || !els.immersiveSidebarBody) return;
    const note = documentObject.createElement('section');
    note.className = `immersive-sidebar-note immersive-sidebar-note-${kind}`;
    const heading = documentObject.createElement('h4');
    heading.textContent = label;
    const body = documentObject.createElement('p');
    body.textContent = text;
    note.append(heading, body);
    els.immersiveSidebarBody.append(note);
  }

  function selectImmersiveSidebarTab(label) {
    const tab = normalizeImmersiveInteractionTab(label);
    state.immersiveSidebarTab = state.immersiveSidebarTab === tab ? '' : tab;
    renderImmersiveSidebar();
    return Boolean(state.immersiveSidebarTab);
  }

  function closeImmersiveSidebar() {
    state.immersiveSidebarTab = '';
    renderImmersiveSidebar();
  }

  function buildImmersiveSidebarText(label, tpl, genre) {
    const matchedTab = Object.values(tpl?.tabs || {}).find((tab) => tab?.label === label);
    const presentation = getCurrentStoryPresentation(tpl, genre);
    const character = state.config?.characterCard || {};
    const memory = state.session?.memory || {};
    const worldState = memory.worldState || {};
    const enabledWorldBookCount = Array.isArray(state.config?.worldBook)
      ? state.config.worldBook.filter((entry) => entry?.enabled !== false).length
      : 0;
    const facts = Array.isArray(memory.facts) ? memory.facts : [];
    const panels = getLatestPanels();
    const statusProtagonistName = inferStatusProtagonistName(panels.characterStatus);
    const protagonistName = statusProtagonistName || worldState.protagonist?.name || character.name || '未命名主角';
    const protagonistNames = statusProtagonistName
      ? [statusProtagonistName]
      : [worldState.protagonist?.name, character.name].filter(Boolean);
    const characterPanels = splitCharacterStatus(panels.characterStatus, protagonistNames);
    const characterMatchesProtagonist = character.name && character.name === protagonistName;
    const protagonistIdentity = characterMatchesProtagonist
      ? (character.role || inferStatusField(characterPanels.protagonist, ['身份', '武学/修真境界', '境界']))
      : inferStatusField(characterPanels.protagonist, ['身份', '武学/修真境界', '境界']);

    if (/主角|档案|文书|调查者/.test(label)) {
      return [
        '## 主角档案',
        `- **姓名**：${protagonistName}`,
        `- **身份/境界**：${protagonistIdentity || worldState.protagonist?.realm || '见当前状态'}`,
        `- **当前剧本**：${presentation.title}`,
        characterMatchesProtagonist && character.description ? `- **人物说明**：${character.description}` : '',
        characterPanels.protagonist ? `\n## 当前状态\n${characterPanels.protagonist}` : ''
      ].filter(Boolean).join('\n');
    }
    if (/互动|角色/.test(label)) {
      const castTab = Object.values(tpl?.tabs || {}).find((tab) => /互动|角色/.test(tab?.label || ''));
      const members = (Array.isArray(state.config?.groupMembers) ? state.config.groupMembers : [])
        .filter((member) => member?.enabled !== false && member?.name)
        .map((member) => [
          `### ${member.name}`,
          member.role ? `- **身份**：${member.role}` : '',
          member.description ? `- **角色说明**：${member.description}` : '',
          member.relationship ? `- **关系说明**：${member.relationship}` : ''
        ].filter(Boolean).join('\n'));
      return [
        '## 互动角色',
        members.join('\n\n') || castTab?.content || '尚未登记固定互动角色。',
        characterPanels.interactive ? `\n## 本幕角色状态\n${characterPanels.interactive}` : '',
        panels.relationshipStatus ? `\n## 关系变化\n${panels.relationshipStatus}` : '',
        panels.nextCharacter ? `\n## 下一幕建议角色\n${panels.nextCharacter}` : ''
      ].filter(Boolean).join('\n');
    }
    if (/榜|清单|账|证据|造化|梦|传闻|风向|秘籍|状态/.test(label)) {
      return [
        panels.sceneStatus ? `## 当前场景\n${panels.sceneStatus}` : '',
        `【当前剧本】${presentation.title}`,
        `【世界书】已启用 ${enabledWorldBookCount} 条`,
        `【动态事实】${facts.length} 条`,
        worldState.rollingSummary ? `【滚动摘要】${worldState.rollingSummary}` : '【滚动摘要】暂无',
        '可在检查器的状态、事实、世界书中继续审阅和修订。'
      ].join('\n');
    }
    if (matchedTab?.content) return matchedTab.content;
    return [
      `【${label}】`,
      `剧本：${presentation.title}`,
      `世界书：${enabledWorldBookCount} 条`,
      `动态事实：${facts.length} 条`
    ].join('\n');
  }

  return {
    bindEvents,
    closeImmersiveSidebar,
    renderImmersiveSidebar,
    selectImmersiveSidebarTab
  };
}
