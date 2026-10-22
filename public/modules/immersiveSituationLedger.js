import {
  cleanImmersiveSidebarText,
  formatImmersiveLocation,
  mergeImmersiveFacts,
  normalizeImmersiveRecords,
  resolveLatestTurnFrame
} from './immersiveDossier.js';
import { resolveImmersiveQuestRecords } from './immersiveStateProjection.js';
import { getImmersiveRuntimeFeedback } from './immersiveRuntimeFeedback.js';
import { buildImmersiveImmediateTurnRecords } from './immersiveTurnRecords.js';

export function createImmersiveSituationLedger({
  state = {},
  els = {},
  dossier = {},
  getCurrentStoryPresentation = () => ({ title: '当前剧本', custom: false }),
  getLatestPanels = () => ({}),
  filterCustomStoryRecords = (records) => records,
  truncateText = (value) => String(value || '')
} = {}) {
  const {
    appendImmersiveDossierEmpty = () => {},
    appendImmersiveFactGrid = () => {},
    appendImmersiveLedgerSection = () => {},
    createImmersiveDossier = () => ({ root: null, body: null })
  } = dossier;

  return function renderImmersiveSituationLedger(label, tpl, genre) {
    if (!els.immersiveSidebarBody) return;
    const presentation = getCurrentStoryPresentation(tpl, genre);
    const memory = state.session?.memory || {};
    const worldState = memory.worldState || {};
    const panels = getLatestPanels();
    const turnFrame = resolveLatestTurnFrame(
      Array.isArray(state.session?.messages) ? state.session.messages : [],
      state.session?.turnViewSnapshot
    );
    const quests = filterCustomStoryRecords(
      normalizeImmersiveRecords(resolveImmersiveQuestRecords(memory), '待推进事项'),
      presentation
    );
    const presentCharacters = turnFrame?.scene?.presentActors?.length
      ? turnFrame.scene.presentActors.slice(0, 6)
      : (Array.isArray(worldState.characters) ? worldState.characters : [])
      .filter((character) => character?.encountered !== false)
      .map((character) => String(character?.name || '').trim())
      .filter(Boolean)
      .slice(0, 6);
    const recentEvents = buildImmersiveImmediateTurnRecords(memory.eventLedger, { truncateText });
    const { records: runtimeFeedbackRecords, interactionRecords } = getImmersiveRuntimeFeedback(memory);
    const simulationTime = String(memory.simulation?.calendar?.label || memory.simulation?.clock?.label || '').trim();
    const facts = mergeImmersiveFacts([
      ['地点', formatImmersiveLocation(worldState.location)],
      ['时间', simulationTime || String(worldState.flags?.time || worldState.location?.time || '').trim()],
      ['当前任务', quests[0]?.title],
      ['在场人物', presentCharacters],
      ['本轮状态', cleanImmersiveSidebarText(panels.sceneStatus)],
      ['当前待决', cleanImmersiveSidebarText(turnFrame?.decision?.focus)],
      ['紧迫程度', formatUrgency(turnFrame?.decision?.urgency)]
    ], 8);
    const view = createImmersiveDossier({
      kind: 'situation',
      eyebrow: `${presentation.title} · 当前态势`,
      title: label,
      summary: '只呈现此刻的场景坐标、刚发生的公开事件与待推进事项；关系网络与决策依据分别在独立视图中查看。',
      metrics: [
        ['场景状态', facts.length],
        ['本回合记录', recentEvents.length],
        ['待推进', quests.length]
      ]
    });

    appendImmersiveFactGrid(view.body, facts, 'immersive-situation-facts');
    if (interactionRecords.length) appendImmersiveLedgerSection(view.body, '玩家刚刚表达的意图', interactionRecords, { tone: 'active' });
    if (turnFrame?.decision?.requiresPlayerResponse && turnFrame.decision.focus) {
      appendImmersiveLedgerSection(view.body, '现在需要你决定', [{
        title: turnFrame.decision.actor || '当前交互',
        detail: turnFrame.decision.focus,
        meta: formatUrgency(turnFrame.decision.urgency)
      }], { tone: 'active' });
    }
    if (runtimeFeedbackRecords.length) appendImmersiveLedgerSection(view.body, '当前世界反馈', runtimeFeedbackRecords, { tone: 'active' });
    if (recentEvents.length) appendImmersiveLedgerSection(view.body, '刚刚发生', recentEvents, { tone: 'active' });
    if (quests.length) appendImmersiveLedgerSection(view.body, '长期待推进', quests, { numbered: true });
    appendImmersiveDossierEmpty(view.body, '尚未形成可展示的当前态势。完成一轮对话后会立即出现本回合记录。');
    els.immersiveSidebarBody.replaceChildren(view.root);
  };
}

function formatUrgency(value) {
  return ({ low: '可稍后处理', normal: '当前节点', high: '等待回应', critical: '必须立即决定' })[String(value || '')] || '';
}
