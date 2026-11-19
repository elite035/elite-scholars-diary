const testFiles =
  process.env.NODE_ENV === 'test' && process.env.CLOUD_TEST_PGLITE === 'true' ? new Map() : null;
const bucket = 'elite-scholars-private';
function config() {
  const url = process.env.SUPABASE_URL,
    key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key)
    throw Object.assign(Error('Private attachment storage is not configured'), { status: 503 });
  return { url: url.replace(/\/$/, ''), key };
}
async function storage(method, key, body, mime) {
  if (!/^[a-f0-9-]+\.bin$/.test(key)) throw Error('Invalid storage key');
  const c = config();
  const response = await fetch(`${c.url}/storage/v1/object/${bucket}/${key}`, {
    method,
    signal: AbortSignal.timeout(20000),
    headers: {
      apikey: c.key,
      Authorization: `Bearer ${c.key}`,
      ...(mime ? { 'Content-Type': mime } : {}),
    },
    ...(body ? { body } : {}),
  });
  if (!response.ok) throw Object.assign(Error('Private storage request failed'), { status: 502 });
  return response;
}
export async function putFile(key, bytes, mime) {
  if (testFiles) {
    testFiles.set(key, Buffer.from(bytes));
    return;
  }
  await storage('POST', key, bytes, mime);
}
export async function getFile(key) {
  if (testFiles) return testFiles.get(key);
  return Buffer.from(await (await storage('GET', key)).arrayBuffer());
}
export async function removeFile(key) {
  if (testFiles) {
    testFiles.delete(key);
    return;
  }
  await storage('DELETE', key);
}
