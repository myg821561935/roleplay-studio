import fs from 'node:fs/promises';
import { probePromptMacroSemantics } from './probe-prompt-macro-semantics.mjs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { previewImportPayload } from '../server/character/importPreview.js';
import { ResourceLibraryService } from '../server/services/resourceLibraryService.js';
import { JsonStore } from '../server/lib/jsonStore.js';
import { ConfigService } from '../server/config/configService.js';
import { SessionService } from '../server/services/sessionService.js';
import { AgentService } from '../server/services/agentService.js';
import { assemblePrompt } from '../server/agent/promptAssembler.js';
import { readSseResponse } from '../public/modules/streamingTransport.js';
import { buildOpenAICompatibleRequest } from '../server/provider/openaiCompatible.js';

// Explicit local inventory; no model credentials, network calls or production data writes.
const [inventoryPath, outputPath] = process.argv.slice(2);
if (!inventoryPath || !outputPath) throw new Error('Usage: node scripts/validate-local-roleplay-resources.mjs <inventory.json> <output-dir>');
const output = path.resolve(outputPath);
await fs.mkdir(output, { recursive: true });
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'roleplay-resources-'));
const store = new JsonStore(root);
const library = new ResourceLibraryService(store);
const sessions = new SessionService(store);
const config = new ConfigService(store);
const inventory = JSON.parse(await fs.readFile(inventoryPath, 'utf8'));
const report = { startedAt: new Date().toISOString(), provider: 'deterministic-local-stub', macroSemantics: probePromptMacroSemantics(), imports: [], combinations: [], conversations: [] };
const chars = [], presets = [], extras = [];
const seen = new Set();
const sourceFields = ['name', 'description', 'personality', 'scenario', 'systemPrompt', 'postHistoryInstructions', 'firstMessage', 'exampleDialog'];
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const userAction = '我留在原地观察周围，不替我决定下一步。';
const settings = { promptExecutionMode: 'faithful', maxPromptTokens: 128000, recentPairs: 8 };
const summarize = a => ({ tokens: a.tokenEstimate, retained: a.sections.retainedPromptModuleIds.length, omitted: a.sections.omittedPromptModuleIds, regexPreserved: a.sections.regexAudit.length, worldbookOmitted: [...a.sections.worldBookBudget.constant.omittedIds, ...a.sections.worldBookBudget.triggered.omittedIds], suppressed: [...a.sections.communityPresetIntegrity.preflightSuppressed,...a.sections.communityPresetIntegrity.finalSuppressed].filter(x=>x.suppressed).map(x=>x.reason) });
try {
  for (const item of inventory) {
    const result = { file: item.file, sha256: item.sha256 };
    report.imports.push(result);
    try {
      const bytes = await fs.readFile(item.file);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), item.sha256, 'source changed since inventory');
      if (seen.has(item.sha256)) { result.status = 'duplicate-source'; continue; }
      seen.add(item.sha256);
      const preview = previewImportPayload({ data: bytes, mimeType: item.file.endsWith('.png') ? 'image/png' : 'application/json', fileName: path.basename(item.file) });
      result.kind = preview.kind;
      const saved = await library.savePreview(preview, { fileName: path.basename(item.file), originalHash: item.sha256 });
      const repeated = await library.savePreview(preview, { fileName: path.basename(item.file), originalHash: item.sha256 });
      assert.deepEqual(saved.resources.map(r=>r.id), repeated.resources.map(r=>r.id), 'repeat import changed resource identities');
      result.resources = [];
      for (const resource of saved.resources) {
        const reread = await library.getResource(resource.id);
        assert.equal(digest(reread.payload), digest(resource.payload), 'persisted resource payload changed');
        result.resources.push({ kind: resource.kind, title: resource.title });
      }
      const entry = { item, preview, resources: saved.resources };
      if (preview.kind === 'character-card') {
        const card = saved.resources.find(r=>r.kind==='character');
        for(const key of sourceFields) if(preview.importData.characterCard[key]?.length) assert.deepEqual(card.payload[key], preview.importData.characterCard[key], `import changed authored ${key}`);
        chars.push(entry);
      } else if (preview.kind === 'prompt-preset') presets.push(entry);
      else extras.push(entry);
      result.status = 'passed';
    } catch(error) { result.status = error.message === 'UNSUPPORTED_IMPORT_PAYLOAD' ? 'unsupported' : 'failed'; result.error = error.message; }
  }
  console.log(`Imported ${chars.length} characters, ${presets.length} presets, ${extras.length} other recognized resources`);
  await config.saveProviders({ activeProviderId: 'local-stub', providers: [{id:'local-stub',kind:'openai-compatible',baseUrl:'https://invalid.test/v1',apiKey:'local-test-only',model:'deterministic',maxTokens:2000}] });
  let captured = [];
  const providerClient = {
    stream: async ({provider,messages,onToken}) => {
      const request = buildOpenAICompatibleRequest({provider,messages,stream:true});
      captured.push(JSON.parse(request.init.body).messages);
      const content='风从窗边吹过。对方停下脚步，安静地等待你的回应。';
      for(const part of ['风从窗边吹过。','对方停下脚步，','安静地等待你的回应。']) await onToken?.(part);
      return {content};
    },
    complete: async () => ({content:'{"facts":[],"rollingSummary":"双方仍在原处交谈。"}'})
  };
  const agent = new AgentService({configService:config,sessionService:sessions,providerClient});
  for (let ci=0; ci<chars.length; ci++) {
    const character=chars[ci];
    const additions = [...presets,...extras];
    for(let pi=0; pi<additions.length; pi++) {
      const preset=additions[pi];
      const row={character:character.item.name,preset:preset.item.name,additionKind:preset.preview.kind};
      report.combinations.push(row);
      try {
        const input={ title:'本地组合验证', includeBaseContent:false,
          characterResourceId:character.resources.find(r=>r.kind==='character').id,
          worldBookResourceIds:[...character.resources,...preset.resources].filter(r=>r.kind==='worldbook').map(r=>r.id),
          promptResourceIds:preset.resources.filter(r=>r.kind==='prompt'||r.kind==='prompt-bundle').map(r=>r.id) };
        const review=(await library.inspectPackComposition(input)).compatibilityReview;
        // Test the supported declarative path; reject every executable rule explicitly.
        input.compatibilityReview={ fingerprint:review.fingerprint,executionMode:'review-required',acknowledgeCompatibility:true,
          scriptReviews:review.rules.map(r=>({scriptId:r.scriptId,contentHash:r.contentHash,decision:'rejected',note:'本地验证仅测试声明式路径'})) };
        row.disabledScripts=review.rules.length;
        row.sourceCompatibilityDifferences=review.requiresCompatibilityAcknowledgement;
        const pack=await library.createPack(input);
        const session=await sessions.createSessionWithConfig({id:`case-${ci}-${pi}`,title:row.character,config:pack,memory:pack.memory});
        Object.assign(session.settings,settings);
        await sessions.saveSession(session);
        const reread=await sessions.getSession(session.id);
        assert.equal(digest(reread.config.promptModules),digest(pack.promptModules),'session lost preset config');
        assert.equal(reread.config.characterCard.name,character.preview.importData.characterCard.name,'wrong character');
        const assemble = (messages=[],budget=128000) => assemblePrompt({...reread.config,memory:reread.memory,messages,userMessage:userAction,activationContext:{generationType:'normal',seed:session.id},options:{...settings,maxPromptTokens:budget}});
        const a=assemble(); row.opening=summarize(a);
        const finalText=a.messages.map(m=>m.content).join('\n');
        row.unexpandedMacroNames=[...new Set([...finalText.matchAll(/\{\{\s*([^}:\s]+)[^}]*\}\}/g)].map(m=>m[1]))];
        row.fieldCoverage=Object.fromEntries(['name','description','personality','scenario','systemPrompt','postHistoryInstructions'].map(key=>{
          const value=pack.characterCard[key];
          return [key,!value?'empty':/\{\{|<%/.test(value)?'template-needs-semantic-review':finalText.includes(value)?'retained':'transformed-or-absent'];
        }));
        assert.equal(row.opening.suppressed.length,0,'preset suppressed');
        assert.equal(row.opening.omitted.length,0,'preset modules evicted');
        assert.ok(a.messages.some(m=>m.role==='user'&&m.content.includes(userAction)),'current user action lost');
        assert.ok(a.messages.every(m=>Object.keys(m).every(k=>!k.startsWith('_'))),'private metadata in request');
        const history=Array.from({length:20},(_,i)=>({id:`history-${i}`,role:i%2?'assistant':'user',content:i%2?`回应${i}：环境未变。`:`玩家行动${i}：我观察环境。`}));
        row.history=summarize(assemble(history));
        try { const limited=assemble(history,8000);row.smallBudget={status:'fits',tokens:limited.tokenEstimate}; }
        catch(e) { assert.equal(e.code,'PROMPT_BUDGET_INSUFFICIENT');row.smallBudget={status:'explicit-budget-error',requiredTokens:e.requiredTokens}; }
        row.status='passed';
        // One rotating preset per character exercises authoritative streaming and continuation.
        if(pi===ci%presets.length) {
          const turn={character:row.character,preset:row.preset};report.conversations.push(turn);
          try {
            captured=[];const events=[];const wire=[];
            const emit=(type,data)=>wire.push(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
            const first=await agent.sendMessageStream({sessionId:session.id,content:userAction,onToken:t=>{events.push('token');emit('token',{content:t});},onTurnReady:payload=>{events.push('turn');emit('turn',payload);}});
            assert.ok(events.indexOf('token')>=0&&events.indexOf('token')<events.indexOf('turn'),'missing streamed tokens before commit');
            emit('done',{session:first.session,reply:first.reply});
            const clientEvents=[];
            const clientResult=await readSseResponse(new Response(wire.join('')), {onToken:()=>clientEvents.push('token'),onTurnReady:payload=>{assert.equal(payload.reply.id,first.reply.id);clientEvents.push('turn');}});
            assert.equal(clientResult.reply.id,first.reply.id);
            assert.ok(clientEvents.indexOf('token')<clientEvents.indexOf('turn'),'frontend lost event order');
            turn.frontendTransport='passed';
            assert.ok(captured[0].some(m=>m.role==='user'&&m.content.includes(userAction)),'API request lost action');
            const second=await agent.sendMessageStream({sessionId:session.id,content:'我询问刚才发生的事情，然后等待回答。',onToken(){},onTurnReady(){}});
            const continued=await agent.continueMessage({sessionId:session.id,onToken(){},onTurnReady(){}});
            await agent.backgroundMaintenance.flush();
            const saved=await sessions.getSession(session.id);
            assert.ok(saved.messages.some(m=>m.id===first.reply.id),'first committed reply lost');
            assert.ok(saved.messages.some(m=>m.id===second.reply.id),'second committed reply lost');
            assert.equal(saved.turnViewSnapshot.turnId,continued.reply.id,'authoritative continuation snapshot mismatch');
            turn.status='passed';turn.modelRequests=captured.length;turn.storedMessages=saved.messages.length;
          } catch(error){turn.status='failed';turn.error=error.message;}
        }
      } catch(error){row.status='failed';row.error=error.message;row.code=error.code;}
    }
    console.log(`Validated ${ci+1}/${chars.length} character combinations`);
    await fs.writeFile(path.join(output,'results.json'),JSON.stringify(report,null,2));
  }
  report.finishedAt=new Date().toISOString();
} finally {
  await fs.writeFile(path.join(output,'results.json'),JSON.stringify(report,null,2));
  await fs.rm(root,{recursive:true,force:true});
}
for(const key of ['imports','combinations','conversations','macroSemantics']) console.log(key,report[key].reduce((a,r)=>(a[r.status]=(a[r.status]||0)+1,a),{}));
if(['imports','combinations','conversations','macroSemantics'].some(key=>report[key].some(r=>r.status==='failed'))) process.exitCode=1;
else if(report.imports.some(r=>r.status==='unsupported')) process.exitCode=2;
