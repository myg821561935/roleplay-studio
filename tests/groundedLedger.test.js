import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { adjudicateActionEnvelope, replayActionHistory } from '../server/simulation/worldStateArbiter.js';
import { initialItemLedger, renderGroundedLedger, groundTurnLedgerEnvelope } from '../server/simulation/groundedLedger.js';
import { ensureSimulationMemory } from '../server/simulation/npcSimulation.js';
import { WorldSimulationService } from '../server/services/worldSimulationService.js';
import { SessionService } from '../server/services/sessionService.js';
import { JsonStore } from '../server/lib/jsonStore.js';

function memory() { return ensureSimulationMemory({worldState:{protagonist:{name:'闻雪照',inventory:['三枚养魂丹','灰信','雷纹玉牌']},location:{current:'药铺'}},simulation:{actors:[{id:'su',name:'苏月白'}]}}); }
const env = actions => ({spec:'lra.action/v1',actorId:'narrator',actions});
function apply(mem, actions, user='', assistant='') { return adjudicateActionEnvelope({memory:mem,envelope:env(actions),evidenceContext:{userMessage:{id:'u',content:user},assistantMessage:{id:'a',content:assistant}}}); }
const proof = (source,quote) => ({source,quote});
const proposal = {type:'commitment.update',commitmentId:'deposit',title:'寄存',terms:'三日内取回',counterparty:'su',status:'proposed',evidence:proof('assistant','苏月白说：“寄存须三日内取回。”')};
const commit = {type:'commitment.update',commitmentId:'deposit',status:'committed',evidence:proof('user','我同意寄存，三日内取回')};
function move(mem, quote, source='user', overrides={}) { return {type:'item.move',itemId:initialItemLedger(mem).find(x=>x.name==='养魂丹').id,quantity:1,actor:source==='user'?'player':'su',holder:'',location:'柜台',evidence:proof(source,quote),...overrides}; }

