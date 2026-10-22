export async function exportPromptComparison({ apiRequest, sessionId, content, documentObject = globalThis.document, urlApi = globalThis.URL }) {
  const bundle = await apiRequest(`/api/sessions/${encodeURIComponent(sessionId)}/prompt-preview`, {
    method: 'POST', body: { content, generationType: content ? 'normal' : 'continue', compareModes: true }
  });
  const blob = new Blob([JSON.stringify(bundle.comparison, null, 2)], { type: 'application/json' });
  const url = urlApi.createObjectURL(blob);
  const anchor = documentObject.createElement('a');
  anchor.href = url; anchor.download = 'roleplay-comparison.json';
  documentObject.body.append(anchor);
  try { anchor.click(); } finally { anchor.remove(); setTimeout(() => urlApi.revokeObjectURL(url), 1000); }
  return bundle.comparison;
}
