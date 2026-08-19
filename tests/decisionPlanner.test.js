import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDecisionContext,
  planRecommendedActions
} from '../server/agent/decisionPlanner.js';

test('decision planner lets the closing question override stale model actions and older artifacts', () => {
  const result = planRecommendedActions({
    assistantContent: [
      '玉简与腰牌上的古字仍在石室中泛着微光，枯骨旁的魂火也没有熄灭。',
      '门外的人没有踏过门槛。她抬起令牌，问道：“谁在那里？”',
      '她站在原地，只等门内给出回应。'
    ].join('\n'),
    modelActions: [
      '比对玉简与腰牌上的痕迹',
      '检查枯骨留下的魂火',
      '试探裂缝与体内异动是否相连',
      '去青铜门前设法确认地伶是否回应'
    ],
    memory: {
      worldState: {
        protagonist: { name: '刘一' },
        location: { current: '青铜门后石室' },
        characters: [{ name: '地伶', status: '留在门外' }]
      }
    }
  });

  assert.equal(result.decision.kind, 'direct-response');
  assert.equal(result.actions.length, 3);
  assert.match(result.actions.join('\n'), /谁在那里/);
  assert.match(result.actions.join('\n'), /回应|反问/);
  assert.equal(result.actions.some((action) => /玉简|枯骨|魂火|裂缝/.test(action)), false);
});

test('decision planner classifies commands, explicit choices and threats by decision semantics', () => {
  assert.deepEqual(
    buildDecisionContext({ assistantContent: '她将刀尖压低，冷声道：“把门关上，站到我身后。”' }).speechAct,
    {
      type: 'command',
      text: '把门关上，站到我身后。',
      questionKind: ''
    }
  );
  assert.equal(
    buildDecisionContext({ assistantContent: '两条路都在塌陷。要么跳上货车，要么退回站台，由你决定。' }).kind,
    'explicit-choice'
  );
  assert.equal(
    buildDecisionContext({ assistantContent: '警报骤响，火势沿走廊逼近，下一瞬就会封死出口。' }).kind,
    'immediate-threat'
  );
});

test('decision planner does not turn an NPC hypothesis into an explicit player choice', () => {
  const context = buildDecisionContext({
    assistantContent: '地伶皱眉道：“要么你记错了，要么玉简缺了一角，这只是我的猜测。”她仍等你说明来意。'
  });
  assert.notEqual(context.kind, 'explicit-choice');
});

test('a later concrete request overrides an unfinished either-or hypothesis', () => {
  const result = planRecommendedActions({
    assistantContent: [
      '柴翁盯着桶里的水说：“能有蛛丝，要么是从外头带进去的，要么……”',
      '他把桶沿推到刘一面前，又补了一句：“这桶水，你看看再定。”'
    ].join('\n'),
    memory: {
      worldState: {
        protagonist: { name: '刘一' },
        location: { current: '井台' },
        characters: [{ name: '柴翁', state: 'on-stage' }]
      }
    }
  });

  assert.equal(result.decision.kind, 'pending-interaction');
  assert.match(result.decision.focus, /这桶水.*看看再定/);
  assert.equal(result.actions.some((action) => /选择.*……|两种方向|要么/u.test(action)), false);
  assert.match(result.actions.join('\n'), /水桶|封泥|端详/);
  assert.equal(result.actions.some((action) => /正面回应.*问题|为何要问/u.test(action)), false);
  assert.equal(result.actions.some((action) => /询问(?:绝世仙宗|世界|宗门)看出/u.test(action)), false);
});

