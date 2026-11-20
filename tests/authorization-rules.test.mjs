import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiaryScope } from '../shared/diary-scope.mjs';
import { managementScope } from '../shared/management-scope.mjs';
import { assignedHomework } from '../shared/diary-rules.mjs';
import { legacyPolicy, retainedGrants } from '../shared/legacy-policy.mjs';

const check = (ok, message, status) => {
  if (!ok) throw Object.assign(new Error(message), { status });
};
// Two teams: h1 (campus A) leads t1; h2 (campus B) leads t2; c1 coordinates h1 only; t3 has no team.
const fake = (overrides = {}) => ({
  json: JSON.parse,
  all: async (sql) => {
    if (sql.includes('FROM teacher_reviewers'))
      return [
        { teacher_id: 't1', head_id: 'h1' },
        { teacher_id: 't2', head_id: 'h2' },
      ];
    if (sql.includes('FROM coordinator_heads')) return [{ head_id: 'h1' }];
    if (sql.includes("role='teacher'")) return [{ id: 't1' }, { id: 't2' }, { id: 't3' }];
    if (sql.includes('FROM section_subjects')) return overrides.subjectSections || [];
    throw Error('Unexpected query: ' + sql);
  },
  one: async (sql) => {
    if (sql.includes('FROM settings'))
      // Staff of every level carry a campus; only teachers in scope may widen a supervisor's campuses.
      return {
        value: JSON.stringify({
          teacherCampusAssignments: { t1: 'A', t2: 'B', h1: 'C', c1: 'D' },
        }),
      };
    if (sql.includes('FROM academics s JOIN class_campuses'))
      return overrides.sectionCampus === undefined ? { campus_id: 'A' } : overrides.sectionCampus;
    if (sql.includes('FROM academics WHERE id=?')) return overrides.academic;
    if (sql.includes('FROM class_campuses')) return { campus_id: 'A' };
    throw Error('Unexpected query: ' + sql);
  },
});
const user = (role, id = role) => ({ id, role });
const denied = (promise) => assert.rejects(promise, { status: 403 });

test('diary scope: teachers see their own, heads their team, coordinators their heads’ teams', async () => {
  const db = fake(),
    diary = (teacher_id) => ({ teacher_id });
  const teacher = await createDiaryScope(db, user('teacher', 't1'));
  assert.deepEqual([diary('t1'), diary('t2')].map(teacher), [true, false]);
  const head = await createDiaryScope(db, user('head_teacher', 'h1'));
  assert.deepEqual([diary('t1'), diary('t2'), diary('t3')].map(head), [true, false, false]);
  const coordinator = await createDiaryScope(db, user('coordinator', 'c1'));
  assert.deepEqual([diary('t1'), diary('t2')].map(coordinator), [true, false]);
  const admin = await createDiaryScope(db, user('school_admin'));
  assert.deepEqual([diary('t1'), diary('t2'), diary('t3')].map(admin), [true, true, true]);
  const widened = await createDiaryScope(db, user('head_teacher', 'h2'), { readAll: true });
  assert.equal(widened(diary('t1')), true, 'read-all is an explicit delegation');
});

test('management scope: a supervisor only manages teachers and campuses of their own team', async () => {
  const scope = managementScope(fake(), { check });
  assert.deepEqual([...(await scope.teachers(user('head_teacher', 'h1')))], ['t1']);
  await scope.teacher(user('head_teacher', 'h1'), 't1');
  await denied(scope.teacher(user('head_teacher', 'h1'), 't2'));
  await denied(scope.teacher(user('head_teacher', 'h1'), 't3'));
  assert.deepEqual([...(await scope.teachers(user('coordinator', 'c1')))], ['t1']);
  assert.equal(await scope.teachers(user('super_admin')), null);
  await scope.teacher(user('school_admin'), 't3');
});

test('management scope: a supervisor’s own campus never widens the campuses they may manage', async () => {
  const scope = managementScope(fake(), { check });
  assert.deepEqual([...(await scope.campuses(user('head_teacher', 'h1')))], ['A']);
  await scope.campus(user('head_teacher', 'h1'), 'A');
  for (const other of ['B', 'C', 'D']) await denied(scope.campus(user('head_teacher', 'h1'), other));
  assert.equal(await scope.campuses(user('super_admin')), null);
});

test('management scope: sections and academic records follow campus access', async () => {
  const head = user('head_teacher', 'h1');
  await managementScope(fake(), { check }).section(head, 's1');
  await denied(managementScope(fake({ sectionCampus: { campus_id: 'B' } }), { check }).section(head, 's2'));
  await denied(managementScope(fake({ sectionCampus: null }), { check }).section(head, 's3'));
  await denied(managementScope(fake({ academic: undefined }), { check }).academic(head, 'x'));
  await denied(managementScope(fake({ academic: { kind: 'session' } }), { check }).academic(head, 'x'));
  await denied(managementScope(fake({ academic: { kind: 'subject' } }), { check }).academic(head, 'x'));
  await managementScope(fake({ academic: { kind: 'subject' } }), { check }).academic(user('school_admin'), 'x');
});

