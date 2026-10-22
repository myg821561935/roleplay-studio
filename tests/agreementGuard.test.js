import test from 'node:test';
import assert from 'node:assert/strict';
import {agreementScope,inspectAgreementReply,enforceAgreementReply} from '../server/agent/agreementGuard.js';
import {assemblePrompt} from '../server/agent/promptAssembler.js';
const memory={worldState:{commitments:[{id:'p',title:'短存',terms:'免费保管至酉时，不加额外条件',status:'committed'}]}};
const userMessage={content:'请将保管的丹药归还到柜台。'};
test('existing agreements reject invented gates and false recollection but preserve optional advice and agreed conditions',()=>{
 for(const content of ['「先交押金才能取回。」','「你答应过要签字。」','「凭据我只认完整封条。」','「我还得添一行条件。」'])assert.ok(inspectAgreementReply(content,memory,userMessage).issues.length,content);
 for(const content of ['「无需押金，照原条件取回。」','「可以包张纸，不影响取回。」','她把丹放在柜台。','「按约定酉时取回。」'])assert.equal(inspectAgreementReply(content,memory,userMessage).issues.length,0,content);
 assert.equal(inspectAgreementReply('「必须签字。」',{worldState:{commitments:[{status:'committed',terms:'取回时必须签字'}]}},userMessage).issues.length,0);
 assert.equal(inspectAgreementReply('「必须签字。」',memory,'我要重新协商').issues.length,0);
 assert.equal(agreementScope({},'不增加费用或别的条件').active,true);
});
test('one repair uses original context, counts both usages and never accepts a second failed reply',async()=>{
 let calls=0;const input={result:{content:'「先交押金才能取回。」',usage:{prompt_tokens:10,completion_tokens:2}},memory,userMessage,messages:[{role:'user',content:userMessage.content}]};
 const result=await enforceAgreementReply({...input,complete:async messages=>{calls++;assert.match(messages.at(-1).content,/未通过约定校验/);return {content:'她把丹放在柜台。',usage:{prompt_tokens:20,completion_tokens:4}};}});
 assert.equal(calls,1);assert.equal(result.usage.prompt_tokens,30);assert.equal(result.usage.completion_tokens,6);assert.equal(result.agreementIntegrity.repaired,true);
 calls=0;await assert.rejects(enforceAgreementReply({...input,complete:async()=>{calls++;return {content:'「必须画押才能取回。」'};}}),e=>e.code==='AGREEMENT_REPAIR_FAILED');assert.equal(calls,1);
});
test('agreement boundaries survive faithful mode with memory recall disabled and original sources retained',()=>{
 const a=assemblePrompt({characterCard:{name:'医者',sourceSpec:'chara_card_v3',description:'保持原卡文风'},promptModules:[],worldBook:[],messages:[],memory,userMessage:userMessage.content,options:{maxPromptTokens:32000,agentEnhancements:{memoryRecall:false}}});
 const content=a.messages.map(x=>x.content).join('\n');assert.match(content,/已确认约定的执行边界/);assert.match(content,/免费保管至酉时/);assert.match(content,/保持原卡文风/);
});

test('an agreed NPC task cannot be converted into an extra player step or another confirmation',()=>{
 for(const content of ['「你自己放进去，我只管挪匣子。」','「你先给我一句话，我才放回去。」'])assert.ok(inspectAgreementReply(content,memory,'请把养魂丹实际收存。').issues.length);
 assert.equal(inspectAgreementReply('「我会放好，你自己决定何时回来。」',memory,userMessage).issues.length,0);
});

test('an agreed deposit with ungroundable nested handling is repaired before it can diverge from state',()=>{
 const m={worldState:{protagonist:{name:'甲',inventory:['三枚养魂丹']},commitments:[{id:'p',title:'短存',terms:'免费保管一枚养魂丹',status:'committed',counterparty:'乙',history:[]}]},simulation:{actors:[{id:'npc',name:'乙'}]}};
 const user='我把一枚养魂丹放在柜台。请乙按短存原条件实际收存。';
 assert.ok(inspectAgreementReply('乙把纸垫进匣底。丹落进纸心。她合盖推到内侧。「收了。」',m,user).issues.some(x=>x.kind==='unresolved-custody-evidence'));
 assert.equal(inspectAgreementReply('乙把柜台上的一枚养魂丹放进木匣。',m,user).issues.length,0);
 assert.equal(inspectAgreementReply('乙停下手。「尚未收好，我先清理匣子。」',m,user).issues.length,0);
});

