import { createRecommendedActionsViewNode } from './recommendedActionsView.js';

export function renderStreamingActionPreview({
  preview,
  presentation = {},
  state = {},
  documentObject = globalThis.document
} = {}) {
  preview?.actionsNode?.remove?.();
  if (preview) preview.actionsNode = null;
  const actions = Array.isArray(presentation.recommendedActions)
    ? presentation.recommendedActions
    : [];
  if (!preview?.node || actions.length < 2) return null;

  const actionsNode = createRecommendedActionsViewNode({
    actions,
    actionPresentation: presentation.recommendedActionPresentation,
    message: { content: presentation.content },
    roleplayPanels: presentation.panels,
    characterCard: state.config?.characterCard,
    session: state.session,
    documentObject
  });
  if (!actionsNode) return null;

  actionsNode.classList.add('is-streaming-preview');
  actionsNode.querySelectorAll('.recommendation-button, .recommendation-custom-input, .recommendation-custom-submit')
    .forEach((control) => { control.disabled = true; });
  preview.node.append(actionsNode);
  preview.actionsNode = actionsNode;
  return actionsNode;
}
