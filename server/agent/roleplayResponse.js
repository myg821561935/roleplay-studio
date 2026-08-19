const ROLEPLAY_BLOCKS = [
  'descriptive_analysis',
  'normal_status',
  'plot',
  'relationship_status',
  'special_status',
  'NextCharacterPanel'
];

// Community presets commonly use both the correct <planning> spelling and the
// legacy SillyTavern typo <planing>. Treat both as control-plane output so the
// model's private generation plan never becomes story prose.
const ANALYSIS_BLOCKS = ['descriptive_analysis', 'think', 'thinking', 'analysis', 'planning', 'planing'];
const TRANSPARENT_WRAPPERS = ['ai_last_output', 'dream_plot', 'StatusBlock'];
const CONTENT_BLOCKS = ['content', '正文', 'msg', 'dream_body'];
const TOOL_ACTIVITY_BLOCKS = ['web_search', 'web_search_results', 'search_results', 'tool_result', 'tool_results'];
const COMMUNITY_PANEL_BLOCKS = ['bginfor', 'catsay', 'dream_scene', 'dream_summary', 'dream_discuss', 'dream_big_discuss'];
const STATUS_PANEL_BLOCKS = ['CharacterStatus'];
const COMMUNITY_ACTION_BLOCKS = ['w2g', 'dream_option'];
// Legacy Tavern Helper / MVU presets commonly append state mutations after
// the prose. They are control-plane data, not story text. Keep the aliases
// here (instead of treating them as analysis) so they remain hidden without
// exposing their payload in the director-notes panel.
const STATE_UPDATE_BLOCKS = ['UpdateVariable', 'UpdateVariablevariable', 'JSONPatch'];
const LEGACY_CHOICE_HEADING_PATTERN = /^\s*(?:>\s*)?[【\[]\s*(?:(?:天机|互动|剧情|行动|抉择|下一步)\s*)?(?:选项|行动)\s*(?:[：:][^】\]]*)?[】\]]\s*$/u;
const LEGACY_CHOICE_LINE_PATTERN = /^\s*(?:[-*•·]\s*)?(?:(?:选项|行动)\s*)?(?:[A-FＡ-Ｆ]|\d{1,2})\s*(?:[:：.、)）-]\s*)(.+?)\s*$/iu;
const MODEL_RECOMMENDATION_HEADING_PATTERN = /^\s*(?:#{1,6}\s*)?(?:\*\*|__)?\s*推荐(?:动作|行动|选项)\s*(?:[（(][^）)]{0,80}[）)])?\s*(?:\*\*|__)?\s*[：:]?\s*$/u;
const MODEL_RECOMMENDATION_LINE_PATTERN = /^\s*[-*•·]\s+(.+?)\s*$/u;
const PRESENTATION_BLOCKS = [
  ...ROLEPLAY_BLOCKS,
  ...ANALYSIS_BLOCKS,
  ...CONTENT_BLOCKS,
  ...TOOL_ACTIVITY_BLOCKS,
  ...COMMUNITY_PANEL_BLOCKS,
  ...STATUS_PANEL_BLOCKS,
  ...COMMUNITY_ACTION_BLOCKS,
  ...STATE_UPDATE_BLOCKS
];
const CONTROL_BLOCK_START = /<(?:recommended_actions|turn[_-]?frame|lra-actions|lra-mvu-patch|mvu_patch|updatevariable(?:variable)?|jsonpatch)\b|```(?:lra-turn-frame|lra-actions|lra-mvu-patch)\b/i;
const CONTROL_PREFIXES = [
  ...PRESENTATION_BLOCKS.map((tag) => `<${String(tag).toLowerCase()}`),
  ...TRANSPARENT_WRAPPERS.map((tag) => `<${String(tag).toLowerCase()}`),
  '<recommended_actions',
  '<turn_frame',
  '<turnframe',
  '<turn-frame',
  '<lra-actions',
  '<lra-mvu-patch',
  '<mvu_patch',
  '```lra-actions',
  '```lra-turn-frame',
  '```lra-mvu-patch'
];
const STREAM_MODEL_RECOMMENDATION_START = /(?:^|\n)\s*(?:-{3,}\s*\n+)?\s*(?:#{1,6}\s*)?(?:\*\*|__)?\s*推荐(?:动作|行动|选项)\s*(?:[（(][^）)\n]{0,80}[）)])?\s*(?:\*\*|__)?\s*[：:]?\s*(?:\n|$)/u;

export function parseRoleplayResponse(rawContent) {
  const source = String(rawContent || '');
  if (looksLikePartialProtocolPrefix(source)) {
    return { content: '', speaker: '', protocolDetected: true, panels: {}, recommendedActions: [] };
  }
  const normalizedSource = unwrapTransparentBlocks(source);
  const legacyChoices = extractLegacyRecommendedActions(normalizedSource);
  const presentationSource = stripRecommendedActionBlocks(legacyChoices.content);
  const protocolDetected = [...PRESENTATION_BLOCKS, ...TRANSPARENT_WRAPPERS]
    .some((tag) => new RegExp(`<${escapeRegExp(tag)}(?=[\\s>/])`, 'i').test(source));
  const plotBlocks = extractBlocks(presentationSource, 'plot', { includePartial: true });
  const contentBlocks = CONTENT_BLOCKS.flatMap((tag) => extractBlocks(presentationSource, tag, { includePartial: true }));
  const visibleSource = plotBlocks.length
    ? plotBlocks.join('\n\n')
    : contentBlocks.length
      ? contentBlocks.join('\n\n')
      : protocolDetected
        ? stripProtocolBlocks(presentationSource)
        : truncateControlBlocks(presentationSource);
  const { content, speaker } = cleanVisibleText(visibleSource);
  const directorNotes = ANALYSIS_BLOCKS
    .map((tag) => cleanPanelText(extractBlocks(normalizedSource, tag).join('\n\n')))
    .filter(Boolean)
    .join('\n\n');

  return {
    content,
    speaker,
    emotion: extractEmotion(normalizedSource),
    protocolDetected,
    recommendedActions: sanitizeRecommendedActions([
      ...extractRecommendedActions(normalizedSource),
      ...extractCommunityActions(normalizedSource),
      ...legacyChoices.actions
    ], 6),
    recommendedActionPresentation: legacyChoices.presentation
      || (extractRecommendedActions(normalizedSource).length >= 2
        ? { source: 'model-recommended-actions', title: '', hint: '' }
        : extractCommunityActions(normalizedSource).length >= 2
          ? { source: 'community-action-block', title: '', hint: '' }
          : null),
    panels: compactPanels({
      directorNotes,
      sceneStatus: cleanPanelText([
        ...extractBlocks(normalizedSource, 'normal_status'),
        ...extractBlocks(normalizedSource, 'bginfor'),
        ...extractBlocks(normalizedSource, 'dream_scene'),
        ...extractBlocks(normalizedSource, 'dream_summary')
      ].join('\n\n')),
      relationshipStatus: cleanPanelText(extractBlocks(normalizedSource, 'relationship_status').join('\n\n')),
      characterStatus: cleanPanelText([
        ...extractBlocks(normalizedSource, 'special_status'),
        ...STATUS_PANEL_BLOCKS.flatMap((tag) => extractBlocks(normalizedSource, tag))
      ].join('\n\n')),
      nextCharacter: cleanPanelText(extractBlocks(normalizedSource, 'NextCharacterPanel').join('\n\n')),
      communityComment: cleanPanelText([
        ...extractBlocks(normalizedSource, 'catsay'),
        ...extractBlocks(normalizedSource, 'dream_discuss'),
        ...extractBlocks(normalizedSource, 'dream_big_discuss')
      ].join('\n\n')),
      toolActivity: cleanPanelText(TOOL_ACTIVITY_BLOCKS
        .flatMap((tag) => extractBlocks(normalizedSource, tag))
        .join('\n\n'))
    })
  };
}

function extractCommunityActions(source) {
  const actions = COMMUNITY_ACTION_BLOCKS.flatMap((tag) => extractBlocks(source, tag)).flatMap((block) => String(block || '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<!--([\s\S]*?)-->/g, '')
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*(?:[A-FＡ-Ｆ]|\d{1,2})\s*[:：.)、-]\s*(.+?)\s*$/i)?.[1] || '')
    .map((line) => line.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim())
    .filter((line) => line.length >= 2 && line.length <= 240));
  return sanitizeRecommendedActions(actions, 6);
}

