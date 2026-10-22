// Only unquoted current narration can establish a physical transition. Keep
// clause boundaries so a rejected plan cannot leak its continuation as fact.
export function currentNarrativeClauses(value) {
  return String(value || '')
    .replace(/<(npc_thought|thinking|think|analysis|planning|planing|time|options|UpdateVariable)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/“[^”]*”|「[^」]*」|『[^』]*』|"[^"\n]*"/g, '')
    .split(/[。！？；\n]/u)
    .map(value => value.trim())
    .filter(value => value && !/(?:如果|若是|假如|回忆|想起|曾经|昨日|昨天|也许|可能|准备|打算|将要|想要|正要|即将|尚未|还没|并未|没有|未曾|不要|别再|计划|约定|通知|告示|预告)/u.test(value));
}
