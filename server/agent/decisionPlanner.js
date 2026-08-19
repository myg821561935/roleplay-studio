import { isContinuationSignal } from './interactionContract.js';
import {
  buildSceneAffordanceSnapshot,
  resolveAffordanceAnchors,
  summarizeSceneAffordances
} from './sceneAffordancePlanner.js';

export const DECISION_NODE_SPEC = 'lra.narrative-decision-node/v1';

const STRONG_DECISION_KINDS = new Set([
  'direct-response',
  'explicit-choice',
  'immediate-threat',
  'awaiting-player',
  'pending-interaction'
]);

const RESPONSE_ACTION_PATTERN = /(?:回答|回应|应声|答应|接受|拒绝|反问|追问|说明|表态|报明|不答|沉默|现身|开口|出言|喝道|问道|笑道|怒道|厉声|低声|沉声|轻声|冷声|拔剑|抽刀|出手|迎上|退开|避开|闪身|纵身|跃起|跪下|低头|抬头|转身|靠近|退后|站定|抬手|伸手|握拳|咬牙|冷笑|微笑|皱眉|凝视|周旋|拖延|敷衍|掩饰|伪装|假意|佯装|承认|否认|辩解|反驳|质问|控诉|嘲讽|挑衅|威慑|安抚|哄骗|威胁|谈判|交涉|讨价|还价|妥协|让步|坚守|不从|抗命|从命|照做|依言|俯身|行礼|拱手|抱拳|摇头|点头|耸肩|叹息|冷哼|嗤笑|讥诮|嘲弄|奚落|审视|紧盯|瞪视|瞥向|望向|看向|盯住|报上名来|自报家门|一言不发|二话不说|不置可否|不卑不亢|不动声色|不露声色|虚与委蛇|顾左右而言|王顾左右)/u;
const THREAT_ACTION_PATTERN = /(?:躲|避|挡|退|逃|迎击|反击|防守|掩护|寻找|利用|观察|警告|呼救|阻止|拉开距离|闪|掠|窜|滚|扑|跃|纵|拔|抽|斩|劈|刺|挥|扫|拍|轰|击|震|荡|爆|涌|聚|提|运|丹田|元气|真气|内力|身法|步法|刀法|剑法|掌法|拳法|暗器|轻功|内功|外门|凡俗|蜕凡|秘境|法器|符箓|阵法|禁制|反噬|走火|入魔|瓶颈|突破|渡劫|飞升|陨落|重伤|吐血|踉跄|立足不稳|千钧一发|危在旦夕|生死一线|孤注一掷|破釜沉舟|鱼死网破|同归于尽|险中求|富贵险中求)/u;
const INVESTIGATION_ACTION_PATTERN = /(?:检查|观察|比对|询问|试探|触碰|绕开|记录|标记|追踪|调查|确认|寻找|核对|验证|判断|打量|审视|端详|凝视|翻看|翻阅|搜寻|搜索|勘查|勘察|查验|鉴别|辨识|嗅闻|聆听|倾听|感知|感应|探查|探测|鉴定|测量|掂量|擦拭|拂去|拆开|撕开|翻开|撬开|敲了敲|摸了摸|凑近|上前|蹲下|跪下|俯身|侧身|回头|四下扫了一眼)/u;
const NAVIGATION_ACTION_PATTERN = /(?:进入|离开|前往|后退|绕行|查看|观察|试探|停留|折返|靠近|穿|越|翻|跨|迈|走|奔|跑|掠|闪|窜|遁|逃|追|赶|赴|入|出|归|去|到|沿|顺|循着|朝着|望着|盯着|通向|通往|前路|去路|退路|来路|岔路|小径|密道|暗道|走廊|通道|楼梯|石阶|木梯|窗口|门口|门缝|缝隙|阴影|暗处|角落|尽头|深处)/u;
const INTERNAL_PROTOCOL_PATTERN = /(?:recommended_actions|ira-actions|nextcharacterpanel|<\/?(?:think|plot|normal_status|relationship_status|special_status)\b|\[object Object\]|请继续推进剧情)/iu;

/**
 * 把模型候选、本轮结尾和最近会话统一交给一个决策规划器。
 * 规划器只处理“本轮把什么决定权交给玩家”，不负责续写剧情。
 */
export function planRecommendedActions({
  modelActions = [],
  assistantContent = '',
  recentMessages = [],
  memory = {},
  userMessage = '',
  maxActions = 3,
  allowUngroundedModelActions = false,
  characterCard = null,
  groupMembers = [],
  turnFrame = null
} = {}) {
  const userText = String(userMessage?.content || userMessage || '').trim();
  const context = buildDecisionContext({ assistantContent, recentMessages, memory, userText, characterCard, groupMembers, turnFrame });
  const recentActions = collectRecentRecommendedActions(recentMessages);
  const normalizedModelActions = sanitizeActions(modelActions)
    .filter((action) => !wasRecentlyRecommended(action, context, recentActions));
  const alignedModelActions = normalizedModelActions.filter((action) => isActionAligned(action, context));
  // <w2g> / community choice blocks are authored as the current beat's native
  // choices, not free-form suggestions from a second planner. They still pass
  // sanitation, recent-action deduplication and diversity selection, but must
  // not be displaced merely because their wording does not match our generic
  // response-verb lexicon.
  const eligibleModelActions = allowUngroundedModelActions
    ? normalizedModelActions
    : alignedModelActions;
  const generatedActions = generateDecisionActions(context)
    .filter((action) => (
      context.source === 'unresolved-history'
      || !wasRecentlyRecommended(action, context, recentActions)
    ));

  let candidates;
  if (context.kind === 'awaiting-player' && eligibleModelActions.length >= 2) {
    candidates = [...eligibleModelActions, ...generatedActions];
  } else if (STRONG_DECISION_KINDS.has(context.kind)) {
    if (eligibleModelActions.length >= 2) {
      candidates = [...eligibleModelActions, ...generatedActions];
    } else {
      candidates = [...generatedActions, ...eligibleModelActions];
    }
  } else if (
    context.kind === 'open'
    && context.actor === ''
    && !hasActionableAffordances(context.affordances)
    && !(allowUngroundedModelActions && normalizedModelActions.length >= 2)
  ) {
    // A settled descriptive beat is not automatically a player decision.
    // Without a current node or a grounded object/route/capability, generic
    // model suggestions tend to revive an NPC who has already left the scene.
    candidates = [];
  } else if (normalizedModelActions.length >= 2) {
    candidates = [...normalizedModelActions, ...generatedActions];
  } else if (hasActionableAffordances(context.affordances) && generatedActions.length >= 2) {
    candidates = [...generatedActions, ...eligibleModelActions];
  } else {
    candidates = [...eligibleModelActions, ...generatedActions];
  }

  const actions = selectDiverseActions(candidates, Math.max(0, Math.min(3, Number(maxActions) || 3)));
  const actionOptions = actions.map((action) => buildStructuredActionOption(action, context));
  return {
    actions,
    actionOptions,
    decision: {
      spec: DECISION_NODE_SPEC,
      id: decisionNodeId(context),
      kind: context.kind,
      type: context.kind,
      status: 'open',
      priority: context.priority,
      focus: context.focus,
      speechAct: context.speechAct ? String(context.speechAct.type || '') : null,
      actor: context.actor,
      location: context.location,
      blocking: context.blocking === true,
      requiresPlayerResponse: context.requiresPlayerResponse === true,
      urgency: context.urgency || 'normal',
      source: context.source || 'closing-beat',
      candidateIntents: [...new Set(actionOptions.map((option) => option.intent))],
      affordances: summarizeSceneAffordances(context.affordances)
    }
  };
}

