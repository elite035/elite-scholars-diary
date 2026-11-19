import { passwordHashAsync } from '../shared/passwords.mjs';
export { passwordHashAsync, passwordValidAsync } from '../shared/passwords.mjs';
import { AsyncLocalStorage } from 'node:async_hooks';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, chmodSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID, randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
export const dataDir = resolve(process.env.DATA_DIR || './var');
if (process.env.NODE_ENV === 'test' && (!process.env.DATA_DIR || dataDir === resolve('./var')))
  throw Error('Tests must select an isolated DATA_DIR before importing the database.');
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
export const db = new DatabaseSync(join(dataDir, 'diary.sqlite'));
chmodSync(join(dataDir, 'diary.sqlite'), 0o600);
db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));

// SQLite cannot alter a CHECK constraint; preserve all accounts while widening the role enum.
if (
  !db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'")
    .get()
    .sql.includes("'parent'")
) {
  const ddl = db
    .prepare("SELECT sql FROM sqlite_master WHERE name='users'")
    .get()
    .sql.replace('CREATE TABLE users', 'CREATE TABLE users_new')
    .replace("'head_teacher','teacher'", "'head_teacher','teacher','parent'");
  db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;');
  try {
    db.exec(ddl);
    db.exec(
      'INSERT INTO users_new SELECT * FROM users; DROP TABLE users; ALTER TABLE users_new RENAME TO users; COMMIT;',
    );
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    db.exec('PRAGMA foreign_keys=ON;');
  }
  if (db.prepare('PRAGMA foreign_key_check').all().length)
    throw Error('Account role migration failed foreign key validation');
}
db.exec(readFileSync(new URL('../shared/enhancements-schema.sql', import.meta.url), 'utf8'));
db.exec(readFileSync(new URL('../shared/school-schema.sql', import.meta.url), 'utf8'));
if (!db.prepare('PRAGMA table_info(account_security)').all().some((c) => c.name === 'password_enc'))
  db.exec('ALTER TABLE account_security ADD COLUMN password_enc TEXT');
export const id = () => randomUUID();
export const now = () => new Date().toISOString();
const transactionOwner = new AsyncLocalStorage();
let locked = false;
const waiting = [];
function accessible() {
  if (locked && !transactionOwner.getStore())
    throw Object.assign(
      Error('The database is completing another operation. Retry this read shortly.'),
      { status: 503 },
    );
}
export const one = (s, ...a) => {
  accessible();
  return db.prepare(s).get(...a);
};
export const all = (s, ...a) => {
  accessible();
  return db.prepare(s).all(...a);
};
export const run = (s, ...a) => {
  accessible();
  return db.prepare(s).run(...a);
};
// HTTP operations and background jobs share one connection; keep reads out of
// another operation's uncommitted transaction without changing legacy sync APIs.
let requestTail = Promise.resolve();
export function withDatabaseContext(fn) {
  const pending = requestTail.then(fn);
  requestTail = pending.catch(() => {});
  return pending;
}
export const json = (x) => JSON.parse(x);
export const hash = (x) => createHash('sha256').update(x).digest('hex');
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
export function transaction(fn) {
  if (locked && transactionOwner.getStore()) return fn();
  function execute() {
    locked = true;
    const release = () => {
      locked = false;
      const next = waiting.shift();
      if (next) next();
    };
    let value;
    try {
      db.exec('BEGIN IMMEDIATE');
      value = transactionOwner.run(Symbol('transaction'), fn);
    } catch (error) {
      try {
        if (db.isTransaction) db.exec('ROLLBACK');
      } finally {
        release();
      }
      throw error;
    }
    const commit = (result) => {
      try {
        db.exec('COMMIT');
        return result;
      } catch (error) {
        if (db.isTransaction) db.exec('ROLLBACK');
        throw error;
      } finally {
        release();
      }
    };
    const rollback = (error) => {
      try {
        if (db.isTransaction) db.exec('ROLLBACK');
      } finally {
        release();
      }
      throw error;
    };
    return value && typeof value.then === 'function'
      ? Promise.resolve(value).then(commit, rollback)
      : commit(value);
  }
  if (locked)
    return new Promise((resolve, reject) =>
      waiting.push(() => {
        try {
          resolve(execute());
        } catch (error) {
          reject(error);
        }
      }),
    );
  return execute();
}
export function settings() {
  return json(one('SELECT value FROM settings WHERE id=1').value);
}
export function audit(actor, action, resource, details = {}) {
  run(
    'INSERT INTO audit VALUES(?,?,?,?,?,?)',
    id(),
    actor?.id || null,
    action,
    resource || null,
    JSON.stringify(details),
    now(),
  );
}
export function notify(user, diary, message, key) {
  run(
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
export function createUser({ name, email, password, role = 'teacher', permissions = [] }) {
  const uid = id(),
    t = now();
  run(
    'INSERT INTO users VALUES(?,?,?,?,?,?,1,?,?)',
    uid,
    name,
    email.toLowerCase(),
    passwordHash(password),
    role,
    JSON.stringify(permissions),
    t,
    t,
  );
  run('INSERT OR IGNORE INTO user_handles VALUES(?,?,?)', uid, 'u_' + uid.replaceAll('-', ''), t);
  return one('SELECT * FROM users WHERE id=?', uid);
}

// List/report reads exclude repeated school branding; detail/export reads keep original snapshots.
export const schoolDiarySummaryColumns =
  "id,teacher_id,head_id,section_id,diary_date,language,status,version,content,quote_payload,remarks,submitted_at,reviewed_at,created_at,updated_at,json_remove(snapshot,'$.school') AS snapshot";

export const dialect = 'sqlite';

export async function createUserAsync({
  name,
  email,
  password,
  role = 'teacher',
  permissions = [],
}) {
  const encoded = await passwordHashAsync(password);
  return transaction(() => {
    const uid = id(),
      stamp = now();
    run(
      'INSERT INTO users VALUES(?,?,?,?,?,?,1,?,?)',
      uid,
      name,
      email.toLowerCase(),
      encoded,
      role,
      JSON.stringify(permissions),
      stamp,
      stamp,
    );
    run(
      'INSERT OR IGNORE INTO user_handles VALUES(?,?,?)',
      uid,
      'u_' + uid.replaceAll('-', ''),
      stamp,
    );
    return one('SELECT * FROM users WHERE id=?', uid);
  });
}
