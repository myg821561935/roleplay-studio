import {
  cleanImmersiveSidebarText,
  formatImmersiveMemoryMeta,
  normalizeImmersiveRecords
} from './immersiveDossier.js';
import { resolveImmersiveRollingSummary } from './immersiveStateProjection.js';
import { buildImmersiveImmediateTurnRecords } from './immersiveTurnRecords.js';

export function createImmersiveMemoryLedger({
  state = {},
  els = {},
  dossier = {},
  resolvePrologueTemplate = () => ({ tpl: {} }),
  getCurrentStoryPresentation = () => ({ title: '当前剧本', custom: false }),
  filterCustomStoryRecords = (records) => records,
  truncateText = (value) => String(value || ''),
  documentObject = globalThis.document
} = {}) {
  const {
    appendImmersiveMemoryRows = () => {},
    createImmersiveDossier = () => ({ root: null, body: null }),
    getImmersiveRecentTurns = () => []
  } = dossier;

  return function renderImmersiveMemoryLedger(label, genre) {
    if (!els.immersiveSidebarBody) return;
    const { tpl } = resolvePrologueTemplate();
    const presentation = getCurrentStoryPresentation(tpl, genre);
    const memory = state.session?.memory || {};
    const worldState = memory.worldState || {};
    const timeline = filterCustomStoryRecords(
      normalizeImmersiveRecords(worldState.timeline, '剧情纪事'),
      presentation
    );
    const memoryCards = Array.isArray(memory.memoryCards)
      ? memory.memoryCards
      : Array.isArray(memory.facts) ? memory.facts : [];
    const recentFacts = filterCustomStoryRecords(
      memoryCards.slice(-12).reverse().map((fact, index) => ({
        title: fact.title || fact.subject || `事实 ${memoryCards.length - index}`,
        detail: fact.content || fact.fact || [fact.subject, fact.predicate, fact.object].filter(Boolean).join(' '),
        meta: formatImmersiveMemoryMeta(fact)
      })).filter((item) => item.detail),
      presentation
    ).slice(0, 7);
    const recentTurns = getImmersiveRecentTurns(state.session?.messages || []);
    const recentLedger = buildImmersiveImmediateTurnRecords(memory.eventLedger, { truncateText });
    const recentEpisodes = (Array.isArray(memory.episodicMemory?.episodes) ? memory.episodicMemory.episodes : [])
      .filter((episode) => episode?.status === 'confirmed' && episode?.visibility !== 'director')
      .slice(-4)
      .reverse()
      .map((episode) => ({
        title: String(episode.title || '本幕事件').trim(),
        detail: truncateText(cleanImmersiveSidebarText(episode.summary || episode.userIntent), 360),
        meta: episode.scene ? `场景：${episode.scene}` : ''
      }))
      .filter((item) => item.detail);
    const summary = cleanImmersiveSidebarText(resolveImmersiveRollingSummary(memory.rollingSummary));

    const view = createImmersiveDossier({
      kind: 'memory',
      eyebrow: `${presentation.title} · 叙事记忆`,
      title: label,
      summary: '长期摘要负责守住章节因果，近期纪事负责保留刚刚发生、尚未沉淀的客观信息。',
      metrics: [
        ['长期摘要', summary ? 1 : 0],
        ['事实卡', memoryCards.length],
        ['待整理回合', Number(memory.unsummarizedTurnCount || 0)]
      ]
    });

    const longTerm = documentObject.createElement('section');
    longTerm.className = 'immersive-memory-block immersive-memory-long-term';
    const longTermTitle = documentObject.createElement('div');
    longTermTitle.className = 'immersive-memory-block-title';
    const longTermHeading = documentObject.createElement('h4');
    longTermHeading.textContent = '长期记忆';
    const longTermBadge = documentObject.createElement('span');
    longTermBadge.textContent = summary ? '已沉淀' : '等待总结';
    longTermTitle.append(longTermHeading, longTermBadge);
    const longTermText = documentObject.createElement('p');
    longTermText.textContent = summary || '尚未形成章节摘要。达到总结阈值后，系统会把稳定因果沉淀到这里。';
    longTerm.append(longTermTitle, longTermText);
    view.body.append(longTerm);

    if (recentLedger.length) appendImmersiveMemoryRows(view.body, '刚刚写入', recentLedger);
    if (recentEpisodes.length) appendImmersiveMemoryRows(view.body, '本幕纪事', recentEpisodes);
    if (recentFacts.length) appendImmersiveMemoryRows(view.body, '短期事实', recentFacts);
    if (timeline.length) appendImmersiveMemoryRows(view.body, '剧情纪事', timeline.slice(-8).reverse());
    if (recentTurns.length) appendImmersiveMemoryRows(view.body, '最近对话', recentTurns);
    els.immersiveSidebarBody.replaceChildren(view.root);
  };
}
