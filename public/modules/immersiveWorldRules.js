import { cleanImmersiveSidebarText } from './immersiveDossier.js';

export function getImmersiveWorldSystemGroups(systems, truncateText = (value) => String(value || '')) {
  const allSources = [
    systems?.topology?.nodes,
    systems?.population?.profiles,
    systems?.factions?.entities,
    systems?.calendar?.rules,
    systems?.economy?.rules,
    systems?.cultivation?.rules
  ];
  const characterRecords = allSources
    .flatMap((records) => Array.isArray(records) ? records : [])
    .filter(isCharacterProfileRecord);
  const semanticRecords = (records) => (Array.isArray(records) ? records : [])
    .filter((record) => !isCharacterProfileRecord(record) && !isOperationalRecord(record));
  const groups = [
    ['地点拓扑', semanticRecords(systems?.topology?.nodes), 'active'],
    ['人物与日程', [
      ...(Array.isArray(systems?.population?.profiles) ? systems.population.profiles : [])
        .filter((record) => !isOperationalRecord(record)),
      ...characterRecords
    ], ''],
    ['势力演化', semanticRecords(systems?.factions?.entities), ''],
    ['历法与天候', semanticRecords(systems?.calendar?.rules), ''],
    ['经济铁律', semanticRecords(systems?.economy?.rules), ''],
    ['修行刻度与反噬', semanticRecords(systems?.cultivation?.rules), '']
  ];
  const preferredGroups = resolvePreferredWorldSystemGroups(groups);
  const seen = new Set();
  return groups.map(([title, records, tone]) => {
    const items = [];
    for (const record of Array.isArray(records) ? records : []) {
      const sourceEntryId = String(record?.sourceEntryId || '').trim();
      const recordTitle = cleanImmersiveSidebarText(record?.name || record?.title || '未命名规则');
      const recordSummary = cleanImmersiveSidebarText(record?.summary);
      const identity = sourceEntryId
        ? `source:${sourceEntryId}:${isCharacterProfileRecord(record) ? '' : recordSummary.toLocaleLowerCase()}`
        : `title:${recordTitle.toLocaleLowerCase()}`;
      if (preferredGroups.get(identity) !== title) continue;
      if (seen.has(identity)) continue;
      seen.add(identity);
      items.push({
        title: recordTitle || '未命名规则',
        detail: truncateText(recordSummary || '已登记结构，等待剧情触发。', 220),
        meta: [
          record?.constant ? '常驻' : '按情境生效',
          sourceEntryId ? `来源 ${sourceEntryId}` : ''
        ].filter(Boolean).join(' · '),
        sourceEntryId
      });
      if (items.length >= 6) break;
    }
    return { title, tone, items };
  }).filter((group) => group.items.length);
}

function resolvePreferredWorldSystemGroups(groups) {
  const preferred = new Map();
  for (const [title, records] of groups) {
    for (const record of Array.isArray(records) ? records : []) {
      const sourceEntryId = String(record?.sourceEntryId || '').trim();
      const recordTitle = cleanImmersiveSidebarText(record?.name || record?.title || '未命名规则');
      const recordSummary = cleanImmersiveSidebarText(record?.summary);
      const identity = sourceEntryId
        ? `source:${sourceEntryId}:${isCharacterProfileRecord(record) ? '' : recordSummary.toLocaleLowerCase()}`
        : `title:${recordTitle.toLocaleLowerCase()}`;
      const score = scoreWorldSystemGroup(title, `${recordTitle} ${recordSummary}`);
      const current = preferred.get(identity);
      if (!current || score > current.score) preferred.set(identity, { title, score });
    }
  }
  return new Map([...preferred].map(([identity, value]) => [identity, value.title]));
}

function scoreWorldSystemGroup(groupTitle, text) {
  const patterns = {
    '地点拓扑': /(?:地点|区域|地理|疆域|城镇|城池|州郡|山川|驻地|据点|要塞|墟市)/gu,
    '人物与日程': /(?:人物|角色|NPC|居民|日程|行程|作息|轮值|值守)/giu,
    '势力演化': /(?:势力|阵营|朝廷|宗门|门派|世家|学派|组织|成员状况)/gu,
    '历法与天候': /(?:历法|日期|节气|季节|气候|时辰|天候)/gu,
    '经济铁律': /(?:经济|物价|货币|税率|市场|贸易|商会|交易|灵石|白银)/gu,
    '修行刻度与反噬': /(?:修仙|修行|修炼|功法|境界|道途|破境|反噬|灵根|走火入魔)/gu
  };
  return String(text || '').match(patterns[groupTitle] || /$^/gu)?.length || 0;
}

function isCharacterProfileRecord(record) {
  const title = String(record?.name || record?.title || '').replace(/\s+/g, ' ').trim();
  return /^.{1,50}?[_·\s-]+(?:基础信息|二次解释|性格调色盘|人物档案|角色档案|人物设定|角色设定)(?:[_·\s-]|$)/u.test(title)
    || /^(?:角色速览|角色总览|人物速览|人物总览|角色档案|人物档案)$/u.test(title);
}

function isOperationalRecord(record) {
  const title = String(record?.name || record?.title || '').replace(/\s+/g, ' ').trim();
  return /^(?:\[?mvu[_ -]?update\]?\s*)?(?:变量更新规则|变量输出格式|变量列表|变量清单)$/iu.test(title)
    || /^(?:社区卡原生运行契约|社区资源兼容运行契约)$/u.test(title);
}

export function excludeImmersiveStructuredWorldBookEntries(entries, systemGroups) {
  const representedSourceIds = new Set((Array.isArray(systemGroups) ? systemGroups : [])
    .flatMap((group) => Array.isArray(group?.items) ? group.items : [])
    .map((item) => String(item?.sourceEntryId || '').trim())
    .filter(Boolean));
  if (!representedSourceIds.size) return Array.isArray(entries) ? entries : [];
  return (Array.isArray(entries) ? entries : []).filter((entry) => {
    const identifiers = [
      entry?.id,
      entry?.sourceEntryId,
      entry?.extensions?.sourceEntryId,
      entry?.extensions?.source_entry_id
    ].map((value) => String(value || '').trim()).filter(Boolean);
    return !identifiers.some((identifier) => representedSourceIds.has(identifier));
  });
}
