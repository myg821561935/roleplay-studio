import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createMessagePresentationController,
  isWebSearchToolMessage,
  shouldHideAuxiliaryMessage
} from '../public/modules/messagePresentation.js';
import { resolveActionPanelPresentation } from '../public/modules/actionPanelPresentation.js';
import { filterLegacyRuntimeFallbackActions } from '../public/modules/recommendedActionFilters.js';

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(...names) {
    names.forEach((name) => this.values.add(name));
  }

  contains(name) {
    return this.values.has(name);
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.className = '';
    this.classList = new FakeClassList();
    this.dataset = {};
    this.hidden = false;
    this.textContent = '';
    this.title = '';
    this.type = '';
    this.placeholder = '';
    this.maxLength = 0;
    this.dateTime = '';
    this.attributes = new Map();
  }

  append(...nodes) {
    this.children.push(...nodes);
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }

  get childElementCount() {
    return this.children.length;
  }
}

class FakeDocument {
  createElement(tagName) {
    return new FakeElement(tagName);
  }
}

function descendantsOf(element) {
  return element.children.flatMap((child) => [child, ...descendantsOf(child)]);
}

function findByClass(element, className) {
  return descendantsOf(element).find((child) => (
    child.className.split(/\s+/).includes(className) || child.classList.contains(className)
  ));
}

function findAllByClass(element, className) {
  return descendantsOf(element).filter((child) => (
    child.className.split(/\s+/).includes(className) || child.classList.contains(className)
  ));
}

function createHarness({ speaker = '叶惊弦', groupMembers = [], presentation = null, turnViewSnapshot = null } = {}) {
  const documentObject = new FakeDocument();
  const renderCalls = [];
  const mainPortrait = `/api/character-images/${'a'.repeat(64)}.png`;
  const state = {
    session: { turnViewSnapshot },
    config: {
      characterCard: {
        name: '叶惊弦',
        portrait: { url: mainPortrait }
      },
      groupMembers
    }
  };
  const controller = createMessagePresentationController({
    state,
    documentObject,
    createCharacterPortraitImage: (character, className, fallbackName) => {
      const image = documentObject.createElement('img');
      image.className = className;
      image.dataset.characterName = character.name;
      image.title = fallbackName;
      return image;
    },
    formatTime: (value) => `时间:${value || '--'}`,
    formatTokenCount: (value) => String(Number(value || 0)),
    getLightFrontendContext: () => ({ scene: '江陵府' }),
    renderMessageContent: (options) => {
      renderCalls.push(options);
      const rendered = documentObject.createElement('p');
      rendered.textContent = options.visibleContent;
      options.container.append(rendered);
    },
    extractPresentation: (content) => presentation || ({
      content: `可见:${content}`,
      speaker,
      recommendedActions: ['观察四周', '拔剑示警']
    })
  });
  return { controller, renderCalls };
}

test('speak button appears only when voice is available and reflects speaking state', () => {
  const documentObject = new FakeDocument();
  const controller = createMessagePresentationController({
    state: { config: {} },
    documentObject,
    canSpeakMessages: () => true,
    isMessageSpeaking: (messageId) => messageId === 'assistant/speaking'
  });
  const idle = controller.createMessageNode({ id: 'assistant/idle', role: 'assistant', content: '正文。' });
  const speaking = controller.createMessageNode({ id: 'assistant/speaking', role: 'assistant', content: '正文。' });

  const idleSpeak = findByClass(idle, 'speak-button');
  assert.ok(idleSpeak, '语音可用时应渲染朗读按钮');
  assert.equal(idleSpeak.textContent, '朗读');
  assert.equal(idleSpeak.dataset.speakMessage, 'assistant/idle');

  const speakingButton = findByClass(speaking, 'speak-button');
  assert.equal(speakingButton.textContent, '停止朗读');
  assert.ok(speakingButton.classList.contains('is-speaking'));
});

