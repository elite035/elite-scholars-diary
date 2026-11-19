import { encodeBackupPayload, decodeBackupPayload, backupLimit } from './backup-codec.mjs';
export { maxBackupPlaintextBytes } from './backup-codec.mjs';
import { randomBytes, randomUUID, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { all, transaction } from './db.mjs';
import { getFile } from './storage.mjs';
export const backupTables = [
  'migrations',
  'settings',
  'users',
  'academics',
  'coordinator_heads',
  'assignments',
  'calendar_exceptions',
  'quotes',
  'quote_schedules',
  'diaries',
  'diary_versions',
  'reviews',
  'attachments',
  'notifications',
  'audit',
  'template_versions',
  'assignment_state_events',
  'rate_limits',
  'user_handles',
  'class_subjects',
  'teacher_reviewers',
  'connections',
  'user_blocks',
  'conversations',
  'conversation_members',
  'membership_events',
  'chat_messages',
  'communication_reports',
  'school_nodes',
  'class_campuses',
  'section_subjects',
  'parent_sections',
  'role_capabilities',
  'user_capabilities',
  'school_diaries',
  'school_diary_versions',
  'push_subscriptions',
  'push_preferences',
  'push_deliveries',
  'subject_priorities',
  'account_security',
  'branding_assets',
];
const bucket = 'elite-scholars-backups';
const sha = (b) => createHash('sha256').update(b).digest('hex');
function encryptionKey() {
  const key = process.env.BACKUP_ENCRYPTION_KEY;
  if (!/^[a-f0-9]{64}$/.test(key || ''))
    throw Object.assign(Error('Backup encryption is not configured'), { status: 503 });
  return Buffer.from(key, 'hex');
}
export function sealBackup(payload, { maxBytes } = {}) {
  const { magic, plaintext } = encodeBackupPayload(payload, { maxBytes });
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const bytes = Buffer.concat([cipher.update(gzipSync(plaintext)), cipher.final()]);
  return Buffer.concat([Buffer.from(magic), iv, cipher.getAuthTag(), bytes]);
}
export function openBackup(bytes, { maxBytes } = {}) {
  const magic = bytes.subarray(0, 5).toString();
  if (!['ESSB1', 'ESSB2'].includes(magic)) throw Error('Unknown backup format');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), bytes.subarray(5, 17));
  decipher.setAuthTag(bytes.subarray(17, 33));
  const payload = decodeBackupPayload(
    gunzipSync(Buffer.concat([decipher.update(bytes.subarray(33)), decipher.final()]), {
      maxOutputLength: backupLimit(maxBytes),
    }),
    magic,
    { maxBytes },
  );
  if (
    payload.format !== 'elite-scholars-cloud-backup' ||
    payload.version !== 1 ||
    !payload.tables ||
    !Array.isArray(payload.files)
  )
    throw Error('Invalid backup');
  return payload;
}
export async function backupStorage(path, options = {}) {
  const response = await fetch(process.env.SUPABASE_URL + '/storage/v1/' + path, {
    ...options,
    signal: options.signal || AbortSignal.timeout(20000),
    headers: {
      apikey: process.env.SUPABASE_SECRET_KEY,
      Authorization: 'Bearer ' + process.env.SUPABASE_SECRET_KEY,
      ...options.headers,
    },
  });
  if (response.status === 402)
    throw Object.assign(
      Error(
        'Backup storage is restricted by the hosting provider. The project owner must resolve the storage quota or billing restriction.',
      ),
      { status: 503, code: 'STORAGE_RESTRICTED' },
    );
  if (!response.ok)
    throw Object.assign(Error('Backup storage request failed (' + response.status + ')'), {
      status: 502,
    });
  return response;
}
export async function readCloudBackup(key) {
  if (!/^backup-[\w.-]+\.esb$/.test(key)) throw Error('Invalid backup key');
  const bytes = Buffer.from(
    await (await backupStorage('object/' + bucket + '/' + key)).arrayBuffer(),
  );
  return { bytes, payload: openBackup(bytes) };
}
export async function buildCloudArchive() {
  encryptionKey();
  const tables = await transaction(async () => {
    const snapshot = {},
      version = Math.max(
        ...(await all('SELECT version FROM migrations')).map((x) => Number(x.version)),
      );
    const newer = new Set([
      'school_nodes',
      'class_campuses',
      'section_subjects',
      'parent_sections',
      'role_capabilities',
      'user_capabilities',
      'school_diaries',
      'school_diary_versions',
      'push_subscriptions',
      'push_preferences',
      'push_deliveries',
    ]);
    const hasPriorities =
      (
        await all(
          "SELECT 1 FROM information_schema.tables WHERE table_schema='elite_diary' AND table_name='subject_priorities'",
        )
      ).length > 0;
    const securityTables = new Set(
      (
        await all(
          "SELECT table_name FROM information_schema.tables WHERE table_schema='elite_diary' AND table_name IN('account_security','branding_assets')",
        )
      ).map((row) => row.table_name),
    );
    let estimated = 0;
    for (const table of backupTables) {
      if (
        (['account_security', 'branding_assets'].includes(table) && !securityTables.has(table)) ||
        (table === 'subject_priorities' && !hasPriorities) ||
        (version < 4 && newer.has(table))
      )
        continue;
      const row = (
        await all(
          'SELECT COALESCE(SUM(octet_length(to_jsonb(t)::text)),0) bytes FROM ' + table + ' t',
        )
      )[0];
      estimated += Number(row.bytes);
      if (estimated > backupLimit() * 0.75)
        throw Object.assign(
          Error(
            'Database snapshot exceeds the hosted memory budget. Use a database-native operator archive; do not raise the serverless limit.',
          ),
          { status: 413 },
        );
    }
    const attachmentEstimate = (
      await all('SELECT COALESCE(SUM(size),0) bytes FROM attachments')
    )[0];
    if (Number(attachmentEstimate.bytes) > 32 * 1024 * 1024)
      throw Object.assign(
        Error('Attachments exceed the hosted recovery budget. Use an operator archive.'),
        { status: 413 },
      );
    for (const table of backupTables)
      snapshot[table] =
        ['account_security', 'branding_assets'].includes(table) && !securityTables.has(table)
          ? []
          : (table === 'subject_priorities' && !hasPriorities) || (version < 4 && newer.has(table))
            ? []
            : await all('SELECT * FROM ' + table);
    return snapshot;
  });
  const files = [];
  let total = 0;
  for (const attachment of tables.attachments) {
    const bytes = await getFile(attachment.object_key);
    if (sha(bytes) !== attachment.checksum) throw Error('Backup attachment checksum mismatch');
    total += bytes.length;
    if (total > 32 * 1024 * 1024)
      throw Object.assign(
        Error(
          'Backup exceeds the current 32 MB attachment limit; run the operator backup before continuing',
        ),
        { status: 413 },
      );
    files.push({
      key: attachment.object_key,
      checksum: attachment.checksum,
      mime: attachment.mime,
      data: bytes.toString('base64'),
    });
  }
  const payload = {
    format: 'elite-scholars-cloud-backup',
    version: 1,
    createdAt: new Date().toISOString(),
    sessionsExcluded: true,
    tables,
    files,
  };
  const bytes = sealBackup(payload);
  if (bytes.length > 48 * 1024 * 1024)
    throw Object.assign(Error('Backup is too large; run an operator backup'), { status: 413 });
  return { bytes, payload };
}
export async function createCloudBackup() {
  const { bytes, payload } = await buildCloudArchive();
  const tables = payload.tables,
    files = payload.files;
  const key = 'backup-' + payload.createdAt.replace(/[:.]/g, '-') + '-' + randomUUID() + '.esb';
  await backupStorage('object/' + bucket + '/' + key, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: bytes,
  });
  const stored = Buffer.from(
    await (await backupStorage('object/' + bucket + '/' + key)).arrayBuffer(),
  );
  if (sha(stored) !== sha(bytes)) throw Error('Stored backup checksum mismatch');
  openBackup(stored);
  // Only this dedicated bucket's generated archives are eligible for seven-day rotation.
  const list = await (
    await backupStorage('object/list/' + bucket, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prefix: '',
        limit: 1000,
        sortBy: { column: 'created_at', order: 'desc' },
      }),
    })
  ).json();
  const cutoff = Date.now() - 7 * 86400000;
  const old = list
    .filter(
      (item) =>
        /^backup-[\w.-]+\.esb$/.test(item.name) && new Date(item.created_at).getTime() < cutoff,
    )
    .map((item) => item.name);
  if (old.length)
    await backupStorage('object/' + bucket, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: old }),
    });
  return {
    key,
    bytes: bytes.length,
    sha256: sha(bytes),
    tables: backupTables.length,
    files: files.length,
    createdAt: payload.createdAt,
  };
}
