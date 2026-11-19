import {
  passwordHashAsync,
  passwordValidAsync,
  passwordAcceptable,
  PASSWORD_MESSAGE,
} from '../shared/passwords.mjs';
import { withDatabaseContext } from './db.mjs';
import { clientSettings } from '../shared/client-settings.mjs';
import { assertSettingsVersion, preserveSettingsLinks } from '../shared/settings-publication.mjs';
import { readJsonBody, validateQuery } from '../shared/http-input.mjs';
import * as enhancementDb from './db.mjs';
import * as enhancementDomain from './domain.mjs';
import * as enhancementDocuments from './documents.mjs';
import { enhancements } from '../shared/enhancements.mjs';
const extra = enhancements(enhancementDb, enhancementDomain, enhancementDocuments);
import { homeworkSample } from '../shared/homework-template.mjs';
import http from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { resolve, join, extname, basename } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  db,
  dataDir,
  all,
  one,
  run,
  id,
  now,
  json,
  hash,
  passwordHash,
  passwordValid,
  createUser,
  createUserAsync,
  publicUser,
  settings,
  audit,
  notify,
  transaction,
} from './db.mjs';
import {
  fail,
  check,
  can,
  roles,
  fields,
  validDate,
  validTime,
  dateInZone,
  visibleAssignments,
  assignment,
  assignmentScope,
  reviewScope,
  diary,
  exportAllowed,
  quoteScope,
  selectQuotes,
  expected,
  listDiaries,
  saveDiary,
  reviewDiary,
  amendDiary,
  sendDeadlineNotifications,
} from './domain.mjs';
import {
  documentHtml,
  diarySource,
  reportSource,
  renderExport,
  closeRenderer,
} from './documents.mjs';
const publicDir = new URL('../public/', import.meta.url);
mkdirSync(join(dataDir, 'files'), { recursive: true, mode: 0o700 });
const limits = new Map();
const sessionsHours = Math.max(1, Math.min(24, Number(process.env.SESSION_HOURS) || 8));
function throttle(key, max = 12) {
  const t = Date.now(),
    entry = limits.get(key) || { count: 0, time: t };
  if (t - entry.time > 900000) {
    entry.time = t;
    entry.count = 0;
  }
  entry.count++;
  limits.set(key, entry);
  check(entry.count <= max, 'Too many attempts. Try again in 15 minutes.', 429);
  if (limits.size > 10000) for (const [k, v] of limits) if (t - v.time > 900000) limits.delete(k);
}
function userFor(req) {
  const token = /\bess_session=([^;]+)/.exec(req.headers.cookie || '')?.[1];
  if (!token) return null;
  const s = one('SELECT * FROM sessions WHERE token_hash=? AND expires_at>?', hash(token), now());
  if (!s) return null;
  const u = one('SELECT * FROM users WHERE id=? AND active=1', s.user_id);
  return u
    ? {
        ...u,
        csrf: s.csrf,
        sessionHash: s.token_hash,
        authenticatedAt: new Date(Date.parse(s.expires_at) - sessionsHours * 3600000).toISOString(),
      }
    : null;
}
function reply(res, code, value, headers = {}) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify(res.filterDeleted ? res.filterDeleted(value) : value));
}
function cookie(value, age) {
  return `ess_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''}`;
}
function validateUser(b) {
  check(
    typeof b.name === 'string' && b.name.trim().length >= 2 && b.name.length <= 120,
    'Name must contain 2–120 characters',
    400,
  );
  check(
    typeof b.email === 'string' &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email) &&
      b.email.length <= 254,
    'Valid email required',
    400,
  );
  check(roles.includes(b.role), 'Invalid role', 400);
  if (b.password !== undefined)
    check(
      passwordAcceptable(b.password),
      PASSWORD_MESSAGE,
      400,
    );
}
const allowedPerms = [
  'read_all',
  'review_all',
  'export',
  'manage_academics',
  'manage_users',
  'manage_quotes',
  'manage_quotes_all',
  'amend',
  'read_audit',
  'manage_settings',
];
function visibleUsers(u) {
  if (u.role === 'teacher') return [publicUser(u)];
  if (can(u, 'manage_users') || can(u, 'read_all'))
    return all('SELECT * FROM users').map(publicUser);
  const as = visibleAssignments(u),
    ids = new Set([u.id, ...as.flatMap((a) => [a.teacher_id, a.head_id])]);
  if (u.role === 'teacher') return [publicUser(u)];
  return all('SELECT * FROM users')
    .filter((x) => ids.has(x.id))
    .map(publicUser);
}
function ownQuote(u, q) {
  check(q && quoteScope(u, q), 'Quote not found', 404);
  check(
    can(u, 'manage_quotes') || can(u, 'manage_quotes_all'),
    'Quote management permission required',
  );
  check(
    q.scope_id !== null || can(u, 'manage_quotes_all'),
    'School-wide quote permission required',
  );
}
function validateAssignment(u, b) {
  for (const k of ['teacher_id', 'head_id', 'section_id', 'subject_id', 'session_id'])
    check(typeof b[k] === 'string', `${k} is required`, 400);
  const section = one(
    "SELECT parent_id FROM academics WHERE id=? AND kind='section'",
    b.section_id,
  );
  check(
    section &&
      one(
        'SELECT 1 FROM class_subjects WHERE class_id=? AND subject_id=?',
        section.parent_id,
        b.subject_id,
      ),
    'Subject must be linked to this class in Academic Setup',
    400,
  );
  const t = one('SELECT * FROM users WHERE id=? AND active=1', b.teacher_id),
    h = one('SELECT * FROM users WHERE id=? AND active=1', b.head_id);
  check(t && h && h.role === 'head_teacher', 'Active teacher and Head Teacher required', 400);
  check(t.id !== h.id, 'Assign a separate reviewer', 400);
  for (const [key, kind] of [
    ['section_id', 'section'],
    ['subject_id', 'subject'],
    ['session_id', 'session'],
  ])
    check(
      one('SELECT id FROM academics WHERE id=? AND kind=? AND active=1', b[key], kind),
      `Invalid ${kind}`,
      400,
    );
  check(
    validDate(b.start_date) && validDate(b.end_date) && b.start_date <= b.end_date,
    'Valid assignment dates required',
    400,
  );
  const ses = one('SELECT * FROM academics WHERE id=?', b.session_id);
  check(
    (!ses.start_date || b.start_date >= ses.start_date) &&
      (!ses.end_date || b.end_date <= ses.end_date),
    'Assignment dates must fit the academic session',
    400,
  );
  check(
    Array.isArray(b.weekdays) &&
      b.weekdays.length > 0 &&
      b.weekdays.every((x) => Number.isInteger(x) && x >= 0 && x <= 6),
    'Choose weekdays',
    400,
  );
  check(
    Array.isArray(b.periods) &&
      b.periods.length > 0 &&
      b.periods.every((x) => Number.isInteger(x) && x > 0 && x <= 20),
    'Choose periods 1–20',
    400,
  );
  check(validTime(b.due_time) && validTime(b.review_time), 'Valid deadline times required', 400);
}
async function api(req, res, url) {
  const path = url.pathname,
    method = req.method,
    b = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) ? await readJsonBody(req) : {},
    q = validateQuery(Object.fromEntries(url.searchParams));
  let u = userFor(req);
  if (u) Object.assign(u, await extra.school.security.status(u.id));
  if (method !== 'GET') {
    const origin = req.headers.origin;
    if (origin) {
      const allowedOrigins = new Set([`http://${req.headers.host}`]);
      if (process.env.PUBLIC_ORIGIN) {
        try {
          allowedOrigins.add(new URL(process.env.PUBLIC_ORIGIN).origin);
        } catch {
          throw Object.assign(Error('PUBLIC_ORIGIN must be a valid URL'), { status: 500 });
        }
      }
      if (process.env.REPLIT_DEV_DOMAIN)
        allowedOrigins.add(new URL('https://' + process.env.REPLIT_DEV_DOMAIN).origin);
      check(allowedOrigins.has(origin), 'Untrusted request origin');
    }
  }
  if (path === '/api/health')
    return reply(res, 200, {
      ok: true,
      configured: !!one('SELECT id FROM users LIMIT 1'),
      setupEnabled: String(process.env.SETUP_TOKEN || '').length >= 16,
    });
  if (path === '/api/setup' && method === 'POST') {
    const secret = String(process.env.SETUP_TOKEN || '');
    check(secret.length >= 16, 'Setup is disabled. Add SETUP_TOKEN (16+ random characters) in Replit Secrets.', 503);
    throttle('setup:' + hash(req.socket.remoteAddress || 'local'), 10);
    const supplied = Buffer.from(hash(String(b.token || ''))),
      expected = Buffer.from(hash(secret));
    check(timingSafeEqual(supplied, expected), 'Setup key is not correct.', 403);
    check(
      typeof b.name === 'string' && b.name.trim().length >= 2 && b.name.length <= 120,
      'Name must contain 2–120 characters',
      400,
    );
    check(
      typeof b.email === 'string' &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email) &&
        b.email.length <= 254,
      'Enter a valid email address',
      400,
    );
    check(
      passwordAcceptable(b.password),
      PASSWORD_MESSAGE,
      400,
    );
    await transaction(async () => {
      check(!one('SELECT id FROM users LIMIT 1'), 'An account already exists. Sign in instead.', 409);
      await createUserAsync({
        name: b.name.trim(),
        email: b.email.trim(),
        password: b.password,
        role: 'super_admin',
      });
    });
    audit(null, 'first_run_setup_completed', null, {});
    return reply(res, 201, { ok: true });
  }
  if (path === '/api/login' && method === 'POST') {
    check(
      typeof b.email === 'string' && typeof b.password === 'string' && b.password.length <= 128,
      'Email and password required',
      400,
    );
    const keys = [
      ['account:' + hash(b.email.trim().toLowerCase()), 12],
      ['ip:' + hash(req.socket.remoteAddress || 'local'), 100],
    ];
    for (const [key, max] of keys) {
      const old = limits.get(key);
      check(
        !old || Date.now() - old.time > 900000 || old.count < max,
        'Too many failed attempts. Try again in 15 minutes.',
        429,
      );
    }
    u = one('SELECT * FROM users WHERE email=? COLLATE NOCASE', b.email.trim());
    const fallback = 'a'.repeat(32) + ':' + '0'.repeat(128);
    const valid = await passwordValidAsync(b.password, u?.password || fallback);
    if (!u?.active || !valid) {
      for (const [key, max] of keys) throttle(key, max);
      fail(401, 'Invalid email or password');
    }
    try {
      await extra.school.security.factor(u, b.otp);
    } catch (error) {
      if (error.status === 401) for (const [key, max] of keys) throttle(key, max);
      throw error;
    }
    limits.delete(keys[0][0]);
    const token = randomBytes(32).toString('hex'),
      csrf = randomBytes(24).toString('hex');
    run('DELETE FROM sessions WHERE expires_at<=?', now());
    run(
      'INSERT INTO sessions VALUES(?,?,?,?)',
      hash(token),
      u.id,
      csrf,
      new Date(Date.now() + sessionsHours * 3600000).toISOString(),
    );
    audit(u, 'login', u.id);
    return reply(
      res,
      200,
      { user: { ...publicUser(u), ...(await extra.school.security.status(u.id)) }, csrf },
      { 'Set-Cookie': cookie(token, sessionsHours * 3600) },
    );
  }
  check(u, 'Sign in to continue', 401);
  if (method !== 'GET')
    check(
      req.headers['x-csrf-token'] === u.csrf,
      'Session verification failed. Reload and try again.',
    );
  if (u.mustChangePassword) {
    if (path === '/api/school/bootstrap')
      return reply(res, 200, { capabilities: [], structure: null, mustChangePassword: true });
    check(
      ['/api/me', '/api/logout', '/api/profile'].includes(path),
      'Change your temporary password in Your profile before continuing.',
      403,
    );
    if (path === '/api/profile' && method === 'PATCH')
      check(
        passwordAcceptable(b.newPassword),
        'Choose a new password before continuing.',
        400,
      );
  }
  if (await extra.route({ path, method, b, q, u, res, reply, htmlResponse })) return;
  if (path === '/api/me')
    return reply(res, 200, {
      user: {
        ...publicUser(u),
        mustChangePassword: u.mustChangePassword,
        mfaEnabled: u.mfaEnabled,
      },
      csrf: u.csrf,
      school: clientSettings(settings(), {
        administrator: ['super_admin', 'school_admin'].includes(u.role),
      }),
    });
  if (path === '/api/logout' && method === 'POST') {
    run(
      'DELETE FROM sessions WHERE token_hash=?',
      hash(/\bess_session=([^;]+)/.exec(req.headers.cookie || '')?.[1] || ''),
    );
    audit(u, 'logout', u.id);
    return reply(res, 200, { ok: true }, { 'Set-Cookie': cookie('', 0) });
  }
  if (path === '/api/profile' && method === 'PATCH') {
    await transaction(async () => {
      check(
        typeof b.name === 'string' && b.name.trim().length >= 2 && b.name.length <= 120,
        'Valid name required',
        400,
      );
      if (b.newPassword) {
        check(
          await passwordValidAsync(String(b.currentPassword || ''), u.password),
          'Current password is incorrect',
          400,
        );
        check(
          b.newPassword !== b.currentPassword,
          'Choose a different password from your temporary or current password.',
          400,
        );
        check(
          passwordAcceptable(b.newPassword),
      PASSWORD_MESSAGE,
          400,
        );
        run('UPDATE users SET password=? WHERE id=?', await passwordHashAsync(b.newPassword), u.id);
        run(
          'DELETE FROM sessions WHERE user_id=? AND token_hash<>?',
          u.id,
          hash(/\bess_session=([^;]+)/.exec(req.headers.cookie || '')?.[1] || ''),
        );
      }
      run('UPDATE users SET name=?,updated_at=? WHERE id=?', b.name.trim(), now(), u.id);
      if (b.newPassword) await extra.school.security.passwordChanged(u.id);
      audit(u, 'profile_updated', u.id);
    });
    return reply(res, 200, { ok: true });
  }
  if (path === '/api/lookups') {
    const as = visibleAssignments(u);
    const ids = new Set(
      as.flatMap((a) => [a.section_id, a.subject_id, a.session_id, a.department_id]),
    );
    let academics = all('SELECT * FROM academics ORDER BY kind,name');
    const parents = new Set(academics.filter((a) => ids.has(a.id)).map((a) => a.parent_id));
    if (!can(u, 'manage_academics') && !can(u, 'read_all'))
      academics = academics.filter((a) => ids.has(a.id) || parents.has(a.id));
    return reply(res, 200, {
      academics,
      assignments: as,
      users: visibleUsers(u),
      coordinatorHeads: all('SELECT * FROM coordinator_heads').filter(
        (x) => can(u, 'manage_users') || x.coordinator_id === u.id,
      ),
      exceptions: all('SELECT * FROM calendar_exceptions').filter(
        (x) => !x.assignment_id || as.some((a) => a.id === x.assignment_id),
      ),
    });
  }
  if (path === '/api/dashboard') {
    sendDeadlineNotifications();
    const date = q.date || dateInZone(),
      slots = expected(u, date, date),
      ds = listDiaries(u, { start: date, end: date });
    return reply(res, 200, {
      date,
      slots,
      diaries: ds,
      quotes: selectQuotes(u, date),
      counts: {
        expected: slots.length,
        submitted: slots.filter((s) => s.submitted).length,
        approved: ds.filter((d) => d.status === 'approved').length,
        awaiting: ds.filter((d) => ['submitted', 'resubmitted', 'under_review'].includes(d.status))
          .length,
        returned: ds.filter((d) => d.status === 'returned').length,
        drafts: ds.filter((d) => d.status === 'draft').length,
        overdue: slots.filter((s) => s.overdue).length,
        rate: slots.length
          ? Math.round((slots.filter((s) => s.submitted).length / slots.length) * 100)
          : 0,
      },
    });
  }
  if (path === '/api/diaries' && method === 'GET') {
    const list = listDiaries(u, q),
      page = Math.max(1, Number(q.page) || 1);
    return reply(res, 200, {
      total: list.length,
      page,
      pageSize: 30,
      items: list.slice((page - 1) * 30, page * 30),
    });
  }
  if (path === '/api/diaries' && method === 'POST') return reply(res, 201, saveDiary(u, b));
  const dm =
    /^\/api\/diaries\/([\w-]+)(?:\/(review|amend|versions|attachments|preview|print|export))?$/.exec(
      path,
    );
  if (dm) {
    const [, did, action] = dm,
      d = diary(u, did);
    if (!action && method === 'GET')
      return reply(res, 200, {
        ...d,
        attachments: all(
          'SELECT id,name,mime,size,created_at FROM attachments WHERE diary_id=?',
          did,
        ),
        reviews: all(
          'SELECT r.*,a.name actor_name FROM reviews r JOIN users a ON a.id=r.actor_id WHERE diary_id=? ORDER BY created_at',
          did,
        ),
        canReview:
          reviewScope(u, d.assignment) && (settings().allowSelfApproval || u.id !== d.teacher_id),
        canExport: exportAllowed(u, d),
        canAmend: can(u, 'amend'),
      });
    if (!action && method === 'PUT') return reply(res, 200, saveDiary(u, b, did));
    if (action === 'review' && method === 'POST') return reply(res, 200, reviewDiary(u, did, b));
    if (action === 'amend' && method === 'POST') return reply(res, 200, amendDiary(u, did, b));
    if (action === 'versions')
      return reply(
        res,
        200,
        all(
          'SELECT v.*,a.name actor_name FROM diary_versions v JOIN users a ON a.id=v.actor_id WHERE diary_id=? ORDER BY version DESC',
          did,
        ).map((v) => ({ ...v, snapshot: json(v.snapshot) })),
      );
    if (action === 'attachments' && method === 'POST') {
      check(
        d.teacher_id === u.id && ['draft', 'returned'].includes(d.status),
        'This diary cannot accept attachments',
        409,
      );
      check(
        typeof b.name === 'string' && b.name.length <= 180 && b.name.trim(),
        'Valid filename required',
        400,
      );
      check(
        typeof b.data === 'string' && /^[A-Za-z0-9+/]*={0,2}$/.test(b.data),
        'Invalid file encoding',
        400,
      );
      const bytes = Buffer.from(b.data, 'base64');
      check(
        bytes.length > 0 && bytes.length <= 5 * 1024 * 1024,
        'Files must be 1 byte to 5 MB',
        400,
      );
      const isPng = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
        isJpg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
        isPdf = bytes.subarray(0, 5).toString() === '%PDF-';
      const mime = isPng ? 'image/png' : isJpg ? 'image/jpeg' : isPdf ? 'application/pdf' : null;
      check(mime && mime === b.mime, 'Only verified PNG, JPG and PDF content is accepted', 400);
      const fileId = id(),
        key = fileId + '.bin';
      writeFileSync(join(dataDir, 'files', key), bytes, { mode: 0o600 });
      try {
        transaction(() => {
          run(
            'INSERT INTO attachments VALUES(?,?,?,?,?,?,?,?,?)',
            fileId,
            did,
            u.id,
            basename(b.name).replace(/[\x00-\x1f]/g, ''),
            mime,
            bytes.length,
            hash(bytes),
            key,
            now(),
          );
          audit(u, 'attachment_uploaded', did, { fileId, checksum: hash(bytes) });
        });
      } catch (e) {
        unlinkSync(join(dataDir, 'files', key));
        throw e;
      }
      return reply(res, 201, { id: fileId });
    }
    if (action === 'preview') {
      return htmlResponse(res, documentHtml([diarySource(d)], undefined, exportAllowed(u, d)));
    }
    if (action === 'print') {
      check(exportAllowed(u, d), 'Print permission required');
      audit(u, 'diary_printed', d.id);
      return htmlResponse(res, documentHtml([diarySource(d)]));
    }
    if (action === 'export') {
      check(exportAllowed(u, d), 'Export permission required');
      return await exportResponse(res, u, [d], q.format || 'pdf', !!q.__diary_action);
    }
  }
  const attachment = /^\/api\/attachments\/([\w-]+)$/.exec(path);
  if (attachment && method === 'GET') {
    const f = one('SELECT * FROM attachments WHERE id=?', attachment[1]);
    check(f, 'File not found', 404);
    const d = diary(u, f.diary_id);
    check(exportAllowed(u, d), 'Download permission required');
    const bytes = readFileSync(join(dataDir, 'files', f.object_key));
    check(hash(bytes) === f.checksum, 'Attachment checksum mismatch', 500);
    audit(u, 'attachment_downloaded', d.id, { fileId: f.id });
    res.writeHead(200, {
      'Content-Type': f.mime,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      'Cache-Control': 'no-store',
    });
    return res.end(bytes);
  }
  if (path === '/api/export' && method === 'GET') {
    check(can(u, 'export'), 'Export permission required');
    const ds = listDiaries(u, q);
    check(ds.length > 0, 'No matching diaries', 404);
    check(ds.length <= 200, 'Choose at most 200 diaries per export', 400);
    return await exportResponse(res, u, ds, q.format || 'pdf', !!q.__diary_action);
  }
  if (path === '/api/reports') {
    const start = q.start || dateInZone(),
      end = q.end || start;
    let slots = expected(u, start, end).filter(
      (s) =>
        (!q.teacher || s.teacher_id === q.teacher) &&
        (!q.class || s.class_name === q.class) &&
        (!q.section ||
          visibleAssignments(u).find((a) => a.id === s.assignment_id)?.section_id === q.section) &&
        (!q.subject ||
          visibleAssignments(u).find((a) => a.id === s.assignment_id)?.subject_id === q.subject) &&
        (!q.department || s.department_id === q.department) &&
        (!q.session ||
          visibleAssignments(u).find((a) => a.id === s.assignment_id)?.session_id === q.session) &&
        (!q.status || (q.status === 'overdue' ? s.overdue : s.status === q.status)),
    );
    const ds = listDiaries(u, { ...q, start, end });
    if (q.format === 'pdf') {
      check(can(u, 'export'), 'Export permission required');
      const reportHtml = documentHtml(
        [reportSource(slots, 'Submission & Teaching Progress Report')],
        !q.__diary_action && process.env.SERVER_RENDER_EXPORTS === 'true' ? undefined : 'pdf',
      );
      if (q.__diary_action || process.env.SERVER_RENDER_EXPORTS !== 'true') {
        audit(u, 'report_exported', null, { start, end, rows: slots.length, renderer: 'browser' });
        return htmlResponse(res, reportHtml);
      }
      const rendered = await renderExport(reportHtml, 'pdf');
      audit(u, 'report_exported', null, { start, end, rows: slots.length });
      res.writeHead(200, {
        'Content-Type': rendered.type,
        'Content-Disposition': 'attachment; filename="school-report.pdf"',
      });
      return res.end(rendered.buffer);
    }
    if (q.format === 'csv') {
      check(can(u, 'export'), 'Export permission required');
      const safe = (v) =>
        '"' +
        String(v ?? '')
          .replace(/^[=+\-@\t\r]/, "'$&")
          .replaceAll('"', '""') +
        '"';
      const headers = [
        'Date',
        'Teacher',
        'Class',
        'Section',
        'Subject',
        'Period',
        'Status',
        'Submitted',
        'Overdue',
        'Late',
        'Due',
        'Syllabus progress',
      ];
      const csv =
        '\ufeff' +
        [
          headers,
          ...slots.map((s) => [
            s.date,
            s.teacher_name,
            s.class_name,
            s.section_name,
            s.subject_name,
            s.period,
            s.status,
            s.submitted,
            s.overdue,
            s.late,
            s.due_at,
            ds.find((d) => d.id === s.diary_id)?.content.syllabus_progress || '',
          ]),
        ]
          .map((row) => row.map(safe).join(','))
          .join('\r\n');
      audit(u, 'report_exported', null, { start, end, rows: slots.length, format: 'csv' });
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="school-report.csv"',
      });
      return res.end(csv);
    }
    return reply(res, 200, {
      slots,
      diaries: ds,
      total: slots.length,
      submitted: slots.filter((s) => s.submitted).length,
      overdue: slots.filter((s) => s.overdue).length,
    });
  }
  if (path === '/api/notifications' && method === 'GET')
    return reply(
      res,
      200,
      all('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 300', u.id),
    );
  if (path === '/api/notifications' && method === 'PATCH') {
    if (b.id) run('UPDATE notifications SET read_at=? WHERE id=? AND user_id=?', now(), b.id, u.id);
    else run('UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL', now(), u.id);
    return reply(res, 200, { ok: true });
  }
  if (path === '/api/users' && method === 'POST') {
    check(can(u, 'manage_users'), 'User management permission required');
    validateUser(b);
    check(b.password, 'Initial password required', 400);
    check(
      u.role === 'super_admin' || ['teacher', 'head_teacher'].includes(b.role),
      'Only Super Admin can grant administrative roles',
    );
    const permissions = Array.isArray(b.permissions) ? b.permissions : [];
    check(
      permissions.every((p) => allowedPerms.includes(p)),
      'Invalid permission',
      400,
    );
    check(
      u.role === 'super_admin' || permissions.every((p) => p === 'export'),
      'Only Super Admin can grant privileged permissions',
    );
    const created = await transaction(async () => {
      const created = await enhancementDb.createUserAsync({
        ...b,
        name: b.name.trim(),
        permissions,
      });
      await extra.school.security.issueTemporary(created.id, b.password);
      audit(u, 'user_created', created.id, { role: b.role, permissions });
      return created;
    });
    return reply(res, 201, publicUser(created));
  }
  if (path === '/api/hierarchy' && method === 'POST') {
    check(can(u, 'manage_users'), 'User management permission required');
    check(
      one("SELECT 1 FROM users WHERE id=? AND role='coordinator' AND active=1", b.coordinator_id) &&
        one("SELECT 1 FROM users WHERE id=? AND role='head_teacher' AND active=1", b.head_id),
      'Active Coordinator and Head required',
      400,
    );
    run('INSERT OR IGNORE INTO coordinator_heads VALUES(?,?)', b.coordinator_id, b.head_id);
    audit(u, 'hierarchy_assigned', b.coordinator_id, { head: b.head_id });
    return reply(res, 201, { ok: true });
  }
  if (path === '/api/hierarchy' && method === 'DELETE') {
    check(can(u, 'manage_users'), 'User management permission required');
    run(
      'DELETE FROM coordinator_heads WHERE coordinator_id=? AND head_id=?',
      q.coordinator_id || '',
      q.head_id || '',
    );
    audit(u, 'hierarchy_removed', q.coordinator_id, { head: q.head_id });
    return reply(res, 200, { ok: true });
  }
  if (path === '/api/assignments' && method === 'POST') {
    check(can(u, 'manage_academics'), 'Academic management permission required');
    validateAssignment(u, b);
    const aid = id();
    run(
      'INSERT INTO assignments VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1)',
      aid,
      b.teacher_id,
      b.head_id,
      b.section_id,
      b.subject_id,
      b.session_id,
      b.start_date,
      b.end_date,
      JSON.stringify([...new Set(b.weekdays)]),
      JSON.stringify([...new Set(b.periods)]),
      b.due_time,
      b.review_time,
    );
    audit(u, 'assignment_created', aid);
    return reply(res, 201, { id: aid });
  }
  const asm = /^\/api\/assignments\/([\w-]+)$/.exec(path);
  if (asm && method === 'PATCH') {
    check(can(u, 'manage_academics'), 'Academic management permission required');
    const a = one('SELECT * FROM assignments WHERE id=?', asm[1]);
    check(a, 'Assignment not found', 404);
    if (b.active !== undefined) {
      transaction(() => {
        run('UPDATE assignments SET active=? WHERE id=?', Number(!!b.active), a.id);
        run(
          'INSERT INTO assignment_state_events VALUES(?,?,?,?,?)',
          id(),
          a.id,
          dateInZone(),
          Number(!!b.active),
          now(),
        );
      });
    } else {
      check(
        !one(
          'SELECT 1 FROM school_diaries WHERE teacher_id=? AND section_id=?',
          a.teacher_id,
          a.section_id,
        ) && !one('SELECT 1 FROM diaries WHERE assignment_id=?', a.id),
        'Assignment with history is immutable; archive and create a replacement',
        409,
      );
      validateAssignment(u, b);
      run(
        'UPDATE assignments SET teacher_id=?,head_id=?,section_id=?,subject_id=?,session_id=?,start_date=?,end_date=?,weekdays=?,periods=?,due_time=?,review_time=? WHERE id=?',
        b.teacher_id,
        b.head_id,
        b.section_id,
        b.subject_id,
        b.session_id,
        b.start_date,
        b.end_date,
        JSON.stringify(b.weekdays),
        JSON.stringify(b.periods),
        b.due_time,
        b.review_time,
        a.id,
      );
    }
    audit(u, 'assignment_updated', a.id);
    return reply(res, 200, { ok: true });
  }
  if (path === '/api/exceptions' && method === 'POST') {
    check(can(u, 'manage_academics'), 'Academic management permission required');
    check(
      validDate(b.date) &&
        typeof b.reason === 'string' &&
        b.reason.trim().length > 0 &&
        b.reason.length <= 200,
      'Date and holiday/exception reason required',
      400,
    );
    if (b.assignment_id) assignment(u, b.assignment_id);
    const eid = id();
    run(
      'INSERT INTO calendar_exceptions VALUES(?,?,?,?)',
      eid,
      b.date,
      b.assignment_id || null,
      b.reason.trim(),
    );
    audit(u, 'calendar_exception_created', eid);
    return reply(res, 201, { id: eid });
  }
  const ex = /^\/api\/exceptions\/([\w-]+)$/.exec(path);
  if (ex && method === 'DELETE') {
    check(can(u, 'manage_academics'), 'Academic management permission required');
    run('DELETE FROM calendar_exceptions WHERE id=?', ex[1]);
    audit(u, 'calendar_exception_removed', ex[1]);
    return reply(res, 200, { ok: true });
  }
  if (path === '/api/quotes' && method === 'GET')
    return reply(res, 200, {
      quotes: all('SELECT * FROM quotes ORDER BY updated_at DESC').filter((x) => quoteScope(u, x)),
      schedules: all(
        'SELECT s.*,q.text,q.language FROM quote_schedules s JOIN quotes q ON q.id=s.quote_id',
      ).filter(
        (x) =>
          quoteScope(u, one('SELECT * FROM quotes WHERE id=?', x.quote_id)) &&
          (!x.scope_id || quoteScope(u, { scope_id: x.scope_id })),
      ),
    });
  if (path === '/api/quotes' && method === 'POST') {
    check(
      can(u, 'manage_quotes') || can(u, 'manage_quotes_all'),
      'Quote management permission required',
    );
    const scope = b.scope_id || null;
    check(scope || can(u, 'manage_quotes_all'), 'School-wide quote permission required');
    check(!scope || one('SELECT 1 FROM users WHERE id=?', scope), 'Invalid quote scope', 400);
    check(quoteScope(u, { scope_id: scope }), 'Quote scope is outside your responsibility');
    check(
      typeof b.text === 'string' && b.text.trim() && b.text.length <= 1200,
      'Exact approved quote text required (max 1200 characters)',
      400,
    );
    check(
      typeof b.language === 'string' && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(b.language),
      'Valid language tag required',
      400,
    );
    check(['ltr', 'rtl'].includes(b.direction), 'Invalid text direction', 400);
    const qid = id();
    run(
      'INSERT INTO quotes VALUES(?,?,?,?,1,?,?,?)',
      qid,
      b.text.trim(),
      b.language,
      b.direction,
      scope,
      u.id,
      now(),
    );
    audit(u, 'quote_created', qid);
    return reply(res, 201, { id: qid });
  }
  const qm = /^\/api\/quotes\/([\w-]+)$/.exec(path);
  if (qm && method === 'PATCH') {
    const quote = one('SELECT * FROM quotes WHERE id=?', qm[1]);
    ownQuote(u, quote);
    const text = b.text ?? quote.text;
    check(
      typeof text === 'string' && text.trim() && text.length <= 1200,
      'Quote text required (max 1200 characters)',
      400,
    );
    run(
      'UPDATE quotes SET text=?,active=?,updated_at=? WHERE id=?',
      text.trim(),
      b.active === undefined ? quote.active : Number(!!b.active),
      now(),
      quote.id,
    );
    audit(u, 'quote_updated', quote.id);
    return reply(res, 200, { ok: true });
  }
  if (path === '/api/quote-schedules' && method === 'POST') {
    const quote = one('SELECT * FROM quotes WHERE id=?', b.quote_id);
    ownQuote(u, quote);
    check(validDate(b.date), 'Valid schedule date required', 400);
    const scope = b.scope_id || quote.scope_id || null;
    check(!scope || one('SELECT 1 FROM users WHERE id=?', scope), 'Invalid scope', 400);
    check(scope || can(u, 'manage_quotes_all'), 'School-wide schedule permission required');
    check(quoteScope(u, { scope_id: scope }), 'Scope is outside your responsibility');
    check(
      Number.isInteger(Number(b.priority)) && Math.abs(Number(b.priority)) <= 1000,
      'Priority must be an integer from -1000 to 1000',
      400,
    );
    const sid = id();
    run(
      'INSERT INTO quote_schedules VALUES(?,?,?,?,?)',
      sid,
      quote.id,
      b.date,
      scope,
      Number(b.priority),
    );
    audit(u, 'quote_scheduled', sid);
    return reply(res, 201, { id: sid });
  }
  const qs = /^\/api\/quote-schedules\/([\w-]+)$/.exec(path);
  if (qs && method === 'DELETE') {
    const s = one('SELECT * FROM quote_schedules WHERE id=?', qs[1]);
    check(s, 'Schedule not found', 404);
    ownQuote(u, one('SELECT * FROM quotes WHERE id=?', s.quote_id));
    run('DELETE FROM quote_schedules WHERE id=?', s.id);
    audit(u, 'quote_schedule_removed', s.id);
    return reply(res, 200, { ok: true });
  }
  if (path === '/api/settings' && method === 'GET') {
    const { diaryNotice: _notice, ...publicSettings } = settings();
    return reply(res, 200, publicSettings);
  }
  if (path === '/api/settings' && method === 'PUT') {
    check(can(u, 'manage_settings'), 'Settings management permission required');
    const old = settings(),
      value = { ...old };
    assertSettingsVersion(b.expected_template_version, old);
    check(
      b.diaryLayout === undefined || ['teaching', 'homework_grid'].includes(b.diaryLayout),
      'Invalid diary template',
      400,
    );
    value.diaryLayout = b.diaryLayout || old.diaryLayout || 'teaching';
    for (const key of ['name', 'address', 'contact', 'session', 'timezone']) {
      check(typeof b[key] === 'string' && b[key].length <= 300, `Invalid ${key}`, 400);
      value[key] = b[key].trim();
    }
    check(value.name, 'School name required', 400);
    try {
      new Intl.DateTimeFormat('en', { timeZone: value.timezone }).format();
    } catch {
      fail(400, 'Unknown IANA timezone');
    }
    check(validTime(b.submissionTime) && validTime(b.reviewTime), 'Valid deadlines required', 400);
    value.submissionTime = b.submissionTime;
    value.reviewTime = b.reviewTime;
    check(
      Array.isArray(b.requiredFields) &&
        b.requiredFields.every((x) => fields.includes(x)) &&
        b.requiredFields.includes('topic'),
      'Topic must remain required; unknown fields are not allowed',
      400,
    );
    value.requiredFields = b.requiredFields;
    check(
      typeof b.logo === 'string' &&
        (b.logo === '' ||
          (/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(b.logo) &&
            b.logo.length < 300000)),
      'Logo must be PNG/JPG under 200 KB',
      400,
    );
    value.logo = b.logo;
    value.allowSelfApproval =
      u.role === 'super_admin' ? b.allowSelfApproval === true : old.allowSelfApproval;
    value.retentionDays = Number(b.retentionDays);
    check(
      Number.isInteger(value.retentionDays) &&
        value.retentionDays >= 30 &&
        value.retentionDays <= 36500,
      'Retention must be 30–36500 days',
      400,
    );
    value.templateVersion = old.templateVersion + 1;
    transaction(() => {
      Object.assign(value, preserveSettingsLinks(value, settings(), old.templateVersion));
      run('UPDATE settings SET value=? WHERE id=1', JSON.stringify(value));
      run(
        'INSERT INTO template_versions VALUES(?,?,?,?)',
        value.templateVersion,
        u.id,
        JSON.stringify(value),
        now(),
      );
      audit(u, 'settings_published', null, { version: value.templateVersion });
    });
    return reply(res, 200, value);
  }
  if (path === '/api/templates/homework-preview') {
    check(can(u, 'manage_settings'), 'Template management permission required');
    return htmlResponse(
      res,
      documentHtml(
        [homeworkSample(settings())],
        ['pdf', 'png', 'jpg'].includes(q.format) ? q.format : undefined,
        false,
      ),
    );
  }
  if (path === '/api/templates')
    return reply(
      res,
      200,
      all('SELECT * FROM template_versions ORDER BY version DESC').map((t) => ({
        ...t,
        snapshot: json(t.snapshot),
      })),
    );
  if (path === '/api/audit') {
    check(can(u, 'read_audit'), 'Audit permission required');
    const page = Math.max(1, Number(q.page) || 1);
    return reply(res, 200, {
      total: one('SELECT count(*) n FROM audit').n,
      items: all(
        'SELECT a.*,u.name actor_name FROM audit a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.created_at DESC LIMIT 100 OFFSET ?',
        (page - 1) * 100,
      ),
    });
  }
  fail(404, 'Endpoint not found');
}
function htmlResponse(res, html) {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy':
      "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' data: blob:; font-src 'self' data:; frame-ancestors 'self'",
  });
  res.end(html);
}
let activeExports = 0;
async function exportResponse(res, u, diaries, format, forceBrowser = false) {
  check(['pdf', 'png', 'jpg'].includes(format), 'Choose PDF, PNG or JPG', 400);
  check(activeExports < 2, 'Another export is running; try again shortly', 429);
  activeExports++;
  try {
    if (forceBrowser || process.env.SERVER_RENDER_EXPORTS !== 'true') {
      audit(u, 'diary_exported', diaries.length === 1 ? diaries[0].id : null, {
        ids: diaries.map((d) => d.id),
        format,
        renderer: 'browser',
      });
      return htmlResponse(
        res,
        documentHtml(
          diaries.map(diarySource),
          format,
          true,
          diaries.length === 1
            ? 'elite-scholars-' +
                diaries[0].diary_date +
                '-' +
                diaries[0].assignment.class_name +
                '-' +
                diaries[0].assignment.section_name
            : 'elite-scholars-collection-' +
                diaries[0].diary_date +
                '-' +
                diaries.at(-1).diary_date,
        ),
      );
    }
    const rendered = await renderExport(documentHtml(diaries.map(diarySource)), format);
    audit(u, 'diary_exported', diaries.length === 1 ? diaries[0].id : null, {
      ids: diaries.map((d) => d.id),
      format,
    });
    res.writeHead(200, {
      'Content-Type': rendered.type,
      'Content-Disposition': `attachment; filename="elite-scholars-${diaries.length === 1 ? diaries[0].diary_date : 'collection'}.${rendered.extension || format}"`,
      'Cache-Control': 'no-store',
    });
    res.end(rendered.buffer);
  } finally {
    activeExports--;
  }
}
export const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/'))
      return await withDatabaseContext(() => api(req, res, url));
    check(req.method === 'GET', 'Method not allowed', 405);
    const pwaAssets = {
      '/manifest.webmanifest': 'manifest.webmanifest',
      '/offline.html': 'offline.html',
      '/offline.css': 'offline.css',
      '/assets/diary-template-crest.png': 'assets/diary-template-crest.png',
      '/assets/icon-180.png': 'assets/icon-180.png',
      '/assets/icon-192.png': 'assets/icon-192.png',
      '/assets/icon-512.png': 'assets/icon-512.png',
      '/assets/fonts/NotoNaskhArabic.ttf': 'assets/fonts/NotoNaskhArabic.ttf',
      '/assets/fonts/OFL.txt': 'assets/fonts/OFL.txt',
      '/assets/fonts/SOURCE.txt': 'assets/fonts/SOURCE.txt',
    };
    const file =
      pwaAssets[url.pathname] ||
      (url.pathname === '/assets/official-school-logo.jpeg'
        ? 'assets/official-school-logo.jpeg'
        : [
                '/security-form.js',
                '/diary-monitoring.js',
                '/push-client.js',
                '/school-structure.js',
                '/school-permissions.js',
                '/admin-diagnostics.js',
                '/draft-recovery.js',
                '/diary-bulk.js',
                '/historical-display.js',
                '/api-client.js',
                '/staff-form.js',
                '/assignment-subjects.js',
                '/diary-actions.js',
                '/document-filename.js',
                '/subject-priority.js',
                '/diary-languages.js',
                '/subject-form.js',
                '/class-sections.js',
                '/school.js',
                '/sw.js',
                '/app.js',
                '/enhancements.js',
                '/render-queue.js',
                '/style.css',
                '/theme.css',
                '/setup.js',
                '/export.js',
              ].includes(url.pathname)
            ? url.pathname.slice(1)
            : 'index.html');
    const content = readFileSync(new URL(file, publicDir));
    res.writeHead(200, {
      'Content-Type': file.endsWith('.js')
        ? 'text/javascript'
        : file.endsWith('.css')
          ? 'text/css'
          : file.endsWith('.jpeg')
            ? 'image/jpeg'
            : file.endsWith('.png')
              ? 'image/png'
              : file.endsWith('.ttf')
                ? 'font/ttf'
                : file.endsWith('.webmanifest')
                  ? 'application/manifest+json'
                  : 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'",
    });
    res.end(content);
  } catch (e) {
    if (res.headersSent) {
      res.end();
      return;
    }
    const duplicate = String(e.message).includes('UNIQUE constraint');
    const status = e.status || (duplicate ? 409 : 500);
    if (status === 500) console.error(e);
    reply(res, status, {
      error: duplicate
        ? 'This record already exists.'
        : status === 500
          ? 'An internal error occurred. Please try again.'
          : e.message,
    });
  }
});
const timer = setInterval(() => {
  withDatabaseContext(async () => {
    sendDeadlineNotifications();
    await extra.school.deadlines();
    await extra.school.push.dispatch();
  }).catch((e) => console.error('Deadline notification job failed:', e.message));
}, 60000);
timer.unref();
if (process.env.NODE_ENV !== 'test')
  server.listen(Number(process.env.PORT) || 4317, process.env.HOST || '127.0.0.1', () =>
    console.log(
      `Elite Scholars running at http://${process.env.HOST || '127.0.0.1'}:${Number(process.env.PORT) || 4317}`,
    ),
  );
export async function shutdown() {
  clearInterval(timer);
  await closeRenderer();
  await new Promise((r) => server.close(r));
  db.close();
}
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => shutdown().then(() => process.exit(0)));
