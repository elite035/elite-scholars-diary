import { createHash } from 'node:crypto';
import { permissionService } from './school-permissions.mjs';
export const forceDeleteTypes = {
  user: { table: 'users', permission: 'people.delete' },
  academic: { table: 'academics', permission: 'structure.delete' },
  node: { table: 'school_nodes', permission: 'structure.delete' },
  assignment: { table: 'assignments', permission: 'assignments.delete' },
  diary: { table: 'school_diaries', permission: 'diary.delete' },
  legacy_diary: { table: 'diaries', permission: 'diary.delete' },
  quote: { table: 'quotes', permission: 'quotes.delete' },
};
export const deletionKey = (type, id) => type + ':' + id;
export async function deletionKeys(db) {
  return new Set(
    (await db.all("SELECT resource_id FROM audit WHERE action='record_force_deleted'")).map(
      (x) => x.resource_id,
    ),
  );
}
export function deletionIds(keys) {
  return new Set([...keys].map((key) => key.slice(key.indexOf(':') + 1)));
}
export function filterDeletedResponse(value, path, keys) {
  if (
    !/^\/api\/(?:lookups|enhancements|quotes|school\/(?:bootstrap|structure|people|hierarchy|quotes|editor))$/.test(
      path,
    )
  )
    return value;
  const hidden = deletionIds(keys),
    keep = (row) =>
      ![
        'id',
        'class_id',
        'campus_id',
        'section_id',
        'subject_id',
        'teacher_id',
        'head_id',
        'coordinator_id',
        'quote_id',
        'session_id',
      ].some((key) => hidden.has(row[key]));
  if (Array.isArray(value)) return value.filter(keep);
  if (!value || typeof value !== 'object') return value;
  const result = { ...value };
  for (const key of [
    'academics',
    'nodes',
    'users',
    'assignments',
    'classCampuses',
    'classSubjects',
    'sectionSubjects',
    'teacherCampuses',
    'hierarchy',
    'reviewers',
    'coordinatorHeads',
    'quotes',
    'schedules',
    'exceptions',
  ])
    if (Array.isArray(result[key])) result[key] = result[key].filter(keep);
  if (result.structure)
    result.structure = filterDeletedResponse(result.structure, '/api/school/structure', keys);
  return result;
}
const cleanUser = ({ password, permissions, ...row }) => row;
export function forceDeleteService(db, domain) {
  const { all, one, run, transaction, audit, settings, now, id } = db,
    { check } = domain,
    capabilities = permissionService(db);
  let tail = Promise.resolve();
  async function authorize(actor, type) {
    check(
      ['super_admin', 'school_admin'].includes(actor.role),
      'Force Delete is restricted to authorized administrators',
      403,
    );
    const current = await one('SELECT role,active FROM users WHERE id=?', actor.id);
    check(current?.active && current.role === actor.role, 'Your account permissions changed', 403);
    const caps = await capabilities(actor);
    check(caps.includes('records.force_delete'), 'Force Delete permission required', 403);
    if (type)
      check(
        forceDeleteTypes[type] && caps.includes(forceDeleteTypes[type].permission),
        'Record deletion permission required',
        403,
      );
  }
  async function build(actor, type, recordId) {
    await authorize(actor, type);
    check(
      typeof recordId === 'string' && /^[\w-]{1,100}$/.test(recordId),
      'Invalid record identifier',
      400,
    );
    const definition = forceDeleteTypes[type],
      root = await one(`SELECT * FROM ${definition.table} WHERE id=?`, recordId);
    check(root, 'Record not found', 404);
    const keys = await deletionKeys(db);
    check(
      !keys.has(deletionKey(type, recordId)),
      'This record has already been force-deleted',
      409,
    );
    if (type === 'user') {
      check(root.id !== actor.id, 'You cannot force-delete your current account', 409);
      check(
        actor.role === 'super_admin' || !['super_admin', 'school_admin'].includes(root.role),
        'Super Admin required for administrative accounts',
        403,
      );
      if (root.role === 'super_admin' && root.active)
        check(
          Number(
            (await one("SELECT COUNT(*) n FROM users WHERE role='super_admin' AND active=1")).n,
          ) > 1,
          'Keep an active Super Admin',
          409,
        );
    }
    const affected = new Map(),
      add = (kind, row) => {
        if (!keys.has(deletionKey(kind, row.id)))
          affected.set(deletionKey(kind, row.id), {
            type: kind,
            record: kind === 'user' ? cleanUser(row) : row,
          });
      };
    add(type, root);
    const nodes = await all('SELECT * FROM school_nodes'),
      academics = await all('SELECT * FROM academics'),
      maps = await all('SELECT * FROM class_campuses');
    const academicIds = new Set(type === 'academic' ? [recordId] : []);
    if (type === 'node') {
      const nodeIds = new Set([recordId]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const row of nodes)
          if (nodeIds.has(row.parent_id) && !nodeIds.has(row.id)) {
            nodeIds.add(row.id);
            changed = true;
          }
      }
      for (const row of nodes) if (nodeIds.has(row.id)) add('node', row);
      for (const row of academics)
        if (
          row.kind === 'class' &&
          maps.some((map) => map.class_id === row.id && nodeIds.has(map.campus_id))
        )
          academicIds.add(row.id);
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const row of academics)
        if (academicIds.has(row.parent_id) && !academicIds.has(row.id)) {
          academicIds.add(row.id);
          changed = true;
        }
    }
    for (const row of academics) if (academicIds.has(row.id)) add('academic', row);
    const relatedAssignmentIds = new Set();
    for (const row of await all('SELECT * FROM assignments'))
      if (
        (type === 'user' && (row.teacher_id === recordId || row.head_id === recordId)) ||
        (type === 'assignment' && row.id === recordId) ||
        [row.section_id, row.subject_id, row.session_id].some((uid) => academicIds.has(uid))
      ) {
        relatedAssignmentIds.add(row.id);
        add('assignment', row);
      }
    if (type === 'user')
      for (const row of await all('SELECT * FROM quotes'))
        if (row.created_by === recordId || row.scope_id === recordId) add('quote', row);
    const assignmentIds = relatedAssignmentIds,
      diaries = [];
    for (const row of await all('SELECT * FROM school_diaries'))
      if (
        (type === 'quote' && JSON.parse(row.quote_payload).some((q) => q.id === recordId)) ||
        (type === 'diary' && row.id === recordId) ||
        (type === 'user' && (row.teacher_id === recordId || row.head_id === recordId)) ||
        academicIds.has(row.section_id) ||
        JSON.parse(row.content).homework_rows?.some(
          (r) => assignmentIds.has(r.assignment_id) || academicIds.has(r.subject_id),
        )
      )
        diaries.push({
          type: 'diary',
          id: row.id,
          status: row.status,
          date: row.diary_date,
          version: row.version,
        });
    for (const row of await all('SELECT * FROM diaries'))
      if (
        (type === 'quote' && JSON.parse(row.quote_snapshot).some((q) => q.id === recordId)) ||
        (type === 'legacy_diary' && row.id === recordId) ||
        assignmentIds.has(row.assignment_id) ||
        (type === 'user' &&
          (row.teacher_id === recordId ||
            row.reviewer_id === recordId ||
            row.reviewed_by === recordId))
      )
        diaries.push({
          type: 'legacy_diary',
          id: row.id,
          status: row.status,
          date: row.diary_date,
          version: row.version,
        });
    let name =
      root.name ||
      root.text?.slice(0, 100) ||
      (root.snapshot && JSON.parse(root.snapshot).meta?.class_name + ' / ' + root.diary_date) ||
      (root.content && JSON.parse(root.content).topic) ||
      type + ' ' + recordId;
    if (type === 'assignment') {
      const teacher = await one('SELECT name FROM users WHERE id=?', root.teacher_id),
        section = await one('SELECT name,parent_id FROM academics WHERE id=?', root.section_id),
        klass = await one('SELECT name FROM academics WHERE id=?', section.parent_id),
        subject = await one('SELECT name FROM academics WHERE id=?', root.subject_id);
      name = teacher.name + ' · ' + klass.name + ' / ' + section.name + ' · ' + subject.name;
    }
    const users = await all('SELECT id,name FROM users'),
      priorities = await all('SELECT * FROM subject_priorities');
    for (const entry of affected.values()) {
      const row = entry.record,
        section = row.section_id
          ? academics.find((x) => x.id === row.section_id)
          : row.kind === 'section'
            ? row
            : null,
        klass =
          row.kind === 'class'
            ? row
            : section
              ? academics.find((x) => x.id === section.parent_id)
              : null,
        campus = nodes.find(
          (x) =>
            x.id ===
            (row.kind === 'campus'
              ? row.id
              : klass
                ? maps.find((m) => m.class_id === klass.id)?.campus_id
                : null),
        ),
        branch = nodes.find((x) => x.id === (row.kind === 'branch' ? row.id : campus?.parent_id));
      row.historical_display = {
        ...(row.teacher_id
          ? { teacher_name: users.find((x) => x.id === row.teacher_id)?.name }
          : {}),
        ...(row.head_id
          ? { head_teacher_name: users.find((x) => x.id === row.head_id)?.name }
          : {}),
        ...(section ? { section_name: section.name } : {}),
        ...(klass ? { class_name: klass.name } : {}),
        ...(campus ? { campus_name: campus.name } : {}),
        ...(branch ? { branch_name: branch.name } : {}),
        ...(row.subject_id
          ? { subject_name: academics.find((x) => x.id === row.subject_id)?.name }
          : {}),
        ...(row.kind === 'subject'
          ? { priority: priorities.find((x) => x.subject_id === row.id)?.priority ?? 0 }
          : {}),
      };
    }
    const records = [...affected.values()].sort((a, b) =>
        deletionKey(a.type, a.record.id).localeCompare(deletionKey(b.type, b.record.id)),
      ),
      summary = {};
    for (const row of records) summary[row.type] = (summary[row.type] || 0) + 1;
    const hierarchy =
      type === 'user'
        ? {
            coordinators: await all(
              'SELECT * FROM coordinator_heads WHERE coordinator_id=? OR head_id=?',
              recordId,
              recordId,
            ),
            reviewers: await all(
              'SELECT * FROM teacher_reviewers WHERE teacher_id=? OR head_id=?',
              recordId,
              recordId,
            ),
          }
        : null;
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ records, diaries, hierarchy }))
      .digest('hex');
    return {
      type,
      recordKind: root.kind || type,
      id: recordId,
      name,
      summary,
      history: {
        diaries: diaries.length,
        approved: diaries.filter((d) => d.status === 'approved').length,
        submitted: diaries.filter((d) =>
          ['submitted', 'resubmitted', 'under_review'].includes(d.status),
        ).length,
      },
      dependentRelationships: hierarchy
        ? hierarchy.coordinators.length + hierarchy.reviewers.length
        : 0,
      requiresAdditionalConfirmation:
        records.length > 1 ||
        diaries.length > 0 ||
        (!!hierarchy && hierarchy.coordinators.length + hierarchy.reviewers.length > 0),
      fingerprint,
      records,
      root,
    };
  }
  async function preview(actor, type, recordId) {
    const plan = await build(actor, type, recordId);
    const { records, root, ...publicPlan } = plan;
    return publicPlan;
  }
  async function remove(actor, type, recordId, input) {
    await authorize(actor, type);
    const work = () =>
      transaction(async () => {
        const plan = await build(actor, type, recordId);
        check(
          typeof input.reason === 'string' &&
            input.reason.trim().length >= 5 &&
            input.reason.length <= 2000,
          'Enter a deletion reason of 5–2000 characters',
          400,
        );
        check(
          input.confirmation === 'FORCE DELETE' && input.confirm_name === plan.name,
          'Type FORCE DELETE and the exact record name to confirm',
          400,
        );
        check(
          typeof input.fingerprint === 'string' && input.fingerprint === plan.fingerprint,
          'This record or its dependencies changed. Review the impact again.',
          409,
        );
        check(
          !plan.requiresAdditionalConfirmation || input.confirm_related === true,
          'Confirm the affected records and historical preservation before proceeding',
          400,
        );
        const deletedAt = now(),
          effective = domain.dateInZone();
        for (const entry of plan.records) {
          const definition = forceDeleteTypes[entry.type],
            record = entry.record;
          // Rows and foreign keys remain intact; the immutable audit event is the distinct deletion marker.
          if (['user', 'academic', 'node', 'assignment', 'quote'].includes(entry.type))
            await run(`UPDATE ${definition.table} SET active=0 WHERE id=?`, record.id);
          if (entry.type === 'user') await run('DELETE FROM sessions WHERE user_id=?', record.id);
          if (entry.type === 'assignment' && record.active)
            await run(
              'INSERT INTO assignment_state_events VALUES(?,?,?,?,?)',
              id(),
              record.id,
              effective,
              0,
              deletedAt,
            );
          const display = record.historical_display,
            recordName =
              record.name ||
              record.text?.slice(0, 100) ||
              (entry.type === 'assignment'
                ? [
                    display.teacher_name,
                    [display.class_name, display.section_name].filter(Boolean).join(' / '),
                    display.subject_name,
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : plan.name);
          await audit(actor, 'record_force_deleted', deletionKey(entry.type, record.id), {
            record_type: entry.type,
            record_id: record.id,
            record_name: recordName,
            reason: input.reason.trim(),
            deleted_at: deletedAt,
            actor_role: actor.role,
            actor_name: actor.name,
            root: deletionKey(type, recordId),
            snapshot: record,
            impact: { summary: plan.summary, history: plan.history },
            outcome: 'success',
            historical_rows_preserved: true,
          });
        }
        return {
          ok: true,
          type,
          id: recordId,
          deletedAt,
          affected: plan.records.length,
          historyPreserved: true,
        };
      });
    const pending = tail.then(work);
    tail = pending.catch(() => {});
    try {
      return await pending;
    } catch (error) {
      if (['40001', '23505', '40P01'].includes(error.code)) {
        error.status = 409;
        error.message = 'Records changed concurrently. Review the impact and try again.';
      }
      throw error;
    }
  }
  async function list(actor) {
    await authorize(actor);
    const caps = await capabilities(actor);
    return (
      await all(
        "SELECT a.*,u.name actor_name FROM audit a LEFT JOIN users u ON u.id=a.actor_id WHERE a.action='record_force_deleted' ORDER BY a.created_at DESC,a.id DESC",
      )
    )
      .map((row) => ({
        id: row.id,
        actor: JSON.parse(row.details).actor_name || row.actor_name,
        actor_id: row.actor_id,
        created_at: row.created_at,
        ...JSON.parse(row.details),
      }))
      .filter((row) => caps.includes(forceDeleteTypes[row.record_type]?.permission));
  }

  return { preview, remove, list };
}
