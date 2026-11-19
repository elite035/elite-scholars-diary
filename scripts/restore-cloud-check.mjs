// Rehearse restoration in a new PostgreSQL schema and roll it back; live rows are never changed.
import postgres from 'postgres';
import { readFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { backupTables, readCloudBackup, openBackup } from '../cloud/backup.mjs';
import { putFile, getFile, removeFile } from '../cloud/storage.mjs';
const state = JSON.parse(
  await readFile(new URL('../.env.provision-state.json', import.meta.url), 'utf8'),
);
const key = process.argv[2];
if (!key) throw Error('Supply the generated backup object name.');
const payload = key.includes('/')
  ? openBackup(await readFile(key))
  : (await readCloudBackup(key)).payload;
const url = new URL(process.env.DATABASE_URL);
url.username = `postgres.${state.ref}`;
url.password = state.dbPassword;
const sql = postgres(url.toString(), {
  ssl: 'require',
  prepare: false,
  max: 1,
  connect_timeout: 15,
  onnotice: () => {},
});
const schema = 'elite_restore_check_' + randomUUID().replaceAll('-', '');
const rollback = Error('Restore check completed; rollback the temporary schema');
let counts = {};
try {
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(
        (await readFile(new URL('../cloud/schema.sql', import.meta.url), 'utf8')).replaceAll(
          'elite_diary',
          schema,
        ),
      );
      await tx.unsafe(
        (
          await readFile(new URL('../cloud/enhancements-schema.sql', import.meta.url), 'utf8')
        ).replaceAll('elite_diary', schema),
      );
      await tx.unsafe(
        (await readFile(new URL('../cloud/school-schema.sql', import.meta.url), 'utf8')).replaceAll(
          'elite_diary',
          schema,
        ),
      );
      await tx.unsafe(
        'TRUNCATE ' + backupTables.map((t) => `"${schema}"."${t}"`).join(',') + ' CASCADE',
      );
      for (const table of backupTables) {
        let rows = payload.tables[table];
        if (!Array.isArray(rows)) {
          if (
            ['account_security', 'branding_assets'].includes(table) ||
            Number(payload.tables.migrations?.at(-1)?.version || 0) < 4
          )
            rows = [];
          else throw Error('A backup table is missing.');
        }
        if (table === 'academics') {
          const ordered = [],
            pending = [...rows],
            seen = new Set();
          while (pending.length) {
            const i = pending.findIndex((r) => !r.parent_id || seen.has(r.parent_id));
            if (i < 0) throw Error('Academic hierarchy is cyclic');
            const [r] = pending.splice(i, 1);
            ordered.push(r);
            seen.add(r.id);
          }
          rows = ordered;
        }
        for (const row of rows) {
          const columns = Object.keys(row);
          if (!columns.every((c) => /^[a-z_][a-z_0-9]*$/.test(c)))
            throw Error('Invalid backup column');
          await tx.unsafe(
            `INSERT INTO "${schema}"."${table}" (${columns.map((c) => '"' + c + '"').join(',')}) VALUES (${columns.map((_, i) => '$' + (i + 1)).join(',')})`,
            columns.map((c) => row[c]),
          );
        }
        const [actual] = await tx.unsafe(`SELECT count(*) AS n FROM "${schema}"."${table}"`);
        if (Number(actual.n) !== rows.length) throw Error('Restored row count mismatch');
        counts[table] = rows.length;
      }
      const [sessions] = await tx.unsafe(`SELECT count(*) AS n FROM "${schema}".sessions`);
      if (Number(sessions.n) !== 0) throw Error('Restored sessions must be revoked');
      await tx.unsafe('SET CONSTRAINTS ALL IMMEDIATE');
      throw rollback;
    });
  } catch (e) {
    if (e !== rollback) throw e;
  }
  const [remaining] = await sql`SELECT count(*) n FROM pg_namespace WHERE nspname=${schema}`;
  if (Number(remaining.n) !== 0) throw Error('Temporary restore schema was not rolled back');
  for (const file of payload.files) {
    const bytes = Buffer.from(file.data, 'base64');
    if (createHash('sha256').update(bytes).digest('hex') !== file.checksum)
      throw Error('Archived file checksum mismatch');
    const object = randomUUID() + '.bin';
    try {
      await putFile(object, bytes, file.mime);
      if (!(await getFile(object)).equals(bytes)) throw Error('Restored storage bytes differ');
    } finally {
      await removeFile(object);
    }
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        backup: key,
        tables: counts,
        filesRestoredAndVerified: payload.files.length,
        sessionsRevoked: true,
        temporarySchemaRolledBack: true,
      },
      null,
      2,
    ),
  );
} finally {
  await sql.end({ timeout: 2 });
}
