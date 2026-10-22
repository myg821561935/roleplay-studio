import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveActingPerson,movementRecipient} from '../server/simulation/actorReferences.js';
import {resolveItemReferences} from '../server/simulation/itemReferences.js';
import {groundTurnLedgerEnvelope} from '../server/simulation/groundedLedger.js';
import {adjudicateActionEnvelope} from '../server/simulation/worldStateArbiter.js';
import {ensureSimulationMemory} from '../server/simulation/npcSimulation.js';
const names=['闻雪照','苏月白','林青','陈舟'];
const base=()=>ensureSimulationMemory({worldState:{protagonist:{name:'闻雪照',inventory:[]},itemLedger:[{id:'letter',name:'灰信',quantity:1,owner:'闻雪照',holder:'苏月白',location:'随身'},{id:'pill',name:'养魂丹',quantity:1,owner:'闻雪照',holder:'林青',location:'随身'}]},simulation:{actors:names.slice(1).map((name,i)=>({id:`npc${i}`,name,location:'药铺'}))}});
const turn=(memory,user,content)=>{const context={userMessage:{id:`u-${user}`,content:user},assistantMessage:{id:`a-${content}`,content}};const envelope=groundTurnLedgerEnvelope(memory,null,context);return envelope?adjudicateActionEnvelope({memory,envelope,evidenceContext:context}).memory:memory;};
test('rc2 actor pronouns never choose a coordinated person by mention order',()=>{
 assert.equal(resolveActingPerson({actors:names,content:'苏月白和林青站在柜台旁。她把灰信放在柜台。',quote:'她把灰信放在柜台'}),'');
 assert.equal(resolveActingPerson({actors:names,content:'苏月白和林青站在柜台旁。后者把养魂丹放在柜台。',quote:'后者把养魂丹放在柜台'}),'林青');
 assert.equal(movementRecipient({actors:names,actor:'苏月白',content:'林青和陈舟并肩站着。苏月白把灰信交给她。',quote:'苏月白把灰信交给她'}).ambiguous,true);
});
test('rc2 separate holders narrow a relational item while same-name lots remain ambiguous',()=>{
 const m=base(), content='苏月白和林青站在柜台旁。我把她手里的那封取回';
 assert.deepEqual(resolveItemReferences({items:m.worldState.itemLedger,actors:names,player:names[0],source:'user',quote:'我把她手里的那封取回',content}).matches,['letter']);
 const equal=[...m.worldState.itemLedger,{...m.worldState.itemLedger[0],id:'other',holder:'林青'}];
 assert.equal(resolveItemReferences({items:equal,actors:names,player:names[0],source:'user',quote:'我把她手里的那封取回',content}).ambiguous,true);
});
test('rc2 fresh NPC-to-NPC handover preserves ownership and subsequent ordered actor movement',()=>{
 let m=base();m=turn(m,'请苏月白把灰信转交给林青保管。','苏月白把灰信交给林青。');
 assert.equal(m.worldState.itemLedger[0].holder,'林青');assert.equal(m.worldState.itemLedger[0].owner,'闻雪照');
 m=turn(m,'请林青把灰信放在柜台。','苏月白和林青站在柜台旁。后者把灰信放在柜台。');
 assert.equal(m.worldState.itemLedger[0].holder,'');assert.equal(m.worldState.itemLedger[1].holder,'林青');
});
test('rc2 explicit subject cannot be replaced by an ambiguous model-generated actor or recipient',()=>{
 const m=base(),unchanged=turn(m,'等一下。','苏月白和林青站在柜台旁。她把灰信交给陈舟。');assert.deepEqual(unchanged.worldState.itemLedger,m.worldState.itemLedger);
 const context={userMessage:{id:'u',content:'等一下。'},assistantMessage:{id:'a',content:'苏月白和林青站在柜台旁。她把灰信交给陈舟。'}};
 const r=adjudicateActionEnvelope({memory:m,evidenceContext:context,envelope:{spec:'lra.action/v1',actions:[{id:'a',type:'item.move',actor:'苏月白',itemId:'letter',holder:'陈舟',quantity:1,location:'随身',evidence:{source:'assistant',quote:'她把灰信交给陈舟'}}]}});
 assert.equal(r.result.accepted.length,0);assert.ok(r.result.rejected.length);
});
test('rc2 a schedule and explicit move cannot break retrieval custody, and return releases the constraint',()=>{
 let m=base();m.worldState.commitments=[{id:'p',title:'短存',terms:'免费保管灰信，随时可取回',actor:'闻雪照',counterparty:'苏月白',status:'executed',history:[]}];
 m.simulation.clock={day:1,minuteOfDay:480};m.simulation.actors[0].schedule=[{id:'leave',at:'08:01',days:[],location:'北街',activity:'送药',visibility:'public'}];
 const apply=actions=>adjudicateActionEnvelope({memory:m,envelope:{spec:'lra.action/v1',actions}});
 assert.ok(apply([{id:'move',type:'actor.move',actorId:'npc0',location:'北街'}]).result.rejected.some(x=>x.code==='COMMITMENT_CUSTODIAN_REQUIRED'));
 const advanced=apply([{id:'clock',type:'clock.advance',minutes:2}]);assert.equal(advanced.memory.simulation.actors[0].location,'药铺');assert.ok(advanced.memory.simulation.backstageEvents.some(x=>x.reason==='commitment-custody'));
 m=turn(m,'请把灰信放回柜台。','苏月白把灰信放回柜台。');assert.equal(apply([{id:'move2',type:'actor.move',actorId:'npc0',location:'北街'}]).memory.simulation.actors[0].location,'北街');
});
test('rc2 custody delegation requires explicit player authorization, not an NPC workaround',()=>{
 let m=base();m.worldState.commitments=[{id:'p',title:'短存',terms:'免费保管灰信，随时可取回',actor:'闻雪照',counterparty:'苏月白',status:'executed',history:[]}];
 const blocked=turn(m,'继续保管。','苏月白把灰信交给林青。');assert.equal(blocked.worldState.itemLedger[0].holder,'苏月白');
 const allowed=turn(m,'请苏月白把灰信转交给林青保管。','苏月白把灰信交给林青。');assert.equal(allowed.worldState.itemLedger[0].holder,'林青');assert.equal(allowed.worldState.itemLedger[0].owner,'闻雪照');
});
test('rc2 speaker labels are metadata, not a second person in physical reference resolution',()=>{
 const content='[闻雪照] *苏月白听完。她托起养魂丹。然后她托着纸，把养魂丹放到台面上。';
 assert.equal(resolveActingPerson({actors:names,content,quote:'然后她托着纸，把养魂丹放到台面上'}),'苏月白');
});
test('rc2 completed hand-to-hand phrasing is distinct from reaching toward a recipient',()=>{
 const m=base();assert.equal(turn(m,'请把灰信交给陈舟。','苏月白把灰信交到陈舟手里，陈舟接住，握在左掌中。').worldState.itemLedger[0].holder,'陈舟');
 assert.equal(turn(m,'请把灰信交给陈舟。','苏月白把灰信递向陈舟，等待她接住。').worldState.itemLedger[0].holder,'苏月白');
});
test('rc2 negated recipient does not turn a surface return into a handover',()=>{
 assert.equal(movementRecipient({quote:'请陈舟把灰信放回柜台，不递到闻雪照手里',actors:names}).mentioned,false);
 assert.equal(movementRecipient({quote:'苏月白没有交给林青，而是交给陈舟',actors:names}).matches[0],'陈舟');
});
test('rc2 an unknown counterparty never owns unheld surface items',async()=>{
 const {activeCustodyCommitments}=await import('../server/simulation/commitmentAvailability.js');
 const m=base();m.worldState.itemLedger[0].holder='';m.worldState.commitments=[{counterparty:'',title:'短存',status:'committed',terms:'保管灰信，随时可取回'}];assert.deepEqual(activeCustodyCommitments(m),[]);
});
test('rc2 sounds after a completed placement are not an observer pretending to act',()=>{
 const m=base();const next=turn(m,'请苏月白把灰信放回柜台。','苏月白把灰信放回柜台，听见纸边擦过木纹才松手。');assert.equal(next.worldState.itemLedger[0].holder,'');
 assert.equal(turn(m,'等一下。','苏月白看见林青把灰信放回柜台。').worldState.itemLedger[0].holder,'苏月白');
});
test('rc2 duplicate roster labels do not erase an explicitly named counterparty',()=>{
 const m=base();m.simulation.actors.push({...m.simulation.actors[0],id:'duplicate'});
 const next=turn(m,'闻雪照对苏月白说：「短存条件是免费保管灰信、随时可取回。」','苏月白点头。');assert.equal(next.worldState.commitments[0].counterparty,'苏月白');
});
test('rc2 refreshing a worldbook profile preserves actual departure and status',()=>{
 const worldBook=[{id:'su',type:'npc',title:'NPC：苏月白',content:'身份：药师\n地点：药铺'}];
 let m=ensureSimulationMemory({}, {worldBook});m.simulation.actors[0].location='北街';m.simulation.actors[0].status='送药中';
 m=ensureSimulationMemory(m,{worldBook:[{...worldBook[0],content:'身份：医师\n地点：药铺'}]});
 assert.equal(m.simulation.actors[0].location,'北街');assert.equal(m.simulation.actors[0].status,'送药中');assert.equal(m.simulation.actors[0].role,'医师');
});
test('rc2 object-subject transfer resolves an explicit source and a unique receiving actor',()=>{
 let m=base();m.worldState.itemLedger[0].holder='林青';
 m=turn(m,'请林青把灰信交给苏月白。','苏月白抬手来接。灰信从林青掌中滑到她手里，中间没有半刻悬空。');
 assert.equal(m.worldState.itemLedger[0].holder,'苏月白');assert.equal(m.worldState.itemLedger[0].owner,'闻雪照');
 let ambiguous=base();ambiguous.worldState.itemLedger[0].holder='林青';
 ambiguous=turn(ambiguous,'等一下。','苏月白和陈舟伸出手。灰信从林青掌中滑到她手里。');assert.equal(ambiguous.worldState.itemLedger[0].holder,'林青');
});
test('rc2 denied or planned hand-to-hand movement cannot update a held item',()=>{
 for(const content of ['苏月白抬手来接。灰信没有从林青掌中滑到她手里。','苏月白抬手来接。如果灰信从林青掌中滑到她手里，她就收好。']){
  const m=base();m.worldState.itemLedger[0].holder='林青';assert.equal(turn(m,'等一下。',content).worldState.itemLedger[0].holder,'林青');
 }
});
test('rc2 custody status can explicitly affirm staying, but cannot hide a departure after contrast',async()=>{
 const {describesDeparture}=await import('../server/simulation/commitmentAvailability.js');assert.equal(describesDeparture('没有离开，仍在柜台'),false);assert.equal(describesDeparture('不再外出'),false);assert.equal(describesDeparture('没有离开，但稍后外出'),true);
 const m=base();m.worldState.commitments=[{id:'p',title:'短存',status:'executed',counterparty:'苏月白',actor:'闻雪照',terms:'保管灰信，随时可取回'}];
 const r=adjudicateActionEnvelope({memory:m,envelope:{spec:'lra.action/v1',actions:[{id:'s',type:'actor.status',actorId:'npc0',status:'没有离开，仍在柜台'}]}});assert.equal(r.result.rejected.length,0);assert.equal(r.memory.simulation.actors[0].status,'没有离开，仍在柜台');
});
test('rc2 a named receiver can accept the unique NPC-held item without taking from the player',()=>{
 let m=base();m.worldState.itemLedger[0].holder='林青';
 m=turn(m,'请林青把灰信交给苏月白。','苏月白接过灰信。她两手捧着，没有放上柜台。');assert.equal(m.worldState.itemLedger[0].holder,'苏月白');
 for(const content of ['苏月白尚未接过灰信。','苏月白没有接过灰信。']){const b=base();b.worldState.itemLedger[0].holder='林青';assert.equal(turn(b,'等一下。',content).worldState.itemLedger[0].holder,'林青');}
 const b=base();b.worldState.itemLedger[0].holder='闻雪照';assert.equal(turn(b,'等一下。','苏月白接过灰信。').worldState.itemLedger[0].holder,'闻雪照');
});
test('rc2 receiving one named item does not move a second item merely mentioned later',()=>{
 const b=base();b.worldState.itemLedger[0].holder='林青';
 const m=turn(b,'请把灰信交给苏月白。','苏月白接过灰信，又看了看养魂丹。');assert.equal(m.worldState.itemLedger[0].holder,'苏月白');assert.equal(m.worldState.itemLedger[1].holder,'林青');
});
test('rc2 placing into a named palm is a handover and later pocketing keeps the actual holder',()=>{
 assert.equal(movementRecipient({quote:'请不要放进陈舟掌心',actors:names}).mentioned,false);
 const m=turn(base(),'请苏月白把灰信交给陈舟。','苏月白把灰信放进陈舟摊开的掌心。陈舟把灰信塞进油布隔袋。');assert.equal(m.worldState.itemLedger[0].holder,'陈舟');assert.equal(m.worldState.itemLedger[0].location,'油布隔袋');assert.equal(m.worldState.itemLedger[0].owner,'闻雪照');
});
test('rc2 a new unnamed subject cannot inherit the registered custodian',()=>{
 const quote='散修的笑意收住，把油纸包往怀里一塞，转身出门';const content='苏月白把木匣收好。'+quote+'。';assert.equal(resolveActingPerson({content,quote,actors:names}),'');
 assert.equal(resolveActingPerson({content:'苏月白收起账本。她转身出门。',quote:'她转身出门',actors:names}),'苏月白');
});
test('rc2 an object falling into a named recipient hand records the completed handover',()=>{
 const m=turn(base(),'请苏月白把灰信交给林青。','苏月白松手，灰信落到林青手里；林青五指一合，收住。');assert.equal(m.worldState.itemLedger[0].holder,'林青');
});
test('rc2 crossing the door records departure without inventing destination arrival, then retains the observed route',()=>{
 let m=turn(base(),'请苏月白去北街送药。','苏月白走到后头那道窄门前。她推开门，侧身出去。苏月白走后，屋里静了。');
 assert.match(m.simulation.actors[0].location,/场外/);assert.equal(m.simulation.actors[0].status,'已离场');
 m=turn(m,'确认位置。','苏月白不在柜台前。她绕过院墙往东边的挑夫巷去了。');assert.equal(m.simulation.actors[0].location,'东边的挑夫巷（途中）');assert.equal(m.simulation.actors[0].status,'已离场');
 m=turn(m,'继续。','苏月白回到药铺柜台。');assert.equal(m.simulation.actors[0].status,'在场');
});
test('rc2 a sender and receiving actor in one sentence are not ambiguous actors',()=>{
 const m=turn(base(),'请苏月白把灰信交给陈舟。','苏月白把灰信交给陈舟，陈舟伸手接住，拿在手中。');assert.equal(m.worldState.itemLedger[0].holder,'陈舟');
 assert.equal(resolveActingPerson({quote:'苏月白和林青把灰信放在柜台',content:'苏月白和林青把灰信放在柜台',actors:names}),'');
});
test('rc2 narrated steps crossing a threshold establish departure after a spoken aside',()=>{
 const m=turn(base(),'请苏月白出门。','苏月白应了一声。她挽起外衫。\n「北街见。」\n这句是对伙计说的，脚步已经跨出门槛。');assert.match(m.simulation.actors[0].location,/场外/);assert.equal(m.simulation.actors[0].status,'已离场');
});
test('rc2 walking out and later reporting an actual location retain departure facts',()=>{
 let m=turn(base(),'请苏月白去北街。','苏月白走到门边。她背着药囊走出去。');assert.match(m.simulation.actors[0].location,/场外/);
 m=turn(m,'确认位置。','苏月白不在柜台。她此刻在北街周家，药囊放在桌旁。');assert.equal(m.simulation.actors[0].location,'北街周家');assert.equal(m.simulation.actors[0].status,'已离场');
 const b=turn(base(),'等一下。','苏月白没走出去。');assert.equal(b.simulation.actors[0].location,'药铺');
});
test('rc2 leaving after a pause outside supersedes the earlier threshold location',()=>{
 const m=turn(base(),'请苏月白去北街。','苏月白在门槛外停了脚，回过头来。\n「我走了。」\n说完她便转身，人整个出了门。');assert.match(m.simulation.actors[0].location,/场外/);assert.equal(m.simulation.actors[0].status,'已离场');
});
test('rc2 negation scopes to its own action instead of a completed adjacent handover',()=>{
 const m=turn(base(),'请苏月白把灰信交给陈舟。','苏月白把灰信递到陈舟掌上，陈舟两手一合，拿在手中，没有往袖里收。');assert.equal(m.worldState.itemLedger[0].holder,'陈舟');
 for(const text of ['苏月白收回手，没有把灰信交给陈舟。','如果苏月白把灰信交给陈舟，她就回家。','苏月白把灰信交给陈舟，这件事实际上并未发生。'])assert.equal(turn(base(),'等一下。',text).worldState.itemLedger[0].holder,'苏月白');
});
test('rc2 putting the whole custody box on a surface keeps responsibility and uses that object destination',async()=>{
 const {activeCustodyCommitments}=await import('../server/simulation/commitmentAvailability.js');
 let m=base();m.worldState.itemLedger[0].location='木匣';m.worldState.commitments=[{id:'p',title:'短存',terms:'保管灰信，随时可取回',status:'executed',actor:'闻雪照',counterparty:'苏月白'}];
 m=turn(m,'正常看看包装。','苏月白把银针先搁在柜台角上，再拿下木匣，捧在掌心掂了一下，才放到柜台上。');
 const item=m.worldState.itemLedger[0];assert.equal(item.location,'柜台');assert.equal(item.holder,'');assert.equal(item.container,'木匣');assert.equal(item.custodian,'苏月白');assert.equal(activeCustodyCommitments(m).length,1);
 assert.deepEqual(resolveItemReferences({items:m.worldState.itemLedger,quote:'她保管的那封',content:'她保管的那封',actors:names,player:'闻雪照',actor:'苏月白',source:'assistant'}).matches,['letter']);
 const blocked=adjudicateActionEnvelope({memory:m,envelope:{spec:'lra.action/v1',actions:[{id:'exit',type:'actor.move',actorId:'npc0',location:'北街'}]}});assert.equal(blocked.result.rejected[0].code,'COMMITMENT_CUSTODIAN_REQUIRED');
 m=turn(m,'请苏月白把灰信取出放回柜台。','苏月白把灰信从木匣取出，放回柜台。');assert.equal(m.worldState.itemLedger[0].custodian,'');assert.equal(m.worldState.itemLedger[0].container,'');assert.equal(activeCustodyCommitments(m).length,0);
});


test('narrating the player request without a completed NPC act cannot ground a transfer',()=>{
 const m=base();assert.equal(turn(m,'请苏月白把灰信交给陈舟。','闻雪照只把话放在柜台中间：请苏月白把灰信交给陈舟，让陈舟拿在手里。').worldState.itemLedger[0].holder,'苏月白');
 assert.equal(turn(m,'请苏月白把灰信交给陈舟。','苏月白把灰信交给陈舟。').worldState.itemLedger[0].holder,'陈舟');
});
