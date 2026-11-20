import test from 'node:test';
import assert from 'node:assert/strict';
import { migrate, readMigrations } from '../scripts/migrate.mjs';

function fakeDatabase(done = []) {
  const executed = [],
    applied = new Set(done);
  return {
    executed,
    exec: async (sql) => {
      executed.push(sql);
      for (const m of sql.matchAll(/VALUES \('([^']+)'/g)) applied.add(m[1]);
    },
    query: async () => [...applied].map((name) => ({ name })),
  };
}
const files = [
  { name: '0002_second.sql', sql: 'SELECT 2;' },
  { name: '0001_first.sql', sql: 'SELECT 1;' },
];

test('migrations run once each, in name order, inside a transaction', async () => {
  const db = fakeDatabase(),
    log = () => {};
  assert.deepEqual(await migrate({ ...db, files, log }), ['0001_first.sql', '0002_second.sql']);
  const runs = db.executed.filter((sql) => sql.startsWith('BEGIN'));
  assert.equal(runs.length, 2);
  assert.ok(runs[0].includes('SELECT 1;') && runs[0].endsWith('COMMIT;'));
  assert.deepEqual(await migrate({ ...db, files, log }), [], 'a second run changes nothing');
});
test('already applied migrations are skipped', async () => {
  const db = fakeDatabase(['0001_first.sql']);
  assert.deepEqual(await migrate({ ...db, files, log: () => {} }), ['0002_second.sql']);
});
test('unsafe file names are refused before anything runs', async () => {
  const db = fakeDatabase();
  await assert.rejects(
    migrate({ ...db, files: [{ name: "x'; DROP TABLE users;--.sql", sql: '' }], log: () => {} }),
    /Bad migration file name/,
  );
  assert.equal(db.executed.length, 0);
});
test('the shipped migrations are named correctly and non-empty', async () => {
  const shipped = await readMigrations();
  assert.ok(shipped.length >= 2);
  for (const m of shipped) assert.ok(/^\d{4}_[a-z0-9_]+\.sql$/.test(m.name) && m.sql.trim());
});
