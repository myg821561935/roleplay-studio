import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHistoryRepairPlan, createHistoryRepairCopy, proposeNarrationEdits } from '../server/agent/historyPerspectiveRepair.js';
import { deriveMessages } from '../server/agent/sessionEventLog.js';
const makeSession = () => ({ id:'original', title:'故事', memory:{worldState:{gold:3}}, settings:{maxPromptTokens:8000}, messages:[
 {id:'u1',role:'user',content:'我只问路。'},
 {id:'a1',role:'assistant',content:'你站在门外。“你来了？「你是谁？」”她问。你的手握着门闩。',swipes:['旧版本','你站在门外。“你来了？「你是谁？」”她问。你的手握着门闩。'],activeSwipeIndex:1,swipeMetadata:[{old:true},{worldUpdate:{gold:3}}]},
 {id:'a2',role:'assistant',content:'<plot>你走出门。</plot>'}
] });
test('proposal preserves dialogue, skips code and malformed quotations, and never edits player messages', () => {
 const s=makeSession(), original=JSON.stringify(s), plan=buildHistoryRepairPlan(s,'刘一');
 assert.equal(plan.changes.length,1); assert.equal(plan.changes[0].edits.length,2);
 assert.equal(plan.changes[0].after,'刘一站在门外。“你来了？「你是谁？」”她问。刘一的手握着门闩。');
 assert.equal(plan.skipped.length,1); assert.equal(JSON.stringify(s),original);
 for(const text of ['你走出门。“你来了', '你看向`x`', '你转头。”']) assert.equal(proposeNarrationEdits(text,'刘一').edits.length,0);
 assert.equal(proposeNarrationEdits('你们走进门，任你处置，双方你来我往。','刘一').edits.length,0);
});
test('repair produces isolated copy with consistent active swipes and replay, preserving facts and source', () => {
 const s=makeSession(), original=JSON.stringify(s), plan=buildHistoryRepairPlan(s,'刘一');
 const copy=createHistoryRepairCopy(s,plan,{id:'repaired'});
 assert.equal(JSON.stringify(s),original); assert.deepEqual(copy.memory,s.memory); assert.deepEqual(copy.settings,s.settings);
 assert.deepEqual(copy.messages[0],s.messages[0]); assert.equal(copy.messages.length,s.messages.length);
 assert.equal(copy.messages[1].swipes[1],plan.changes[0].after); assert.equal(copy.messages[1].swipes[0],'旧版本');
 assert.deepEqual(copy.messages[1].swipeMetadata,s.messages[1].swipeMetadata);
 assert.deepEqual(deriveMessages(copy.eventLog),copy.messages);
 assert.equal(copy.id,'repaired'); assert.equal(copy.historyRepair.sourceId,s.id);
});
test('stale or tampered plans and inconsistent swipes fail closed', () => {
 const s=makeSession(),plan=buildHistoryRepairPlan(s,'刘一');
 assert.throws(()=>createHistoryRepairCopy({...s,title:'已改变'},plan),/SOURCE_CHANGED/);
 assert.throws(()=>createHistoryRepairCopy(s,{...plan,changes:[]}),/REPAIR_PLAN_CHANGED/);
 assert.throws(()=>createHistoryRepairCopy(s,plan,{id:s.id}),/INVALID_COPY_ID/);
 s.messages[1].activeSwipeIndex=0;
 assert.throws(()=>createHistoryRepairCopy(s,buildHistoryRepairPlan(s,'刘一')),/ACTIVE_SWIPE_MISMATCH/);
 assert.throws(()=>buildHistoryRepairPlan(s,'用户'),/已确认/);
});
