export function chooseRecommendedActionPresentation(message = {}, presentation = {}) {
  const embeddedActions = Array.isArray(presentation?.recommendedActions)
    ? presentation.recommendedActions
    : [];
  const embeddedSource = String(presentation?.recommendedActionPresentation?.source || '');
  const embeddedChoicesAreAuthoritative = embeddedActions.length > 0
    && Boolean(embeddedSource)
    && embeddedSource !== 'model-recommendation-block';
  const storedActions = Array.isArray(message?.recommendedActions)
    ? message.recommendedActions
    : [];
  const storedPresentation = message?.recommendedActionPresentation || null;
  const storedSource = String(storedPresentation?.source || '');
  const suppressedLegacyActions = storedActions.length > 0
    && !embeddedChoicesAreAuthoritative
    && (
      embeddedSource === 'model-recommendation-block'
      ||
      storedSource === 'model-recommendation-block'
      || (Boolean(message?.decisionNode) && !storedSource)
    );
  return {
    actions: embeddedChoicesAreAuthoritative
      ? embeddedActions
      : suppressedLegacyActions
        ? []
        : storedActions.length
          ? storedActions
        : embeddedActions,
    presentation: embeddedChoicesAreAuthoritative
      ? presentation.recommendedActionPresentation
      : suppressedLegacyActions
        ? null
        : storedPresentation
  };
}

export function normalizeRecommendedActionPresentation(value, fallback) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const title = String(value.title || '').replace(/\s+/gu, ' ').trim().slice(0, 32);
  const hint = String(value.hint || '').replace(/\s+/gu, ' ').trim().slice(0, 240);
  return {
    ...fallback,
    title: title || fallback.title,
    hint: hint || fallback.hint,
    source: String(value.source || '').trim().slice(0, 48)
  };
}