test('speak button stays hidden when voice is unavailable', () => {
  const { controller } = createHarness();
  const article = controller.createMessageNode({ id: 'assistant/1', role: 'assistant', content: '正文。' });
  assert.equal(findByClass(article, 'speak-button'), undefined, '语音不可用时不应渲染朗读按钮');
});

test('assistant presentation owns portrait, swipe, usage, bookmark and safe content rendering', () => {
  const { controller, renderCalls } = createHarness();
  const article = controller.createMessageNode({
    id: 'assistant/1',
    role: 'assistant',
    content: '<plot>雨落长街</plot>',
    createdAt: '2026-07-30T10:00:00.000Z',
    swipes: ['分支一', '分支二'],
    activeSwipeIndex: 1,
    usage: {
      totalTokens: 42,
      promptTokens: 30,
      completionTokens: 12,
      providerId: 'mock',
      model: 'narrator',
      estimated: false
    },
    bookmarked: true,
    bookmarkLabel: '初遇'
  });

  assert.equal(article.className, 'message assistant');
  assert.equal(findByClass(article, 'message-role').textContent, '叶惊弦');
  assert.ok(findByClass(article, 'message-role').classList.contains('speaker-name'));
  assert.equal(findByClass(article, 'message-avatar').dataset.characterName, '叶惊弦');
  assert.equal(findByClass(article, 'swipe-count').textContent, '分支 2/2');
  assert.equal(findByClass(article, 'usage-badge').textContent, '42 tokens');
  assert.match(findByClass(article, 'usage-badge').title, /Provider: mock/);
  assert.equal(findByClass(article, 'bookmark-badge').textContent, '🔖 初遇');

  const swipeButtons = findAllByClass(article, 'swipe-arrow');
  assert.equal(swipeButtons[0].dataset.swipePrev, 'assistant/1');
  assert.equal(swipeButtons[1].dataset.swipeNext, 'assistant/1');
  assert.deepEqual(renderCalls[0], {
    container: findByClass(article, 'message-content'),
    visibleContent: '可见:<plot>雨落长街</plot>',
    role: 'assistant',
    context: {
      role: 'assistant',
      scene: '江陵府',
      speaker: '叶惊弦',
      portraitBySpeaker: { 叶惊弦: `/api/character-images/${'a'.repeat(64)}.png` }
    },
    messageId: 'assistant/1'
  });

  const tools = findAllByClass(findByClass(article, 'message-tools'), 'tool-button');
  assert.deepEqual(tools.map((button) => button.textContent), ['编辑', '重生成', '排除', '取消书签', '分支']);
  const recommendations = findAllByClass(article, 'recommendation-button');
  assert.deepEqual(recommendations.map((button) => button.dataset.recommendedAction), ['观察四周', '拔剑示警']);
  assert.equal(findByClass(article, 'recommendation-custom-input').placeholder, '写下你自己的回答或行动…');
  assert.equal(findByClass(article, 'recommendation-custom-submit').textContent, '发送');
  const turnClosure = findByClass(article, 'turn-closure');
  assert.ok(turnClosure);
  assert.ok(turnClosure.children.indexOf(findByClass(article, 'recommended-actions')) >= 0);
  assert.ok(article.children.indexOf(turnClosure) < article.children.indexOf(findByClass(article, 'message-tools')));
  assert.equal(recommendations[0].attributes.get('aria-label'), '行动选项 1，观察：观察四周');
});

test('assistant presentation resolves an enabled group-member portrait by speaker', () => {
  const { controller, renderCalls } = createHarness({
    speaker: '竹青',
    groupMembers: [
      { name: '竹青', portrait: { url: `/api/character-images/${'b'.repeat(64)}.png` }, enabled: true },
      { name: '瑶台', portrait: { url: `/api/character-images/${'c'.repeat(64)}.png` }, enabled: false }
    ]
  });
  const article = controller.createMessageNode({
    id: 'assistant/group',
    role: 'assistant',
    content: '竹青：门外有人。'
  });

  assert.equal(findByClass(article, 'message-avatar').dataset.characterName, '竹青');
  assert.deepEqual(renderCalls[0].context.portraitBySpeaker, {
    叶惊弦: `/api/character-images/${'a'.repeat(64)}.png`,
    竹青: `/api/character-images/${'b'.repeat(64)}.png`
  });
});