export function buildDecisionContext({
  assistantContent = '',
  recentMessages = [],
  memory = {},
  userText = '',
  characterCard = null,
  groupMembers = [],
  turnFrame = null
} = {}) {
  const fullText = normalizeNarrativeText(assistantContent);
  const closing = extractClosingWindow(fullText);
  const acceptedFrame = turnFrame?.validation?.status === 'accepted' ? turnFrame : null;
  const frameNode = decisionNodeFromTurnFrame(acceptedFrame, closing);
  const frameFocus = String(acceptedFrame?.decision?.focus || '').trim();
  const speechAct = speechActFromTurnFrame(acceptedFrame)
    || extractClosingSpeechAct(closing);
  const protagonist = normalizeLabel(
    memory?.worldState?.protagonist?.name
    || memory?.protagonist?.name
    || memory?.persona?.name
  );
  const frameActor = frameNode ? normalizeLabel(acceptedFrame?.decision?.actor) : '';
  let actor = frameActor && (!protagonist || !isSameCharacter(frameActor, protagonist))
    ? frameActor
    : resolveCurrentActor(memory, closing, protagonist);
  if (actor && protagonist && isSameCharacter(actor, protagonist)) {
    actor = '';
  }
  const location = String(acceptedFrame?.scene?.location || '').trim() || resolveCurrentLocation(memory);
  const clauses = extractDecisionClauses(closing);
  const recentUserText = resolveRecentUserText(recentMessages, userText);
  const charTraits = resolveCharTraits(characterCard, groupMembers, actor);
  const affordances = buildSceneAffordanceSnapshot({
    memory,
    assistantContent: closing,
    actor,
    location,
    turnFrame: acceptedFrame
  });
  if (!actor && affordances.actors.length === 1 && (speechAct || isAwaitingPlayer(closing))) {
    const candidate = String(affordances.actors[0]?.label || '').trim();
    if (candidate && (!protagonist || !isSameCharacter(candidate, protagonist))) {
      actor = candidate;
    }
  }
  if (!actor && (speechAct || isAwaitingPlayer(closing))) {
    const candidate = resolveSolePresentActor(memory, protagonist);
    if (candidate && (!protagonist || !isSameCharacter(candidate, protagonist))) {
      actor = candidate;
    }
  }
  const explicitChoice = extractExplicitChoice(closing);
  const openFocus = isVagueAcknowledgement(recentUserText)
    && normalizeComparableText(closing).includes(normalizeComparableText(recentUserText))
    ? ''
    : clauses.at(-1) || compactFocus(closing);
  const base = {
    actor,
    protagonist,
    location,
    closing,
    clauses,
    recentUserText,
    charTraits,
    affordances
  };
  const nodes = [];
  if (frameNode) nodes.push(frameNode);
  if (!frameNode) {
    if (explicitChoice) nodes.push(decisionNode('explicit-choice', 'explicit-choice', 110, explicitChoice, {
      blocking: true,
      requiresPlayerResponse: true,
      urgency: 'critical'
    }));
    if (speechAct) nodes.push(speechActDecisionNode(speechAct));
    if (hasImmediateThreat(closing)) nodes.push(decisionNode('immediate-threat', 'immediate-threat', 105, clauses.at(-1) || compactFocus(closing), {
      blocking: true,
      requiresPlayerResponse: true,
      urgency: 'critical'
    }));
    if (isAwaitingPlayer(closing)) nodes.push(decisionNode('awaiting-player', 'pending-interaction', 70, clauses.at(-1) || compactFocus(closing), {
      blocking: true,
      requiresPlayerResponse: true,
      urgency: 'high'
    }));
    if (hasInvestigationCue(closing, clauses)) nodes.push(decisionNode('investigation', 'new-discovery', 50, clauses.at(-1) || compactFocus(closing)));
    if (hasNavigationCue(closing)) nodes.push(decisionNode('navigation', 'navigation', 40, clauses.at(-1) || compactFocus(closing)));
  }
  // A continuation signal is not an answer. Keep the previous blocking
  // interaction open across a descriptive feedback beat or a newly noticed
  // clue. Only a fresh blocking node (for example an immediate threat, a new
  // direct question, or a real explicit choice) may supersede it.
  const carried = resolveCarriedDecisionNode(recentMessages, userText);
  const hasFreshBlockingNode = nodes.some((node) => node.blocking === true);
  if (carried && !hasFreshBlockingNode) {
    nodes.push({ ...carried, priority: Math.max(120, Number(carried.priority || 0)), source: 'unresolved-history' });
  }
  if (!frameNode) nodes.push(decisionNode('open', 'open-state', 10, openFocus));
  const selected = selectCurrentDecisionNode(nodes);
  const selectedActor = ['direct-response', 'pending-interaction', 'awaiting-player', 'explicit-choice'].includes(selected.kind)
    ? actor
    : '';
  return {
    ...base,
    actor: selectedActor,
    ...selected,
    // A TurnFrame supplies the authoritative node, while the prose/frame
    // classifier supplies its speech-act strategy. Do not let the node's
    // optional null field erase the concrete request/question classification.
    speechAct: selected.speechAct || speechAct,
    detectedNodes: nodes.map(summarizeDecisionNode)
  };
}

function decisionNodeFromTurnFrame(turnFrame, closing = '') {
  if (!turnFrame?.decision) return null;
  const decision = turnFrame.decision;
  const fallbackFrame = turnFrame?.validation?.source === 'conservative-prose-fallback';
  if (fallbackFrame && decision.kind === 'open-state') return null;
  // Conservative fallback frames may summarize visible prose, but they must not
  // invent a player-facing choice that the prose never actually presented.
  // Otherwise a continuation beat can overwrite an unresolved NPC question
  // with a synthetic choice whose actor is the player protagonist.
  if (fallbackFrame && decision.kind === 'explicit-choice' && !extractExplicitChoice(closing)) return null;
  if (decision.kind === 'explicit-choice') {
    const focus = String(decision.focus || '');
    const completeChoice = (isExplicitChoiceText(focus) || extractParallelChoiceOptions(focus).length >= 2)
      && !isHypotheticalChoice(focus, focus);
    if (!completeChoice) return null;
  }
  const kind = decision.kind === 'new-discovery'
    ? 'investigation'
    : decision.kind === 'open-state' ? 'open' : String(decision.kind || 'open');
  return decisionNode(kind, decision.kind || kind, 120, decision.focus || turnFrame.scene?.summary, {
    blocking: decision.requiresPlayerResponse === true,
    requiresPlayerResponse: decision.requiresPlayerResponse === true,
    urgency: decision.urgency || 'normal',
    source: 'turn-frame'
  });
}

function decisionNode(kind, nodeType, priority, focus, options = {}) {
  return {
    kind,
    nodeType,
    priority,
    focus: String(focus || '').trim(),
    speechAct: options.speechAct || null,
    blocking: options.blocking === true,
    requiresPlayerResponse: options.requiresPlayerResponse === true,
    urgency: options.urgency || 'normal',
    source: options.source || 'closing-beat'
  };
}

function speechActDecisionNode(speechAct) {
  if (speechAct.type === 'question') return decisionNode('direct-response', 'direct-question', 100, speechAct.text, {
    speechAct, blocking: true, requiresPlayerResponse: true, urgency: 'high'
  });
  if (speechAct.type === 'command') return decisionNode('pending-interaction', 'command', 98, speechAct.text, {
    speechAct, blocking: true, requiresPlayerResponse: true, urgency: 'high'
  });
  if (speechAct.type === 'request') return decisionNode('pending-interaction', 'request', 85, speechAct.text, {
    speechAct, blocking: true, requiresPlayerResponse: true, urgency: 'high'
  });
  return decisionNode('pending-interaction', 'proposal', 60, speechAct.text, {
    speechAct, blocking: false, requiresPlayerResponse: true, urgency: 'normal'
  });
}

function selectCurrentDecisionNode(nodes) {
  return [...nodes].sort((left, right) => (
    Number(right.blocking) - Number(left.blocking)
    || Number(right.priority || 0) - Number(left.priority || 0)
  ))[0];
}

function summarizeDecisionNode(node) {
  return {
    kind: node.kind,
    type: node.nodeType,
    priority: node.priority,
    blocking: node.blocking === true,
    requiresPlayerResponse: node.requiresPlayerResponse === true
  };
}

function generateDecisionActions(context) {
  const protagonist = normalizeLabel(
    context.protagonist
    || context.memory?.worldState?.protagonist?.name
    || context.memory?.protagonist?.name
    || context.memory?.persona?.name
    || ''
  );
  if (context.actor && protagonist && isSameCharacter(context.actor, protagonist)) {
    context.actor = '';
  }
  let actions;
  switch (context.kind) {
    case 'direct-response':
    case 'pending-interaction':
      actions = buildSpeechActActions(context);
      break;
    case 'explicit-choice':
      actions = buildExplicitChoiceActions(context);
      break;
    case 'immediate-threat':
      actions = buildThreatActions(context);
      break;
    case 'awaiting-player':
      actions = buildAwaitingPlayerActions(context);
      break;
    case 'investigation':
      actions = buildInvestigationActions(context);
      break;
    case 'navigation':
      actions = buildNavigationActions(context);
      break;
    default:
      actions = buildOpenActions(context);
  }
  return enrichActionsWithCharTraits(actions, context.charTraits);
}

/**
 * 根据角色性格特征为模板动作添加角色风格修饰。
 * 不改变动作的核心策略，只在语气和措辞上体现角色特征。
 */
function enrichActionsWithCharTraits(actions, charTraits) {
  if (!charTraits || !Array.isArray(actions)) return actions;
  const { name, personalityBrief, roleBrief } = charTraits;

  // 提取性格关键词，用于判断角色行为倾向
  const traits = String(personalityBrief || '').toLowerCase();
  const isCautious = /谨慎|小心|多疑|沉着|冷静|稳重|隐忍/.test(traits);
  const isBold = /果断|勇猛|鲁莽|直率|豪爽|大胆|无畏/.test(traits);
  const isCunning = /狡猾|聪明|机智|圆滑|深沉|心机|腹黑/.test(traits);

  return actions.map((action, index) => {
    // 根据性格倾向调整语气
    if (isBold && index === 0 && action.startsWith('按')) {
      return action.replace('按', '毫不犹豫地按');
    }
    if (index === 0) return action;

    if (isCautious && index === 1) {
      return action.replace('拒绝', '以谨慎姿态拒绝');
    }
    if (isCunning && action.includes('追问')) {
      return action.replace('追问', '以话术试探追问');
    }

    // 对包含"对方"的动作，如果知道角色名，替换为更具体的称呼
    if (name && action.includes('对方')) {
      return action.replace('对方', name);
    }

    return action;
  });
}