test('pending proposal cannot become a promise through NPC recollection, silence, hypothetical or quoted NPC speech',()=>{
 const pending=apply(memory(),[proposal],'',proposal.evidence.quote).memory;
 for (const [user,assistant,action] of [
  ['我先去街对面看看','苏月白说：“你答应了寄存。”',{...commit,evidence:proof('assistant','你答应了寄存')}],
  ['如果我同意寄存，三日内取回呢？','',commit],
  ['我没有说我同意寄存，三日内取回','',commit],
  ['苏月白说：“我同意寄存，三日内取回。”','',commit],
  ['我同意寄存，三日内取回吗？','',commit]
 ]) { const r=apply(pending,[action],user,assistant);assert.equal(r.result.accepted.length,0);assert.equal(r.memory.worldState.commitments[0].status,'proposed'); }
 const agreed=apply(pending,[commit],commit.evidence.quote);assert.equal(agreed.memory.worldState.commitments[0].status,'committed');
});
test('promise and performance are separate, immutable and replayable stages',()=>{
 const execute={type:'commitment.update',commitmentId:'deposit',status:'executed',evidence:proof('assistant','苏月白完成寄存封存')};
 const p=apply(memory(),[proposal],'',proposal.evidence.quote).memory;
 assert.equal(apply(p,[execute],'',execute.evidence.quote).result.rejected[0].code,'LEDGER_COMMITMENT_REQUIRED');
 const a=apply(p,[commit],commit.evidence.quote).memory;
 assert.equal(apply(a,[{...execute,evidence:proof('assistant','苏月白准备完成寄存封存')}],'','苏月白准备完成寄存封存').result.accepted.length,0);
 assert.equal(apply(a,[{...execute,terms:'立刻赠送'}],'',execute.evidence.quote).result.rejected[0].code,'LEDGER_TERMS_IMMUTABLE');
 assert.equal(apply(a,[execute],'',execute.evidence.quote).memory.worldState.commitments[0].status,'executed');
});
test('rejection does not become consent later without a new proposal',()=>{
 const p=apply(memory(),[proposal],'',proposal.evidence.quote).memory;
 const reject={...commit,status:'rejected',evidence:proof('user','我拒绝寄存条件')};
 const r=apply(p,[reject],reject.evidence.quote).memory;
 assert.equal(r.worldState.commitments[0].status,'rejected');assert.equal(apply(r,[commit],commit.evidence.quote).result.accepted.length,0);
});
test('placing one of three pills, NPC custody, return and gift preserve quantities and distinguish owner from holder',()=>{
 let m=memory();const original=structuredClone(m);
 const put=move(m,'闻雪照把一枚养魂丹放在柜台');m=apply(m,[put],put.evidence.quote).memory;
 assert.deepEqual(original.worldState.protagonist.inventory,['三枚养魂丹','灰信','雷纹玉牌']);
 assert.equal(m.worldState.itemLedger.filter(x=>x.name==='养魂丹').reduce((n,x)=>n+x.quantity,0),3);
 assert.ok(m.worldState.protagonist.inventory.includes('养魂丹×2枚'));
 let lot=m.worldState.itemLedger.find(x=>!x.holder);
 const take=move(m,'苏月白把一枚养魂丹收进木匣','assistant',{itemId:lot.id,holder:'su',location:'木匣'});
 m=apply(m,[take],'',take.evidence.quote).memory;lot=m.worldState.itemLedger.find(x=>x.id===lot.id);
 assert.equal(lot.owner,'闻雪照');assert.equal(lot.holder,'苏月白');assert.equal(lot.location,'木匣');
 const back=move(m,'闻雪照取回一枚养魂丹，收回随身','user',{itemId:lot.id,holder:'player',location:'随身'});
 m=apply(m,[back],back.evidence.quote).memory;assert.ok(m.worldState.protagonist.inventory.includes('养魂丹×3枚'));
 const gift={...move(m,'闻雪照把一枚养魂丹送给苏月白','user',{itemId:lot.id,holder:'su',location:'随身'}),type:'item.transfer',owner:'su'};
 m=apply(m,[gift],gift.evidence.quote).memory;assert.equal(m.worldState.itemLedger.find(x=>x.id===lot.id).owner,'苏月白');
 assert.ok(m.worldState.protagonist.inventory.includes('养魂丹×2枚'));assert.equal(m.worldState.resourceLedger.length,4);
});
test('custody guard rejects imagined, quoted, fabricated, excessive and duplicate movement without partial mutations',()=>{
 const m=memory();
 for(const q of ['苏月白说：“闻雪照把一枚养魂丹放在柜台”','闻雪照准备把一枚养魂丹放在柜台','闻雪照没有把一枚养魂丹放在柜台']) {
  const r=apply(m,[move(m,q)],q);assert.equal(r.result.accepted.length,0);assert.equal(r.memory.worldState.itemLedger,undefined);
 }
 const q='闻雪照把一枚养魂丹放在柜台';
 assert.equal(apply(m,[move(m,q)],'闻雪照只是看着柜台').result.accepted.length,0);
 assert.equal(apply(m,[move(m,q,'user',{quantity:4})],q).result.accepted.length,0);
 assert.equal(apply(m,[move(m,q,'user',{quantity:2})],q).result.accepted.length,0);
 assert.equal(apply(m,[move(m,'苏月白收起三枚养魂丹','assistant',{quantity:3,holder:'su',location:'随身'})],'','苏月白收起三枚养魂丹').result.accepted.length,0);
 const placed=apply(m,[move(m,q)],q).memory;
 const lot=placed.worldState.itemLedger.find(x=>!x.holder);
 assert.equal(apply(placed,[move(placed,q,'user',{itemId:lot.id})],q).result.accepted.length,0);
 assert.equal(apply(placed,[{type:'state.set',path:'protagonist.inventory',value:['三枚养魂丹']}]).result.rejected[0].code,'LEDGER_DIRECT_WRITE_FORBIDDEN');
 const fakeGift={...move(placed,'闻雪照把一枚养魂丹交给苏月白暂存','user',{itemId:lot.id,holder:'su',location:'随身'}),type:'item.transfer',owner:'su'};
 assert.equal(apply(placed,[fakeGift],fakeGift.evidence.quote).result.accepted.length,0);
});
test('registering an already tracked item cannot refill inventory; new acquisition needs user evidence',()=>{
 const a={type:'item.register',itemId:'letter',name:'封蜡纸信',quantity:1,evidence:proof('user','闻雪照带着一封封蜡纸信')};
 const r=apply(memory(),[a],a.evidence.quote);assert.equal(r.result.accepted.length,1);
 assert.equal(apply(r.memory,[{...a,itemId:'letter-2'}],a.evidence.quote).result.rejected[0].code,'LEDGER_ITEM_ALREADY_TRACKED');
 assert.equal(apply(memory(),[{...a,quantity:3}],a.evidence.quote).result.rejected[0].code,'LEDGER_QUANTITY_NOT_GROUNDED');
 assert.match(renderGroundedLedger(r.memory),/待协商不是承诺/);
});
test('real session reload and history replay restore commitment and inventory at the selected branch',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ledger-'));
 try {
  let sessions=new SessionService(new JsonStore(dir));let s=await sessions.createSessionWithConfig({id:'ledger',title:'ledger',config:{}});s.memory=memory();s.memory.worldStateBaseline=structuredClone(s.memory.worldState);s.memory.simulationBaseline=structuredClone(s.memory.simulation);
  const world=new WorldSimulationService({sessionService:sessions});const turns=[
   {u:'先讲条件',a:proposal.evidence.quote,actions:[proposal]},
   {u:'闻雪照把一枚养魂丹放在柜台',a:'苏月白没有接。',actions:[move(s.memory,'闻雪照把一枚养魂丹放在柜台')]},
   {u:commit.evidence.quote,a:'苏月白点头。',actions:[commit]}
  ];
  for(const [i,t] of turns.entries()) {
   const userMessage={id:'u'+i,role:'user',content:t.u},assistantMessage={id:'a'+i,role:'assistant',content:t.a};
   s.messages.push(userMessage,assistantMessage);world.applyTurn({session:s,userMessage,assistantMessage,actionEnvelope:env(t.actions)});await sessions.saveSession(s);sessions=new SessionService(new JsonStore(dir));s=await sessions.getSession('ledger');
  }
  assert.equal(s.memory.worldState.commitments[0].status,'committed');assert.ok(s.memory.worldState.protagonist.inventory.includes('养魂丹×2枚'));
  const replay=replayActionHistory({memory:s.memory,messages:s.messages}).memory;
  assert.deepEqual(replay.worldState.itemLedger,s.memory.worldState.itemLedger);assert.deepEqual(replay.worldState.commitments,s.memory.worldState.commitments);
  const rollback=replayActionHistory({memory:s.memory,messages:s.messages.slice(0,4)}).memory;assert.equal(rollback.worldState.commitments[0].status,'proposed');
  const edited=structuredClone(s.messages);edited[4].content='我只是看看';const invalidated=replayActionHistory({memory:s.memory,messages:edited}).memory;assert.equal(invalidated.worldState.commitments[0].status,'proposed');
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});

