const ACTION_PANEL_PRESENTATIONS = [
  {
    tone: 'xianxia',
    pattern: /修仙|仙侠|玄幻|灵根|灵气|天道|仙门|宗门|飞升|剑修|道侣|秘境|洞府/u,
    title: '命途抉择',
    hint: '选择一条行动，或在下方写下你自己的道途'
  },
  {
    tone: 'wuxia',
    pattern: /武侠|江湖|门派|侠客|镖局|武林|内功|剑客|刀客|掌门|帮派/u,
    title: '江湖抉择',
    hint: '选择一条行动，或在下方自行行走江湖'
  },
  {
    tone: 'mystery',
    pattern: /悬疑|推理|调查|案件|怪谈|灵异|恐怖|诡异|侦探|谜案|线索/u,
    title: '调查抉择',
    hint: '选择一个调查方向，或在下方自由行动'
  },
  {
    tone: 'relationship',
    pattern: /恋爱|恋人|情感|女仆|校园|日常|陪伴|约会|偶像|轻小说/u,
    title: '此刻回应',
    hint: '选择一种回应，或写下你想说的话'
  },
  {
    tone: 'science-fiction',
    pattern: /科幻|赛博|机甲|星际|未来|人工智能|太空|终端|义体/u,
    title: '行动指令',
    hint: '选择一项行动，或在下方输入新的指令'
  }
];

const DEFAULT_ACTION_PANEL_PRESENTATION = Object.freeze({
  tone: 'general',
  title: '轮到你决定',
  hint: '选择行动，或在下方自由输入'
});

/**
 * Keeps a native action panel in the language of the current character card.
 * Community cards can optionally provide `extensions.actionLabel` when a
 * genre heuristic is not expressive enough. The field only controls copy;
 * it never changes an action or its execution path.
 */
export function resolveActionPanelPresentation(characterCard = {}, session = {}) {
  const customTitle = readActionPanelLabel(characterCard);
  if (customTitle) {
    return {
      tone: 'custom',
      title: customTitle,
      hint: '选择行动，或在下方自由输入'
    };
  }

  const context = collectActionPanelContext(characterCard, session);
  const matched = ACTION_PANEL_PRESENTATIONS.find((presentation) => presentation.pattern.test(context));
  if (!matched) return { ...DEFAULT_ACTION_PANEL_PRESENTATION };
  return {
    tone: matched.tone,
    title: matched.title,
    hint: matched.hint
  };
}

function readActionPanelLabel(characterCard = {}) {
  const extensions = characterCard && typeof characterCard.extensions === 'object'
    ? characterCard.extensions
    : {};
  const roleplay = extensions.roleplay && typeof extensions.roleplay === 'object'
    ? extensions.roleplay
    : {};
  const value = extensions.actionLabel || extensions.interactionLabel || roleplay.actionLabel;
  const label = String(value || '').replace(/\s+/gu, ' ').trim();
  return label.length >= 2 && label.length <= 16 ? label : '';
}

function collectActionPanelContext(characterCard = {}, session = {}) {
  const card = characterCard && typeof characterCard === 'object' ? characterCard : {};
  const extensions = card.extensions && typeof card.extensions === 'object' ? card.extensions : {};
  const sessionGenre = session?.memory?.worldState?.flags?.genre || session?.memory?.ruleSystem?.contentPackId;
  return [
    card.name,
    card.description,
    card.personality,
    card.scenario,
    card.first_mes,
    card.firstMessage,
    card.creator_notes,
    card.tags,
    extensions.genre,
    extensions.contentPack,
    sessionGenre
  ].map((value) => Array.isArray(value) ? value.join(' ') : String(value || '')).join('\n');
}
