// Operator fallback independent of hosted backup-bucket availability.
import { writeFile, readFile, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const destination = process.argv[2];
if (!destination || !destination.endsWith('.esb'))
  throw Error('Supply a new private .esb destination outside public/.');
const target = resolve(destination),
  publicRoot = resolve('public');
if (target === publicRoot || target.startsWith(publicRoot + '/'))
  throw Error('Backups cannot be written to the public directory.');
process.umask(0o077);
const { buildCloudArchive, openBackup } = await import('../cloud/backup.mjs'),
  { db } = await import('../cloud/db.mjs');
try {
  const { bytes, payload } = await buildCloudArchive();
  await writeFile(target, bytes, { flag: 'wx', mode: 0o600 });
  await chmod(target, 0o600);
  const stored = await readFile(target);
  if (!stored.equals(bytes)) throw Error('Stored archive verification failed');
  openBackup(stored);
  const receipt = {
    createdAt: payload.createdAt,
    bytes: bytes.length,
    sha256: createHash('sha256').update(stored).digest('hex'),
    tables: Object.fromEntries(
      Object.entries(payload.tables).map(([name, rows]) => [name, rows.length]),
    ),
    files: payload.files.length,
    sessionsExcluded: true,
  };
  await writeFile(target + '.receipt.json', JSON.stringify(receipt, null, 2), {
    flag: 'wx',
    mode: 0o600,
  });
  console.log(
    JSON.stringify({
      verified: true,
      createdAt: receipt.createdAt,
      bytes: receipt.bytes,
      sha256: receipt.sha256,
      tables: Object.keys(receipt.tables).length,
      files: receipt.files,
      sessionsExcluded: true,
    }),
  );
} finally {
  await db.close();
}
