const CHARACTER_PROFILE_TITLE = /^(.{1,50}?)[_·\s-]+(?:基础信息|二次解释|性格调色盘|人物档案|角色档案|人物设定|角色设定)(?:[_·\s-]|$)/u;
const GENERIC_SCENARIO_NAME = /(?:世界|剧本|故事|物语|仙宗|宗门|之家|学院|公寓|庄园|录|志|症|模拟器|模组)$/u;

export function getWorldBookCharacterProfileName(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return '';
  const title = String(entry.title || entry.name || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const explicitName = String(
    entry.extensions?.local_roleplay_agent?.characterName
      || entry.extensions?.characterName
      || entry.characterName
      || ''
  ).trim();
  return explicitName || String(title.match(CHARACTER_PROFILE_TITLE)?.[1] || '').trim();
}

export function isWorldBookCharacterProfileEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
  const title = String(entry.title || entry.name || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  return Boolean(getWorldBookCharacterProfileName(entry))
    || /^(?:角色速览|角色总览|人物速览|人物总览|角色档案|人物档案)$/u.test(title);
}

export function collectWorldBookCharacterNames(entries = [], { limit = 24 } = {}) {
  const names = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || entry.enabled === false) continue;
    const name = getWorldBookCharacterProfileName(entry);
    if (name && !names.includes(name)) names.push(name);
    if (names.length >= limit) break;
  }
  return names;
}

export function resolveCharacterContentMode(characterCard, worldBookEntries = []) {
  const declared = characterCard?.extensions?.local_roleplay_agent?.contentMode;
  const declaredKind = typeof declared === 'string' ? declared : declared?.kind;
  const characterNames = collectWorldBookCharacterNames(worldBookEntries);
  if (declaredKind === 'scenario-container') {
    return { kind: 'scenario-container', source: 'declared', characterNames };
  }

  const cardName = String(characterCard?.name || '').trim();
  const cardIsNamedCharacter = characterNames.includes(cardName);
  const generatedFields = new Set(
    characterCard?.extensions?.local_roleplay_agent?.enrichment?.generatedFields || []
  );
  const inheritedNpcFields = ['personality', 'scenario', 'exampleDialog']
    .filter((field) => generatedFields.has(field)).length;
  const isScenarioContainer = !cardIsNamedCharacter && (
    characterNames.length >= 3
    || (characterNames.length >= 2 && GENERIC_SCENARIO_NAME.test(cardName))
    || (characterNames.length >= 2 && inheritedNpcFields >= 2)
  );
  return {
    kind: isScenarioContainer ? 'scenario-container' : 'character',
    source: isScenarioContainer ? 'worldbook' : 'default',
    characterNames
  };
}
