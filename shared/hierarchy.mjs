import { USER_COLUMNS } from './user-columns.mjs';
import { createHash } from 'node:crypto';
import { permissionService } from './school-permissions.mjs';
import { teacherCampusService, STAFF_ROLES } from './teacher-campus.mjs';
const services = new WeakMap();
// Staff hierarchy: Coordinator -> Head Teacher -> Teacher. Each relationship has one parent.
const LINKS = {
  coordinator: {
    table: 'coordinator_heads',
    parent: 'coordinator_id',
    child: 'head_id',
    parentRole: 'coordinator',
    childRole: 'head_teacher',
  },
  reviewer: {
    table: 'teacher_reviewers',
    parent: 'head_id',
    child: 'teacher_id',
    parentRole: 'head_teacher',
    childRole: 'teacher',
  },
};
const kindOfRole = (role) => Object.keys(LINKS).find((kind) => LINKS[kind].childRole === role);
export function hierarchyService(db, domain) {
  if (services.has(db)) return services.get(db);
  const { all, one, run, transaction, audit } = db,
    { check } = domain,
    caps = permissionService(db),
    campuses = teacherCampusService(db, domain);
  let tail = Promise.resolve();
  const wide = (u) => ['super_admin', 'school_admin'].includes(u.role);
  async function manager(u) {
    return wide(u) && (await caps(u)).includes('hierarchy.manage');
  }
  async function graph() {
    return {
      hierarchy: await all('SELECT * FROM coordinator_heads ORDER BY head_id,coordinator_id'),
      reviewers: await all('SELECT * FROM teacher_reviewers ORDER BY teacher_id'),
    };
  }
  const revision = (g) => createHash('sha256').update(JSON.stringify(g)).digest('hex');
  async function read(u) {
    check(
      wide(u) || ['coordinator', 'head_teacher'].includes(u.role),
      'Hierarchy access is restricted to school administration and assigned supervisors',
    );
    const g = await graph(),
      manage = await manager(u),
      global = wide(u),
      heads = new Set(g.hierarchy.filter((r) => r.coordinator_id === u.id).map((r) => r.head_id));
    if (u.role === 'head_teacher') heads.add(u.id);
    const hierarchy = g.hierarchy.filter(
        (r) => global || r.coordinator_id === u.id || r.head_id === u.id,
      ),
      reviewers = g.reviewers.filter((r) => global || heads.has(r.head_id)),
      ids = new Set([
        u.id,
        ...hierarchy.flatMap((r) => [r.coordinator_id, r.head_id]),
        ...reviewers.flatMap((r) => [r.head_id, r.teacher_id]),
      ]);
    const users = (await all('SELECT id,name,email,role,active FROM users ORDER BY name,id'))
      .filter((x) => global || ids.has(x.id))
      .map((x) => ({ ...x, active: !!x.active }));
    return {
      hierarchy,
      reviewers,
      users,
      canManage: manage,
      canManageKinds: manage ? ['coordinator', 'reviewer'] : [],
      revision: revision(g),
    };
  }
  async function user(uid, role) {
    check(typeof uid === 'string', 'Choose a valid staff account', 400);
    const row = await one(`SELECT ${USER_COLUMNS} FROM users WHERE id=? AND role=? AND active=1`, uid, role);
    check(row, 'Choose an active ' + role.replaceAll('_', ' '), 400);
    return row;
  }
  // Work that would be left without a hierarchy parent if this child were unassigned.
  async function dependents(kind, childId, reviewers) {
    if (kind === 'coordinator') {
      const n = reviewers.filter((r) => r.head_id === childId).length;
      return n ? { id: childId, teachers: n } : null;
    }
    const a = await one(
        'SELECT COUNT(*) n FROM assignments WHERE teacher_id=? AND active=1',
        childId,
      ),
      modern = await one(
        "SELECT COUNT(*) n FROM school_diaries WHERE teacher_id=? AND status<>'approved'",
        childId,
      ),
      legacy = await one(
        "SELECT COUNT(*) n FROM diaries WHERE teacher_id=? AND status<>'approved'",
        childId,
      ),
      pending = Number(modern.n) + Number(legacy.n);
    return Number(a.n) || pending
      ? { id: childId, teaching_assignments: Number(a.n), pending_diaries: pending }
      : null;
  }
  async function writeLink(actor, kind, change, unassigned = []) {
    const { table, parent, child } = LINKS[kind];
    if (change.previous_parent_id)
      await run(
        `DELETE FROM ${table} WHERE ${child}=? AND ${parent}=?`,
        change.child_id,
        change.previous_parent_id,
      );
    if (change.parent_id)
      await run(
        `INSERT INTO ${table}(${child},${parent}) VALUES(?,?)`,
        change.child_id,
        change.parent_id,
      );
    // Historical diary authors/reviewers/snapshots remain immutable. Only future teaching defaults change.
    if (kind === 'reviewer' && change.parent_id)
      for (const a of await all('SELECT id FROM assignments WHERE teacher_id=? AND active=1', change.child_id))
        if (!(await one('SELECT 1 FROM diaries WHERE assignment_id=?', a.id)))
          await run('UPDATE assignments SET head_id=? WHERE id=?', change.parent_id, a.id);
    await audit(
      actor,
      'hierarchy_' + (!change.parent_id ? 'deleted' : change.previous_parent_id ? 'updated' : 'created'),
      kind + ':' + change.child_id,
      {
        actor_role: actor.role,
        kind,
        ...change,
        outcome: 'success',
        unassigned_dependents: unassigned.filter((x) => x.id === change.child_id),
      },
    );
  }
  async function mutate(
    u,
    kind,
    {
      parent_id,
      child_ids,
      child_id,
      expected_parent_id,
      revision: expected,
      confirm_unassigned = false,
    },
    mode = 'replace',
  ) {
    check(await manager(u), 'Hierarchy management permission required');
    check(['coordinator', 'reviewer'].includes(kind), 'Invalid hierarchy relationship', 400);
    const work = async () => {
      try {
        return await transaction(async () => {
          const actor = await one('SELECT role,active FROM users WHERE id=?', u.id);
          check(
            actor?.active && actor.role === u.role && (await manager(u)),
            'Your hierarchy permissions changed. Sign in again.',
            403,
          );
          const before = await graph();
          if (expected !== undefined)
            check(expected === revision(before), 'Hierarchy changed. Reload before saving.', 409);
          const { parent, child, parentRole, childRole } = LINKS[kind],
            rows = kind === 'coordinator' ? before.hierarchy : before.reviewers;
          check(
            ['replace', 'remove', 'move', 'create'].includes(mode),
            'Invalid hierarchy operation',
            400,
          );
          const ids = mode === 'replace' ? child_ids : [child_id];
          check(
            Array.isArray(ids) &&
              ids.length <= 100 &&
              ids.every((x) => typeof x === 'string' && x.length > 0),
            'Select up to 100 valid staff members',
            400,
          );
          check(
            new Set(ids).size === ids.length,
            'The same staff member cannot be selected twice',
            409,
          );
          if (mode !== 'remove') await user(parent_id, parentRole);
          else check(typeof parent_id === 'string', 'Choose the relationship to remove', 400);
          const changes = [];
          if (mode === 'replace')
            for (const old of rows.filter(
              (r) => r[parent] === parent_id && !ids.includes(r[child]),
            ))
              changes.push({
                child_id: old[child],
                previous_parent_id: parent_id,
                parent_id: null,
              });
          for (const uid of ids) {
            const old = rows.find((r) => r[child] === uid);
            check(uid !== parent_id, 'Self-assignment is not allowed', 400);
            if (mode === 'remove') {
              check(old && old[parent] === parent_id, 'Relationship not found', 404);
              changes.push({ child_id: uid, previous_parent_id: parent_id, parent_id: null });
              continue;
            }
            await user(uid, childRole);
            if (mode === 'create')
              check(!old, 'This staff member already has a parent. Use Edit to reassign.', 409);
            if (mode === 'move') {
              check(
                old && old[parent] === expected_parent_id,
                'Hierarchy changed. Reload before reassigning.',
                409,
              );
            }
            if (old?.[parent] !== parent_id)
              changes.push({ child_id: uid, previous_parent_id: old?.[parent] || null, parent_id });
          }
          const affected = [];
          for (const c of changes.filter((x) => !x.parent_id)) {
            const found = await dependents(kind, c.child_id, before.reviewers);
            if (found) affected.push(found);
          }
          check(
            !affected.length || confirm_unassigned === true,
            'This removal leaves active staff or teaching responsibilities without a hierarchy parent. Confirm keeping those records unassigned before removing.',
            409,
          );
          for (const c of changes) await writeLink(u, kind, c, affected);
          return { ok: true, changes, revision: revision(await graph()) };
        });
      } catch (error) {
        if (['40001', '23505', '40P01'].includes(error.code)) {
          error.status = 409;
          error.message = 'Hierarchy changed concurrently. Reload and try again.';
        }
        throw error;
      }
    };
    const result = tail.then(work);
    tail = result.catch(() => {});
    return result;
  }

  // ---- Campus-driven placement: the hierarchy follows the campus assigned to each account. ----
  async function candidates(role, campusId, exclude) {
    const map = await campuses.mappings();
    return (await all('SELECT id,name FROM users WHERE role=? AND active=1 ORDER BY name,id', role))
      .filter((row) => map[row.id] === campusId && row.id !== exclude)
      .map((row) => row.id);
  }
  async function parentOf(kind, childId) {
    const { table, parent, child } = LINKS[kind];
    return (await one(`SELECT ${parent} p FROM ${table} WHERE ${child}=?`, childId))?.p || null;
  }
  async function parentMap() {
    const g = await graph();
    return new Map([
      ...g.hierarchy.map((r) => [r.head_id, r.coordinator_id]),
      ...g.reviewers.map((r) => [r.teacher_id, r.head_id]),
    ]);
  }
  /**
   * Put a staff account on a campus and connect it to the matching supervisor.
   * - `campus_id`: set or change the campus (undefined keeps it).
   * - `parent_id`: a supervisor of the same campus, 'none' to unassign, or empty for automatic.
   * Automatic placement picks an active supervisor of the same campus and, when a new supervisor
   * arrives, adopts unassigned staff of that campus. Must run inside the caller's transaction.
   */
  async function place(actor, userId, { campus_id, parent_id } = {}) {
    const account = await one('SELECT id,role FROM users WHERE id=?', userId);
    if (!account || !STAFF_ROLES.includes(account.role)) return;
    const previousCampus = (await campuses.mappings())[userId] || null;
    let campus = previousCampus;
    if (typeof campus_id === 'string' && campus_id && campus_id !== previousCampus) {
      await campuses.save(actor, userId, campus_id, undefined, STAFF_ROLES);
      campus = campus_id;
    }
    const campusChanged = campus !== previousCampus,
      kind = kindOfRole(account.role);
    if (kind) {
      const link = LINKS[kind],
        current = await parentOf(kind, userId),
        reviewers = (await graph()).reviewers;
      let target = current;
      if (parent_id === 'none') target = null;
      else if (parent_id) {
        await user(parent_id, link.parentRole);
        check(campus, 'Assign a campus before choosing a supervisor', 400);
        check(
          (await campuses.mappings())[parent_id] === campus,
          'The supervisor must belong to the same campus. Assign the campus to that account first.',
          409,
        );
        target = parent_id;
      } else if (campus && (!current || campusChanged)) {
        const sameCampus = await candidates(link.parentRole, campus, userId);
        target = sameCampus.includes(current) ? current : sameCampus[0] || null;
      }
      if (target !== current) {
        if (!target)
          check(
            !(await dependents(kind, userId, reviewers)),
            'This account has teaching work and needs a supervisor. Choose another supervisor instead.',
            409,
          );
        await writeLink(actor, kind, {
          child_id: userId,
          previous_parent_id: current,
          parent_id: target,
        });
      }
    }
    const downward = account.role === 'head_teacher' ? 'reviewer' : account.role === 'coordinator' ? 'coordinator' : null;
    if (!downward || !campus) return;
    const { table, parent, child, childRole } = LINKS[downward],
      map = await campuses.mappings();
    if (campusChanged)
      for (const row of await all(`SELECT ${child} c FROM ${table} WHERE ${parent}=?`, userId)) {
        const childCampus = map[row.c];
        if (!childCampus || childCampus === campus) continue;
        const replacement = (await candidates(account.role, childCampus, userId))[0] || null;
        if (!replacement)
          check(
            !(await dependents(downward, row.c, (await graph()).reviewers)),
            'Assign another ' +
              account.role.replaceAll('_', ' ') +
              ' to the previous campus before moving this account.',
            409,
          );
        await writeLink(actor, downward, {
          child_id: row.c,
          previous_parent_id: userId,
          parent_id: replacement,
        });
      }
    for (const row of await all(
      `SELECT u.id FROM users u WHERE u.role=? AND u.active=1 AND NOT EXISTS(SELECT 1 FROM ${table} t WHERE t.${child}=u.id) ORDER BY u.name,u.id`,
      childRole,
    ))
      if (map[row.id] === campus)
        await writeLink(actor, downward, {
          child_id: row.id,
          previous_parent_id: null,
          parent_id: userId,
        });
  }
  const service = { read, mutate, manager, place, parentMap };
  services.set(db, service);
  return service;
}
