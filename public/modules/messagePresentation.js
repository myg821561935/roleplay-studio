import { extractRoleplayPresentation } from './roleplayResponse.js';
import { buildSpeakerPortraitMap, resolveSpeakerCharacter } from './characterPresentation.js';
import { renderAgentActionCards } from './agentActionCards.js';
import { filterLegacyRuntimeFallbackActions } from './recommendedActionFilters.js';
import { chooseRecommendedActionPresentation } from './recommendedActionPresentation.js';
import { createRecommendedActionsViewNode } from './recommendedActionsView.js';
import { normalizeRoleplayPanelsForPresentation } from './roleplayPanelsPresentation.js';
import { createTurnClosureViewNode, resolveCommittedTurnMessage } from './turnClosureView.js';

const WEB_SEARCH_TOOL_NAMES = new Set(['websearch', 'visitlinks', 'web search', 'visit links']);

export function isWebSearchToolMessage(message = {}) {
  const invocations = [
    ...(Array.isArray(message?.extra?.tool_invocations) ? message.extra.tool_invocations : []),
    ...(Array.isArray(message?.toolInvocations) ? message.toolInvocations : [])
  ];
  if (invocations.some((invocation) => {
    const names = [invocation?.name, invocation?.displayName]
      .map((value) => String(value || '').trim().toLowerCase())
      .filter(Boolean);
    return names.some((name) => WEB_SEARCH_TOOL_NAMES.has(name));
  })) return true;
  return /^\s*Tool calls:\s*(?:Web Search|Visit Links)\b/im.test(String(message?.content || message?.mes || ''));
}

export function shouldHideAuxiliaryMessage(message = {}, nextMessage = {}) {
  if (message?.hiddenFromChat === true) return true;
  if (String(message?.role || '').toLowerCase() === 'user' || message?.is_user === true) return false;
  const content = String(message?.content || message?.mes || '').trim();
  const reasoning = String(message?.reasoning || message?.extra?.reasoning || '').trim();
  return !content && Boolean(reasoning) && isWebSearchToolMessage(nextMessage);
}

function getWebSearchToolActivity(message = {}) {
  if (!isWebSearchToolMessage(message)) return '';
  return String(message?.content || message?.mes || '').trim() || '已执行网页检索，未返回可展示文本。';
}

