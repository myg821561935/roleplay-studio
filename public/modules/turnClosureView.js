const SNAPSHOT_SPEC = 'lra.turn-view-snapshot/v1';

export function resolveCommittedTurnMessage(message = {}, snapshot = null) {
  if (!isSnapshotForMessage(message, snapshot)) {
    return { message, committed: false };
  }
  const recommendedActions = Array.isArray(snapshot.recommendedActions)
    ? snapshot.recommendedActions
    : message.recommendedActions;
  return {
    committed: true,
    message: {
      ...message,
      turnFrame: snapshot.turnFrame || message.turnFrame,
      roleplayPanels: {
        ...(message.roleplayPanels || {}),
        ...(snapshot.roleplayPanels || {})
      },
      decisionNode: snapshot.decisionNode || message.decisionNode,
      recommendedActions,
      recommendedActionPresentation: snapshot.recommendedActionPresentation
        || message.recommendedActionPresentation,
      worldBookActivation: snapshot.worldBookActivation || message.worldBookActivation
    }
  };
}

export function createTurnClosureViewNode({
  message = {},
  actionsNode = null,
  auxiliaryPanelsNode = null,
  committed = false,
  documentObject = globalThis.document
} = {}) {
  if (!actionsNode && !auxiliaryPanelsNode && !committed) return null;

  const wrap = documentObject.createElement('section');
  wrap.className = 'turn-closure';
  if (committed) wrap.dataset.committedTurn = 'true';

  const context = createTurnContextNode(message, documentObject);
  if (context) wrap.append(context);
  if (actionsNode) wrap.append(actionsNode);

  const evidence = createTurnEvidenceNode(message, documentObject);
  if (evidence) wrap.append(evidence);
  if (auxiliaryPanelsNode) wrap.append(auxiliaryPanelsNode);
  return wrap;
}

function createTurnContextNode(message, documentObject) {
  const frame = acceptedTurnFrame(message);
  if (!frame) return null;
  const chips = [
    frame.scene?.location ? ['地点', frame.scene.location] : null,
    frame.scene?.time ? ['时间', frame.scene.time] : null,
    frame.scene?.presentActors?.length
      ? ['在场', frame.scene.presentActors.slice(0, 3).join('、')]
      : null
  ].filter(Boolean);
  if (!chips.length) return null;

  const strip = documentObject.createElement('div');
  strip.className = 'turn-context-strip';
  strip.setAttribute('aria-label', '本轮场景坐标');
  chips.forEach(([label, value]) => {
    const chip = documentObject.createElement('span');
    chip.className = 'turn-context-chip';
    const key = documentObject.createElement('span');
    key.className = 'turn-context-key';
    key.textContent = label;
    const copy = documentObject.createElement('span');
    copy.className = 'turn-context-value';
    copy.textContent = compact(value, 100);
    chip.append(key, copy);
    strip.append(chip);
  });
  return strip;
}

function createTurnEvidenceNode(message, documentObject) {
  const frame = acceptedTurnFrame(message);
  if (!frame) return null;
  const changes = [
    compact(frame.stateDelta?.summary, 240),
    ...safeArray(frame.stateDelta?.facts)
      .filter((entry) => entry?.status === 'confirmed')
      .map((entry) => compact(entry.text, 180))
  ].filter(Boolean).slice(0, 3);
  const evidence = safeArray(frame.evidence)
    .filter((entry) => entry?.status === 'confirmed')
    .map((entry) => compact(entry.text, 180))
    .filter(Boolean)
    .slice(0, 3);
  if (!changes.length && !evidence.length) return null;

  const wrap = documentObject.createElement('div');
  wrap.className = 'turn-evidence-strip';
  if (changes.length) wrap.append(createDetails(documentObject, '本轮变化', changes, 'turn-delta-details'));
  if (evidence.length) wrap.append(createDetails(documentObject, '行动依据', evidence, 'turn-basis-details'));
  return wrap;
}

function createDetails(documentObject, label, items, className) {
  const details = documentObject.createElement('details');
  details.className = `turn-evidence-details ${className}`;
  const summary = documentObject.createElement('summary');
  summary.textContent = `${label} · ${items.length}`;
  const list = documentObject.createElement('ul');
  items.forEach((item) => {
    const entry = documentObject.createElement('li');
    entry.textContent = item;
    list.append(entry);
  });
  details.append(summary, list);
  return details;
}

function acceptedTurnFrame(message) {
  const frame = message?.turnFrame;
  if (!frame || frame.validation?.status !== 'accepted') return null;
  return frame;
}

function isSnapshotForMessage(message, snapshot) {
  return Boolean(
    snapshot
    && snapshot.spec === SNAPSHOT_SPEC
    && snapshot.turnId
    && snapshot.turnId === message?.id
    && message?.role === 'assistant'
    && message?.contextExcluded !== true
    && message?.aborted !== true
  );
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function compact(value, limit) {
  return String(value || '').replace(/\s+/gu, ' ').trim().slice(0, limit);
}
