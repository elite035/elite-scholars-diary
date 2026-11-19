import { createUser, run, id, now, settings } from '../server/db.mjs';
export function fixtures() {
  const password = 'Test-only-ChangeMe!2026';
  const users = {};
  for (const [key, role, name] of [
    ['super', 'super_admin', 'Test Super Admin'],
    ['admin', 'school_admin', 'Test School Admin'],
    ['coordinator', 'coordinator', 'Test Coordinator'],
    ['head', 'head_teacher', 'Test Head Teacher'],
    ['headB', 'head_teacher', 'Test Head B'],
    ['teacher', 'teacher', 'Test Teacher A'],
    ['teacherB', 'teacher', 'Test Teacher B'],
  ])
    users[key] = createUser({
      name,
      email: `${key.toLowerCase()}@example.invalid`,
      password,
      role,
      permissions:
        role === 'school_admin'
          ? ['read_all', 'export', 'manage_academics']
          : role === 'head_teacher' || role === 'coordinator'
            ? ['export', 'manage_quotes']
            : ['export'],
    });
  const academics = {};
  for (const [key, kind, name, parent] of [
    ['session', 'session', 'TEST Academic Session', null],
    ['department', 'department', 'TEST Sciences', null],
    ['class', 'class', 'TEST Class 6', null],
    ['section', 'section', 'TEST Section A', 'class'],
    ['subject', 'subject', 'TEST Mathematics', 'department'],
  ]) {
    const aid = id();
    run(
      'INSERT INTO academics(id,kind,name,parent_id,start_date,end_date) VALUES(?,?,?,?,?,?)',
      aid,
      kind,
      name,
      parent ? academics[parent] : null,
      kind === 'session' ? '2026-01-01' : null,
      kind === 'session' ? '2027-12-31' : null,
    );
    academics[key] = aid;
  }
  run('INSERT INTO coordinator_heads VALUES(?,?)', users.coordinator.id, users.head.id);
  const assignments = {};
  for (const [key, teacher, head] of [
    ['a', users.teacher, users.head],
    ['b', users.teacherB, users.headB],
  ]) {
    const aid = id();
    run(
      'INSERT INTO assignments VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1)',
      aid,
      teacher.id,
      head.id,
      academics.section,
      academics.subject,
      academics.session,
      '2026-01-01',
      '2027-12-31',
      JSON.stringify([1, 2, 3, 4, 5]),
      JSON.stringify([1, 2]),
      '16:00',
      '18:00',
    );
    assignments[key] = aid;
  }
  run('INSERT OR IGNORE INTO class_subjects VALUES(?,?)', academics.class, academics.subject);
  for (const teacher of [users.teacher, users.teacherB])
    run(
      'INSERT OR IGNORE INTO teacher_reviewers VALUES(?,?)',
      teacher.id,
      teacher.id === users.teacher.id ? users.head.id : users.headB.id,
    );
  return { users, academics, assignments, password };
}
