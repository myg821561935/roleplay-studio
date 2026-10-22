export const TURN_VIEW_SNAPSHOT_SPEC = 'lra.turn-view-snapshot/v1';

export function buildTurnViewSnapshot({ session, assistantMessage, committedAt = new Date().toISOString() } = {}) {
  if (!assistantMessage || assistantMessage.role !== 'assistant') return null;
  const memory = session?.memory && typeof session.memory === 'object' ? session.memory : {};
  const turnFrame = assistantMessage.turnFrame?.validation?.status === 'accepted'
    ? assistantMessage.turnFrame
    : null;
  return {
    spec: TURN_VIEW_SNAPSHOT_SPEC,
    turnId: String(assistantMessage.id || ''),
    committedAt,
    revisions: {
      simulation: toRevision(memory.simulation?.revision),
      lightFrontend: toRevision(memory.lightFrontendState?.revision),
      events: Array.isArray(memory.eventLedger) ? memory.eventLedger.length : 0,
      facts: Array.isArray(memory.memoryCards) ? memory.memoryCards.length : 0
    },
    turnFrame: cloneValue(turnFrame),
    roleplayPanels: cloneValue(assistantMessage.roleplayPanels || {}),
    decisionNode: cloneValue(assistantMessage.decisionNode || turnFrame?.decision || null),
    recommendedActions: cloneValue(assistantMessage.recommendedActions || []),
    recommendedActionPresentation: cloneValue(assistantMessage.recommendedActionPresentation || null),
    worldBookActivation: cloneValue(assistantMessage.worldBookActivation || null)
  };
}

function toRevision(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function cloneValue(value) {
  if (value == null) return value;
  return structuredClone(value);
}