function extractRecommendedActions(source) {
  const actions = [];
  const pattern = /<recommended_actions\b[^>]*>\s*([\s\S]*?)\s*<\/recommended_actions\s*>/ig;
  let match;
  while ((match = pattern.exec(String(source || '')))) {
    actions.push(...parseRecommendedActions(match[1]));
  }
  return sanitizeRecommendedActions(actions, 6);
}

function extractLegacyRecommendedActions(source) {
  const lines = String(source || '').split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => (
    LEGACY_CHOICE_HEADING_PATTERN.test(line)
    || MODEL_RECOMMENDATION_HEADING_PATTERN.test(line)
  ));
  if (headingIndex < 0) return { content: String(source || ''), actions: [], presentation: null };
  const modelRecommendation = MODEL_RECOMMENDATION_HEADING_PATTERN.test(lines[headingIndex]);

  const actions = [];
  let cursor = headingIndex + 1;
  while (cursor < lines.length) {
    const line = lines[cursor];
    if (!line.trim()) {
      cursor += 1;
      continue;
    }
    const match = line.match(LEGACY_CHOICE_LINE_PATTERN)
      || line.match(MODEL_RECOMMENDATION_LINE_PATTERN);
    if (!match) break;
    actions.push(match[1]);
    cursor += 1;
  }

  const normalizedActions = sanitizeRecommendedActions(actions, 6);
  if (normalizedActions.length < 2) return { content: String(source || ''), actions: [], presentation: null };
  let blockStart = headingIndex;
  while (blockStart > 0 && !lines[blockStart - 1].trim()) blockStart -= 1;
  if (blockStart > 0 && /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/u.test(lines[blockStart - 1])) blockStart -= 1;
  return {
    content: [...lines.slice(0, blockStart), ...lines.slice(cursor)]
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
    actions: normalizedActions,
    presentation: modelRecommendation
      ? { source: 'model-recommendation-block', title: '', hint: '' }
      : parseLegacyChoicePresentation(lines[headingIndex])
  };
}

