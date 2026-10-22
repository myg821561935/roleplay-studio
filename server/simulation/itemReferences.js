// Referential resolution operates on existing item lots, never on invented assets.
// Names, custody and locations narrow candidates before pronouns are considered.
const list = value => Array.isArray(value) ? value : [];
const text = value => String(value || '');
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const kinds = [ ['丹', /丹(?:药)?|药丸/u], ['信', /(?<!相|自|确|深|坚)信(?!用|任|息|心|号|仰|念)|信封/u], ['剑', /剑/u], ['灯', /灯/u], ['玉牌', /玉牌/u] ];
const physicalContext = value => text(value).replace(/“[^”]*”|「[^」]*」|『[^』]*』|"[^"\n]*"/gu,'');
const locationKey = value => text(value).replace(/木匣|铁匣/g,'匣').replace(/柜台|桌面|台面|青石/g,'台').replace(/正中|里面|之中|内|中|上|里/g,'');

export function resolveItemReferences({items=[],quote='',content='',actors=[],player='',actor='',source='user'}={}) {
  content=text(content);quote=text(quote);
  const at=content.indexOf(quote);
  const prior=physicalContext(at<0?'':content.slice(0,at)).slice(-500);
  const named=items.filter(x=>quote.includes(x.name));
  let candidates=named.length?named:items.filter(x=>kinds.some(([suffix,re])=>x.name.endsWith(suffix)&&re.test(quote)));
  let basis=named.length?'name':candidates.length?'kind':'';
  const containers=[...new Set(items.map(x=>x.container).filter(Boolean))];
  const container=containers.find(c=>quote.includes(c));
  if(!candidates.length && container){candidates=items.filter(x=>x.container===container);basis='container';}
  // A carrier is bound only by a nearby physical description linking it to a
  // unique item kind. The mere existence of a box in the scene proves nothing.
  if(!candidates.length && source==='assistant') {
    const carrier=quote.match(/(?:木托|托盘|纸包|布包|瓷匣|木匣|铁匣)/u)?.[0];
    if(carrier){
      const sentences=prior.split(/[。！？\n]/u).map(x=>x.trim()).filter(Boolean);
      const anchor=sentences.findLast(s=>s.includes(carrier));
      if(anchor && /托住|垫着|包住|裹住|装着|盛着|放进|收进|捏起|取下来/u.test(anchor)) {
        const matched=items.filter(x=>anchor.includes(x.name)||kinds.some(([suffix,re])=>x.name.endsWith(suffix)&&re.test(anchor)));
        if(new Set(matched.map(x=>x.name)).size===1){candidates=matched;basis='carrier';}
      }
    }
  }
  // Relational references must identify the source, not the action destination.
  const sourcePart=quote.split(/(?:放在|放到|放进|放回|收进|交给|递给|赠给|送给|归还给)/u)[0];
  const place=sourcePart.match(/(木匣|铁匣|匣|抽屉|柜台|台面|桌面|随身袋)(?:里|中|内|上|边)(?:的|那|这)/u)?.[1];
  const holder=list(actors).find(name=>new RegExp(`${escape(name)}(?:手里|手中|保管|拿着|持有)`, 'u').test(sourcePart));
  let holderName=holder||'';
  if(!holderName && /[她他]手(?:里|中)|[她他]保管/u.test(sourcePart)) {
    const mentioned=list(actors).filter(name=>name!==player&&prior.includes(name));
    const holding=[...new Set(items.map(x=>x.holder).filter(x=>x&&x!==player))];
    holderName=mentioned.length===1?mentioned[0]:holding.length===1?holding[0]:'';
    if(!holderName)return {matches:[],ambiguous:true,basis:'holder'};
  }
  if(place || holderName){
    if(!candidates.length)candidates=items;
    if(place)candidates=candidates.filter(x=>locationKey(x.location).includes(locationKey(place))||locationKey(x.container).includes(locationKey(place)));
    if(holderName)candidates=candidates.filter(x=>x.holder===holderName);
    basis='relation';
  }
  if(!candidates.length && /前者|后者/u.test(quote)){
    const mentions=[...new Set(items.map(x=>x.name))].flatMap(name=>[...prior.matchAll(new RegExp(escape(name),'gu'))].map(m=>({name,at:m.index})) ).sort((a,b)=>a.at-b.at);
    const names=[...new Set(mentions.slice(-2).map(x=>x.name))];
    if(names.length===2){candidates=items.filter(x=>x.name===names[/后者/u.test(quote)?1:0]);basis='ordered';}
  }
  if(!candidates.length && /它|(?:这|那)(?:一)?(?:枚|封|只|个)|(?:油)?纸包/u.test(quote)){
    // Search the nearest paragraph containing an explicit item; an intervening
    // new object or actor blocks fallback, including objects absent from the ledger.
    const tail=prior.split(/[。！？\n]/u).map(x=>x.trim()).filter(Boolean).slice(-2).join('。');
    const names=[...new Set(items.filter(x=>tail.includes(x.name)).map(x=>x.name))];
    const anchor=names.length===1?tail.lastIndexOf(names[0]):-1;
    if(anchor>=0 && !/(?:另|又|接着)?(?:取出|拿出|拿起|端起).{0,8}(?:杯|碗|书|笔|盘|匙|钥匙)/u.test(tail.slice(anchor+names[0].length))){
      candidates=items.filter(x=>x.name===names[0]);basis='antecedent';
    }
  }
  // Use physical custody to disambiguate equal-name lots; a request alone never
  // permits an NPC to extract anything from the player's inventory.
  if(source==='assistant') candidates=candidates.filter(x=>x.holder!==player && (!x.holder||x.holder===actor));
  else if(/取回|拿回|收回/u.test(quote)) candidates=candidates.filter(x=>x.holder!==player);
  else candidates=candidates.filter(x=>x.holder===player);
  const explicitMultiple=named.length>0 && new Set(named.map(x=>x.name)).size>1;
  const interchangeable=candidates.length>1 && new Set(candidates.map(x=>JSON.stringify([x.name,x.owner,x.holder,x.location,x.container||'']))).size===1;
  const ambiguous=candidates.length>1 && !explicitMultiple && !interchangeable;
  return {matches:ambiguous?[]:candidates.map(x=>x.id),ambiguous,basis,interchangeable};
}

export function referenceQuantity(quote,name,available,{resolved=false}={}){
  const number=v=>/^\d+$/.test(v)?Number(v):v==='两'?2:v==='十'?10:'零一二三四五六七八九'.indexOf(v);
  const exact=quote.match(new RegExp(`([一二两三四五六七八九十\\d]+)(?:枚|个|张|封|瓶|颗|把|件|块|份)${escape(name)}`,'u'));
  if(exact)return number(exact[1]);
  if(resolved){
    const count=quote.match(/([一二两三四五六七八九十\d]+)(?:枚|个|张|封|瓶|颗|把|件|块|份)/u);
    if(count)return number(count[1]);
    if(/(?:那|这)(?:一)?(?:枚|封|个|只)|前者|后者/u.test(quote))return 1;
  }
  if(available===1)return 1;
  return /全部|所有|剩下的/u.test(quote)?available:null;
}
