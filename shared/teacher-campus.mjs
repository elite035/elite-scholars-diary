// Campus IDs of staff (teachers, Head Teachers, Coordinators) are persisted with the existing
// school configuration and included in backups. Read fresh inside assignment transactions;
// request-cached settings are not authorization data.
export const STAFF_ROLES = ['coordinator', 'head_teacher', 'teacher'];
export function teacherCampusService(db, { check }) {
  async function mappings() {
    const row = await db.one('SELECT value FROM settings WHERE id=1');
    return (
      (typeof row.value === 'string' ? JSON.parse(row.value) : row.value)
        .teacherCampusAssignments || {}
    );
  }
  async function assertAssignment(teacherId, sectionId, { legacy = false } = {}) {
    const section = await db.one(
      "SELECT parent_id FROM academics WHERE id=? AND kind='section'",
      sectionId,
    );
    check(section, 'Choose a valid section', 400);
    const link = await db.one(
      'SELECT campus_id FROM class_campuses WHERE class_id=?',
      section.parent_id,
    );
    if (legacy && !link) return; // Retained period records have no campus model.
    check(
      await db.one("SELECT 1 FROM users WHERE id=? AND role='teacher' AND active=1", teacherId),
      'Choose an active teacher',
      400,
    );
    const campusId = (await mappings())[teacherId];
    check(
      campusId,
      'This teacher has no campus assignment. Assign a campus before adding teaching responsibilities.',
      400,
    );
    const campus = await db.one(
      "SELECT * FROM school_nodes WHERE id=? AND kind='campus' AND active=1",
      campusId,
    );
    check(
      campus &&
        (!campus.parent_id ||
          (await db.one('SELECT 1 FROM school_nodes WHERE id=? AND active=1', campus.parent_id))),
      'The teacher’s assigned campus is unavailable or archived.',
      409,
    );
    check(
      link?.campus_id === campusId,
      'The selected class or section does not belong to this teacher’s assigned campus.',
      400,
    );
  }
  async function save(actor, teacherId, campusId, expected, roles = ['teacher']) {
    return db.transaction(async () => {
      const account = await db.one('SELECT role FROM users WHERE id=? AND active=1', teacherId);
      check(
        account && roles.includes(account.role),
        roles.length === 1 ? 'Choose an active teacher' : 'Choose an active staff account',
        400,
      );
      check(typeof campusId === 'string' && campusId.length > 0, 'Choose an active campus', 400);
      const campus = await db.one(
        "SELECT * FROM school_nodes WHERE id=? AND kind='campus' AND active=1",
        campusId,
      );
      check(
        campus &&
          (!campus.parent_id ||
            (await db.one('SELECT 1 FROM school_nodes WHERE id=? AND active=1', campus.parent_id))),
        'Choose a campus within an active branch',
        400,
      );
      const row = await db.one('SELECT value FROM settings WHERE id=1'),
        value = typeof row.value === 'string' ? JSON.parse(row.value) : row.value,
        map = value.teacherCampusAssignments || {};
      check(
        expected === undefined || expected === (map[teacherId] || null),
        'The teacher’s campus changed. Reload before saving.',
        409,
      );
      if (map[teacherId] && map[teacherId] !== campusId) {
        const conflict = await db.one(
          'SELECT a.id FROM assignments a JOIN academics s ON s.id=a.section_id JOIN class_campuses c ON c.class_id=s.parent_id WHERE a.teacher_id=? AND a.active=1 AND c.campus_id<>?',
          teacherId,
          campusId,
        );
        check(
          !conflict,
          'Archive or replace this teacher’s active responsibilities in the previous campus before changing campus. Historical diaries will remain unchanged.',
          409,
        );
      }
      value.teacherCampusAssignments = { ...map, [teacherId]: campusId };
      await db.run('UPDATE settings SET value=? WHERE id=1', JSON.stringify(value));
      await db.audit(actor, 'teacher_campus_assigned', teacherId, {
        campus_id: campusId,
        previous_campus_id: map[teacherId] || null,
      });
      return { ok: true };
    });
  }
  return { mappings, assertAssignment, save };
}