test('aborted assistant messages carry the is-aborted class and an aborted badge', () => {
  const { controller } = createHarness();
  const article = controller.createMessageNode({
    id: 'assistant/aborted',
    role: 'assistant',
    content: '夜色沉沉，更夫的梆子声由远及近',
    aborted: true,
    abortedAt: '2026-08-19T10:00:00.000Z',
    abortReason: 'user-stopped'
  });

  assert.ok(article.classList.contains('is-aborted'), 'aborted 消息应带 is-aborted 类');
  const badge = findByClass(article, 'aborted-badge');
  assert.ok(badge, 'meta 应包含中止徽章');
  assert.equal(badge.textContent, '已中止');
  assert.match(badge.title, /续写回复/);
});

test('normal and user messages never carry the aborted presentation', () => {
  const { controller } = createHarness();
  const normalAssistant = controller.createMessageNode({
    id: 'assistant/normal',
    role: 'assistant',
    content: '完整正文。'
  });
  assert.equal(normalAssistant.classList.contains('is-aborted'), false);
  assert.equal(findByClass(normalAssistant, 'aborted-badge'), undefined);

  const userMessage = controller.createMessageNode({
    id: 'user/aborted-flag',
    role: 'user',
    content: '用户消息',
    aborted: true // 用户消息即使带标记也不渲染中止样式
  });
  assert.equal(userMessage.classList.contains('is-aborted'), false);
  assert.equal(findByClass(userMessage, 'aborted-badge'), undefined);
});

test('user presentation stays plain and exposes only user-safe message tools', () => {
  const { controller, renderCalls } = createHarness();
  const article = controller.createMessageNode({
    id: 'user/1',
    role: 'user',
    content: '我推门而入',
    excluded: true
  });

  assert.ok(article.classList.contains('excluded'));
  assert.equal(findByClass(article, 'message-role').textContent, '你');
  assert.equal(findByClass(article, 'message-avatar'), undefined);
  assert.equal(renderCalls[0].visibleContent, '我推门而入');
  assert.deepEqual(
    findAllByClass(findByClass(article, 'message-tools'), 'tool-button').map((button) => button.textContent),
    ['编辑', '包含', '加书签', '分支']
  );
  assert.equal(findByClass(article, 'recommended-actions'), undefined);
  assert.equal(findByClass(article, 'usage-badge').hidden, true);
});

test('invalid swipe indexes fall back safely and blank recommendations do not create numbering gaps', () => {
  const { controller } = createHarness();
  const switcher = controller.createSwipeSwitcher({
    id: 'assistant/2',
    swipes: ['分支一', '分支二'],
    activeSwipeIndex: 99
  });
  assert.equal(findByClass(switcher, 'swipe-count').textContent, '分支 1/2');

  const actions = controller.createRecommendedActionsNode([
    '',
    '  观察窗外  ',
    null,
    '拔剑'
  ]);
  const buttons = findAllByClass(actions, 'recommendation-button');
  assert.deepEqual(buttons.map((button) => button.dataset.recommendedAction), ['观察窗外', '拔剑']);
  assert.deepEqual(
    buttons.map((button) => findByClass(button, 'recommendation-number').textContent),
    ['01', '02']
  );
  assert.equal(findByClass(actions, 'recommendation-number').textContent, '01');
  assert.equal(findAllByClass(actions, 'recommendation-number').at(-1).textContent, '03');
  assert.equal(controller.createRecommendedActionsNode(['', null]), null);
});

