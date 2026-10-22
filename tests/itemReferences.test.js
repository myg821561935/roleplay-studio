import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveItemReferences,referenceQuantity} from '../server/simulation/itemReferences.js';
import {groundTurnLedgerEnvelope,initialItemLedger} from '../server/simulation/groundedLedger.js';
import {adjudicateActionEnvelope} from '../server/simulation/worldStateArbiter.js';
import {ensureSimulationMemory} from '../server/simulation/npcSimulation.js';
const items=[{id:'a',name:'养魂丹',owner:'甲',holder:'甲',location:'随身',quantity:2},{id:'b',name:'养魂丹',owner:'甲',holder:'乙',location:'木匣',quantity:1},{id:'c',name:'灰信',owner:'甲',holder:'',location:'柜台',quantity:1}];
const resolve=(quote,content=quote,overrides={})=>resolveItemReferences({items,quote,content,actors:['甲','乙'],player:'甲',actor:'甲',source:'user',...overrides});
test('custodian and location references identify the existing lot, not another same-name stack',()=>{
 assert.deepEqual(resolve('我把她手里的那枚取回').matches,['b']);
 assert.deepEqual(resolve('我把柜台上的那封取回').matches,['c']);
 assert.deepEqual(resolve('我把木匣里的那枚取回').matches,['b']);
 assert.equal(resolve('我把她手里的那枚取回','我把她手里的那枚取回',{items:[...items,{...items[1],id:'d',holder:'丙'}]}).ambiguous,true);
});
test('ordered and nearest references preserve which item was meant and reject ambiguity',()=>{
 const own=items.map(x=>({...x,holder:'甲',location:'随身'}));
 assert.deepEqual(resolve('我把后者放在柜台','我看看养魂丹和灰信。我把后者放在柜台',{items:[own[0],own[2]]}).matches,['c']);
 assert.deepEqual(resolve('我把它放在柜台','我检查灰信。我把它放在柜台',{items:own}).matches,['c']);
 assert.deepEqual(resolve('我把它放在柜台','我检查养魂丹和灰信。我把它放在柜台',{items:own}).matches,[]);
 assert.deepEqual(resolve('我把它放在柜台','我检查灰信。又拿出一只杯子。我把它放在柜台',{items:own}).matches,[]);
 assert.deepEqual(resolve('我把信用账本放在柜台',{toString:()=>''}).matches,[]);
});
test('equivalent lots are interchangeable but different holders are not; singular references have quantity one',()=>{
 const same=[items[0],{...items[0],id:'d',quantity:1}];
 assert.equal(resolve('我把一枚养魂丹放在柜台','',{items:same}).interchangeable,true);
 assert.equal(referenceQuantity('我把那枚取回','养魂丹',2,{resolved:true}),1);
});
test('real action adjudication accepts a grounded pronoun and replays exact evidence without double moving equivalent lots',()=>{
 let memory=ensureSimulationMemory({worldState:{protagonist:{name:'甲',inventory:['三枚养魂丹','灰信']},itemLedger:items},simulation:{actors:[{id:'yi',name:'乙'}]}});
 const context={userMessage:{id:'u-ref',content:'我把她手里的那枚取回，收进随身袋。'},assistantMessage:{id:'a-ref',content:'乙看着柜台。'}};
 const envelope=groundTurnLedgerEnvelope(memory,null,context);
 const result=adjudicateActionEnvelope({memory,envelope,evidenceContext:context});
 assert.equal(result.memory.worldState.itemLedger.find(x=>x.id==='b').holder,'甲');
 const gift={userMessage:{id:'u-gift',content:'甲看了一眼养魂丹和灰信。我把前者中的一枚赠给乙。'},assistantMessage:{id:'a-gift',content:'乙收下了。'}};
 const next=adjudicateActionEnvelope({memory:result.memory,envelope:groundTurnLedgerEnvelope(result.memory,null,gift),evidenceContext:gift});
 assert.equal(next.memory.worldState.itemLedger.filter(x=>x.owner==='乙').reduce((n,x)=>n+x.quantity,0),1);
 assert.equal(initialItemLedger(next.memory).filter(x=>x.name==='养魂丹').reduce((n,x)=>n+x.quantity,0),3);
});

