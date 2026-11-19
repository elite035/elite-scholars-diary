import { createDiaryScope } from './diary-scope.mjs';
// Delegating an operation does not delegate another supervisor's team.
export function managementScope(db, domain) {
  const wide = (user) => ['super_admin', 'school_admin'].includes(user.role);
  async function teachers(user) {
    if (wide(user)) return null;
    const allowed = await createDiaryScope(db, user, { readAll: false });
    return new Set(
      (await db.all("SELECT id FROM users WHERE role='teacher'"))
        .filter((row) => allowed({ teacher_id: row.id }))
        .map((row) => row.id),
    );
  }
  async function teacher(user, id) {
    const ids = await teachers(user);
    domain.check(
      ids === null || ids.has(id),
      'This teacher is outside your assigned hierarchy.',
      403,
    );
  }
  async function campuses(user) {
    const ids = await teachers(user);
    if (ids === null) return null;
    const settings = db.json((await db.one('SELECT value FROM settings WHERE id=1')).value);
    return new Set(
      Object.entries(settings.teacherCampusAssignments || {})
        .filter(([id]) => ids.has(id))
        .map(([, campus]) => campus),
    );
  }
  async function campus(user, id) {
    const ids = await campuses(user);
    domain.check(
      ids === null || ids.has(id),
      'This campus is outside your assigned hierarchy. Ask an administrator to configure initial campus access.',
      403,
    );
  }
  async function section(user, id) {
    if (wide(user)) return;
    const row = await db.one(
      'SELECT c.campus_id FROM academics s JOIN class_campuses c ON c.class_id=s.parent_id WHERE s.id=?',
      id,
    );
    domain.check(row, 'An administrator must configure this section’s campus first.', 403);
    await campus(user, row.campus_id);
  }
  async function academic(user, id) {
    if (wide(user)) return;
    const item = await db.one('SELECT * FROM academics WHERE id=?', id);
    domain.check(item, 'An administrator must manage this school-wide record.', 403);
    if (item.kind === 'section') return section(user, id);
    if (item.kind === 'class') {
      const link = await db.one('SELECT campus_id FROM class_campuses WHERE class_id=?', id);
      return campus(user, link?.campus_id);
    }
    if (item.kind === 'subject') {
      const links = await db.all('SELECT section_id FROM section_subjects WHERE subject_id=?', id);
      domain.check(links.length, 'An administrator must configure this master subject first.', 403);
      for (const link of links) await section(user, link.section_id);
      return;
    }
    domain.check(false, 'An administrator must manage this school-wide record.', 403);
  }
  return { wide, teachers, teacher, campuses, campus, section, academic };
}
