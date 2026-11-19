import { mkdirSync, existsSync, readdirSync, readFileSync, copyFileSync, chmodSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function verifyBackup(source) {
  const folder = resolve(source),
    manifest = JSON.parse(readFileSync(join(folder, 'manifest.json')));
  if (
    manifest.version !== 1 ||
    hash(readFileSync(join(folder, 'diary.sqlite'))) !== manifest.databaseSha256
  )
    throw Error('Backup database checksum mismatch');
  for (const f of manifest.files) {
    if (
      !/^[a-f0-9-]+\.bin$/.test(f.name) ||
      hash(readFileSync(join(folder, 'files', f.name))) !== f.sha256
    )
      throw Error('Backup attachment checksum mismatch');
  }
  const testDb = new DatabaseSync(join(folder, 'diary.sqlite'), { readOnly: true });
  try {
    const integrity = testDb.prepare('PRAGMA integrity_check').get();
    if (Object.values(integrity)[0] !== 'ok') throw Error('Backup integrity check failed');
    if (testDb.prepare('PRAGMA foreign_key_check').all().length)
      throw Error('Backup has broken foreign keys');
  } finally {
    testDb.close();
  }
  return manifest;
}
export function restoreBackup(source, destination) {
  const manifest = verifyBackup(source),
    target = resolve(destination);
  if (existsSync(target) && readdirSync(target).length)
    throw Error(
      'Restore destination must be empty. Stop the server and use a fresh data directory.',
    );
  mkdirSync(join(target, 'files'), { recursive: true, mode: 0o700 });
  copyFileSync(join(source, 'diary.sqlite'), join(target, 'diary.sqlite'));
  chmodSync(join(target, 'diary.sqlite'), 0o600);
  for (const f of manifest.files)
    copyFileSync(join(source, 'files', f.name), join(target, 'files', f.name));
  const restored = new DatabaseSync(join(target, 'diary.sqlite'));
  restored.exec('DELETE FROM sessions');
  restored.close();
  return manifest;
}