test('a nearby item-to-carrier relation follows the carrier, while an unbound tray stays unrelated',()=>{
 const quote='她把木托稳稳送回青瓷匣的最上层';
 const setup={items:[{...items[1],holder:'',location:'柜台'}],source:'assistant',actor:'乙'};
 assert.deepEqual(resolve(quote,'乙擦净手。她把丹取下来，用薄木托托住。'+quote,setup).matches,['b']);
 assert.deepEqual(resolve(quote,'乙取出空木托。'+quote,setup).matches,[]);
 const memory=ensureSimulationMemory({worldState:{protagonist:{name:'甲',inventory:['三枚养魂丹']},itemLedger:[items[0],setup.items[0]]},simulation:{actors:[{id:'yi',name:'乙'}]}});
 const context={userMessage:{id:'carrier-u',content:'请收好养魂丹。'},assistantMessage:{id:'carrier-a',content:'乙擦净手。她把丹取下来，用薄木托托住。'+quote+'。'}};
 const result=adjudicateActionEnvelope({memory,envelope:groundTurnLedgerEnvelope(memory,null,context),evidenceContext:context});
 assert.equal(result.memory.worldState.itemLedger.find(x=>x.id==='b').holder,'乙');
 assert.equal(result.memory.worldState.itemLedger.find(x=>x.id==='b').location,'青瓷匣的最上层');
});

test('an NPC action after a relative clause naming the player keeps its own subject',()=>{
 const memory=ensureSimulationMemory({worldState:{protagonist:{name:'甲',inventory:['三枚养魂丹']},commitments:[{id:'p',title:'短存',terms:'免费保管',status:'committed',counterparty:'乙',history:[]}]},simulation:{actors:[{id:'yi',name:'乙'}]}});
 const context={userMessage:{id:'relative-u',content:'甲把一枚养魂丹放在柜台。短存现在可以实际收存。'},assistantMessage:{id:'relative-a',content:'乙擦净手。她把甲放在柜台上的那一枚养魂丹包好，随后，乙把那一枚养魂丹放进柜下取出的木匣里，合上盖子。'}};
 const result=adjudicateActionEnvelope({memory,envelope:groundTurnLedgerEnvelope(memory,null,context),evidenceContext:context});
 assert.ok(result.memory.worldState.itemLedger.some(x=>x.name==='养魂丹'&&x.quantity===1&&x.holder==='乙'&&x.owner==='甲'));
 assert.equal(result.memory.worldState.commitments[0].status,'executed');
});

test('an unrelated object containing a kind character cannot move a held ledger item',()=>{
 const memory={worldState:{protagonist:{name:'甲',inventory:[]},itemLedger:[{id:'letter',name:'灰信',quantity:1,owner:'甲',holder:'乙',location:'随身'}]},simulation:{actors:[{id:'yi',name:'乙'}]}};
 const context={userMessage:{id:'unrelated-u',content:'稍等。'},assistantMessage:{id:'unrelated-a',content:'乙把信用账本放进木匣。'}};
 assert.equal(groundTurnLedgerEnvelope(memory,null,context),null);
});

test('quoted container labels do not erase earlier literal physical evidence or turn dialogue into action',()=>{
 const memory={worldState:{protagonist:{name:'甲',inventory:[]},itemLedger:[{id:'pill',name:'养魂丹',quantity:1,owner:'甲',holder:'',location:'柜台'}]},simulation:{actors:[{id:'yi',name:'乙'}]}};
 const context={userMessage:{id:'label-u',content:'请收好。'},assistantMessage:{id:'label-a',content:'乙从柜台上拿起那枚养魂丹，放进乌木小匣的旧棉之间，又将匣子推进刻着“酉”字的抽屉。'}};
 const envelope=groundTurnLedgerEnvelope(memory,null,context);
 const result=adjudicateActionEnvelope({memory,envelope,evidenceContext:context});
 assert.equal(result.memory.worldState.itemLedger[0].holder,'乙');
 assert.equal(groundTurnLedgerEnvelope(memory,null,{...context,assistantMessage:{id:'quoted-a',content:'乙说：“乙把养魂丹放进木匣。”'}}),null);
});