test('real provider raw usage is counted for both the rejected draft and correction',async()=>{
 const result=await enforceAgreementReply({result:{content:'「必须签字才能取回。」',raw:{usage:{prompt_tokens:100,completion_tokens:10,total_tokens:110}}},memory,userMessage,messages:[],complete:async()=>({content:'她把丹放在柜台。',raw:{usage:{prompt_tokens:120,completion_tokens:20,total_tokens:140}}})});
 assert.equal(result.usage.prompt_tokens,220);assert.equal(result.usage.completion_tokens,30);assert.equal(result.usage.total_tokens,250);
 assert.equal(result.agreementIntegrity.initialUsage.total_tokens,110);
});

test('ordinary pickup after the NPC places an item on the surface is not an added gate',()=>{
 assert.equal(inspectAgreementReply('「你要取，只管开口，我拿出来放台面，你自己收。」',memory,'请保管灰信。').issues.length,0);
 assert.ok(inspectAgreementReply('「我拿出来放台面，你自己收，必须先签字。」',memory,'请保管灰信。').issues.length);
 assert.ok(inspectAgreementReply('「你自己把灰信放进去，我只管看着。」',memory,'请实际收存灰信。').issues.length);
});

test('physical inspection and an ordinary record do not create a contractual gate',()=>{
 for(const content of ['乙先看了看丹丸的封口，才从柜下取出木匣。','她在药签背面添了一行小字，写着养魂丹一枚。'])assert.equal(inspectAgreementReply(content,memory,userMessage).issues.length,0);
 assert.ok(inspectAgreementReply('「先给押金，我才开匣。」',memory,userMessage).issues.length);
});

test('a return that cannot be bound to a ledger lot is clarified before submission',()=>{
 const m={worldState:{protagonist:{name:'甲',inventory:[]},commitments:[{status:'executed',terms:'随时可取回'}],itemLedger:[{id:'letter',name:'灰信',quantity:1,owner:'甲',holder:'乙',location:'随身'},{id:'gift',name:'养魂丹',quantity:1,owner:'乙',holder:'乙',location:'随身'}]},simulation:{actors:[{name:'乙',id:'yi'}]}};
 const user='请把手里的那封信放回柜台，不直接交到我手上。';
 assert.ok(inspectAgreementReply('乙起身。她把纸包摆在柜台上。灰信露出来了。',m,user).issues.some(x=>x.kind==='unresolved-return-evidence'));
 assert.equal(inspectAgreementReply('乙把灰信放回柜台。',m,user).issues.length,0);
 assert.equal(inspectAgreementReply('「她人不在，等她回来。」桌上灰信旁的铜铃搁在柜台。',m,user).issues.length,0);
});

test('deposit approval requires the applied final custody state, not an intermediate receipt',()=>{
 const m={worldState:{protagonist:{name:'甲',inventory:['一枚养魂丹']},commitments:[{id:'p',title:'短存',terms:'免费保管',counterparty:'乙',status:'committed',history:[]}]},simulation:{actors:[{id:'yi',name:'乙'}]}};
 const user='甲把一枚养魂丹放在柜台。短存现在可以实际收存，请收进木匣保管。';
 assert.ok(inspectAgreementReply('乙把养魂丹放进木匣。随后乙把养魂丹从木匣取出，放回柜台。',m,user).issues.some(x=>x.kind==='unresolved-custody-evidence'));
 assert.equal(inspectAgreementReply('乙把养魂丹放进木匣。随后她端起这只装了养魂丹的木匣，放回柜台内侧靠墙的青瓷小格中。',m,user).issues.length,0);
});
