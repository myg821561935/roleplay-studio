import { resolveItemReferences, referenceQuantity } from './itemReferences.js';
import { createHash } from 'node:crypto';
import { continuityProse } from '../agent/sceneContinuity.js';

const clean = value => String(value || '').trim();
const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 16);
const list = value => Array.isArray(value) ? value : [];
const speculative = /如果|假如|要是|也许|可能|准备|打算|将要|想要|尚未|还没|并未|没有|未曾|不要|不曾|否认|谎称|声称|假装|回忆|昨日|昨天|曾经/;
const fail = (code, detail = '') => { throw Object.assign(new Error(code), { code, detail }); };
const playerName = memory => clean(memory?.worldState?.protagonist?.name) || '主角';
function actorName(memory, value) {
  if (value === 'player' || value === playerName(memory)) return playerName(memory);
  if (!value) return '';
  const actor = list(memory.simulation?.actors).find(x => x.id === value || x.name === value);
  if (!actor) fail('LEDGER_ACTOR_UNKNOWN', value);
  return actor.name;
}
function number(value) {
  if (/^\d+$/.test(value)) return Number(value);
  const digits = '零一二三四五六七八九';
  if (value === '两') return 2;
  if (value.includes('十')) { const [a,b] = value.split('十'); return (a ? digits.indexOf(a) : 1) * 10 + (b ? digits.indexOf(b) : 0); }
  return digits.indexOf(value);
}
export function initialItemLedger(memory = {}) {
  if (Array.isArray(memory?.worldState?.itemLedger)) return structuredClone(memory.worldState.itemLedger);
  const owner = playerName(memory), items = [];
  for (const value of list(memory?.worldState?.protagonist?.inventory)) {
    // Preserve opaque legacy records instead of guessing their quantities.
    if (typeof value !== 'string') continue;
    let name = value.trim(), quantity = 1, unit = '';
    const prefix = name.match(/^([一二两三四五六七八九十\d]+)(枚|个|张|封|瓶|颗|把|件|块|份)(.+)$/u);
    const suffix = name.match(/^(.+?)[×x*]\s*(\d+)(枚|个|张|封|瓶|颗|把|件|块|份)?$/u);
    if (prefix) { quantity = number(prefix[1]); unit = prefix[2]; name = prefix[3]; }
    else if (suffix) { name = suffix[1]; quantity = Number(suffix[2]); unit = suffix[3] || ''; }
    if (!name || !Number.isSafeInteger(quantity) || quantity < 1) continue;
    const id = `item-${hash(name)}`;
    const existing = items.find(x => x.id === id);
    if (existing) { existing.quantity += quantity; continue; }
    items.push({ id, name, quantity, unit, owner, holder: owner, location: '随身', source: 'legacy-inventory', evidence: value });
  }
  return items;
}
function observedActor(memory, content, quote) {
  const at = content.indexOf(quote);
  const prefix = continuityProse(content.slice(0, at)).slice(-700);
  const names = [...new Set([playerName(memory), ...list(memory.simulation?.actors).map(x=>x.name)])];
  const leading = names.find(name=>quote.startsWith(name));
  if (leading) return leading;
  const explicitSubject = names.find(name=>new RegExp(`(?:^|[，,；：*\\s])${escape(name)}(?:把|将|从|伸手|拿|取|放|收|走|送|递)`, 'u').test(quote));
  if (explicitSubject) return explicitSubject;
  const mentions = names.flatMap(name=>[...prefix.matchAll(new RegExp(escape(name),'gu'))].map(m=>({name,at:m.index})))
    .filter(x=>!/(?:朝向|朝着|朝|对着|面向|面对|递向|看向|交到|指向|看着|看了|看|望向|递给|交给|对|向|给)$/u.test(prefix.slice(Math.max(0,x.at-4),x.at)))
    .filter(x=>!/^.{0,2}(?:没讲|没说|没有说话|没有开口)/u.test(prefix.slice(x.at+x.name.length)))
    .sort((a,b)=>b.at-a.at);
  if (!mentions.length) return '';
  const tail = prefix.slice(mentions[0].at + mentions[0].name.length);
  // Do not carry a pronoun across an intervening unnamed subject.
  if (/(?:少年|少女|伙计|店员|路人|另一人|另一名|陌生人).{0,8}(?:把|将|走|探|伸|拿|说)/u.test(tail)) return '';
  return mentions[0].name;
}
function itemMention(memory, quote, item, source, context = {}) {
  const name=item.name;
  const references=resolveItemReferences({items:initialItemLedger(memory),quote,content:clean((source==='user'?context.userMessage:context.assistantMessage)?.content),actors:list(memory.simulation?.actors).map(x=>x.name),player:playerName(memory),actor:source==='user'?playerName(memory):observedActor(memory,clean(context.assistantMessage?.content),quote),source});
  if(references.matches.includes(item.id))return true;
  if(references.ambiguous || references.matches.length || references.basis==='relation')return false;
  if (source !== 'assistant') return false;
  const actor = observedActor(memory, clean(context.assistantMessage?.content), quote);
  const held = initialItemLedger(memory).filter(x=>x.holder===actor);
  if (actor && actor!==playerName(memory) && /纸包|油纸包/u.test(quote) && clean(context.userMessage?.content).includes(name)
    && held.length===1 && held[0].name===name && /纸|包/u.test(clean(held[0].evidence?.quote))) return true;
  const containers=['木匣','铁匣','纸包','油纸包'];
  if (actor && actor!==playerName(memory) && held.length===1 && held[0].name===name && containers.some(c=>quote.includes(c) && (clean(held[0].evidence?.quote).includes(c) || (c.endsWith('匣') && /匣/u.test(held[0].location))))) return true;
  const kind = ['丹','信','剑','灯','玉牌'].find(x=>name.endsWith(x));
  if (!kind) return false;
  const unique = new Set(initialItemLedger(memory).filter(x=>x.name.endsWith(kind)).map(x=>x.name)).size === 1;
  // Kind aliases were already checked by the resolver. A raw substring fallback
  // would turn unrelated words such as 信用账本 into the tracked letter.
  // A physical sentence can refer to the immediately preceding named object.
  // Keep this inside one prose paragraph and require exactly one held item.
  const content=clean(context.assistantMessage?.content), at=content.indexOf(quote);
  const prefix=continuityProse(content.slice(content.lastIndexOf('\n\n',at)+2,at)).slice(-120);
  return unique && actor && actor!==playerName(memory) && held.length===1 && held[0].name===name
    && /^(?:不是.{0,24}而是|(?:然后|随后)?她把(?:它|(?:那|这)?(?:油)?纸包))/u.test(quote) && prefix.includes(kind)
    && !initialItemLedger(memory).some(x=>x.name!==name && prefix.includes(x.name));
}
function evidence(action, context, { physical = false } = {}) {
  const source = action.evidence?.source, quote = clean(action.evidence?.quote);
  const message = source === 'user' ? context?.userMessage : source === 'assistant' ? context?.assistantMessage : null;
  const content = clean(message?.content);
  if (!quote || quote.length < 4 || !content.includes(quote)) fail('LEDGER_EVIDENCE_MISSING');
  const position = content.indexOf(quote);
  const start = Math.max(content.lastIndexOf('。', position), content.lastIndexOf('\n', position), content.lastIndexOf('！', position)) + 1;
  const end = content.slice(position + quote.length).search(/[。！？\n]/u);
  const sentence = content.slice(start, end < 0 ? content.length : position + quote.length + end);
  const eventSentence = sentence.replace(/没有用手[^，。]*[，,]/u, '');
  const notExecuted = /如果|假如|要是|也许|可能|准备|打算|将要|想要|未曾|不曾|回忆|昨日|昨天|曾经|谎称|声称|假装/u.test(eventSentence)
    || /(?:尚未|还没|并未|没有|不要|别)(?:[^，。；—]{0,32})(?:放|收|取|拿|交|赠|送|落(?!锁)|完成|履行|封存|办妥)/u.test(eventSentence);
  if (physical && (!continuityProse(content).includes(quote) || notExecuted)) fail('LEDGER_EVENT_NOT_EXECUTED');
  return { source, quote, sentence, messageId: message.id || '', userMessageId: context?.userMessage?.id || '' };
}
function syncViews(state, player) {
  const items = state.itemLedger;
  if (Array.isArray(items)) {
    const opaque = list(state.protagonist?.inventory).filter(x => typeof x !== 'string');
    const carried = new Map();
    for (const item of items.filter(x => x.holder === player)) {
      const key = item.name; const row = carried.get(key) || { ...item, quantity: 0 };
      row.quantity += item.quantity; carried.set(key, row);
    }
    state.protagonist = { ...state.protagonist, inventory: [...opaque, ...[...carried.values()].map(x => x.quantity === 1 && !x.unit ? x.name : `${x.name}×${x.quantity}${x.unit}`)] };
    state.resourceLedger = [...list(state.resourceLedger).filter(x => x?.source !== 'grounded-item-ledger'), ...items.map(x => ({ ...x, source: 'grounded-item-ledger', title: x.name, details: `数量 ${x.quantity}${x.unit}；所有者 ${x.owner}；持有人 ${x.holder || '无（放置中）'}；位置 ${x.location}${x.container ? `；仍在${x.container}内` : ''}` }))];
  }
  if (Array.isArray(state.commitments)) {
    const labels = { proposed: '待协商', committed: '已承诺', executed: '已执行', rejected: '已拒绝' };
    state.obligations = [...list(state.obligations).filter(x => x?.source !== 'grounded-commitment-ledger'), ...state.commitments.map(x => ({ ...x, source: 'grounded-commitment-ledger', title: x.title, details: `${labels[x.status]}：${x.terms}`, responsible: x.actor }))];
  }
}
export function applyGroundedLedgerAction(memory, action, context) {
  // Validate and project on a clone: a rejected item action cannot partly seed,
  // split, decrement or rewrite inventory.
  const state = structuredClone(memory.worldState || {}), player = playerName(memory);
  if (action.type === 'commitment.update') {
    const proof = evidence(action, context);
    const records = list(state.commitments), old = records.find(x => x.id === action.commitmentId);
    if (old?.status === action.status) fail('LEDGER_DUPLICATE_TRANSITION');
    if (action.status === 'proposed') {
      if (old) fail('LEDGER_TERMS_IMMUTABLE');
      if (!action.title || !action.terms) fail('LEDGER_TERMS_REQUIRED');
      if (!proof.quote.includes(action.title) || !proof.quote.includes(action.terms)) fail('LEDGER_TERMS_NOT_GROUNDED');
      records.push({ id: action.commitmentId, title: action.title, terms: action.terms, actor: player, counterparty: actorName(memory, action.counterparty), status: 'proposed', history: [{ status: 'proposed', ...proof }] });
    } else {
      if (!old) fail('LEDGER_PROPOSAL_REQUIRED');
      if ((action.terms && action.terms !== old.terms) || (action.title && action.title !== old.title)) fail('LEDGER_TERMS_IMMUTABLE');
      if (action.status === 'committed' || action.status === 'rejected') {
        if (old.status !== 'proposed' || proof.source !== 'user') fail('LEDGER_PLAYER_CONFIRMATION_REQUIRED');
        const attributedNpc = list(memory.simulation?.actors).filter(x => x.name !== player).some(x => new RegExp(`^[*\\s]*${escape(x.name)}.{0,12}(?:说|问|声称|告诉)`, 'u').test(proof.sentence));
        if (attributedNpc || /转述|复述|声称|谎称|假装|照读|念出|听说|你刚才说|你说过|是否|会不会|吗|么[？?]/u.test(proof.sentence)) fail('LEDGER_PLAYER_CONFIRMATION_REQUIRED');
        if (action.status === 'committed' && /如果|假如|要是|也许|可能|准备|打算|想要|(?:不|没有|没|尚未|并未|未曾|不曾|不要).{0,8}(?:同意|答应|接受|承诺)/u.test(proof.sentence)) fail('LEDGER_PLAYER_CONFIRMATION_REQUIRED');
        if (action.status === 'committed' && !proof.quote.includes(old.terms) && !/上述原条件|原条件不变|按你刚才的原条件/u.test(proof.quote)) fail('LEDGER_TERMS_CONFIRMATION_REQUIRED');
        // Naming the proposal avoids promoting every pending promise on a bare yes.
        if (!proof.quote.includes(old.title)) fail('LEDGER_AMBIGUOUS_CONFIRMATION');
        if (action.status === 'committed' && !/(?:我|本人).{0,8}(?:同意|答应|接受|承诺)|明确(?:同意|答应|接受)|点头同意/u.test(proof.quote)) fail('LEDGER_PLAYER_CONFIRMATION_REQUIRED');
        if (action.status === 'rejected' && !/拒绝|不同意|不答应|不接受|不承诺/u.test(proof.quote)) fail('LEDGER_REJECTION_REQUIRED');
      } else {
        if (old.status !== 'committed') fail('LEDGER_COMMITMENT_REQUIRED');
        const physical = evidence(action, context, { physical: true });
        const authorizedCustody = /寄存|暂存|短存/u.test(old.title) && clean(context?.userMessage?.content).includes(old.title) && /现在可以|实际收存|请.{0,24}收好/u.test(clean(context?.userMessage?.content)) && /收进|放进|封存|收存|收好|落了进去|送到|托进|放入|置于|落进|送回|收入|置入|搁在|搁上|盒盖扣上/u.test(physical.quote);
        if ((!physical.quote.includes(old.title) || !/完成|履行|办妥|交付|封存|收存|归还/u.test(physical.quote)) && !authorizedCustody) fail('LEDGER_EXECUTION_REQUIRED');
        if (physical.source === 'assistant' && (!old.counterparty || (!physical.quote.includes(old.counterparty) && observedActor(memory, clean(context?.assistantMessage?.content),physical.quote)!==old.counterparty))) fail('LEDGER_PLAYER_EXECUTION_REQUIRED');
        // An assistant cannot invent a player's act of performance.
        if (physical.source === 'assistant' && physical.quote.includes(player)) fail('LEDGER_PLAYER_EXECUTION_REQUIRED');
      }
      old.status = action.status; old.history.push({ status: action.status, ...proof });
    }
    state.commitments = records;
  } else {
    const proof = evidence(action, context, { physical: true });
    const items = initialItemLedger(memory);
    if (action.type === 'item.register') {
      if (!action.name) fail('LEDGER_ITEM_NAME_REQUIRED');
      if (items.some(x => x.name === action.name || x.id === action.itemId)) fail('LEDGER_ITEM_ALREADY_TRACKED');
      if (proof.source !== 'user' || !proof.quote.includes(action.name) || !/带着|携带|带有|拾起|买下|买了|获得/u.test(proof.quote)) fail('LEDGER_ACQUISITION_REQUIRED');
      const declared = proof.quote.match(new RegExp(`([一二两三四五六七八九十\\d]+)(?:枚|个|张|封|瓶|颗|把|件|块|份)${escape(action.name)}`, 'u'));
      if (action.quantity !== (declared ? number(declared[1]) : 1)) fail('LEDGER_QUANTITY_NOT_GROUNDED');
      items.push({ id: action.itemId, name: action.name, quantity: action.quantity, unit: action.unit || '', owner: player, holder: player, location: '随身', source: 'grounded-item-ledger', evidence: proof });
    } else {
      const item = items.find(x => x.id === action.itemId);
      if (!item) fail('LEDGER_ITEM_UNKNOWN', action.itemId);
      if (items.some(x => x.name === item.name && x.evidence?.messageId === proof.messageId && x.evidence?.source === proof.source && x.evidence?.quote === proof.quote)) fail('LEDGER_DUPLICATE_EVIDENCE');
      if (!itemMention(memory, proof.quote, item, proof.source, context)) fail('LEDGER_ITEM_NOT_GROUNDED');
      if (action.quantity > item.quantity) fail('LEDGER_INSUFFICIENT_QUANTITY');
      const actor = actorName(memory, action.actor);
      if (proof.source === 'user' && actor !== player) fail('LEDGER_PLAYER_ACTION_REQUIRED');
      if (proof.source === 'assistant' && (actor === player || observedActor(memory, clean(context?.assistantMessage?.content), proof.quote)!==actor)) fail('LEDGER_NPC_ACTION_REQUIRED');
      if (!/放在|放到|放回|放进|收进|收下|收起|收回|取回|拿回|取出|拿起|递给|交给|交还|归还|赠给|送给|赠与|转交|落了进去|落在|送到|托进|放入|置于|落进|送回|收入|置入|搁在|搁上|盒盖扣上|放下/u.test(proof.quote)) fail('LEDGER_MOVEMENT_REQUIRED');
      const firstNamedActor = [player,...list(memory.simulation?.actors).map(x=>x.name)].filter(Boolean).map(name=>({name,at:proof.quote.indexOf(name)})).filter(x=>x.at>=0).sort((a,b)=>a.at-b.at)[0];
      if (proof.source === 'user' && firstNamedActor && firstNamedActor.name !== actor && !/^我(?:把|将|取回|拿回|收回)/u.test(proof.quote)) fail('LEDGER_ACTION_SUBJECT_MISMATCH');
      if (/看着|看见|听见|目送|转述|复述/u.test(proof.quote)) fail('LEDGER_ACTION_SUBJECT_MISMATCH');
      const holder = actorName(memory, action.holder);
      if (holder && !proof.quote.includes(holder) && !((holder === player && proof.source === 'user' && /收回|取回|拿回|拿起|收起/u.test(proof.quote)) || (holder === actor && proof.source === 'assistant'))) fail('LEDGER_HOLDER_NOT_GROUNDED');
      if (action.location !== '随身' && !proof.quote.includes(action.location)) fail('LEDGER_LOCATION_NOT_GROUNDED');
      const container = clean(action.container);
      if (container && !proof.quote.includes(container)) fail('LEDGER_CONTAINER_NOT_GROUNDED');
      if (action.location === '随身' && !holder) fail('LEDGER_HOLDER_REQUIRED');
      if (item.holder && actor !== item.holder && actor !== item.owner) fail('LEDGER_CUSTODY_MISMATCH');
      // A custodian may receive an item from a surface, not teleport it out of
      // another actor's inventory based solely on their generated narration.
      if (proof.source === 'assistant' && item.holder === player && actor !== player) fail('LEDGER_HANDOVER_REQUIRED');
      const evidencedQuantity = referenceQuantity(proof.quote,item.name,item.quantity,{resolved:true});
      if (evidencedQuantity !== action.quantity) fail('LEDGER_QUANTITY_NOT_GROUNDED');
      let owner = item.owner;
      if (action.type === 'item.transfer') {
        owner = actorName(memory, action.owner);
        if (actor !== item.owner || !owner || !/赠给|送给|赠与|所有权转给/u.test(proof.quote) || /寄存|暂存|代管|保管|借/u.test(proof.quote)) fail('LEDGER_OWNERSHIP_TRANSFER_REQUIRED');
        if (!proof.quote.includes(owner)) fail('LEDGER_OWNER_NOT_GROUNDED');
      }
      if (item.owner === owner && item.holder === holder && item.location === action.location && clean(item.container) === container) fail('LEDGER_DUPLICATE_TRANSITION');
      if (item.quantity > action.quantity) {
        item.quantity -= action.quantity;
        items.push({ ...item, id: `${item.id.split(':')[0]}:${hash(action.id)}`, quantity: action.quantity, owner, holder, location: action.location, container, evidence: proof });
      } else Object.assign(item, { owner, holder, location: action.location, container, evidence: proof });
    }
    state.itemLedger = items;
  }
  syncViews(state, player);
  const changes = ['commitments', 'itemLedger', 'protagonist', 'resourceLedger', 'obligations'].filter(key => JSON.stringify(state[key]) !== JSON.stringify(memory?.worldState?.[key]));
  const effects = changes.map(key => ({ actionId: action.id, type: action.type, path: `worldState.${key}`, before: structuredClone(memory?.worldState?.[key]), after: structuredClone(state[key]), visibility: action.visibility, reason: action.reason }));
  memory.worldState = state;
  return effects;
}
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function isProtectedLedgerWrite(state, path, value) {
  if (/^(?:itemLedger|commitments)(?:\.|$)/.test(path)) return true;
  if (Array.isArray(state.itemLedger) && /^resourceLedger(?:\.|$)/u.test(path)) return true;
  if (Array.isArray(state.commitments) && /^obligations(?:\.|$)/u.test(path)) return true;
  if (Array.isArray(state.itemLedger) && /^(?:inventory|protagonist(?:\.inventory)?$|protagonist\.inventory\.)/.test(path)) return true;
  return false;
}
export function renderGroundedLedger(memory = {}) {
  const items = initialItemLedger(memory), commitments = list(memory?.worldState?.commitments);
  if (!items.length && !commitments.length) return '';
  return ['# 已校验的承诺与物品', '此处为当前有效状态。待协商不是承诺，已承诺不是已执行。NPC说“你答应过”不是玩家同意的证据。物品离身不等于失去所有权，寄存不等于赠送或消耗。不得在正文中替玩家同意、执行或补写取回。', JSON.stringify({ commitments, items })].join('\n');
}

