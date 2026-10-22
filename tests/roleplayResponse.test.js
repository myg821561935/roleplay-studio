import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRoleplayResponse } from '../server/agent/roleplayResponse.js';
import { extractRoleplayPresentation, splitCharacterStatus } from '../public/modules/roleplayResponse.js';

const structuredReply = `<descriptive_analysis>
这里是导演分析，不应显示。
</descriptive_analysis>
<normal_status>
\`\`\`yaml
时间: 嘉宁十六年秋
地点: 江陵府
\`\`\`
</normal_status>
<plot>
暮鼓落下时，你踏进江陵府的长街。雨水沿着青石缝流向城门，一封没有署名的密信正在袖中发烫。
</plot>
<plot>
茶棚里有人抬眼看你，又很快压低斗笠。你知道，第一步已经被人看见了。
</plot>
<relationship_status>
<details><summary>点击查看关系</summary>
叶惊弦：陌路人，警惕上升。
</details>
</relationship_status>
<special_status>
『沈砚状态』
身份：游学士子

『叶惊弦状态』
身份：巡检司暗桩
</special_status>
<NextCharacterPanel>
推荐：叶惊弦。她与当前冲突直接相关。
</NextCharacterPanel>`;

test('roleplay protocol keeps only plot text in the main response', () => {
  const parsed = parseRoleplayResponse(structuredReply);
  assert.match(parsed.content, /暮鼓落下时/);
  assert.match(parsed.content, /第一步已经被人看见/);
  assert.doesNotMatch(parsed.content, /导演分析|normal_status|叶惊弦：陌路人/);
  assert.equal(parsed.panels.sceneStatus, '时间: 嘉宁十六年秋\n地点: 江陵府');
  assert.equal(parsed.panels.relationshipStatus, '叶惊弦：陌路人，警惕上升。');
  assert.match(parsed.panels.characterStatus, /沈砚状态/);
  assert.match(parsed.panels.nextCharacter, /推荐：叶惊弦/);
});

test('plain assistant replies remain unchanged', () => {
  const parsed = parseRoleplayResponse('雨停了，远处传来三声梆子。');
  assert.equal(parsed.content, '雨停了，远处传来三声梆子。');
  assert.deepEqual(parsed.panels, {});
});

test('partial protocol prefixes and hidden analysis do not leak during streaming', () => {
  assert.equal(parseRoleplayResponse('<descrip').content, '');
  assert.equal(parseRoleplayResponse('<descriptive_analysis>内部推演').content, '');
  assert.equal(
    parseRoleplayResponse('<descriptive_analysis>内部推演</descriptive_analysis><plot>城门').content,
    '城门'
  );
  assert.equal(parseRoleplayResponse('城门外雨声渐急。\n```lra-mvu-patch\n{"operations":').content, '城门外雨声渐急。');
  assert.equal(parseRoleplayResponse('城门外雨声渐急。\n```lra-mvu').content, '城门外雨声渐急。');
  assert.equal(parseRoleplayResponse('<lra-mvu').content, '');
});

test('community ai_last_output keeps prose visible and moves think blocks into director notes', () => {
  const raw = `<ai_last_output>
<think>
能力范围判定：当前角色会先观察，再谨慎回应。
剧情推理：下一幕应保持书房场景，不替用户作决定。
</think>

时间地点
时间：09:30
地点：主人书房

她把报告放在桌角，安静地等待你的答复。
</ai_last_output>`;
  const parsed = parseRoleplayResponse(raw);
  assert.match(parsed.content, /她把报告放在桌角/);
  assert.doesNotMatch(parsed.content, /能力范围判定|剧情推理|ai_last_output|think/);
  assert.match(parsed.panels.directorNotes, /能力范围判定/);
  assert.equal(extractRoleplayPresentation(raw).content, parsed.content);
  assert.equal(extractRoleplayPresentation(raw).panels.directorNotes, parsed.panels.directorNotes);
});

test('community analysis prefixes stay hidden while streaming', () => {
  assert.equal(parseRoleplayResponse('<ai_last').content, '');
  assert.equal(parseRoleplayResponse('<ai_last_output><think>正在分析').content, '');
  assert.equal(
    parseRoleplayResponse('<ai_last_output><think>正在分析</think>雨声落在窗棂上。').content,
    '雨声落在窗棂上。'
  );
});

test('community planing wrappers never expose generation plans or replacement CSS as prose', () => {
  const raw = `<planing>
用户输入“打听刘全”。本轮应让脚步声人物入场，并保留夜字铁牌的悬念。
</planing>

第1日 辰时过半·北墙柴房

门外的脚步在第二块青砖前停住，来人隔着门板低声问：“刘全昨夜可曾回来？”`;

  for (const parsed of [parseRoleplayResponse(raw), extractRoleplayPresentation(raw)]) {
    assert.match(parsed.content, /门外的脚步/);
    assert.doesNotMatch(parsed.content, /用户输入|本轮应让|planing|st-planing|\.st-planing/i);
    assert.match(parsed.panels.directorNotes, /夜字铁牌/);
  }
  assert.equal(parseRoleplayResponse('<planing>正在规划').content, '');
  assert.equal(extractRoleplayPresentation('<planning>正在规划').content, '');
});