test('action panel keeps three primary strategies, custom input, and folds secondary choices', () => {
  const { controller } = createHarness();
  const actions = controller.createRecommendedActionsNode([
    '正面回答自己的身份',
    '反问对方为何巡查',
    '先观察对方手中的令牌',
    '绕开对方进入竹林',
    '拔剑阻拦来人'
  ]);

  const primary = findAllByClass(actions, 'recommendation-button').slice(0, 3);
  assert.deepEqual(
    primary.map((button) => findByClass(button, 'recommendation-strategy').textContent),
    ['回应', '试探', '观察']
  );
  assert.equal(findByClass(actions, 'recommendation-custom-input').placeholder, '写下你自己的回答或行动…');
  assert.equal(findByClass(actions, 'recommendation-more-actions').children[0].textContent, '更多行动 · 2');
  assert.deepEqual(
    findAllByClass(findByClass(actions, 'recommendation-more-actions'), 'recommendation-number')
      .map((node) => node.textContent),
    ['05', '06']
  );
});

test('committed turn snapshot replaces stale action data as one atomic turn closure', () => {
  const turnId = 'assistant/committed';
  const { controller } = createHarness({
    presentation: { content: '门外的巡夜弟子停下脚步。', speaker: '旁白' },
    turnViewSnapshot: {
      spec: 'lra.turn-view-snapshot/v1',
      turnId,
      turnFrame: {
        scene: {
          location: '杂役院门外',
          time: '夜半',
          summary: '巡夜弟子正在等待回应',
          presentActors: ['刘一', '巡夜弟子']
        },
        decision: { kind: 'direct-question', requiresPlayerResponse: true },
        evidence: [{ text: '对方已经出声询问', status: 'confirmed' }],
        stateDelta: { summary: '巡查暂时停在门外', facts: [] },
        validation: { status: 'accepted' }
      },
      recommendedActions: ['说明自己正在值夜', '反问对方身份', '保持安静观察'],
      recommendedActionPresentation: {
        source: 'decision-planner',
        title: '轮到你决定',
        hint: '巡夜弟子正在等待回应'
      }
    }
  });
  const article = controller.createMessageNode({
    id: turnId,
    role: 'assistant',
    content: '旧正文。',
    recommendedActions: ['检查玉简', '观察魂火']
  });

  assert.equal(findAllByClass(article, 'turn-closure').length, 1);
  assert.equal(findByClass(article, 'turn-closure').dataset.committedTurn, 'true');
  assert.deepEqual(
    findAllByClass(article, 'recommendation-button').map((button) => button.dataset.recommendedAction),
    ['说明自己正在值夜', '反问对方身份', '保持安静观察']
  );
  assert.equal(findAllByClass(article, 'turn-context-chip').length, 3);
  assert.equal(findAllByClass(article, 'turn-evidence-details').length, 2);
});

test('legacy card-runtime fallback choices are hidden without deleting historical messages', () => {
  const { controller } = createHarness();
  const legacyChoices = [
    '向世界背景追问「开局情境」的关键信息',
    '围绕「开局情境」继续调查可确认的线索',
    '观察周围，确认可利用的线索与风险',
    '盘点现有资源，筹备下一步所需物资'
  ];
  const article = controller.createMessageNode({
    id: 'assistant/legacy-runtime-options',
    role: 'assistant',
    content: '雨声暂歇，城门仍未开启。',
    recommendedActions: legacyChoices
  });

  assert.deepEqual(filterLegacyRuntimeFallbackActions(legacyChoices), []);
  assert.equal(findByClass(article, 'recommended-actions'), undefined);
});