test('explicit player fallback repairs paraphrased model evidence without inferring consent',()=>{
 let m=memory();
 const userMessage={id:'p1',content:'闻雪照对苏月白说：「暂存条件是三日内取回。我只是提出方案。」'};
 const assistantMessage={id:'a1',content:'苏月白只讲条件。'};
 const bad={...proposal,title:'向药铺寄存的方案',terms:'三日内取回且附加费用',evidence:proof('user','暂存条件是三日内取回')};
 let e=groundTurnLedgerEnvelope(m,env([bad]),{userMessage,assistantMessage});
 let r=adjudicateActionEnvelope({memory:m,envelope:e,evidenceContext:{userMessage,assistantMessage}});m=r.memory;
 assert.equal(m.worldState.commitments[0].title,'暂存');assert.equal(m.worldState.commitments[0].terms,'三日内取回');assert.equal(m.worldState.commitments[0].status,'proposed');
 const u={id:'p2',content:'闻雪照把一枚养魂丹放在柜台。她说：「先放这里，不要封存。」'};
 e=groundTurnLedgerEnvelope(m,env([move(m,'先放这里，不要封存')]),{userMessage:u,assistantMessage});
 r=adjudicateActionEnvelope({memory:m,envelope:e,evidenceContext:{userMessage:u,assistantMessage}});
 assert.ok(r.memory.worldState.protagonist.inventory.includes('养魂丹×2枚'));assert.equal(r.memory.worldState.commitments[0].status,'proposed');
 const consent={id:'p3',content:'我同意暂存，三日内取回。但还没有交付，不要现在执行。'};
 e=groundTurnLedgerEnvelope(r.memory,null,{userMessage:consent,assistantMessage});
 r=adjudicateActionEnvelope({memory:r.memory,envelope:e,evidenceContext:{userMessage:consent,assistantMessage}});
 assert.equal(r.memory.worldState.commitments[0].status,'committed');
});
test('duplicate evidence cannot move the same unit twice; another named actor is not the player',()=>{
 const m=memory(),q='闻雪照把一枚养魂丹放在柜台',a=move(m,q);
 const r=apply(m,[{...a,id:'first'},{...a,id:'second'}],q);
 assert.equal(r.result.accepted.length,1);assert.equal(r.result.rejected[0].code,'LEDGER_DUPLICATE_EVIDENCE');assert.ok(r.memory.worldState.protagonist.inventory.includes('养魂丹×2枚'));
 const bad=move(m,'苏月白把一枚养魂丹放在柜台');assert.equal(apply(m,[bad],bad.evidence.quote).result.accepted.length,0);
});

