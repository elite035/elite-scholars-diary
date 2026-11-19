// Both HTTP runtimes use byte-based limits and decode UTF-8 once after assembly.
const invalid = (message, status = 400) => {
  throw Object.assign(Error(message), { status });
};
export async function readJsonBody(
  req,
  { maxBytes = 8 * 1024 * 1024, parsedMaxBytes = maxBytes } = {},
) {
  maxBytes = Math.min(maxBytes, parsedMaxBytes);
  let value;
  if (req.body !== undefined) {
    if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) {
      const bytes = Buffer.from(req.body);
      if (bytes.length > maxBytes) invalid('Request too large', 413);
      try {
        value = JSON.parse(bytes.toString('utf8') || '{}');
      } catch {
        invalid('Invalid JSON request');
      }
    } else {
      value = req.body;
      if (Buffer.byteLength(JSON.stringify(value) ?? '') > parsedMaxBytes)
        invalid('Request too large', 413);
    }
  } else {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > maxBytes) invalid('Request too large', 413);
      chunks.push(bytes);
    }
    try {
      value = JSON.parse(Buffer.concat(chunks, size).toString('utf8') || '{}');
    } catch {
      invalid('Invalid JSON request');
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalid('Request body must be a JSON object');
  const pending = [[value, 0]];
  let nodes = 0;
  while (pending.length) {
    const [item, depth] = pending.pop();
    if (++nodes > 100000 || depth > 32) invalid('Request is too complex');
    if (item && typeof item === 'object')
      for (const child of Object.values(item)) pending.push([child, depth + 1]);
  }
  return value;
}
export function validateQuery(query) {
  if (query.page !== undefined && !/^[1-9]\d{0,5}$/.test(query.page))
    invalid('Choose a valid page number');
  return query;
}
