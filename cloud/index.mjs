import {
  passwordHashAsync,
  passwordValidAsync,
  passwordAcceptable,
  PASSWORD_MESSAGE,
} from '../shared/passwords.mjs';
import { watchRequest } from '../shared/telemetry.mjs';
import { clientSettings } from '../shared/client-settings.mjs';
import { runBackupJob } from '../shared/backup-job.mjs';
import { assertSettingsVersion, preserveSettingsLinks } from '../shared/settings-publication.mjs';
import { readJsonBody, validateQuery } from '../shared/http-input.mjs';
import * as enhancementDb from './db.mjs';
import * as enhancementDomain from './domain.mjs';
import * as enhancementDocuments from './documents.mjs';
import { enhancements } from '../shared/enhancements.mjs';
const extra = enhancements(enhancementDb, enhancementDomain, enhancementDocuments);
import { homeworkSample } from '../shared/homework-template.mjs';
import { createCloudBackup } from './backup.mjs';
import { asyncMap, asyncFilter } from './async-arrays.mjs';
import http from 'node:http';
import { putFile, getFile, removeFile } from './storage.mjs';
import { resolve, join, basename } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  withRequestContext,
  db,
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
  publicUser,
  settings,
  audit,
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
async function userFor(req) {
  const token = /\bess_session=([^;]+)/.exec(req.headers.cookie || '')?.[1];
  if (!token) return null;
  const s = await one(
    'SELECT * FROM sessions WHERE token_hash=? AND expires_at>?',
    hash(token),
    now(),
  );
  if (!s) return null;
  const u = await one('SELECT * FROM users WHERE id=? AND active=1', s.user_id);
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
  return `ess_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${process.env.COOKIE_SECURE !== 'false' ? '; Secure' : ''}`;
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
async function visibleUsers(u) {
  if (u.role === 'teacher') return [publicUser(u)];
  if (can(u, 'manage_users') || can(u, 'read_all'))
    return (await all('SELECT * FROM users')).map(publicUser);
  const as = await visibleAssignments(u),
    ids = new Set([u.id, ...as.flatMap((a) => [a.teacher_id, a.head_id])]);
  if (u.role === 'teacher') return [publicUser(u)];
  return (await all('SELECT * FROM users')).filter((x) => ids.has(x.id)).map(publicUser);
}
async function ownQuote(u, q) {
  check(q && (await quoteScope(u, q)), 'Quote not found', 404);
  check(
    can(u, 'manage_quotes') || can(u, 'manage_quotes_all'),
    'Quote management permission required',
  );
  check(
    q.scope_id !== null || can(u, 'manage_quotes_all'),
    'School-wide quote permission required',
  );
}
async function validateAssignment(u, b) {
  for (const k of ['teacher_id', 'head_id', 'section_id', 'subject_id', 'session_id'])
    check(typeof b[k] === 'string', `${k} is required`, 400);
  const section = await one(
    "SELECT parent_id FROM academics WHERE id=? AND kind='section'",
    b.section_id,
  );
  check(
    section &&
      (await one(
        'SELECT 1 FROM class_subjects WHERE class_id=? AND subject_id=?',
        section.parent_id,
        b.subject_id,
      )),
    'Subject must be linked to this class in Academic Setup',
    400,
  );
  const t = await one('SELECT * FROM users WHERE id=? AND active=1', b.teacher_id),
    h = await one('SELECT * FROM users WHERE id=? AND active=1', b.head_id);
  check(t && h && h.role === 'head_teacher', 'Active teacher and Head Teacher required', 400);
  check(t.id !== h.id, 'Assign a separate reviewer', 400);
  for (const [key, kind] of [
    ['section_id', 'section'],
    ['subject_id', 'subject'],
    ['session_id', 'session'],
  ])
    check(
      await one('SELECT id FROM academics WHERE id=? AND kind=? AND active=1', b[key], kind),
      `Invalid ${kind}`,
      400,
    );
  check(
    validDate(b.start_date) && validDate(b.end_date) && b.start_date <= b.end_date,
    'Valid assignment dates required',
    400,
  );
  const ses = await one('SELECT * FROM academics WHERE id=?', b.session_id);
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
    b = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
      ? await readJsonBody(req, { parsedMaxBytes: 4400000 })
      : {},
    q = validateQuery(Object.fromEntries(url.searchParams));
  let u = await userFor(req);
  if (u) Object.assign(u, await extra.school.security.status(u.id));
  if (method !== 'GET') {
    const origin = req.headers.origin,
      expectedOrigin = process.env.PUBLIC_ORIGIN || `https://${req.headers.host}`;
    check(!origin || origin === expectedOrigin, 'Untrusted request origin');
  }
  if (path === '/api/health')
    return reply(res, 200, { ok: true, configured: !!(await one('SELECT id FROM users LIMIT 1')) });
  if (path === '/api/login' && method === 'POST') {
    check(
      typeof b.email === 'string' && typeof b.password === 'string' && b.password.length <= 128,
      'Email and password required',
      400,
    );
    const window = Math.floor(Date.now() / 900000),
      loginAccount = 'login-account:' + hash(b.email.trim().toLowerCase()),
      loginIp =
        'login-ip:' +
        hash(String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown'));
    for (const [key, max] of [
      [loginAccount, 12],
      [loginIp, 100],
    ]) {
      const failures = await one(
        'SELECT count FROM rate_limits WHERE key=? AND window_start=?',
        key,
        window,
      );
      check(
        !failures || Number(failures.count) < max,
        'Too many failed attempts. Try again in 15 minutes.',
        429,
      );
    }
    u = await one('SELECT * FROM users WHERE email=? COLLATE NOCASE', b.email.trim().toLowerCase());
    const fallback = 'a'.repeat(32) + ':' + '0'.repeat(128);
    const valid = await passwordValidAsync(b.password, u?.password || fallback);
    if (!u?.active || !valid) {
      await persistentThrottle(loginAccount, 12);
      await persistentThrottle(loginIp, 100);
      fail(401, 'Invalid email or password');
    }
    try {
      await extra.school.security.factor(u, b.otp);
    } catch (error) {
      if (error.status === 401) {
        await persistentThrottle(loginAccount, 12);
        await persistentThrottle(loginIp, 100);
      }
      throw error;
    }
    await run('DELETE FROM rate_limits WHERE key=? AND window_start=?', loginAccount, window);
    const token = randomBytes(32).toString('hex'),
      csrf = randomBytes(24).toString('hex');
    await run('DELETE FROM sessions WHERE expires_at<=?', now());
    await run('DELETE FROM rate_limits WHERE window_start<?', window - 2);
    await run(
      'INSERT INTO sessions VALUES(?,?,?,?)',
      hash(token),
      u.id,
      csrf,
      new Date(Date.now() + sessionsHours * 3600000).toISOString(),
    );
    await audit(u, 'login', u.id);
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
    await run(
      'DELETE FROM sessions WHERE token_hash=?',
      hash(/\bess_session=([^;]+)/.exec(req.headers.cookie || '')?.[1] || ''),
    );
    await audit(u, 'logout', u.id);
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
        await run(
          'UPDATE users SET password=? WHERE id=?',
          await passwordHashAsync(b.newPassword),
          u.id,
        );
        await run(
          'DELETE FROM sessions WHERE user_id=? AND token_hash<>?',
          u.id,
          hash(/\bess_session=([^;]+)/.exec(req.headers.cookie || '')?.[1] || ''),
        );
      }
      await run('UPDATE users SET name=?,updated_at=? WHERE id=?', b.name.trim(), now(), u.id);
      if (b.newPassword) await extra.school.security.passwordChanged(u.id);
      await audit(u, 'profile_updated', u.id);
    });
    return reply(res, 200, { ok: true });
  }
  if (path === '/api/lookups') {
    const as = await visibleAssignments(u);
    const ids = new Set(
      as.flatMap((a) => [a.section_id, a.subject_id, a.session_id, a.department_id]),
    );
    let academics = await all('SELECT * FROM academics ORDER BY kind,name');
    const parents = new Set(academics.filter((a) => ids.has(a.id)).map((a) => a.parent_id));
    if (!can(u, 'manage_academics') && !can(u, 'read_all'))
      academics = academics.filter((a) => ids.has(a.id) || parents.has(a.id));
    return reply(res, 200, {
      academics,
      assignments: as,
      users: await visibleUsers(u),
      coordinatorHeads: (await all('SELECT * FROM coordinator_heads')).filter(
        (x) => can(u, 'manage_users') || x.coordinator_id === u.id,
      ),
      exceptions: (await all('SELECT * FROM calendar_exceptions')).filter(
        (x) => !x.assignment_id || as.some((a) => a.id === x.assignment_id),
      ),
    });
  }
  if (path === '/api/dashboard') {
    await sendDeadlineNotifications();
    const date = q.date || dateInZone(),
      slots = await expected(u, date, date),
      ds = await listDiaries(u, { start: date, end: date });
    return reply(res, 200, {
      date,
      slots,
      diaries: ds,
      quotes: await selectQuotes(u, date),
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
    const list = await listDiaries(u, q),
      page = Math.max(1, Number(q.page) || 1);
    return reply(res, 200, {
      total: list.length,
      page,
      pageSize: 30,
      items: list.slice((page - 1) * 30, page * 30),
    });
  }
  if (path === '/api/diaries' && method === 'POST') return reply(res, 201, await saveDiary(u, b));
  const dm =
    /^\/api\/diaries\/([\w-]+)(?:\/(review|amend|versions|attachments|preview|print|export))?$/.exec(
      path,
    );
  if (dm) {
    const [, did, action] = dm,
      d = await diary(u, did);
    if (!action && method === 'GET')
      return reply(res, 200, {
        ...d,
        attachments: await all(
          'SELECT id,name,mime,size,created_at FROM attachments WHERE diary_id=?',
          did,
        ),
        reviews: await all(
          'SELECT r.*,a.name actor_name FROM reviews r JOIN users a ON a.id=r.actor_id WHERE diary_id=? ORDER BY created_at',
          did,
        ),
        canReview:
          (await reviewScope(u, d.assignment)) &&
          (settings().allowSelfApproval || u.id !== d.teacher_id),
        canExport: exportAllowed(u, d),
        canAmend: can(u, 'amend'),
      });
    if (!action && method === 'PUT') return reply(res, 200, await saveDiary(u, b, did));
    if (action === 'review' && method === 'POST')
      return reply(res, 200, await reviewDiary(u, did, b));
    if (action === 'amend' && method === 'POST')
      return reply(res, 200, await amendDiary(u, did, b));
    if (action === 'versions')
      return reply(
        res,
        200,
        (
          await all(
            'SELECT v.*,a.name actor_name FROM diary_versions v JOIN users a ON a.id=v.actor_id WHERE diary_id=? ORDER BY version DESC',
            did,
          )
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
        bytes.length > 0 && bytes.length <= 3 * 1024 * 1024,
        'Files must be 1 byte to 3 MB on the hosted app',
        400,
      );
      const isPng = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
        isJpg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
        isPdf = bytes.subarray(0, 5).toString() === '%PDF-';
      const mime = isPng ? 'image/png' : isJpg ? 'image/jpeg' : isPdf ? 'application/pdf' : null;
      check(mime && mime === b.mime, 'Only verified PNG, JPG and PDF content is accepted', 400);
      const fileId = id(),
        key = fileId + '.bin';
      await putFile(key, bytes, mime);
      try {
        await transaction(async () => {
          await run(
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
          await audit(u, 'attachment_uploaded', did, { fileId, checksum: hash(bytes) });
        });
      } catch (e) {
        await removeFile(key).catch(() => {});
        throw e;
      }
      return reply(res, 201, { id: fileId });
    }
    if (action === 'preview') {
      return htmlResponse(
        res,
        documentHtml([await diarySource(d)], undefined, exportAllowed(u, d)),
      );
    }
    if (action === 'print') {
      check(exportAllowed(u, d), 'Print permission required');
      await audit(u, 'diary_printed', d.id);
      return htmlResponse(res, documentHtml([await diarySource(d)]));
    }
    if (action === 'export') {
      check(exportAllowed(u, d), 'Export permission required');
      return await exportResponse(res, u, [d], q.format || 'pdf', !!q.__diary_action);
    }
  }
  const attachment = /^\/api\/attachments\/([\w-]+)$/.exec(path);
  if (attachment && method === 'GET') {
    const f = await one('SELECT * FROM attachments WHERE id=?', attachment[1]);
    check(f, 'File not found', 404);
    const d = await diary(u, f.diary_id);
    check(exportAllowed(u, d), 'Download permission required');
    const bytes = await getFile(f.object_key);
    check(hash(bytes) === f.checksum, 'Attachment checksum mismatch', 500);
    await audit(u, 'attachment_downloaded', d.id, { fileId: f.id });
    res.writeHead(200, {
      'Content-Type': f.mime,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      'Cache-Control': 'no-store',
    });
    return res.end(bytes);
  }
  if (path === '/api/export' && method === 'GET') {
    check(can(u, 'export'), 'Export permission required');
    const ds = await listDiaries(u, q);
    check(ds.length > 0, 'No matching diaries', 404);
    check(ds.length <= 200, 'Choose at most 200 diaries per export', 400);
    return await exportResponse(res, u, ds, q.format || 'pdf', !!q.__diary_action);
  }
  if (path === '/api/reports') {
    const start = q.start || dateInZone(),
      end = q.end || start;
    let slots = await asyncFilter(
      await expected(u, start, end),
      async (s) =>
        (!q.teacher || s.teacher_id === q.teacher) &&
        (!q.class || s.class_name === q.class) &&
        (!q.section ||
          (await visibleAssignments(u)).find((a) => a.id === s.assignment_id)?.section_id ===
            q.section) &&
        (!q.subject ||
          (await visibleAssignments(u)).find((a) => a.id === s.assignment_id)?.subject_id ===
            q.subject) &&
        (!q.department || s.department_id === q.department) &&
        (!q.session ||
          (await visibleAssignments(u)).find((a) => a.id === s.assignment_id)?.session_id ===
            q.session) &&
        (!q.status || (q.status === 'overdue' ? s.overdue : s.status === q.status)),
    );
    const ds = await listDiaries(u, { ...q, start, end });
    if (q.format === 'pdf') {
      check(can(u, 'export'), 'Export permission required');
      const reportHtml = documentHtml(
        [reportSource(slots, 'Submission & Teaching Progress Report')],
        !q.__diary_action && process.env.SERVER_RENDER_EXPORTS === 'true' ? undefined : 'pdf',
      );
      if (q.__diary_action || process.env.SERVER_RENDER_EXPORTS !== 'true') {
        await audit(u, 'report_exported', null, {
          start,
          end,
          rows: slots.length,
          renderer: 'browser',
        });
        return htmlResponse(res, reportHtml);
      }
      const rendered = await renderExport(reportHtml, 'pdf');
      await audit(u, 'report_exported', null, { start, end, rows: slots.length });
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
      await audit(u, 'report_exported', null, { start, end, rows: slots.length, format: 'csv' });
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
      await all(
        'SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 300',
        u.id,
      ),
    );
  if (path === '/api/notifications' && method === 'PATCH') {
    if (b.id)
      await run('UPDATE notifications SET read_at=? WHERE id=? AND user_id=?', now(), b.id, u.id);
    else
      await run(
        'UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL',
        now(),
        u.id,
      );
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
      const created = await createUser({ ...b, name: b.name.trim(), permissions });
      await extra.school.security.issueTemporary(created.id, b.password);
      await audit(u, 'user_created', created.id, { role: b.role, permissions });
      return created;
    });
    return reply(res, 201, publicUser(created));
  }
  if (path === '/api/hierarchy' && method === 'POST') {
    check(can(u, 'manage_users'), 'User management permission required');
    check(
      (await one(
        "SELECT 1 FROM users WHERE id=? AND role='coordinator' AND active=1",
        b.coordinator_id,
      )) &&
        (await one(
          "SELECT 1 FROM users WHERE id=? AND role='head_teacher' AND active=1",
          b.head_id,
        )),
      'Active Coordinator and Head required',
      400,
    );
    await run('INSERT OR IGNORE INTO coordinator_heads VALUES(?,?)', b.coordinator_id, b.head_id);
    await audit(u, 'hierarchy_assigned', b.coordinator_id, { head: b.head_id });
    return reply(res, 201, { ok: true });
  }
  if (path === '/api/hierarchy' && method === 'DELETE') {
    check(can(u, 'manage_users'), 'User management permission required');
    await run(
      'DELETE FROM coordinator_heads WHERE coordinator_id=? AND head_id=?',
      q.coordinator_id || '',
      q.head_id || '',
    );
    await audit(u, 'hierarchy_removed', q.coordinator_id, { head: q.head_id });
    return reply(res, 200, { ok: true });
  }
  if (path === '/api/assignments' && method === 'POST') {
    check(can(u, 'manage_academics'), 'Academic management permission required');
    await validateAssignment(u, b);
    const aid = id();
    await run(
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
    await audit(u, 'assignment_created', aid);
    return reply(res, 201, { id: aid });
  }
  const asm = /^\/api\/assignments\/([\w-]+)$/.exec(path);
  if (asm && method === 'PATCH') {
    check(can(u, 'manage_academics'), 'Academic management permission required');
    const a = await one('SELECT * FROM assignments WHERE id=?', asm[1]);
    check(a, 'Assignment not found', 404);
    if (b.active !== undefined) {
      await transaction(async () => {
        await run('UPDATE assignments SET active=? WHERE id=?', Number(!!b.active), a.id);
        await run(
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
        !(await one(
          'SELECT 1 FROM school_diaries WHERE teacher_id=? AND section_id=?',
          a.teacher_id,
          a.section_id,
        )) && !(await one('SELECT 1 FROM diaries WHERE assignment_id=?', a.id)),
        'Assignment with history is immutable; archive and create a replacement',
        409,
      );
      await validateAssignment(u, b);
      await run(
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
    await audit(u, 'assignment_updated', a.id);
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
    if (b.assignment_id) await assignment(u, b.assignment_id);
    const eid = id();
    await run(
      'INSERT INTO calendar_exceptions VALUES(?,?,?,?)',
      eid,
      b.date,
      b.assignment_id || null,
      b.reason.trim(),
    );
    await audit(u, 'calendar_exception_created', eid);
    return reply(res, 201, { id: eid });
  }
  const ex = /^\/api\/exceptions\/([\w-]+)$/.exec(path);
  if (ex && method === 'DELETE') {
    check(can(u, 'manage_academics'), 'Academic management permission required');
    await run('DELETE FROM calendar_exceptions WHERE id=?', ex[1]);
    await audit(u, 'calendar_exception_removed', ex[1]);
    return reply(res, 200, { ok: true });
  }
  if (path === '/api/quotes' && method === 'GET')
    return reply(res, 200, {
      quotes: await asyncFilter(
        await all('SELECT * FROM quotes ORDER BY updated_at DESC'),
        async (x) => await quoteScope(u, x),
      ),
      schedules: await asyncFilter(
        await all(
          'SELECT s.*,q.text,q.language FROM quote_schedules s JOIN quotes q ON q.id=s.quote_id',
        ),
        async (x) =>
          (await quoteScope(u, await one('SELECT * FROM quotes WHERE id=?', x.quote_id))) &&
          (!x.scope_id || (await quoteScope(u, { scope_id: x.scope_id }))),
      ),
    });
  if (path === '/api/quotes' && method === 'POST') {
    check(
      can(u, 'manage_quotes') || can(u, 'manage_quotes_all'),
      'Quote management permission required',
    );
    const scope = b.scope_id || null;
    check(scope || can(u, 'manage_quotes_all'), 'School-wide quote permission required');
    check(
      !scope || (await one('SELECT 1 FROM users WHERE id=?', scope)),
      'Invalid quote scope',
      400,
    );
    check(await quoteScope(u, { scope_id: scope }), 'Quote scope is outside your responsibility');
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
    await run(
      'INSERT INTO quotes VALUES(?,?,?,?,1,?,?,?)',
      qid,
      b.text.trim(),
      b.language,
      b.direction,
      scope,
      u.id,
      now(),
    );
    await audit(u, 'quote_created', qid);
    return reply(res, 201, { id: qid });
  }
  const qm = /^\/api\/quotes\/([\w-]+)$/.exec(path);
  if (qm && method === 'PATCH') {
    const quote = await one('SELECT * FROM quotes WHERE id=?', qm[1]);
    await ownQuote(u, quote);
    const text = b.text ?? quote.text;
    check(
      typeof text === 'string' && text.trim() && text.length <= 1200,
      'Quote text required (max 1200 characters)',
      400,
    );
    await run(
      'UPDATE quotes SET text=?,active=?,updated_at=? WHERE id=?',
      text.trim(),
      b.active === undefined ? quote.active : Number(!!b.active),
      now(),
      quote.id,
    );
    await audit(u, 'quote_updated', quote.id);
    return reply(res, 200, { ok: true });
  }
  if (path === '/api/quote-schedules' && method === 'POST') {
    const quote = await one('SELECT * FROM quotes WHERE id=?', b.quote_id);
    await ownQuote(u, quote);
    check(validDate(b.date), 'Valid schedule date required', 400);
    const scope = b.scope_id || quote.scope_id || null;
    check(!scope || (await one('SELECT 1 FROM users WHERE id=?', scope)), 'Invalid scope', 400);
    check(scope || can(u, 'manage_quotes_all'), 'School-wide schedule permission required');
    check(await quoteScope(u, { scope_id: scope }), 'Scope is outside your responsibility');
    check(
      Number.isInteger(Number(b.priority)) && Math.abs(Number(b.priority)) <= 1000,
      'Priority must be an integer from -1000 to 1000',
      400,
    );
    const sid = id();
    await run(
      'INSERT INTO quote_schedules VALUES(?,?,?,?,?)',
      sid,
      quote.id,
      b.date,
      scope,
      Number(b.priority),
    );
    await audit(u, 'quote_scheduled', sid);
    return reply(res, 201, { id: sid });
  }
  const qs = /^\/api\/quote-schedules\/([\w-]+)$/.exec(path);
  if (qs && method === 'DELETE') {
    const s = await one('SELECT * FROM quote_schedules WHERE id=?', qs[1]);
    check(s, 'Schedule not found', 404);
    await ownQuote(u, await one('SELECT * FROM quotes WHERE id=?', s.quote_id));
    await run('DELETE FROM quote_schedules WHERE id=?', s.id);
    await audit(u, 'quote_schedule_removed', s.id);
    return reply(res, 200, { ok: true });
  }
  if (path === '/api/settings' && method === 'GET') {
    const { diaryNotice: _notice, diaryNotices: _notices, ...publicSettings } = settings();
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
    await transaction(async () => {
      Object.assign(
        value,
        preserveSettingsLinks(
          value,
          json((await one('SELECT value FROM settings WHERE id=1')).value),
          old.templateVersion,
        ),
      );
      await run('UPDATE settings SET value=? WHERE id=1', JSON.stringify(value));
      await run(
        'INSERT INTO template_versions VALUES(?,?,?,?)',
        value.templateVersion,
        u.id,
        JSON.stringify(value),
        now(),
      );
      await audit(u, 'settings_published', null, { version: value.templateVersion });
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
      (await all('SELECT * FROM template_versions ORDER BY version DESC')).map((t) => ({
        ...t,
        snapshot: json(t.snapshot),
      })),
    );
  if (path === '/api/audit') {
    check(can(u, 'read_audit'), 'Audit permission required');
    const page = Math.max(1, Number(q.page) || 1);
    return reply(res, 200, {
      total: (await one('SELECT count(*) n FROM audit')).n,
      items: await all(
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
      await audit(u, 'diary_exported', diaries.length === 1 ? diaries[0].id : null, {
        ids: diaries.map((d) => d.id),
        format,
        renderer: 'browser',
      });
      return htmlResponse(
        res,
        documentHtml(
          await asyncMap(diaries, diarySource),
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
    const rendered = await renderExport(documentHtml(await asyncMap(diaries, diarySource)), format);
    await audit(u, 'diary_exported', diaries.length === 1 ? diaries[0].id : null, {
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

// ---- Deployment health and first-run setup (no command line needed on Vercel) ----
import { timingSafeEqual } from 'node:crypto';
async function healthStatus() {
  const status = {
    ok: true,
    database: false,
    schema: false,
    configured: false,
    setupEnabled: String(process.env.SETUP_TOKEN || '').length >= 16,
    publicOrigin: Boolean(process.env.PUBLIC_ORIGIN),
    cronSecret: Boolean(process.env.CRON_SECRET),
    backups: Boolean(process.env.BACKUP_ENCRYPTION_KEY && process.env.SUPABASE_URL),
  };
  if (!process.env.DATABASE_URL)
    return { ...status, ok: false, hint: 'DATABASE_URL is missing in Vercel environment variables.' };
  try {
    await one('SELECT 1 AS n');
    status.database = true;
  } catch {
    return { ...status, ok: false, hint: 'The database could not be reached. Check DATABASE_URL.' };
  }
  try {
    status.configured = Boolean(await one("SELECT 1 AS n FROM users WHERE role='super_admin' LIMIT 1"));
    status.schema = true;
  } catch {
    return { ...status, ok: false, hint: 'Database tables are missing. Run database/setup.sql once.' };
  }
  return status;
}
async function firstRunSetup(req, res) {
  const expectedOrigin = process.env.PUBLIC_ORIGIN || `https://${req.headers.host}`;
  check(!req.headers.origin || req.headers.origin === expectedOrigin, 'Untrusted request origin');
  const secret = String(process.env.SETUP_TOKEN || '');
  check(
    secret.length >= 16,
    'Setup is disabled. Add SETUP_TOKEN (16+ characters) in Vercel and redeploy.',
    503,
  );
  const b = await readJsonBody(req, { parsedMaxBytes: 20000 });
  await persistentThrottle('setup', 10);
  const a = Buffer.from(hash(String(b.token || ''))),
    z = Buffer.from(hash(secret));
  check(a.length === z.length && timingSafeEqual(a, z), 'Setup key is not correct.', 403);
  check(
    typeof b.name === 'string' && b.name.trim().length >= 2 && b.name.length <= 120,
    'Name must contain 2–120 characters',
    400,
  );
  check(
    typeof b.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email) && b.email.length <= 254,
    'Enter a valid email address',
    400,
  );
  check(
    passwordAcceptable(b.password),
      PASSWORD_MESSAGE,
    400,
  );
  await transaction(async () => {
    check(
      !(await one("SELECT 1 AS n FROM users WHERE role='super_admin'")),
      'A Super Admin already exists. Sign in instead.',
      409,
    );
    await createUser({ name: b.name.trim(), email: b.email.trim(), password: b.password, role: 'super_admin' });
  });
  await audit(null, 'first_run_setup_completed', null, {});
  return reply(res, 201, { ok: true });
}

export async function handler(req, res) {
  watchRequest(req, res);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  try {
    const url = new URL(req.url, 'https://localhost');
    if (url.pathname === '/api/index' && url.searchParams.has('__route')) {
      const route = url.searchParams.get('__route');
      check(
        route && route.length <= 300 && /^[\w-]+(?:\/[\w-]+)*$/.test(route),
        'Invalid API route',
        400,
      );
      url.pathname = '/api/' + route;
      url.searchParams.delete('__route');
    }
    if (url.pathname === '/api/health' && req.method === 'GET')
      return reply(res, 200, await healthStatus());
    if (url.pathname === '/api/setup' && req.method === 'POST')
      return await firstRunSetup(req, res);
    if (url.pathname === '/api/cron/backup') {
      if (!process.env.BACKUP_ENCRYPTION_KEY || !process.env.SUPABASE_URL)
        return reply(res, 200, { ok: true, skipped: 'Backups are not configured.' });
      check(
        process.env.CRON_SECRET &&
          req.headers.authorization === 'Bearer ' + process.env.CRON_SECRET,
        'Cron authorization required',
      );
      return reply(res, 200, await runBackupJob(createCloudBackup, audit));
    }
    if (url.pathname === '/api/cron/deadlines') {
      check(
        process.env.CRON_SECRET &&
          req.headers.authorization === 'Bearer ' + process.env.CRON_SECRET,
        'Cron authorization required',
      );
      await withRequestContext(async () => {
        await sendDeadlineNotifications();
        await extra.school.deadlines();
      });
      const push = await extra.school.push.dispatch();
      await audit(null, 'deadlines_completed', null, { push_sent: push.sent || 0 });
      return reply(res, 200, { ok: true, push });
    }
    return await withRequestContext(() => api(req, res, url));
  } catch (e) {
    if (res.headersSent) {
      res.end();
      return;
    }
    const duplicate = e.code === '23505' || String(e.message).includes('UNIQUE constraint');
    const conflict = ['40001', '40P01'].includes(e.code);
    const status = e.status || (duplicate || conflict ? 409 : 500);
    if (status === 500) console.error('Request failed:', e.code || 'internal');
    reply(res, status, {
      error: duplicate
        ? 'This record already exists.'
        : conflict
          ? 'Another update occurred. Reload before saving.'
          : status === 500
            ? 'An internal error occurred. Please try again.'
            : e.message,
    });
  }
}
export const server = process.env.NODE_ENV === 'test' ? http.createServer(handler) : null;
export async function shutdown() {
  await closeRenderer();
  if (server) await new Promise((resolve) => server.close(resolve));
  await db.close();
}
export default handler;
async function persistentThrottle(key, max = 12) {
  const window = Math.floor(Date.now() / 900000);
  const count = await one(
    'INSERT INTO rate_limits(key,window_start,count) VALUES(?,?,1) ON CONFLICT(key,window_start) DO UPDATE SET count=rate_limits.count+1 RETURNING count',
    key,
    window,
  );
  check(count.count <= max, 'Too many failed attempts. Try again in 15 minutes.', 429);
}
