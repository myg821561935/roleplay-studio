import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureSimulationMemory } from '../server/simulation/npcSimulation.js';
import { advanceWorldClock } from '../server/simulation/worldClock.js';
import { inferTurnDuration } from '../server/simulation/chronicleEngine.js';
import { extractActionEnvelope, normalizeActionEnvelope } from '../server/simulation/actionProtocol.js';
import { adjudicateActionEnvelope, replayActionHistory } from '../server/simulation/worldStateArbiter.js';
import { resolveNarrativeTurnFrame, buildTurnFrameStateEnvelope } from '../server/agent/turnFrame.js';

const memory = () => ensureSimulationMemory({
  worldState: { protagonist: {name: '闻雪照', inventory: ['养魂丹×3', '雷纹玉牌']}, location: { current: '小巷' } },
  simulation: { clock: {day: 1, minuteOfDay: 760}, actors: [{ id: 'su', name: '苏月白' }] }
});

test('future notices and recalled days cannot diverge the projected clock', () => {
  const m = memory();
  for (const prose of ['苏月白说：「落雷山渡口，三日后卯时起验牌放行。」', '她回忆：「第二天早上他还坐得直。」', '告示写着三日后开船。']) {
    const projected = advanceWorldClock({day: 5}, prose, {simulation: m.simulation});
    assert.equal(projected.day, 1);
    assert.equal(projected.minuteOfDay, 760);
    assert.equal(projected.timeOfDay, m.simulation.calendar.period.label);
    assert.equal(advanceWorldClock({day: 1}, prose, {allowAmbientAdvance:false}).day, 1);
  }
});

test('quoted durations and unexecuted plans do not charge travel or overnight costs', () => {
  for (const content of ['她问：「三日后出发，要等半小时么？」', '我打算明日返回药铺。', '我没有等待半小时。']) {
    assert.equal(inferTurnDuration({content}).minutes, 10);
  }
  assert.equal(inferTurnDuration({content:'我等半小时再去敲门。'}).minutes, 30);
  assert.equal(inferTurnDuration({content:'闻雪照原路回到药铺。'}).minutes, 45);
});

test('accepted player arrival persists even when the model only writes the greeting', () => {
  const m = memory();
  const frame = resolveNarrativeTurnFrame(null, {
    memory:m, userContent:'闻雪照原路回到药铺，在门边向苏月白打招呼：「东西还在么？」',
    content:'苏月白搁下账本：「还在。你倒回来得早。」'
  });
  assert.equal(frame.scene.location,'药铺');
  const envelope = buildTurnFrameStateEnvelope(frame,m);
  const settled = adjudicateActionEnvelope({memory:m,envelope}).memory;
  assert.equal(settled.worldState.location.current,'药铺');
  assert.equal(replayActionHistory({memory:settled,messages:[]}).memory.worldState.location.current,'小巷');
  assert.equal(replayActionHistory({memory:settled,messages:[{id:'a1',role:'assistant',actionEnvelope:envelope}]}).memory.worldState.location.current,'药铺');
});

test('quoted destinations, NPC movement and unrealized player plans do not teleport the player', () => {
  for (const content of ['苏月白说：「回到药铺再说。」', '苏月白走到药铺。', '闻雪照目送苏月白回到药铺。', '闻雪照打算回到药铺。', '闻雪照走向药铺。']) {
    assert.equal(resolveNarrativeTurnFrame(null,{memory:memory(),content}).scene.location,'小巷');
  }
});

test('one malformed model action does not lose valid inventory and custody updates; manual envelopes stay strict', () => {
  const actions = [
    {type:'state.set',path:'protagonist.inventory',value:['养魂丹×2','雷纹玉牌']},
    {type:'actor.relationship.adjust',from:'苏月白',to:'闻雪照',value:'有限受托'},
    {type:'state.set',path:'resources',value:[{item:'养魂丹',quantity:1,owner:'闻雪照',holder:'苏月白',status:'寄存'}]}
  ];
  const parsed = extractActionEnvelope('接下丹药。\n```lra-actions\n'+JSON.stringify({actions})+'\n```');
  assert.equal(parsed.envelope.actions.length,2);
  assert.equal(parsed.error.code,'ACTION_ITEMS_INVALID');
  assert.equal(JSON.parse(parsed.error.detail)[0].index,1);
  assert.throws(()=>normalizeActionEnvelope({actions}));
  const settled = adjudicateActionEnvelope({memory:memory(),envelope:parsed.envelope}).memory;
  assert.deepEqual(settled.worldState.protagonist.inventory,['养魂丹×2','雷纹玉牌']);
  assert.equal(settled.worldState.resources[0].holder,'苏月白');
  const replayed = replayActionHistory({memory:settled,messages:[]}).memory;
  assert.deepEqual(replayed.worldState.protagonist.inventory,['养魂丹×3','雷纹玉牌']);
  assert.equal(replayed.worldState.resources,undefined);
});

