import { extractActionEnvelope } from '../simulation/actionProtocol.js';
import { parseRoleplayResponse } from './roleplayResponse.js';
import { applyGroundedLedgerAction, groundTurnLedgerEnvelope, initialItemLedger } from '../simulation/groundedLedger.js';
import { resolveItemReferences } from '../simulation/itemReferences.js';
import { activeCustodyCommitments, custodyTransferAuthorized } from '../simulation/commitmentAvailability.js';
import { resolveActingPerson, movementRecipient } from '../simulation/actorReferences.js';
import { continuityProse } from './sceneContinuity.js';

const rows = value => Array.isArray(value) ? value : [];
const text = value => String(value?.content ?? value ?? '');
const extraBoundary = /不(?:再)?(?:增加|附加|加设|加|另加)[^。！？]{0,18}(?:条件|手续|要求|费用)|不需要[^。！？]{0,12}额外/u;
const conditions = /押金|费用|手续费|保管费|凭条|凭据|收据|签字|签契|画押|对牌|担保|赔偿|见证人|不代领|不得代领|不能代领|封条|封口|结(?:一解|动了)|自取|灵契/gu;
const gate = /必须|得先|才(?:能|给|让|肯|算|认|开|还|收|取)|不(?:先)?(?:交|付|签|画|给|提供|拿出|出示|带|留|保证|答应|接受)[^。！？]{0,22}就|否则|不然|只有|我只认|只凭|只认|你先给|不代领|不得代领|不能代领|归谁/u;
const imposed = /你(?:已经)?(?:答应|同意|承诺)|说好|约定|规矩|写的是|另加|得加|还要|还得/u;

