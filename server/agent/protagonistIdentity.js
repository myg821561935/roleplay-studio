export function resolveProtagonistIdentity(persona = {}, memory = {}) {
  const candidates = [persona?.enabled ? persona.name : '', memory?.narrativeRepair?.canonicalFacts?.protagonistName, memory?.worldState?.protagonist?.name];
  const name = candidates.map(v => String(v || '').trim()).find(v => v && !/^(?:<user>|\{\{user\}\}|用户|玩家|主角|主角原名)$/i.test(v)) || '';
  return { name, label: name || '主角' };
}

export function replaceProtagonistPlaceholders(text, identity) {
  const source = String(text || '');
  // Paired <user>...</user> is a structural wrapper, not a name placeholder.
  return source.split(/(<user\b[^>]*>[\s\S]*?<\/user\s*>)/gi)
    .map((part, index) => index % 2 ? part : part.replace(/<user\s*>|\{\{user\}\}|主角原名/gi, () => identity.label))
    .join('');
}

export function renderProtagonistIdentity(identity) {
  return identity.name
    ? `# 主角身份\n主角姓名：${identity.name}。姓名占位符指代此人，不将占位符当作实际名字。`
    : '# 主角身份\n主角尚未提供姓名，旁白使用“主角”或合适的人称代词；这不表示人物名叫“无名”或没有姓名。询问姓名时将取名权交给玩家，不编造履历。';
}

export function normalizeProtagonistPresentation(output, identity) {
  const normalize = value => {
    if (typeof value === 'string') return replaceProtagonistPlaceholders(value, identity);
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, normalize(entry)]));
    return value;
  };
  // Presentation only: never rewrite script bodies, mutation paths or state payloads.
  for (const key of ['reply', 'speaker', 'roleplayPanels', 'turnFrame']) output[key] = normalize(output[key]);
  return output;
}
