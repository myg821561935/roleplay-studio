// Balanced macro evaluation: source order, opaque comments and lazy conditional branches.
export function assertMacroSourceLength(text) {
  if (text.length > 1_000_000) throw limitError();
}

export function expandNestedMacros(text, context, resolve, state = { steps: 0, active: new Set() }, depth = 0) {
  if (depth > 24 || text.length > 1_000_000) throw limitError();
  let output = '', cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf('{{', cursor);
    if (start < 0) { output += text.slice(cursor); break; }
    output += text.slice(cursor, start);
    const end = findEnd(text, start);
    const raw = text.slice(start + 2, end < 0 ? undefined : end - 2).trim();
    const comment = raw.startsWith('//') || raw.startsWith('!--');
    if (end < 0) { if (!comment) output += text.slice(start); break; }
    const full = text.slice(start, end);
    cursor = end;
    if (comment) continue;
    if (++state.steps > 10000) throw limitError();
    if (state.active.has(raw)) { output += full; continue; }
    state.active.add(raw);
    try {
      const parts = splitArguments(raw);
      let value;
      if (parts[0].toLowerCase() === 'if' && parts.length > 1) {
        const condition = expandNestedMacros(parts[1], context, resolve, state, depth + 1).trim().toLowerCase();
        const truthy = condition && !['false', '0', 'null', 'undefined'].includes(condition);
        value = expandNestedMacros(parts[truthy ? 2 : 3] || '', context, resolve, state, depth + 1);
        // Branch output has already been evaluated; do not replay side effects.
      } else {
        const body = expandNestedMacros(raw, context, resolve, state, depth + 1);
        value = resolve(body, context);
        if (value === null || value === undefined) value = full;
        else {
          value = String(value);
          if (value.includes('{{') && value !== full) value = expandNestedMacros(value, context, resolve, state, depth + 1);
        }
      }
      output += value;
      if (output.length > 1_000_000) throw limitError();
    } finally { state.active.delete(raw); }
  }
  if (output.length > 1_000_000) throw limitError();
  return output;
}

function findEnd(text, start) {
  let nesting = 1;
  for (let i = start + 2; i < text.length - 1; i++) {
    if (text.startsWith('{{', i)) { nesting++; i++; }
    else if (text.startsWith('}}', i)) { if (--nesting === 0) return i + 2; i++; }
  }
  return -1;
}

function splitArguments(body) {
  const parts = []; let nesting = 0, start = 0;
  for (let i = 0; i < body.length - 1; i++) {
    if (body.startsWith('{{', i)) { nesting++; i++; }
    else if (body.startsWith('}}', i)) { nesting--; i++; }
    else if (!nesting && body.startsWith('::', i)) { parts.push(body.slice(start, i)); start = i + 2; i++; }
  }
  parts.push(body.slice(start)); return parts;
}

function limitError() {
  const error = new Error('宏展开超过深度、次数或长度限制，请检查递归模板。');
  error.code = 'MACRO_EXPANSION_LIMIT'; return error;
}