test('legacy variable updates and JSON patches never become narrative text', () => {
  const raw = `丹田里的烛苗仍在暗处一跳一跳。

<UpdateVariable>
<JSONPatch>
[]
</JSONPatch>
</UpdateVariable>`;

  for (const parsed of [parseRoleplayResponse(raw), extractRoleplayPresentation(raw)]) {
    assert.equal(parsed.content, '丹田里的烛苗仍在暗处一跳一跳。');
    assert.equal(parsed.protocolDetected, true);
    assert.doesNotMatch(parsed.content, /UpdateVariable|JSONPatch|\[\]/i);
  }
  assert.equal(parseRoleplayResponse('正文已经完成。\n<UpdateVar').content, '正文已经完成。');
  assert.equal(extractRoleplayPresentation('<JSONPat').content, '');
});

test('community content wrappers keep only narrative prose and collapse tool activity', () => {
  const raw = `<thinking>先检索背景资料。</thinking>
<web_search_results>来源一：庄园记录\n来源二：人员名册</web_search_results>
<content>神宫寺遥合上名册，等待主人的决定。</content>`;

  for (const parsed of [parseRoleplayResponse(raw), extractRoleplayPresentation(raw)]) {
    assert.equal(parsed.content, '神宫寺遥合上名册，等待主人的决定。');
    assert.equal(parsed.panels.directorNotes, '先检索背景资料。');
    assert.match(parsed.panels.toolActivity, /庄园记录/);
    assert.doesNotMatch(parsed.content, /thinking|web_search|content/);
  }
  assert.equal(extractRoleplayPresentation('<正文>雨声渐歇。</正文>').content, '雨声渐歇。');
  assert.equal(extractRoleplayPresentation('<msg>她轻声回应。</msg>').content, '她轻声回应。');
});

test('frontend legacy parser recovers panels from saved raw messages', () => {
  const parsed = extractRoleplayPresentation(structuredReply);
  assert.equal(parsed.content, parseRoleplayResponse(structuredReply).content);
  const sections = splitCharacterStatus(parsed.panels.characterStatus, ['沈砚']);
  assert.match(sections.protagonist, /沈砚状态/);
  assert.doesNotMatch(sections.protagonist, /叶惊弦状态/);
  assert.match(sections.interactive, /叶惊弦状态/);
});

test('frontend legacy parser converts control-only output into sidebar data and action buttons', () => {
  const raw = `<NextCharacterPanel>
推荐霍银铃登场，并保留叶拭雪在场。
</NextCharacterPanel>

<recommended_actions>
["拾手接住那枚碎瓷片", "不动声色，任由瓷片掠过身旁", "主动起身，介入两女之间的对话", "继续饮酒，当作无事发生"]
</recommended_actions>`;
  const parsed = extractRoleplayPresentation(raw);
  assert.equal(parsed.content, '');
  assert.match(parsed.panels.nextCharacter, /霍银铃/);
  assert.deepEqual(parsed.recommendedActions, [
    '拾手接住那枚碎瓷片',
    '不动声色，任由瓷片掠过身旁',
    '主动起身，介入两女之间的对话',
    '继续饮酒，当作无事发生'
  ]);
  assert.deepEqual(parsed.recommendedActionPresentation, {
    source: 'model-recommended-actions',
    title: '',
    hint: ''
  });
});

test('legacy Tianji choice sections become native actions without leaving raw option text in prose', () => {
  const raw = `她说完，手轻轻一带，门在你面前合上了。\n\n> [天机选项：她关上了门]\n\n- 选项1：去消防楼那道门确认锁的情况\n- 选项2：回监控室，调出昨晚02:47前后的录像\n- 选项3：下楼找张姨，问她消防梯的门什么时候坏的\n- 选项4：自定义行动`;

  for (const parsed of [parseRoleplayResponse(raw), extractRoleplayPresentation(raw)]) {
    assert.equal(parsed.content, '她说完，手轻轻一带，门在你面前合上了。');
    assert.deepEqual(parsed.recommendedActions, [
      '去消防楼那道门确认锁的情况',
      '回监控室，调出昨晚02:47前后的录像',
      '下楼找张姨，问她消防梯的门什么时候坏的',
      '自定义行动'
    ]);
    assert.deepEqual(parsed.recommendedActionPresentation, {
      source: 'community-choice-block',
      title: '天机选项',
      hint: '她关上了门'
    });
    assert.doesNotMatch(parsed.content, /天机选项|选项1/);
  }
});