test('legacy decision-planner templates are hidden without rewriting historical saves', () => {
  const { controller } = createHarness();
  const legacyChoices = [
    '正面回应未明确现身的问题，只说自己已经确认的部分',
    '保留关键信息，反问未明确现身为何要问',
    '暂不回答，先确认未明确现身的态度与目的'
  ];
  const article = controller.createMessageNode({
    id: 'assistant/legacy-decision-planner',
    role: 'assistant',
    content: '夜风掠过灵田，眼前无人等待回应。',
    recommendedActions: legacyChoices
  });

  assert.deepEqual(filterLegacyRuntimeFallbackActions(legacyChoices), []);
  assert.equal(findByClass(article, 'recommended-actions'), undefined);
});

test('source-less historical planner choices stay hidden even when their wording looks plausible', () => {
  const { controller } = createHarness();
  const article = controller.createMessageNode({
    id: 'assistant/source-less-planner',
    role: 'assistant',
    content: '月光渐沉，丹田异动仍在继续。',
    recommendedActions: [
      '继续留在青石上，感受这缕气息的变化',
      '趁夜返回杂役院舍，把异象藏在心里',
      '仔细查看身旁已经异变的回灵草'
    ],
    decisionNode: {
      kind: 'open',
      focus: '月光渐沉，丹田异动仍在继续'
    }
  });

  assert.equal(findByClass(article, 'recommended-actions'), undefined);
});

test('embedded community choices replace stale planned actions with one source-aware panel', () => {
  const { controller } = createHarness({
    presentation: {
      content: '地伶已经离开，丹田异动仍未平息。',
      speaker: '旁白',
      recommendedActions: ['回杂役院舍', '感知丹田异动', '去藏经阁查阅记载', '自定义'],
      recommendedActionPresentation: {
        source: 'community-choice-block',
        title: '天机选项',
        hint: '地伶已经记住你的脸'
      }
    }
  });
  const article = controller.createMessageNode({
    id: 'assistant/community-choice',
    role: 'assistant',
    content: '原始消息',
    recommendedActions: [
      '正面回答旧问题',
      '反问地伶为何要问',
      '暂不回答旧问题'
    ]
  });

  const panels = findAllByClass(article, 'recommended-actions');
  assert.equal(panels.length, 1);
  assert.equal(panels[0].dataset.actionSource, 'community-choice-block');
  assert.equal(findByClass(panels[0], 'recommended-actions-label').textContent, '天机选项');
  assert.equal(findByClass(panels[0], 'recommended-actions-situation').textContent, '地伶已经记住你的脸。');
  assert.deepEqual(
    findAllByClass(panels[0], 'recommendation-button').map((button) => button.dataset.recommendedAction),
    ['回杂役院舍', '感知丹田异动', '去藏经阁查阅记载']
  );
  assert.equal(findByClass(panels[0], 'recommendation-custom-input').placeholder, '写下你自己的回答或行动…');
  assert.equal(findAllByClass(panels[0], 'recommendation-number').at(-1).textContent, '04');
});

test('historical model recommendation drafts stay hidden without rewriting the save', () => {
  const { controller } = createHarness({
    presentation: {
      content: '地伶停在竹林外，等你作出反应。',
      speaker: '旁白',
      recommendedActions: ['低头掩饰异动', '向地伶行礼试探', '退入竹林避开视线'],
      recommendedActionPresentation: {
        source: 'model-recommendation-block',
        title: '',
        hint: ''
      }
    }
  });
  const article = controller.createMessageNode({
    id: 'assistant/historical-model-choice',
    role: 'assistant',
    content: '旧消息正文与隐藏选项块',
    recommendedActions: [
      '正面回应未明确现身的问题',
      '反问未明确现身为何要问',
      '确认未明确现身的态度与目的'
    ]
  });

  assert.equal(findByClass(article, 'recommended-actions'), undefined);
});

