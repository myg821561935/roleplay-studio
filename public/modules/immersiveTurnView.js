export function resolveLatestRoleplayPanels(messages, extractRoleplayPresentation, turnViewSnapshot = null) {
  if (isUsableTurnViewSnapshot(messages, turnViewSnapshot)) {
    const panels = turnViewSnapshot.roleplayPanels && typeof turnViewSnapshot.roleplayPanels === 'object'
      ? turnViewSnapshot.roleplayPanels
      : {};
    if (Object.keys(panels).length) return panels;
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'assistant' || message.contextExcluded === true || message.aborted === true) continue;
    const parsed = extractRoleplayPresentation(message.content);
    const materialized = message.roleplayPanels && typeof message.roleplayPanels === 'object'
      ? message.roleplayPanels
      : {};
    const recovered = parsed?.panels && typeof parsed.panels === 'object'
      ? parsed.panels
      : {};
    const panels = { ...recovered, ...materialized };
    if (Object.keys(panels).length) return panels;
  }
  return {};
}

export function resolveLatestTurnFrame(messages, turnViewSnapshot = null) {
  if (isUsableTurnViewSnapshot(messages, turnViewSnapshot)
    && turnViewSnapshot.turnFrame?.validation?.status === 'accepted') {
    return turnViewSnapshot.turnFrame;
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'assistant' || message.contextExcluded === true || message.aborted === true) continue;
    if (message?.turnFrame?.validation?.status === 'accepted') return message.turnFrame;
  }
  return null;
}

function isUsableTurnViewSnapshot(messages, snapshot) {
  if (!snapshot || snapshot.spec !== 'lra.turn-view-snapshot/v1' || !snapshot.turnId) return false;
  return (Array.isArray(messages) ? messages : []).some((message) => (
    message?.id === snapshot.turnId
    && message.role === 'assistant'
    && message.contextExcluded !== true
    && message.aborted !== true
  ));
}