test('NPC indirect prose tracks a unique pill moved with a ruler, but not a refused letter or ambiguous pronoun',()=>{
 let m=memory();const put=move(m,'闻雪照把一枚养魂丹放在柜台');m=apply(m,[put],put.evidence.quote).memory;
 const context={userMessage:{id:'npc-u',content:'请实际收好养魂丹，灰信先别动。'},assistantMessage:{id:'npc-a',content:'苏月白收回手。\n\n「信我不接。」\n\n她从扁木匣里抽出旧竹尺，尺端压住黄麻纸，一推，纸带着丹滑了半寸，压到暗屉上沿；再一挑，连纸带丹落了进去。'}};
 const e=groundTurnLedgerEnvelope(m,null,context);assert.ok(e);
 const r=adjudicateActionEnvelope({memory:m,envelope:e,evidenceContext:context});
 const pill=r.memory.worldState.itemLedger.find(x=>x.quantity===1&&x.name==='养魂丹');assert.equal(pill.holder,'苏月白');assert.equal(pill.location,'暗屉');assert.equal(pill.owner,'闻雪照');
 assert.equal(r.memory.worldState.itemLedger.find(x=>x.name==='灰信').holder,'闻雪照');
 const ambiguous={...context,assistantMessage:{id:'other',content:'苏月白收回手。少年伸出手。她把丹放进木匣。'}};
 assert.equal(groundTurnLedgerEnvelope(m,null,ambiguous),null);
 const back={userMessage:{id:'back-u',content:'请放回柜台。'},assistantMessage:{id:'back-a',content:'苏月白拉开暗屉。她没有用手去拿黄麻纸，改用竹尺抄起，纸连着丹滑出来，落在青石上，轻得几乎没有声音。'}};
 const b=adjudicateActionEnvelope({memory:r.memory,envelope:groundTurnLedgerEnvelope(r.memory,null,back),evidenceContext:back});
 assert.equal(b.memory.worldState.itemLedger.find(x=>x.id===pill.id).holder,'');assert.equal(b.memory.worldState.itemLedger.find(x=>x.id===pill.id).location,'青石');
});