test('explicit model recommended-actions replace stale planner templates', () => {
  const { controller } = createHarness({
    presentation: {
      content: '地伶停在竹林外，等你作出反应。',
      speaker: '旁白',
      recommendedActions: ['低头掩饰异动', '向地伶行礼试探', '退入竹林避开视线'],
      recommendedActionPresentation: {
        source: 'model-recommended-actions',
        title: '',
        hint: ''
      }
    }
  });
  const article = controller.createMessageNode({
    id: 'assistant/explicit-model-choice',
    role: 'assistant',
    content: '旧消息正文与隐藏选项块',
    recommendedActions: [
      '正面回应未明确现身的问题',
      '反问未明确现身为何要问',
      '确认未明确现身的态度与目的'
    ],
    decisionNode: { kind: 'direct-response' }
  });

  assert.deepEqual(
    findAllByClass(article, 'recommendation-button').map((button) => button.dataset.recommendedAction),
    ['低头掩饰异动', '向地伶行礼试探', '退入竹林避开视线']
  );
});

test('native action panels describe the current turn before presenting actions', () => {
  const { controller } = createHarness();
  const article = controller.createMessageNode({
    id: 'assistant/current-situation',
    role: 'assistant',
    content: '她停在门外，等待你回答。',
    recommendedActions: ['说明身份', '反问来意', '保持沉默'],
    turnFrame: {
      scene: { summary: '巡山弟子在暮色中发现了你，正隔着灵田等待回应' },
      decision: { kind: 'direct-response', actor: '地伶', focus: '你是哪个堂口的杂役？', requiresPlayerResponse: true }
    }
  });

  assert.equal(
    findByClass(article, 'recommended-actions-situation').textContent,
    '巡山弟子在暮色中发现了你，正隔着灵田等待回应。'
  );
});

test('situation summary rejects damaged decision fragments and falls back to scene status', () => {
  const { controller } = createHarness({
    presentation: {
      content: '月已西沉，回灵草田重新安静下来。',
      speaker: '旁白',
      recommendedActions: ['继续观察', '起身回院舍', '检查灵草'],
      panels: {
        sceneStatus: '夜深霜重，月已西沉，灵田异象正渐渐散入夜色'
      }
    }
  });
  const article = controller.createMessageNode({
    id: 'assistant/damaged-decision',
    role: 'assistant',
    content: '月已西沉，回灵草田重新安静下来。',
    recommendedActions: ['继续观察', '起身回院舍', '检查灵草'],
    recommendedActionPresentation: {
      source: 'model-recommended-actions',
      hint: '选择行动，或在下方自由输入'
    },
    decisionNode: {
      focus: ',facts:[青石温意持续透入脊背,指腹出现银光',
      actor: '地伶',
      requiresPlayerResponse: true
    }
  });

  assert.equal(
    findByClass(article, 'recommended-actions-situation').textContent,
    '夜深霜重，月已西沉，灵田异象正渐渐散入夜色。'
  );
});

test('action panel copy follows character-card context or an explicit card label', () => {
  assert.deepEqual(
    resolveActionPanelPresentation({ name: '沈清秋', scenario: '你身处灵气复苏的仙门秘境。' }),
    {
      tone: 'xianxia',
      title: '命途抉择',
      hint: '选择一条行动，或在下方写下你自己的道途'
    }
  );
  assert.deepEqual(
    resolveActionPanelPresentation({ description: '一场现代都市的怪谈调查。' }),
    {
      tone: 'mystery',
      title: '调查抉择',
      hint: '选择一个调查方向，或在下方自由行动'
    }
  );
  assert.deepEqual(
    resolveActionPanelPresentation({ extensions: { actionLabel: '审讯选择' } }),
    {
      tone: 'custom',
      title: '审讯选择',
      hint: '选择行动，或在下方自由输入'
    }
  );
  assert.deepEqual(resolveActionPanelPresentation({ name: '普通角色' }), {
    tone: 'general',
    title: '轮到你决定',
    hint: '选择行动，或在下方自由输入'
  });
});

