import {
  cleanImmersiveSidebarText,
  mergeImmersiveFacts,
  parseImmersiveStatusFields
} from './immersiveDossier.js';
import { buildImmersiveImmediateTurnRecords } from './immersiveTurnRecords.js';

const GROWTH_TRACKS = Object.freeze([
  ['阶段与身份', /境界|修行|修为|等级|阶段|职级|身份|爵位|学业|职务|位阶/i],
  ['能力与技艺', /能力|技能|技艺|功法|武学|神通|天赋|知识|专长|熟练|才艺/i],
  ['状态与代价', /状态|体力|生命|理智|精神|污染|伤势|疲劳|健康|情绪|压力|san/i],
  ['资源与权限', /资源|物品|装备|金钱|银|声望|权限|资产|持有|背包|库存/i],
  ['关系与影响', /关系|好感|信任|亲密|声望|人脉|阵营|立场|威望|影响力/i]
]);

const CLOSE_RELATION_PATTERN = /亲|恋|爱|信任|盟友|同伴|搭档|师徒|家人|挚友|旧识|熟人|依赖|守护|协作|合作|同盟/i;

export function deriveImmersiveGrowthTracks({
  protagonist = {},
  statusFields = [],
  characterCard = {},
  worldBook = []
} = {}) {
  const sourceText = [
    characterCard?.name,
    characterCard?.description,
    characterCard?.personality,
    characterCard?.scenario,
    characterCard?.creator_notes,
    ...(Array.isArray(worldBook) ? worldBook.slice(0, 100).flatMap((entry) => [entry?.title, entry?.content]) : [])
  ].filter(Boolean).join('\n');
  const values = collectGrowthValues(protagonist, statusFields);
  return GROWTH_TRACKS.map(([title, pattern]) => {
    const evidence = values.filter((item) => pattern.test(`${item.label} ${item.value}`)).slice(0, 4);
    const declared = pattern.test(sourceText);
    if (!evidence.length && !declared) return null;
    return {
      title,
      detail: evidence.length
        ? evidence.map((item) => `${item.label}：${item.value}`).join('；')
        : `角色卡或世界书已声明此成长维度，尚未形成可确认的当前变化。`,
      meta: declared ? '角色卡 / 世界书已定义' : '当前状态已记录'
    };
  }).filter(Boolean);
}

export function deriveCloseCharacterGrowth({
  protagonistName = '',
  characters = [],
  relationships = [],
  eventLedger = []
} = {}) {
  const protagonist = String(protagonistName || '').trim();
  if (!protagonist) return [];
  const characterByName = new Map((Array.isArray(characters) ? characters : [])
    .filter((item) => item?.name)
    .map((item) => [String(item.name).trim(), item]));
  const eventText = (Array.isArray(eventLedger) ? eventLedger : [])
    .slice(-4)
    .map((event) => cleanImmersiveSidebarText(event?.summary))
    .join('\n');
  const close = new Map();

  (Array.isArray(relationships) ? relationships : []).forEach((relation) => {
    const from = String(relation?.from || relation?.source || '').trim();
    const to = String(relation?.to || relation?.target || relation?.character || '').trim();
    const peer = from === protagonist ? to : to === protagonist ? from : '';
    const relationText = [relation?.type, relation?.relation, relation?.relationship, relation?.details, relation?.detail]
      .filter(Boolean)
      .join(' · ');
    if (!peer || relation?.encountered === false || !CLOSE_RELATION_PATTERN.test(relationText)) return;
    close.set(peer, relationText || '已建立联系');
  });

  return [...close.entries()].slice(0, 4).map(([name, relation]) => {
    const character = characterByName.get(name) || {};
    const state = [
      character?.realm,
      character?.level,
      character?.status,
      character?.condition,
      character?.abilities,
      character?.skills,
      character?.capabilities
    ].filter(Boolean).map((value) => Array.isArray(value) ? value.join('、') : String(value)).join('；');
    const changedThisTurn = eventText.includes(name);
    return {
      title: name,
      detail: [
        relation ? `与主角：${relation}` : '',
        state || '尚未记录独立的能力或状态变化。',
        changedThisTurn ? '本回合已在事件记录中出现。' : ''
      ].filter(Boolean).join(' '),
      meta: changedThisTurn ? '本回合关联' : '关系密切人物'
    };
  });
}

