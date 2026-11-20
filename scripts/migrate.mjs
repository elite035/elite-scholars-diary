// Applies database/migrations/*.sql to Postgres exactly once each, in name order.
// Run automatically by `npm run build` when MIGRATION_DATABASE_URL is set (use the database owner's
// connection string: the app's own role normally cannot change tables). Without it, this is skipped.
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const NAME = /^\d{4}_[a-z0-9_]+\.sql$/;
const TABLE = 'elite_diary.schema_migrations';

// `exec(sql)` runs statements; `query(sql)` returns rows. Kept free of any driver so it is testable.
export async function migrate({ exec, query, files, log = console.log }) {
  for (const { name } of files) if (!NAME.test(name)) throw Error('Bad migration file name: ' + name);
  await exec(
    `CREATE TABLE IF NOT EXISTS ${TABLE}(name TEXT PRIMARY KEY, applied_at TEXT NOT NULL);\nALTER TABLE ${TABLE} ENABLE ROW LEVEL SECURITY;`,
  );
  const done = new Set((await query(`SELECT name FROM ${TABLE}`)).map((row) => row.name)),
    applied = [];
  for (const { name, sql } of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    if (done.has(name)) continue;
    // One transaction per file: either the whole change and its record are saved, or neither.
    await exec(
      `BEGIN;\n${sql}\nINSERT INTO ${TABLE}(name, applied_at) VALUES ('${name}', '${new Date().toISOString()}');\nCOMMIT;`,
    );
    log('Applied migration ' + name);
    applied.push(name);
  }
  if (!applied.length) log('Database is up to date.');
  return applied;
}

export async function readMigrations(dir = new URL('../database/migrations/', import.meta.url)) {
  const names = (await readdir(dir)).filter((n) => n.endsWith('.sql')).sort();
  return Promise.all(names.map(async (name) => ({ name, sql: await readFile(new URL(name, dir), 'utf8') })));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) console.log('Migrations skipped: set MIGRATION_DATABASE_URL to apply them.');
  else {
    const { default: postgres } = await import('postgres'),
      sql = postgres(url, { prepare: false, max: 1, connect_timeout: 15, ssl: 'require' });
    try {
      await migrate({
        exec: (text) => sql.unsafe(text),
        query: (text) => sql.unsafe(text),
        files: await readMigrations(),
      });
    } catch (error) {
      console.error('Migration failed: ' + error.message);
      process.exitCode = 1;
    } finally {
      await sql.end();
    }
  }
}
