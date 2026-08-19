import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MEMORY_SPEC,
  createDecisionRecord,
  createMemoryState,
  createTurnEpisode,
  sanitizeMemoryText
} from '../server/memory/memoryContract.js';
import { MemoryService } from '../server/memory/memoryService.js';

const FIXED_TIME = '2026-08-04T08:00:00.000Z';
const now = () => new Date(FIXED_TIME);

function message(id, role, content, extra = {}) {
  return {
    id,
    role,
    content,
    createdAt: FIXED_TIME,
    ...extra
  };
}

function createSession(messages = []) {
  return {
    id: 'memory-test',
    messages,
    memory: {
      episodicMemory: createMemoryState(),
      worldState: {
        protagonist: { name: '沈观澜' },
        location: { current: '云州城' },
        characters: [{ name: '闻雪照' }],
        factions: []
      },
      knowledgeGraph: { revision: 7, nodes: [], edges: [] }
    }
  };
}

test('memory contract removes raw CoT while preserving auditable outcomes', () => {
  const session = createSession();
  const userMessage = message('u1', 'user', '我去镇武司调查。');
  const assistantMessage = message(
    'a1',
    'assistant',
    '<think>先猜测幕后人，再编一条线索。</think>闻雪照在卷宗中找到云州城的出入记录。'
  );
  session.messages.push(userMessage, assistantMessage);

  const episode = createTurnEpisode({ session, userMessage, assistantMessage, now });
  const decision = createDecisionRecord({
    decision: '将卷宗记录视为待核验线索。',
    evidenceMessageIds: ['a1'],
    policy: '角色卡与世界书优先',
    confidence: 0.8,
    reasoning: '这段内部推演不得持久化',
    chainOfThought: '也不得持久化'
  }, { now });

  assert.equal(episode.spec, undefined);
  assert.doesNotMatch(episode.summary, /猜测幕后人|<think>/);
  assert.match(episode.summary, /闻雪照在卷宗中找到/);
  assert.deepEqual(Object.keys(decision).sort(), [
    'confidence',
    'createdAt',
    'decision',
    'evidenceMessageIds',
    'id',
    'policy',
    'visibility'
  ]);
  assert.equal(decision.decision, '将卷宗记录视为待核验线索。');
  assert.equal(sanitizeMemoryText('<analysis>秘密推演</analysis>可见结论'), '可见结论');
  assert.equal(sanitizeMemoryText('已确认剧情。<think>未闭合的内部推演'), '已确认剧情。');
});

test('observeTurn is idempotent and revisions the same assistant branch after an edit', () => {
  const userMessage = message('u1', 'user', '询问旧案。');
  const assistantMessage = message('a1', 'assistant', '闻雪照拿出第一份卷宗。');
  const session = createSession([userMessage, assistantMessage]);
  const service = new MemoryService({ now });

  service.observeTurn({ session, userMessage, assistantMessage });
  service.observeTurn({ session, userMessage, assistantMessage });
  assert.equal(session.memory.episodicMemory.episodes.length, 1);
  assert.equal(session.memory.episodicMemory.episodes[0].revision, 1);

  assistantMessage.content = '闻雪照改为拿出第二份卷宗。';
  service.observeTurn({ session, userMessage, assistantMessage });
  assert.equal(session.memory.episodicMemory.episodes.length, 1);
  assert.equal(session.memory.episodicMemory.episodes[0].revision, 2);
  assert.match(session.memory.episodicMemory.episodes[0].summary, /第二份卷宗/);
});

test('hidden director commands create director-only episodic memory', () => {
  const userMessage = message('u-hidden', 'user', '推进幕后势力行动。', { hiddenFromChat: true });
  const assistantMessage = message('a-hidden', 'assistant', '幕后势力已经改变计划。');
  const session = createSession([userMessage, assistantMessage]);
  const service = new MemoryService({ now });

  service.observeTurn({ session, userMessage, assistantMessage });

  assert.equal(session.memory.episodicMemory.episodes[0].visibility, 'director');
});