test('unnumbered Tianji bullet choices become the single native action source', () => {
  const raw = `夜深人静，巡山弟子的神识正向杂役院扫来。\n\n> [天机选项：异状尚未收束，那道神识正在靠近。]\n- 立刻躺回木板，假装熟睡，赌对方只是例行巡过。\n- 推开后窗，翻入屋后灵田的阴影里。\n- 不躲不藏，径直开门迎上来人。\n- 自定义`;

  for (const parsed of [parseRoleplayResponse(raw), extractRoleplayPresentation(raw)]) {
    assert.equal(parsed.content, '夜深人静，巡山弟子的神识正向杂役院扫来。');
    assert.deepEqual(parsed.recommendedActions, [
      '立刻躺回木板，假装熟睡，赌对方只是例行巡过。',
      '推开后窗，翻入屋后灵田的阴影里。',
      '不躲不藏，径直开门迎上来人。',
      '自定义'
    ]);
    assert.deepEqual(parsed.recommendedActionPresentation, {
      source: 'community-choice-block',
      title: '天机选项',
      hint: '异状尚未收束，那道神识正在靠近。'
    });
    assert.doesNotMatch(parsed.content, /天机选项|自定义/u);
  }
});

test('mixed compatible action protocols resolve to one native menu instead of merged duplicate menus', () => {
  const raw = `门外的风声停了，石阶下传来一声轻响。

> [天机选项：来人尚未现身，门缝外有新的动静。]
- 选项1：隔着门缝先问来者是谁
- 选项2：按住门闩，听清外面的脚步
- 选项3：退到侧窗旁，给自己留出退路

<recommended_actions>["直接推门查看", "高声喝问", "翻墙离开"]</recommended_actions>
<w2g>A: 随手开门</w2g>`;

  for (const parsed of [parseRoleplayResponse(raw), extractRoleplayPresentation(raw)]) {
    assert.deepEqual(parsed.recommendedActions, [
      '隔着门缝先问来者是谁',
      '按住门闩，听清外面的脚步',
      '退到侧窗旁，给自己留出退路'
    ]);
    assert.equal(parsed.recommendedActionPresentation?.source, 'community-choice-block');
    assert.doesNotMatch(parsed.content, /recommended_actions|随手开门|天机选项/u);
  }
});

test('an incomplete unnumbered Tianji block stays hidden while streaming', () => {
  const raw = '夜深人静，神识正在靠近。\n\n> [天机选项：异状尚未收束]\n- 立刻躺回木板';
  const parsed = extractRoleplayPresentation(raw);
  assert.equal(parsed.content, '夜深人静，神识正在靠近。');
  assert.deepEqual(parsed.recommendedActions, []);
  assert.doesNotMatch(parsed.content, /天机选项|立刻躺回/u);
});

test('model recommendation drafts and camel-case turn frames never leak into saved-message prose', () => {
  const frame = {
    spec: 'lra.narrative-turn-frame/v1',
    scene: { location: '回灵草田', time: '夜', summary: '巡夜灵识离去', presentActors: ['刘一'] },
    decision: { kind: 'open-state', focus: '是否起身', actor: '刘一', requiresPlayerResponse: false, urgency: 'normal' },
    evidence: [{ text: '夜色尚深', status: 'confirmed', source: '正文' }],
    affordances: {},
    stateDelta: {},
    panels: {}
  };
  const raw = `夜风掠过草叶，巡夜灵识已经远去。\n\n---\n\n**推荐动作（仅供节奏参考，不替玩家决定）**\n\n- 继续躺着，等待气息完全散去。\n- 起身返回院舍。\n- 观察丹田中的异动。\n- 自定义。\n\n<TurnFrame>\n${JSON.stringify(frame)}\n</TurnFrame>`;

  for (const parsed of [parseRoleplayResponse(raw), extractRoleplayPresentation(raw)]) {
    assert.equal(parsed.content, '夜风掠过草叶，巡夜灵识已经远去。');
    assert.deepEqual(parsed.recommendedActions, [
      '继续躺着，等待气息完全散去。',
      '起身返回院舍。',
      '观察丹田中的异动。',
      '自定义。'
    ]);
    assert.equal(parsed.recommendedActionPresentation?.source, 'model-recommendation-block');
    assert.doesNotMatch(parsed.content, /推荐动作|TurnFrame|lra\.narrative-turn-frame|---/i);
  }
});

test('model recommendation drafts stay hidden while streaming before the bullet list is complete', () => {
  const raw = '夜风掠过草叶，巡夜灵识已经远去。\n\n---\n\n**推荐动作（仅供节奏参考，不替玩家决定）**\n\n- 继续躺着';
  for (const parsed of [parseRoleplayResponse(raw), extractRoleplayPresentation(raw)]) {
    assert.equal(parsed.content, '夜风掠过草叶，巡夜灵识已经远去。');
    assert.doesNotMatch(parsed.content, /推荐动作|继续躺着|---/u);
  }
});