export function createMessagePresentationController({
  state = {},
  createCharacterPortraitImage = () => null,
  formatTime = () => '',
  formatTokenCount = String,
  getLightFrontendContext = () => ({}),
  renderMessageContent = () => {},
  extractPresentation = extractRoleplayPresentation,
  canSpeakMessages = () => false,
  isMessageSpeaking = () => false,
  documentObject = globalThis.document
  } = {}) {
  function createMessageNode(message = {}) {
    const committedTurn = resolveCommittedTurnMessage(message, state.session?.turnViewSnapshot);
    const viewMessage = committedTurn.message;
    const article = documentObject.createElement('article');
    const role = viewMessage.role === 'user' ? 'user' : 'assistant';
    article.className = `message ${role}`;
    if (viewMessage.excluded) article.classList.add('excluded');
    if (viewMessage.aborted === true && role === 'assistant') article.classList.add('is-aborted');
    const toolActivity = getWebSearchToolActivity(viewMessage);
    if (toolActivity) article.classList.add('message-auxiliary');

    const presentation = role === 'assistant'
      ? extractPresentation(viewMessage.content)
      : null;
    const displaySpeaker = toolActivity ? '检索工具' : (viewMessage.speaker || presentation?.speaker);
    if (displaySpeaker && role === 'assistant') {
      article.classList.add('has-speaker');
    }
    const emotion = presentation?.emotion || viewMessage.emotion || '';
    const meta = createMessageMeta(viewMessage, role, displaySpeaker, emotion);
    const content = documentObject.createElement('div');
    content.className = 'message-content';
    const rawVisibleContent = toolActivity ? '' : (presentation ? presentation.content : (viewMessage.content || ''));

    renderMessageContent({
      container: content,
      visibleContent: renderAgentActionCards(rawVisibleContent),
      role,
      context: {
        role,
        ...getLightFrontendContext(),
        speaker: displaySpeaker || '',
        portraitBySpeaker: buildSpeakerPortraitMap(state.config)
      },
      messageId: viewMessage.id
    });

    article.append(meta, content);
    const mergedRoleplayPanels = normalizeRoleplayPanelsForPresentation({
      ...(presentation?.panels || {}),
      ...(viewMessage.roleplayPanels || {}),
      ...(toolActivity ? { toolActivity } : {})
    }, { message: viewMessage, presentation });
    const communityPanels = role === 'assistant'
      ? createCommunityPanelsNode(mergedRoleplayPanels)
      : null;
    const presentationActions = presentation?.recommendedActions;
    const recommendation = chooseRecommendedActionPresentation(viewMessage, { ...presentation, recommendedActions: presentationActions });
    const actions = createRecommendedActionsNode(
      filterLegacyRuntimeFallbackActions(recommendation.actions),
      recommendation.presentation,
      viewMessage,
      mergedRoleplayPanels
    );
    const turnClosure = role === 'assistant'
      ? createTurnClosureViewNode({
        message: viewMessage,
        actionsNode: actions,
        auxiliaryPanelsNode: communityPanels,
        committed: committedTurn.committed,
        documentObject
      })
      : null;
    if (turnClosure) article.append(turnClosure);
    article.append(createMessageTools(viewMessage, role));

    return article;
  }

  function createMessageMeta(message, role, displaySpeaker, emotion = '') {
    const meta = documentObject.createElement('div');
    meta.className = 'message-meta';

    const roleText = documentObject.createElement('span');
    roleText.className = 'message-role';
    if (displaySpeaker) {
      roleText.textContent = displaySpeaker;
      roleText.classList.add('speaker-name');
    } else {
      roleText.textContent = role === 'user' ? '你' : '旁白';
    }

    const time = documentObject.createElement('time');
    time.textContent = formatTime(message.createdAt);
    if (message.createdAt) time.dateTime = message.createdAt;

    const speakerCharacter = role === 'assistant'
      ? resolveSpeakerCharacter(state.config, displaySpeaker)
      : null;
    const avatar = speakerCharacter
      ? createCharacterPortraitImage(speakerCharacter, 'message-avatar', speakerCharacter.name, { emotion })
      : null;
    if (avatar) {
      meta.classList.add('has-portrait');
      meta.append(avatar);
    }

    const swipeSwitcher = createSwipeSwitcher(message);
    meta.append(roleText);
    if (swipeSwitcher) meta.append(swipeSwitcher);
    meta.append(createUsageBadge(message.usage), time);

    // 中止留存的 partial 回合：显示中止徽章，提示可通过「续写回复」继续
    if (message.aborted === true && role === 'assistant') {
      const abortedBadge = documentObject.createElement('span');
      abortedBadge.className = 'aborted-badge';
      abortedBadge.textContent = '已中止';
      abortedBadge.title = '生成被手动停止，正文为未完成内容；可使用「续写回复」继续';
      meta.append(abortedBadge);
    }

    if (message.bookmarked && message.bookmarkLabel) {
      const bookmark = documentObject.createElement('span');
      bookmark.className = 'bookmark-badge';
      bookmark.textContent = `🔖 ${message.bookmarkLabel}`;
      meta.append(bookmark);
    }

    return meta;
  }

  function createSwipeSwitcher(message) {
    const swipes = Array.isArray(message.swipes) ? message.swipes : [];
    if (swipes.length <= 1) return null;

    const rawIndex = Number(message.activeSwipeIndex);
    const activeIndex = Number.isInteger(rawIndex) && rawIndex >= 0 && rawIndex < swipes.length
      ? rawIndex
      : 0;
    const switcher = documentObject.createElement('span');
    switcher.className = 'swipe-switcher';

    const previous = documentObject.createElement('button');
    previous.type = 'button';
    previous.className = 'swipe-arrow';
    previous.dataset.swipePrev = message.id;
    previous.textContent = '◀';
    previous.title = '上一个分支';

    const label = documentObject.createElement('span');
    label.className = 'swipe-count';
    label.textContent = `分支 ${activeIndex + 1}/${swipes.length}`;

    const next = documentObject.createElement('button');
    next.type = 'button';
    next.className = 'swipe-arrow';
    next.dataset.swipeNext = message.id;
    next.textContent = '▶';
    next.title = '下一个分支';

    switcher.append(previous, label, next);
    return switcher;
  }

  function createUsageBadge(usage) {
    const badge = documentObject.createElement('span');
    badge.className = 'usage-badge';
    if (!usage || typeof usage !== 'object') {
      badge.hidden = true;
      return badge;
    }
    badge.textContent = `${usage.estimated === false ? '' : '约 '}${formatTokenCount(usage.totalTokens)} tokens`;
    badge.title = [
      usage.providerId ? `Provider: ${usage.providerId}` : '',
      usage.model ? `Model: ${usage.model}` : '',
      `Prompt: ${formatTokenCount(usage.promptTokens)}`,
      `Completion: ${formatTokenCount(usage.completionTokens)}`
    ].filter(Boolean).join('\n');
    return badge;
  }

  function createMessageTools(message, role) {
    const wrap = documentObject.createElement('div');
    wrap.className = 'message-tools';
    wrap.append(createToolButton('editMessage', message.id, '编辑'));

    if (role === 'assistant') {
      wrap.append(createToolButton('regenerateMessage', message.id, '重生成'));
    }
    wrap.append(
      createToolButton('toggleVisibility', message.id, message.excluded ? '包含' : '排除'),
      createToolButton('toggleBookmark', message.id, message.bookmarked ? '取消书签' : '加书签'),
      createToolButton('forkTimeline', message.id, '分支')
    );
    // 朗读按钮：仅语音可用时展示，朗读中显示停止态
    if (canSpeakMessages()) {
      const speaking = isMessageSpeaking(message.id);
      const speakButton = createToolButton('speakMessage', message.id, speaking ? '停止朗读' : '朗读');
      speakButton.classList.add('speak-button');
      if (speaking) speakButton.classList.add('is-speaking');
      wrap.append(speakButton);
    }
    return wrap;
  }

  function createToolButton(datasetKey, messageId, label) {
    const button = documentObject.createElement('button');
    button.type = 'button';
    button.className = 'tool-button';
    button.dataset[datasetKey] = messageId;
    button.textContent = label;
    return button;
  }

  function createRecommendedActionsNode(actions, actionPresentation = null, message = {}, roleplayPanels = {}) {
    return createRecommendedActionsViewNode({
      actions,
      actionPresentation,
      message,
      roleplayPanels,
      characterCard: state.config?.characterCard,
      session: state.session,
      documentObject
    });
  }

  function createCommunityPanelsNode(panels = {}) {
    const definitions = [
      { key: 'sceneStatus', label: '场景信息', icon: '◷' },
      { key: 'runtimeNotice', label: '运行提示', icon: '△' },
      { key: 'communityComment', label: '咪咪点评', icon: '🐱' },
      { key: 'toolActivity', label: '检索记录', icon: '⌕' },
      {
        key: 'directorNotes',
        label: '生成记录',
        icon: '◇',
        displayContent: '模型生成前的规划内容已从故事正文中分离。详细记录仅在右侧“导演注记”中按需审阅。'
      }
    ];
    const available = definitions
      .map((definition) => {
        const source = String(panels?.[definition.key] || '').trim();
        return {
          ...definition,
          content: source ? (definition.displayContent || source) : ''
        };
      })
      .filter((definition) => definition.content);
    if (!available.length) return null;

    const wrap = documentObject.createElement('div');
    wrap.className = 'message-community-panels';
    available.forEach(({ key, label, icon, content }) => {
      const details = documentObject.createElement('details');
      details.className = `message-community-panel message-community-panel-${key}`;
      const summary = documentObject.createElement('summary');
      summary.textContent = `${icon} ${label}`;
      const body = documentObject.createElement('div');
      body.className = 'message-community-panel-content';
      body.textContent = content;
      details.append(summary, body);
      wrap.append(details);
    });
    return wrap;
  }

  return {
    createMessageNode,
    createMessageTools,
    createCommunityPanelsNode,
    createRecommendedActionsNode,
    createSwipeSwitcher,
    createUsageBadge
  };
}