test('recordDecision keeps only the structured outcome and evidence', () => {
  const session = createSession();
  const service = new MemoryService({ now });

  const record = service.recordDecision({
    session,
    id: 'decision:a1',
    decision: '暂不公开失踪名单。',
    evidenceMessageIds: ['a1'],
    policy: '避免角色知道尚未公开的信息',
    confidence: 0.9,
    reasoning: '内部判断过程不能进入记忆'
  });
  service.recordDecision({
    session,
    id: 'decision:a1',
    decision: '暂不公开失踪名单。',
    evidenceMessageIds: ['a1'],
    policy: '避免角色知道尚未公开的信息',
    chainOfThought: '重复调用也不能保存原始思维链'
  });

  assert.equal(session.memory.episodicMemory.decisions.length, 1);
  assert.equal(record.id, 'decision:a1');
  assert.deepEqual(session.memory.episodicMemory.decisions[0].evidenceMessageIds, ['a1']);
  assert.doesNotMatch(JSON.stringify(session.memory.episodicMemory.decisions), /内部判断|思维链|reasoning|chainOfThought/);
});

test('retrieveContext combines episodic and vector recall with evidence exclusions and audit', async () => {
  const vectorCalls = [];
  const vectorMemoryService = {
    async isEnabled() { return true; },
    async indexMessages(input) { vectorCalls.push({ kind: 'index', input }); },
    async getTopK() { return 3; },
    async search(input) {
      vectorCalls.push({ kind: 'search', input });
      return [{ messageId: 'vector-old', content: '旧卷宗提到镇武司。', score: 0.91 }];
    }
  };
  const recentMessages = Array.from({ length: 16 }, (_, index) => (
    message(`recent-${index}`, index % 2 ? 'assistant' : 'user', `最近消息 ${index}`)
  ));
  const session = createSession(recentMessages);
  session.memory.episodicMemory.episodes.push({
    id: 'episode:old-a',
    kind: 'episode',
    title: '镇武司旧案',
    summary: '闻雪照曾在镇武司查到一份失踪卷宗。',
    userIntent: '调查镇武司',
    sourceMessageIds: ['old-u', 'old-a'],
    visibility: 'player',
    confidence: 1,
    importance: 0.8,
    status: 'confirmed',
    revision: 1,
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME
  });
  const service = new MemoryService({ vectorMemoryService, now });
  service.recordSceneSummary({
    session,
    title: '镇武司卷宗调查',
    summary: '闻雪照曾经查阅镇武司失踪卷宗。',
    messages: [
      message('old-u', 'user', '调查镇武司。'),
      message('old-a', 'assistant', '闻雪照找到失踪卷宗。')
    ]
  });

  const context = await service.retrieveContext({ session, userMessage: '继续调查镇武司卷宗。' });

  assert.equal(context.spec, MEMORY_SPEC);
  assert.deepEqual(context.episodicHits.map((item) => item.id), ['episode:old-a']);
  assert.equal(context.summaryHits.length, 1);
  assert.equal(context.summaryHits[0].summaryLevel, 'scene');
  assert.deepEqual(context.vectorHits.map((item) => item.messageId), ['vector-old']);
  assert.deepEqual(context.audit, {
    episodicCount: 1,
    summaryCount: 1,
    vectorCount: 1,
    graphRevision: 7,
    graphRelatedEntities: 0,
    graphActionableRelations: 0
  });
  assert.equal(session.memory.episodicMemory.retrievalAudit.length, 1);
  assert.equal(session.memory.episodicMemory.retrievalAudit[0].summaryIds.length, 1);
  const searchCall = vectorCalls.find((call) => call.kind === 'search');
  assert.ok(searchCall.input.excludeMessageIds.includes('recent-15'));
  assert.ok(!searchCall.input.excludeMessageIds.includes('old-a'));
});

test('retrieveContext does not recall a different scene when an explicit active location has no matching evidence', async () => {
  const session = createSession([
    message('recent-u', 'user', '我看向周媛。'),
    message('recent-a', 'assistant', '周媛站在门口。')
  ]);
  session.memory.worldState.location = { name: '周媛住处·小区门口' };
  session.memory.episodicMemory.episodes.push({
    id: 'episode:office', kind: 'episode', title: '写字楼办公室',
    summary: '刘一在翠湖天地的办公室遇见周媛。', userIntent: '看手机',
    sourceMessageIds: ['old-u', 'old-a'], visibility: 'player', confidence: 1,
    importance: 0.8, status: 'confirmed', revision: 1, createdAt: FIXED_TIME, updatedAt: FIXED_TIME
  });
  const service = new MemoryService({ now });

  const context = await service.retrieveContext({ session, userMessage: '我看了一眼手机。' });

  assert.deepEqual(context.episodicHits, []);
});