test('frontend parser discards leaked protocol instructions instead of rendering them as actions', () => {
  const raw = `<plot>她把钥匙轻轻放在桌角，等你回应。</plot>
<recommended_actions>
; Ira-actions如果稳定变化需要输出；结束需要《end》
step3：编排：正文前注释 -> <plot>正文</plot> -> 天机选项块
<!-- 1.正文前的格式 -->
<plot>
</recommended_actions>`;
  const parsed = extractRoleplayPresentation(raw);

  assert.equal(parsed.content, '她把钥匙轻轻放在桌角，等你回应。');
  assert.deepEqual(parsed.recommendedActions, []);
});

test('community preset panels and w2g choices become native presentation data', () => {
  const raw = `<bginfor>
时间：下午5:42<br>
地点：咖啡厅柜台前
</bginfor>

她把冰水往你面前推了三厘米，等你回应。

<w2g>
A：追问店长：问她店长那边究竟有什么麻烦
B：先不追问：接过水杯后回到座位
C：表明立场：告诉她必要时可以作证
D：询问后辈：侧面了解店里的情况
E：跳过
</w2g>

<catsay>
<details><summary>😼咪咪点评</summary>
这次没有硬追问，分寸感还行。<br>
先观察店长出现时她的反应。
</details>
</catsay>`;

  const serverParsed = parseRoleplayResponse(raw);
  const frontendParsed = extractRoleplayPresentation(raw);
  for (const parsed of [serverParsed, frontendParsed]) {
    assert.equal(parsed.content, '她把冰水往你面前推了三厘米，等你回应。');
    assert.equal(parsed.panels.sceneStatus, '时间：下午5:42\n\n地点：咖啡厅柜台前');
    assert.match(parsed.panels.communityComment, /分寸感还行/);
    assert.doesNotMatch(parsed.panels.communityComment, /catsay|details|summary|<br>/i);
    assert.deepEqual(parsed.recommendedActions, [
      '追问店长：问她店长那边究竟有什么麻烦',
      '先不追问：接过水杯后回到座位',
      '表明立场：告诉她必要时可以作证',
      '询问后辈：侧面了解店里的情况',
      '跳过'
    ]);
    assert.equal(parsed.recommendedActionPresentation?.source, 'community-action-block');
  }
  assert.equal(parseRoleplayResponse('<bginf').content, '');
  assert.equal(extractRoleplayPresentation('<cats').content, '');
});

test('Dreamer preset protocol maps into native prose, panels, and actions', () => {
  const raw = `<dream_plot>
<think>内部推演，不显示。</think>
<dream_body>雨声压低了咖啡馆里的谈话。她把杯子推到你面前，等待回应。</dream_body>
<dream_after_format>
<dream_scene>时间：傍晚\n地点：咖啡馆</dream_scene>
<dream_discuss>这一幕的重点是保持克制，不替用户追问。</dream_discuss>
<dream_option>
A：接过杯子，先道谢
B：观察她的神情
C：询问店长何时回来
</dream_option>
</dream_after_format>
</dream_plot>`;

  for (const parsed of [parseRoleplayResponse(raw), extractRoleplayPresentation(raw)]) {
    assert.equal(parsed.content, '雨声压低了咖啡馆里的谈话。她把杯子推到你面前，等待回应。');
    assert.match(parsed.panels.directorNotes, /内部推演/);
    assert.match(parsed.panels.sceneStatus, /咖啡馆/);
    assert.match(parsed.panels.communityComment, /保持克制/);
    assert.deepEqual(parsed.recommendedActions, [
      '接过杯子，先道谢',
      '观察她的神情',
      '询问店长何时回来'
    ]);
  }
});

test('community StatusBlock materializes concrete CharacterStatus without leaking wrapper markup', () => {
  const raw = `雨幕沿着诊所的玻璃缓缓滑落，她把登记簿转向你。
<StatusBlock>
<CharacterStatus>
<details><summary>---林夏状态栏---</summary>
角色：林夏<br>
人物特质：谨慎、敏锐<br>
当前目标：确认来访者身份
</details>
</CharacterStatus>
</StatusBlock>`;

  for (const parsed of [parseRoleplayResponse(raw), extractRoleplayPresentation(raw)]) {
    assert.equal(parsed.content, '雨幕沿着诊所的玻璃缓缓滑落，她把登记簿转向你。');
    assert.match(parsed.panels.characterStatus, /角色：林夏/);
    assert.match(parsed.panels.characterStatus, /确认来访者身份/);
    assert.doesNotMatch(parsed.content, /StatusBlock|CharacterStatus|状态栏/);
  }
});
