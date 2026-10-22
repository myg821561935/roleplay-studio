import fs from 'node:fs/promises';
import path from 'node:path';
import { buildHistoryRepairPlan, createHistoryRepairCopy } from '../server/agent/historyPerspectiveRepair.js';
const [action, sourcePath, target, playerName] = process.argv.slice(2);
if (!['preview','apply-copy'].includes(action) || !sourcePath || !target) throw new Error('Usage: preview source.json NEW_REVIEW_DIR playerName | apply-copy source.json review-dir');
const raw = await fs.readFile(sourcePath, 'utf8'); const session = JSON.parse(raw);
if (action === 'preview') {
 const plan = buildHistoryRepairPlan(session, playerName);
 await fs.mkdir(target, { recursive: false, mode: 0o700 });
 await fs.writeFile(path.join(target,'plan.json'),JSON.stringify(plan,null,2),{mode:0o600});
 const review = ['# 历史人称修复候选',`原故事：${session.title}。角色姓名：${plan.playerName}。修改 ${plan.changes.length} 条回复。`,...plan.limitations,
 ...plan.changes.map(c=>`## ${c.messageId}\n\n修改 ${c.edits.length} 处。\n\n处理前：\n\n${c.before}\n\n处理后：\n\n${c.after}`),...plan.skipped.map(s=>`跳过 ${s.messageId}：${s.reason}`)].join('\n\n');
 await fs.writeFile(path.join(target,'review.md'),review,{mode:0o600});console.log(JSON.stringify({changes:plan.changes.length,edits:plan.changes.reduce((n,c)=>n+c.edits.length,0),skipped:plan.skipped.length}));
} else {
 const plan=JSON.parse(await fs.readFile(path.join(target,'plan.json')));const copy=createHistoryRepairCopy(session,plan,{maxPromptTokens:playerName === undefined ? undefined : Number(playerName)});
 if(await fs.readFile(sourcePath,'utf8')!==raw) throw new Error('SOURCE_CHANGED');
 const destination=path.join(path.dirname(sourcePath),`${copy.id}.json`);
 await fs.writeFile(destination,JSON.stringify(copy,null,2),{flag:'wx',mode:0o600});
 await fs.writeFile(path.join(target,`copy-${copy.id}.json`),JSON.stringify({id:copy.id,destination,sourceId:session.id,sourceHash:plan.sourceHash}),{flag:'wx',mode:0o600});
 console.log(JSON.stringify({id:copy.id,title:copy.title,destination}));
}
