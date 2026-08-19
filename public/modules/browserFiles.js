export function inferMimeType(fileName) {
  const name = String(fileName || '').toLowerCase();
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.yaml') || name.endsWith('.yml')) return 'text/yaml';
  if (name.endsWith('.txt') || name.endsWith('.md')) return 'text/plain';
  if (name.endsWith('.charx')) return 'application/zip';
  return 'application/json';
}

export function downloadJsonFile(payload, fileName, {
  BlobClass = globalThis.Blob,
  documentObject = globalThis.document,
  urlObject = globalThis.URL
} = {}) {
  if (
    typeof BlobClass !== 'function'
    || typeof documentObject?.createElement !== 'function'
    || typeof documentObject?.body?.append !== 'function'
    || typeof urlObject?.createObjectURL !== 'function'
    || typeof urlObject?.revokeObjectURL !== 'function'
  ) {
    throw new TypeError('browser download boundary unavailable');
  }

  const blob = new BlobClass(
    [JSON.stringify(payload, null, 2)],
    { type: 'application/json' }
  );
  const url = urlObject.createObjectURL(blob);
  const anchor = documentObject.createElement('a');

  try {
    anchor.href = url;
    anchor.download = fileName;
    documentObject.body.append(anchor);
    anchor.click();
  } finally {
    anchor.remove?.();
    urlObject.revokeObjectURL(url);
  }
}