const assignment = (extra = {}) => ({
  teacher_id: 't1',
  section_id: 's1',
  head_id: 'h1',
  session_id: 'y1',
  active: true,
  subject_id: 'math',
  subject_name: 'Mathematics',
  ...extra,
});
const target = { teacher_id: 't1', section_id: 's1', head_id: 'h1', session_id: 'y1', teacher_name: 'Tia' };
const grid = (rows) => ({ diary_layout: 'homework_grid', homework_rows: rows });

test('homework rows: only the teacher’s assigned subjects may carry homework', () => {
  const ok = grid([{ subject: 'mathematics', detail: 'Page 4' }]);
  assignedHomework(ok, [assignment()], target, null, check);
  assert.equal(ok.homework_rows[0].subject_id, 'math');
  assert.equal(ok.homework_rows[0].teacher_name, 'Tia');
  const bad = grid([{ subject: 'Biology', detail: 'Chapter 2' }]);
  assert.throws(() => assignedHomework(bad, [assignment()], target, null, check), { status: 403 });
  const empty = grid([{ subject: 'Biology', detail: '' }]);
  assignedHomework(empty, [assignment()], target, null, check);
  assert.deepEqual(empty.homework_rows, [], 'blank rows for other subjects are dropped');
});

test('homework rows: inactive or other teachers’ assignments grant nothing; older unchanged rows survive', () => {
  for (const extra of [{ active: false }, { teacher_id: 't9' }, { section_id: 's9' }, { head_id: 'h9' }]) {
    const content = grid([{ subject: 'Mathematics', detail: 'Page 4' }]);
    assert.throws(() => assignedHomework(content, [assignment(extra)], target, null, check), { status: 403 });
  }
  const row = { subject: 'Urdu', detail: 'Read aloud', hw: true, learn: false, test: false };
  const kept = grid([{ ...row }]);
  assignedHomework(kept, [assignment()], target, { content: { homework_rows: [row] } }, check);
  assert.equal(kept.homework_rows.length, 1);
  const other = { diary_layout: 'free', homework_rows: [{ subject: 'Anything', detail: 'x' }] };
  assignedHomework(other, [], target, null, check);
  assert.equal(other.homework_rows.length, 1, 'only the homework grid layout is restricted');
});

test('legacy policy: each old endpoint demands the matching permissions', () => {
  const caps = (...args) => legacyPolicy(...args).caps;
  assert.deepEqual(caps('/api/diaries', 'GET'), ['diary.view']);
  assert.deepEqual(caps('/api/diaries', 'POST'), ['diary.view', 'diary.create']);
  assert.deepEqual(caps('/api/diaries/d1', 'PUT', { submit: true }), ['diary.view', 'diary.edit', 'diary.submit']);
  assert.deepEqual(caps('/api/diaries/d1/review', 'POST', { action: 'approved' }), ['diary.view', 'diary.approve']);
  assert.deepEqual(caps('/api/diaries/d1/review', 'POST', { action: 'returned' }), ['diary.view', 'diary.return']);
  assert.deepEqual(caps('/api/diaries/d1/review', 'POST', { action: 'other' }), ['diary.view', 'diary.review']);
  assert.deepEqual(caps('/api/diaries/d1/amend', 'POST'), ['diary.view', 'diary.amend']);
  assert.deepEqual(caps('/api/diaries/d1/export', 'GET'), ['diary.view', 'diary.export']);
  assert.deepEqual(caps('/api/export', 'GET'), ['diary.view', 'diary.export']);
  assert.deepEqual(caps('/api/audit', 'GET'), ['audit.view']);
  assert.deepEqual(caps('/api/reports', 'GET', {}, { format: 'pdf' }), ['reports.view', 'diary.export']);
  assert.deepEqual(caps('/api/users', 'POST'), ['people.manage', 'people.create']);
  assert.deepEqual(caps('/api/users/u1', 'PATCH'), ['people.manage', 'people.edit']);
  assert.deepEqual(caps('/api/users/u1', 'DELETE'), ['people.manage', 'people.delete']);
  assert.deepEqual(caps('/api/academics', 'POST'), ['structure.manage', 'structure.create']);
  assert.deepEqual(caps('/api/quotes', 'PUT'), ['quotes.manage', 'quotes.edit']);
  const save = (entries) => caps('/api/class-diary/save', 'POST', { entries });
  assert.deepEqual(save([{}]), ['diary.view', 'diary.create']);
  assert.deepEqual(save([{ id: 'a' }]), ['diary.view', 'diary.edit']);
  assert.deepEqual(save([{}, { id: 'a' }]), ['diary.view', 'diary.create', 'diary.edit']);
});

test('legacy policy: old permission names keep their meaning until a current policy is saved', () => {
  const grants = (role, permissions) => retainedGrants({ role, permissions: JSON.stringify(permissions) });
  assert.ok(grants('teacher', ['manage_users']).has('people.manage'));
  assert.ok(!grants('teacher', ['manage_users']).has('structure.manage'));
  const academics = grants('teacher', ['manage_academics']);
  assert.ok(academics.has('structure.edit') && academics.has('assignments.edit'));
  assert.ok(grants('coordinator', []).has('diary.approve'));
  assert.ok(grants('teacher', ['review_all']).has('diary.return'));
  assert.equal(grants('teacher', []).size, 0, 'a plain teacher retains nothing');
  assert.ok(!grants('teacher', []).has('notices.manage'));
});
