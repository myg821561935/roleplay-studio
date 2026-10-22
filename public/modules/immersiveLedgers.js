import {
  cleanImmersiveSidebarText,
  normalizeImmersiveRecords,
  parseImmersiveDocumentSections,
  resolveLatestRoleplayPanels,
  resolveLatestTurnFrame,
  toImmersiveWorldBookRecord
} from './immersiveDossier.js';
import { resolveImmersiveQuestRecords } from './immersiveStateProjection.js';
import {
  buildImmersiveRelationshipGraph,
  renderImmersiveRelationshipGraph
} from './relationshipGraph.js';
import { createImmersiveMemoryLedger } from './immersiveMemoryLedger.js';
import { createImmersiveGrowthLedger } from './immersiveGrowthLedger.js';
import { createImmersiveSituationLedger } from './immersiveSituationLedger.js';
import { collectImmersiveCharacterMembers } from './relationshipGraph.js';

export function createImmersiveLedgerController({
  state = {},
  els = {},
  dossier = {},
  resolvePrologueTemplate = () => ({ tpl: {} }),
  getCurrentStoryPresentation = () => ({ title: '当前剧本', custom: false }),
  splitCharacterStatus = () => ({ protagonist: '', interactive: '' }),
  extractRoleplayPresentation = () => ({ content: '', panels: {} }),
  truncateText = (value) => String(value || ''),
  documentObject = globalThis.document
} = {}) {
  const {
    appendImmersiveDossierEmpty = () => {},
    appendImmersiveFactGrid = () => {},
    appendImmersiveLedgerSection = () => {},
    createImmersiveDossier = () => ({ root: null, body: null })
  } = dossier;

  const getLatestPanels = () => resolveLatestRoleplayPanels(
    Array.isArray(state.session?.messages) ? state.session.messages : [],
    extractRoleplayPresentation,
    state.session?.turnViewSnapshot
  );

  const toWorldBookRecord = (entry) => toImmersiveWorldBookRecord(entry, truncateText);

  function renderImmersiveIntelligenceLedger(label, tpl, genre) {
    if (!els.immersiveSidebarBody) return;
    const presentation = getCurrentStoryPresentation(tpl, genre);
    const memory = state.session?.memory || {};
    const worldState = memory.worldState || {};
    const panels = getLatestPanels();
    const turnFrame = resolveLatestTurnFrame(
      Array.isArray(state.session?.messages) ? state.session.messages : [],
      state.session?.turnViewSnapshot
    );
    const crisisSections = presentation.custom
      ? []
      : parseImmersiveDocumentSections(tpl?.tabs?.currentCrisis?.content)
        .filter((section) => /线索|谜|调查|证据|异动|传闻/.test(`${section.title} ${section.body || ''}`));
    const quests = filterCustomStoryRecords(
      normalizeImmersiveRecords(resolveImmersiveQuestRecords(memory), '待办事项'),
      presentation
    );
    const worldbookClues = buildImmersiveWorldBookRecords(/任务|主线|剧情|事件|线索|谜|证据|开局|传闻/, 6);
    const factRecords = filterCustomStoryRecords(
      normalizeImmersiveRecords(
        Array.isArray(memory.memoryCards)
          ? memory.memoryCards.filter((card) => (
            String(card?.extensions?.stability || card?.stability || 'confirmed') === 'confirmed'
          ))
          : Array.isArray(memory.facts) ? memory.facts : [],
        '事实'
      ),
      presentation
    ).filter((record) => /线索|证据|发现|调查|谜|秘密|异常|失踪|任务|承诺|去向/.test(`${record.title || ''} ${record.detail || ''}`));
    const turnEvidence = (Array.isArray(turnFrame?.evidence) ? turnFrame.evidence : [])
      .filter((entry) => entry?.source !== 'accepted-prose-fallback')
      .map((entry) => ({
        title: entry.status === 'confirmed' ? '本轮已确认' : entry.status === 'risk' ? '当前风险' : '待验证判断',
        detail: entry.text,
        meta: entry.source || ''
      }))
      .filter((entry) => entry.detail);
    const view = createImmersiveDossier({
      kind: 'intelligence',
      eyebrow: `${presentation.title} · 决策线索`,
      title: label,
      summary: panels.sceneStatus
        ? `围绕“${cleanImmersiveSidebarText(panels.sceneStatus)}”整理待验证信息与行动依据；当前状态、关系变化另见对应视图。`
        : '只呈现能帮助下一步决策的任务、证据、未解问题与已载入依据，不重复展示当前状态或人物关系。',
      metrics: [
        ['任务', quests.length],
        ['底稿', worldbookClues.length],
        ['线索', factRecords.length]
      ]
    });

    if (crisisSections.length) {
      appendImmersiveLedgerSection(view.body, '未解异动', crisisSections, { tone: 'warning' });
    }
    if (turnEvidence.length) {
      appendImmersiveLedgerSection(view.body, '本轮决策依据', turnEvidence, { numbered: true, tone: 'active' });
    }
    if (quests.length) {
      appendImmersiveLedgerSection(view.body, '当前任务', quests, { numbered: true, tone: 'active' });
    }
    if (worldbookClues.length) {
      appendImmersiveLedgerSection(view.body, '已载入的行动依据', worldbookClues, { numbered: true });
    }
    if (factRecords.length) {
      appendImmersiveLedgerSection(view.body, '已获线索', factRecords, { numbered: true, tone: 'active' });
    }
    appendImmersiveDossierEmpty(view.body, '尚无公开线索。剧情推进后，这里会同步任务、证据与未解问题。');
    els.immersiveSidebarBody.replaceChildren(view.root);
  }

  function renderImmersiveRelationshipLedger(label, tpl, genre) {
    if (!els.immersiveSidebarBody) return;
    const presentation = getCurrentStoryPresentation(tpl, genre);
    const worldState = state.session?.memory?.worldState || {};
    const panels = getLatestPanels();
    const relationships = filterCustomStoryRecords(
      normalizeImmersiveRecords(worldState.relationships, '人物关系'),
      presentation
    );
    const factions = filterCustomStoryRecords(
      normalizeImmersiveRecords(worldState.factions, '势力动向'),
      presentation
    );
    const factionSections = presentation.custom
      ? []
      : parseImmersiveDocumentSections(tpl?.tabs?.factions?.content);
    const knowledgeGraph = state.session?.memory?.knowledgeGraph || { nodes: [], edges: [] };
    const memoryCards = state.session?.memory?.memoryCards || [];
    const protagonistName = worldState.protagonist?.name || state.config?.characterCard?.name || '主角';
    const characterPanels = splitCharacterStatus(panels.characterStatus, [protagonistName].filter(Boolean));
    const castTab = Object.values(tpl?.tabs || {}).find((tab) => /互动|角色/.test(tab?.label || ''));
    const members = collectImmersiveCharacterMembers({
      configured: state.config?.groupMembers,
      relationships: worldState.relationships,
      characters: worldState.characters,
      messages: state.session?.messages,
      interactiveStatus: characterPanels.interactive,
      relationshipStatus: panels.relationshipStatus,
      castContent: castTab?.content,
      protagonistNames: [protagonistName],
      registry: state.session?.memory?.characterRegistry
    });

    // Inject active memory cards as memory nodes
    const memoryNodes = memoryCards
      .filter(card => card.enabled !== false && card.title)
      .map(card => ({
        id: card.id || card.title,
        label: card.title,
        name: card.title,
        type: 'memory',
        properties: {
          description: card.content,
          role: card.type === 'event' ? '关键事件' : (card.type === 'location' ? '地点' : '记忆碎片')
        }
      }));
    // Try to link memories to the protagonist or characters if their keywords match
    const memoryEdges = memoryCards
      .filter(card => card.enabled !== false && Array.isArray(card.keywords))
      .flatMap(card => card.keywords.map(kw => ({
        source: card.id || card.title,
        target: kw,
        label: '关联',
        type: 'RELATED_TO'
      })));

    const mergedProjection = {
      nodes: [...(knowledgeGraph.nodes || []), ...memoryNodes],
      edges: [...(knowledgeGraph.edges || []), ...memoryEdges]
    };

    const graph = buildImmersiveRelationshipGraph({
      protagonistName,
      graphProjection: mergedProjection,
      relationships: worldState.relationships,
      factions: worldState.factions,
      relationshipStatus: panels.relationshipStatus
    });
    const directCount = graph.nodes.filter((node) => node.type === 'character' && node.direct !== false).length;
    const view = createImmersiveDossier({
      kind: 'relationships',
      eyebrow: `${presentation.title} · 人物网络`,
      title: label,
      summary: '以已发生的接触和世界状态为依据绘制关系；虚线仅表示已知但尚未直接接触的关联。',
      metrics: [
        ['已接触', directCount],
        ['关键人物', members.length],
        ['联系', relationships.length || graph.edges.length],
        ['势力', factions.length || factionSections.length]
      ]
    });
    if (members.length) {
      appendImmersiveLedgerSection(view.body, '关系人物档案', members.slice(0, 8).map((member) => ({
        title: member.name,
        detail: [member.role, member.relationship, member.description].filter(Boolean).join(' · ') || '已在当前叙事中登场。',
        meta: member.encountered ? '已接触' : ''
      })), { tone: 'active' });
      appendRelationshipArchiveLink(view.body);
    }
    renderImmersiveRelationshipGraph(view.body, graph, { documentObject });
    if (relationships.length) {
      appendImmersiveLedgerSection(view.body, '关系卷宗', relationships, { tone: 'active' });
    }
    if (factions.length) {
      appendImmersiveLedgerSection(view.body, '势力风向', factions, { tone: 'faction' });
    } else if (factionSections.length) {
      appendImmersiveLedgerSection(view.body, '势力风向', factionSections, { tone: 'faction' });
    }
    appendImmersiveDossierEmpty(view.body, '尚未建立人物或势力联系。实际接触后会在这里形成关系节点。');
    els.immersiveSidebarBody.replaceChildren(view.root);
  }

  function appendRelationshipArchiveLink(container) {
    const action = documentObject.createElement('button');
    action.type = 'button';
    action.className = 'immersive-network-archive-link';
    action.dataset.immersiveCharacterAction = 'open-archive';
    action.textContent = '查看完整角色档案';
    action.title = '打开已登场角色的完整档案与当前状态';
    container.append(action);
  }

  function buildImmersiveWorldBookRecords(pattern, limit = 6) {
    const snapshot = state.session?.turnViewSnapshot;
    const committedActivationIds = snapshot?.spec === 'lra.turn-view-snapshot/v1'
      && snapshot?.worldBookActivation
      && Array.isArray(snapshot.worldBookActivation.activatedIds)
      ? new Set(snapshot.worldBookActivation.activatedIds.map(String))
      : null;
    return (Array.isArray(state.config?.worldBook) ? state.config.worldBook : [])
      .filter((entry) => entry && entry.enabled !== false)
      .filter((entry) => committedActivationIds === null || committedActivationIds.has(String(entry.id || '')))
      .filter((entry) => {
        const visibility = entry?.extensions?.visibility || entry?.visibility || 'player';
        return visibility !== 'gm' && entry?.extensions?.gmOnly !== true;
      })
      .filter((entry) => pattern.test([
        entry.title,
        entry.name,
        entry.category,
        entry.type,
        ...(Array.isArray(entry.keys) ? entry.keys : []),
        ...(Array.isArray(entry.keywords) ? entry.keywords : []),
        entry.extensions?.category,
        entry.extensions?.kind,
        ...(Array.isArray(entry.extensions?.tags) ? entry.extensions.tags : [])
      ].filter(Boolean).join(' ')))
      .sort((left, right) => Number(right.priority ?? 50) - Number(left.priority ?? 50))
      .slice(0, limit)
      .map(toWorldBookRecord);
  }

  function filterCustomStoryRecords(records, presentation) {
    if (!presentation?.custom) return records;
    const evidence = getCurrentCustomStoryEvidence(presentation);
    const inheritedSignatures = [
      '个人创作主角',
      '立足当前局势',
      '保住道心',
      '天命榜改写前',
      '寻找天道残缺',
      '补全本命功法',
      '落雷山脉秘境',
      '圣地与魔宗',
      '封魂玉简',
      '避劫雷木牌',
      '未开封秘境图',
      '破损飞剑',
      '青衣负剑',
      '雷火烧痕',
      '丹田雷纹',
      '金丹初期'
    ];
    return records.filter((record) => {
      const text = `${record.title || ''} ${record.detail || ''}`;
      if (inheritedSignatures.some((signature) => text.includes(signature) && !evidence.includes(signature))) {
        return false;
      }
      return true;
    });
  }

  function getCurrentCustomStoryEvidence(presentation) {
    if (!presentation?.custom) return '';
    const character = state.config?.characterCard || {};
    const worldBook = Array.isArray(state.config?.worldBook) ? state.config.worldBook : [];
    return [
      presentation.title,
      presentation.pack?.description,
      character.name,
      character.role,
      character.description,
      character.personality,
      character.scenario,
      character.firstMessage,
      ...worldBook.slice(0, 120).flatMap((entry) => [
        entry?.title,
        String(entry?.content || '').slice(0, 900)
      ])
    ].filter(Boolean).join('\n');
  }

  const renderImmersiveSituationLedger = createImmersiveSituationLedger({
    state,
    els,
    dossier,
    getCurrentStoryPresentation,
    getLatestPanels,
    filterCustomStoryRecords,
    truncateText
  });

  const renderImmersiveMemoryLedger = createImmersiveMemoryLedger({
    state,
    els,
    dossier,
    resolvePrologueTemplate,
    getCurrentStoryPresentation,
    filterCustomStoryRecords,
    truncateText,
    documentObject
  });

  const renderImmersiveGrowthLedger = createImmersiveGrowthLedger({
    state,
    els,
    dossier,
    getCurrentStoryPresentation,
    getLatestPanels,
    splitCharacterStatus,
    truncateText
  });

  return {
    filterCustomStoryRecords,
    renderImmersiveIntelligenceLedger,
    renderImmersiveRelationshipLedger,
    renderImmersiveMemoryLedger,
    renderImmersiveGrowthLedger,
    renderImmersiveProgressLedger: renderImmersiveGrowthLedger,
    renderImmersiveSituationLedger
  };
}
