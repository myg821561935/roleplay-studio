import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inspectNarrativeQuality, renderQualityGuidance, attachNarrativeQuality } from '../server/agent/narrativeQuality.js';
import { inspectSourceConflicts } from '../server/agent/sourceConflicts.js';
import { buildFactEvidenceContext, groundExtractedFact } from '../server/agent/factProvenance.js';
import { applyFactExtractionResult, normalizeDynamicWorldBookEntries } from '../server/agent/factExtractor.js';
import { enforceFaithfulPromptBudget } from '../server/agent/faithfulPrompt.js';
import { assemblePrompt } from '../server/agent/promptAssembler.js';
import { HistoryRepairService } from '../server/services/historyRepairService.js';
import { SessionService } from '../server/services/sessionService.js';
import { JsonStore } from '../server/lib/jsonStore.js';

test('agency check distinguishes quoted NPC dialogue, authorized action, refusal and unrequested commitment', () => {
  assert.equal(inspectNarrativeQuality({content:'她说：“你答应保护我。”',userMessage:'我只问路'}).issues.length,0);
  assert.equal(inspectNarrativeQuality({content:'你点头同意。',userMessage:'我点头同意'}).issues.length,0);
  assert.equal(inspectNarrativeQuality({content:'你点头同意。',userMessage:'我不点头同意'}).issues[0].kind,'player-agency');
  const message={content:'刘一心中决定留下照顾她。'};
  const audit=attachNarrativeQuality(message,{playerName:'刘一',userMessage:'我询问出口'});
  assert.equal(audit.issues[0].kind,'player-agency');
  assert.match(message.roleplayPanels.runtimeNotice,/疑似/);
  assert.match(renderQualityGuidance(audit),/决定留下/);
});
test('repetition and stalled gates use recent concrete evidence rather than story length', () => {
  const content='门口的灯火依然照着那张毫无变化的纸。必须先取得一枚通行令牌。';
  const messages=[1,2].map(id=>({id,role:'assistant',content}));
  const audit=inspectNarrativeQuality({content,messages});
  assert.ok(audit.issues.some(i=>i.kind==='repetition'));
  assert.ok(audit.issues.some(i=>i.kind==='stalled-progress'));
  assert.equal(inspectNarrativeQuality({content:'守卫递出通行令牌，侧身让出入口。',messages}).issues.length,0);
});
test('source conflicts identify the actual card and module; disabled instructions do not participate', () => {
 const result=inspectSourceConflicts({characterCard:{systemPrompt:'采用第一人称。只输出正文。'},modules:[{id:'p',title:'第三人称',content:'必须使用第三人称。只输出 JSON。'}]});
 assert.equal(result.conflicts.length,2); assert.ok(result.conflicts[0].sources.some(s=>s.kind==='card'));
 assert.equal(inspectSourceConflicts({modules:[{title:'第一人称',content:'采用第一人称'},{title:'第三人称',content:'采用第三人称',enabled:false}]}).conflicts.length,0);
});
test('extractor cannot self-confirm invented character facts, promote them or overwrite world state', () => {
 const context=buildFactEvidenceContext({characterCard:{id:'c',description:'阿青从未离开村庄。'}},[{id:'a',role:'assistant',content:'阿青已经抵达渡口。'},{id:'u',role:'user',content:'确认设定：阿青不识字。'}]);
 assert.equal(groundExtractedFact({content:'阿青从未离开村庄。'},context).source,'card');
 assert.equal(groundExtractedFact({content:'阿青不识字。'},context).source,'user-confirmed');
 assert.equal(groundExtractedFact({content:'阿青已经抵达渡口。'},context).source,'history-observed');
 const payload=JSON.stringify({worldState:{protagonist:{name:'假名'}},memoryCards:[{content:'阿青其实是皇帝。',extensions:{stability:'confirmed'}}],worldBook:[{content:'阿青其实是皇帝。',extensions:{stability:'confirmed'}}]});
 const memory=applyFactExtractionResult({worldState:{protagonist:{name:'原名'}}},payload,{evidenceContext:context});
 assert.equal(memory.worldState.protagonist.name,'原名');assert.equal(memory.memoryCards[0].enabled,false);
 assert.equal(memory.memoryCards[0].extensions.provenance.origin,'model-inference');
 assert.equal(memory.pendingWorldStateExtraction.reviewStatus,'candidate');
 assert.deepEqual(normalizeDynamicWorldBookEntries(payload,{evidenceContext:context}),[]);
});
test('optional Agent supplements are evicted before history, without leaking private request fields', () => {
 const messages=[{role:'system',content:'原卡',_promptKind:'character-anchor'},{role:'system',content:'补充'.repeat(1000),_promptKind:'agent-plot-guidance',_promptOptional:true},{role:'assistant',content:'旧对话仍需要保留',_promptKind:'history',_promptTurnId:'one'},{role:'user',content:'当前输入',_promptKind:'current-user'}];
 const result=enforceFaithfulPromptBudget(messages,{maxTokens:100});
 assert.ok(result.messages.some(m=>m.content==='旧对话仍需要保留'));
 assert.equal(result.report.omittedKinds['agent-plot-guidance'],1);
 assert.ok(result.report.optionalTokensRemoved>0);
 assert.ok(result.messages.every(m=>!('_promptOptional' in m)));
});
test('real assembly includes targeted guidance only with evidence and exposes source conflicts', () => {
 const input={characterCard:{name:'阿青',sourceSpec:'chara_card_v3'},promptModules:[],worldBook:[],memory:{},messages:[{id:'u',role:'user',content:'我只问路'},{id:'a',role:'assistant',content:'你决定永远留在这里。'}],userMessage:'我等她回答',options:{maxPromptTokens:32000}};
 const assembled=assemblePrompt(input);
 assert.match(assembled.messages.map(m=>m.content).join('\n'),/待核查片段/);
 assert.equal(assembled.sections.promptStudio.qualityAudit.issues[0].kind,'player-agency');
 assert.ok(assembled.messages.at(-1).content.includes('我等她回答'));
});
test('history copy service rejects stale previews, is idempotent, preserves source and does not propagate globals',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'repair-service-'));
 try {
  const store=new JsonStore(dir), sessions=new SessionService(store), service=new HistoryRepairService(sessions);
  const source={id:'source',title:'原故事',settings:{maxPromptTokens:8000},memory:{worldState:{gold:4}},messages:[{id:'u',role:'user',content:'我问路'},{id:'a',role:'assistant',content:'你走向门边。“你来了吗？”她问。'}]};
  await store.write('sessions/source.json',source);
  sessions.globalMvuStore.persistFromSession=()=>{throw new Error('must not propagate')};
  const plan=await service.preview('source','刘一');
  const options={sourceHash:plan.sourceHash,playerName:'刘一',maxPromptTokens:32000};
  const first=await service.apply('source',options),second=await service.apply('source',options);
  assert.equal(first.id,second.id);assert.equal(second.reused,true);
  assert.deepEqual(await store.read('sessions/source.json'),source);
  const copy=await store.read(`sessions/${first.id}.json`);assert.equal(copy.settings.maxPromptTokens,32000);
  assert.match(copy.messages[1].content,/刘一走向/);assert.deepEqual(copy.memory,source.memory);
  await store.write('sessions/source.json',{...source,title:'改过'});
  await assert.rejects(service.apply('source',options),/SOURCE_CHANGED/);
  await assert.rejects(service.preview('../escape','刘一'),/INVALID_SESSION_ID/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('manual fact review confirms changed or explicitly enabled candidates but not untouched suggestions', async () => {
 const {markReviewedFactChanges}=await import('../server/agent/factProvenance.js');
 const candidate={id:'f',content:'阿青不识字。',enabled:false,source:'model-inference'};
 assert.equal(markReviewedFactChanges([candidate],[candidate])[0].source,'model-inference');
 const confirmed=markReviewedFactChanges([{...candidate,enabled:true}],[candidate])[0];
 assert.equal(confirmed.extensions.provenance.origin,'user-confirmed');
 assert.equal(confirmed.extensions.provenance.verified,true);
});

test('rumor and negated source fragments cannot verify a shorter assertion', () => {
 const card={content:'阿青是皇帝。',extensions:{stability:'confirmed'}};
 for(const content of ['传言阿青是皇帝。','有人说“阿青是皇帝”。','并不能证明阿青是皇帝。']) assert.equal(groundExtractedFact(card,{sources:[{kind:'card',content}]}).extensions.provenance.verified,false);
});
test('rechecking a repaired reply clears only its stale quality notices',()=>{
 const message={content:'你决定永远留下。',roleplayPanels:{runtimeNotice:'其他运行信息'}};
 attachNarrativeQuality(message,{userMessage:'我问路'});
 message.content='她指了指村口的道路。';attachNarrativeQuality(message,{userMessage:'我问路'});
 assert.equal(message.roleplayPanels.runtimeNotice,'其他运行信息');
});
