import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
const exec=promisify(execFile);
test('resource validation exercises isolated import, composition, streaming and reports unsupported input', {timeout:30000}, async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'resource-validation-cli-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const documents=[
    ['card.json',{spec:'chara_card_v2',data:{name:'守门人',description:'守护城门的人。',personality:'寡言。',character_book:{entries:[{id:1,keys:['城门'],content:'城门在清晨开启。',enabled:true,constant:true}]}}}],
    ['preset.json',{prompts:[{identifier:'main',name:'正文',content:'使用简洁对白。'}],prompt_order:[{order:[{identifier:'main',enabled:true}]}]}],
    ['unsupported.json',{unknownShape:true}]
  ];
  const inventory=[];
  for(const [name,value] of documents){const bytes=Buffer.from(JSON.stringify(value));const file=path.join(root,name);await writeFile(file,bytes);inventory.push({name,file,sha256:createHash('sha256').update(bytes).digest('hex')});}
  inventory.push(inventory[0]);
  const input=path.join(root,'inventory.json'),output=path.join(root,'output');
  await writeFile(input,JSON.stringify(inventory));
  await assert.rejects(exec(process.execPath,['scripts/validate-local-roleplay-resources.mjs',input,output],{cwd:path.resolve('.'),timeout:25000}),e=>e.code===2);
  const report=JSON.parse(await readFile(path.join(output,'results.json'),'utf8'));
  assert.deepEqual(report.imports.map(r=>r.status),['passed','passed','unsupported','duplicate-source']);
  assert.equal(report.combinations.length,1);assert.equal(report.combinations[0].status,'passed');
  assert.equal(report.conversations[0].status,'passed');assert.equal(report.conversations[0].modelRequests,3);
  assert.equal(report.conversations[0].frontendTransport,'passed');
  assert.equal(report.macroSemantics.length,3);
  assert.ok(report.macroSemantics.every(r=>r.status==='passed'));
  assert.ok(report.macroSemantics.every(r=>typeof r.expected==='string' && typeof r.actual==='string'));
});