function parseLegacyChoicePresentation(line) {
  const heading = String(line || '').replace(/^\s*>\s*/u, '').trim();
  const inner = heading.replace(/^[【\[]\s*/u, '').replace(/\s*[】\]]$/u, '').trim();
  const separator = inner.search(/[：:]/u);
  const rawTitle = (separator >= 0 ? inner.slice(0, separator) : inner).trim();
  const hint = separator >= 0 ? inner.slice(separator + 1).trim() : '';
  return {
    source: 'community-choice-block',
    title: rawTitle || '天机选项',
    hint
  };
}

function parseRecommendedActions(value) {
  try {
    const parsed = JSON.parse(String(value || '').trim());
    if (!Array.isArray(parsed)) return [];
    return sanitizeRecommendedActions(parsed, 6);
  } catch {
    return sanitizeRecommendedActions(String(value || '')
      .split('\n')
      .map((line) => line.replace(/^[-*\d.、\s]+/, '').trim()), 6);
  }
}

function sanitizeRecommendedActions(values = [], maxActions = 4) {
  const protocolLeak = /(?:<\/?(?:think|analysis|plot|normal_status|relationship_status|special_status|NextCharacterPanel|recommended_actions)\b|recommended_actions|Ira-actions|正文前(?:注释|格式)|天机选项块|step\s*\d+|--?>|《end》|<\/think>)/i;
  const instructionLeak = /(?:如果稳定变化需要输出|结束需要|输出格式|格式为|正文前|正文后|以下标签|x\s*3)/i;
  const actions = Array.from(new Set((Array.isArray(values) ? values : [values])
    .map((item) => String(item || '').replace(/\s+/g, ' ').trim())
    .filter((item) => item.length >= 2 && item.length <= 120)
    .filter((item) => !protocolLeak.test(item) && !instructionLeak.test(item))
    .filter((item) => !/^[;；<>{}\[\]()\/\\|=_-]+/.test(item))
    .filter((item) => /[\p{L}\p{N}]/u.test(item))));
  return actions.length >= 2 ? actions.slice(0, maxActions) : [];
}

function stripRecommendedActionBlocks(source) {
  return String(source || '').replace(
    /<recommended_actions\b[^>]*>[\s\S]*?<\/recommended_actions\s*>/ig,
    '\n'
  );
}

function extractBlocks(source, tag, { includePartial = false } = {}) {
  const text = String(source || '');
  const lower = text.toLowerCase();
  const openPattern = new RegExp(`<${escapeRegExp(tag)}(?=[\\s>/])[^>]*>`, 'ig');
  const closeTag = `</${String(tag).toLowerCase()}>`;
  const values = [];
  let match;

  while ((match = openPattern.exec(text))) {
    const contentStart = openPattern.lastIndex;
    const closeIndex = lower.indexOf(closeTag, contentStart);
    if (closeIndex < 0) {
      if (includePartial) values.push(text.slice(contentStart));
      break;
    }
    values.push(text.slice(contentStart, closeIndex));
    openPattern.lastIndex = closeIndex + closeTag.length;
  }

  return values;
}

