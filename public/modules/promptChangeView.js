export function renderPromptChanges(container, rows = [], documentObject = globalThis.document) {
  if (!container) return;
  container.replaceChildren();
  for (const row of rows) {
    const details = documentObject.createElement('details');
    const title = documentObject.createElement('summary');
    title.textContent = `${row.stage} · ${row.source} · ${row.changed ? '有变化' : '未变化'}`;
    details.append(title);
    if (row.note) { const note = documentObject.createElement('p'); note.textContent = row.note; details.append(note); }
    for (const [label, value] of [['处理前', row.before], ['处理后', row.after]]) {
      const heading = documentObject.createElement('strong'); heading.textContent = label;
      const pre = documentObject.createElement('pre'); pre.className = 'prompt-studio-request'; pre.textContent = value || '（空）';
      details.append(heading, pre);
    }
    container.append(details);
  }
}
