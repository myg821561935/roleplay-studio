import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildSceneContinuity, actorPresenceEvents, renderSceneContinuity, renderExplicitTurnBoundary } from '../server/agent/sceneContinuity.js';
import { resolveProtagonistIdentity, replaceProtagonistPlaceholders, normalizeProtagonistPresentation } from '../server/agent/protagonistIdentity.js';
import { assemblePrompt } from '../server/agent/promptAssembler.js';
import { deriveConservativeNarrativeTurnFrame, resolveNarrativeTurnFrame, normalizeNarrativeTurnFrame } from '../server/agent/turnFrame.js';
import { JsonStore } from '../server/lib/jsonStore.js';
import { ConfigService } from '../server/config/configService.js';
import { SessionService } from '../server/services/sessionService.js';
import { AgentService } from '../server/services/agentService.js';

const memory = { worldState: { protagonist: { name: '林舟' }, characters: [{ name: '鲐萍' }] } };
const msg = (id, content, extra = {}) => ({ id, role: 'assistant', content, ...extra });

test('explicit observation and location limits reach the final turn calibration', () => {
  assert.equal(renderExplicitTurnBoundary('我拿起锄头，走到西边。'), '');
  const a = assemblePrompt({ characterCard: { name: '场景' }, promptModules: [], worldBook: [], memory, messages: [], userMessage: '观察那株灵犀草，暂不采取新行动。保持当前的地点。', options: { maxPromptTokens: 16000 } });
  assert.match(a.messages.at(-2).content, /不制造新的损坏来驱动返工/);
  assert.match(a.messages.at(-2).content, /不自动执行对方此前交代的任务/);
});

test('identity uses persona then confirmed name; placeholders are never a chosen name', () => {
  assert.equal(resolveProtagonistIdentity({}, memory).name, '林舟');
  assert.equal(resolveProtagonistIdentity({ enabled: true, name: '青禾' }, memory).name, '青禾');
  const identity = resolveProtagonistIdentity({}, memory);
  assert.equal(replaceProtagonistPlaceholders('<user>把工具收好。主角原名 / {{user}}', identity), '林舟把工具收好。林舟 / 林舟');
  assert.equal(replaceProtagonistPlaceholders('<user>结构化玩家输入</user>', identity), '<user>结构化玩家输入</user>');
  assert.deepEqual(resolveProtagonistIdentity({}, { worldState: { protagonist: { name: '<user>' } } }), { name: '', label: '主角' });
  const output = { reply: { content: '<user>站定。' }, turnFrame: { scene: { presentActors: ['<user>'] } }, roleplayPanels: { sceneStatus: '主角原名在场' }, mvuEnvelope: { path: '/<user>', value: '{{user}}' } };
  normalizeProtagonistPresentation(output, identity);
  assert.deepEqual(output.turnFrame.scene.presentActors, ['林舟']);
  assert.equal(output.roleplayPanels.sceneStatus, '林舟在场');
  assert.deepEqual(output.mvuEnvelope, { path: '/<user>', value: '{{user}}' });
});

test('only actual narrated departures and returns count, with the correct actor', () => {
  for (const content of ['鲐萍说：“我离开了。”', '<npc_thought>鲐萍已经离开。</npc_thought>', '如果鲐萍离开了，林舟就回去。', '鲐萍没有离开。', '鲐萍正要离去。']) {
    assert.deepEqual(actorPresenceEvents(content, '鲐萍'), [], content);
  }
  const content = '鲐萍收起折扇，转身离去了。林舟站在原地。鲐萍稍后返回田边。';
  assert.deepEqual(actorPresenceEvents(content, '鲐萍').map(e => e.status), ['departed', 'present']);
  assert.deepEqual(actorPresenceEvents('鲐萍目送林舟离去了。', '鲐萍', ['鲐萍', '林舟']), []);
  assert.deepEqual(actorPresenceEvents('林舟朝那身影没入的方向应了一声。', '林舟'), []);
  const frame = deriveConservativeNarrativeTurnFrame({ content: '鲐萍已经离开。林舟留在田边。<npc_thought>鲐萍想起灵田。</npc_thought>', memory });
  assert.ok(!frame.scene.presentActors.includes('鲐萍'));
  const declared = normalizeNarrativeTurnFrame({ scene: { summary: '巡视结束', presentActors: ['鲐萍', '林舟'] } });
  const reconciled = resolveNarrativeTurnFrame(declared, { content: '鲐萍已经离开。林舟留在田边。', memory });
  assert.ok(!reconciled.scene.presentActors.includes('鲐萍'));
});

test('accepted source ids survive long history and completed actions are not inferred from plans', () => {
  const messages = [msg('done', '林舟已将根部覆土盖严。鲐萍收起折扇，转身离去了。'),
    ...Array.from({ length: 30 }, (_, i) => msg(`later-${i}`, '微风吹过田埂。')),
    msg('plan', '林舟准备把工具修好。'), msg('denied', '林舟没有完成了任务。'),
    msg('hidden', '鲐萍返回田边。', { excluded: true }), msg('draft', '鲐萍返回田边。', { contextExcluded: true }), msg('abort', '鲐萍返回田边。', { aborted: true })];
  const state = buildSceneContinuity({ messages, memory });
  assert.equal(state.actors[0].status, 'departed');
  assert.equal(state.completedActions.length, 1);
  assert.equal(state.completedActions[0].sourceMessageId, 'done');
  const a = assemblePrompt({ characterCard: { name: '场景', sourceSpec: 'chara_card_v3', description: '<user>在田边。' }, promptModules: [], worldBook: [], memory, messages, userMessage: '观察周围', options: { maxPromptTokens: 16000, recentPairs: 1, agentEnhancements: { memoryRecall: false } } });
  assert.match(a.messages.map(m => m.content).join('\n'), /已完成动作（来源 done）/);
  assert.ok(!a.messages.some(m => m.content.includes('<user>')));
  const returned = buildSceneContinuity({ messages: [...messages, msg('return', '鲐萍返回田边。')], memory });
  assert.doesNotMatch(renderSceneContinuity(returned), /离场人物 鲐萍/);
});

