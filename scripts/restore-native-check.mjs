// Stream a native encrypted archive into a temporary remote schema, then roll it back.
import postgres from 'postgres';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { decryptNative, verifyNative } from '../shared/native-backup.mjs';
import { backupTables } from '../cloud/backup.mjs';
const archive = process.argv[2];
if (!archive) throw Error('Supply a private native .espg archive.');
const verified = await verifyNative(archive),
  state = JSON.parse(
    await readFile(new URL('../.env.provision-state.json', import.meta.url), 'utf8'),
  );
if (state.ref !== 'fpllvutoexblrwjbtnrl') throw Error('Unexpected project identity.');
const url = new URL(process.env.DATABASE_URL);
url.username = 'postgres.' + state.ref;
url.password = state.dbPassword;
const sql = postgres(url.toString(), {
    ssl: 'require',
    max: 1,
    prepare: false,
    connect_timeout: 20,
    onnotice: () => {},
  }),
  schema = 'elite_native_restore_' + randomUUID().replaceAll('-', ''),
  rollback = Error('Verified isolated restore; rollback'),
  counts = {};
let child;
async function* lines(source) {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  for await (const chunk of source) {
    pending += decoder.write(chunk);
    let end;
    while ((end = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, end);
      pending = pending.slice(end + 1);
      yield line;
    }
    if (pending.length > 8 * 1024 * 1024)
      throw Error('A restore row exceeds the bounded operator limit.');
  }
  pending += decoder.end();
  if (pending) yield pending;
}
try {
  try {
    await sql.begin(async (tx) => {
      for (const file of ['schema.sql', 'enhancements-schema.sql', 'school-schema.sql'])
        await tx.unsafe(
          (await readFile(new URL('../cloud/' + file, import.meta.url), 'utf8')).replaceAll(
            'elite_diary',
            schema,
          ),
        );
      const tables = await tx`SELECT tablename FROM pg_tables WHERE schemaname=${schema}`;
      await tx.unsafe(
        'TRUNCATE ' +
          tables.map((row) => '"' + schema + '"."' + row.tablename + '"').join(',') +
          ' CASCADE',
      );
      const constraints =
        await tx`SELECT c.conname,t.relname FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname=${schema} AND c.contype='f'`;
      for (const constraint of constraints)
        await tx.unsafe(
          'ALTER TABLE "' +
            schema +
            '"."' +
            constraint.relname +
            '" ALTER CONSTRAINT "' +
            constraint.conname +
            '" DEFERRABLE INITIALLY DEFERRED',
        );
      child = spawn('pg_restore', ['--data-only', '--no-owner', '--no-acl', '--file=-'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let messages = '';
      child.stderr.on('data', (chunk) => {
        if (messages.length < 2000) messages += chunk;
      });
      const completed = new Promise((yes, no) => {
        child.on('error', no);
        child.on('close', (code) =>
          code === 0 ? yes() : no(Error('pg_restore could not decode the native archive.')),
        );
      });
      completed.catch(() => {});
      const decoding = decryptNative(archive, child.stdin);
      decoding.catch(() => {});
      let copy, copyDone, table;
      for await (const line of lines(child.stdout)) {
        if (copy) {
          if (line === '\\.') {
            copy.end();
            await copyDone;
            copy = null;
            console.log('Restored ' + table + ': ' + counts[table] + ' rows');
          } else {
            if (!copy.write(line + '\n')) await once(copy, 'drain');
            counts[table]++;
          }
          continue;
        }
        const header = /^COPY elite_diary\.([a-z_]+) \(([a-z_, ]+)\) FROM stdin;$/.exec(line);
        if (header) {
          table = header[1];
          if (!backupTables.includes(table)) throw Error('Archive contains an unexpected table.');
          counts[table] = 0;
          copy = await tx
            .unsafe('COPY "' + schema + '"."' + table + '" (' + header[2] + ') FROM STDIN')
            .writable();
          copyDone = finished(copy);
          copyDone.catch(() => {});
        }
      }
      if (copy) throw Error('Archive ended during table restoration.');
      await decoding;
      await completed;
      for (const row of tables) {
        const [actual] = await tx.unsafe(
          'SELECT COUNT(*) n FROM "' + schema + '"."' + row.tablename + '"',
        );
        if (Number(actual.n) !== (counts[row.tablename] || 0))
          throw Error('Restored table count mismatch.');
      }
      await tx.unsafe('SET CONSTRAINTS ALL IMMEDIATE');
      for (const file of [
        '20261105224131_account_security_and_immutable_branding.sql',
        '20261105230431_preserve_academic_uniqueness.sql',
      ])
        await tx.unsafe(
          (
            await readFile(new URL('../supabase/migrations/' + file, import.meta.url), 'utf8')
          ).replaceAll('elite_diary', schema),
        );
      const [sessions] = await tx.unsafe('SELECT COUNT(*) n FROM "' + schema + '".sessions');
      if (Number(sessions.n) !== 0) throw Error('Restored sessions must be empty.');
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  const [remaining] = await sql`SELECT COUNT(*) n FROM pg_namespace WHERE nspname=${schema}`;
  if (Number(remaining.n) !== 0) throw Error('Isolated restore schema was not rolled back.');
  const receipt = {
    ok: true,
    checkedAt: new Date().toISOString(),
    archiveSha256: verified.sha256,
    tables: counts,
    sessionsRevoked: true,
    additiveMigrationsVerified: true,
    temporarySchemaRolledBack: true,
  };
  await writeFile(archive + '.restore.json', JSON.stringify(receipt, null, 2), {
    flag: 'wx',
    mode: 0o600,
  });
  console.log(JSON.stringify(receipt));
} finally {
  child?.kill();
  await sql.end();
}