test('accepted turn frame is the authoritative current decision node', () => {
  const result = planRecommendedActions({
    assistantContent: '玉简仍在发光。有人低声问：“你是谁？”',
    modelActions: ['检查玉简', '触碰光点'],
    turnFrame: {
      validation: { status: 'accepted' },
      scene: { location: '青铜门后石室', summary: '巡查者隔门等待回答', presentActors: ['地伶'] },
      decision: {
        kind: 'direct-response', focus: '谁在门后？', actor: '地伶', requiresPlayerResponse: true, urgency: 'high'
      },
      affordances: { routes: [], interactables: [], threats: [], constraints: [] }
    },
    memory: { worldState: { characters: [{ name: '地伶', state: 'on-stage' }] } }
  });
  assert.equal(result.decision.source, 'turn-frame');
  assert.equal(result.decision.kind, 'direct-response');
  assert.equal(result.actions.some((action) => /玉简|光点/.test(action)), false);
  assert.match(result.actions.join('\n'), /地伶|回答|回应|反问/);
});

test('decision planner preserves contextual community choices when the scene merely awaits the player', () => {
  const result = planRecommendedActions({
    assistantContent: '她把冰水放在桌边，安静地等你回应。',
    modelActions: [
      '追问店长那边出了什么事',
      '接过水杯，暂时回到座位',
      '表示必要时可以替她作证',
      '继续观察她是否还会补充'
    ]
  });

  assert.equal(result.decision.kind, 'awaiting-player');
  assert.deepEqual(result.actions, [
    '追问店长那边出了什么事',
    '接过水杯，暂时回到座位',
    '表示必要时可以替她作证'
  ]);
});

test('decision planner grounds investigation choices in the just-finished beat without story-specific dictionaries', () => {
  const result = planRecommendedActions({
    assistantContent: [
      '旧档案柜已经锁好。',
      '窗台忽然留下一道湿痕，墙内传来三次很轻的敲击声。',
      '桌上的录音笔随之亮起，红灯只闪了一瞬。'
    ].join('\n'),
    memory: { worldState: { location: { current: '旧校舍值班室' } } }
  });

  assert.equal(result.decision.kind, 'investigation');
  assert.ok(result.actions.length >= 3);
  assert.match(result.actions.join('\n'), /湿痕|敲击声|录音笔|红灯/);
  assert.equal(result.actions.some((action) => /玉简|腰牌|魂火|青铜门/.test(action)), false);
});

test('decision planner removes protocol placeholders and repeated previous cards', () => {
  const result = planRecommendedActions({
    assistantContent: '雨声渐弱，你看见窗外留下一串新的脚印。',
    modelActions: ['自定义行动', '[object Object]', '检查窗外的新脚印'],
    recentMessages: [{ role: 'assistant', recommendedActions: ['检查窗外的新脚印'] }]
  });

  assert.equal(result.actions.some((action) => /自定义行动|object Object|检查窗外的新脚印/.test(action)), false);
  assert.ok(result.actions.length >= 2);
});

test('decision planner does not repeat an investigation template after only its nouns change', () => {
  const previousActions = [
    '先不靠近，借现有光线确认「而是从深处被掘开的痕迹」的起点、方向与新旧',
    '收敛呼吸，分辨「丹田里的烛苗仍在暗处一跳一跳」是否会随自己接近那道痕迹而增强',
    '沿现场侧面缓慢绕行，保留退路，从另一角度观察痕迹尽头藏着什么'
  ];
  const result = planRecommendedActions({
    assistantContent: [
      '他稳住身形，没有急着靠近残片，而是沿着浅沟拖痕挪了半步。',
      '随着距离拉近，丹田里的暖意向左侧偏移；退回半步，暖意又回到正中。',
      '他停在原地，呼吸并未因试探而乱。丹田里的烛苗依旧在跳，节律稳定如常。',
      '浅沟在蓟草丛前消失，草叶被压伏的痕迹却未止于此。蓟丛下方露出一块比残片更细薄的碎片。',
      '北面竹篱边仍无声响。枯叶底下闪了一下极淡的绿光，转瞬即逝；再看时只有叶脉泛着银白细纹。'
    ].join('\n'),
    modelActions: [
      '先不靠近，借现有光线确认「草叶被压伏的痕迹却未止于此。」的起点、方向与新旧',
      '收敛呼吸，分辨「丹田里的烛苗依旧在跳」是否会随自己接近那道痕迹而增强',
      '沿现场侧面缓慢绕行，保留退路，从另一角度观察痕迹尽头藏着什么'
    ],
    recentMessages: [{ role: 'assistant', recommendedActions: previousActions }],
    memory: { worldState: { location: { current: '后山灵田' } } }
  });

  assert.equal(result.decision.kind, 'investigation');
  assert.equal(result.actions.length, 3);
  assert.equal(result.actions.some((action) => /起点、方向与新旧|随自己接近那道痕迹而增强|侧面缓慢绕行/.test(action)), false);
  assert.match(result.actions.join('\n'), /绿光/);
  assert.match(result.actions.join('\n'), /残片|碎片|已确认/);
  assert.equal(result.actions.some((action) => /没有急着靠近残片|叶脉.*直接触碰/u.test(action)), false);
  assert.ok(result.actionOptions.every((option) => option.worldValid));
});

