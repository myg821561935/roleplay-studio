export async function readJson(req, { maxBytes = 32 * 1024 * 1024 } = {}) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) {
      const error = new Error('REQUEST_BODY_TOO_LARGE');
      error.statusCode = 413;
      error.code = 'REQUEST_BODY_TOO_LARGE';
      throw error;
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks, size).toString('utf8');
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

export function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}
