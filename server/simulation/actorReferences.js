// Resolve only discourse-supported people; never choose a person by roster order.
const escape = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const prose = value => String(value || '').replace(/^\s*(?:【[^】\n]{1,30}】|\[[^\]\n]{1,30}\])\s*/u,'').replace(/“[^”]*”|「[^」]*」|『[^』]*』|"[^"\n]*"/gu, '');
const unique = values => [...new Set(values.filter(Boolean))];
const namesIn = (value, names) => names.flatMap(name => [...value.matchAll(new RegExp(escape(name), 'gu'))].map(m => ({name, at:m.index}))).sort((a,b)=>a.at-b.at);

export function resolveActorReference({reference='', content='', quote='', actors=[], exclude=[]}={}) {
  const names=unique(actors), allowed=names.filter(x=>!exclude.includes(x));
  const direct=allowed.filter(name=>reference.includes(name));
  if(direct.length) return {matches:direct,ambiguous:direct.length>1};
  const at=String(content).indexOf(quote);
  const prior=prose(at<0?'':String(content).slice(0,at)).slice(-500);
  const sentences=prior.split(/[。！？\n]/u).filter(x=>x.trim());
  const anchor=sentences.findLast(x=>names.some(name=>x.includes(name)))||'';
  const ordered=unique(namesIn(anchor,names).map(x=>x.name));
  if(/前者|后者/u.test(reference)) {
    const name=ordered.length===2?ordered[/后者/u.test(reference)?1:0]:'';
    return {matches:allowed.includes(name)?[name]:[],ambiguous:!name};
  }
  if(/[她他]|对方/u.test(reference)) {
    const matches=ordered.filter(x=>allowed.includes(x));
    return {matches:matches.length===1?matches:[],ambiguous:matches.length!==1};
  }
  return {matches:[],ambiguous:false};
}

// A completed transfer may use the object as subject: "信从甲掌中滑到乙手里".
// Bind the explicit source separately from the recipient's discourse reference.
export function completedHandToHand({quote='',content='',actors=[]}={}) {
  const names=unique(actors);
  const match=quote.match(/从([^，,。；：\s*]{1,30}?)(?:掌中|手中|手里)(?:滑到|移到|递到|交到)([^，,。；：\s*]{1,30}?)(?:手里|手中|掌中)/u);
  if(!match)return null;
  const sender=names.find(name=>match[1]===name);
  if(!sender)return null;
  const result=resolveActorReference({reference:match[2],content,quote,actors:names,exclude:[sender]});
  return {sender,...result};
}

export function resolveActingPerson({content='',quote='',actors=[]}={}) {
  const names=unique(actors);
  const handoff=completedHandToHand({quote,content,actors:names});
  if(handoff)return handoff.sender;
  const firstClause=quote.split(/[，,；;]/u)[0];
  const sender=names.find(name=>firstClause.startsWith(name+'把') || firstClause.startsWith(name+'将'));
  if(sender && movementRecipient({quote:firstClause,content,actors:names,actor:sender}).matches.length===1)return sender;
  const explicit=names.filter(name=>new RegExp(`(?:^|[，,；：*\\s])${escape(name)}(?:把|将|从|伸手|拿|取|放|收|走|送|递|离|转|退|点|说|端|擦)`, 'u').test(quote));
  if(explicit.length===1)return explicit[0];
  if(explicit.length>1)return '';
  const leading=names.filter(name=>quote.startsWith(name) && !/^[和与、]/u.test(quote.slice(name.length)));
  if(leading.length===1)return leading[0];
  const ordered=quote.match(/^(?:随后|然后|接着|于是)?(?:[，,\s*]*)(前者|后者)/u);
  if(ordered)return resolveActorReference({reference:ordered[1],content,quote,actors:names}).matches[0]||'';
  // Only pronouns and an omitted subject may inherit the preceding actor.
  // A fresh noun subject (for example a passing customer) is not that actor.
  if(!/^(?:她|他|其|说完(?:她|他)?|随后|然后|接着|于是|却|又|便|把|将|伸手|拿|取|放|收|走|送|递|转身|转过身|端|抬|低头|点|俯|捏|木匣|铁匣|(?:这句是对.{1,20}说的[，,])?脚步|不是.{0,24}而是)/u.test(quote))return '';
  const at=String(content).indexOf(quote), prior=prose(at<0?'':String(content).slice(0,at)).slice(-700);
  const mentioned=namesIn(prior,names);
  const meaningful=prior.split(/[。！？\n]/u).filter(s=>names.some(n=>s.includes(n)) && !names.some(n=>new RegExp(`^\\s*${escape(n)}(?:没讲|没说|没有说话|没有开口)[*\\s]*$`,'u').test(s)));
  const lastSentence=meaningful.at(-1)||'';
  const subjectNames=names.filter(name=>new RegExp(`(?:^|[，,；：*\\s])${escape(name)}(?:把|将|从|伸手|拿|取|放|收|走|送|递)`,'u').test(lastSentence));
  const anchorEnd=prior.lastIndexOf(lastSentence)+lastSentence.length;
  if(/(?:少年|少女|伙计|店员|路人|另一人|另一名|陌生人).{0,8}(?:把|将|走|探|伸|拿|说)/u.test(prior.slice(anchorEnd)))return '';
  if(subjectNames.length===1)return subjectNames[0];
  // Coordinated people and a named observer/target make an unqualified pronoun ambiguous.
  if(unique(namesIn(lastSentence,names).map(x=>x.name)).length>1)return '';
  const last=mentioned.at(-1);
  if(!last || /(?:少年|少女|伙计|店员|路人|另一人|另一名|陌生人).{0,8}(?:把|将|走|探|伸|拿|说)/u.test(prior.slice(last.at+last.name.length)))return '';
  return last.name;
}

export function movementRecipient({quote='',content='',actors=[],actor=''}={}) {
  const handoff=completedHandToHand({quote,content,actors});
  if(handoff)return {mentioned:true,matches:handoff.matches,ambiguous:handoff.ambiguous};
  const palm=quote.match(/(?:放进|放入|放到|放在|递进|塞进|落到|落入)([^，,。；：\s*]{1,25}?)(?:掌心|掌中|手中|手里)/u);
  if(palm && !/(?:不|没有|尚未|并未|不要|别)(?:再|曾|直接)?$/u.test(quote.slice(0,palm.index))) {
    const result=resolveActorReference({reference:palm[1],content,quote,actors});
    if(result.matches.length || result.ambiguous)return {mentioned:true,...result};
  }
  const match=[...quote.matchAll(/(?:交给|递给|交到|递到|转交给?|交还给?|归还给|赠给|送给|赠与)([^，,。；：\s*]{1,30})/gu)].find(m=>!/(?:不|没有|尚未|并未|不要|别)(?:再|曾|直接)?$/u.test(quote.slice(0,m.index)));
  if(!match)return {mentioned:false,matches:[],ambiguous:false};
  const names=unique(actors), direct=names.filter(name=>match[1].startsWith(name));
  if(direct.length===1)return {mentioned:true,matches:direct,ambiguous:false};
  const reference=match[1].match(/^(前者|后者|她|他|对方)/u)?.[1];
  const result=reference?resolveActorReference({reference,content,quote,actors:names,exclude:[actor]}):{matches:[],ambiguous:true};
  return {mentioned:true,...result};
}