// Conservative fallback for explicit player-authored statements. It does not
// infer assent from silence, NPC claims, pronouns, or suggested actions.
export function groundTurnLedgerEnvelope(memory, envelope, context = {}) {
  const user = clean(context.userMessage?.content), player = playerName(memory);
  const modelActions = list(envelope?.actions), generated = [], items = initialItemLedger(memory);
  const rows = user.split(/[。！？\n]/u).map(clean).filter(Boolean);
  const actorNames = list(memory.simulation?.actors).map(x => x.name).filter(x => x !== player);
  const counterparties = actorNames.filter(name => user.includes(name));
  const add = action => generated.push({ ...action, id: `grounded-${hash(`${context.userMessage?.id}|${action.type}|${action.itemId || action.commitmentId}|${action.evidence.quote}`)}`, visibility: 'public', reason: '本轮玩家明确原文的保守状态同步' });
  for (const row of rows) {
    const proposed = row.match(/([\u4e00-\u9fff]{1,12})条件是([^「」『』“”]{1,100})/u);
    if (!proposed || /拒绝|不同意|假如|如果|原先|之前|昨天|曾经|转述|复述/u.test(row)) continue;
    const [,title,terms] = proposed;
    if (list(memory.worldState?.commitments).some(x => x.title === title && x.terms === terms)) continue;
    add({type:'commitment.update',commitmentId:`promise-${hash(title+'|'+terms)}`,title,terms,counterparty:counterparties.length===1?counterparties[0]:(modelActions.find(a=>a.type==='commitment.update' && a.status==='proposed' && list(memory.simulation?.actors).some(n=>(n.id===a.counterparty||n.name===a.counterparty) && clean(context.assistantMessage?.content).includes(n.name)))?.counterparty || ''),status:'proposed',evidence:{source:'user',quote:row}});
  }
  for (const record of list(memory.worldState?.commitments).filter(x => x.status === 'proposed')) {
    const row = rows.find(x => x.includes(record.title) && /我(?:同意|答应|接受|承诺|拒绝|不同意|不答应)/u.test(x));
    if (row) add({type:'commitment.update',commitmentId:record.id,status:/我(?:拒绝|不同意|不答应)/u.test(row)?'rejected':'committed',evidence:{source:'user',quote:row}});
  }
  const physical = continuityProse(user).split(/[。！？\n]/u).map(x=>x.replace(/^[*\s]+|[*\s]+$/g,'')).filter(x=>x && !speculative.test(x));
  for (const row of physical) {
    if (!row.startsWith(player) && !/^我(?:把|将|取回|拿回|收回|拿起)/u.test(row)) continue;
    if (/看着|看见|目送|听见|设想|转述|复述/u.test(row)) continue;
    const returning = /取回|拿回|收回/u.test(row);
    const destination = row.match(/(?:放在|放到|放回|放进|收进)([^，,；：]{1,60})/u)?.[1]?.trim();
    const recipient = actorNames.find(name=>new RegExp(`(?:交给|递给|送给|赠给|赠与)${escape(name)}`, 'u').test(row));
    if (!returning && !destination && !recipient) continue;
    const references=resolveItemReferences({items,quote:row,content:user,actors:actorNames,player,actor:player,source:'user'});
    const matchedItems=items.filter(x=>references.matches.includes(x.id));
    for (const item of references.interchangeable?matchedItems.slice(0,1):matchedItems) {
      const quantity=referenceQuantity(row,item.name,item.quantity,{resolved:references.matches.length===1||references.interchangeable});
      if(!quantity || item.quantity<quantity)continue;
      const holder=recipient||(returning||/随身/u.test(destination||'')?player:'');
      const location=holder?'随身':destination;
      if (!location) continue;
      const gift=recipient && /送给|赠给|赠与/u.test(row);
      add({type:gift?'item.transfer':'item.move',itemId:item.id,quantity,actor:player,holder,location,...(gift?{owner:recipient}:{}),evidence:{source:'user',quote:row}});
    }
  }
  // Observe explicit NPC movements only after projecting the player's moves.
  // A unique item-kind alias (丹/信...) and a nearby unambiguous subject may
  // resolve prose, but never an item still carried by the player.
  const projected = structuredClone(memory);
  for (const action of generated) { try { applyGroundedLedgerAction(projected,action,context); } catch {} }
  const assistant = clean(context.assistantMessage?.content);
  const npcMoves = [];
  // Removing a quoted container label must not concatenate two noncontiguous
  // spans and then discard the whole physical sentence as nonliteral evidence.
  // Each remaining segment is still an exact substring; quoted claims stay out.
  const prose = continuityProse(assistant.replace(/“[^”]*”|「[^」]*」|『[^』]*』|"[^"\n]*"/gu,'\n'));
  // An explicit NPC subject can start a new action inside a sentence whose
  // earlier relative clause names the player ("她把甲留下的药包好，乙把药放进匣子").
  // Keep exact substring evidence while separating the two action subjects.
  const subjectBoundary=actorNames.length?new RegExp(`(?=(?:${actorNames.map(escape).join('|')})(?:把|将))`,'u'):null;
  const clauses=prose.split(/[。！？\n]/u).flatMap(row=>subjectBoundary?row.split(subjectBoundary):[row]);
  for (const raw of clauses) {
    const quote=raw.replace(/^[*\s]+|[*\s]+$/g,'').trim();
    if (!quote || !assistant.includes(quote)) continue;
    const actor=observedActor(projected,assistant,quote);
    if (!actor || actor===player) continue;
    let location='';
    const direct=quote.match(/(?:放在|放到|放回|放进|收进|收回|落在|送到|托进|放入|置于|落进|送回|收入|置入|搁在|搁上)(?:了)?([^，,；：]{1,24})/u);
    if (!direct && /(?:走回|移到)(柜台正中|柜台|台面)[^。]{0,16}放下/u.test(quote)) location=quote.match(/(?:走回|移到)(柜台正中|柜台|台面)/u)[1];
    if (!direct && /(?:木匣|铁匣)的盒盖扣上/u.test(quote) && /丹|信|剑|玉牌/u.test(quote)) location=quote.match(/木匣|铁匣/u)[0];
    if (direct) location=direct[1].replace(/\*+/gu,'').split(/[—]/u)[0].trim().replace(/(?:里面|之中|之内|上面|里|内|(?<!正|当)中|上)$/u,'');
    else if (/落了进去/u.test(quote)) location=[...quote.matchAll(/暗屉|抽屉|木匣|铁匣|石柜/gu)].at(-1)?.[0]||'';
    if (!location || location.length>16) continue;
    // A container can itself be below/on a counter. Moving the item into that
    // container is custody; placing the whole container on a bare surface is
    // represented separately by `container` and a surface-only destination.
    const holder=/屉|匣|柜(?!台)|袋|囊|格(?:子)?$/u.test(location)?actor:/柜台|台面|青石|桌面|桌/u.test(location)?'':null;
    if (holder===null) continue;
    const movedNames=new Set();
    for (const item of initialItemLedger(projected)) {
      if(movedNames.has(item.name))continue;
      if (item.holder===player || !itemMention(projected,quote,item,'assistant',context)) continue;
      if (item.quantity!==1) continue; // plural/mixed stacks need explicit protocol
      const carried=holder===actor && /随身/u.test(location);
      const container=(carried?location.match(/皮囊|锦囊|布袋|口袋/u)?.[0]:'') || quote.match(/木匣|铁匣/u)?.[0] || '';
      const wholeContainer=/(?:装了|装着|盛着)[^，]{0,20}(?:木匣|铁匣)/u.test(quote);
      const action={type:'item.move',itemId:item.id,quantity:1,actor,holder,location:carried?'随身':location,...(container && (carried || wholeContainer || (!quote.includes(item.name) && !quote.includes('丹')))?{container}:{}),evidence:{source:'assistant',quote}};
      const count=generated.length;add(action);
      try { applyGroundedLedgerAction(projected,generated.at(-1),context);npcMoves.push(generated.at(-1));movedNames.add(item.name); }
      catch { generated.length=count; }
    }
  }
  for (const record of list(memory.worldState?.commitments).filter(x=>x.status==='committed' && /寄存|暂存|短存/u.test(x.title))) {
    if (!user.includes(record.title)||!/现在可以|实际收存|请.{0,24}收好/u.test(user)) continue;
    const namedItems=[...new Set(items.filter(x=>user.includes(x.name)).map(x=>x.name))];
    const finalItems=initialItemLedger(projected);
    if (!namedItems.length || !namedItems.every(name=>npcMoves.some(m=>finalItems.some(x=>x.id===m.itemId&&x.name===name&&x.holder===record.counterparty)))) continue;
    // Use the actual receipt as execution evidence, not a later relocation of
    // its box whose verbs may not themselves establish accepting the deposit.
    const last=npcMoves.findLast(m=>m.holder===record.counterparty && /收进|放进|封存|收存|收好|落了进去|送到|托进|放入|置于|落进|送回|收入|置入|搁在|搁上|盒盖扣上/u.test(m.evidence.quote));
    if (last) add({type:'commitment.update',commitmentId:record.id,status:'executed',evidence:last.evidence});
  }
  const handledItems = new Set(generated.filter(x=>x.type.startsWith('item.')).map(x=>x.itemId));
  const handledPromises = new Set(generated.filter(x=>x.type==='commitment.update').map(x=>x.commitmentId));
  const actions = modelActions.filter(action => {
    if (action.type.startsWith('item.') && handledItems.has(action.itemId) && generated.some(x=>x.itemId===action.itemId && x.evidence.source===action.evidence?.source)) return false;
    if (action.type==='commitment.update' && (handledPromises.has(action.commitmentId) || (action.status==='proposed' && generated.some(x=>x.type==='commitment.update' && x.status==='proposed' && action.evidence?.source==='user')))) return false;
    return true;
  });
  if (!generated.length) return envelope;
  return {spec:'lra.action/v1',actorId:'narrator',baseRevision:null,summary:envelope?.summary||'同步玩家明确声明',...envelope,actions:[...generated,...actions].slice(0,20)};
}