test('clock commit and replay use the same projection across a day boundary', () => {
  const m=memory();m.simulation.clock.minuteOfDay=1435;
  const envelope={actions:[{type:'clock.advance',minutes:15}]};
  const settled=adjudicateActionEnvelope({memory:m,envelope}).memory;
  assert.equal(settled.worldState.clock.day,2);
  assert.equal(settled.worldState.clock.minuteOfDay,10);
  const restored=replayActionHistory({memory:settled,messages:[]}).memory;
  assert.equal(restored.worldState.clock.day,1);
  assert.equal(restored.worldState.clock.minuteOfDay,1435);
});

test('persisted turns, continuation and editing keep clocks, arrival and inventory consistent', async t => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { JsonStore } = await import('../server/lib/jsonStore.js');
  const { ConfigService } = await import('../server/config/configService.js');
  const { SessionService } = await import('../server/services/sessionService.js');
  const { AgentService } = await import('../server/services/agentService.js');
  const root=await mkdtemp(join(tmpdir(),'state-sync-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const store=new JsonStore(root), config=new ConfigService(store);
  let sessions=new SessionService(store);
  await config.saveProviders({activeProviderId:'fake',providers:[{id:'fake',kind:'openai-compatible',baseUrl:'https://example.invalid/v1',apiKey:'test',model:'fake',maxTokens:2000}]});
  const session=await sessions.getSession('main');session.memory=memory();
  await sessions.saveSession(session);
  const replies=[
    '苏月白接下了丹药，说：「三日后开船。」\n```lra-actions\n'+JSON.stringify({actions:[
      {type:'state.set',path:'protagonist.inventory',value:['养魂丹×2','雷纹玉牌']},
      {type:'actor.relationship.adjust',value:'信任'},
      {type:'state.set',path:'resources',value:[{item:'养魂丹',quantity:1,owner:'闻雪照',holder:'苏月白'}]}
    ]})+'\n```',
    '苏月白抬头：「东西都在。你回来得倒早。」',
    '苏月白说：「那个病人，第二天早上还能坐起来。」',
    '苏月白合上账本，等着闻雪照回答。'
  ];
  let calls=0;
  const client={complete:async({messages})=>({content:/记忆整理器|事实提取器/.test(messages[0]?.content)?'{}':replies[calls++],raw:{fake:true}})};
  const agent=()=>new AgentService({configService:config,sessionService:sessions,providerClient:client});
  const inputs=['我把一枚养魂丹交给苏月白暂存。','闻雪照回到药铺，打了个招呼。','我询问她以前的病人。'];
  let firstId;
  for (const [i,content] of inputs.entries()) {
    const result=await agent().sendMessage({sessionId:'main',content});
    firstId ||=result.reply.id;
    sessions=new SessionService(new JsonStore(root));
    const saved=await sessions.getSession('main');
    assert.equal(saved.messages.length,(i+1)*2);
    assert.equal(saved.memory.worldState.clock.day,1);
    assert.equal(saved.memory.worldState.clock.minuteOfDay,saved.memory.simulation.clock.minuteOfDay);
    assert.deepEqual(saved.memory.worldState.protagonist.inventory,['养魂丹×2','雷纹玉牌']);
    assert.equal(saved.memory.worldState.resources[0].holder,'苏月白');
    if(i>0)assert.equal(saved.memory.worldState.location.current,'药铺');
  }
  const before=await sessions.getSession('main');
  await agent().continueMessage({sessionId:'main'});
  const continued=await sessions.getSession('main');
  assert.equal(continued.memory.simulation.clock.minuteOfDay,before.memory.simulation.clock.minuteOfDay);
  assert.equal(continued.memory.worldState.clock.minuteOfDay,continued.memory.simulation.clock.minuteOfDay);
  await agent().editMessage({sessionId:'main',messageId:firstId,content:'苏月白没有接下丹药。'});
  const restored=await sessions.getSession('main');
  assert.deepEqual(restored.memory.worldState.protagonist.inventory,['养魂丹×3','雷纹玉牌']);
  assert.equal(restored.memory.worldState.location.current,'小巷');
  assert.equal(restored.memory.worldState.clock.minuteOfDay,restored.memory.simulation.clock.minuteOfDay);
});

test('explicit opening inventory is seeded once and never refilled by later prose', () => {
  const m=memory();m.worldState.protagonist.inventory=[];
  const content='苏月白说：「先讲清来意。」';
  const frame=resolveNarrativeTurnFrame(null,{memory:m,content});
  const userContent='闻雪照随身带着未点燃的半盏断魂灯、雷纹玉牌、三枚养魂丹和无锋短剑，把信放在柜台上。';
  const envelope=buildTurnFrameStateEnvelope(frame,m,null,{content,userContent,initializeInventory:true});
  assert.deepEqual(envelope.actions[0].value,['未点燃的半盏断魂灯','雷纹玉牌','三枚养魂丹','无锋短剑']);
  assert.equal(buildTurnFrameStateEnvelope(frame,m,null,{content,userContent}),null);
  m.worldState.protagonist.inventory=['养魂丹×2'];
  assert.equal(buildTurnFrameStateEnvelope(frame,m,null,{content,userContent,initializeInventory:true}),null);
  m.worldState.protagonist.inventory=[];
  assert.equal(buildTurnFrameStateEnvelope(frame,m,null,{content,userContent:'她说：「我带着玉牌、三枚丹药和短剑。」',initializeInventory:true}),null);
});

test('a blocked arrival does not turn the player destination into a completed move', () => {
  const frame=resolveNarrativeTurnFrame(null,{memory:memory(),userContent:'闻雪照回到药铺。',content:'你还没走到药铺，就被两名执事拦住了。'});
  assert.equal(frame.scene.location,'小巷');
});

test('the model cannot advance the clock again after the prompt has seen a settled turn', async () => {
  const { WorldSimulationService }=await import('../server/services/worldSimulationService.js');
  const service=new WorldSimulationService({sessionService:{}});
  const session={id:'double-clock',messages:[],settings:{},config:{},memory:memory()};
  const userMessage={id:'u1',role:'user',content:'我询问她。'};
  service.prepareSession(session);
  service.prepareInteraction({session,userMessage});
  const expected=session.memory.simulation.clock.minuteOfDay;
  const envelope={actions:[{type:'clock.advance',minutes:12},{type:'state.set',path:'flags.heard',value:true}]};
  const projected=service.projectDecisionMemory({session,assistantMessage:{},actionEnvelope:envelope});
  assert.equal(projected.simulation.clock.minuteOfDay,expected);
  const assistantMessage={id:'a1',role:'assistant',content:'她说：「三日后开船。」'};
  service.applyTurn({session,userMessage,assistantMessage,actionEnvelope:envelope});
  assert.equal(session.memory.simulation.clock.minuteOfDay,expected);
  assert.equal(session.memory.worldState.clock.minuteOfDay,expected);
  assert.equal(session.memory.worldState.flags.heard,true);
  assert.equal(assistantMessage.actionError.code,'ACTION_CLOCK_ALREADY_SETTLED');
  assert.equal(assistantMessage.actionEnvelope.actions.filter(a=>a.type==='clock.advance').length,1);
  assert.equal(replayActionHistory({memory:session.memory,messages:[assistantMessage]}).memory.simulation.clock.minuteOfDay,expected);
});

test('preparing a stale saved session reconciles both clock views before the next prompt', async () => {
  const { WorldSimulationService }=await import('../server/services/worldSimulationService.js');
  const m=memory();
  m.simulationBaseline=structuredClone(m.simulation);
  m.worldStateBaseline=structuredClone(m.worldState);
  const session={id:'stale',settings:{},config:{},memory:m,messages:[{id:'a1',role:'assistant',actionEnvelope:{actions:[{type:'clock.advance',minutes:20}]}}]};
  new WorldSimulationService({sessionService:{}}).prepareSession(session);
  assert.equal(session.memory.simulation.clock.minuteOfDay,780);
  assert.equal(session.memory.worldState.clock.minuteOfDay,780);
});

test('middle-dot NPC worldbook titles register the real actor name and accept relationship changes', () => {
  const m=ensureSimulationMemory({worldState:{protagonist:{name:'闻雪照'}}},{worldBook:[
    {id:'su',type:'character',title:'NPC · 苏月白',content:'苏月白是丹修医女。'},
    {id:'yun',type:'character',title:'NPC · 云千鹤',content:'云千鹤是戒律堂执事。'},
    {id:'system',type:'character',title:'NPC · 世界观',content:'系统说明。'}
  ]});
  assert.deepEqual(m.simulation.actors.map(a=>a.name),['苏月白','云千鹤']);
  const settled=adjudicateActionEnvelope({memory:m,envelope:{actions:[{type:'actor.relationship.adjust',actorId:'苏月白',targetId:'云千鹤',delta:1}]}});
  assert.equal(settled.result.status,'accepted');
});

test('a malformed emotion closing tag cannot consume the following visible story', async () => {
  const backend=await import('../server/agent/roleplayResponse.js');
  const frontend=await import('../public/modules/roleplayResponse.js');
  for(const parser of [backend.parseRoleplayResponse,frontend.extractRoleplayPresentation]){
    assert.equal(parser('<emotion>沉静</em>\n<plot>她把药包放回柜台。</plot>').content,'她把药包放回柜台。');
    assert.equal(parser('<emotion>沉静\n<plot>她把药包放回柜台。</plot>').content,'她把药包放回柜台。');
    assert.equal(parser('<emotion>沉').content,'');
    assert.equal(parser('<emotion>沉<analysis><content>内部草稿</content></analysis>').content,'');
  }
});