test('rebuildRange supersedes memories from an abandoned message branch', () => {
  const firstPair = [
    message('u1', 'user', '进入云州城。'),
    message('a1', 'assistant', '城门在暮色中关闭。')
  ];
  const secondPair = [
    message('u2', 'user', '去找闻雪照。'),
    message('a2', 'assistant', '闻雪照在客栈等候。')
  ];
  const session = createSession([...firstPair, ...secondPair]);
  const service = new MemoryService({ now });

  session.memory = service.rebuildRange({ session, messages: session.messages });
  assert.equal(session.memory.episodicMemory.episodes.length, 2);
  assert.ok(session.memory.episodicMemory.episodes.every((item) => item.status === 'confirmed'));

  session.messages = firstPair;
  session.memory = service.rebuildRange({ session, messages: session.messages });
  const abandoned = session.memory.episodicMemory.episodes.find((item) => item.id === 'episode:a2');
  assert.equal(abandoned.status, 'superseded');
  assert.equal(abandoned.validToTurn, 2);
  assert.equal(session.memory.episodicMemory.episodes.find((item) => item.id === 'episode:a1').status, 'confirmed');
});

test('scene summaries promote deterministically into chapters and arcs', () => {
  const session = createSession();
  const service = new MemoryService({ now });

  for (let index = 1; index <= 12; index += 1) {
    const pair = [
      message(`u${index}`, 'user', `推进第 ${index} 个场景。`),
      message(`a${index}`, 'assistant', `第 ${index} 个场景形成了可验证的剧情结果。`)
    ];
    session.messages.push(...pair);
    service.observeTurn({ session, userMessage: pair[0], assistantMessage: pair[1] });
    service.recordSceneSummary({
      session,
      title: `场景 ${index}`,
      summary: `第 ${index} 个场景的独立摘要。`,
      messages: pair
    });
  }

  const state = session.memory.episodicMemory;
  assert.equal(state.summaries.scenes.length, 12);
  assert.equal(state.summaries.chapters.length, 3);
  assert.equal(state.summaries.arcs.length, 1);
  assert.deepEqual(state.summaries.chapters.map((item) => item.childSummaryIds.length), [4, 4, 4]);
  assert.equal(state.summaries.arcs[0].childSummaryIds.length, 3);
  assert.ok(state.summaries.arcs[0].sourceEpisodeRefs.every((ref) => /@1$/.test(ref)));
});

test('editing an episode revision invalidates dependent scene and chapter summaries', () => {
  const session = createSession();
  const service = new MemoryService({ now });

  for (let index = 1; index <= 4; index += 1) {
    const pair = [
      message(`u${index}`, 'user', `第 ${index} 次行动。`),
      message(`a${index}`, 'assistant', `第 ${index} 次行动的旧结果。`)
    ];
    session.messages.push(...pair);
    service.observeTurn({ session, userMessage: pair[0], assistantMessage: pair[1] });
    service.recordSceneSummary({ session, title: `旧场景 ${index}`, summary: `旧摘要 ${index}。`, messages: pair });
  }
  session.memory.rollingSummary = '包含旧场景 1 的滚动摘要。';
  session.messages[1].content = '第 1 次行动经过编辑后的新结果。';

  session.memory = service.rebuildRange({ session, messages: session.messages });

  const state = session.memory.episodicMemory;
  assert.equal(state.episodes.find((item) => item.id === 'episode:a1').revision, 2);
  assert.equal(state.summaries.scenes.find((item) => item.title === '旧场景 1').status, 'superseded');
  assert.equal(state.summaries.chapters[0].status, 'superseded');
  assert.doesNotMatch(session.memory.rollingSummary, /旧摘要 1/);
  assert.match(session.memory.rollingSummary, /旧摘要 2/);
});