test('decision planner applies semantic history deduplication to model-authored choices too', () => {
  const result = planRecommendedActions({
    assistantContent: '旧拖痕延伸到门边，体内暖意随距离变化，墙角又闪过一道黑影。',
    modelActions: [
      '确认旧拖痕的起点、方向与新旧',
      '感知体内暖意是否随靠近拖痕而增强',
      '从侧面绕行，保留退路观察痕迹尽头'
    ],
    recentMessages: [{
      role: 'assistant',
      recommendedActions: [
        '检查湿痕的起点、方向与新旧',
        '分辨丹田反应是否随接近湿痕而增强',
        '沿侧面绕行并保留退路，从另一角度观察'
      ]
    }]
  });

  assert.equal(result.actions.some((action) => /旧拖痕的起点|体内暖意是否随靠近|侧面绕行/.test(action)), false);
});

test('decision planner keeps an unresolved direct question open across a continuation signal', () => {
  const previous = planRecommendedActions({
    assistantContent: '门外的地伶压低声音问：“刘一，里面发生了什么？”她停住话，等你回应。',
    memory: {
      worldState: {
        protagonist: { name: '刘一' },
        location: { current: '青铜门后石室' },
        characters: [{ name: '地伶', status: '守在门外' }]
      }
    }
  });
  const resumed = planRecommendedActions({
    assistantContent: '青铜门内外都保持安静。',
    recentMessages: [{
      role: 'assistant',
      content: '门外的地伶仍在等待。',
      decisionNode: previous.decision
    }, { role: 'user', kind: 'continuation', content: '继续推进' }],
    userMessage: '继续推进'
  });

  assert.equal(resumed.decision.source, 'unresolved-history');
  assert.equal(resumed.decision.requiresPlayerResponse, true);
  assert.match(resumed.actions.join('\n'), /回应|反问|暂不回答/);
});

test('continuation cannot replace an unresolved NPC question with a protagonist-authored fallback choice', () => {
  const previous = planRecommendedActions({
    assistantContent: '柴翁盯着桶梁断口，问：“那断口是被人咬断的，还是拧断的？”',
    memory: {
      worldState: {
        protagonist: { name: '刘一' },
        location: { current: '后院井台' },
        characters: [{ name: '柴翁', state: 'on-stage' }]
      }
    }
  });
  const resumed = planRecommendedActions({
    assistantContent: [
      '井水仍绕着槐叶缓缓打转，柴翁没有替刘一作决定。',
      '柴翁看着井口，只提了一句刘一方才已经看过桶梁断口。',
      '柴翁将灰布巾搁在井沿，只说：“布巾在井沿，你要擦便擦。不急。”'
    ].join('\n'),
    recentMessages: [
      {
        role: 'assistant',
        decisionNode: previous.decision,
        recommendedActions: previous.actions
      },
      { role: 'user', kind: 'continuation', content: '（请继续推进剧情）' }
    ],
    userMessage: '（请继续推进剧情）',
    memory: {
      worldState: {
        protagonist: { name: '刘一' },
        location: { current: '后院井台' },
        characters: [{ name: '柴翁', state: 'on-stage' }]
      }
    },
    turnFrame: {
      decision: {
        kind: 'explicit-choice',
        focus: '刘一是擦掉脂泥，还是保留指尖残留',
        actor: '刘一',
        requiresPlayerResponse: true,
        urgency: 'normal'
      },
      validation: { status: 'accepted', source: 'conservative-prose-fallback' }
    }
  });

  assert.equal(resumed.decision.source, 'unresolved-history');
  assert.equal(resumed.decision.actor, '柴翁');
  assert.match(resumed.decision.focus, /咬断.*拧断/);
  assert.match(resumed.actions.join('\n'), /回应|反问|暂不回答/);
  assert.equal(resumed.actions.some((action) => /刘一/.test(action)), false);
  assert.equal(resumed.actions.length, 3);
});