function buildSpeechActActions(context) {
  const speech = context.speechAct || {};
  const rawText = String(speech.text || '').trim();
  const shortText = rawText.length <= 36 && !/[，；。]/u.test(rawText.replace(/[？?!！]$/u, '')) ? rawText : '';
  const quoted = shortText ? `「${shortText}」` : '';
  const protagonist = normalizeLabel(
    context.protagonist
    || context.memory?.worldState?.protagonist?.name
    || context.memory?.protagonist?.name
    || context.memory?.persona?.name
    || ''
  );
  const rawActor = context.actor || '';
  const target = (rawActor && (!protagonist || !isSameCharacter(rawActor, protagonist))) ? rawActor : '对方';
  const hasQuoted = Boolean(quoted);

  // 检查是否包含交代差事/任务性质的指令
  const isTaskCommand = /(?:今日起|明日起|从今往后|往后|打理|顶替|差事|后山|石阶|扫到|照看|莫要|切莫|按时|交代|吩咐|交由你|改由你)/u.test(rawText);

  if (speech.type === 'command') {
    if (isTaskCommand) {
      return [
        `不动声色地应下${target}的吩咐，暗中思索这项差事安排背后是否有何蹊跷`,
        `顺势向${target}打听其中的具体规矩与细节，确认是否有未明说的禁忌`,
        `先按${target}的交代行事，暂不多问，保留随时抽身退避的余地`,
        `委婉探问原由，观察${target}的神色变化与后续反应`
      ];
    }
    if (rawText && /(?:告诉|回答|说清|交代|报上|说明).{0,36}(?:身份|来意|原因|为何|怎么|情况|名字|事情)?/u.test(rawText)) {
      return [
        `如实回应${target}，但只说明自己愿意公开的部分`,
        `只交代已经确认的事实，暂不解释关键来源`,
        `先追问${target}在得到回答后会如何处置，再决定交代多少`,
        '假意配合，只给出一段可核验但不完整的解释'
      ];
    }
    return [
      hasQuoted
        ? `按${quoted}的要求行动，但保留随时停下的余地`
        : `照${target}的要求行动，但保留随时停下的余地`,
      `拒绝立刻照做，要求${target}先说明理由与后果`,
      `暂不行动，追问${target}提出这项要求的真实目的`,
      `只做一个低风险的试探动作，观察${target}会如何反应`
    ];
  }
  if (speech.type === 'request') {
    if (/(?:看看|瞧瞧|查验|验看|端详|再定|定夺)/u.test(rawText)) {
      const focusNoun = extractCleanEntityNoun(context.focus);
      const targetLabel = focusNoun ? quoteFocus(focusNoun) : '水桶与封泥的异样';
      return [
        `依言走上前去，仔细端详${targetLabel}，推敲其中的端倪`,
        `先问${target}看出了什么门道，核对彼此的推测与判断`,
        `不急于贸然凑近，暗中调息并留意${target}与周围的一举一动`
      ];
    }
    return [
      hasQuoted
        ? `答应${quoted}，但先说清自己愿意承担的范围`
        : `答应${target}的请求，但先说清自己愿意承担的范围`,
      `暂不答应，追问${target}提出请求的原因与代价`,
      `提出一个风险更低的替代做法，观察${target}是否接受`,
      `拒绝这项请求，并保留继续交涉的空间`
    ];
  }
  if (speech.type === 'proposal') {
    return [
      hasQuoted
        ? `接受${quoted}，同时明确合作的边界`
        : `接受${target}的提议，同时明确合作的边界`,
      `提出另一套可执行方案，与${target}交换条件`,
      `先追问计划中的风险与分工，再决定是否参与`,
      `拒绝当前提议，按自己的目标继续行动`
    ];
  }
  if (speech.questionKind === 'yes-no') {
    return [
      hasQuoted
        ? `明确答应${quoted}，并说明自己的条件`
        : `明确答应${target}，并说明自己的条件`,
      hasQuoted
        ? `明确拒绝${quoted}，不给${target}代替你决定的空间`
        : `明确拒绝${target}，不给对方代替你决定的空间`,
      `先追问关键条件与代价，再决定如何回答`,
      `暂不表态，观察${target}是否会补充或改变说法`
    ];
  }
  if (speech.questionKind === 'identity') {
    return [
      hasQuoted
        ? `出声回应${quoted}，只说明自己愿意公开的身份与来意`
        : `出声回应${target}，只说明自己愿意公开的身份与来意`,
      `不先报明身份，反问${target}是谁、为何在此`,
      `保持沉默，观察${target}接下来会靠近、等待还是离开`,
      `换到更安全的位置，再制造轻微动静试探${target}的反应`
    ];
  }
  return [
    hasQuoted
      ? `正面回答${quoted}，只说自己已经确认的部分`
      : `正面回应${target}的问题，只说自己已经确认的部分`,
    `保留关键信息，反问${target}为何要问`,
    `给出一个试探性的回答，观察${target}如何接话`,
    `暂不回答，先确认${target}的态度与目的`
  ];
}

function buildExplicitChoiceActions(context) {
  const focus = quoteFocus(context.focus);
  const choices = extractChoiceOptions(context.focus)
    .map((choice) => renderChoiceForPlayer(choice, context.actor));
  if (choices.length >= 2) {
    return [
      `选择${quoteFocus(choices[0])}，并明确自己接受这一方向的条件`,
      `选择${quoteFocus(choices[1])}，同时先问清接下来的处置`,
      '拒绝只在这两个方向中表态，提出第三种可执行方案',
      '暂不选择，先追问两个方向各自的代价与不可逆后果'
    ];
  }
  return [
    `接受${focus}中最直接的方案，并明确自己的条件`,
    `拒绝被现有方案限制，提出另一种可执行的做法`,
    `先追问各个选择的代价与不可逆后果`,
    `暂缓决定，先补齐当前最关键的信息`
  ];
}

function buildThreatActions(context) {
  const focus = quoteFocus(context.focus || '眼前杀机');
  const route = pickAffordance(context, 'routes');
  const object = pickAffordance(context, 'interactables');
  const capability = pickAffordance(context, 'capabilities');
  const item = pickAffordance(context, 'items');
  const defensiveAnchor = item || capability;
  return [
    route
      ? `足尖一点，借${route}的地势斜斜掠开，避开${focus}的正面锋芒，目光始终锁住对手变化`
      : `脚下发力骤然暴退，险之又险地避开${focus}的正面冲击，先保住周旋的余地`,
    defensiveAnchor
      ? `不退反进，暗运${defensiveAnchor}硬接这一击，只守不攻，先摸清对方的路数与代价`
      : `沉腰立马，护住周身要害硬接${focus}，只做足以阻断攻势的动作，绝不冒进`,
    object
      ? `顺势抄起${object}横挡在前，借这一变故阻住${focus}的势头，目光已在搜寻脱身的空隙`
      : `不与硬拼，脚下踩着奇诡步法拉开距离，冷眼观察${focus}的范围与变化，静待反制的破绽`
  ];
}

function buildAwaitingPlayerActions(context) {
  const target = context.actor || '对方';
  const requestedInspection = resolveRequestedInspectionVerb(context.recentUserText);
  if (requestedInspection) {
    const action = requestedInspection;
    return [
      `追问${target}刚才${action}到了什么具体结果`,
      `要求${target}说明${action}过程中为何停手或迟疑`,
      `请${target}换一种风险更低的方式再${action}一次`,
      '只回应其中已经确认的变化，暂不补充关键来源'
    ];
  }
  return [
    `主动回应${target}此刻的等待，说明自己的下一步意图`,
    `先追问${target}尚未说清的部分，再决定行动`,
    `暂不表态，观察${target}会不会暴露更多信息`,
    `提出一个低风险的共同动作，验证双方是否真的能够合作`
  ];
}

