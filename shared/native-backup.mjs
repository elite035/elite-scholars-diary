import { createReadStream, createWriteStream } from 'node:fs';
import { open, stat, appendFile, writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
function key() {
  const value = process.env.BACKUP_ENCRYPTION_KEY;
  if (!/^[a-f0-9]{64}$/.test(value || '')) throw Error('Backup encryption is not configured.');
  return Buffer.from(value, 'hex');
}
export async function sealNative(source, target) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key(), iv);
  await writeFile(target, Buffer.concat([Buffer.from('ESPG1'), iv]), { flag: 'wx', mode: 0o600 });
  await pipeline(source, cipher, createWriteStream(target, { flags: 'a', mode: 0o600 }));
  await appendFile(target, cipher.getAuthTag());
}
export async function decryptNative(target, destination) {
  const file = await open(target, 'r');
  let header, tag, size;
  try {
    size = (await file.stat()).size;
    if (size < 38) throw Error('Invalid native archive');
    header = Buffer.alloc(17);
    tag = Buffer.alloc(16);
    await file.read(header, 0, 17, 0);
    await file.read(tag, 0, 16, size - 16);
  } finally {
    await file.close();
  }
  if (header.subarray(0, 5).toString() !== 'ESPG1') throw Error('Invalid native archive');
  const decipher = createDecipheriv('aes-256-gcm', key(), header.subarray(5));
  decipher.setAuthTag(tag);
  await pipeline(createReadStream(target, { start: 17, end: size - 17 }), decipher, destination);
}
export async function verifyNative(target) {
  let plaintextArchiveBytes = 0,
    prefix = Buffer.alloc(0);
  await decryptNative(target, async (source) => {
    for await (const chunk of source) {
      plaintextArchiveBytes += chunk.length;
      if (prefix.length < 5) prefix = Buffer.concat([prefix, chunk]).subarray(0, 5);
    }
  });
  if (prefix.toString() !== 'PGDMP')
    throw Error('The decrypted archive is not PostgreSQL custom format');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(target)) hash.update(chunk);
  return { bytes: (await stat(target)).size, plaintextArchiveBytes, sha256: hash.digest('hex') };
}