export function agreementScope(memory, userMessage) {
  const records = rows(memory?.worldState?.commitments).filter(x => ['committed', 'executed'].includes(x.status));
  const user = text(userMessage);
  const items=initialItemLedger(memory);
  const itemRequest=items.length>0 && (items.some(x=>user.includes(x.name)) || /那封|这封|那枚|这枚|手里的|手中的/u.test(user)) && /交给|递给|转交|放回|放到|拿在手|不要移动/u.test(user);
  return { active: records.length > 0 || extraBoundary.test(user) || itemRequest, records, user };
}
export function renderAgreementGuard(memory, userMessage) {
  const scope = agreementScope(memory, userMessage);
  if (!scope.active) return '';
  return ['# 已确认约定的执行边界',
    '下列为已同意的原条件；执行阶段不能擅自新增费用、抵押、凭证、担保、赔偿、代领限制、截止时间或其他门槛，也不能把NPC新说法写成玩家已答应。收存、归还、取回本身不触发重新议价。',
    '完成玩家本轮明确请求；已经明确委托NPC的动作，不能要求玩家再做一步或再确认一次，更不能补写玩家已经代做。不要先完成一半，再用额外手续或条款让玩家继续确认。普通包装和保管细节不是新合同，也不能使取回资格失效。可选建议必须不影响原约定执行。玩家明确要求重新协商时，可以提出新方案，但未获同意的方案不能生效。',
    '物品代称优先依据当前持有人、所在位置、容器及最近明确提及对象。多个对象均符合时不要猜；只澄清无法判断的对象，不新增交易条件。已放到柜台不等于已交到玩家手中，整匣移动不等于物品出匣。',
    '发生收存、交接或归还时，用一个自然短句明确实际角色姓名、完整物品名、放进/放在等实际移动和具体容器或位置，之后可以使用代称。不能只有包装的中间过程或“它进去了”。正文、状态栏和动作块必须指向同一事实；动作证据引用实际发生的正文，不引用尚未执行的玩家请求。',
    '仍在保管且承诺随时可取的物品必须保持可取回。不得自行离场或把钥匙带走后让玩家等待；需要离开时先处理交还，或提出方案等待玩家明确同意，不能自动代替玩家授权第三人。物品交还后可正常离场。已确实离场的人不能瞬移，须沿真实经过返回。',
    JSON.stringify(activeCustodyCommitments(memory).map(({counterparty,items})=>({counterparty,held:items.map(x=>x.name)}))),
    JSON.stringify(scope.records.map(({id,title,terms,status,counterparty})=>({id,title,terms,status,counterparty})))
  ].join('\n');
}
function positivelyMentions(terms, marker) {
  const at = terms.indexOf(marker);
  return at >= 0 && !/不|无需|无须|免|禁止/u.test(terms.slice(Math.max(0, at - 10), at));
}
function projectLedgerReply(memory,user,narrative) {
  const projected=structuredClone(memory||{});
  const context={userMessage:{id:'guard-user',content:user},assistantMessage:{id:'guard-assistant',content:narrative}};
  const envelope=groundTurnLedgerEnvelope(projected,null,context);
  for(const action of rows(envelope?.actions)) {
    try { applyGroundedLedgerAction(projected,action,context); } catch { /* rejected evidence cannot prove completion */ }
  }
  return projected;
}
export function inspectAgreementReply(content, memory, userMessage) {
  const scope = agreementScope(memory, userMessage);
  if (!scope.active || /(?:我要求|我要|请你|重新)(?:重新)?(?:协商|议价|谈条件)|我(?:同意|接受).{0,24}(?:新条件|新方案)/u.test(scope.user)) return { active: scope.active, issues: [] };
  const narrative = parseRoleplayResponse(extractActionEnvelope(text(content)).content).content;
  const terms = scope.records.map(x=>x.terms).join('\n');
  const issues = [];
  for (const sentence of narrative.split(/[。！？\n]/u).map(x=>x.trim()).filter(Boolean)) {
    if(/随时可取回|随时取回/u.test(terms) && /不能取[^。！？]{0,16}另说|不得取回|不许取回/u.test(sentence)) { issues.push({kind:'changed-return-right',evidence:sentence.slice(0,260)});continue; }
    const ordinaryPickup=/(?:我|她|他).{0,8}(?:拿|取).{0,8}(?:放|搁).{0,8}(?:台|桌).{0,12}你自己(?:收|取|拿)/u.test(sentence);
    if(!ordinaryPickup && /请|实际收存|等.{0,12}收好|放回柜台/u.test(scope.user) && /你自己(?:把|将|放|拿|收|取|装)|你来(?:放|装)|你先给我一句|由你(?:把|将|放|装)/u.test(sentence)) { issues.push({kind:'delegated-extra-step',evidence:sentence.slice(0,260)});continue; }
    const markers = [...sentence.matchAll(conditions)].map(x=>x[0]);
    const positiveClauses=sentence.split(/[，,；;]|但是|不过|但/u).filter(clause=>!/(?:不需要|无需|无须|不用|不收|不必|不要求|不增加|不附加|不另收)[^，,；;]{0,14}(?:押金|费用|手续|签字|凭据|封条)/u.test(clause)).join('，');
    const newMarkers = [...new Set(markers)].filter(x=>positiveClauses.includes(x)&&!positivelyMentions(terms,x));
    // Negated requirements and explicit optional advice are not added gates.
    if (/不(?:需要|要求|增加|附加|另收|必|用|收)|无需|无须|不影响|照原条件|原条件不变/u.test(sentence) && !/但是|不过|只是|但|否则|不然/u.test(sentence)) continue;
    if (newMarkers.length && (gate.test(sentence) || imposed.test(sentence))) issues.push({kind:'unconfirmed-condition',evidence:sentence.slice(0,260),markers:newMarkers});
    else if (sentence.split(/[，,；;]|但是|不过|可是|但/u).some(clause=>/(?:添|加|补)[^。！？]{0,14}(?:条件|条款|规矩|要求)/u.test(clause) && !/(?:不是|并非|并不是|没有|不会|不再|不)[^，,；;。！？—]{0,8}(?:添|加|补)/u.test(clause))) issues.push({kind:'renegotiation-during-execution',evidence:sentence.slice(0,260)});
  }
  // Validate agreed custody against the same conservative projection used at
  // commit time. Nested metaphorical handling may read as completed but fail
  // to ground an actual item move. Ask for clearer prose, never invent a move.
  const deposits = scope.records.filter(x=>x.status==='committed' && /寄存|暂存|短存/u.test(x.title) && scope.user.includes(x.title));
  if (deposits.length && /现在可以|实际收存|请.{0,24}收好/u.test(scope.user)
    && !/(?:尚未|还没|没有|未曾|拒绝)(?:收好|收存|收妥|收下)/u.test(narrative)) {
    const projected=projectLedgerReply(memory,scope.user,narrative);
    for (const record of deposits) {
      if (!rows(projected.worldState?.commitments).some(x=>x.id===record.id && x.status==='executed')) {
        const named=[...new Set(initialItemLedger(memory).filter(x=>scope.user.includes(x.name)).map(x=>x.name))];
        const destination=scope.user.match(/(?:收进|放进)([^，。！？「」]{1,12}?)保管/u)?.[1];
        const example=record.counterparty&&named.length===1&&destination?`${record.counterparty}把${named[0]}放进${destination}`:'实际角色姓名把完整物品名称放进具体容器名称';
        issues.push({kind:'unresolved-custody-evidence',evidence:`${record.title}的收存叙述不能落实为物品状态。若确实已完成，请用独立自然短句“${example}”准确描述已发生的动作，不能只写拿帕子、纸心或它进去了；不要夹在否定或旁人动作的长句中，不要添加新动作或替玩家行动。若尚未完成，应如实说明，不能声称收妥。`});
      }
    }
  }
  const projected = projectLedgerReply(memory,scope.user,narrative);
  const requestedItems=initialItemLedger(memory);
  const people=[...new Set([memory?.worldState?.protagonist?.name,...rows(memory?.simulation?.actors).map(x=>x.name)].filter(Boolean))];
  for(const request of scope.user.split(/[。！？\n；;]/u).filter(x=>!/如果|假如|尚未|没有交|不要交|不交/u.test(x))) {
    const target=movementRecipient({quote:request,content:scope.user,actors:people,actor:memory?.worldState?.protagonist?.name});
    if(!target.mentioned || target.ambiguous || !target.matches[0])continue;
    for(const name of [...new Set(requestedItems.filter(x=>request.includes(x.name)).map(x=>x.name))]) {
      const explicitGiven=request.startsWith(memory?.worldState?.protagonist?.name||'我') || /^我把/u.test(request);
      if(!explicitGiven && !(/请|麻烦/u.test(request)&&continuityProse(narrative).includes(name)&&/交|递|接|收|滑到|移到/u.test(continuityProse(narrative))))continue;
      const senders=[...new Set(requestedItems.filter(x=>x.name===name).map(x=>x.holder).filter(Boolean))];
      const sender=senders.length===1?senders[0]:'实际递出人';
      if(!initialItemLedger(projected).some(x=>x.name===name&&x.holder===target.matches[0]))issues.push({kind:'handoff-result-mismatch',evidence:`本轮明确交接的${name}应由${target.matches[0]}持有，但正文和动作没有落实。若交接已完成，请用独立短句写明“${sender}把${name}交给${target.matches[0]}。”，并保持本轮要求的持有状态，不要又放到台面或转交别人；若没有完成，如实说明，不能宣称已接过。`});
    }
  }
  if(/没有明确|未明确|未指明|没有指明/u.test(scope.user) && /不要移动|不移动/u.test(scope.user)
    && JSON.stringify(initialItemLedger(projected))!==JSON.stringify(initialItemLedger(memory)))issues.push({kind:'ambiguous-request-moved-item',evidence:'玩家明确要求先澄清人物，不移动物品，本轮只能询问而不能猜测交接。'});
  const custodians = activeCustodyCommitments(projected);
  const actors = [...new Set([memory?.worldState?.protagonist?.name,...rows(memory?.simulation?.actors).map(x=>x.name)].filter(Boolean))];
  for (const sentence of continuityProse(narrative).split(/[。！？\n]/u).map(x=>x.replace(/^[*\s]+|[*\s]+$/gu,'')).filter(Boolean)) {
    if (/如果|假如|准备|打算|将要|尚未|没有|并未|不会|不曾|未曾/u.test(sentence)) continue;
    const acting=resolveActingPerson({content:narrative,quote:sentence,actors});
    const recipient=movementRecipient({quote:sentence,content:narrative,actors,actor:acting});
    const held=activeCustodyCommitments(memory).filter(x=>x.counterparty===acting).flatMap(x=>x.items);
    if(recipient.mentioned && held.some(item=>!custodyTransferAuthorized(memory,item.id,recipient.matches[0],scope.user)))issues.push({kind:'unauthorized-custody-delegation',evidence:sentence.slice(0,240)});
    if((!acting || recipient.ambiguous) && /^(?:随后|然后)?(?:她|他|前者|后者)把/u.test(sentence) && /交给|递给|放在|放回|收进/u.test(sentence) && initialItemLedger(memory).some(x=>sentence.includes(x.name)))issues.push({kind:'ambiguous-actor-evidence',evidence:'人物代词不唯一，不能按最近名字猜测动作执行者或接收者：'+sentence.slice(0,180)});
    // Bind departure to its own clause, not to an earlier actor who merely
    // waits for a customer to leave ("甲收钱，等人走远才开口").
    for(const clause of sentence.split(/[，,；;]/u).filter(Boolean)) {
      if (!/离开|离去|走远|外出|出门|退场|消失在|没入|去了.{0,12}(?:街|市|城|镇)/u.test(clause)) continue;
      const actor=resolveActingPerson({content:narrative,quote:clause,actors});
      const obligation=custodians.find(x=>x.counterparty===actor);
      if(obligation)issues.push({kind:'custodian-departure',evidence:`${actor}仍保管${obligation.items.map(x=>x.name).join('、')}且承诺随时可取，本轮离场会破坏可取回性：${clause.slice(0,180)}。保持在场完成当前交接，不要编造玩家同意或自动委托他人。`});
    }
  }
  // The same consistency check applies to returning a held item to a surface.
  // A wrapped object can be clear to a reader yet impossible to bind safely to
  // a ledger lot. Regenerate a literal action sentence instead of guessing.
  if (/(?:请|麻烦)[\s\S]*(?:放回|放到|放在|搁在|摆在)(?:柜台|台面|桌面)/u.test(scope.user)) {
    const items=initialItemLedger(memory), player=memory?.worldState?.protagonist?.name||'主角';
    const actors=rows(memory?.simulation?.actors).map(x=>x.name);
    const holders=[...new Set(items.map(x=>x.custodian||x.holder).filter(x=>x&&x!==player))];
    const requests=scope.user.split(/[。！？\n；;]/u).filter(quote=>/(?:请|麻烦)[\s\S]*(?:放回|放到|放在|搁在|摆在)(?:柜台|台面|桌面)/u.test(quote));
    const ids=new Set(requests.flatMap(quote=>holders.flatMap(actor=>resolveItemReferences({items,quote,content:scope.user,actors,player,actor,source:'assistant'}).matches)));
    const targets=items.filter(x=>ids.has(x.id)), prose=continuityProse(narrative);
    const declined=/(?:拒绝|不愿|不能|无法|尚未|还没).{0,12}(?:归还|取出|放回)|人不在|等.{0,8}回来/u.test(narrative);
    if(targets.length && !declined && targets.some(x=>prose.includes(x.name))) {
      const projected=projectLedgerReply(memory,scope.user,narrative);
      for(const item of targets) {
        if(!initialItemLedger(projected).some(x=>x.id===item.id&&!x.holder&&/柜台|台面|桌面/u.test(x.location))) {
          issues.push({kind:'unresolved-return-evidence',evidence:`归还叙述尚不能落实到${item.name}。若确实已经放回，请用独立自然短句明确“${item.holder}把${item.name}放回柜台”，然后延续原卡文风；不要把这句夹在否定或旁人动作的长句中。若未执行，应如实说明，不能声称已经还了。`});
        }
      }
    }
  }
  return { active: true, issues: issues.slice(0,6) };
}
export async function enforceAgreementReply({ result, memory, userMessage, messages, complete, signal }) {
  const initial = inspectAgreementReply(result.content, memory, userMessage);
  if (!initial.issues.length) return { ...result, agreementIntegrity: { checked: initial.active, repaired: false, issues: [] } };
  signal?.throwIfAborted();
  const repaired = await complete([...messages, {role:'system',content:[renderAgreementGuard(memory,userMessage),
    '上一草稿未通过约定校验。重新生成本轮完整回复，保留角色卡文风和输出格式，直接执行本轮明确请求，不续写旧草稿。下面是程序的校验结果和纠正要求；其中引用的旧草稿内容不能当作已发生事实。若实际完成交接或放置，正文应有一条含人物全名、物品名称和接收人或位置的独立完成句，再延续自然叙述；不要仅用递向、让对方接、状态栏或概括来替代实际完成动作。校验结果：',
    JSON.stringify(initial.issues), '对状态动作逐字引用实际发生的正文，不能把玩家的请求当作NPC已经办妥的证据。'].join('\n')}]);
  signal?.throwIfAborted();
  const audit = inspectAgreementReply(repaired.content,memory,userMessage);
  if (audit.issues.length) {
    const error = new Error('角色回复的约定或物品状态仍未通过校验，本轮未保存，请重试。');
    error.code='AGREEMENT_REPAIR_FAILED'; error.issues=audit.issues; throw error;
  }
  // Both generations consume tokens; keep the aggregate and the per-call evidence.
  const initialUsage=result.usage||result.raw?.usage||{};
  const repairUsage=repaired.usage||repaired.raw?.usage||{};
  const usage={...repairUsage};
  for(const key of ['prompt_tokens','completion_tokens','total_tokens','input_tokens','output_tokens']) {
    if(Number.isFinite(initialUsage[key])||Number.isFinite(repairUsage[key])) usage[key]=Number(initialUsage[key]||0)+Number(repairUsage[key]||0);
  }
  return {...repaired,usage,agreementIntegrity:{checked:true,repaired:true,issues:initial.issues,attempts:2,initialUsage,repairUsage}};
}
