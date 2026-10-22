// Preview-only records: never run transforms a second time (macros may write variables).
export function createPromptChangeRecorder(enabled) {
  const rows = [];
  return {
    rows,
    record(stage, source, before, after, note = '') {
      if (!enabled) return after;
      const original = String(before ?? ''), result = String(after ?? '');
      rows.push({ stage, source, before: original, after: result, changed: original !== result, note });
      return after;
    }
  };
}