test('custody lifecycle records receipt and whole-container return without inferring unwrapping or player pickup',()=>{
 let m=memory();
 const turn=(id,user,assistant)=>{
  const context={userMessage:{id:'u-'+id,content:user},assistantMessage:{id:'a-'+id,content:assistant}};
  const envelope=groundTurnLedgerEnvelope(m,null,context);
  if(envelope) m=adjudicateActionEnvelope({memory:m,envelope,evidenceContext:context}).memory;
 };
 turn(1,'闻雪照对苏月白说：「短存条件是今日酉时取回。」','苏月白点头。');
 assert.equal(m.worldState.commitments[0].status,'proposed');
 turn(2,'我同意短存，今日酉时取回。','苏月白等着。');
 assert.equal(m.worldState.commitments[0].status,'committed');
 turn(3,'闻雪照把一枚养魂丹放在柜台。短存现在可以执行，请实际收存养魂丹。','苏月白展开油纸。她把纸上的丹送到匣中。');
 assert.equal(m.worldState.commitments[0].status,'executed');
 const pill=()=>m.worldState.itemLedger.find(x=>x.name==='养魂丹'&&x.quantity===1);
 assert.equal(pill().holder,'苏月白');assert.equal(pill().owner,'闻雪照');
 turn(4,'请把养魂丹放回柜台，我还没取回。','苏月白拉开抽屉。她把木匣放在柜台正中，翻盖，仍旧朝着闻雪照的方向。她看了那纸包一眼，才把它托起来——两只手都没有抖——放到柜台上原来那个位置。');
 // The explicit whole-box move establishes the more precise surface position.
 // The later unnamed paper package alone cannot prove the tracked item left it.
 assert.equal(pill().holder,'');assert.equal(pill().location,'柜台正中');assert.equal(pill().container,'木匣');assert.equal(pill().owner,'闻雪照');
 turn(5,'闻雪照把一枚养魂丹取回，收进自己的随身袋。','苏月白点头。');
 assert.equal(pill().holder,'闻雪照');
 turn(6,'闻雪照把一枚养魂丹赠给苏月白。','苏月白收下了。');
 assert.equal(m.worldState.itemLedger.filter(x=>x.owner==='闻雪照'&&x.name==='养魂丹').reduce((n,x)=>n+x.quantity,0),2);
 assert.equal(m.worldState.itemLedger.filter(x=>x.name==='养魂丹').reduce((n,x)=>n+x.quantity,0),3);
});

test('a unique item sealed in a named container follows its observed movement; views cannot be overwritten',()=>{
 let m=memory();const q='闻雪照把一枚养魂丹放在柜台';m=apply(m,[move(m,q)],q).memory;
 const context={userMessage:{id:'seal-u',content:'请苏月白实际收存养魂丹。'},assistantMessage:{id:'seal-a',content:'苏月白把油纸展开，抬头看闻雪照。闻雪照没讲。随后把木匣的盒盖扣上，纸垫、丹、隔火纸，一层压一层。木匣被放进抽屉第三格，她把锁挂上去，没有落锁。'}};
 const result=adjudicateActionEnvelope({memory:m,envelope:groundTurnLedgerEnvelope(m,null,context),evidenceContext:context});
 const pill=result.memory.worldState.itemLedger.find(x=>x.name==='养魂丹'&&x.quantity===1);
 assert.equal(pill.holder,'苏月白');assert.equal(pill.location,'抽屉第三格');assert.equal(pill.owner,'闻雪照');
 assert.equal(apply(result.memory,[{type:'state.set',path:'resourceLedger',value:[]}]).result.rejected[0].code,'ACTION_PATH_FORBIDDEN');
 const pending=apply(result.memory,[proposal],'',proposal.evidence.quote).memory;
 assert.equal(apply(pending,[{type:'state.set',path:'obligations',value:[]}]).result.rejected[0].code,'ACTION_PATH_FORBIDDEN');
 const unrelated={...context,assistantMessage:{id:'other-container',content:'苏月白收回手。铁匣被放进抽屉第三格。'}};
 assert.equal(groundTurnLedgerEnvelope(m,null,unrelated),null);
});

