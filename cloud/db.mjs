import { USER_COLUMNS } from '../shared/user-columns.mjs';
import { passwordHashAsync } from '../shared/passwords.mjs';
import { timedQuery } from '../shared/telemetry.mjs';
export { passwordHashAsync, passwordValidAsync } from '../shared/passwords.mjs';
import postgres from 'postgres';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID, randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
const context = new AsyncLocalStorage(),
  transactions = new AsyncLocalStorage();
let client;
const isTest = process.env.NODE_ENV === 'test' && process.env.CLOUD_TEST_PGLITE === 'true';
let pgTest, testSettings;
if (isTest) {
  const { PGlite } = await import('@electric-sql/pglite');
  const { readFile } = await import('node:fs/promises');
  pgTest = new PGlite();
  await pgTest.exec(
    'CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);',
  );
  await pgTest.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  await pgTest.exec(await readFile(new URL('./enhancements-schema.sql', import.meta.url), 'utf8'));
  await pgTest.exec(await readFile(new URL('./media-schema.sql', import.meta.url), 'utf8'));
  await pgTest.exec(await readFile(new URL('./school-schema.sql', import.meta.url), 'utf8'));
  testSettings = JSON.parse(
    (await pgTest.query('SELECT value FROM elite_diary.settings WHERE id=1')).rows[0].value,
  );
}

const tables = new Set([
  'account_security',
  'branding_assets',
  'subject_priorities',
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
  'user_handles',
  'class_subjects',
  'teacher_reviewers',
  'connections',
  'user_blocks',
  'conversations',
  'conversation_members',
  'membership_events',
  'chat_messages',
  'chat_media',
  'communication_reports',
  'migrations',
  'settings',
  'users',
  'sessions',
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
]);
export const dataDir = null;
export const db = {
  close: async () => {
    if (pgTest) await pgTest.close();
    else if (client) await client.end();
  },
};
export const id = () => randomUUID(),
  now = () => new Date().toISOString(),
  json = (x) => (typeof x === 'string' ? JSON.parse(x) : x),
  hash = (x) => createHash('sha256').update(x).digest('hex');
function connect() {
  if (!client) {
    if (!process.env.DATABASE_URL)
      throw Object.assign(Error('Cloud database has not been configured.'), { status: 503 });
    client = postgres(process.env.DATABASE_URL, {
      prepare: false,
      max: 3,
      idle_timeout: 20,
      connect_timeout: 15,
      ssl: 'require',
    });
  }
  return client;
}
function sqlText(input, bindings) {
  let index = 0;
  let sql = input.replace(/'([^']|'')*'|"([^"]|"")*"|\?|[A-Za-z_][A-Za-z_0-9]*/g, (token) =>
    token[0] === "'" || token[0] === '"'
      ? token
      : token === '?'
        ? '$' + ++index
        : tables.has(token)
          ? 'elite_diary.' + token
          : token,
  );
  if (index !== bindings)
    throw Error('SQL binding count mismatch: expected ' + index + ', received ' + bindings);
  const ignore = /INSERT OR IGNORE/i.test(sql);
  sql = sql.replace(/INSERT OR IGNORE/gi, 'INSERT').replace(/ COLLATE NOCASE/gi, '');
  if (ignore) sql += ' ON CONFLICT DO NOTHING';
  return sql;
}
export async function all(sql, ...args) {
  const rows = await timedQuery(sql, async () =>
    pgTest
      ? (await pgTest.query(sqlText(sql, args.length), args)).rows
      : await (transactions.getStore() || connect()).unsafe(sqlText(sql, args.length), args),
  );
  return rows.map((row) => ({
    ...row,
    ...(typeof row.n === 'string' ? { n: Number(row.n) } : {}),
  }));
}
export async function one(sql, ...args) {
  return (await all(sql, ...args))[0];
}
export async function run(sql, ...args) {
  return timedQuery(sql, async () => {
    if (pgTest) {
      const result = await pgTest.query(sqlText(sql, args.length), args);
      return { changes: result.affectedRows };
    }
    const rows = await (transactions.getStore() || connect()).unsafe(
      sqlText(sql, args.length),
      args,
    );
    return { changes: rows.count };
  });
}
export async function transaction(fn) {
  if (transactions.getStore()) return fn();
  if (pgTest) {
    await pgTest.exec('BEGIN');
    try {
      const result = await transactions.run(pgTest, fn);
      await pgTest.exec('COMMIT');
      return result;
    } catch (e) {
      await pgTest.exec('ROLLBACK');
      throw e;
    }
  }
  return connect().begin('isolation level serializable', (sql) => transactions.run(sql, fn));
}
export function settings() {
  const value = context.getStore()?.settings || (isTest ? testSettings : null);
  if (!value) throw Error('Request configuration is unavailable');
  return value;
}
export async function withRequestContext(fn) {
  const row = await one('SELECT value FROM settings WHERE id=1');
  const value = { ...json(row.value), uploadMaxBytes: 3145728 };
  if (isTest) testSettings = value;
  return context.run({ settings: value }, fn);
}
export function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + scryptSync(password, salt, 64).toString('hex');
}
export function passwordValid(password, stored) {
  try {
    const [salt, key] = stored.split(':');
    const a = scryptSync(password, salt, 64),
      b = Buffer.from(key, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
export async function audit(actor, action, resource, details = {}) {
  await run(
    'INSERT INTO audit VALUES(?,?,?,?,?,?)',
    id(),
    actor?.id || null,
    action,
    resource || null,
    JSON.stringify(details),
    now(),
  );
}
export async function notify(user, diary, message, key) {
  await run(
    'INSERT OR IGNORE INTO notifications(id,user_id,diary_id,message,dedupe_key,created_at) VALUES(?,?,?,?,?,?)',
    id(),
    user,
    diary,
    message,
    key,
    now(),
  );
}
export function publicUser(u) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    permissions: json(u.permissions),
    active: !!u.active,
  };
}
export async function createUser({ name, email, password, role = 'teacher', permissions = [] }) {
  const uid = id(),
    t = now();
  await run(
    'INSERT INTO users VALUES(?,?,?,?,?,?,1,?,?)',
    uid,
    name,
    email.toLowerCase(),
    await passwordHashAsync(password),
    role,
    JSON.stringify(permissions),
    t,
    t,
  );
  await run(
    'INSERT OR IGNORE INTO user_handles VALUES(?,?,?)',
    uid,
    'u_' + uid.replaceAll('-', ''),
    t,
  );
  return one(`SELECT ${USER_COLUMNS} FROM users WHERE id=?`, uid);
}

// List/report reads exclude repeated school branding; detail/export reads keep original snapshots.
export const schoolDiarySummaryColumns =
  "id,teacher_id,head_id,section_id,diary_date,language,status,version,content,quote_payload,remarks,submitted_at,reviewed_at,created_at,updated_at,(snapshot::jsonb - 'school')::text AS snapshot";

export const dialect = 'postgres';
