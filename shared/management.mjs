import { passwordAcceptable, PASSWORD_MESSAGE } from './passwords.mjs';
import { accountSecurity } from './account-security.mjs';
// Shared management routes keep SQLite and PostgreSQL validation identical.
export function management(db, domain) {
  const { one, all, run, transaction, id, now, audit, json, passwordHash } = db;
  const { check, can, roles, validDate, validTime, dateInZone } = domain;
  const security = accountSecurity(db, domain);
  const permissions = [
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
  const text = (value, min, max, label) => {
    check(
      typeof value === 'string' && value.trim().length >= min && value.length <= max,
      'Invalid ' + label,
      400,
    );
    return value.trim();
  };
  const bool = (value) =>
    check(value === undefined || typeof value === 'boolean', 'Active must be true or false', 400);
  async function references(uid) {
    const refs = [
      ['school_diaries', 'teacher_id'],
      ['school_diaries', 'head_id'],
      ['school_diary_versions', 'actor_id'],
      ['parent_sections', 'parent_id'],
      ['push_subscriptions', 'user_id'],
      ['user_capabilities', 'user_id'],
      ['assignments', 'teacher_id'],
      ['assignments', 'head_id'],
      ['diaries', 'teacher_id'],
      ['diaries', 'reviewer_id'],
      ['diaries', 'reviewed_by'],
      ['reviews', 'actor_id'],
      ['diary_versions', 'actor_id'],
      ['attachments', 'uploader_id'],
      ['audit', 'actor_id'],
      ['template_versions', 'actor_id'],
      ['quotes', 'scope_id'],
      ['quotes', 'created_by'],
      ['quote_schedules', 'scope_id'],
      ['coordinator_heads', 'coordinator_id'],
      ['coordinator_heads', 'head_id'],
      ['teacher_reviewers', 'teacher_id'],
      ['teacher_reviewers', 'head_id'],
      ['connections', 'sender_id'],
      ['connections', 'recipient_id'],
      ['conversation_members', 'user_id'],
      ['conversations', 'creator_id'],
      ['membership_events', 'actor_id'],
      ['membership_events', 'user_id'],
      ['chat_messages', 'sender_id'],
      ['communication_reports', 'reporter_id'],
      ['communication_reports', 'reported_user_id'],
    ];
    for (const [table, column] of refs)
      if (await one(`SELECT 1 FROM ${table} WHERE ${column}=?`, uid)) return true;
    return false;
  }
  async function assignmentReady(a) {
    check(
      await one('SELECT 1 FROM users WHERE id=? AND active=1', a.teacher_id),
      'Activate the assigned teacher first',
      409,
    );
    check(
      await one("SELECT 1 FROM users WHERE id=? AND role='head_teacher' AND active=1", a.head_id),
      'An active Head Teacher is required',
      409,
    );
    for (const uid of [a.section_id, a.subject_id, a.session_id]) {
      const entity = await one('SELECT * FROM academics WHERE id=? AND active=1', uid);
      check(entity, 'Activate the academic records first', 409);
      if (entity.parent_id)
        check(
          await one('SELECT 1 FROM academics WHERE id=? AND active=1', entity.parent_id),
          'Activate the parent academic record first',
          409,
        );
    }
    const section = await one('SELECT parent_id FROM academics WHERE id=?', a.section_id);
    check(
      await one(
        'SELECT 1 FROM class_subjects WHERE class_id=? AND subject_id=?',
        section.parent_id,
        a.subject_id,
      ),
      'Link the subject to this class first',
      409,
    );
  }
  return async function route({ path, method, b, u, res, reply }) {
    const user = /^\/api\/users\/([\w-]+)$/.exec(path);
    if (user && ['PATCH', 'DELETE'].includes(method)) {
      check(can(u, 'manage_users'), 'User management permission required');
      await transaction(async () => {
        const target = await one('SELECT * FROM users WHERE id=?', user[1]);
        check(target, 'User not found', 404);
        check(
          u.role === 'super_admin' || ['teacher', 'head_teacher'].includes(target.role),
          'Super Admin required',
        );
        if (method === 'DELETE') {
          check(u.role === 'super_admin', 'Super Admin required');
          check(
            target.id !== u.id && target.role !== 'super_admin',
            'Super Admin accounts cannot be deleted',
            409,
          );
          check(
            !(await references(target.id)),
            'Account has history or responsibilities; deactivate it instead',
            409,
          );
          await run('DELETE FROM sessions WHERE user_id=?', target.id);
          await run('DELETE FROM notifications WHERE user_id=?', target.id);
          await run(
            'DELETE FROM user_blocks WHERE user_id=? OR blocked_id=?',
            target.id,
            target.id,
          );
          await run('DELETE FROM user_handles WHERE user_id=?', target.id);
          await run('DELETE FROM account_security WHERE user_id=?', target.id);
          await run('DELETE FROM users WHERE id=?', target.id);
          await audit(u, 'unused_user_deleted', target.id);
          return;
        }
        bool(b.active);
        const role = b.role ?? target.role,
          name = text(b.name ?? target.name, 2, 120, 'name'),
          email = text(b.email ?? target.email, 3, 254, 'email').toLowerCase();
        check(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'Valid email required', 400);
        check(
          !(await one('SELECT 1 FROM users WHERE email=? AND id<>?', email, target.id)),
          'Email already in use',
          409,
        );
        check(roles.includes(role), 'Invalid role', 400);
        check(
          u.role === 'super_admin' || role === target.role,
          'Only Super Admin can change roles',
        );
        check(
          target.id !== u.id || b.active !== false,
          'Cannot deactivate your current account',
          400,
        );
        if (target.role === 'super_admin' && (b.active === false || role !== 'super_admin'))
          check(
            Number(
              (await one("SELECT COUNT(*) n FROM users WHERE role='super_admin' AND active=1")).n,
            ) > 1,
            'Keep an active Super Admin',
            409,
          );
        const perms = b.permissions ?? json(target.permissions);
        check(
          Array.isArray(perms) && perms.every((p) => permissions.includes(p)),
          'Invalid permissions',
          400,
        );
        check(
          b.permissions === undefined || u.role === 'super_admin',
          'Only Super Admin can change permissions',
        );
        if (target.role === 'head_teacher' && (b.active === false || role !== 'head_teacher')) {
          check(
            !(await one(
              "SELECT 1 FROM school_diaries WHERE head_id=? AND status<>'approved'",
              target.id,
            )),
            'Resolve class diary reviews first',
            409,
          );
          check(
            !(await one(
              'SELECT 1 FROM assignments WHERE active=1 AND (teacher_id=? OR head_id=?)',
              target.id,
              target.id,
            )),
            'Archive or replace active teaching assignments first',
            409,
          );
          check(
            !(await one(
              "SELECT 1 FROM diaries WHERE reviewer_id=? AND status IN('submitted','resubmitted','under_review','returned','draft')",
              target.id,
            )),
            'Resolve outstanding diaries before removing their reviewer',
            409,
          );
        }
        if (b.active === false) {
          for (const a of await all(
            'SELECT id FROM assignments WHERE teacher_id=? AND active=1',
            target.id,
          )) {
            await run('UPDATE assignments SET active=0 WHERE id=?', a.id);
            await run(
              'INSERT INTO assignment_state_events VALUES(?,?,?,?,?)',
              id(),
              a.id,
              dateInZone(),
              0,
              now(),
            );
            await audit(u, 'assignment_archived_for_inactive_teacher', a.id);
          }
        }
        if (role !== target.role)
          check(
            !(await one(
              'SELECT 1 FROM teacher_reviewers WHERE teacher_id=? OR head_id=?',
              target.id,
              target.id,
            )),
            'Remove hierarchy links before changing this role',
            409,
          );
        if (role !== target.role)
          check(
            !(await one(
              'SELECT 1 FROM coordinator_heads WHERE coordinator_id=? OR head_id=?',
              target.id,
              target.id,
            )),
            'Remove hierarchy links before changing this role',
            409,
          );
        if (b.password !== undefined) {
          check(
            passwordAcceptable(b.password),
      PASSWORD_MESSAGE,
            400,
          );
          await run(
            'UPDATE users SET password=? WHERE id=?',
            await db.passwordHashAsync(b.password),
            target.id,
          );
          await security.issueTemporary(target.id, b.password);
        }
        await run(
          'UPDATE users SET name=?,email=?,role=?,permissions=?,active=?,updated_at=? WHERE id=?',
          name,
          email,
          role,
          JSON.stringify(perms),
          b.active === undefined ? target.active : Number(b.active),
          now(),
          target.id,
        );
        await run('DELETE FROM sessions WHERE user_id=?', target.id);
        await audit(u, 'user_updated', target.id, {
          role,
          permissions: perms,
          active: b.active,
          identityUpdated: b.name !== undefined || b.email !== undefined,
        });
      });
      return (reply(res, 200, { ok: true }), true);
    }
    const academic = /^\/api\/academics\/([\w-]+)$/.exec(path);
    if (
      (path === '/api/academics' && method === 'POST') ||
      (academic && ['PATCH', 'DELETE'].includes(method))
    ) {
      check(can(u, 'manage_academics'), 'Academic management permission required');
      let created;
      await transaction(async () => {
        const old = academic ? await one('SELECT * FROM academics WHERE id=?', academic[1]) : null;
        check(!academic || old, 'Academic record not found', 404);
        if (method === 'DELETE') {
          check(
            !(await one(
              'SELECT 1 FROM assignments WHERE section_id=? OR subject_id=? OR session_id=?',
              old.id,
              old.id,
              old.id,
            )) &&
              !(await one('SELECT 1 FROM academics WHERE parent_id=?', old.id)) &&
              !(await one(
                'SELECT 1 FROM class_subjects WHERE class_id=? OR subject_id=?',
                old.id,
                old.id,
              )),
            'Record is in use; remove unused links or archive it instead',
            409,
          );
          check(
            db.settings().assignmentSessionId !== old.id,
            'Choose another assignment session first',
            409,
          );
          await run('DELETE FROM academics WHERE id=?', old.id);
          await audit(u, 'unused_academic_deleted', old.id);
          return;
        }
        bool(b.active);
        const kind = old?.kind ?? b.kind,
          name = text(b.name ?? old?.name, 1, 100, 'academic name'),
          parent = b.parent_id === undefined ? (old?.parent_id ?? null) : b.parent_id || null,
          start = b.start_date ?? old?.start_date ?? null,
          end = b.end_date ?? old?.end_date ?? null,
          active = b.active === undefined ? (old?.active ?? 1) : Number(b.active);
        check(
          ['session', 'department', 'class', 'section', 'subject'].includes(kind),
          'Invalid academic entity',
          400,
        );
        check(
          !parent || ['section', 'subject'].includes(kind),
          'This record cannot have a parent',
          400,
        );
        if (kind === 'section' || parent) {
          const expected = kind === 'section' ? 'class' : 'department',
            p = await one('SELECT * FROM academics WHERE id=? AND kind=?', parent || '', expected);
          check(p && (!active || p.active), 'Choose an active parent ' + expected, 400);
        }
        if (kind === 'session') {
          check(
            validDate(start) && validDate(end) && start <= end,
            'Valid session dates required',
            400,
          );
          check(
            !old ||
              !(await one(
                'SELECT 1 FROM assignments WHERE session_id=? AND (start_date<? OR end_date>?)',
                old.id,
                start,
                end,
              )),
            'Session dates must contain existing assignments',
            409,
          );
        }
        check(
          !(await one(
            "SELECT 1 FROM academics WHERE kind=? AND LOWER(name)=LOWER(?) AND COALESCE(parent_id,'')=COALESCE(?,'') AND id<>?",
            kind,
            name,
            parent,
            old?.id ?? '',
          )),
          'An academic record with this name already exists',
          409,
        );
        if (old && !active)
          check(
            !(await one(
              'SELECT 1 FROM assignments WHERE active=1 AND (section_id=? OR subject_id=? OR session_id=?)',
              old.id,
              old.id,
              old.id,
            )) && !(await one('SELECT 1 FROM academics WHERE parent_id=? AND active=1', old.id)),
            'Deactivate related assignments/child entities first',
            409,
          );
        if (old && parent !== old.parent_id)
          check(
            !(await one(
              'SELECT 1 FROM assignments WHERE section_id=? OR subject_id=?',
              old.id,
              old.id,
            )) && !(await one('SELECT 1 FROM class_subjects WHERE subject_id=?', old.id)),
            'Records with assignments or class links cannot change parent',
            409,
          );
        if (old)
          await run(
            'UPDATE academics SET name=?,parent_id=?,start_date=?,end_date=?,active=? WHERE id=?',
            name,
            parent,
            start,
            end,
            active,
            old.id,
          );
        else {
          created = id();
          await run(
            'INSERT INTO academics VALUES(?,?,?,?,?,?,?)',
            created,
            kind,
            name,
            parent,
            start,
            end,
            active,
          );
        }
        await audit(u, old ? 'academic_updated' : 'academic_created', old?.id ?? created, { kind });
      });
      return (reply(res, created ? 201 : 200, created ? { id: created } : { ok: true }), true);
    }
    if (path === '/api/class-subjects' && method === 'DELETE') {
      check(can(u, 'manage_academics'), 'Academic management permission required');
      await transaction(async () => {
        check(
          await one(
            'SELECT 1 FROM class_subjects WHERE class_id=? AND subject_id=?',
            b.class_id,
            b.subject_id,
          ),
          'Class subject link not found',
          404,
        );
        check(
          !(await one(
            'SELECT 1 FROM assignments a JOIN academics s ON s.id=a.section_id WHERE s.parent_id=? AND a.subject_id=? AND a.active=1',
            b.class_id,
            b.subject_id,
          )),
          'Archive related teaching assignments before unlinking',
          409,
        );
        await run(
          'DELETE FROM class_subjects WHERE class_id=? AND subject_id=?',
          b.class_id,
          b.subject_id,
        );
        await audit(u, 'class_subject_unlinked', b.class_id, { subject_id: b.subject_id });
      });
      return (reply(res, 200, { ok: true }), true);
    }
    if (path === '/api/teacher-reviewers' && method === 'DELETE') {
      check(can(u, 'manage_academics'), 'Academic management permission required');
      check(
        await one('SELECT 1 FROM teacher_reviewers WHERE teacher_id=?', b.teacher_id),
        'Reviewer default not found',
        404,
      );
      await run('DELETE FROM teacher_reviewers WHERE teacher_id=?', b.teacher_id);
      await audit(u, 'teacher_reviewer_default_removed', b.teacher_id);
      return (reply(res, 200, { ok: true }), true);
    }
    const assignment = /^\/api\/assignments\/([\w-]+)(?:\/(schedule))?$/.exec(path);
    if (
      assignment &&
      (method === 'DELETE' || (method === 'PATCH' && (b.active !== undefined || assignment[2])))
    ) {
      check(can(u, 'manage_academics'), 'Academic management permission required');
      await transaction(async () => {
        const a = await one('SELECT * FROM assignments WHERE id=?', assignment[1]);
        check(a, 'Assignment not found', 404);
        if (method === 'DELETE') {
          check(
            !(await one(
              'SELECT 1 FROM school_diaries WHERE teacher_id=? AND section_id=?',
              a.teacher_id,
              a.section_id,
            )) && !(await one('SELECT 1 FROM diaries WHERE assignment_id=?', a.id)),
            'Assignment has diary history; archive it instead',
            409,
          );
          await run('DELETE FROM calendar_exceptions WHERE assignment_id=?', a.id);
          await run('DELETE FROM assignment_state_events WHERE assignment_id=?', a.id);
          await run('DELETE FROM assignments WHERE id=?', a.id);
          await audit(u, 'unused_assignment_deleted', a.id);
          return;
        }
        if (assignment[2]) {
          check(
            !(await one(
              'SELECT 1 FROM school_diaries WHERE teacher_id=? AND section_id=?',
              a.teacher_id,
              a.section_id,
            )) && !(await one('SELECT 1 FROM diaries WHERE assignment_id=?', a.id)),
            'Assignment has diary history; archive it and create a replacement',
            409,
          );
          check(
            Array.isArray(b.weekdays) &&
              b.weekdays.length &&
              b.weekdays.every((x) => Number.isInteger(x) && x >= 0 && x <= 6),
            'Choose valid weekdays',
            400,
          );
          check(
            Array.isArray(b.periods) &&
              b.periods.length &&
              b.periods.every((x) => Number.isInteger(x) && x >= 1 && x <= 20),
            'Choose periods 1–20',
            400,
          );
          check(validTime(b.due_time) && validTime(b.review_time), 'Valid deadlines required', 400);
          await run(
            'UPDATE assignments SET weekdays=?,periods=?,due_time=?,review_time=? WHERE id=?',
            JSON.stringify([...new Set(b.weekdays)]),
            JSON.stringify([...new Set(b.periods)]),
            b.due_time,
            b.review_time,
            a.id,
          );
          await audit(u, 'assignment_schedule_updated', a.id);
          return;
        }
        bool(b.active);
        if (b.active) await assignmentReady(a);
        await run('UPDATE assignments SET active=? WHERE id=?', Number(b.active), a.id);
        await run(
          'INSERT INTO assignment_state_events VALUES(?,?,?,?,?)',
          id(),
          a.id,
          dateInZone(),
          Number(b.active),
          now(),
        );
        await audit(u, 'assignment_updated', a.id, { active: b.active });
      });
      return (reply(res, 200, { ok: true }), true);
    }
    return false;
  };
}
