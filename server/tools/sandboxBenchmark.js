import { assemblePrompt } from '../agent/promptAssembler.js';
import { extractNarrativeTurnFrame } from '../agent/turnFrame.js';
import { validateNarrativeHardFacts } from '../memory/narrativeRepair.js';

export async function runSandboxBenchmark({
  characterCard = {},
  worldBook = [],
  coreMemory = null,
  simulatedTurns = 5,
  mockAssistantReplies = []
} = {}) {
  const report = {
    totalTurns: simulatedTurns,
    worldBookStats: {
      totalEntries: worldBook.length,
      activatedEntries: new Set(),
      zeroHitEntries: []
    },
    antiSpoilerStats: {
      violationsDetected: 0,
      repairedTurns: 0
    },
    foreshadowingStats: {
      created: 0,
      resolved: 0,
      open: 0
    },
    kvCacheStability: {
      zone1Hashes: [],
      stabilityScore: 100
    },
    summaryText: ''
  };

  const messages = [];
  const memory = {
    coreMemory: coreMemory || undefined,
    worldState: {
      location: '客栈大堂',
      characterKnowledge: {
        [characterCard.name || 'NPC']: {
          knownFacts: ['受命在此等候接头人'],
          secretBoundaries: ['真正的藏宝图藏在后山古佛腹中']
        }
      },
      foreshadowing: []
    }
  };

  const userSimulatedInputs = [
    '我走进大堂，四下打量一番。',
    '我向对方拱手，询问近来可有什么异常动静？',
    '我拔剑出鞘半寸，出言试探对方身份。',
    '我追问刚才提到的旧案细节。',
    '我决定暂且离开，前往后山查看。'
  ];

  let prevZone1 = null;
  let zone1MatchCount = 0;

  for (let i = 0; i < simulatedTurns; i += 1) {
    const userText = userSimulatedInputs[i % userSimulatedInputs.length];
    messages.push({ role: 'user', content: userText });

    // 1. 上下文组装与 KV Cache 稳定性检验
    const assembled = assemblePrompt({
      characterCard,
      worldBook,
      messages,
      memory,
      options: { characterCard, worldBook }
    });

    const zone1Content = (assembled.sections?.coreSystemSections || []).map((s) => s.content).join('\n');
    if (prevZone1 !== null) {
      if (zone1Content === prevZone1) {
        zone1MatchCount += 1;
      }
    }
    prevZone1 = zone1Content;

    // 统计世界书激活
    if (Array.isArray(assembled.sections?.worldBook)) {
      for (const entry of assembled.sections.worldBook) {
        if (entry?.id !== undefined) report.worldBookStats.activatedEntries.add(entry.id);
      }
    }

    // 2. 模拟 Assistant 回复与 TurnFrame 提取
    const replyContent = mockAssistantReplies[i] || (
      i === 0
        ? `我冷冷地看着你，低声道：“有些秘密，你最好不要探听。”\n<turn_frame>{"scene":{"summary":"在客栈大堂对峙"},"decision":{"kind":"open-state","focus":"戒备观察"},"stateDelta":{"foreshadowing":[{"id":"h1","content":"后山古树下的泥痕","status":"open"}]}}</turn_frame>`
        : i === 1
        ? `我冷哼一声：“你若真想查，不妨去后山看看。”\n<turn_frame>{"scene":{"summary":"指向后山线索"},"decision":{"kind":"open-state","focus":"指引探查"},"stateDelta":{"foreshadowing":[{"id":"h1","content":"后山古树下的泥痕","status":"resolved"}]}}</turn_frame>`
        : `我转身离去，不再多言。`
    );

    const parsedFrame = extractNarrativeTurnFrame(replyContent);
    if (parsedFrame.frame?.stateDelta?.foreshadowing) {
      for (const hook of parsedFrame.frame.stateDelta.foreshadowing) {
        if (hook.status === 'open') report.foreshadowingStats.created += 1;
        if (hook.status === 'resolved') report.foreshadowingStats.resolved += 1;
      }
    }

    // 3. 防剧透涉密盲区检验
    const npcSecretBoundaries = memory.worldState.characterKnowledge?.[characterCard.name || 'NPC']?.secretBoundaries || [];
    const consistency = validateNarrativeHardFacts({
      rawContent: replyContent,
      characterKnowledge: memory.worldState.characterKnowledge,
      speaker: characterCard.name || 'NPC'
    });

    if (!consistency.valid || npcSecretBoundaries.some((secret) => replyContent.includes(secret))) {
      report.antiSpoilerStats.violationsDetected += 1;
    }

    messages.push({ role: 'assistant', content: parsedFrame.content });
  }

  // 整理汇总指标
  const activatedCount = report.worldBookStats.activatedEntries.size;
  report.worldBookStats.zeroHitEntries = worldBook.filter((e, idx) => !report.worldBookStats.activatedEntries.has(e.id ?? idx)).map((e) => e.comment || e.title || `条目#${e.id}`);

  if (simulatedTurns > 1) {
    report.kvCacheStability.stabilityScore = Math.round((zone1MatchCount / (simulatedTurns - 1)) * 100);
  }

  report.foreshadowingStats.open = Math.max(0, report.foreshadowingStats.created - report.foreshadowingStats.resolved);

  report.summaryText = `【剧本沙箱体检报告】
- 模拟回合数：${simulatedTurns} 轮
- 世界书激活率：${activatedCount}/${worldBook.length || 1} 条目
- 防剧透违规拦截：${report.antiSpoilerStats.violationsDetected} 次
- 伏笔闭环率：${report.foreshadowingStats.resolved}/${report.foreshadowingStats.created || 1}
- KV Cache 前缀一致性评分：${report.kvCacheStability.stabilityScore}%`;

  return report;
}