function buildInvestigationActions(context) {
  const sceneEvidence = splitSentences(context.closing)
    .flatMap((sentence) => sentence.split(/[，；：]/u))
    .map((clause) => clause.replace(/[“”"‘’']/gu, '').trim())
    .filter((clause) => clause.length >= 4 && clause.length <= 60);
  const clauses = [...new Set([...context.clauses, ...sceneEvidence])];
  const bodyReaction = pickBestEvidenceClause(clauses,
    /(?:丹田|灵根|经脉|心口|掌心|体内|气息|灵气).{0,36}(?:跳|震|热|冷|痛|滞|乱|升温|偏移|倾斜|刺激|异动|变化|反应)/u,
    /(?:距离|靠近|退回|偏移|倾斜|变轻|增强|回到正中)/u);
  const physicalTrace = pickBestEvidenceClause(clauses,
    /(?:痕迹|拖痕|脚印|压伏|倒伏|断口|裂痕|血迹|湿痕|残留)/u,
    /(?:延伸|消失|未止|压伏|倒伏|翻动|踩实)/u);
  const visualAnomaly = pickBestEvidenceClause(clauses,
    /(?:(?:微光|绿光|反光|亮点|光点|影子|阴影|灰影|黑影|人影|轮廓).{0,24}(?:闪|动|掠|晃|出现|消失|隐没|空无)|(?:闪|掠|晃).{0,18}(?:光|影))/u,
    /(?:绿光|微光|转瞬即逝|再次出现|空无一物)/u);
  const fragmentEvidence = pickBestEvidenceClause(clauses,
    /(?:残片|碎片|断片)/u,
    /(?:露出|埋|另一块|一块|更细薄|蓟丛|草丛)/u);

  const traceLabel = summarizeInvestigationEvidence(physicalTrace, 'trace');
  const visualLabel = summarizeInvestigationEvidence(visualAnomaly, 'visual');
  const fragmentLabel = summarizeInvestigationEvidence(fragmentEvidence, 'fragment');
  const bodyLabel = summarizeInvestigationEvidence(bodyReaction, 'body');

  const rawEvidence = visualAnomaly || physicalTrace || fragmentEvidence || context.focus || clauses.at(-1) || '';
  const cleanNoun = extractCleanEntityNoun(rawEvidence);
  const nounLabel = cleanNoun ? quoteFocus(cleanNoun) : '眼前留下的细微异样';

  const actions = [];

  if (bodyReaction && physicalTrace && bodyReaction !== physicalTrace) {
    const traceNoun = extractCleanEntityNoun(physicalTrace) || traceLabel || '那道痕迹';
    actions.push(`先不靠近，借现有光线确认${quoteFocus(traceNoun)}的起点、方向与新旧程度`);
    actions.push(`收敛周身呼吸，分辨${quoteFocus(bodyLabel || '体内气机反应')}是否会随自己靠近那道痕迹而增强`);
    actions.push(`沿现场侧面缓慢绕行，留好退路，暗中查探痕迹尽头究竟通向何处`);
  } else if (cleanNoun) {
    actions.push(`借着周遭陈设与光线遮掩，不动声色地仔细查验${nounLabel}的纹理与走向，验证其留下的端倪`);
    if (context.actor) {
      actions.push(`转头看向${context.actor}，神色如常地出言试探，核对对方是否也曾留意到${nounLabel}的动静`);
    } else {
      actions.push(`不直接触碰可疑之物，暗敛气息退开半步，冷眼观察周围是否有人隐匿在暗处`);
    }
    actions.push(`将眼前的细节默记于心，面上维持如常举止，待时机合适再作进一步查证`);
  } else {
    actions.push(`借着动作掩护，不动声色地仔细查验周遭残留的每一处细微异样，不急于显露端倪`);
    actions.push(`不直接触碰现场任何物件，暗敛气息退开半步，冷眼观察周围是否有人隐匿在暗处`);
    actions.push(`将眼前的细节默记于心，面上维持如常举止，待时机合适再作进一步查证`);
  }

  // 增加视觉异样（如绿光/微光/黑影）备选
  if (visualAnomaly && visualAnomaly !== physicalTrace) {
    actions.push(`先停在原地，观察${quoteFocus(visualLabel || '一闪即逝的微光')}是否再次出现，并记下它与周围痕迹的相对位置`);
  }
  // 增加残片/碎片备选
  if (fragmentEvidence && fragmentEvidence !== physicalTrace) {
    actions.push(`保持现有距离，借着微光仔细辨识${quoteFocus(fragmentLabel || '碎片')}的质地与断口，不直接触碰`);
  }
  // 综合比对多重线索
  if (visualAnomaly && fragmentEvidence && physicalTrace) {
    actions.push(`不再重复靠近旧痕，先比对${quoteFocus(traceLabel || '压伏痕迹')}与${quoteFocus(visualLabel || '微光')}的位置关联，判断它们是否指向同一方向`);
  } else if (visualAnomaly || fragmentEvidence) {
    actions.push(`停止重复试探旧痕，先把已确认的变化与新出现的异常分开，再选择只验证其中一项`);
  }

  return actions;
}

function extractCleanEntityNoun(text) {
  if (!text) return '';
  let s = String(text).replace(/[“”"‘’'「」【】()（）]/gu, '').trim();
  s = s.replace(/^(?:他|她|你|我|众人|自己)?(?:已经|早已|并未|没有|只见|隐约|悄然|暗自|面上)?(?:记下|看见|发现|察觉|注意到|露出|嵌着|留下|传来|递到|握着|拿着|看向|望向|扫过|退回|回到|挪了)/u, '');
  s = s.replace(/(?:的位置|的痕迹|的动静|的模样|的前后|的瞬间|的异样|的去向)$/u, '');
  s = s.trim();
  const nounMatch = s.match(/(?:半片薄泥印子|薄泥印子|泥脚印|云纹靴印|脚印|泥印|铜铃|竹签|旧竹签|石阶|签面|守阁碑|灵田|残片|碎片|断片|血迹|裂痕|湿痕|暗纹|玉牌|短剑|丹药|晨雾|秋棠|录音笔|红灯|敲击声|魂火|古字|浅沟|蓟丛|绿光|微光)/u);
  if (nounMatch) return nounMatch[0];
  if (s.length >= 2 && s.length <= 8 && !/(?:了|过|在|是|有|并|但|却|像|被|一|为|走|站|说|道)/u.test(s)) {
    return s;
  }
  return '';
}

function pickBestEvidenceClause(clauses, required, preferred) {
  return (Array.isArray(clauses) ? clauses : [])
    .map((clause, index) => ({
      clause,
      score: (required.test(clause) ? 10 : 0) + (preferred.test(clause) ? 5 : 0) + index / 1000
    }))
    .filter((entry) => entry.score >= 10)
    .sort((left, right) => right.score - left.score)[0]?.clause || '';
}

function summarizeInvestigationEvidence(value, type) {
  const source = String(value || '').replace(/[。！？；]/gu, '').trim();
  if (!source) return '';
  if (type === 'visual') {
    if (/绿光/u.test(source)) return /枯叶/u.test(source) ? '枯叶底下一闪即逝的淡绿光' : '一闪即逝的淡绿光';
    const match = source.match(/(?:微光|反光|亮点|光点|灰影|黑影|人影|轮廓)/u)?.[0];
    return match ? `短暂出现的${match}` : trimFocus(source, 32);
  }
  if (type === 'fragment') {
    const noun = source.match(/(?:更细薄的)?(?:残片|碎片|断片)/u)?.[0] || '碎片';
    if (/(?:蓟丛|草丛)/u.test(source)) return `草丛下露出的${noun}`;
    return noun;
  }
  if (type === 'trace') {
    if (/草叶被压伏|压伏的痕迹/u.test(source)) return '草叶压伏痕迹';
    return source.match(/(?:浅沟)?拖痕|脚印|倒伏痕迹|裂痕|血迹|湿痕/u)?.[0] || trimFocus(source, 28);
  }
  if (type === 'body') {
    if (/丹田/u.test(source) && /(?:偏移|倾斜|偏左)/u.test(source)) return '随距离改变而偏移的丹田暖意';
    return trimFocus(source, 32);
  }
  return trimFocus(source, 32);
}

function buildNavigationActions(context) {
  const location = context.location ? `在${context.location}中` : '在当前位置';
  const routes = readAffordanceLabels(context, 'routes', 2);
  const firstRoute = routes[0];
  const secondRoute = routes[1];
  return [
    firstRoute
      ? `${location}放轻脚步，先确认${firstRoute}深处传来的动静与风险，再决定是否踏入`
      : `${location}没有贸然前行，而是隐在暗处观察前方去路的虚实，择一条风险最低的方向`,
    secondRoute
      ? `身形一闪，转向${secondRoute}做一次短距离试探，同时留着原路作为随时可退的后手`
      : `停步侧耳聆听，又蹲下身查看地上的痕迹与脚印，确认前方是否有人先一步经过`,
    `没有急着前进，而是沿来路折返，将刚才匆匆一瞥间遗漏的细节再仔细查探一遍`,
    `深吸一口气，脚下踩着极轻的步子向前试探了一小段距离，浑身气机却始终绷着，保留随时折返的余地`
  ];
}

function buildOpenActions(context) {
  const actor = context.actor || '';
  const location = context.location ? `在${context.location}` : '';

  // 检查是否发生物品交接（如竹签、玉简、丹药、钥匙）
  const handoverMatch = String(context.closing || '').match(/(?:竹签|玉牌|令牌|法器|丹药|卷宗|文书|钥匙|书信|短剑|包袱|佩剑|灵石)/u);
  const itemLabel = handoverMatch ? handoverMatch[0] : '';

  if (actor && itemLabel) {
    return [
      `躬身将${itemLabel}妥善收好，顺势向${actor}打听其中细节与近来的规矩禁忌`,
      `不动声色地应下差事，握紧手中${itemLabel}，暗自思索这桩安排背后是否有何深意`,
      `向${actor}点头称是，暂不多问，打算先将手头事务做完，再前往对应地点一探虚实`
    ];
  }

  if (actor) {
    return [
      `${location}沉稳回应${actor}，顺势探问眼下局势的具体缘由与打算`,
      `向${actor}点头示意，面上不露声色，暗自留意对方接下来的举动与神情`,
      `暂不多言，借着手头事务的掩护，静观${actor}与周围局势的变化`
    ];
  }

  return [
    `收敛心神，将刚才发生的所有细节在心中细细梳理，思量接下来的应对之策`,
    `面上维持如常神色，继续按部就班处理当下事务，暗中留意周围动向`,
    `暗自调息并检查随身所携之物，为接下来的变故提前做好防备`
  ];
}

function extractClosingWindow(value) {
  const paragraphs = String(value || '')
    .split(/\n{2,}|\n/u)
    .map((item) => item.trim())
    .filter(Boolean);
  const selected = [];
  let length = 0;
  for (let index = paragraphs.length - 1; index >= 0 && length < 1200; index -= 1) {
    selected.unshift(paragraphs[index]);
    length += paragraphs[index].length;
  }
  return (selected.join('\n') || String(value || '')).slice(-1200);
}

function extractClosingSpeechAct(closing) {
  const source = String(closing || '');
  const matches = [...source.matchAll(/[“"‘']([^”"’'\n]{1,120})(?:[”"’'])/gu)];
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const match = matches[index];
    const text = String(match[1] || '').trim();
    const distanceFromEnd = source.length - ((match.index || 0) + match[0].length);
    // 旧对白后若又推进了数百字并形成新的场景落点，它已经不是当前待回应
    // 的交互。过宽的窗口会把已结束的命令重新抬到最新线索之前。
    if (distanceFromEnd > 420) break;
    const following = source.slice((match.index || 0) + match[0].length);
    if (distanceFromEnd > 160 && /(?:应(?:了)?一声|应声|退出|离开|转身.{0,12}(?:走|去)|随后|不久|片刻后|入夜|夜色)/u.test(following)) {
      continue;
    }
    const laterParagraphs = following.split(/\n+/u).map((item) => item.trim()).filter(Boolean);
    if (laterParagraphs.length >= 2
      && /(?:痕迹|拖痕|压伏|倒伏|脚印|裂痕|血迹|湿痕|丹田|灵根|经脉|体内)/u.test(following.slice(-520))
      && !isAwaitingPlayer(following.slice(-520))) {
      continue;
    }
    const questionText = extractLastQuestion(text);
    if (questionText) {
      if (isNonDecisionQuestion(questionText)) continue;
      if (/(?:我们|咱们).{0,18}(?:一起|联手|同行|合作).{0,12}(?:如何|怎么样|可好|行吗)/u.test(questionText)
        || /(?:不如|要不).{0,48}(?:如何|怎么样|可好|行吗)/u.test(questionText)) {
        return { type: 'proposal', text: trimFocus(questionText, 72), questionKind: '' };
      }
      return {
        type: 'question',
        text: trimFocus(questionText, 72),
        questionKind: classifyQuestion(questionText)
      };
    }
    if (isPermissiveSpeech(text)) continue;
    if (/(?:^(?:把|给我|你(?:先|立刻|马上|必须|不要|别))|别|不要|必须|立刻|马上|过来|出去|放下|交出|打开|关上|跟我|告诉我|回答|站住|停下|滚开|离开|改由你|归你|由你|你便|你要|莫要|切莫|不可|不得|照看|打理|负责|接下|顶上|前去|过去|扫到|办好|交代|吩咐|照办|准时|切记)/u.test(text)) {
      return { type: 'command', text: trimFocus(text, 72), questionKind: '' };
    }
    if (/^(?:请|能不能|可不可以|能否|麻烦|劳烦|帮我|希望你|我想请你)/u.test(text) || /(?:你(?:先|看看|瞧瞧|来看|去看看|试探|定夺)|看看|瞧瞧|查验|验看|端详|再定|定夺)/u.test(text)) {
      return { type: 'request', text: trimFocus(text, 72), questionKind: '' };
    }
    if (/^(?:不如|要不|我们|咱们)/u.test(text) && /(?:一起|联手|同行|合作|试试|进去|离开)/u.test(text)) {
      return { type: 'proposal', text: trimFocus(text, 72), questionKind: '' };
    }
    // 带有明确人称指派的较长叙述性交代
    if (/(?:今日起|明日起|从今往后|往后|眼下|打理|顶替|莫要|切莫|交代|吩咐|照看)/u.test(text) && /(?:你|去|莫要|不得|不可)/u.test(text)) {
      return { type: 'command', text: trimFocus(text, 72), questionKind: '' };
    }
  }
  return null;
}

function isPermissiveSpeech(value) {
  const text = String(value || '').trim();
  return /(?:你要|若要|想要).{0,32}(?:便|就).{1,32}/u.test(text)
    && /(?:不急|随你|由你|都可|可以|便可|即可)/u.test(text);
}

function speechActFromTurnFrame(turnFrame) {
  const decision = turnFrame?.decision;
  const focus = String(decision?.focus || '').trim();
  if (!focus) return null;
  if (decision.kind === 'direct-response') {
    return { type: 'question', text: trimFocus(focus, 72), questionKind: classifyQuestion(focus) };
  }
  if (decision.kind !== 'pending-interaction') return null;
  const question = extractLastQuestion(focus);
  if (question) return { type: 'question', text: trimFocus(question, 72), questionKind: classifyQuestion(question) };
  if (/(?:你(?:先|看看|瞧瞧|来看|去看看|试探|定夺)|看看|瞧瞧|查验|验看|端详|再定|定夺|请|劳烦|麻烦|帮我)/u.test(focus)) {
    return { type: 'request', text: trimFocus(focus, 72), questionKind: '' };
  }
  if (/(?:^(?:把|给我|你(?:先|立刻|马上|必须|不要|别))|别|不要|必须|立刻|马上|过来|出去|放下|交出|打开|关上|跟我|告诉我|回答|站住|停下|离开|莫要|切莫|不可|不得)/u.test(focus)) {
    return { type: 'command', text: trimFocus(focus, 72), questionKind: '' };
  }
  return { type: 'request', text: trimFocus(focus, 72), questionKind: '' };
}

function extractLastQuestion(value) {
  const sentences = String(value || '')
    .split(/(?<=[。！？?!])/u)
    .map((item) => item.trim())
    .filter(Boolean);
  const question = [...sentences].reverse().find((sentence) => /[？?]/u.test(sentence));
  if (!question) return '';
  const end = Math.max(question.lastIndexOf('？'), question.lastIndexOf('?'));
  return question.slice(0, end + 1).trim();
}

function isNonDecisionQuestion(value) {
  return /^(?:嗯|哦|啊|诶|欸|咦|唔|呵|哈|怎么|什么)[？?]+$/u.test(String(value || '').trim());
}

function classifyQuestion(value) {
  const source = String(value || '');
  if (/(?:谁|何人|哪位|是谁|什么人|哪一个人|在哪里|在哪儿)/u.test(source)) return 'identity';
  if (/(?:吗|是否|能否|可否|愿不愿|要不要|是不是|行不行|可不可以)[？?]?\s*$/u.test(source)) return 'yes-no';
  return 'open';
}

function extractExplicitChoice(closing) {
  const source = String(closing || '');
  const quotedChoices = [...source.matchAll(/[“"‘']([^”"’'\n]{1,180})(?:[”"’'])/gu)]
    .reverse()
    .map((match) => String(match[1] || '').trim());
  const quoted = quotedChoices.find(isExplicitChoiceText)
    || quotedChoices.find((value) => extractParallelChoiceOptions(value).length >= 2
      && /(?:两种|两条|两路|选择|走法|分为|分作)/u.test(source));
  if (quoted && !isHypotheticalChoice(quoted, source)) return quoted;
  const sentences = splitSentences(closing).slice(-6);
  return sentences.reverse().find((sentence) => isExplicitChoiceText(sentence) && !isHypotheticalChoice(sentence, source)) || '';
}

function isHypotheticalChoice(value, context = '') {
  const source = `${value}\n${String(context || '').slice(-420)}`;
  const playerDirected = /(?:由你决定|你来决定|请选择|选择其中|只能选择|给你.*选择|你(?:想|要|选).{1,80}还是)/u.test(source);
  if (/(?:……|\.{3,}|没说下去|不说了|停住话)/u.test(value)) return true;
  const options = extractChoiceOptions(value);
  if (options.length < 2) return true;
  if (playerDirected) return false;
  return /(?:可能|也许|推测|猜测|看来|似乎|大概|原因|情况|要么.{0,80}(?:没有|缺少|不认得|记错|只是))/u.test(source);
}

function isExplicitChoiceText(value) {
  const text = String(value || '');
  if (/(?:……|\.{3,})/u.test(text)) return false;
  return /(?:要么.{1,60}要么|二选一|由你决定|你来决定|请选择|选择其中|只能选择|给你.*选择|(?:是)?想.{1,80}还是(?:想)?|(?:要|选).{1,60}还是(?:要|选)?)/u.test(text);
}

function extractChoiceOptions(value) {
  const source = String(value || '').replace(/[“”"‘’']/gu, '').trim();
  const either = source.match(/要么\s*(.{2,64}?)(?:，|,)?\s*要么\s*(.{2,64}?)(?:[。！？?!…]|$)/u);
  if (either) {
    const list = either.slice(1, 3).map(cleanChoiceOption).filter(Boolean);
    if (list.length >= 2) return list;
  }
  const alternative = source.match(/(?:你)?(?:是)?(?:想|要|选|选择)?\s*(.{2,64}?)(?:，|,)?\s*还是(?:想|要|选|选择)?\s*(.{2,64}?)(?:[。！？?!…]|$)/u);
  if (alternative) {
    const list = alternative.slice(1, 3).map(cleanChoiceOption).filter(Boolean);
    if (list.length >= 2) return list;
  }
  return extractParallelChoiceOptions(source);
}

function extractParallelChoiceOptions(value) {
  const source = String(value || '').replace(/[“”"‘’']/gu, '').trim();
  const parallel = source.match(/((?:踏|走|选|入|向|沿|留|退|进|开|关)[^；;。！？…]{1,60})[；;]\s*((?:踏|走|选|入|向|沿|留|退|进|开|关)[^；;。！？…]{1,60})/u);
  if (!parallel) return [];
  const list = parallel.slice(1, 3).map(cleanChoiceOption).filter(Boolean);
  return list.length >= 2 ? list : [];
}

function cleanChoiceOption(value) {
  const text = trimFocus(String(value || '')
    .replace(/[……\.]/gu, '')
    .replace(/(?:这个答案|由你决定|你来决定).*$/u, '')
    .trim(), 52);
  if (text.length < 2 || /^(?:其他|等等|之类|或|和)$/u.test(text)) return '';
  return text;
}

function renderChoiceForPlayer(value, actor) {
  const target = String(actor || '对方').trim() || '对方';
  return String(value || '')
    .replace(/^让我把你/u, `请${target}将我`)
    .replace(/^让我/u, `请${target}`)
    .replace(/^把你/u, `请${target}将我`)
    .trim();
}

function hasImmediateThreat(closing) {
  const sentences = splitSentences(String(closing || '').slice(-620)).slice(-5);
  let latestThreat = -1;
  let latestResolution = -1;
  sentences.forEach((sentence, index) => {
    if (/(?:停住|退回|缩回|散去|熄灭|黯淡|不再逼近|不再有动静|归于沉寂|已经解除|已被挡下|被化去|落定|平息)/u.test(sentence)) {
      latestResolution = index;
    }
    const figurativeOnly = /(?:像|仿佛|如同|宛如|好似).{0,32}(?:剑锋|刀锋|枪口|火焰|雷霆|野兽)/u.test(sentence)
      && !/(?:逼近|冲来|袭来|扑来|刺来|劈来|砍来|对准|抵住|压住|包围|封死|来不及|倒计时|眼看就要|马上就要|下一瞬(?:便|就|将))/u.test(sentence);
    if (!figurativeOnly && /(?:逼近|冲来|袭来|扑来|刺来|劈来|砍来|即将(?:坍塌|崩塌|爆裂|失控|封闭)|来不及|只剩\s*\d+|倒计时|追兵|火势.{0,16}(?:蔓延|逼近)|坍塌|崩塌|爆裂|失控|封死|马上就要|眼看就要|下一瞬(?:便|就|将)|(?:剑锋|刀锋|枪口).{0,16}(?:逼近|刺来|劈来|对准|抵住|落下))/u.test(sentence)) {
      latestThreat = index;
    }
  });
  return latestThreat > latestResolution;
}

function isAwaitingPlayer(closing) {
  const tail = String(closing || '').slice(-520);
  return /(?:看着你|望向你|等你|等待你的|等你回答|等你决定|没有继续说|把话停住|向你伸出|递到你面前|留给你决定|将选择交给你|(?:在等|只等|等着|等待|等候).{0,20}(?:回应|回答|答复|表态|开口|答案))/u.test(tail);
}

function hasInvestigationCue(closing, clauses) {
  if (!clauses.length) return false;
  const paragraphs = String(closing || '').split(/\n+/u).map((s) => s.trim()).filter(Boolean);
  const lastParagraph = paragraphs.at(-1) || '';
  const sentences = splitSentences(String(closing || ''));
  const lastSentence = sentences.at(-1) || '';

  // 如果最后一段是明确的 NPC 交互、对白等待或交接（例如孙管事递交竹签、主角点头）
  // 并且最后一句没有发生新的物理/灵气异变，则不作为 investigation 夺焦
  const lastHasSpeechOrHandover = /(?:递到.{0,12}面前|接过来|收下|点了点头|对你说道|沉声道|开口道|[“”"‘'][^”"’']{2,}[”"’'])/u.test(lastParagraph)
    && !/(?:痕迹|血迹|异样|碎屑|脚印|压伏|亮起|闪烁|剧痛|异动|拖痕)/u.test(lastSentence);

  if (lastHasSpeechOrHandover) {
    return false;
  }

  const tail = String(closing || '').slice(-680);
  const physicalEvidence = /(?:痕迹|拖痕|压伏|倒伏|异样|异常|残留|残片|碎片|裂痕|血迹|脚印|湿痕|敲击|录音|印记|断口|破损|微光|绿光|亮点|光点|不明气味|不明声响|莫名变化|反常|凭空|突然.{0,18}(?:亮起|闪烁|闪过|熄灭|断裂|移动|响起|震动|开合))/u.test(tail);
  const activeBodyChange = /(?:丹田|灵根|经脉|体内).{0,28}(?:跳|震|发热|发冷|刺痛|滞涩|紊乱|刺激|变化|反应)/u.test(tail)
    && !/(?:异动|变化).{0,12}(?:蛰伏|平息|散去|消失|恢复平静)/u.test(tail);
  return physicalEvidence || activeBodyChange;
}

function hasNavigationCue(closing) {
  const tail = String(closing || '').slice(-620);
  return /(?:出现.{0,12}(?:出口|入口|岔路|通道|楼梯|走廊)|(?:出口|入口|岔路|通道|楼梯|走廊|去路).{0,18}(?:打开|封闭|通往|延伸|分开|出现)|通往|无路可走|可以折返|继续深入|门(?:被|已|忽然|正在)?(?:打开|关上|封死|合拢))/u.test(tail);
}

function extractDecisionClauses(closing) {
  const evidence = /(?:痕迹|拖痕|压伏|倒伏|异样|异常|残留|残片|碎片|裂痕|血迹|脚印|湿痕|敲击|录音|印记|断口|破损|微光|绿光|亮点|光点|不明气味|不明声响|反常|凭空|(?:丹田|灵根|经脉|体内).{0,28}(?:跳|震|热|冷|痛|滞|乱|刺激|异动|变化|反应)|突然)/u;
  const interaction = /(?:(?:只等|等着|等待).{0,18}(?:回应|回答|答复|表态|开口|答案)|递到你面前|将选择交给你|留给你决定|递到他面前)/u;
  return splitSentences(String(closing || '').slice(-420))
    .flatMap((sentence) => sentence.split(/[，；：]/u))
    .map((clause) => clause.replace(/[“”"‘’']/gu, '').trim())
    .filter((clause) => clause.length >= 4 && clause.length <= 72)
    .filter((clause) => evidence.test(clause) || interaction.test(clause))
    .slice(-4)
    .map((clause) => trimFocus(clause, 48));
}

function splitSentences(value) {
  return String(value || '')
    .split(/(?<=[。！？?!])/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function isActionAligned(action, context) {
  if (!isValidAction(action)) return false;
  if (treatsProtagonistAsInteractionTarget(action, context)) return false;
  switch (context.kind) {
    case 'direct-response':
      return RESPONSE_ACTION_PATTERN.test(action);
    case 'pending-interaction':
      return ['engage', 'withhold', 'clarify', 'deceive', 'observe', 'act']
        .includes(classifyActionStrategy(action));
    case 'explicit-choice':
      return isExplicitChoiceActionAligned(action, context);
    case 'awaiting-player':
      return isAwaitingActionAligned(action, context);
    case 'immediate-threat':
      return THREAT_ACTION_PATTERN.test(action);
    case 'investigation':
      return INVESTIGATION_ACTION_PATTERN.test(action);
    case 'navigation':
      return NAVIGATION_ACTION_PATTERN.test(action);
    default:
      return true;
  }
}

function treatsProtagonistAsInteractionTarget(action, context) {
  const protagonist = normalizeLabel(context?.protagonist);
  if (!protagonist || !String(action || '').includes(protagonist)) return false;
  const escaped = protagonist.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:回应|回答|询问|反问|追问|质问|要求|拒绝|服从|试探|观察|攻击|跟随|靠近|远离|照|向|对).{0,8}${escaped}`, 'u').test(action)
    || new RegExp(`${escaped}.{0,8}(?:提出|要求|命令|询问|目的|态度|反应|接话|说法)`, 'u').test(action);
}

function isExplicitChoiceActionAligned(action, context) {
  const focus = String(context.focus || '');
  if (!focus) return true;
  const choiceOptions = extractChoiceOptions(focus);
  if (choiceOptions.length >= 2) {
    const firstOption = String(choiceOptions[0] || '').trim();
    const secondOption = String(choiceOptions[1] || '').trim();
    const actionText = String(action || '');
    if (actionText.includes(firstOption) || actionText.includes(secondOption)) return true;
    if (/(?:选择|选项|方案|方向|第三种|另一种|替代|拒绝|接受|代价|后果|追问|暂不|提出|条件|交换|破局)/u.test(actionText)) {
      return true;
    }
    return false;
  }
  return true;
}

function isAwaitingActionAligned(action, context) {
  const inspection = resolveRequestedInspectionVerb(context.recentUserText);
  if (!inspection) return true;
  const actor = String(context.actor || '').trim();
  return String(action || '').includes(inspection)
    || /(?:具体结果|探到了什么|查到了什么|为何停手|为何迟疑|发现了什么)/u.test(action)
    || Boolean(actor && String(action || '').includes(actor) && /(?:说明|追问|询问|回应|回答)/u.test(action));
}

function resolveRequestedInspectionVerb(value) {
  const match = String(value || '').match(/(?:请|让|叫)?(?:你|他|她)?\s*(探测|探查|查看|检查|确认|感知|鉴定|试探)/u);
  return match ? match[1] : '';
}

function selectDiverseActions(values, limit) {
  const actions = sanitizeActions(values);
  const selected = [];
  const strategies = new Set();
  for (const action of actions) {
    const strategy = classifyActionStrategy(action);
    if (strategies.has(strategy)) continue;
    selected.push(action);
    strategies.add(strategy);
    if (selected.length >= limit) return selected;
  }
  for (const action of actions) {
    if (selected.includes(action)) continue;
    selected.push(action);
    if (selected.length >= limit) break;
  }
  return selected;
}

function hasActionableAffordances(snapshot) {
  if (!snapshot?.grounded) return false;
  return ['threats', 'routes', 'interactables', 'capabilities', 'items']
    .some((key) => Array.isArray(snapshot[key]) && snapshot[key].length > 0);
}

function readAffordanceLabels(context, key, limit = 4) {
  return (Array.isArray(context?.affordances?.[key]) ? context.affordances[key] : [])
    .map((entry) => String(entry?.label || '').trim())
    .filter(Boolean)
    .slice(0, limit);
}

function pickAffordance(context, key, { preferRelevant = false } = {}) {
  const labels = readAffordanceLabels(context, key, 8);
  if (!labels.length) return '';
  if (!preferRelevant) return labels[0];
  const scene = `${context.closing || ''}\n${context.focus || ''}\n${context.recentUserText || ''}`;
  return labels.find((label) => scene.includes(label)) || '';
}

function classifyActionStrategy(action) {
  if (/(?:假意|佯装|装作|诱导)/u.test(action)) return 'deceive';
  if (/(?:迎击|反击|攻击|拔剑|抽刀|对抗|阻止|硬接|迎上|不退反进|正面迎|悍然|主动迎|出手|动手|斩出|劈出|刺出|挥出|拍出|轰出|击出)/u.test(action)) return 'confront';
  if (/(?:反问|追问|询问|核对|比对)/u.test(action)) return 'clarify';
  if (/(?:拒绝|不答|沉默|暂不|不先报明|绕开|避开|暴退|退开|退后|撤离|离开|抽身|闪退|掠开|窜开|滚开|退走|退避|撤退)/u.test(action)) return 'withhold';
  if (/(?:回答|回应|应声|说明|报明|答应|开口|出言|说道|喊道|问道|笑道|怒道|厉声|低声|沉声|轻声|冷声)/u.test(action)) return 'engage';
  if (/(?:观察|检查|确认|寻找|记录|标记|判断|回看|审视|打量|凝视|紧盯|瞪视|瞥向|望向|看向|盯住|查看|端详|翻看|搜寻|勘查|查验|鉴别|辨识|嗅闻|聆听|倾听|感知|感应|探查|探测|鉴定)/u.test(action)) return 'observe';
  if (/(?:试探|触碰|进入|靠近|行动|利用|阻断|抄起|取出|拿起|举起|挥动|运转|提起|凝聚|催动|施展|步法|身法|纵身|跃起|俯身|蹲下|凑近|上前|侧身|回头|折返|绕行|穿过|越过|跨过|迈进|沿着|循着)/u.test(action)) return 'act';
  return normalizeComparableText(action).slice(0, 12);
}

function buildStructuredActionOption(text, context) {
  const intent = classifyActionStrategy(text);
  const resolvesNode = context.requiresPlayerResponse === true
    && ['engage', 'withhold', 'clarify', 'deceive', 'confront'].includes(intent);
  const anchors = resolveAffordanceAnchors(text, context.affordances);
  return {
    text,
    intent,
    stance: actionStance(intent),
    target: context.actor || context.focus || '',
    worldValid: isActionAligned(text, context),
    playerControlled: !/(?:替你决定|你不由自主|你只能|你必然|对方必然)/u.test(text),
    resolvesNode,
    risk: ['confront', 'deceive'].includes(intent) ? 'high' : intent === 'act' ? 'medium' : 'low',
    anchors,
    groundingSources: [...new Set(anchors.map((anchor) => anchor.source))],
    guaranteedOutcome: false
  };
}

function actionStance(intent) {
  return ({
    engage: 'cooperate',
    withhold: 'resist',
    clarify: 'information',
    observe: 'observe',
    act: 'probe',
    deceive: 'deceive',
    confront: 'confront'
  })[intent] || 'open';
}

function resolveCarriedDecisionNode(messages, userText) {
  if (!isContinuationSignal(userText)) return null;
  const source = Array.isArray(messages) ? messages : [];
  const previous = [...source].reverse().find((message) => (
    message?.role === 'assistant'
    && message?.decisionNode?.status === 'open'
    && message?.decisionNode?.requiresPlayerResponse === true
    && message?.contextExcluded !== true
  ));
  if (!previous) return null;
  const node = previous.decisionNode;
  return decisionNode(
    String(node.kind || 'awaiting-player'),
    String(node.type || 'pending-interaction'),
    Number(node.priority || 70),
    String(node.focus || ''),
    {
      speechAct: node.speechAct || null,
      blocking: node.blocking !== false,
      requiresPlayerResponse: true,
      urgency: node.urgency || 'high',
      source: 'unresolved-history'
    }
  );
}

function decisionNodeId(context) {
  const source = `${context.kind}|${context.nodeType}|${context.actor}|${context.focus}`;
  let hash = 2166136261;
  for (const char of source) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `decision-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function sanitizeActions(values) {
  const source = Array.isArray(values) ? values : [];
  const result = [];
  const seen = new Set();
  for (const value of source) {
    const action = String(value || '')
      .replace(/^\s*(?:[-*•]|\d+[.)、：:]?)\s*/u, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
    const key = normalizeComparableText(action);
    if (!isValidAction(action) || seen.has(key)) continue;
    seen.add(key);
    result.push(action);
  }
  return result;
}

function isValidAction(value) {
  const action = String(value || '').trim();
  if (action.length < 4 || INTERNAL_PROTOCOL_PATTERN.test(action)) return false;
  if (isContinuationSignal(action)) return false;
  return !/^(?:继续|下一步|看看|想清楚了|好的|确认了|自定义行动)$/u.test(action);
}

function isVagueAcknowledgement(value) {
  return /^(?:想清楚了|想好了|好的|好|嗯|知道了|明白了|确认了|行|可以|继续吧|继续走)[。.!！]?$/u.test(
    String(value || '').trim()
  );
}

function collectRecentRecommendedActions(messages) {
  const actions = (Array.isArray(messages) ? messages : [])
    .slice(-8)
    .flatMap((message) => Array.isArray(message?.recommendedActions) ? message.recommendedActions : [])
    .filter(Boolean);
  return {
    exact: new Set(actions.map(normalizeComparableText).filter(Boolean)),
    semantic: new Set(actions.map(actionSemanticFingerprint).filter(Boolean))
  };
}

function wasRecentlyRecommended(action, context, recentActions) {
  const exact = normalizeComparableText(action);
  if (recentActions?.exact?.has(exact)) return true;
  const semantic = actionSemanticFingerprint(action, context?.kind);
  return Boolean(semantic && recentActions?.semantic?.has(semantic));
}

function actionSemanticFingerprint(action, decisionKind = '') {
  const source = String(action || '').trim();
  const kind = String(decisionKind || '');
  if (!source) return '';
  if (/(?:起点|源头).{0,20}(?:方向|走向).{0,16}(?:新旧|时间)|(?:方向|走向).{0,20}(?:新旧|时间)/u.test(source)) {
    return 'investigation:trace-geometry';
  }
  if (/(?:丹田|灵根|经脉|体内|气息|暖意).{0,40}(?:接近|靠近|距离|远近).{0,24}(?:增强|变强|变化|反应)|(?:接近|靠近|距离|远近).{0,40}(?:丹田|灵根|经脉|体内|气息|暖意)/u.test(source)) {
    return 'investigation:body-proximity';
  }
  if (/(?:侧面|侧向|另一角度|换个角度|绕行).{0,28}(?:观察|查看|尽头|痕迹)|(?:保留|守住)退路.{0,24}(?:观察|绕行)/u.test(source)) {
    return 'investigation:flank-observe';
  }
  if (/(?:记下|记录|标记).{0,24}(?:位置|特征)|停止移动后.{0,18}(?:变化|反应)/u.test(source)) {
    return 'investigation:stationary-monitor';
  }
  if (/(?:转向|转而|把注意力转向|暂缓追索).{0,36}(?:微光|绿光|反光|亮点|光点|影子|阴影|灰影|黑影|人影|轮廓|异常)/u.test(source)) {
    return 'investigation:switch-anomaly';
  }
  if (/(?:停止重复|已确认).{0,30}(?:未确认|其中一项|分开)/u.test(source)) {
    return 'investigation:reframe-evidence';
  }
  const strategy = classifyActionStrategy(source);
  if (!strategy) return '';
  return `${strategy}:${normalizeActionTarget(source)}`;
}

function normalizeActionTarget(action) {
  return normalizeComparableText(action)
    .replace(/(?:先|暂时|暂且|小心|谨慎|缓慢|仔细|继续|立刻|直接|保持|借着|现有|重新)/gu, '')
    .replace(/(?:观察|检查|确认|分辨|查看|探查|试探|靠近|接近|绕行|询问|追问|回应|回答|退开|离开|记录|记下)/gu, '')
    .slice(-24);
}

function resolveRecentUserText(messages, fallback) {
  const direct = String(fallback || '').trim();
  if (direct && !isContinuationSignal(direct)) return direct.slice(0, 120);
  const source = Array.isArray(messages) ? messages : [];
  const latest = [...source].reverse().find((message) => (
    String(message?.role || '').toLowerCase() === 'user'
    && String(message?.content || '').trim()
    && !isContinuationSignal(message.content)
  ));
  const value = String(latest?.content || '').trim();
  return isContinuationSignal(value) ? '' : value.slice(0, 120);
}

function resolveCurrentActor(memory, closing, protagonist = '') {
  const normalizedProtagonist = normalizeLabel(
    protagonist
    || memory?.worldState?.protagonist?.name
    || memory?.protagonist?.name
    || memory?.persona?.name
  );
  const members = Array.isArray(memory?.characterRegistry?.currentAct?.members)
    ? memory.characterRegistry.currentAct.members : [];
  const worldCharacters = Array.isArray(memory?.worldState?.characters)
    ? memory.worldState.characters : [];
  const names = [...members, ...worldCharacters]
    .filter((item) => String(item?.state || 'on-stage') === 'on-stage' || !('state' in (item || {})))
    .map((item) => normalizeLabel(item?.name))
    .filter((name) => name && !isSameCharacter(name, normalizedProtagonist));
  const unique = [...new Set(names)].filter((name) => !isActorDepartedInClosing(name, closing));
  // 当前幕里只有一个 NPC 并不代表 TA 仍在正文结尾。必须在当前窗口中
  // 实际出现，才能把动作绑定给该角色；否则会把离场人物带回选项卡。
  const fromMemory = unique.find((name) => String(closing || '').includes(name)) || '';
  if (fromMemory) return fromMemory;
  const recentActor = extractRecentActorFromProse(closing, normalizedProtagonist);
  if (recentActor && !isSameCharacter(recentActor, normalizedProtagonist)) return recentActor;
  const leadingActor = extractLeadingActor(closing, normalizedProtagonist);
  if (leadingActor && !isSameCharacter(leadingActor, normalizedProtagonist)) return leadingActor;
  if (unique.length === 1) return unique[0];
  return '';
}

function extractRecentActorFromProse(closing, protagonist = '') {
  const text = String(closing || '').slice(-800);
  const cleanActorName = (raw) => {
    let name = normalizeLabel(raw);
    name = name.replace(/^(?:看见|见到|只见|遇到|听见|撞见|随着|伴着|由|向|对|与|和|跟)/u, '');
    name = name.replace(/^(?:那名|那位|一个|一位|一名|这个|那个|某个|几个|在场|身旁|面前|对面的?|身后的?|的)/u, '');
    name = name.replace(/^(?:值役局|杂役房|百草堂|戒律堂|传功阁|外门|内门|藏经阁|执事房|膳房|丹房)的?/u, '');
    const titleExtract = name.match(/([\u4e00-\u9fff]{1,3}(?:管事|长老|执事|师兄|师姐|师弟|师妹|道友|前辈|老祖|真人|掌门|堂主|峰主|弟子|巡查|护卫|掌柜|小二|居士))$/u);
    if (titleExtract) return titleExtract[1];
    return name.trim();
  };

  // 1. 优先匹配具名职务/身份称谓（置信度最高）
  const titledMatch = text.matchAll(/([\u4e00-\u9fff]{1,10}(?:管事|长老|执事|师兄|师姐|师弟|师妹|道友|前辈|老祖|真人|掌门|堂主|峰主|弟子|巡查|护卫|掌柜|小二|居士))/gu);
  const titledCandidates = [];
  for (const m of titledMatch) {
    const name = cleanActorName(m[1]);
    if (name && (!protagonist || !isSameCharacter(name, protagonist)) && name.length >= 2 && name.length <= 6) {
      titledCandidates.push({ name, index: m.index });
    }
  }
  if (titledCandidates.length) {
    titledCandidates.sort((a, b) => b.index - a.index);
    return titledCandidates[0].name;
  }

  // 2. 匹配常见动作前的说话人/动作发起人（排除地点、方位、动作助词）
  const actionMatch = text.matchAll(/([\u4e00-\u9fff]{2,6})(?:走到|站定|走出来|抬起头|捏着|递过来|递到|沉声道|开口道|说道|冷声道|低声道|问道|笑道|怒道|叹道|缓缓道)/gu);
  const actionCandidates = [];
  const excludedNames = /(?:自己|我们|他们|众人|一道|半片|落叶|石阶|竹签|檐角|铜铃|台阶|月门|屋门|窗边|门前|身旁|身后|面前|身边|地上|头上|手中|怀中|后山|阁前|阶边|阶下|阶上|深处|暗处)/u;
  for (const m of actionMatch) {
    const name = cleanActorName(m[1]);
    if (name && (!protagonist || !isSameCharacter(name, protagonist)) && name.length >= 2 && name.length <= 4 && !excludedNames.test(name)) {
      actionCandidates.push({ name, index: m.index });
    }
  }
  if (actionCandidates.length) {
    actionCandidates.sort((a, b) => b.index - a.index);
    return actionCandidates[0].name;
  }

  return '';
}

function resolveSolePresentActor(memory, protagonist = '') {
  const normalizedProtagonist = normalizeLabel(
    protagonist
    || memory?.worldState?.protagonist?.name
    || memory?.protagonist?.name
    || memory?.persona?.name
  );
  const members = Array.isArray(memory?.characterRegistry?.currentAct?.members)
    ? memory.characterRegistry.currentAct.members : [];
  const worldCharacters = Array.isArray(memory?.worldState?.characters)
    ? memory.worldState.characters : [];
  const names = [...members, ...worldCharacters]
    .filter((item) => String(item?.state || 'on-stage') === 'on-stage' || !('state' in (item || {})))
    .map((item) => normalizeLabel(item?.name))
    .filter((name) => name && !isSameCharacter(name, normalizedProtagonist));
  const unique = [...new Set(names)];
  return unique.length === 1 ? unique[0] : '';
}

function isActorDepartedInClosing(name, closing) {
  const actor = String(name || '').trim();
  const source = String(closing || '').slice(-900);
  if (!actor || !source.includes(actor)) return false;
  const escaped = actor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${escaped}.{0,48}(?:早已|已经|已|随即|随后)?(?:沿[^。！？]{0,20})?(?:离开|走远|远去|消失|没入)[^。！？]{0,24}`, 'u').test(source);
}

function extractLeadingActor(closing, protagonist = '') {
  const text = String(closing || '').trim();
  if (!text) return '';
  const firstSentence = splitSentences(text)[0] || text;
  const match = firstSentence.match(/^([\u4e00-\u9fff]{1,8})(?:按住|压低|抬起|冷声|低声|轻声|沉声|开口|说道|喊道|问道|笑道|怒道|厉声|转身|停下|看向|望向|伸出手)/u);
  if (!match) return '';
  const name = normalizeLabel(match[1]);
  if (name && protagonist && isSameCharacter(name, protagonist)) return '';
  return name;
}

function isSameCharacter(a, b) {
  const normA = normalizeLabel(a);
  const normB = normalizeLabel(b);
  if (!normA || !normB) return false;
  if (normA === normB) return true;
  if (normA.includes(normB) || normB.includes(normA)) return true;
  return false;
}

function resolveCurrentLocation(memory) {
  const value = memory?.characterRegistry?.currentAct?.location
    || memory?.worldState?.location?.current
    || memory?.worldState?.location;
  if (typeof value === 'string' || typeof value === 'number') return normalizeLabel(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  return [value.name, value.title, value.label, value.location, value.place, value.displayName]
    .map(normalizeLabel)
    .find(Boolean) || '';
}

function compactFocus(value) {
  const clean = extractCleanEntityNoun(value);
  if (clean) return clean;
  const sentence = splitSentences(String(value || '')).at(-1) || String(value || '');
  return trimFocus(sentence.replace(/[“”"‘’']/gu, ''), 24);
}

function quoteFocus(value) {
  const clean = extractCleanEntityNoun(value);
  if (clean) return `「${clean}」`;
  const trimmed = trimFocus(String(value || '').replace(/[「」“”"‘’']/gu, ''), 16);
  // 如果修剪后依然包含长句谓词特征，不加书名号生硬包裹
  if (!trimmed || /(?:已经|看见|发现|走到|没有|但是|如果|而且|虽然)/u.test(trimmed)) {
    return '眼前异样';
  }
  return `「${trimmed}」`;
}

function trimFocus(value, limit) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function normalizeNarrativeText(value) {
  return String(value || '')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/\r/gu, '')
    .replace(/[ \t]+/gu, ' ')
    .trim();
}

function normalizeLabel(value) {
  return (typeof value === 'string' || typeof value === 'number')
    ? String(value).trim().slice(0, 60)
    : '';
}

function normalizeComparableText(value) {
  return String(value || '').replace(/[\s，。！？；：、"""'''「」【】()（）]/gu, '').toLowerCase();
}

/**
 * 从角色卡和群组成员中提取当前说话角色的性格特征，
 * 供模板动作引用以生成更贴合角色风格的选项。
 */
function resolveCharTraits(characterCard, groupMembers, actorName) {
  const sources = [];

  // 如果有明确的说话角色名，优先从群成员中查找
  if (actorName) {
    const normalizedActor = String(actorName).replace(/[\s·・]/gu, '').toLowerCase();
    const member = (Array.isArray(groupMembers) ? groupMembers : []).find((m) => {
      const normalizedName = String(m?.name || '').replace(/[\s·・]/gu, '').toLowerCase();
      return normalizedName === normalizedActor;
    });
    if (member) {
      sources.push({
        name: String(member.name || '').trim(),
        personality: String(member.personality || '').trim(),
        role: String(member.role || '').trim(),
        description: String(member.description || '').trim()
      });
    }
  }

  // 主角角色卡作为兜底
  if (characterCard?.name && !sources.some((s) => s.name === characterCard.name)) {
    sources.push({
      name: String(characterCard.name).trim(),
      personality: String(characterCard.personality || '').trim(),
      role: String(characterCard.role || characterCard.scenario || '').trim(),
      description: String(characterCard.description || '').trim()
    });
  }

  if (!sources.length) return null;

  const primary = sources[0];
  return {
    name: primary.name,
    personalityBrief: primary.personality.slice(0, 60),
    roleBrief: primary.role.slice(0, 40)
  };
}
