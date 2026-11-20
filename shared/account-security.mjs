import {
  randomBytes,
  createHmac,
  createHash,
  createCipheriv,
  createDecipheriv,
  timingSafeEqual,
} from 'node:crypto';
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(bytes) {
  let bits = 0,
    value = 0,
    result = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) result += alphabet[(value << (5 - bits)) & 31];
  return result;
}
function unbase32(text) {
  let bits = 0,
    value = 0;
  const bytes = [];
  for (const letter of text) {
    const number = alphabet.indexOf(letter);
    if (number < 0) throw Error('Invalid authenticator secret');
    value = (value << 5) | number;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}
export function totp(secret, time = Date.now(), digits = 6) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(time / 30000)));
  const digest = createHmac('sha1', unbase32(secret)).update(counter).digest(),
    offset = digest.at(-1) & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits).padStart(digits, '0');
}
function key() {
  const seed = process.env.ACCOUNT_SECURITY_KEY || process.env.BACKUP_ENCRYPTION_KEY;
  if (!/^[a-f0-9]{64}$/.test(seed || ''))
    throw Object.assign(Error('Account security encryption is not configured.'), { status: 503 });
  return createHash('sha256')
    .update('elite-account-security-v1:')
    .update(Buffer.from(seed, 'hex'))
    .digest();
}
function seal(value, user) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(user));
  return Buffer.concat([iv, cipher.update(value), cipher.final(), cipher.getAuthTag()]).toString(
    'base64',
  );
}
function open(value, user) {
  const bytes = Buffer.from(value, 'base64'),
    decipher = createDecipheriv('aes-256-gcm', key(), bytes.subarray(0, 12));
  decipher.setAAD(Buffer.from(user));
  decipher.setAuthTag(bytes.subarray(-16));
  return Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString();
}
const digest = (value) => createHash('sha256').update(value).digest('hex');
export function accountSecurity(db, domain) {
  const { check } = domain;
  const row = (id) => db.one('SELECT * FROM account_security WHERE user_id=?', id);
  async function ensure(id) {
    await db.run('INSERT OR IGNORE INTO account_security(user_id) VALUES(?)', id);
  }
  async function status(id) {
    const saved = await row(id);
    return { mustChangePassword: !!saved?.must_change_password, mfaEnabled: !!saved?.totp_secret };
  }
  const vaultConfigured = () =>
    /^[a-f0-9]{64}$/.test(process.env.ACCOUNT_SECURITY_KEY || process.env.BACKUP_ENCRYPTION_KEY || '');
  // An administrator-issued password is temporary: the account must replace it at first sign-in.
  // An encrypted copy is kept only until then, so a Super Admin can hand the credentials over.
  async function issueTemporary(id, password) {
    await ensure(id);
    await db.run(
      'UPDATE account_security SET must_change_password=1,password_enc=? WHERE user_id=?',
      vaultConfigured() ? seal(password, id) : null,
      id,
    );
  }
  async function passwordChanged(id) {
    await ensure(id);
    await db.run(
      'UPDATE account_security SET must_change_password=0,password_enc=NULL WHERE user_id=?',
      id,
    );
  }
  // Super Admin view of every account's security state, including any still-temporary password.
  async function overview() {
    const result = new Map();
    for (const saved of await db.all('SELECT user_id,must_change_password,password_enc,totp_secret FROM account_security')) {
      let temporaryPassword = null;
      if (saved.password_enc && vaultConfigured())
        try {
          temporaryPassword = open(saved.password_enc, saved.user_id);
        } catch {
          temporaryPassword = null;
        }
      result.set(saved.user_id, {
        must_change_password: !!saved.must_change_password,
        mfa_enabled: !!saved.totp_secret,
        temporary_password: temporaryPassword,
      });
    }
    return { vaultConfigured: vaultConfigured(), accounts: result };
  }
  async function factor(user, code) {
    const saved = await row(user.id);
    if (!saved?.totp_secret) return;
    check(
      typeof code === 'string' && code.length <= 100,
      'Enter your authenticator or recovery code.',
      401,
    );
    const normal = code.replace(/[\s-]/g, '');
    if (/^\d{6}$/.test(normal)) {
      const secret = open(saved.totp_secret, user.id),
        step = Math.floor(Date.now() / 30000);
      let counter;
      for (const candidate of [step, step - 1, step + 1])
        if (timingSafeEqual(Buffer.from(totp(secret, candidate * 30000)), Buffer.from(normal)))
          counter = candidate;
      check(
        counter !== undefined && counter > Number(saved.last_counter),
        'Invalid or already used authenticator code.',
        401,
      );
      const claimed = await db.run(
        'UPDATE account_security SET last_counter=? WHERE user_id=? AND last_counter<?',
        counter,
        user.id,
        counter,
      );
      check(claimed.changes === 1, 'Invalid or already used authenticator code.', 401);
      return;
    }
    await db.transaction(async () => {
      const current = await row(user.id),
        hashes = JSON.parse(current.recovery_hashes),
        hash = digest(normal.toLowerCase()),
        index = hashes.findIndex((value) =>
          timingSafeEqual(Buffer.from(value, 'hex'), Buffer.from(hash, 'hex')),
        );
      check(index >= 0, 'Invalid or already used recovery code.', 401);
      hashes.splice(index, 1);
      const claimed = await db.run(
        'UPDATE account_security SET recovery_hashes=? WHERE user_id=? AND recovery_hashes=?',
        JSON.stringify(hashes),
        user.id,
        current.recovery_hashes,
      );
      check(claimed.changes === 1, 'Invalid or already used recovery code.', 401);
      await db.audit(user, 'mfa_recovery_used', user.id);
    });
  }
  async function currentPassword(user, value) {
    await ensure(user.id);
    const window = Math.floor(Date.now() / 900000),
      attempt = await db.one(
        'UPDATE account_security SET attempts=CASE WHEN window_start=? THEN attempts+1 ELSE 1 END,window_start=? WHERE user_id=? RETURNING attempts',
        window,
        window,
        user.id,
      );
    check(
      Number(attempt.attempts) <= 10,
      'Too many security attempts. Try again in 15 minutes.',
      429,
    );
    check(
      typeof value === 'string' &&
        value.length <= 128 &&
        (await (db.passwordValidAsync || db.passwordValid)(
          value,
          (await db.one('SELECT password FROM users WHERE id=?', user.id))?.password || '',
        )),
      'Current password is incorrect.',
      400,
    );
  }
  async function route({ path, method, b, u, res, reply }) {
    if (!path.startsWith('/api/school/security')) return false;
    if (path === '/api/school/security' && method === 'GET')
      return (
        reply(res, 200, {
          ...(await status(u.id)),
          encryptionConfigured: !!(
            process.env.ACCOUNT_SECURITY_KEY || process.env.BACKUP_ENCRYPTION_KEY
          ),
          sessions: (
            await db.all(
              'SELECT token_hash,expires_at FROM sessions WHERE user_id=? AND expires_at>?',
              u.id,
              db.now(),
            )
          ).map((session) => ({
            id: session.token_hash,
            expires_at: session.expires_at,
            current: session.token_hash === u.sessionHash,
          })),
        }),
        true
      );
    if (path === '/api/school/security/session' && method === 'DELETE') {
      check(typeof b.id === 'string', 'Choose a session', 400);
      await db.run('DELETE FROM sessions WHERE token_hash=? AND user_id=?', b.id, u.id);
      await db.audit(u, 'session_revoked', u.id);
      return (reply(res, 200, { ok: true }), true);
    }
    if (path === '/api/school/security/reauth' && method === 'POST') {
      await currentPassword(u, b.currentPassword);
      await factor(u, b.code);
      const hours = Math.max(1, Math.min(24, Number(process.env.SESSION_HOURS) || 8));
      await db.run(
        'UPDATE sessions SET expires_at=? WHERE token_hash=? AND user_id=?',
        new Date(Date.now() + hours * 3600000).toISOString(),
        u.sessionHash,
        u.id,
      );
      await db.audit(u, 'identity_confirmed', u.id);
      return (reply(res, 200, { ok: true }), true);
    }
    if (path === '/api/school/security/setup' && method === 'POST') {
      await currentPassword(u, b.currentPassword);
      const saved = await row(u.id);
      check(!saved?.totp_secret, 'Disable the current authenticator before replacing it.', 409);
      const secret = base32(randomBytes(20)),
        encrypted = seal(secret, u.id);
      await ensure(u.id);
      await db.run(
        'UPDATE account_security SET pending_secret=?,pending_until=? WHERE user_id=?',
        encrypted,
        new Date(Date.now() + 600000).toISOString(),
        u.id,
      );
      await db.audit(u, 'mfa_setup_started', u.id);
      return (
        reply(res, 200, {
          secret,
          uri:
            'otpauth://totp/' +
            encodeURIComponent('Elite Scholars:' + u.email) +
            '?secret=' +
            secret +
            '&issuer=Elite%20Scholars&algorithm=SHA1&digits=6&period=30',
        }),
        true
      );
    }
    if (path === '/api/school/security/enable' && method === 'POST') {
      await currentPassword(u, b.currentPassword);
      const codes = Array.from({ length: 10 }, () => randomBytes(10).toString('hex'));
      await db.transaction(async () => {
        const saved = await row(u.id);
        check(
          saved?.pending_secret && saved.pending_until > db.now(),
          'Authenticator setup expired. Start again.',
          409,
        );
        const secret = open(saved.pending_secret, u.id);
        check(
          typeof b.code === 'string' &&
            /^\d{6}$/.test(b.code) &&
            [0, -1, 1].some((offset) => totp(secret, Date.now() + offset * 30000) === b.code),
          'Enter the current six-digit authenticator code.',
          400,
        );
        await db.run(
          'UPDATE account_security SET totp_secret=pending_secret,pending_secret=NULL,pending_until=NULL,last_counter=-1,recovery_hashes=? WHERE user_id=?',
          JSON.stringify(codes.map(digest)),
          u.id,
        );
        await db.audit(u, 'mfa_enabled', u.id);
      });
      return (reply(res, 200, { recoveryCodes: codes }), true);
    }
    if (path === '/api/school/security/disable' && method === 'POST') {
      await currentPassword(u, b.currentPassword);
      await factor(u, b.code);
      await db.run(
        "UPDATE account_security SET totp_secret=NULL,pending_secret=NULL,pending_until=NULL,last_counter=-1,recovery_hashes='[]' WHERE user_id=?",
        u.id,
      );
      await db.audit(u, 'mfa_disabled', u.id);
      return (reply(res, 200, { ok: true }), true);
    }
    check(false, 'Security operation not found.', 404);
  }
  return {
    status,
    issueTemporary,
    passwordChanged,
    overview,
    factor,
    route,
    requireRecent(user) {
      check(
        user.authenticatedAt && Date.now() - Date.parse(user.authenticatedAt) < 900000,
        'Confirm your identity in Your profile before this sensitive change, then review and retry the action.',
        403,
      );
    },
  };
}
