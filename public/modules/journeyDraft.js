import { truncateText } from './utils.js';

const EMPTY_WORLDBOOK_SNAPSHOT = Object.freeze({
  total: 0,
  publicTotal: 0,
  hiddenTotal: 0,
  entries: []
});

function getJourneyChoiceLabels(tpl = {}) {
  const customOpening = tpl.source === 'custom-pack';
  return {
    promptTitle: customOpening ? '开局设定' : '命途设定',
    sectionLabel: tpl.destinyCards?.sectionLabel || (customOpening ? '已选开局要素' : '已选天命/危机卡')
  };
}

export function getJourneyTabSummaries(tpl) {
  return Object.values(tpl?.tabs || {})
    .filter((tab) => tab?.label || tab?.content)
    .map((tab) => ({
      label: tab.label || '设定',
      content: tab.content || ''
    }));
}

export function cleanJourneySettingBeat(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\*\*|__|`/g, '')
    .replace(/^[\s\-*>#]+/gm, '')
    .replace(/【[^】]{1,24}】/g, '')
    .replace(/\[[^\]]{1,24}\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstJourneySettingBeat(tab, maxLength = 120) {
  const candidates = String(tab?.content || '')
    .split(/\n+|(?<=[。！？；])\s*/)
    .map(cleanJourneySettingBeat)
    .filter((value) => value.length >= 8);
  return truncateText(candidates[0] || '', maxLength).replace(/[；，、：]+$/g, '');
}

function findJourneyFieldValue(formData, tpl, pattern) {
  const entry = Object.entries(formData || {}).find(([key, value]) => {
    if (!String(value || '').trim()) return false;
    const label = tpl?.fields?.[key]?.label || key;
    return pattern.test(`${key} ${label}`);
  });
  return entry ? String(entry[1]).trim() : '';
}

export function detectJourneyOpeningGenre(tpl) {
  const identity = `${tpl?.title || ''} ${tpl?.subtitle || ''} ${tpl?.tagline || ''}`;
  if (/灵异|夜录|禁忌|命案|鬼|阴阳/.test(identity)) return 'lingyi';
  if (/明末|乱世|饷银|粮道|朝局/.test(identity)) return 'history';
  if (/英雄志|群像|旧账|五朝/.test(identity)) return 'heroic';
  if (/仙境|仙途|飞升|修仙|道统/.test(identity)) return 'xianxia';
  if (/武界|江湖|武道|旧案/.test(identity)) return 'wuxia';
  return 'generic';
}

export function buildJourneyOpeningProse(
  formData,
  tpl,
  destinyCards = [],
  worldbookSnapshot = EMPTY_WORLDBOOK_SNAPSHOT
) {
  const tabs = getJourneyTabSummaries(tpl);
  const worldTab = tabs.find((tab) => /定界|世界|山河|乾坤|星域|五朝|阴阳/.test(tab.label)) || tabs[0];
  const crisisTab = tabs.find((tab) => /危机|卷目|事件|开局/.test(tab.label)) || tabs[1];
  const worldBeat = firstJourneySettingBeat(worldTab, 110);
  const crisisBeat = firstJourneySettingBeat(crisisTab, 120);
  const name = findJourneyFieldValue(formData, tpl, /name|姓名|大名|尊号|道名|称谓|代号/);
  const role = findJourneyFieldValue(formData, tpl, /role|身份|门派|出身|宗门|道统|阵营/);
  const goal = findJourneyFieldValue(formData, tpl, /goal|目标|问道|第一目标/);
  const risk = findJourneyFieldValue(formData, tpl, /secret|risk|karma|mark|隐秘|风险|因果|标记|旧账|盲区/);
  const destiny = destinyCards.find((card) => card?.content) || null;
  const leadByGenre = {
    lingyi: '子夜将近，城里最后一排灯火正沿着长街逐盏熄灭。',
    history: '暮色压过驿道，城门的更鼓比往日早了一刻。',
    heroic: '风从官道尽头卷来，带着尘土、马汗和一段没人肯说完的旧闻。',
    xianxia: '天光未破，云海仍压着昨夜未散的寒意。',
    wuxia: '夜雨敲过城檐，湿漉漉的石板路上已听不见寻常行人的脚步。',
    generic: '天色渐沉，远处的风声把一桩尚未揭开的旧事送到眼前。'
  };
  const paragraphs = [leadByGenre[detectJourneyOpeningGenre(tpl)] || leadByGenre.generic];

  if (worldBeat) paragraphs.push(`${worldBeat.replace(/[。！？]+$/g, '')}，而今所有平静都只剩下一层薄壳。`);
  if (crisisBeat && crisisBeat !== worldBeat) paragraphs.push(`${crisisBeat.replace(/[。！？]+$/g, '')}。`);

  const protagonist = name || '你';
  const identity = role ? `以${role}的身份` : '';
  const purpose = goal ? `，此行只为${goal.replace(/[。！？]+$/g, '')}` : '';
  paragraphs.push(identity || purpose
    ? `${protagonist}${identity}${purpose}。`
    : `${protagonist}已经走到这场风波的边缘，再退一步也未必还能置身事外。`);

  if (risk) {
    paragraphs.push(`只是你比旁人更清楚，${risk.replace(/[。！？]+$/g, '')}，这件事迟早会在最不合时宜的时候追上来。`);
  }
  if (destiny) {
    paragraphs.push(`偏在此刻，${cleanJourneySettingBeat(destiny.content).replace(/[。！？]+$/g, '')}。故事的第一道门，已经在你面前打开。`);
  } else if (worldbookSnapshot.entries.length) {
    const anchorTitles = worldbookSnapshot.entries.slice(0, 2).map((entry) => entry.title).filter(Boolean);
    if (anchorTitles.length) paragraphs.push(`关于${anchorTitles.join('与')}的传闻，正把你引向今晚真正的风暴中心。`);
  }

  return paragraphs.filter(Boolean).slice(0, 6);
}

export function buildJourneyPrompt(
  formData,
  tpl,
  destinyCards = [],
  worldbookSnapshot = EMPTY_WORLDBOOK_SNAPSHOT
) {
  const choiceLabels = getJourneyChoiceLabels(tpl);
  let promptText = `[ ${choiceLabels.promptTitle}：${tpl.title} ]\n\n`;

  if (tpl.subtitle) {
    promptText += `副题：${tpl.subtitle}\n`;
  }
  if (tpl.tagline) {
    promptText += `题眼：${tpl.tagline}\n`;
  }

  const tabEntries = getJourneyTabSummaries(tpl);
  if (tabEntries.length) {
    promptText += `\n开局设定模块：${tabEntries.map((tab) => tab.label).join('、')}。\n`;
  }

  if (worldbookSnapshot.total) {
    promptText += `已加载 World Book：${worldbookSnapshot.total} 条`;
    if (worldbookSnapshot.hiddenTotal) {
      promptText += `（含 ${worldbookSnapshot.hiddenTotal} 条 GM 隐藏层）`;
    }
    promptText += `。具体内容已由系统上下文提供，此处不再重复。\n`;
  }

  promptText += `\n[ 主角锚点 ]\n`;
  Object.entries(formData).forEach(([key, value]) => {
    if (key === 'selectedGreeting') return;
    const label = tpl.fields?.[key]?.label || key;
    promptText += `**${label}**：${value}\n`;
  });

  if (formData.selectedGreeting) {
    promptText += `\n[ 指定开局切入点 ]\n${formData.selectedGreeting}\n`;
  }

  if (destinyCards.length) {
    promptText += `\n[ ${choiceLabels.sectionLabel} ]\n`;
    destinyCards.forEach((card) => {
      promptText += `- ${card.title}：${card.content}\n`;
    });
  }

  promptText += `\n（系统指令：请根据上述主角设定，结合当前世界观和已加载 World Book 背景，以旁白视角写出一段沉浸式小说开头，并为主角抛出第一个危机或冲突情境。使用第二人称“你”。

开场写作要求：
- 直接从具体时间、地点、感官细节或正在发生的动作切入，不要先介绍设定。
- 只选取 2 至 4 个与当前场景最相关的世界书事实自然融入叙事，不要复述、罗列或总结世界书、主角字段与规则条目。
- 不要输出“世界背景”“主角信息”“当前危机”等说明性标题，不要暴露系统提示、XML 标签、状态协议或推理过程。
- 让人物通过称谓、动作、停顿和对话显出性格；不要替用户决定主角的核心行动、台词或内心结论。
- 正文结束后再给出选项区块，正文与选项之间留一个空行。

**极其重要：** 当你需要让用户做出选择时，必须且只能使用以下 Markdown 格式输出选项区块：
> [天机选项：(此处简述当前情境)]
- 选项1：...
- 选项2：...
- 选项3：...
- 选项4：自定义

同时请把世界书摘要、当前 World Book 背景、主角锚点${destinyCards.length ? `和${choiceLabels.sectionLabel}` : ''}视为长期事实候选。）`;

  return promptText;
}

export function createJourneyDraftController({
  state = {},
  chatInput = null,
  setChatInputValue = null,
  createOpeningErrorPanel = () => null,
  renderMessages = () => {},
  documentObject = globalThis.document
} = {}) {
  function buildJourneyWorldbookSnapshot(limit = 8) {
    const entries = Array.isArray(state.config?.worldBook) ? state.config.worldBook : [];
    const enabledEntries = entries
      .filter((entry) => entry && entry.enabled !== false)
      .sort((a, b) => {
        const constantDiff = Number(Boolean(b.constant)) - Number(Boolean(a.constant));
        if (constantDiff) return constantDiff;
        return Number(b.priority ?? 50) - Number(a.priority ?? 50);
      });
    const playerVisibleEntries = enabledEntries.filter((entry) => {
      const visibility = entry?.extensions?.visibility || entry?.visibility || 'player';
      return visibility !== 'gm' && entry?.extensions?.gmOnly !== true;
    });

    return {
      total: enabledEntries.length,
      publicTotal: playerVisibleEntries.length,
      hiddenTotal: enabledEntries.length - playerVisibleEntries.length,
      entries: playerVisibleEntries.slice(0, limit).map((entry) => ({
        title: entry.title || entry.id || '未命名世界书条目',
        type: entry.type || 'world',
        content: truncateText(String(entry.content || '').replace(/\s+/g, ' ').trim(), 220),
        keywords: Array.isArray(entry.keywords) ? entry.keywords.slice(0, 5) : [],
        depth: entry.depth ?? 4,
        constant: Boolean(entry.constant)
      }))
    };
  }

  function buildJourneyDraft(formData, tpl, destinyCards = []) {
    const worldbookSnapshot = buildJourneyWorldbookSnapshot();
    const choiceLabels = getJourneyChoiceLabels(tpl);
    return {
      title: tpl.title || choiceLabels.promptTitle,
      subtitle: tpl.subtitle || '',
      tagline: tpl.tagline || '',
      fields: Object.entries(formData).map(([key, value]) => ({
        key,
        label: tpl.fields?.[key]?.label || key,
        value
      })),
      tabs: getJourneyTabSummaries(tpl),
      destinyCards,
      choiceSectionLabel: choiceLabels.sectionLabel,
      worldbookSnapshot,
      openingProse: buildJourneyOpeningProse(formData, tpl, destinyCards, worldbookSnapshot),
      promptText: buildJourneyPrompt(formData, tpl, destinyCards, worldbookSnapshot)
    };
  }

  function appendJourneySection(parent, title, body) {
    const section = documentObject.createElement('section');
    section.className = 'epic-journey-draft-section';
    const heading = documentObject.createElement('h2');
    heading.textContent = title;
    section.append(heading);
    section.append(body);
    parent.append(section);
  }

  function renderJourneyDraft(draft) {
    const wrapper = documentObject.createElement('div');
    wrapper.className = 'epic-journey-draft';

    const errorPanel = createOpeningErrorPanel();
    if (errorPanel) wrapper.append(errorPanel);

    const header = documentObject.createElement('header');
    const title = documentObject.createElement('h1');
    title.textContent = draft.title;
    const subtitle = documentObject.createElement('p');
    subtitle.textContent = [draft.subtitle, draft.tagline].filter(Boolean).join(' · ');
    header.append(title, subtitle);
    wrapper.append(header);

    const fieldList = documentObject.createElement('dl');
    fieldList.className = 'epic-journey-field-grid';
    draft.fields.forEach((field) => {
      const dt = documentObject.createElement('dt');
      dt.textContent = field.label;
      const dd = documentObject.createElement('dd');
      dd.textContent = field.value;
      fieldList.append(dt, dd);
    });
    appendJourneySection(wrapper, '已选择的主角锚点', fieldList);

    const opening = documentObject.createElement('div');
    opening.className = 'epic-journey-opening-prose';
    (draft.openingProse || []).forEach((paragraph) => {
      const block = documentObject.createElement('p');
      block.textContent = paragraph;
      opening.append(block);
    });
    appendJourneySection(wrapper, '入局引子', opening);

    const settingSummary = documentObject.createElement('div');
    settingSummary.className = 'epic-journey-setting-summary';
    const settingLabels = [
      ...draft.tabs.map((tab) => tab.label),
      ...draft.destinyCards.map((card) => card.title),
      ...draft.worldbookSnapshot.entries.slice(0, 5).map((entry) => entry.title)
    ].filter(Boolean);
    [...new Set(settingLabels)].slice(0, 10).forEach((label) => {
      const chip = documentObject.createElement('span');
      chip.textContent = label;
      settingSummary.append(chip);
    });
    appendJourneySection(wrapper, '本卷设定', settingSummary);

    const details = documentObject.createElement('details');
    details.className = 'epic-journey-setting-details';
    const detailsSummary = documentObject.createElement('summary');
    detailsSummary.textContent = `查看设定依据 · 公开 ${draft.worldbookSnapshot.publicTotal || 0} / 总计 ${draft.worldbookSnapshot.total}`;
    details.append(detailsSummary);

    const worldText = documentObject.createElement('div');
    worldText.className = 'epic-journey-world-text';
    draft.tabs.forEach((tab) => {
      const block = documentObject.createElement('p');
      const strong = documentObject.createElement('strong');
      strong.textContent = `【${tab.label}】`;
      block.append(strong, documentObject.createTextNode(tab.content || '暂无内容。'));
      worldText.append(block);
    });
    details.append(worldText);

    const worldbookList = documentObject.createElement('ul');
    worldbookList.className = 'epic-journey-worldbook-list';
    if (draft.worldbookSnapshot.entries.length) {
      draft.worldbookSnapshot.entries.forEach((entry) => {
        const item = documentObject.createElement('li');
        const titleLine = documentObject.createElement('strong');
        titleLine.textContent = `${entry.title} · ${entry.type}${entry.constant ? ' · 常驻' : ''} · Depth ${entry.depth}`;
        const content = documentObject.createElement('span');
        content.textContent = entry.content || '暂无内容';
        item.append(titleLine, content);
        worldbookList.append(item);
      });
    } else {
      const item = documentObject.createElement('li');
      item.textContent = draft.worldbookSnapshot.total
        ? '当前启用条目均为 GM 隐藏层，开局稿不会提前展示。'
        : '当前没有启用的 World Book 条目。';
      worldbookList.append(item);
    }
    details.append(worldbookList);
    wrapper.append(details);

    if (draft.destinyCards.length) {
      const destinyList = documentObject.createElement('ul');
      destinyList.className = 'epic-journey-worldbook-list';
      draft.destinyCards.forEach((card) => {
        const item = documentObject.createElement('li');
        const titleLine = documentObject.createElement('strong');
        titleLine.textContent = card.title;
        const content = documentObject.createElement('span');
        content.textContent = card.content;
        item.append(titleLine, content);
        destinyList.append(item);
      });
      appendJourneySection(wrapper, draft.choiceSectionLabel || '已选开局要素', destinyList);
    }

    const note = documentObject.createElement('p');
    note.className = 'epic-journey-note';
    note.textContent = '这份开局稿已经放入输入框。你可以直接发送，也可以先编辑后再发送，用它作为第一条对话来引出全局。';
    wrapper.append(note);

    const actions = documentObject.createElement('div');
    actions.className = 'epic-journey-draft-actions';
    const refill = documentObject.createElement('button');
    refill.type = 'button';
    refill.className = 'epic-secondary-btn';
    refill.textContent = '填入输入框';
    refill.addEventListener('click', () => {
      if (typeof setChatInputValue === 'function') {
        setChatInputValue(draft.promptText);
        return;
      }
      if (!chatInput) return;
      chatInput.value = draft.promptText;
      chatInput.focus();
    });
    const reset = documentObject.createElement('button');
    reset.type = 'button';
    reset.className = 'epic-secondary-btn';
    reset.textContent = '重新锚定';
    reset.addEventListener('click', () => {
      state.pendingJourneyDraft = null;
      renderMessages();
    });
    actions.append(refill, reset);
    wrapper.append(actions);

    return wrapper;
  }

  return {
    buildJourneyDraft,
    buildJourneyWorldbookSnapshot,
    renderJourneyDraft
  };
}