test('natural completed-result wording and a sole remaining actor preserve the same facts', () => {
  const state = buildSceneContinuity({ memory, messages: [msg('natural', '最后那株灵犀草的根须已埋得严实，林舟直起身，把空筐搁下。鲐萍收回目光，落在林舟身上。她交代完便沿田埂行去。身影隐进灌木影里。田里又只剩林舟一人。')] });
  assert.equal(state.completedActions.length, 1);
  assert.equal(state.actors.find(a => a.actor === '鲐萍').status, 'departed');
  const returned = buildSceneContinuity({ memory, messages: [msg('natural', '鲐萍沿田埂离去。田里只剩林舟一人。鲐萍随后返回田边。')] });
  assert.equal(returned.actors.find(a => a.actor === '鲐萍').status, 'present');
  assert.match(renderSceneContinuity(returned), /人物已明确返回 鲐萍/);
  const indirect = buildSceneContinuity({ memory, messages: [msg('indirect', '压到最后一处，他拇指贴着根颈把周围的土按了两遍，才松开手。鲐萍交代了浇水的时辰。她转身沿原路走回去。人影很快被水汽吞没。田埂上又只剩下他一个人。')] });
  assert.equal(indirect.completedActions.length, 1);
  assert.ok(indirect.sceneObservations.some(o => o.evidence.includes('只剩下他一个人')));
  assert.deepEqual(actorPresenceEvents('<time>地界方位：绝世仙宗</time>鲐萍离去了。田里只剩林舟一人。', '绝世仙宗', ['绝世仙宗', '林舟']), []);
  const resultAdjective = buildSceneContinuity({ memory, messages: [msg('result', '鲐萍的视线在那覆好的根部停了一瞬。话音落，人已转身。青绿的背影没入雾里，脚步声渐渐远下去，田垄上只剩水渠细细的流声。')] });
  assert.equal(resultAdjective.completedActions.length, 1);
  assert.ok(resultAdjective.sceneObservations.some(o => o.evidence.includes('背影没入雾里')));
});

test('real turn commits reload continuity for the next request; hiding the source rebuilds it', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'continuity-commit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new JsonStore(root), configService = new ConfigService(store), sessionService = new SessionService(store);
  await configService.saveProviders({ activeProviderId: 'fake', providers: [{ id: 'fake', kind: 'openai-compatible', baseUrl: 'https://example.com/v1', apiKey: 'fake', model: 'fake', maxTokens: 2000 }] });
  const session = await sessionService.getSession('main');
  session.memory.worldState = { ...session.memory.worldState, ...memory.worldState };
  session.settings.agentEnhancements = { memoryRecall: false, npcSimulation: false, plotGuidance: false, actionSuggestions: false };
  await sessionService.saveSession(session);
  const requests = [];
  const service = new AgentService({ configService, sessionService, providerClient: { complete: async ({ messages }) => {
    requests.push(messages);
    return { content: requests.length === 1 ? '<user>已将根部覆土盖严。鲐萍收起折扇，转身离去了。' : '林舟看着田埂上的晨露。', raw: { fake: true } };
  } } });
  const first = await service.sendMessage({ sessionId: 'main', content: '把根部覆土做好，再目送鲐萍离开。' });
  assert.match(first.reply.content, /^林舟/);
  const persisted = await new SessionService(new JsonStore(root)).getSession('main');
  assert.equal(persisted.memory.sceneContinuity.completedActions[0].sourceMessageId, first.reply.id);
  assert.equal(persisted.memory.sceneContinuity.actors.find(a => a.actor === '鲐萍').status, 'departed');
  await service.sendMessage({ sessionId: 'main', content: '停在原地观察。' });
  assert.match(requests[1].map(m => m.content).join('\n'), /离场人物 鲐萍/);
  await service.toggleMessageVisibility({ sessionId: 'main', messageId: first.reply.id, excluded: true });
  const hidden = await sessionService.getSession('main');
  assert.equal(hidden.memory.sceneContinuity.completedActions.length, 0);
  assert.equal(hidden.memory.sceneContinuity.actors.length, 0);
  await service.toggleMessageVisibility({ sessionId: 'main', messageId: first.reply.id });
  assert.equal((await sessionService.getSession('main')).memory.sceneContinuity.completedActions.length, 1);
  await service.editMessage({ sessionId: 'main', messageId: first.reply.id, content: '林舟停在田埂边，鲐萍仍在观察灵犀草。' });
  const edited = await sessionService.getSession('main');
  assert.equal(edited.memory.sceneContinuity.completedActions.length, 0);
  assert.equal(edited.memory.sceneContinuity.actors.length, 0);
});