test('decision planner emits structurally distinct strategies for a blocking command', () => {
  const result = planRecommendedActions({
    assistantContent: '地伶按住剑柄，隔门命令：“先别动，把门里的情况说清楚。”'
  });

  assert.equal(result.decision.type, 'pending-interaction');
  assert.equal(result.decision.speechAct, 'command');
  assert.equal(result.actionOptions.length, 3);
  assert.equal(new Set(result.actionOptions.map((option) => option.intent)).size, 3);
  assert.ok(result.actionOptions.every((option) => option.playerControlled));
  assert.ok(result.actionOptions.every((option) => option.target.includes('地伶')));
});

test('decision planner keeps the latest actionable question when later quoted words are only narration', () => {
  const result = planRecommendedActions({
    assistantContent: [
      '地伶低声说：“你灵根的气息，很浊。”',
      '她停了一会儿，又问：“你这灵根，到底怎么来的？我可没听说过哪门哪派里，有弟子修炼出这种……”',
      '她没有说出“邪物”二字，但未尽之语已经悬在夜风里。'
    ].join('\n'),
    memory: {
      worldState: {
        protagonist: { name: '刘一' },
        location: { current: '青铜门后石室' },
        characters: [{ name: '地伶', state: 'on-stage' }]
      }
    }
  });

  assert.equal(result.decision.kind, 'direct-response');
  assert.match(result.decision.focus, /灵根.*怎么来的/);
  assert.match(result.actions.join('\n'), /回答|反问|暂不回答/);
  assert.equal(result.actions.some((action) => /邪物.*调查|夜风.*观察/.test(action)), false);
});

test('decision planner treats explicit alternatives as the decision instead of a figurative threat', () => {
  const result = planRecommendedActions({
    assistantContent: [
      '她眸子微微眯起，像月光下被风吹起的剑锋。',
      '地伶问：“你是想让我把你当作普通杂役放走，还是想让我把你当作前辈遗祸带回去？这个答案，不该由我替你选。”'
    ].join('\n'),
    modelActions: [
      '立刻避开声音低得几乎散在风里的正面影响',
      '拉开距离观察声音的来源与范围'
    ],
    memory: { worldState: { characters: [{ name: '地伶', state: 'on-stage' }] } }
  });

  assert.equal(result.decision.kind, 'explicit-choice');
  assert.match(result.actions[0], /普通杂役放走/);
  assert.match(result.actions[1], /前辈遗祸带回去/);
  assert.match(result.actions.join('\n'), /第三种可执行方案/);
  assert.equal(result.actions.some((action) => /眼前威胁|拉开距离|声音低/.test(action)), false);
});

test('decision planner does not promote atmospheric prose to an investigation object', () => {
  const result = planRecommendedActions({
    assistantContent: '夜风吹得她袖口轻轻翻动，红绳束住的马尾在月光下泛着幽深的光。她没有离开，只等门内的人开口回答。',
    modelActions: [
      '比对袖口与红绳马尾上的月光痕迹',
      '不直接触碰红绳，先观察它的反应'
    ],
    recentMessages: [{ role: 'user', content: '我先看看门边有没有别的出口。' }],
    userMessage: '你探测一下',
    memory: { worldState: { characters: [{ name: '地伶', state: 'on-stage' }] } }
  });

  assert.equal(result.decision.kind, 'awaiting-player');
  assert.equal(result.actions.some((action) => /袖口|马尾|月光/.test(action)), false);
  assert.match(result.actions.join('\n'), /追问地伶刚才探测到了什么具体结果/);
  assert.match(result.actions.join('\n'), /再探测一次/);
});

