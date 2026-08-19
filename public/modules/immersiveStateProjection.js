export function resolveImmersiveRollingSummary(value) {
  let current = value;
  for (let depth = 0; depth < 4; depth += 1) {
    if (current && typeof current === 'object' && !Array.isArray(current)) {
      current = current.rollingSummary ?? current.rolling_summary ?? current.summary ?? current.content ?? '';
      continue;
    }
    const text = String(current || '').trim();
    if (!text.startsWith('{')) return text;
    try {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return text;
      current = parsed.rollingSummary ?? parsed.rolling_summary ?? parsed.summary ?? parsed.content ?? text;
    } catch {
      const parsed = parseFirstJsonObject(text);
      if (!parsed) return text;
      current = parsed.rollingSummary ?? parsed.rolling_summary ?? parsed.summary ?? parsed.content ?? text;
    }
  }
  return String(current || '').trim();
}

export function resolveImmersiveQuestRecords(memory, { includeResolved = false } = {}) {
  const source = memory && typeof memory === 'object' ? memory : {};
  const canonicalQuests = source.worldState && Array.isArray(source.worldState.quests)
    ? source.worldState.quests
    : null;
  const merged = new Map();
  const keyFor = (quest) => String(quest?.id || quest?.sourceId || quest?.title || quest?.name || '').trim().toLowerCase();
  const add = (quest, authoritative = false) => {
    if (!quest || typeof quest !== 'object') return;
    const key = keyFor(quest);
    if (!key) return;
    const previous = merged.get(key) || {};
    const title = String(quest.title || quest.name || quest.label || '').trim();
    merged.set(key, {
      ...previous,
      ...quest,
      id: quest.id || quest.sourceId || previous.id || key,
      title: title && title !== String(quest.id || quest.sourceId || '').trim()
        ? title
        : previous.title || title || key,
      description: quest.objective || quest.description || quest.content || previous.description || '',
      source: quest.source || previous.source || '',
      ...(authoritative ? {
        status: quest.status ?? previous.status,
        progress: quest.progress ?? previous.progress
      } : {})
    });
  };

  if (canonicalQuests) {
    canonicalQuests.forEach((quest) => add(quest, true));
  } else {
    // Older sessions stored task-like records only in the graph. A modern
    // SQLite graph is a focus/depth projection, so it must never be merged
    // with an existing canonical quest list as though it were the full set.
    (Array.isArray(source.knowledgeGraph?.nodes) ? source.knowledgeGraph.nodes : [])
      .filter((node) => String(node?.type || '').toLowerCase() === 'quest')
      .forEach((node) => add({
        ...(node.properties && typeof node.properties === 'object' ? node.properties : {}),
        id: node.properties?.id || node.sourceId || node.id,
        title: node.properties?.title || node.name || node.label,
        source: node.properties?.source || node.sourceKind
      }));
  }

  return [...merged.values()].filter((quest) => includeResolved || !isImmersiveQuestResolved(quest));
}

export function isImmersiveQuestResolved(quest) {
  const status = String(quest?.status || '').trim().toLowerCase();
  return Number(quest?.progress) >= 100
    || /^(?:completed|complete|done|resolved|cancelled|canceled|failed|已完成|已解决|已取消|已失败)$/.test(status);
}

function parseFirstJsonObject(value) {
  const text = String(value || '').trim();
  if (!text.startsWith('{')) return null;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(text.slice(0, index + 1));
          return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