test('assistant community panels render as safe native disclosure sections', () => {
  const { controller } = createHarness();
  const article = controller.createMessageNode({
    id: 'assistant/community',
    role: 'assistant',
    content: '她把水杯放在桌边。',
    roleplayPanels: {
      sceneStatus: '时间：下午5:42\n地点：咖啡厅',
      communityComment: '没有硬追问，分寸感尚可。',
      directorNotes: '用户输入较短，本轮需要推进到新的信息节点。'
    }
  });

  const panels = findByClass(article, 'message-community-panels');
  const details = findAllByClass(panels, 'message-community-panel');
  assert.equal(details.length, 3);
  assert.deepEqual(details.map((item) => item.children[0].textContent), ['◷ 场景信息', '🐱 咪咪点评', '◇ 生成记录']);
  assert.match(details[0].children[1].textContent, /下午5:42/);
  assert.match(details[1].children[1].textContent, /分寸感尚可/);
  assert.match(details[2].children[1].textContent, /已从故事正文中分离/);
  assert.doesNotMatch(details[2].children[1].textContent, /用户输入较短/);
});

test('recovered turn-frame messages hide stale missing-structure runtime warnings', () => {
  const { controller } = createHarness({
    presentation: {
      content: '夜风掠过草叶，巡夜灵识已经远去。',
      speaker: '旁白',
      recommendedActions: ['继续躺着', '起身回院舍', '观察丹田'],
      panels: {}
    }
  });
  const article = controller.createMessageNode({
    id: 'assistant/recovered-turn-frame',
    role: 'assistant',
    content: '夜风掠过草叶，巡夜灵识已经远去。',
    turnFrame: { scene: { summary: '巡夜灵识离去' }, decision: { kind: 'open-state' } },
    roleplayPanels: {
      sceneStatus: '地点：回灵草田\n时间：夜',
      runtimeNotice: '本轮未生成结构化交互信息；正文已保留，但人物、关系与场景不会据此自动补写。下一轮将重新校正。'
    }
  });

  assert.ok(findByClass(article, 'message-community-panel-sceneStatus'));
  assert.equal(findByClass(article, 'message-community-panel-runtimeNotice'), undefined);
});

test('historical raw TurnFrame messages hide stale missing-structure runtime warnings', () => {
  const { controller } = createHarness();
  const message = {
    id: 'assistant-historical-turn-frame',
    role: 'assistant',
    content: '可见正文。\n<TurnFrame>{"spec":"lra.narrative-turn-frame/v1"}</TurnFrame>',
    roleplayPanels: {
      runtimeNotice: '本轮未生成结构化交互信息；正文已保留，但人物、关系与场景不会据此自动补写。下一轮将重新校正。'
    }
  };
  const node = controller.createMessageNode(message);
  assert.doesNotMatch(node.textContent, /本轮未生成结构化交互信息/u);
});

test('imported web-search floors become native disclosures and hide their empty thinking preface', () => {
  const { controller, renderCalls } = createHarness();
  const searchMessage = {
    id: 'system/search',
    role: 'system',
    content: '检索到两条庄园档案。',
    extra: { tool_invocations: [{ name: 'WebSearch', displayName: 'Web Search' }] }
  };
  const article = controller.createMessageNode(searchMessage);

  assert.equal(isWebSearchToolMessage(searchMessage), true);
  assert.ok(article.classList.contains('message-auxiliary'));
  assert.equal(findByClass(article, 'message-role').textContent, '检索工具');
  assert.equal(renderCalls.at(-1).visibleContent, '');
  assert.equal(findByClass(article, 'message-community-panel-toolActivity').children[0].textContent, '⌕ 检索记录');
  assert.equal(
    shouldHideAuxiliaryMessage({ role: 'assistant', content: '', extra: { reasoning: '正在搜索' } }, searchMessage),
    true
  );
  assert.equal(
    shouldHideAuxiliaryMessage({ role: 'assistant', content: '正文', extra: { reasoning: '思考' } }, searchMessage),
    false
  );
});