test('adjacent prose sentences resolve a placed item without mistaking a new object for it',()=>{
 let m=memory();const q='闻雪照把一枚养魂丹放在柜台';m=apply(m,[move(m,q)],q).memory;
 const lot=m.worldState.itemLedger.find(x=>x.name==='养魂丹'&&x.quantity===1);
 m=apply(m,[move(m,'苏月白把丹放进木匣','assistant',{itemId:lot.id,holder:'su',location:'木匣'})],'','苏月白把丹放进木匣').memory;
 const context={userMessage:{id:'adj-u',content:'请把养魂丹放回柜台。'},assistantMessage:{id:'adj-a',content:'苏月白打开木匣。\n\n然后她把丹放下。不是递过去，也不是推到人面前，而是放在台面上，纸包的一角朝着自己这一边。'}};
 const r=adjudicateActionEnvelope({memory:m,envelope:groundTurnLedgerEnvelope(m,null,context),evidenceContext:context});
 assert.equal(r.memory.worldState.itemLedger.find(x=>x.id===lot.id).holder,'');
 assert.equal(r.memory.worldState.itemLedger.find(x=>x.id===lot.id).location,'台面');
 const other={...context,assistantMessage:{id:'adj-other',content:'苏月白看着丹。\n\n拿出一只杯子，把它放在台面上。'}};
 assert.equal(groundTurnLedgerEnvelope(m,null,other),null);
});

test('moving a closed container onto the counter preserves containment and does not claim player pickup',()=>{
 let m=memory();const q='闻雪照把一枚养魂丹放在柜台';m=apply(m,[move(m,q)],q).memory;
 const lot=m.worldState.itemLedger.find(x=>x.name==='养魂丹'&&x.quantity===1);
 m=apply(m,[move(m,'苏月白把丹放进匣里','assistant',{itemId:lot.id,holder:'su',location:'匣'})],'','苏月白把丹放进匣里').memory;
 const context={userMessage:{id:'box-u',content:'请将养魂丹放回柜台。'},assistantMessage:{id:'box-a',content:'苏月白起身开锁。她把那只木匣取出来，托在掌上，走回柜台正中，稳稳放下。麻线没有解开。她退了半步。'}};
 const r=adjudicateActionEnvelope({memory:m,envelope:groundTurnLedgerEnvelope(m,null,context),evidenceContext:context});
 const item=r.memory.worldState.itemLedger.find(x=>x.id===lot.id);
 assert.equal(item.holder,'');assert.equal(item.owner,'闻雪照');assert.equal(item.location,'柜台正中');assert.equal(item.container,'木匣');
 assert.ok(r.memory.worldState.protagonist.inventory.includes('养魂丹×2枚'));
 const unbox=apply(r.memory,[move(r.memory,'苏月白把丹放在柜台正中','assistant',{itemId:lot.id,location:'柜台正中'})],'','苏月白把丹放在柜台正中');
 assert.equal(unbox.result.accepted.length,1);assert.equal(unbox.memory.worldState.itemLedger.find(x=>x.id===lot.id).container,'');
 const next=apply(r.memory,[move(r.memory,'闻雪照把一枚养魂丹取回，收进随身袋','user',{itemId:lot.id,holder:'player',location:'随身'})],'闻雪照把一枚养魂丹取回，收进随身袋').memory;
 assert.equal(next.worldState.itemLedger.find(x=>x.id===lot.id).container,'');
});