export function createImmersiveGrowthLedger({
  state = {},
  els = {},
  dossier = {},
  getCurrentStoryPresentation = () => ({ title: '当前剧本' }),
  getLatestPanels = () => ({}),
  splitCharacterStatus = () => ({ protagonist: '' }),
  truncateText = (value) => String(value || '')
} = {}) {
  const {
    appendImmersiveDossierEmpty = () => {},
    appendImmersiveFactGrid = () => {},
    appendImmersiveLedgerSection = () => {},
    createImmersiveDossier = () => ({ root: null, body: null })
  } = dossier;

  return function renderImmersiveGrowthLedger(label, tpl, genre) {
    if (!els.immersiveSidebarBody) return;
    const presentation = getCurrentStoryPresentation(tpl, genre);
    const memory = state.session?.memory || {};
    const worldState = memory.worldState || {};
    const protagonist = worldState.protagonist || {};
    const character = state.config?.characterCard || {};
    const protagonistName = protagonist.name || character.name || '主角';
    const panels = getLatestPanels();
    const protagonistStatus = splitCharacterStatus(panels.characterStatus, [protagonistName, character.name].filter(Boolean)).protagonist;
    const statusFields = parseImmersiveStatusFields(protagonistStatus);
    const tracks = deriveImmersiveGrowthTracks({
      protagonist,
      statusFields,
      characterCard: character,
      worldBook: state.config?.worldBook
    });
    const closeCharacters = deriveCloseCharacterGrowth({
      protagonistName,
      characters: worldState.characters,
      relationships: worldState.relationships,
      eventLedger: memory.eventLedger
    });
    const recentEvents = buildImmersiveImmediateTurnRecords(memory.eventLedger, { truncateText }).slice(0, 2);
    const resources = (Array.isArray(worldState.resourceLedger) ? worldState.resourceLedger : [])
      .map((item) => item?.item || item?.name || item?.title)
      .filter(Boolean);
    const facts = mergeImmersiveFacts([
      ['主角', protagonistName],
      ['当前阶段', compactImmersiveGrowthValue(protagonist.realm || protagonist.level || character.role)],
      ['当前状态', compactImmersiveGrowthValue(protagonist.status || protagonist.condition)],
      ['能力/技艺', compactImmersiveGrowthValue(protagonist.abilities || protagonist.skills || protagonist.capabilities)],
      ['资源/物品', compactImmersiveGrowthValue(resources.length ? resources : protagonist.resources || protagonist.inventory)],
      ...statusFields.map(({ label: fieldLabel, value }) => [fieldLabel, compactImmersiveGrowthValue(value)])
    ], 10);
    const view = createImmersiveDossier({
      kind: 'growth',
      eyebrow: `${presentation.title} · 成长轨迹`,
      title: label,
      summary: '只使用角色卡、世界书和已结算状态定义成长；没有明确数值体系时，记录阶段、变化原因与可见影响，而不伪造通用经验值。',
      metrics: [
        ['成长维度', tracks.length],
        ['紧密人物', closeCharacters.length],
        ['近期节点', recentEvents.length]
      ]
    });

    appendImmersiveFactGrid(view.body, facts, 'immersive-progress-facts');
    if (tracks.length) appendImmersiveLedgerSection(view.body, '主角成长', tracks, { tone: 'active' });
    if (closeCharacters.length) appendImmersiveLedgerSection(view.body, '紧密人物的成长', closeCharacters, { tone: 'relationship' });
    if (recentEvents.length) appendImmersiveLedgerSection(view.body, '最近成长节点', recentEvents, { tone: 'active' });
    appendImmersiveDossierEmpty(view.body, '尚未发现当前角色卡或世界书定义的成长维度。后续出现明确状态变化后会在这里记录。');
    els.immersiveSidebarBody.replaceChildren(view.root);
  };
}

function collectGrowthValues(protagonist, statusFields) {
  const direct = [
    ['阶段', protagonist?.realm || protagonist?.level || protagonist?.rank],
    ['身份', protagonist?.identity || protagonist?.role || protagonist?.title],
    ['能力', protagonist?.abilities || protagonist?.skills || protagonist?.capabilities],
    ['状态', protagonist?.status || protagonist?.condition],
    ['资源', protagonist?.resources || protagonist?.inventory]
  ].map(([label, value]) => ({
    label,
    value: compactImmersiveGrowthValue(value)
  })).filter((item) => item.value);
  const parsed = (Array.isArray(statusFields) ? statusFields : [])
    .map((item) => ({
      label: cleanImmersiveSidebarText(item?.label),
      value: compactImmersiveGrowthValue(item?.value)
    }))
    .filter((item) => item.label && item.value);
  return [...direct, ...parsed];
}

function compactImmersiveGrowthValue(value, limit = 180) {
  const raw = Array.isArray(value)
    ? value.map((item) => typeof item === 'object'
      ? item?.name || item?.title || item?.label || item?.value || ''
      : item).filter(Boolean).join('、')
    : typeof value === 'object' && value !== null
      ? value.name || value.title || value.label || value.value || ''
      : value;
  const text = cleanImmersiveSidebarText(raw);
  return text.length > limit ? `${text.slice(0, Math.max(1, limit - 1)).trim()}…` : text;
}