function stripProtocolBlocks(source) {
  let result = truncateControlBlocks(source);
  PRESENTATION_BLOCKS.forEach((tag) => {
    const escapedTag = escapeRegExp(tag);
    const complete = new RegExp(`<${escapedTag}(?=[\\s>/])[^>]*>[\\s\\S]*?<\\/${escapedTag}\\s*>`, 'ig');
    const partial = new RegExp(`<${escapedTag}(?=[\\s>/])[^>]*>[\\s\\S]*$`, 'ig');
    const closing = new RegExp(`<\\/${escapedTag}\\s*>`, 'ig');
    result = result.replace(complete, '\n').replace(partial, '\n').replace(closing, '\n');
  });
  return result;
}

function unwrapTransparentBlocks(source) {
  let result = String(source || '');
  // emotion 标签是元数据，在解析链路最前面剥离，避免流式过程中 visible 内容跳变
  // 先剥离完整闭合的 emotion 标签，再剥离未闭合的半截 emotion 开头（流式 buffer 中常见）
  result = result
    .replace(/<emotion\b[^>]*>[\s\S]*?<\/emotion\s*>/gi, '')
    .replace(/<emotion\b[^>]*>[\s\S]*$/i, '')
    .replace(/<emotion\b[^>]*>$/i, '');
  TRANSPARENT_WRAPPERS.forEach((tag) => {
    result = result
      .replace(new RegExp(`<${tag}\\b[^>]*>`, 'ig'), '')
      .replace(new RegExp(`<\\/${tag}\\s*>`, 'ig'), '');
  });
  return result;
}

function truncateControlBlocks(source) {
  const text = String(source || '');
  const match = text.match(CONTROL_BLOCK_START);
  let cutIndex = match ? Number(match.index) : text.length;
  const recommendationMatch = text.match(STREAM_MODEL_RECOMMENDATION_START);
  if (recommendationMatch) cutIndex = Math.min(cutIndex, Number(recommendationMatch.index));
  const lower = text.toLowerCase();
  for (const prefix of CONTROL_PREFIXES) {
    for (let length = 1; length < prefix.length; length += 1) {
      const partial = prefix.slice(0, length);
      if (!lower.endsWith(partial)) continue;
      const index = text.length - partial.length;
      const previous = index > 0 ? text[index - 1] : '';
      if (index === 0 || /\s/.test(previous)) cutIndex = Math.min(cutIndex, index);
    }
  }
  return text.slice(0, cutIndex);
}

function cleanVisibleText(value) {
  let content = String(value || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/^\s*(?:正文内容|故事正文|正文)\s*[:：]\s*/i, '')
    .replace(/<\/?(?:plot|details|summary)\b[^>]*>/gi, '')
    .trim();
  const speakerMatch = content.match(/^【([^】\n]{1,30})】\s*/);
  const speaker = speakerMatch ? speakerMatch[1].trim() : '';
  if (speakerMatch) content = content.slice(speakerMatch[0].length).trim();
  return { content, speaker };
}

function cleanPanelText(value) {
  const panelTags = [...PRESENTATION_BLOCKS, ...TRANSPARENT_WRAPPERS]
    .map((tag) => escapeRegExp(tag))
    .join('|');
  return String(value || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<summary\b[^>]*>[\s\S]*?<\/summary\s*>/gi, '')
    .replace(/<\/?details\b[^>]*>/gi, '')
    .replace(/^```(?:ya?ml|json|markdown|md)?\s*$/gim, '')
    .replace(/^```\s*$/gim, '')
    .replace(new RegExp(`<\\/?(?:${panelTags})(?=[\\s>/])[^>]*>`, 'gi'), '')
    .trim();
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compactPanels(panels) {
  return Object.fromEntries(Object.entries(panels).filter(([, value]) => Boolean(value)));
}

function looksLikePartialProtocolPrefix(source) {
  const value = String(source || '').trimStart().toLowerCase();
  if (!value) return false;
  return CONTROL_PREFIXES.some((start) => start.startsWith(value));
}

const EMOTION_PATTERN = /<emotion\b[^>]*>\s*([\s\S]*?)\s*<\/emotion\s*>/i;

function extractEmotion(source) {
  const match = String(source || '').match(EMOTION_PATTERN);
  if (!match) return '';
  const emotion = match[1].trim().toLowerCase();
  return emotion.slice(0, 30);
}
