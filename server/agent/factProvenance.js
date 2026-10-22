// The extractor cannot promote its own assertions by writing "confirmed".
export function groundExtractedFact(card, context = {}) {
  const content = String(card?.content || '').trim();
  const sources = (context.sources || []).filter(s => s.kind === 'card' || s.kind === 'user-confirmed');
  const normalize = text => String(text || '').trim().replace(/[。！？.!?]+$/, '');
  // Match complete statements, so a quoted rumor or a negated sentence cannot
  // verify a shorter assertion merely because it contains the same words.
  const match = content.length >= 4 && sources.find(s => String(s.content || '').split(/[。！？\n]/).some(statement => normalize(statement) === normalize(content)));
  const history = !match && content.length >= 4 && (context.messages || []).find(m => m.role === 'assistant' && !m.contextExcluded && !m.excluded && String(m.content || '').includes(content));
  const origin = match?.kind || (history ? 'history-observed' : 'model-inference');
  const confirmed = Boolean(match);
  return { ...card, source: origin, enabled: confirmed && card.enabled !== false,
    extensions: { ...card.extensions, stability: confirmed ? 'confirmed' : 'candidate', reviewStatus: confirmed ? 'admitted' : 'candidate',
      provenance: { origin, sourceId: match?.id || history?.id || '', evidence: confirmed || history ? content : '', verified: confirmed } } };
}
export function buildFactEvidenceContext(config = {}, messages = []) {
  const sources = [];
  for (const card of [config.characterCard, ...(config.groupMembers || []), ...(config.worldBook || [])]) {
    if (!card || card.enabled === false || ['dynamic-memory', 'auto-extracted'].includes(card.source) || card.type === 'dynamic-memory') continue;
    for (const field of ['description', 'personality', 'scenario', 'knowledge', 'relationships', 'content']) if (typeof card[field] === 'string') sources.push({ kind: 'card', id: card.id || card.name || field, content: card[field] });
  }
  // User narration is not automatically confirmation: require explicit setting language.
  for (const m of messages) if (m.role === 'user' && !m.excluded && !m.contextExcluded && /(?:确认设定|设定为|事实是|确认事实)[：:\s]/.test(m.content)) sources.push({ kind: 'user-confirmed', id: m.id, content: String(m.content).replace(/^.*?(?:确认设定|设定为|事实是|确认事实)[：:\s]+/, '') });
  return { sources, messages };
}

export function markReviewedFactChanges(facts, previous = []) {
  return facts.map(fact => {
    const old = previous.find(item => item.id === fact.id);
    if (old && old.content === fact.content && (old.enabled !== false) === (fact.enabled !== false)) return fact;
    if (fact.enabled === false) return fact;
    return { ...fact, source: 'user-confirmed', extensions: { ...fact.extensions, stability: 'confirmed', reviewStatus: 'admitted', provenance: { origin: 'user-confirmed', sourceId: fact.id, evidence: fact.content, verified: true } } };
  });
}
