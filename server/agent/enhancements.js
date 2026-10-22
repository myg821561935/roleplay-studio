// Missing values inherit the existing execution mode; explicit choices are independent.
export function normalizeEnhancements(value = {}) {
  return Object.fromEntries(['memoryRecall', 'npcSimulation', 'plotGuidance', 'actionSuggestions']
    .filter(key => typeof value?.[key] === 'boolean').map(key => [key, value[key]]));
}
export function resolveEnhancements(options = {}, mode = 'enhanced') {
  return { memoryRecall: true, npcSimulation: true, plotGuidance: mode !== 'faithful',
    actionSuggestions: mode !== 'faithful', ...normalizeEnhancements(options.agentEnhancements) };
}
