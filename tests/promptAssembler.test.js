import test from 'node:test';
import assert from 'node:assert/strict';
import { retrieveCards } from '../server/agent/memoryRetriever.js';
import { assemblePrompt } from '../server/agent/promptAssembler.js';
import { estimateTokens } from '../server/agent/token.js';

test('estimateTokens gives non-zero estimate for Chinese text', () => {
  assert.equal(estimateTokens('神荒武界'), 4);
});

test('assemblePrompt includes modules, state, summary, matched world book, and recent messages', () => {
  const result = assemblePrompt({
    promptModules: [
      { id: 'core', title: '核心', enabled: true, content: '保持角色一致。' },
      { id: 'disabled', title: '禁用', enabled: false, content: '不应注入。' },
      { id: 'empty', title: '空内容', enabled: true, content: '   ' }
    ],
    characterCard: {
      name: '沈观澜',
      role: '游侠',
      description: '初入江湖的刀客。',
      personality: '沉稳，重诺。',
      scenario: '正在调查镇武司旧案。',
      exampleDialog: ['用户：你是谁？', '沈观澜：过路人。'],
      extensions: {
        speech: '短句，少解释；遇到旧案时先试探对方知道多少。',
        knowledge: '知道镇武司公开职掌，不知道密档去向。'
      },
      enabled: true
    },
    worldBook: [{
      id: 'wb-1',
      title: '镇武司',
      keywords: ['镇武司'],
      content: '镇武司负责约束江湖武人。',
      priority: 80,
      enabled: true
    }],
    memory: {
      rollingSummary: '主角刚到城中。',
      worldState: { protagonist: { name: '李青' }, location: { current: '云州城' } },
      memoryCards: []
    },
    messages: [
      { role: 'user', content: '我走进云州城。' },
      { role: 'assistant', content: '城门外风雪未歇。' }
    ],
    userMessage: '我要去镇武司附近打探消息。',
    options: { recentPairs: 4, maxInjectedCards: 3 }
  });

  assert.equal(result.messages.at(-1).role, 'user');
  assert.equal(result.messages.at(-1).content, '我要去镇武司附近打探消息。');
  assert.equal(result.injectedCards.length, 1);
  assert.ok(result.messages.some((message) => /保持角色一致/.test(message.content)));
  assert.match(result.messages[0].content, /# 角色卡/);
  assert.match(result.messages[0].content, /沈观澜/);
  assert.match(result.messages[0].content, /正在调查镇武司旧案/);
  assert.match(result.messages[0].content, /# 角色演绎契约/);
  assert.match(result.messages[0].content, /短句，少解释/);
  assert.match(result.messages[0].content, /不知道密档去向/);
  assert.match(result.messages[0].content, /只模仿风格特征，不逐句复述示例/);
  assert.match(result.messages[0].content, /# 沉浸式呈现契约/);
  assert.match(result.messages[0].content, /<special_status>/);
  assert.match(result.messages[0].content, /<recommended_actions>/);
  assert.match(result.messages[0].content, /必须在回复正文之后给出 3 个行动建议/);
  assert.match(result.messages[0].content, /不要把“自定义”作为第四个伪选项/);
  assert.match(result.messages[0].content, /当前决策节点/);
  assert.match(result.messages[0].content, /叙述中的比喻、光影、衣饰、声调和动作修辞不是独立线索/);
  assert.match(result.messages[0].content, /不得用“观察周围”/);
  assert.match(result.messages[0].content, /玩家主角：李青/);
  assert.match(result.messages[0].content, /当前演绎角色：沈观澜/);
  assert.match(result.messages[0].content, /本轮玩家已明确的行动或问题：我要去镇武司附近打探消息/);
  assert.match(result.messages[0].content, /角色卡与当前已启用世界书.*最高事实源/);
  assert.ok(result.messages.some(m => /镇武司负责约束江湖武人/.test(m.content)));
  assert.match(result.messages[0].content, /云州城/);
  assert.match(result.messages[0].content, /主角刚到城中。/);
  assert.ok(result.messages.some((message) => message.content === '我走进云州城。'));
  assert.ok(result.messages.some((message) => message.content === '城门外风雪未歇。'));
  assert.deepEqual(result.sections.promptModules, ['core']);
  assert.equal(result.sections.hasCharacterCard, true);
  assert.equal(result.sections.responseLengthMode, 'balanced');
  assert.equal(result.sections.roleplayMode, 'dm');
  assert.match(result.messages[0].content, /# 角色扮演流派（标准 DM 叙事流）/);
  assert.match(result.messages.at(-2).content, /# 本轮正文篇幅与推进契约（标准推进）/);
  assert.match(result.messages.at(-2).content, /900-1400 个中文字符/);
});

test('assemblePrompt forwards World Info name and minimum-activation settings to the runtime', () => {
  const result = assemblePrompt({
    promptModules: [],
    characterCard: { name: '沈观澜', enabled: true },
    persona: { enabled: true, name: '林舟' },
    worldBook: [
      {
        id: 'named-user',
        title: '点名触发',
        keywords: [String.raw`/\x01林舟:[^\x01]*?开门/`],
        content: '林舟正在门前。',
        enabled: true
      },
      {
        id: 'old-clue',
        title: '旧案',
        keywords: ['旧案'],
        content: '旧案发生在十年前。',
        extensions: { scan_depth: 1, scan_depth_inherited: true },
        enabled: true
      }
    ],
    memory: { memoryCards: [] },
    messages: [
      { role: 'user', content: '旧案的卷宗已经封存。' },
      { role: 'assistant', content: '先看眼前。' }
    ],
    userMessage: '请替我开门。',
    options: {
      maxInjectedCards: 5,
      maxRecursionDepth: 0,
      worldBookScanDepth: 1,
      worldBookMinActivations: 2,
      worldBookMinActivationsDepthMax: 3,
      worldBookIncludeNames: true
    }
  });

  assert.deepEqual(new Set(result.injectedCards.map((card) => card.id)), new Set(['named-user', 'old-clue']));
  assert.deepEqual(result.sections.worldBookActivation.minimumActivationIds, ['old-clue']);
  assert.equal(result.sections.worldBookActivation.scan.includeNames, true);
  assert.equal(result.sections.worldBookActivation.scan.reachedDepth, 3);
});

test('assemblePrompt applies a native roleplay mode independently of route stability', () => {
  const result = assemblePrompt({
    promptModules: [],
    characterCard: { name: '阿月', enabled: true },
    worldBook: [],
    memory: { memoryCards: [] },
    messages: [],
    userMessage: '继续。',
    options: { narrativeMode: 'strict', roleplayMode: 'director' }
  });

  assert.match(result.messages[0].content, /# 叙事路线锁（严格模式）/);
  assert.match(result.messages[0].content, /# 角色扮演流派（导演 \/ 共创流）/);
  assert.equal(result.sections.narrativeMode, 'strict');
  assert.equal(result.sections.roleplayMode, 'director');
});

test('mind-influence cards preserve gradual conflict instead of instant personality deletion', () => {
  const result = assemblePrompt({
    promptModules: [],
    characterCard: {
      name: '催眠都市',
      scenario: '主角能够施加催眠暗示。',
      postHistoryInstructions: '受影响者会服从明确的指导指令。',
      enabled: true
    },
    worldBook: [{
      id: 'hypnosis-rules',
      title: '催眠规则',
      content: '催眠影响认知，但必须保留角色原本的性格。',
      constant: true,
      enabled: true
    }],
    memory: {
      worldState: {
        characters: [{ name: '沈悦', status: '催眠等级：Lv.1' }]
      },
      memoryCards: []
    },
    messages: [],
    userMessage: '我要求她先回答一个问题。'
  });

  const progression = result.messages.find((message) => /# 心智渐变与本心冲突契约/.test(message.content));
  assert.ok(progression);
  assert.match(progression.content, /当前世界状态已明确记录影响等级为「Lv\.1」/);
  assert.match(progression.content, /外在动作仍不得被写成心悦诚服或人格已被抹除/);
  assert.match(progression.content, /每回合最多推进一个可观察的心理节拍/);
  assert.equal(result.sections.psychologicalProgression.applies, true);
  assert.equal(result.sections.psychologicalProgression.knownStage, 'Lv.1');
});

test('assemblePrompt keeps the ensemble time guard after the core prompt is budgeted', () => {
  const result = assemblePrompt({
    promptModules: [{ id: 'large', title: '大型预设', enabled: true, content: '文风约束。'.repeat(1800) }],
    characterCard: { name: '剧情容器', enabled: true },
    worldBook: [],
    memory: {
      simulation: { calendar: { weekdayNumber: 1 } },
      worldState: {
        protagonist: { name: '刘一' },
        characters: [{ name: '周媛', role: '同事', encountered: true }, { name: '沈悦', role: '教师', encountered: true }],
        obligations: [{ from: '刘一', to: '周媛', type: '周五赴约', details: '周五下班后在地铁站会合。' }]
      },
      characterRegistry: {
        records: [
          { name: '刘一', kind: 'protagonist', profile: {} },
          { name: '周媛', kind: 'discovered-npc', profile: { role: '同事' } },
          { name: '沈悦', kind: 'discovered-npc', profile: { role: '教师' } }
        ]
      },
      memoryCards: []
    },
    messages: [
      { role: 'assistant', content: '周媛发来消息。' },
      { role: 'assistant', content: '周媛仍在等待。' },
      { role: 'assistant', content: '周媛的约定尚未到期。' },
      { role: 'user', content: '继续在街上走走' }
    ],
    userMessage: '',
    activationContext: { generationType: 'continue' },
    options: { maxPromptTokens: 2600, recentPairs: 2 }
  });

  const ensembleMessage = result.messages.find((message) => /# 群像与时间调度契约 v1/.test(message.content));
  assert.ok(ensembleMessage);
  assert.match(ensembleMessage.content, /周媛的周五（约 4 个世界日后）/);
  assert.match(ensembleMessage.content, /焦点冷却：周媛/);
  assert.equal(result.sections.narrativeEnsemble.focusCooldown.name, '周媛');
});

test('continuation keeps the latest real player utterance despite newer hidden continue signals', () => {
  const messages = [
    { role: 'user', content: '我把钥匙交给沈观澜，请她先检查暗门。' },
    { role: 'assistant', content: '沈观澜接过钥匙，停在暗门前。' },
    ...Array.from({ length: 6 }, (_, index) => [
      { role: 'user', content: '（请继续推进剧情）', hiddenFromChat: true },
      { role: 'assistant', content: `暗门后的回声第 ${index + 1} 次发生变化。` }
    ]).flat()
  ];
  const result = assemblePrompt({
    promptModules: [{ id: 'more-dialogue', title: '对话增多', enabled: true, content: '增加 NPC 对白。' }],
    characterCard: { name: '沈观澜', enabled: true },
    worldBook: [],
    memory: { memoryCards: [] },
    messages,
    userMessage: '',
    activationContext: { generationType: 'continue' },
    options: { maxPromptTokens: 4000, recentPairs: 2, roleplayMode: 'dm' }
  });

  const allContent = result.messages.map((message) => message.content).join('\n');
  assert.match(allContent, /我把钥匙交给沈观澜，请她先检查暗门/);
  assert.match(allContent, /最近真实玩家输入：我把钥匙交给沈观澜，请她先检查暗门/);
  assert.match(allContent, /只推进一个世界反馈节拍/);
  assert.equal(result.messages.some((message) => (
    message.role === 'user' && message.content === '（请继续推进剧情）'
  )), false);
  assert.equal(result.sections.historyBudget.latestUserAnchorIncluded, true);
  assert.equal(result.sections.interactionContract.semantics.requestsMoreDialogue, true);
  assert.ok(result.tokenEstimate <= 4000);
});

test('assemblePrompt injects the validated relationship subgraph', () => {
  const result = assemblePrompt({
    promptModules: [],
    characterCard: { name: '刘一', enabled: true },
    worldBook: [],
    memory: {
      memoryCards: [],
      knowledgeGraph: {
        nodes: [
          { id: 'c1', label: '刘一' },
          { id: 'c2', label: '江小鲤' }
        ],
        edges: [{ source: 'c1', target: 'c2', type: 'TRUSTS', label: '逐渐信任' }]
      }
    },
    messages: [],
    userMessage: '继续。'
  });

  assert.equal(result.sections.hasKnowledgeGraph, true);
  assert.match(result.messages[0].content, /# 当前场景关系子图/);
  assert.match(result.messages[0].content, /刘一 → 江小鲤：逐渐信任/);
});

test('assemblePrompt injects source-backed episodic memory without exposing CoT', () => {
  const result = assemblePrompt({
    promptModules: [],
    characterCard: { name: '闻雪照', enabled: true },
    worldBook: [],
    memory: { memoryCards: [] },
    memoryContext: {
      summaryHits: [{
        id: 'summary:chapter:1',
        summaryLevel: 'chapter',
        title: '云州旧案第一章',
        summary: '闻雪照已经确认失踪名单与镇武司有关。',
        sourceMessageIds: ['u0', 'a0']
      }],
      episodicHits: [{
        id: 'episode:a1',
        title: '镇武司旧案',
        summary: '闻雪照从卷宗中找到了失踪者名单。',
        scene: '云州城',
        sourceMessageIds: ['u1', 'a1']
      }],
      decisionRecords: [{
        decision: '名单仍需与世界书记载交叉核验。',
        policy: '角色卡与世界书优先',
        evidenceMessageIds: ['a1']
      }],
      audit: { episodicCount: 1, summaryCount: 1, vectorCount: 0, graphRevision: 0 }
    },
    messages: [],
    userMessage: '继续调查名单。'
  });

  assert.match(result.messages[0].content, /# 召回的长期情节记忆/);
  assert.match(result.messages[0].content, /不是模型思维链/);
  assert.match(result.messages[0].content, /章节摘要·云州旧案第一章/);
  assert.match(result.messages[0].content, /闻雪照从卷宗中找到了失踪者名单/);
  assert.match(result.messages[0].content, /证据:u1,a1/);
  assert.match(result.messages[0].content, /角色卡与世界书优先/);
  assert.doesNotMatch(result.messages[0].content, /<think>|chainOfThought|内部推演/);
  assert.deepEqual(result.sections.memoryRetrieval, {
    episodicCount: 1,
    summaryCount: 1,
    vectorCount: 0,
    graphRevision: 0
  });
});

test('community preset budgeting preserves variable setup and output protocol in preset sequence', () => {
  const presetExtension = (sequence) => ({
    sillyTavernPreset: { presetTitle: '大型社区预设', sourceFormat: 'sillytavern-preset', sequence }
  });
  const result = assemblePrompt({
    promptModules: [
      {
        id: 'body', title: '写作模式', enabled: true, extensions: presetExtension(3),
        content: `${'正文规则。'.repeat(450)}\n{{getvar::a}}{{getvar::b}}{{getvar::c}}{{getvar::d}}`
      },
      {
        id: 'output', title: '开始设定', enabled: true, extensions: presetExtension(2),
        content: '最终回复的根节点必须是 <dream_plot>，正文放在 <dream_body> 中。'
      },
      {
        id: 'vars', title: '变量初始化', enabled: true, extensions: presetExtension(1),
        content: '{{setvar::a::1}}{{setvar::b::2}}{{setvar::c::3}}{{setvar::d::4}}'
      },
      {
        id: 'decorative', title: '可选装饰', enabled: true, extensions: presetExtension(4),
        content: '次要装饰。'.repeat(40)
      }
    ],
    characterCard: { name: '测试角色', enabled: true },
    worldBook: [],
    memory: { memoryCards: [] },
    messages: [],
    userMessage: '继续。',
    options: { maxPromptTokens: 8000 }
  });

  assert.deepEqual(result.sections.promptModules.slice(0, 3), ['vars', 'output', 'body']);
  assert.ok(result.messages.some((message) => /<dream_plot>/.test(message.content)));
  assert.equal(result.sections.promptVariableWrites.appliedCount, 4);
});

test('coherence-sensitive community preset is suppressed instead of retaining a broken variable fragment', () => {
  const presetExtension = (sequence) => ({
    sillyTavernPreset: { presetTitle: '变量依赖预设', sourceFormat: 'sillytavern-preset', sequence }
  });
  const result = assemblePrompt({
    promptModules: Array.from({ length: 19 }, (_, index) => ({
      id: `variable-${index}`,
      title: `变量段 ${index}`,
      enabled: true,
      content: index === 18
        ? '{{getvar::story.voice}}最终输出必须带特殊标记。'
        : `{{setvar::story.voice::第${index}段}}`,
      extensions: presetExtension(index)
    })),
    characterCard: { name: '测试角色', enabled: true },
    worldBook: [],
    memory: { memoryCards: [] },
    messages: [],
    userMessage: '继续。',
    options: { maxPromptTokens: 8000 }
  });

  const allContent = result.messages.map((message) => message.content).join('\n');
  assert.doesNotMatch(allContent, /最终输出必须带特殊标记/);
  assert.equal(result.sections.communityPresetIntegrity.preflightSuppressed.length, 1);
  assert.equal(result.sections.communityPresetIntegrity.preflightSuppressed[0].reason, 'module-limit-would-split-variable-chain');
});

test('prompt budgeting protects the last two complete turns before optional community preset modules', () => {
  const presetExtension = (sequence) => ({
    sillyTavernPreset: { presetTitle: '超大社区预设', sourceFormat: 'sillytavern-preset', sequence }
  });
  const messages = Array.from({ length: 12 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user',
    content: `历史${index}：${'连续事实'.repeat(80)}`
  }));
  const result = assemblePrompt({
    promptModules: Array.from({ length: 30 }, (_, index) => ({
      id: `optional-${index}`,
      title: `可选润色 ${index}`,
      enabled: true,
      content: `可选文风约束 ${index}。${'修饰语'.repeat(180)}`,
      extensions: presetExtension(index)
    })),
    characterCard: { name: '测试角色', enabled: true },
    worldBook: [],
    memory: { memoryCards: [] },
    messages,
    userMessage: '承接刚才的行动。',
    options: { maxPromptTokens: 4000, recentPairs: 6 }
  });

  const allContent = result.messages.map((message) => message.content).join('\n');
  for (const index of [8, 9, 10, 11]) assert.match(allContent, new RegExp(`历史${index}：`));
  assert.equal(result.sections.historyBudget.protectedTurns, 2);
  assert.equal(result.sections.promptModuleBudget.moduleLimit, 18);
  assert.equal(result.sections.promptModuleBudget.excessiveActiveModules, true);
  assert.ok(Number(result.sections.totalPromptBudget.omittedKinds['preset-system'] || 0) > 0);
  assert.ok(result.tokenEstimate <= 4000);
});

test('tight prompt budgets retain one high-value narrative preset rule without exposing CoT', () => {
  const presetExtension = (sequence) => ({
    sillyTavernPreset: { presetTitle: '社区叙事预设', sourceFormat: 'sillytavern-preset', sequence }
  });
  const messages = [
    { role: 'user', content: `先前行动：${'追查线索。'.repeat(90)}` },
    { role: 'assistant', content: `先前结果：${'线索指向旧宅。'.repeat(90)}` },
    { role: 'user', content: `当前行动：${'进入旧宅。'.repeat(90)}` },
    { role: 'assistant', content: `当前结果：${'门后传来脚步。'.repeat(90)}` }
  ];
  const result = assemblePrompt({
    promptModules: [
      {
        id: 'narrative-progress', title: '叙事推进基准', enabled: true,
        content: `每轮都要承接既有事实并推进一个可观察事件。${'不要复述。'.repeat(90)}`,
        extensions: presetExtension(1)
      },
      {
        id: 'cot-draft', title: 'COT 思维链草稿', enabled: true,
        content: `输出内部思维链。${'逐步推理。'.repeat(120)}`,
        extensions: presetExtension(2)
      },
      ...Array.from({ length: 20 }, (_, index) => ({
        id: `decorative-${index}`, title: `可选装饰 ${index}`, enabled: true,
        content: `修辞装饰 ${index}。${'华丽词藻。'.repeat(80)}`,
        extensions: presetExtension(index + 3)
      }))
    ],
    characterCard: { name: '闻雪照', enabled: true },
    worldBook: [{
      id: 'old-house', title: '旧宅规则', constant: true, enabled: true,
      content: `旧宅的门只能从内侧打开。${'这是已确认事实。'.repeat(100)}`
    }],
    memory: { memoryCards: [] },
    messages,
    userMessage: '继续进入旧宅。',
    options: { maxPromptTokens: 3000, recentPairs: 2 }
  });

  const allContent = result.messages.map((message) => message.content).join('\n');
  assert.ok(result.sections.retainedPromptModuleIds.includes('narrative-progress'));
  assert.doesNotMatch(allContent, /输出内部思维链|逐步推理/);
  assert.match(allContent, /旧宅的门只能从内侧打开/);
  assert.match(allContent, /当前结果：/);
  assert.ok(result.tokenEstimate <= 3000);
});

test('scenario-container cards bind personality to worldbook NPCs instead of the root card', () => {
  const result = assemblePrompt({
    promptModules: [],
    characterCard: {
      name: '绝世仙宗',
      role: '个人创作主角',
      personality: '日常能躺则躺，说话做事以最省力为原则。',
      scenario: '某位长老正在突破。',
      sourceSpec: 'chara_card_v3',
      extensions: {
        local_roleplay_agent: {
          enrichment: { generatedFields: ['personality', 'scenario', 'exampleDialog'] }
        }
      },
      enabled: true
    },
    worldBook: [
      { id: 'sifu-base', title: '丝苻_基础信息', keywords: ['丝苻'], content: '丝苻身穿红色长袍，正在观察刘一。', enabled: true },
      { id: 'zhuqing-base', title: '竹青_基础信息', keywords: ['竹青'], content: '竹青性情慵懒。', enabled: true },
      { id: 'yaotai-base', title: '瑶台_基础信息', keywords: ['瑶台'], content: '瑶台修炼寒功。', enabled: true }
    ],
    memory: { memoryCards: [] },
    messages: [],
    userMessage: '我看向丝苻。'
  });

  assert.equal(result.sections.characterContentMode, 'scenario-container');
  assert.match(result.messages[0].content, /# 多角色场景卡/);
  assert.match(result.messages[0].content, /不是可直接发言的单一角色/);
  assert.doesNotMatch(result.messages[0].content, /日常能躺则躺/);
  assert.doesNotMatch(result.messages[0].content, /某位长老正在突破/);
  assert.doesNotMatch(result.messages[0].content, /本轮可用角色：绝世仙宗/);
  assert.match(result.messages[0].content, /本轮可用角色：丝苻/);
  assert.ok(result.messages.some((message) => /# 多角色压缩索引/.test(message.content)));
  assert.deepEqual(result.sections.castIndex.names, ['丝苻', '竹青', '瑶台']);
  assert.ok(result.messages.some((message) => /丝苻身穿红色长袍/.test(message.content)));
});

test('scenario-container root scenario is never promoted to a global opening fact', () => {
  const result = assemblePrompt({
    promptModules: [],
    characterCard: {
      name: '绝世仙宗',
      scenario: '某位单独 NPC 正在渡劫，这是导入残留字段。',
      firstMessage: '刘一在杂役院醒来。',
      enabled: true
    },
    worldBook: [
      { id: 'diling', title: '地伶_基础信息', keywords: ['地伶'], content: '地伶是真传弟子。', enabled: true },
      { id: 'luoyu', title: '洛玉_人物档案', keywords: ['洛玉'], content: '洛玉负责执法。', enabled: true },
      { id: 'yaotai', title: '瑶台_角色设定', keywords: ['瑶台'], content: '瑶台修炼寒功。', enabled: true }
    ],
    memory: { worldState: { protagonist: { name: '刘一' } }, memoryCards: [] },
    messages: [],
    userMessage: '继续。'
  });
  const allContent = result.messages.map((message) => message.content).join('\n');

  assert.equal(result.sections.characterContentMode, 'scenario-container');
  assert.match(allContent, /主角锚点：刘一/);
  assert.doesNotMatch(allContent, /某位单独 NPC 正在渡劫/);
  assert.doesNotMatch(allContent, /开局条件：/);
});

test('community preset governance reports conflicting exclusive variables', () => {
  const preset = (sequence) => ({
    sillyTavernPreset: { presetTitle: '冲突预设', sourceFormat: 'sillytavern-preset', sequence }
  });
  const result = assemblePrompt({
    promptModules: [
      { id: 'short', title: '短篇', enabled: true, content: '{{setvar::word_count::300-500}}', extensions: preset(1) },
      { id: 'long', title: '长篇', enabled: true, content: '{{setvar::word_count::1200-2000}}', extensions: preset(2) }
    ],
    characterCard: { name: '测试角色', enabled: true },
    worldBook: [],
    memory: { memoryCards: [] },
    messages: [],
    userMessage: '继续。',
    options: { maxPromptTokens: 8000 }
  });

  assert.deepEqual(result.sections.promptModuleBudget.conflicts.map((item) => item.variable), ['word_count']);
});

test('near-turn response contract wins over a shorter preset unless the user asks otherwise', () => {
  const result = assemblePrompt({
    promptModules: [{
      id: 'short-output',
      title: '社区短篇格式',
      enabled: true,
      content: '每次回复控制在 300-500 字。'
    }],
    characterCard: { name: '阿月', enabled: true },
    worldBook: [],
    memory: { memoryCards: [] },
    messages: [],
    userMessage: '继续处理眼前冲突。',
    options: { responseLength: 'long', roleplayMode: 'director' }
  });

  assert.ok(result.messages.some((message) => /300-500 字/.test(message.content)));
  assert.match(result.messages.at(-2).content, /2000-3200 个中文字符/);
  assert.match(result.messages.at(-2).content, /与正文篇幅冲突的规则，以本契约为准/);
  assert.equal(result.sections.responseLengthMode, 'long');
});

test('assemblePrompt applies prompt-only regex rules by message role without changing display rules', () => {
  const result = assemblePrompt({
    promptModules: [],
    characterCard: { name: '闻雪照', enabled: true },
    worldBook: [],
    memory: { worldState: {}, memoryCards: [] },
    persona: { enabled: true, name: '旅人' },
    lightFrontend: {
      regexTransforms: [
        {
          id: 'user-secret',
          pattern: '秘密',
          replacement: '{{user}}的隐情',
          placement: 1,
          promptOnly: true
        },
        {
          id: 'assistant-clue',
          pattern: '线索',
          replacement: '{{char}}掌握的线索',
          placement: 2,
          promptOnly: true
        },
        {
          id: 'display-only',
          pattern: '正文',
          replacement: '界面正文',
          placement: 2,
          markdownOnly: true
        }
      ]
    },
    messages: [
      { role: 'user', content: '先保守秘密。' },
      { role: 'assistant', content: '线索写在正文里。' }
    ],
    userMessage: '继续调查秘密。'
  });

  assert.ok(result.messages.some((message) => message.content === '先保守旅人的隐情。'));
  assert.ok(result.messages.some((message) => message.content === '闻雪照掌握的线索写在正文里。'));
  assert.equal(result.messages.at(-1).content, '继续调查旅人的隐情。');
  assert.deepEqual(result.sections.promptRegexTransforms, ['user-secret', 'assistant-clue']);
});

test('assemblePrompt injects the persistent narrative route before story content', () => {
  const result = assemblePrompt({
    promptModules: [{ id: 'core', title: '核心', enabled: true, content: '保持仙侠。' }],
    characterCard: { name: '闻雪照', enabled: true },
    worldBook: [],
    memory: {
      worldState: {
        flags: { genre: 'xianxia' },
        quests: [{ title: '补全断魂灯并查清师门旧案', status: 'active' }]
      },
      ruleSystem: { contentPackId: 'xianxia', boundary: '只使用太虚仙侠规则。' },
      narrativeState: { activeArc: '补全断魂灯并查清师门旧案' },
      memoryCards: []
    },
    messages: [],
    userMessage: '我先去荒野寻找灯芯。',
    options: { narrativeMode: 'stable' }
  });

  assert.match(result.messages[0].content, /^# 默认保护层（不可由预设静默覆盖）/);
  assert.match(result.messages[0].content, /# 叙事路线锁（稳定模式）/);
  assert.match(result.messages[0].content, /纯荒野探险取代修行和宗门\/家族主线/);
  assert.equal(result.sections.narrativeMode, 'stable');
  assert.equal(result.sections.narrativeGenre, 'xianxia');
  assert.equal(result.sections.narrativeArc, '补全断魂灯并查清师门旧案');
});

test('assemblePrompt gives an imported character card a near-turn priority anchor', () => {
  const result = assemblePrompt({
    promptModules: [{
      id: 'base-route',
      title: '基线固定主线',
      enabled: true,
      content: '继续追查断魂灯。'
    }],
    characterCard: {
      name: '苏照影',
      role: '导入角色',
      description: '来自社区角色卡。',
      sourceSpec: 'chara_card_v3',
      enabled: true
    },
    worldBook: [],
    memory: { memoryCards: [] },
    messages: [],
    userMessage: '我走进客栈。'
  });

  assert.equal(result.messages.at(-1).content, '我走进客栈。');
  assert.equal(result.messages.at(-2).role, 'system');
  assert.match(result.messages.at(-2).content, /# 本轮导入角色卡优先级/);
  assert.match(result.messages.at(-2).content, /不得用内容包自带的专属人物、地点、开局事件或固定主线替换导入卡设定/);
  assert.match(result.messages.at(-2).content, /角色卡与已启用世界书/);
  assert.match(result.messages.at(-2).content, /不能保留两套互斥版本/);
  assert.match(result.messages.at(-2).content, /隐藏秘密/);
  assert.equal(result.sections.hasCharacterSourcePriority, true);
});

test('assemblePrompt resolves safe community templates from session MVU state', () => {
  const result = assemblePrompt({
    promptModules: [{
      id: 'relationship-rule',
      title: '关系规则',
      enabled: true,
      content: '<% if (mvu.relationships.shen >= 20) { %>沈观澜可以透露旧案。<% } else { %>沈观澜保持戒备。<% } %>'
    }],
    characterCard: { name: '沈观澜', enabled: true },
    worldBook: [],
    memory: {
      lightFrontendState: { enabled: true, values: { relationships: { shen: 25 } }, revision: 1 },
      memoryCards: []
    },
    messages: [],
    userMessage: '我询问旧案。'
  });

  const allContent = result.messages.map((message) => message.content).join('\n');
  assert.match(allContent, /沈观澜可以透露旧案/);
  assert.doesNotMatch(allContent, /沈观澜保持戒备/);
  assert.doesNotMatch(allContent, /<%/);
});

test('assemblePrompt preserves SillyTavern prompt roles, sequence, and in-chat depth', () => {
  const presetMeta = (sequence) => ({
    sillyTavernPreset: {
      presetTitle: '测试预设',
      sourceFormat: 'sillytavern-preset',
      sequence
    }
  });
  const result = assemblePrompt({
    promptModules: [
      { id: 'legacy', title: '本地规则', enabled: true, content: '保留本地系统规则。' },
      {
        id: 'st-relative-user',
        title: '用户侧预设',
        enabled: true,
        content: '以用户身份注入的预设。',
        role: 'user',
        position: 'relative',
        extensions: presetMeta(1)
      },
      {
        id: 'st-depth-assistant',
        title: '历史助手预设',
        enabled: true,
        content: '深度一的助手预设。',
        role: 'assistant',
        position: 'in_chat',
        depth: 1,
        order: 20,
        extensions: presetMeta(3)
      },
      {
        id: 'st-depth-system',
        title: '历史系统预设',
        enabled: true,
        content: '深度一的系统预设。',
        role: 'system',
        position: 'in_chat',
        depth: 1,
        order: 10,
        extensions: presetMeta(2)
      }
    ],
    characterCard: { name: '沈观澜', enabled: true },
    worldBook: [],
    memory: { memoryCards: [] },
    messages: [
      { role: 'user', content: '上一轮用户消息。' },
      { role: 'assistant', content: '上一轮助手消息。' }
    ],
    userMessage: '当前用户消息。'
  });

  assert.match(result.messages[1].content, /保留本地系统规则/);
  assert.doesNotMatch(result.messages[0].content, /以用户身份注入的预设/);
  assert.doesNotMatch(result.messages[0].content, /深度一的系统预设/);
  assert.deepEqual(
    result.messages
      .filter((message) => [
        '以用户身份注入的预设。',
        '上一轮用户消息。',
        '上一轮助手消息。',
        '深度一的系统预设。',
        '深度一的助手预设。',
        '当前用户消息。'
      ].includes(message.content))
      .map((message) => [message.role, message.content]),
    [
      ['user', '以用户身份注入的预设。'],
      ['user', '上一轮用户消息。'],
      ['assistant', '上一轮助手消息。'],
      ['system', '深度一的系统预设。'],
      ['assistant', '深度一的助手预设。'],
      ['user', '当前用户消息。']
    ]
  );
  assert.match(result.messages.at(-2).content, /# 本轮正文篇幅与推进契约/);
  assert.deepEqual(result.sections.promptPlacement, {
    system: ['legacy'],
    relative: ['st-relative-user'],
    inChat: ['st-depth-system', 'st-depth-assistant']
  });
});

test('retrieveCards ignores cards without keyword matches', () => {
  const card = {
    id: 'wb-1',
    title: '镇武司',
    keywords: ['镇武司'],
    content: '镇武司负责约束江湖武人。',
    priority: 100,
    enabled: true
  };

  assert.deepEqual(retrieveCards({ query: '无关文本', worldBook: [card], memoryCards: [] }), []);
});

test('retrieveCards ignores disabled cards and cards with empty content', () => {
  const disabledCard = {
    id: 'disabled',
    title: '禁用',
    keywords: ['镇武司'],
    content: '不应返回。',
    priority: 100,
    enabled: false
  };
  const emptyCard = {
    id: 'empty',
    title: '空内容',
    keywords: ['镇武司'],
    content: '   ',
    priority: 100,
    enabled: true
  };

  assert.deepEqual(retrieveCards({ query: '镇武司', worldBook: [disabledCard], memoryCards: [emptyCard] }), []);
});

test('retrieveCards caps results with maxCards', () => {
  const cards = [
    cardFixture({ id: 'first', title: 'First', priority: 30 }),
    cardFixture({ id: 'second', title: 'Second', priority: 20 }),
    cardFixture({ id: 'third', title: 'Third', priority: 10 })
  ];

  const result = retrieveCards({ query: '镇武司', worldBook: cards, maxCards: 2 });

  assert.deepEqual(result.map((card) => card.id), ['first', 'second']);
});

test('retrieveCards prefers higher priority when keyword hits are equal', () => {
  const result = retrieveCards({
    query: '镇武司',
    worldBook: [
      cardFixture({ id: 'low', title: 'Low', priority: 10 }),
      cardFixture({ id: 'high', title: 'High', priority: 90 })
    ]
  });

  assert.deepEqual(result.map((card) => card.id), ['high', 'low']);
});

test('retrieveCards keeps direct character matches ahead of higher-score recursive matches', () => {
  const result = retrieveCards({
    query: '江小鲤走进客栈。',
    maxCards: 2,
    maxRecursionDepth: 1,
    worldBook: [
      cardFixture({
        id: 'direct-character',
        title: '江小鲤',
        keywords: ['江小鲤'],
        priority: 10,
        content: '江小鲤认识虞清寒与雷横。'
      }),
      cardFixture({
        id: 'recursive-one',
        title: '虞清寒',
        keywords: ['虞清寒'],
        priority: 1000,
        content: '虞清寒的背景。'
      }),
      cardFixture({
        id: 'recursive-two',
        title: '雷横',
        keywords: ['雷横'],
        priority: 900,
        content: '雷横的背景。'
      })
    ]
  });

  assert.deepEqual(result.map((card) => card.id), ['direct-character', 'recursive-one']);
});

test('retrieveCards honors SillyTavern recursion exclusion flags', () => {
  const cards = [
    cardFixture({
      id: 'direct-source',
      title: '直接线索',
      keywords: ['客栈'],
      content: '客栈里有人提到虞清寒。'
    }),
    cardFixture({
      id: 'excluded-recursive',
      title: '虞清寒',
      keywords: ['虞清寒'],
      content: '不应通过递归激活。',
      extensions: { exclude_recursion: true }
    })
  ];

  assert.deepEqual(
    retrieveCards({ query: '我走进客栈。', worldBook: cards, maxRecursionDepth: 1 }).map((card) => card.id),
    ['direct-source']
  );
  assert.deepEqual(
    retrieveCards({ query: '我寻找虞清寒。', worldBook: cards, maxRecursionDepth: 1 }).map((card) => card.id),
    ['excluded-recursive']
  );
});

test('retrieveCards does not use prevent_recursion entries as recursive trigger text', () => {
  const result = retrieveCards({
    query: '我走进客栈。',
    maxRecursionDepth: 1,
    worldBook: [
      cardFixture({
        id: 'non-recursive-source',
        title: '客栈线索',
        keywords: ['客栈'],
        content: '虞清寒正在楼上。',
        extensions: { prevent_recursion: true }
      }),
      cardFixture({
        id: 'recursive-target',
        title: '虞清寒',
        keywords: ['虞清寒'],
        content: '不应被上一条内容递归触发。'
      })
    ]
  });

  assert.deepEqual(result.map((card) => card.id), ['non-recursive-source']);
});

test('retrieveCards supports regex matching', () => {
  const result = retrieveCards({
    query: '沈观澜踏入第七层，听见刀鸣。',
    worldBook: [cardFixture({
      id: 'regex-card',
      title: '境界层数',
      matchMode: 'regex',
      regex: ['第[一二三四五六七八九十]+层'],
      keywords: [],
      content: '层数代表秘境深度。'
    })]
  });

  assert.deepEqual(result.map((card) => card.id), ['regex-card']);
});

test('retrieveCards supports mixed keyword and regex triggers', () => {
  const mixedCard = cardFixture({
    id: 'mixed-card',
    title: '武道境界',
    matchMode: 'keyword',
    keywords: ['境界', '突破'],
    regex: ['第[一二三四五六七八九十]+境'],
    content: '境界体系会影响战力判断。'
  });

  assert.deepEqual(
    retrieveCards({ query: '我想打听境界划分。', worldBook: [mixedCard] }).map((card) => card.id),
    ['mixed-card']
  );
  assert.deepEqual(
    retrieveCards({ query: '对方似乎已入第七境。', worldBook: [mixedCard] }).map((card) => card.id),
    ['mixed-card']
  );
});

test('retrieveCards supports selective secondary-key logic', () => {
  const selective = cardFixture({
    id: 'selective-card',
    title: '镇武司暗牢',
    keywords: ['镇武司'],
    secondaryKeywords: ['暗牢'],
    logic: 'selective'
  });

  assert.deepEqual(retrieveCards({ query: '我去镇武司门口。', worldBook: [selective] }), []);
  assert.deepEqual(
    retrieveCards({ query: '我去镇武司暗牢。', worldBook: [selective] }).map((card) => card.id),
    ['selective-card']
  );
});

test('retrieveCards always returns constant entries', () => {
  const result = retrieveCards({
    query: '无关文本',
    worldBook: [cardFixture({ id: 'constant-card', title: '常驻设定', keywords: [], constant: true })]
  });

  assert.deepEqual(result.map((card) => card.id), ['constant-card']);
});

test('retrieveCards logic=NOT triggers when keyword absent', () => {
  const card = cardFixture({
    id: 'not-card',
    title: '非战斗场景',
    keywords: ['战斗', '厮杀'],
    logic: 'not',
    content: '未发生战斗时触发。'
  });

  // 关键词未出现 → 触发
  assert.deepEqual(
    retrieveCards({ query: '我在茶馆喝茶。', worldBook: [card] }).map((c) => c.id),
    ['not-card']
  );
  // 关键词出现 → 不触发
  assert.deepEqual(retrieveCards({ query: '茶馆爆发了战斗。', worldBook: [card] }), []);
});

test('retrieveCards logic=NOT ALL triggers unless all keywords hit', () => {
  const card = cardFixture({
    id: 'not-all-card',
    title: '非完整组合',
    keywords: ['甲', '乙'],
    logic: 'not all',
    content: '未同时命中甲和乙时触发。'
  });

  // 仅命中甲 → 触发
  assert.deepEqual(
    retrieveCards({ query: '只有甲。', worldBook: [card] }).map((c) => c.id),
    ['not-all-card']
  );
  // 同时命中 → 不触发
  assert.deepEqual(retrieveCards({ query: '甲和乙都在。', worldBook: [card] }), []);
});

test('retrieveCards logic=ALL requires all keywords', () => {
  const card = cardFixture({
    id: 'all-card',
    title: '组合触发',
    keywords: ['甲', '乙'],
    logic: 'all',
    content: '需甲乙同时命中。'
  });

  assert.deepEqual(retrieveCards({ query: '只有甲。', worldBook: [card] }), []);
  assert.deepEqual(
    retrieveCards({ query: '甲和乙都在。', worldBook: [card] }).map((c) => c.id),
    ['all-card']
  );
});

test('retrieveCards regex mode with caseSensitive', () => {
  const card = cardFixture({
    id: 'case-regex',
    title: '英文大小写',
    matchMode: 'regex',
    regex: ['^[A-Z]'],
    caseSensitive: true,
    keywords: [],
    content: '以大写字母开头时触发。'
  });

  assert.deepEqual(
    retrieveCards({ query: 'Hello', worldBook: [card] }).map((c) => c.id),
    ['case-regex']
  );
  assert.deepEqual(retrieveCards({ query: 'hello', worldBook: [card] }), []);
});

test('retrieveCards invalid regex does not crash', () => {
  const card = cardFixture({
    id: 'bad-regex',
    title: '无效正则',
    matchMode: 'regex',
    regex: ['[未闭合'],
    keywords: [],
    content: '正则不合法时应安全跳过。'
  });

  assert.deepEqual(retrieveCards({ query: '任何文本', worldBook: [card] }), []);
});

test('assemblePrompt renders world book entries by insertion depth', () => {
  const result = assemblePrompt({
    promptModules: [],
    characterCard: { name: '沈观澜', enabled: true },
    worldBook: [
      cardFixture({ id: 'depth-2', title: '浅层伏笔', content: '两轮内要记得的伏笔。', depth: 2 }),
      cardFixture({ id: 'depth-6', title: '深层设定', content: '六轮内仍要保留的设定。', depth: 6 })
    ],
    memory: { worldState: {}, memoryCards: [] },
    messages: [],
    userMessage: '镇武司',
    options: { maxInjectedCards: 4 }
  });

  assert.ok(result.messages.some(m => /Depth 2/.test(m.content)));
  assert.ok(result.messages.some(m => /两轮内要记得的伏笔/.test(m.content)));
  assert.ok(result.messages.some(m => /Depth 6/.test(m.content)));
  assert.ok(result.messages.some(m => /六轮内仍要保留的设定/.test(m.content)));
});

test('assemblePrompt reserves room for triggered world simulation entries and blocks executable controllers', () => {
  const result = assemblePrompt({
    promptModules: [],
    characterCard: { name: '九渊行者', enabled: true },
    worldBook: [{
      id: 'calendar-law',
      title: '渊历法则',
      content: '当前渊候会影响修行、物价、伤势与人物日程。'.repeat(80),
      constant: true,
      enabled: true
    }, {
      id: 'npc-controller',
      title: '在场NPC生成引擎',
      content: '<% if (state.location) { %>推进人物日程<% } %>',
      constant: true,
      enabled: true
    }, {
      id: 'market-trigger',
      title: '边境墟市经济',
      keywords: ['墟市'],
      content: '边境封锁导致飞票贬值，物价与过境税随势力关系变化。',
      enabled: true,
      depth: 2
    }],
    memory: { worldState: { location: { current: '边境墟市' } }, memoryCards: [] },
    messages: [],
    userMessage: '我进入墟市打听粮价。',
    options: {
      maxInjectedCards: 4,
      maxWorldBookTokens: 120,
      maxConstantWorldBookEntryTokens: 72,
      maxWorldBookEntryTokens: 48
    }
  });

  assert.ok(result.sections.injectedCardIds.includes('market-trigger'));
  assert.equal(result.sections.injectedCardIds.includes('npc-controller'), false);
  assert.ok(result.sections.injectedCardIds.includes('community-runtime-compatibility-contract'));
  assert.ok(result.messages.some((message) => /飞票贬值/.test(message.content)));
  assert.equal(result.sections.worldBookBudget.playableCompilation.blockedCount, 1);
  assert.ok(result.sections.worldBookBudget.usedTokens <= 120);
});

test('assemblePrompt keeps protagonist and rule anchors ahead of equally-ranked presentation entries', () => {
  const result = assemblePrompt({
    promptModules: [],
    characterCard: { name: '场景容器', role: '个人创作主角', enabled: true },
    worldBook: [{
      id: 'style',
      title: '叙事文风',
      content: '保持抒情。'.repeat(80),
      constant: true,
      priority: 80,
      insertionOrder: 1,
      enabled: true
    }, {
      id: 'protagonist',
      title: '主角',
      content: '刘一是唯一由玩家控制的主角。'.repeat(20),
      constant: true,
      priority: 80,
      insertionOrder: 20,
      enabled: true
    }, {
      id: 'world-rule',
      title: '世界规则',
      content: '能力与后果必须遵守既定规则。'.repeat(20),
      constant: true,
      priority: 80,
      insertionOrder: 30,
      enabled: true
    }],
    memory: { worldState: { protagonist: { name: '刘一' } }, memoryCards: [] },
    messages: [],
    userMessage: '继续。',
    options: { maxWorldBookTokens: 180, maxConstantWorldBookEntryTokens: 56 }
  });

  assert.ok(result.sections.injectedCardIds.includes('protagonist'));
  assert.ok(result.sections.injectedCardIds.includes('world-rule'));
  assert.ok(result.messages.some((message) => /刘一是唯一由玩家控制/.test(message.content)));
  assert.match(result.messages.map((message) => message.content).join('\n'), /刘一：当前主角/);
});

test('assemblePrompt budgets constant world book entries by authored priority and insertion order', () => {
  const result = assemblePrompt({
    promptModules: [],
    characterCard: { name: '九渊行者', enabled: true },
    worldBook: [{
      id: 'late-variable-protocol',
      title: '变量输出协议',
      content: '变量输出协议。'.repeat(200),
      constant: true,
      priority: 80,
      insertionOrder: 200,
      enabled: true
    }, {
      id: 'core-world-law',
      title: '世界法则',
      content: '世界法则优先成立。'.repeat(200),
      constant: true,
      priority: 80,
      insertionOrder: 10,
      enabled: true
    }],
    memory: { worldState: {}, memoryCards: [] },
    messages: [],
    userMessage: '继续。',
    options: {
      maxWorldBookTokens: 120,
      maxConstantWorldBookEntryTokens: 48
    }
  });

  assert.equal(result.sections.injectedCardIds[0], 'core-world-law');
  assert.ok(result.messages.some((message) => /世界法则优先成立/.test(message.content)));
});

test('assemblePrompt injects enabled normalized memory facts and ignores disabled facts', () => {
  const result = assemblePrompt({
    promptModules: [],
    characterCard: { name: '沈观澜', enabled: true },
    worldBook: [],
    memory: {
      worldState: {},
      memoryCards: [
        {
          id: 'fact-enabled',
          title: '名刀雪照',
          keywords: ['雪照'],
          content: '沈观澜持有名刀雪照。',
          enabled: true
        },
        {
          id: 'fact-disabled',
          title: '错误事实',
          keywords: ['雪照'],
          content: '这条禁用事实不应出现。',
          enabled: false
        },
        '雪照曾在镇武司旧案中出现。'
      ]
    },
    messages: [],
    userMessage: '我查看雪照刀身。',
    options: { maxInjectedCards: 5 }
  });

  assert.ok(result.messages.some(m => /沈观澜持有名刀雪照。/.test(m.content)));
  assert.ok(!result.messages.some(m => /雪照曾在镇武司旧案中出现。/.test(m.content)));
  assert.ok(!result.messages.some(m => /这条禁用事实不应出现。/.test(m.content)));
  assert.deepEqual(result.sections.injectedCardIds, ['fact-enabled']);
});

test('retrieveCards sorts equal scores by title', () => {
  const result = retrieveCards({
    query: '镇武司',
    worldBook: [
      cardFixture({ id: 'beta', title: 'Beta', priority: 50 }),
      cardFixture({ id: 'alpha', title: 'Alpha', priority: 50 })
    ]
  });

  assert.deepEqual(result.map((card) => card.id), ['alpha', 'beta']);
});

test('retrieveCards handles null inputs as empty defaults', () => {
  assert.deepEqual(retrieveCards(), []);
  assert.deepEqual(retrieveCards({ query: '镇武司', worldBook: null, memoryCards: null }), []);
});

test('assemblePrompt handles null collections and still appends final user message', () => {
  let result;
  assert.doesNotThrow(() => {
    result = assemblePrompt({
      promptModules: null,
      worldBook: null,
      memory: null,
      messages: null,
      userMessage: '继续前进。'
    });
  });

  assert.equal(result.messages.at(-1).role, 'user');
  assert.equal(result.messages.at(-1).content, '继续前进。');
  assert.deepEqual(result.injectedCards, []);
  assert.deepEqual(result.sections.promptModules, []);
});

test('assemblePrompt filters migration placeholders, resolves preset variables, and enforces the total budget', () => {
  const result = assemblePrompt({
    promptModules: [
      {
        id: 'preset-variables',
        title: '变量初始化',
        enabled: true,
        content: '{{setvar::mode::director}}\n当前模式：{{getvar::mode}}'
      },
      {
        id: 'migration-placeholder',
        title: '旧模块占位',
        enabled: true,
        content: '本占位不参与运行，内容已迁移到主核。'
      },
      {
        id: 'large-support',
        title: '辅助规则',
        enabled: true,
        content: '辅助剧情约束。'.repeat(500)
      }
    ],
    characterCard: { name: '沈观澜', enabled: true },
    worldBook: [{
      id: 'large-worldbook',
      title: '镇武司',
      keywords: ['镇武司'],
      content: '镇武司世界设定。'.repeat(500),
      enabled: true
    }],
    memory: {
      rollingSummary: '过去剧情摘要。'.repeat(300),
      worldState: {
        relationships: Array.from({ length: 30 }, (_, index) => ({ name: `人物${index}`, trust: index })),
        timeline: Array.from({ length: 40 }, (_, index) => ({ turn: index, event: '旧事件'.repeat(20) }))
      },
      memoryCards: []
    },
    messages: Array.from({ length: 20 }, (_, index) => ({
      role: index % 2 ? 'assistant' : 'user',
      content: `历史消息${index}：${'内容'.repeat(100)}`
    })),
    userMessage: '继续调查镇武司。',
    options: { maxPromptTokens: 4000, recentPairs: 10, maxInjectedCards: 4 }
  });

  const allContent = result.messages.map((message) => message.content).join('\n');
  assert.ok(result.tokenEstimate <= 4000, `token estimate ${result.tokenEstimate} should fit the configured budget`);
  assert.match(allContent, /镇武司世界设定/);
  assert.doesNotMatch(allContent, /\{\{\s*(setvar|addvar|incvar|decvar)\s*::/i);
  assert.doesNotMatch(allContent, /本占位不参与运行/);
  assert.equal(result.sections.promptVariableWrites.unresolvedCount, 0);
  assert.equal(result.sections.promptVariableWrites.appliedCount, 1);
  assert.deepEqual(result.sections.promptModuleBudget.noopIds, ['migration-placeholder']);
  assert.ok(result.sections.worldStateBudget.afterTokens <= 360);
  assert.ok(result.sections.totalPromptBudget.afterTokens <= 4000);
});

test('assemblePrompt excludes unused alternate openings and bounds large simulation prompts', () => {
  const result = assemblePrompt({
    promptModules: [{ id: 'core', title: '核心', enabled: true, content: '保持人物连续。' }],
    characterCard: {
      name: '江小鲤',
      role: '青梅',
      description: '与主角一同长大。',
      firstMessage: '实际开场文本。',
      alternateGreetings: ['未选中的超长备用开场。'.repeat(1000)],
      enabled: true
    },
    worldBook: [{
      id: 'direct-role',
      title: '江小鲤当前关系',
      keywords: ['江小鲤'],
      content: '江小鲤仍在观察主角是否值得信任。',
      enabled: true
    }],
    memory: {
      worldState: { protagonist: { name: '林青阳' } },
      memoryCards: [],
      simulation: {
        actors: Array.from({ length: 16 }, (_, index) => ({
          id: `actor-${index}`,
          name: `人物${index}`,
          role: '场景人物',
          goals: ['独立目标'.repeat(80)],
          publicKnowledge: ['公开信息'.repeat(100)],
          privateKnowledge: ['私有信息'.repeat(100)]
        })),
        systems: {
          topology: {
            nodes: Array.from({ length: 20 }, (_, index) => ({
              id: `node-${index}`,
              name: `地点${index}`,
              summary: '地点规则'.repeat(120)
            }))
          }
        }
      }
    },
    messages: [{ role: 'assistant', content: '已经采用实际开场并进入正文。' }],
    userMessage: '江小鲤现在怎么想？',
    options: { maxPromptTokens: 4000, maxInjectedCards: 3 }
  });

  const allContent = result.messages.map((message) => message.content).join('\n');
  assert.ok(result.tokenEstimate <= 4000);
  assert.doesNotMatch(allContent, /未选中的超长备用开场/);
  assert.doesNotMatch(allContent, /实际开场文本/);
  assert.match(allContent, /江小鲤仍在观察主角是否值得信任/);
  assert.deepEqual(result.sections.retainedInjectedCardIds, ['direct-role']);
  assert.match(allContent, /沉浸式呈现契约/);
  assert.match(allContent, /动作协议/);
});

test('assemblePrompt threads generation, character, and additional-source context into world book activation', () => {
  const result = assemblePrompt({
    promptModules: [],
    characterCard: {
      name: '沈观澜',
      description: '左腕留有冷月印。',
      tags: ['武侠'],
      enabled: true
    },
    worldBook: [{
      id: 'continue-note',
      title: '续写阶段线索',
      keywords: ['冷月印'],
      content: '续写时应继续追踪冷月印的来源。',
      enabled: true,
      extensions: {
        triggers: ['continue'],
        match_character_description: true,
        character_filter: { names: ['沈观澜'], tags: ['武侠'], isExclude: false }
      }
    }, {
      id: 'normal-note',
      title: '普通生成线索',
      keywords: ['冷月印'],
      content: '本条只应在普通生成中出现。',
      enabled: true,
      extensions: {
        triggers: ['normal'],
        match_character_description: true
      }
    }],
    memory: { memoryCards: [] },
    messages: [],
    userMessage: '',
    activationContext: { seed: 'continue-test', generationType: 'continue' }
  });

  assert.ok(result.sections.injectedCardIds.includes('continue-note'));
  assert.equal(result.sections.injectedCardIds.includes('normal-note'), false);
  assert.deepEqual(result.sections.worldBookActivation.suppressed.generationTypeIds, ['normal-note']);
  assert.equal(result.sections.worldBookActivation.context.generationType, 'continue');
  assert.ok(result.messages.some((message) => /继续追踪冷月印/.test(message.content)));
});

test('assemblePrompt falls back to character card character_book.token_budget when maxWorldBookTokens is unset', () => {
  // SillyTavern V2 规范：character_book.token_budget 限制世界书注入总 token。
  // 当用户未显式配置 maxWorldBookTokens 时，应回退到卡片作者声明的预算。
  const largeContent = '世界书条目内容。'.repeat(120);
  const result = assemblePrompt({
    promptModules: [],
    characterCard: {
      name: '带预算卡',
      enabled: true,
      extensions: {
        local_roleplay_agent: {
          worldBook: { tokenBudget: 100 }
        }
      }
    },
    worldBook: [{
      id: 'budget-card',
      title: '预算条目',
      content: largeContent,
      constant: true,
      priority: 80,
      insertionOrder: 1,
      enabled: true
    }],
    memory: { worldState: {}, memoryCards: [] },
    messages: [],
    userMessage: '继续。',
    options: { maxConstantWorldBookEntryTokens: 100 }
  });
  assert.ok(result.sections.worldBookBudget.usedTokens <= 100, '世界书总 token 不应超过卡片声明的 token_budget');
});

test('assemblePrompt prefers explicit maxWorldBookTokens over card token_budget', () => {
  const largeContent = '世界书条目内容。'.repeat(120);
  const result = assemblePrompt({
    promptModules: [],
    characterCard: {
      name: '带预算卡',
      enabled: true,
      extensions: {
        local_roleplay_agent: {
          worldBook: { tokenBudget: 100 }
        }
      }
    },
    worldBook: [{
      id: 'budget-card',
      title: '预算条目',
      content: largeContent,
      constant: true,
      priority: 80,
      insertionOrder: 1,
      enabled: true
    }],
    memory: { worldState: {}, memoryCards: [] },
    messages: [],
    userMessage: '继续。',
    options: { maxWorldBookTokens: 200, maxConstantWorldBookEntryTokens: 200 }
  });
  assert.ok(result.sections.worldBookBudget.usedTokens <= 200);
  assert.ok(result.sections.worldBookBudget.maxTokens <= 200);
});

function cardFixture(patch = {}) {
  return {
    id: 'card',
    title: 'Card',
    keywords: ['镇武司'],
    content: '镇武司负责约束江湖武人。',
    priority: 50,
    enabled: true,
    ...patch
  };
}
