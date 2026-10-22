const rows=value=>Array.isArray(value)?value:[];
// Executed receipt is not discharge of the continuing right to retrieve an item.
// Once the item is returned, this constraint naturally ceases to apply.
export function activeCustodyCommitments(memory={}) {
  const items=rows(memory.worldState?.itemLedger);
  return rows(memory.worldState?.commitments).filter(record=>record.counterparty && ['committed','executed'].includes(record.status)
    && /保管|寄存|短存|暂存/u.test(`${record.title} ${record.terms}`)
    && /随时.{0,4}(?:取|领|归还)|(?:亲自|本人).{0,8}保管/u.test(record.terms||''))
    .flatMap(record=>{
      const mentioned=items.filter(item=>String(record.terms).includes(item.name));
      const held=items.filter(item=>(item.custodian||item.holder)===record.counterparty && item.owner!==(record.counterparty) && (!record.actor || item.owner===record.actor) && (!mentioned.length || mentioned.some(x=>x.name===item.name)));
      return held.length?[{...record,items:held}]:[];
    });
}
export function custodyPreventsDeparture(memory,actorName) {
  return activeCustodyCommitments(memory).some(x=>x.counterparty===actorName);
}

export function custodyMoveConflict(memory, actorName, from, to) {
  if(!custodyPreventsDeparture(memory,actorName) || !from || !to || from===to)return false;
  // A more specific spot in the same known place is not a departure.
  return !(from.length>=2 && String(to).startsWith(from));
}

export function custodyTransferAuthorized(memory,itemId,recipient,user='') {
  const record=activeCustodyCommitments(memory).find(x=>x.items.some(item=>item.id===itemId));
  if(!record || !recipient || recipient===record.counterparty || recipient===record.actor)return true;
  const name=String(recipient).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const clauses=String(user).split(/[。！？\n]/u);
  return clauses.some(clause=>!/(?:没有|尚未|并未|不|未曾).{0,5}(?:同意|允许|授权)|转述|声称|假如|如果/u.test(clause)
    && /^(?:我(?:同意|允许|授权)|请|麻烦)/u.test(clause.trim())
    && new RegExp(`(?:交给|转交给?|委托|由|给)${name}.{0,12}(?:保管|代管|收|拿)|(?:交给|转交给?)${name}(?:[，,；;]|$)`,'u').test(clause));
}

// Status descriptions may affirm staying ("没有离开") rather than departing.
export function describesDeparture(value='') {
  if(/^(?:away|departed|off-?scene)$/iu.test(String(value).trim()))return true;
  return String(value).split(/[，,。；;]|但是|不过|但/u).some(clause=>/离场|离开|外出|不在场/u.test(clause)
    && !/(?:没有|并未|尚未|未曾|不会|不要|不再|不|未)(?:已经|立即|再)?(?:离场|离开|外出)/u.test(clause));
}
