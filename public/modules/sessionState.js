export const SESSION_INSPECTOR_SECTIONS = Object.freeze([
  'contentStack',
  'authoring',
  'memoryOverview',
  'memoryView',
  'sessionHealth',
  'ruleStatus',
  'worldSimulation',
  'usageView',
  'facts',
  'worldbookEditor',
  'worldbookEntries',
  'macroTemplates',
  'timeline',
  'characterCardEditor',
  'promptEditor',
  'promptTemplates',
  'promptStudio',
  'persona',
  'quickReplies',
  'characterPresetFavorites',
  'promptPresetFavorites',
  'groupMembers',
  'targetSpeakerIndicator',
  'resourceWorkbench'
]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asSectionList(value) {
  return Array.isArray(value) ? value : [value];
}

export function createSessionStateCoordinator({
  state = {},
  inspectorSections = SESSION_INSPECTOR_SECTIONS,
  getInspectorRenderers = () => ({})
} = {}) {
  const sections = [...new Set(
    inspectorSections
      .map((section) => String(section || '').trim())
      .filter(Boolean)
  )];
  const knownSections = new Set(sections);
  const dirtySections = new Set();

  function matchesExpectedSession(expectedSessionId) {
    return expectedSessionId === undefined
      || String(state.session?.id || '') === String(expectedSessionId);
  }

  function replaceSession(session, { fallback, expectedSessionId } = {}) {
    if (!matchesExpectedSession(expectedSessionId)) return state.session;
    const nextSession = isRecord(session)
      ? session
      : (isRecord(fallback) ? fallback : null);
    if (nextSession) {
      state.session = nextSession;
      markInspectorDirty(sections);
    }
    return state.session;
  }

  function mergeSession(partial, { expectedSessionId } = {}) {
    if (!matchesExpectedSession(expectedSessionId) || !isRecord(partial)) {
      return state.session;
    }
    state.session = { ...(isRecord(state.session) ? state.session : {}), ...partial };
    return state.session;
  }

  function markInspectorDirty(sectionOrSections) {
    asSectionList(sectionOrSections).forEach((section) => {
      if (knownSections.has(section)) dirtySections.add(section);
    });
    return getDirtyInspectorSections();
  }

  function getDirtyInspectorSections() {
    return sections.filter((section) => dirtySections.has(section));
  }

  function flushInspector({ all = false } = {}) {
    if (all) markInspectorDirty(sections);
    const queue = getDirtyInspectorSections();
    if (!queue.length) return [];
    const renderers = getInspectorRenderers() || {};

    for (let index = 0; index < queue.length; index += 1) {
      const section = queue[index];
      dirtySections.delete(section);
      const render = renderers[section];
      if (typeof render !== 'function') continue;
      try {
        render();
      } catch (error) {
        queue.slice(index).forEach((pendingSection) => dirtySections.add(pendingSection));
        throw error;
      }
    }
    return queue;
  }

  function refreshInspectorSections(sectionOrSections) {
    if (sectionOrSections === undefined) return flushInspector({ all: true });
    markInspectorDirty(sectionOrSections);
    return flushInspector();
  }

  function renderInspector() {
    return refreshInspectorSections();
  }

  return {
    flushInspector,
    getDirtyInspectorSections,
    markInspectorDirty,
    mergeSession,
    refreshInspectorSections,
    renderInspector,
    replaceSession
  };
}
