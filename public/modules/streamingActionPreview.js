export function renderStreamingActionPreview({
  preview,
  documentObject = globalThis.document
} = {}) {
  if (!preview?.node || !documentObject?.createElement) return null;
  if (preview.actionsNode?.dataset?.streamingActionStatus === 'true') {
    return preview.actionsNode;
  }
  preview.actionsNode?.remove?.();

  const actionsNode = documentObject.createElement('section');
  actionsNode.className = 'streaming-action-status recommended-actions narrative-choice-panel is-streaming-preview';
  actionsNode.dataset.streamingActionStatus = 'true';
  actionsNode.setAttribute('role', 'status');
  actionsNode.setAttribute('aria-live', 'polite');

  const heading = documentObject.createElement('strong');
  heading.className = 'recommended-actions-label';
  heading.textContent = '下一步行动';
  const copy = documentObject.createElement('span');
  copy.className = 'streaming-action-copy';
  copy.textContent = '正文已完成，正在校验当前局势与可执行行动…';
  const skeleton = documentObject.createElement('span');
  skeleton.className = 'streaming-action-skeleton';
  skeleton.setAttribute('aria-hidden', 'true');
  actionsNode.append(heading, copy, skeleton);
  preview.node.append(actionsNode);
  preview.actionsNode = actionsNode;
  return actionsNode;
}
