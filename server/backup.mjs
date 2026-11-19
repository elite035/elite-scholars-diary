import {
  mkdirSync,
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  chmodSync,
} from 'node:fs';
import { resolve, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { db, dataDir, hash, now, all } from './db.mjs';
export function createBackup(destination) {
  const target = resolve(destination);
  if (target === dataDir || target.startsWith(dataDir + '/'))
    throw Error('Store backups outside the live data directory.');
  if (existsSync(target) && readdirSync(target).length)
    throw Error('Backup destination must be empty.');
  mkdirSync(join(target, 'files'), { recursive: true, mode: 0o700 });
  const database = join(target, 'diary.sqlite');
  db.exec(`VACUUM INTO '${database.replaceAll("'", "''")}'`);
  chmodSync(database, 0o600);
  const snapshotDb = new DatabaseSync(database, { readOnly: true });
  const attachmentRows = snapshotDb.prepare('SELECT object_key,checksum FROM attachments').all();
  snapshotDb.close();
  const files = [];
  for (const f of attachmentRows) {
    const path = join(dataDir, 'files', f.object_key),
      bytes = readFileSync(path);
    if (hash(bytes) !== f.checksum) throw Error('Live attachment checksum mismatch');
    copyFileSync(path, join(target, 'files', f.object_key));
    chmodSync(join(target, 'files', f.object_key), 0o600);
    files.push({ name: f.object_key, sha256: f.checksum });
  }
  const manifest = {
    version: 1,
    created_at: now(),
    databaseSha256: hash(readFileSync(database)),
    files,
  };
  writeFileSync(join(target, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
  return manifest;
}
export { verifyBackup, restoreBackup } from '../shared/local-recovery.mjs';