test('an explicit subject after a connective overrides earlier names mentioned as recipients',()=>{
 const memory={worldState:{protagonist:{name:'甲',inventory:[]},itemLedger:[{id:'pill',name:'养魂丹',quantity:1,owner:'甲',holder:'',location:'柜台'}]},simulation:{actors:[{id:'yi',name:'乙'}]}};
 const context={userMessage:{id:'subject-u',content:'请收好。'},assistantMessage:{id:'subject-a',content:'乙把匣口朝甲那边偏了偏。说罢，乙从柜台上拿起那枚养魂丹，放进乌木小匣里。'}};
 const result=adjudicateActionEnvelope({memory,envelope:groundTurnLedgerEnvelope(memory,null,context),evidenceContext:context});
 assert.equal(result.memory.worldState.itemLedger[0].holder,'乙');
});

test('a player mentioned as a spatial reference after an NPC move is not its acting subject',()=>{
 const memory={worldState:{protagonist:{name:'甲',inventory:[]},itemLedger:[{id:'pill',name:'养魂丹',quantity:1,owner:'甲',holder:'乙',location:'薄木匣'}]},simulation:{actors:[{id:'yi',name:'乙'}]}};
 const context={userMessage:{id:'space-u',content:'请放回柜台。'},assistantMessage:{id:'space-a',content:'乙停下手。她把那**一枚养魂丹从薄木匣里取出来**，掌心托着，**放在柜台台面上**，离甲那一侧不算近。'}};
 const result=adjudicateActionEnvelope({memory,envelope:groundTurnLedgerEnvelope(memory,null,context),evidenceContext:context});
 assert.equal(result.memory.worldState.itemLedger[0].holder,'');
 assert.equal(result.memory.worldState.itemLedger[0].location,'柜台台面');
});

test('a worn pouch beside a counter remains in NPC custody rather than becoming an unattended surface',()=>{
 const memory={worldState:{protagonist:{name:'甲',inventory:[]},itemLedger:[{id:'pill',name:'养魂丹',quantity:1,owner:'乙',holder:'乙',location:'随身'}]},simulation:{actors:[{id:'yi',name:'乙'}]}};
 const context={userMessage:{id:'pouch-u',content:'这是给你的。'},assistantMessage:{id:'pouch-a',content:'乙点头。她把丹丸放进柜台下自己随身的一只旧皮囊里，系好袋口。'}};
 const result=adjudicateActionEnvelope({memory,envelope:groundTurnLedgerEnvelope(memory,null,context),evidenceContext:context});
 assert.equal(result.memory.worldState.itemLedger[0].holder,'乙');
 assert.equal(result.memory.worldState.itemLedger[0].owner,'乙');
 assert.equal(result.memory.worldState.itemLedger[0].location,'随身');
 assert.equal(result.memory.worldState.itemLedger[0].container,'皮囊');
});

test('storage inside a counter retains the container and commits receipt before a later box relocation',()=>{
 const memory={worldState:{protagonist:{name:'甲',inventory:['一枚养魂丹']},commitments:[{id:'p',title:'短存',terms:'免费保管',counterparty:'乙',status:'committed',history:[]}]},simulation:{actors:[{id:'yi',name:'乙'}]}};
 const context={userMessage:{id:'storage-u',content:'甲把一枚养魂丹放在柜台。短存现在可以实际收存。'},assistantMessage:{id:'storage-a',content:'乙把养魂丹放进木匣里那只空着的格子。随后她端起这只装了养魂丹的木匣，放回柜台内侧靠墙的青瓷小格中，格门虚掩。'}};
 const result=adjudicateActionEnvelope({memory,envelope:groundTurnLedgerEnvelope(memory,null,context),evidenceContext:context});
 const item=result.memory.worldState.itemLedger[0];assert.equal(item.holder,'乙');assert.equal(item.location,'柜台内侧靠墙的青瓷小格');assert.equal(item.container,'木匣');
 assert.equal(result.memory.worldState.commitments[0].status,'executed');
});