test('a new route decision replaces an older unresolved NPC interaction on continuation', () => {
  const previous = planRecommendedActions({
    assistantContent: '地伶隔着门问：“你体内那道力量从哪里来？”她停住话，等你回答。'
  });
  const result = planRecommendedActions({
    assistantContent: [
      '石门已经沉入地面，露出向下延伸的沉璧阶。',
      '石阶分成两路：“踏亮处，入旧墟；踏暗处，历残魂。”',
      '两种走法都在脚下等待选择。'
    ].join('\n'),
    recentMessages: [
      { role: 'assistant', decisionNode: previous.decision },
      { role: 'user', kind: 'continuation', content: '继续推进' }
    ],
    userMessage: '继续推进'
  });

  assert.equal(result.decision.source, 'closing-beat');
  assert.equal(result.decision.kind, 'explicit-choice');
  assert.match(result.actions[0], /踏亮处/);
  assert.match(result.actions[1], /踏暗处/);
  assert.equal(result.actions.some((action) => /回应地伶|力量从哪里来/.test(action)), false);
});

test('a resolved threat cannot manufacture a defensive action after the scene has settled', () => {
  const result = planRecommendedActions({
    assistantContent: [
      '灰影猛然扑向后心，几乎来不及回身。',
      '它却在三尺外停住，随后缩回石缝，暗红眼睛黯淡下去，石室归于沉寂。',
      '地伶隔门问：“你有没有感觉到它停了一下？”'
    ].join('\n')
  });

  assert.equal(result.decision.kind, 'direct-response');
  assert.equal(result.actions.some((action) => /硬接这一击|避开.*锋芒|横挡在前/.test(action)), false);
  assert.match(result.actions.join('\n'), /停了一下/);
});

test('a settled solo beat does not revive a departed NPC or manufacture another choice panel', () => {
  const result = planRecommendedActions({
    assistantContent: [
      '月华落在后山灵田，地伶早已沿小径离开。',
      '丹田中的异动缓缓蛰伏，四周只余虫鸣，你仍靠在青石上。'
    ].join('\n'),
    modelActions: [
      '回应地伶此刻的反应，明确自己愿意推进到哪一步',
      '询问地伶是否愿意继续以及边界在哪里',
      '保持距离观察地伶会不会主动回应'
    ],
    memory: {
      worldState: {
        protagonist: { name: '刘一' },
        location: { current: '后山灵田' },
        characters: [{ name: '地伶', state: 'departed' }]
      },
      characterRegistry: {
        currentAct: {
          location: '后山灵田',
          members: [{ name: '地伶', state: 'departed' }]
        }
      }
    }
  });

  assert.equal(result.decision.kind, 'open');
  assert.equal(result.decision.actor, '');
  assert.deepEqual(result.actions, []);
});

test('a stale command earlier in a long reply cannot override a new closing investigation node', () => {
  const result = planRecommendedActions({
    assistantContent: [
      '管事收起断牌，低声命令：“多的话，一个字也别提。”刘一应声退出屋门。',
      '他独自走入夜色，在灵田深处盘膝感受丹田与灵根的变化。',
      '月色渐沉，他依着吐纳节奏静坐许久，直到四周只剩草叶摩擦的细响。',
      '西北角一丛灵草被压伏，泥土上的深色拖痕一路没入灵植阴影。',
      '丹田里那点火光猛地跳了一下，像是被那道痕迹刺激到了。'
    ].join('\n\n'),
    memory: {
      worldState: {
        protagonist: { name: '刘一' },
        location: { current: '后山灵田' },
        characters: [{ name: '地伶', state: 'on-stage' }]
      }
    }
  });

  assert.equal(result.decision.kind, 'investigation');
  assert.equal(result.decision.actor, '');
  assert.equal(result.actions.length, 3);
  assert.match(result.actions.join('\n'), /灵草|拖痕|丹田|痕迹/);
  assert.equal(result.actions.some((action) => /一个字也别提|地伶|回应|追问/.test(action)), false);
});

