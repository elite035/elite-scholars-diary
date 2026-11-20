import { USER_COLUMNS } from '../shared/user-columns.mjs';
import { businessNow } from '../shared/clock.mjs';
import { assignedHomework } from '../shared/diary-rules.mjs';
import { normalizeHomework } from '../shared/homework-template.mjs';
import { all, one, run, json, settings, id, now, audit, notify, transaction } from './db.mjs';
export const roles = [
  'super_admin',
  'school_admin',
  'coordinator',
  'head_teacher',
  'teacher',
  'parent',
];
export const fields = [
  'topic',
  'chapter',
  'previous_revision',
  'todays_lesson',
  'learning_objectives',
  'classwork',
  'homework',
  'learning_activities',
  'syllabus_progress',
  'student_participation',
  'difficulties',
  'next_lesson_plan',
  'present',
  'absent',
  'assessment',
  'observations',
  'resources',
];
export function fail(status, message) {
  const e = new Error(message);
  e.status = status;
  throw e;
}
export function check(ok, message = 'Access denied', status = 403) {
  if (!ok) fail(status, message);
}
export function can(u, p) {
  return u.role === 'super_admin' || json(u.permissions).includes(p);
}
export function validDate(s) {
  return (
    typeof s === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    !Number.isNaN(Date.parse(s)) &&
    new Date(s).toISOString().slice(0, 10) === s
  );
}
export function validTime(s) {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}
export function dateInZone(date = businessNow(), zone = settings().timezone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}
export function zoneTimestamp(date, time, zone = settings().timezone) {
  let guess = new Date(`${date}T${time}:00Z`).getTime();
  const target = guess;
  for (let i = 0; i < 4; i++) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(guess));
    const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
    const actual = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
    const correction = target - actual;
    if (!correction) break;
    guess += correction;
  }
  return new Date(guess).toISOString();
}
export function assignmentScope(u, a) {
  if (
    a.teacher_id === u.id ||
    (['super_admin', 'school_admin', 'coordinator', 'head_teacher'].includes(u.role) &&
      can(u, 'read_all'))
  )
    return true;
  const link = one(
    "SELECT r.head_id FROM teacher_reviewers r JOIN users h ON h.id=r.head_id WHERE r.teacher_id=? AND h.active=1 AND h.role='head_teacher'",
    a.teacher_id,
  );
  if (!link) return false;
  return (
    (u.role === 'head_teacher' && link.head_id === u.id) ||
    (u.role === 'coordinator' &&
      !!one(
        'SELECT 1 FROM coordinator_heads WHERE coordinator_id=? AND head_id=?',
        u.id,
        link.head_id,
      ))
  );
}
export function reviewScope(u, a) {
  return (
    can(u, 'review_all') ||
    (['head_teacher', 'coordinator'].includes(u.role) &&
      assignmentScope(u, a) &&
      a.teacher_id !== u.id)
  );
}
export function visibleAssignments(u) {
  return all(
    `SELECT a.*,t.name teacher_name,h.name head_name,s.name section_name,c.name class_name,sub.name subject_name,sub.parent_id department_id,se.name session_name FROM assignments a JOIN users t ON t.id=a.teacher_id JOIN users h ON h.id=a.head_id JOIN academics s ON s.id=a.section_id LEFT JOIN academics c ON c.id=s.parent_id JOIN academics sub ON sub.id=a.subject_id JOIN academics se ON se.id=a.session_id`,
  )
    .filter((a) => assignmentScope(u, a))
    .map((a) => ({ ...a, weekdays: json(a.weekdays), periods: json(a.periods) }));
}
export function assignment(u, aid) {
  const a = visibleAssignments(u).find((a) => a.id === aid);
  check(a, 'Assignment not found', 404);
  return a;
}
export function diary(u, did) {
  const d = one('SELECT * FROM diaries WHERE id=?', did);
  check(d, 'Diary not found', 404);
  const a = assignment(u, d.assignment_id);
  return {
    ...d,
    force_deleted: !!one(
      "SELECT 1 FROM audit WHERE action='record_force_deleted' AND resource_id=?",
      'legacy_diary:' + did,
    ),
    reviewed_by_name: d.reviewed_by
      ? one('SELECT name FROM users WHERE id=?', d.reviewed_by)?.name
      : null,
    content: json(d.content),
    quote_snapshot: json(d.quote_snapshot),
    template_snapshot: json(d.template_snapshot),
    assignment: a,
  };
}
export function exportAllowed(u, d) {
  return can(u, 'export') || u.role === 'super_admin';
}
export function quoteScope(u, q) {
  return (
    q.scope_id === null ||
    q.scope_id === u.id ||
    can(u, 'manage_quotes_all') ||
    (u.role === 'head_teacher' &&
      !!one('SELECT 1 FROM assignments WHERE teacher_id=? AND head_id=?', q.scope_id, u.id)) ||
    (u.role === 'coordinator' &&
      !!one(
        'SELECT 1 FROM coordinator_heads ch LEFT JOIN assignments a ON a.head_id=ch.head_id WHERE ch.coordinator_id=? AND (ch.head_id=? OR a.teacher_id=?)',
        u.id,
        q.scope_id,
        q.scope_id,
      ))
  );
}
export function selectQuotes(u, date) {
  const visible = new Set(visibleAssignments(u).flatMap((a) => [a.teacher_id, a.head_id]));
  visible.add(u.id);
  const qs = all(
    `SELECT q.*,s.priority,s.id schedule_id,s.scope_id schedule_scope FROM quote_schedules s JOIN quotes q ON q.id=s.quote_id WHERE s.date=? AND q.active=1 ORDER BY s.priority DESC,s.id`,
    date,
  ).filter(
    (q) =>
      (!q.scope_id || visible.has(q.scope_id)) &&
      (!q.schedule_scope || visible.has(q.schedule_scope)),
  );
  const langs = new Set();
  return qs
    .filter((q) => {
      if (langs.has(q.language)) return false;
      langs.add(q.language);
      return true;
    })
    .map((q) => ({ id: q.id, text: q.text, language: q.language, direction: q.direction }));
}
export function validateContent(content, submit) {
  check(
    content && typeof content === 'object' && !Array.isArray(content),
    'Invalid diary content',
    400,
  );
  const result = {};
  for (const key of fields) {
    const value = content[key] ?? '';
    check(typeof value === 'string' && value.length <= 30000, `Invalid or too long: ${key}`, 400);
    result[key] = value.trim();
  }
  for (const key of ['present', 'absent'])
    check(
      result[key] === '' || /^\d{1,4}$/.test(result[key]),
      'Attendance must be a nonnegative whole number',
      400,
    );
  Object.assign(result, normalizeHomework(content, submit, check));
  if (result.diary_layout === 'homework_grid') result.topic = result.topic || 'Daily Homework';
  else if (submit)
    for (const key of settings().requiredFields)
      check(result[key]?.trim(), `${key.replaceAll('_', ' ')} is required`, 400);
  return result;
}
export function expected(u, start, end, clock = new Date()) {
  check(validDate(start) && validDate(end) && start <= end, 'Invalid date range', 400);
  check((Date.parse(end) - Date.parse(start)) / 86400000 <= 366, 'Select at most 367 days', 400);
  const as = visibleAssignments(u);
  const stateEvents = all(
    'SELECT * FROM assignment_state_events ORDER BY effective_date DESC,created_at DESC',
  );
  const exceptions = all(
    'SELECT * FROM calendar_exceptions WHERE date BETWEEN ? AND ?',
    start,
    end,
  );
  const diaries = all(
    'SELECT id,assignment_id,diary_date,period,status,submitted_at FROM diaries WHERE diary_date BETWEEN ? AND ?',
    start,
    end,
  );
  const map = new Map(diaries.map((d) => [`${d.assignment_id}:${d.diary_date}:${d.period}`, d]));
  const result = [];
  for (let day = Date.parse(start); day <= Date.parse(end); day += 86400000) {
    const date = new Date(day).toISOString().slice(0, 10);
    for (const a of as) {
      const latest = stateEvents.find((e) => e.assignment_id === a.id && e.effective_date <= date);
      const active = latest
        ? latest.active
        : stateEvents.some((e) => e.assignment_id === a.id)
          ? 1
          : a.active;
      if (!active) continue;
      if (
        date < a.start_date ||
        date > a.end_date ||
        !a.weekdays.includes(new Date(day).getUTCDay()) ||
        exceptions.some((e) => e.date === date && (!e.assignment_id || e.assignment_id === a.id))
      )
        continue;
      for (const period of a.periods) {
        const d = map.get(`${a.id}:${date}:${period}`);
        const due = zoneTimestamp(date, a.due_time),
          reviewDue = zoneTimestamp(date, a.review_time);
        result.push({
          assignment_id: a.id,
          teacher_id: a.teacher_id,
          teacher_name: a.teacher_name,
          class_name: a.class_name,
          section_name: a.section_name,
          subject_name: a.subject_name,
          session_name: a.session_name,
          department_id: a.department_id,
          date,
          period,
          due_at: due,
          review_due_at: reviewDue,
          diary_id: d?.id || null,
          status: d?.status || 'not_submitted',
          submitted: !!d?.submitted_at,
          overdue: clock > new Date(due) && !d?.submitted_at,
          late: !!d?.submitted_at && d.submitted_at > due,
        });
      }
    }
  }
  return result;
}
export function listDiaries(u, filters = {}) {
  const removed = new Set(
    all("SELECT resource_id FROM audit WHERE action='record_force_deleted'").map(
      (x) => x.resource_id,
    ),
  );
  const as = new Map(visibleAssignments(u).map((a) => [a.id, a]));
  return all('SELECT * FROM diaries ORDER BY diary_date DESC,created_at DESC')
    .filter((d) => as.has(d.assignment_id) && !removed.has('legacy_diary:' + d.id))
    .map((d) => ({
      ...d,
      content: json(d.content),
      quote_snapshot: json(d.quote_snapshot),
      template_snapshot: json(d.template_snapshot),
      assignment: as.get(d.assignment_id),
    }))
    .filter(
      (d) =>
        (filters.review_queue !== 'true' ||
          (reviewScope(u, d.assignment) &&
            d.teacher_id !== u.id &&
            ['submitted', 'resubmitted', 'under_review'].includes(d.status))) &&
        (!filters.start || d.diary_date >= filters.start) &&
        (!filters.end || d.diary_date <= filters.end) &&
        (!filters.teacher || d.teacher_id === filters.teacher) &&
        (!filters.class || d.assignment.class_name === filters.class) &&
        (!filters.section || d.assignment.section_id === filters.section) &&
        (!filters.subject || d.assignment.subject_id === filters.subject) &&
        (!filters.department || d.assignment.department_id === filters.department) &&
        (!filters.session || d.assignment.session_id === filters.session) &&
        (!filters.status || d.status === filters.status) &&
        (!filters.search ||
          JSON.stringify(d.content).toLowerCase().includes(filters.search.toLowerCase())),
    );
}
function version(u, d, action, reason = '') {
  run(
    'INSERT INTO diary_versions VALUES(?,?,?,?,?,?,?,?)',
    id(),
    d.id,
    d.version,
    u.id,
    action,
    reason,
    JSON.stringify(d),
    now(),
  );
  audit(u, action, d.id, { version: d.version, reason });
}
export function saveDiary(u, input, did) {
  return transaction(() => {
    let old = did ? diary(u, did) : null;
    const a = assignment(u, old?.assignment_id || input.assignment_id);
    check(a.teacher_id === u.id, 'Only the assigned teacher can edit this diary');
    check(a.active, 'Assignment is inactive', 409);
    const date = old?.diary_date || input.diary_date,
      period = old?.period || Number(input.period);
    check(
      validDate(date) && date >= a.start_date && date <= a.end_date,
      'Date must fall within the assignment',
      400,
    );
    check(a.periods.includes(period), 'Period is not assigned', 400);
    const currentReviewer =
      one(
        "SELECT r.head_id FROM teacher_reviewers r JOIN users h ON h.id=r.head_id WHERE r.teacher_id=? AND h.active=1 AND h.role='head_teacher'",
        u.id,
      ) ||
      (['super_admin', 'school_admin'].includes(u.role)
        ? one(
            "SELECT id AS head_id FROM users WHERE id=? AND active=1 AND role='head_teacher'",
            a.head_id,
          )
        : null);
    check(currentReviewer, 'Configure an active Head Teacher before writing a diary', 403);
    a.head_id = currentReviewer.head_id;
    check(
      !old || ['draft', 'returned'].includes(old.status),
      'This diary is locked; an approved amendment requires authorization',
      409,
    );
    if (old)
      check(Number(input.version) === old.version, 'Diary changed. Reload before saving.', 409);
    if (!old)
      check(
        !one(
          'SELECT d.id FROM diaries d JOIN assignments existing ON existing.id=d.assignment_id WHERE d.teacher_id=? AND d.diary_date=? AND d.period=? AND existing.section_id=? AND existing.subject_id=? AND existing.session_id=?',
          u.id,
          date,
          period,
          a.section_id,
          a.subject_id,
          a.session_id,
        ),
        'A diary already exists for this teaching responsibility and period',
        409,
      );
    const submit = input.submit === true,
      content = validateContent(input.content, submit),
      status = submit
        ? old?.status === 'returned'
          ? 'resubmitted'
          : 'submitted'
        : old?.status || 'draft',
      t = now();
    assignedHomework(content, visibleAssignments(u), a, old, check);
    const uid = old?.id || id(),
      quotes = old?.quote_snapshot || selectQuotes(u, date),
      template = old?.template_snapshot || { ...settings(), assignmentSnapshot: a };
    if (old)
      run(
        'UPDATE diaries SET content=?,status=?,version=version+1,submitted_at=?,updated_at=? WHERE id=?',
        JSON.stringify(content),
        status,
        submit ? t : old.submitted_at,
        t,
        uid,
      );
    else
      run(
        'INSERT INTO diaries(id,assignment_id,teacher_id,reviewer_id,diary_date,period,status,content,quote_snapshot,template_snapshot,submitted_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
        uid,
        a.id,
        u.id,
        a.head_id,
        date,
        period,
        status,
        JSON.stringify(content),
        JSON.stringify(quotes),
        JSON.stringify(template),
        submit ? t : null,
        t,
        t,
      );
    const d = diary(u, uid);
    version(u, d, submit ? status : 'save_draft');
    if (submit) {
      notify(
        a.head_id,
        uid,
        `${a.teacher_name} ${status} a diary for ${date}, period ${period}`,
        `${uid}:${d.version}:review`,
      );
      notify(u.id, uid, 'Your diary was submitted successfully.', `${uid}:${d.version}:submitted`);
    }
    return d;
  });
}
export function reviewDiary(u, did, input) {
  return transaction(() => {
    const d = diary(u, did),
      a = d.assignment;
    check(reviewScope(u, a), 'You are not authorized to review this assignment');
    check(settings().allowSelfApproval || u.id !== d.teacher_id, 'Self approval is disabled');
    check(
      ['submitted', 'resubmitted', 'under_review'].includes(d.status),
      'Diary is not awaiting review',
      409,
    );
    check(Number(input.version) === d.version, 'Diary changed. Reload before reviewing.', 409);
    check(
      ['approved', 'returned', 'under_review'].includes(input.action),
      'Invalid review action',
      400,
    );
    const remarks = String(input.remarks || '').trim();
    check(remarks.length <= 10000, 'Remarks too long', 400);
    check(input.action !== 'returned' || remarks, 'A return reason is required', 400);
    if (input.action === 'approved') {
      const quotes = all(
        `SELECT q.* FROM quote_schedules s JOIN quotes q ON q.id=s.quote_id WHERE s.date=? AND q.active=1 AND q.created_by=? AND (q.scope_id IS NULL OR q.scope_id=? OR q.scope_id=?) AND (s.scope_id IS NULL OR s.scope_id=? OR s.scope_id=?) ORDER BY s.priority DESC,s.id`,
        d.diary_date,
        d.reviewer_id,
        d.teacher_id,
        d.reviewer_id,
        d.teacher_id,
        d.reviewer_id,
      );
      const langs = new Set();
      const selected = quotes
        .filter((q) => {
          if (langs.has(q.language)) return false;
          langs.add(q.language);
          return true;
        })
        .map((q) => ({ id: q.id, text: q.text, language: q.language, direction: q.direction }));
      if (selected.length)
        run('UPDATE diaries SET quote_snapshot=? WHERE id=?', JSON.stringify(selected), did);
    }
    run(
      'UPDATE diaries SET status=?,reviewed_by=?,reviewed_at=?,review_remarks=?,updated_at=?,version=version+1 WHERE id=?',
      input.action,
      u.id,
      now(),
      remarks,
      now(),
      did,
    );
    run('INSERT INTO reviews VALUES(?,?,?,?,?,?)', id(), did, u.id, input.action, remarks, now());
    const current = diary(u, did);
    version(u, current, input.action, remarks);
    notify(
      d.teacher_id,
      did,
      `Diary ${input.action.replaceAll('_', ' ')}${remarks ? ': ' + remarks : ''}`,
      `${did}:${current.version}:${input.action}`,
    );
    return current;
  });
}
export function amendDiary(u, did, input) {
  return transaction(() => {
    check(can(u, 'amend'), 'Amendment permission required');
    const d = diary(u, did);
    check(d.status === 'approved', 'Only approved diaries need an amendment', 409);
    check(Number(input.version) === d.version, 'Diary changed. Reload.', 409);
    check(
      typeof input.reason === 'string' &&
        input.reason.trim().length >= 5 &&
        input.reason.length <= 10000,
      'Amendment reason is required (5–10000 characters)',
      400,
    );
    run(
      "UPDATE diaries SET status='returned',review_remarks=?,version=version+1,updated_at=? WHERE id=?",
      'Amendment requested: ' + input.reason.trim(),
      now(),
      did,
    );
    const current = diary(u, did);
    version(u, current, 'amendment_requested', input.reason);
    notify(
      d.teacher_id,
      did,
      'An amendment was requested: ' + input.reason,
      `${did}:${current.version}:amendment`,
    );
    return current;
  });
}
export function sendDeadlineNotifications(clock = new Date()) {
  const admin = one(`SELECT ${USER_COLUMNS} FROM users WHERE role='super_admin' AND active=1 LIMIT 1`);
  if (!admin) return;
  const today = dateInZone(clock),
    modern = new Set(
      all(
        'SELECT a.id FROM assignments a JOIN section_subjects s ON s.section_id=a.section_id AND s.subject_id=a.subject_id',
      ).map((x) => x.id),
    );
  for (const slot of expected(admin, today, today, clock)) {
    if (modern.has(slot.assignment_id)) continue;
    const key = `${slot.assignment_id}:${slot.date}:${slot.period}`;
    const due = new Date(slot.due_at);
    if (!slot.submitted && clock.getTime() > due.getTime() - 3600000) {
      notify(
        slot.teacher_id,
        slot.diary_id,
        `${slot.overdue ? 'Overdue diary' : 'Diary due soon'}: ${slot.subject_name}, period ${slot.period}, ${slot.date}`,
        key + (slot.overdue ? ':overdue' : ':due'),
      );
    }
    if (
      slot.diary_id &&
      ['submitted', 'resubmitted', 'under_review'].includes(slot.status) &&
      clock.getTime() > new Date(slot.review_due_at).getTime() - 3600000
    ) {
      const d = one('SELECT reviewer_id FROM diaries WHERE id=?', slot.diary_id);
      notify(
        d.reviewer_id,
        slot.diary_id,
        `Review deadline approaching/passed: ${slot.teacher_name}, ${slot.date}`,
        key + ':review_due',
      );
    }
  }
}
