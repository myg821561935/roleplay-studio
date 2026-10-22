import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistoryRepairController } from '../public/modules/historyRepair.js';
function dom() {
 const nodes=[];
 return {nodes,createElement(tag){const el={tag,children:[],listeners:{},value:'',append(...nodes){this.children.push(...nodes)},replaceChildren(...nodes){this.children=nodes},setAttribute(k,v){this[k]=v},addEventListener(k,fn){this.listeners[k]=fn}};nodes.push(el);return el;}};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('repair UI prevents stale preview reuse after switching sessions and requires review before apply',async()=>{
 const documentObject=dom(),container=documentObject.createElement('div');let id='first',resolvePreview;const calls=[];
 const controller=createHistoryRepairController({container,documentObject,getCurrentSessionId:()=>id,apiRequest:async(url,options)=>{calls.push({url,options});return new Promise(resolve=>resolvePreview=resolve)}});
 controller.render();const find=text=>documentObject.nodes.find(n=>n.textContent===text);
 const name=documentObject.nodes.find(n=>n['aria-label']==='修复使用的玩家角色姓名');
 const apply=find('按预览创建修复副本'),preview=find('预览历史人称修复');
 assert.equal(apply.hidden,true);name.value='刘一';preview.listeners.click();
 id='second';controller.render();resolvePreview({plan:{playerName:'刘一',sourceHash:'old',changes:[{messageId:'a',edits:[{}],before:'你',after:'刘一'}],skipped:[]}});await tick();
 assert.equal(apply.hidden,true);assert.equal(name.value,'');assert.equal(calls.length,1);
 name.value='新主角';preview.listeners.click();resolvePreview({plan:{playerName:'新主角',sourceHash:'new',changes:[{messageId:'b',edits:[{}],before:'你',after:'新主角'}],skipped:[]}});await tick();
 assert.equal(apply.hidden,false);apply.listeners.click();
 assert.ok(calls.at(-1).url.includes('/second/'));assert.equal(calls.at(-1).options.body.sourceHash,'new');
 resolvePreview({copy:{id:'copy',title:'副本'}});await tick();assert.equal(apply.hidden,true);assert.equal(find('打开修复副本').hidden,false);
});