test('decision planner grounds actions on closing task handover instead of stale swept footprints', () => {
  const result = planRecommendedActions({
    assistantContent: [
      '春秋阁前的晨雾尚未散尽，檐角的铜铃被夜露浸得泛出一层青锈色。刘一握着那把磨秃了梢的竹扫帚，从最下一级石阶慢慢扫上去。',
      '扫到阶边的苔痕处时，他微微顿了一下。阶缝里嵌着半片薄泥印子，纹路极细，像是某种特制的云纹软底靴踩出来的。',
      '他已经记下这个脚印的位置，面上却没露出半分异色，帚尖一掠，泥印便被扫进落叶里。',
      '扫到第二十级石阶时，月门里传来一串竹签碰撞的脆响。刘一抬起头，看见值役局的孙管事捏着一把竹签走出来，走到台阶边站定。',
      '“刘一。” “你手脚倒麻利。后山那片地界，平日归老柴头打理。昨夜他不慎踩空，扭伤了腿，一时起不来了。今日起，藏经阁后山道改由你顶。明早你便直接过去，从山腰那截石阶一路扫到守阁碑前，一日两遍，莫要落下。”',
      '一枚竹签递到他面前。签面刻着“藏经阁后山”五个字，墨迹被经年雨水泡得微微晕开。刘一接过来，指尖摩挲过竹片纹路，凉丝丝的触感落进掌心。他没多问，只点了点头。'
    ].join('\n\n'),
    memory: {
      worldState: {
        protagonist: { name: '刘一' },
        location: { current: '春秋阁前石阶' }
      }
    }
  });

  // 必须紧扣末尾的孙管事差事交代与竹签交接，严禁被前文已扫掉的脚印夺焦
  assert.notEqual(result.decision.kind, 'investigation');
  assert.equal(result.actions.length, 3);
  // 选项必须通顺自然，绝不包含机械长句拼接或书名号长句
  assert.equal(result.actions.some((action) => action.includes('他已经记下这个脚印的位置')), false);
  assert.equal(result.actions.some((action) => action.includes('「他已经记下这个脚印的位置」')), false);
  assert.equal(result.actions.some((action) => action.includes('檐角的铜铃上与')), false);
  assert.equal(result.actions.some((action) => action.includes('从最下一级石阶是否仍可安全通行')), false);
  // 必须贴合结尾情境（孙管事、竹签、差事、后山等）
  const allActions = result.actions.join('\n');
  assert.match(allActions, /孙管事|竹签|差事|后山|事务|应对/);
});

test('decision planner never treats the protagonist as the interactive actor target', () => {
  const assistantContent = '刘一完成井台暗中勘查，指尖蹭取桶沿湿泥与脂光后产生轻微麻痒暖意；柴翁察觉其动作，留下灰布巾提醒脂液不宜久沾，并追问桶梁断面成因；井底暗色轮廓与井台石缝泥壳下的细丝迹象在光线变化中显露。';
  const result = planRecommendedActions({
    assistantContent,
    memory: {
      worldState: {
        protagonist: { name: '刘一' },
        characters: [{ name: '柴翁', state: 'on-stage' }]
      }
    },
    turnFrame: {
      validation: { status: 'accepted' },
      decision: {
        kind: 'pending-interaction',
        actor: '刘一',
        focus: '追问桶梁断面成因'
      },
      speechAct: {
        type: 'command',
        text: '提醒脂液不宜久沾，并追问桶梁断面成因'
      }
    }
  });

  assert.equal(result.decision.actor, '柴翁');
  assert.equal(result.actions.some((a) => a.includes('刘一')), false);
  assert.match(result.actions.join('\n'), /柴翁|对方/);
});
