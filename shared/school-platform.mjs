import { passwordAcceptable, PASSWORD_MESSAGE } from './passwords.mjs';
import { diaryMonitoring } from './diary-monitoring.mjs';
import { captureSchool, hydrateSchool } from './branding.mjs';
import { accountSecurity } from './account-security.mjs';
import { readiness } from './readiness.mjs';
import { diaryQuery } from './diary-query.mjs';
import { legacyPolicy, retainedGrants } from './legacy-policy.mjs';
import { managementScope } from './management-scope.mjs';
import { createDiaryScope } from './diary-scope.mjs';
import { teacherCampusService } from './teacher-campus.mjs';
import {
  forceDeleteService,
  deletionKeys,
  deletionIds,
  filterDeletedResponse,
} from './force-delete.mjs';
import { hierarchyService } from './hierarchy.mjs';
import { subjectPriority } from '../public/subject-priority.js';
import {
  supportedDiaryLanguage,
  languageDirection,
  subjectLanguage,
} from '../public/diary-languages.js';
import {
  consolidateClassDiary,
  groupClassDiaries,
  matchesClassDiary,
  isApprovedDiary,
} from './class-diaries.mjs';
import { validateSubjectAssignments } from '../public/subject-form.js';
import { validateClassSections, duplicateClassSectionMessage } from '../public/class-sections.js';
import {
  capabilityNames,
  roleDefaults,
  permissionService,
  roleRestrictions,
} from './school-permissions.mjs';
import { pushService } from './school-push.mjs';
import { activeNotice, normalizeNotice, emptyNotice } from './diary-notice.mjs';
export function schoolPlatform(db, domain, documents) {
  const teacherCampus = teacherCampusService(db, domain),
    managementAccess = managementScope(db, domain),
    queries = diaryQuery(db, domain);
  const {
    all,
    one,
    run,
    transaction,
    id,
    now,
    audit: recordAudit,
    notify,
    settings,
    publicUser,
    json,
  } = db;
  const createUser = db.createUserAsync || db.createUser,
    security = accountSecurity(db, domain);
  const audit = (u, action, resource, details = {}) =>
    recordAudit(u, action, resource, { actor_role: u?.role || 'system', ...details });
  const { check, validDate, dateInZone, zoneTimestamp, validateContent } = domain;
  const capabilities = permissionService(db),
    push = pushService(db),
    hierarchy = hierarchyService(db, domain),
    forceDelete = forceDeleteService(db, domain);
  let classSectionsTail = Promise.resolve(),
    subjectTail = Promise.resolve(),
    diaryActionTail = Promise.resolve();
  const wide = (u) => ['super_admin', 'school_admin'].includes(u.role);
  const supervisor = (u) => ['coordinator', 'head_teacher'].includes(u.role);
  const text = (v, min, max, label) => {
    check(
      typeof v === 'string' && v.trim().length >= min && v.length <= max,
      'Invalid ' + label,
      400,
    );
    return v.trim();
  };
  async function require(u, cap) {
    check((await capabilities(u)).includes(cap), 'Permission required: ' + cap);
    if (['people.manage', 'hierarchy.manage', 'permissions.manage', 'audit.view'].includes(cap))
      check(wide(u), 'Administrative scope required');
    if (['structure.manage', 'assignments.manage', 'parents.manage', 'quotes.manage'].includes(cap))
      check(wide(u) || supervisor(u), 'Staff management scope required');
  }
  async function activeUser(uid, role) {
    check(typeof uid === 'string' && uid.length > 0, 'Choose an account', 400);
    const x = await one('SELECT * FROM users WHERE id=? AND active=1', uid);
    check(x && (!role || x.role === role), 'Active ' + (role || 'account') + ' required', 400);
    return x;
  }
  async function scoped(u, d) {
    if (
      wide(u) ||
      d.teacher_id === u.id ||
      (['coordinator', 'head_teacher'].includes(u.role) && domain.can(u, 'read_all'))
    )
      return true;
    const link = await one(
      "SELECT r.head_id FROM teacher_reviewers r JOIN users h ON h.id=r.head_id WHERE r.teacher_id=? AND h.active=1 AND h.role='head_teacher'",
      d.teacher_id,
    );
    if (!link) return false;
    if (u.role === 'head_teacher') return link.head_id === u.id;
    return (
      u.role === 'coordinator' &&
      !!(await one(
        'SELECT 1 FROM coordinator_heads WHERE coordinator_id=? AND head_id=?',
        u.id,
        link.head_id,
      ))
    );
  }

  async function meta(sid) {
    check(typeof sid === 'string' && sid.length > 0, 'Choose a class section', 400);
    const s = await one("SELECT * FROM academics WHERE id=? AND kind='section'", sid);
    check(s, 'Section not found', 404);
    const c = await one("SELECT * FROM academics WHERE id=? AND kind='class'", s.parent_id),
      link = await one('SELECT * FROM class_campuses WHERE class_id=?', c.id),
      campus = link ? await one('SELECT * FROM school_nodes WHERE id=?', link.campus_id) : null,
      branch = campus?.parent_id
        ? await one('SELECT * FROM school_nodes WHERE id=?', campus.parent_id)
        : null;
    return {
      section_id: s.id,
      section_name: s.name,
      class_id: c.id,
      class_name: c.name,
      campus_id: campus?.id || '',
      campus_name: campus?.name || '',
      branch_id: branch?.id || '',
      branch_name: branch?.name || '',
      active:
        !!s.active && !!c.active && (!campus || !!campus.active) && (!branch || !!branch.active),
    };
  }
  async function assignments(u, includeDeleted = false) {
    const rows = await all(
      'SELECT a.*,t.name teacher_name,h.name head_name,sub.name subject_name,sec.name section_name,sec.active section_active,c.id class_id,c.name class_name,c.active class_active,cam.id campus_id,cam.name campus_name,cam.active campus_active,br.id branch_id,br.name branch_name,br.active branch_active FROM assignments a JOIN users t ON t.id=a.teacher_id JOIN users h ON h.id=a.head_id JOIN academics sub ON sub.id=a.subject_id JOIN academics sec ON sec.id=a.section_id JOIN academics c ON c.id=sec.parent_id LEFT JOIN class_campuses cc ON cc.class_id=c.id LEFT JOIN school_nodes cam ON cam.id=cc.campus_id LEFT JOIN school_nodes br ON br.id=cam.parent_id',
    );
    const effective = new Map(
      (
        await all(
          "SELECT r.teacher_id,r.head_id,h.name FROM teacher_reviewers r JOIN users h ON h.id=r.head_id WHERE h.active=1 AND h.role='head_teacher'",
        )
      ).map((r) => [r.teacher_id, r]),
    );
    const removed = includeDeleted ? new Set() : await deletionKeys(db);
    const canRead = await createDiaryScope(db, u, {
      readAll: domain.can(u, 'read_all'),
      reviewers: effective,
    });
    const result = [];
    for (const a of rows)
      if (!removed.has('assignment:' + a.id) && canRead(a))
        result.push({
          ...a,
          head_id: effective.get(a.teacher_id)?.head_id || null,
          head_name: effective.get(a.teacher_id)?.name || 'Unassigned Head Teacher',
          weekdays: json(a.weekdays),
          periods: json(a.periods),
          meta: {
            section_id: a.section_id,
            section_name: a.section_name,
            class_id: a.class_id,
            class_name: a.class_name,
            campus_id: a.campus_id || '',
            campus_name: a.campus_name || '',
            branch_id: a.branch_id || '',
            branch_name: a.branch_name || '',
            active:
              !!a.section_active &&
              !!a.class_active &&
              (a.campus_active === null || !!a.campus_active) &&
              (a.branch_active === null || !!a.branch_active),
          },
        });
    return result;
  }
  async function structure(u) {
    const staffHierarchy = ['super_admin', 'school_admin', 'coordinator', 'head_teacher'].includes(
      u.role,
    )
      ? await hierarchy.read(u)
      : null;
    const as = await assignments(u),
      manage = (await capabilities(u)).includes('structure.manage'),
      sections = new Set(as.map((a) => a.section_id)),
      classes = new Set(as.map((a) => a.meta.class_id));
    const priorities = await all('SELECT * FROM subject_priorities');
    const academics = (await all('SELECT * FROM academics ORDER BY kind,name'))
      .map((a) =>
        a.kind === 'subject'
          ? { ...a, priority: priorities.find((p) => p.subject_id === a.id)?.priority ?? 0 }
          : a,
      )
      .filter(
        (a) =>
          manage ||
          wide(u) ||
          sections.has(a.id) ||
          classes.has(a.id) ||
          as.some((x) => x.subject_id === a.id || x.session_id === a.id),
      );
    const nodes = await all('SELECT * FROM school_nodes ORDER BY kind,name'),
      maps = await all('SELECT * FROM class_campuses');
    const campusIDs = new Set(maps.filter((m) => classes.has(m.class_id)).map((x) => x.campus_id));
    return {
      teacherCampuses: Object.entries(await teacherCampus.mappings())
        .filter(
          ([teacher]) => staffHierarchy?.users.some((x) => x.id === teacher) || teacher === u.id,
        )
        .map(([teacher_id, campus_id]) => ({ teacher_id, campus_id })),
      academics,
      nodes: nodes.filter(
        (n) =>
          manage ||
          wide(u) ||
          campusIDs.has(n.id) ||
          nodes.some((c) => campusIDs.has(c.id) && c.parent_id === n.id),
      ),
      classCampuses: maps.filter((m) => manage || wide(u) || classes.has(m.class_id)),
      classSubjects: (await all('SELECT * FROM class_subjects')).filter(
        (x) =>
          manage ||
          wide(u) ||
          as.some((a) => a.meta.class_id === x.class_id && a.subject_id === x.subject_id),
      ),
      sectionSubjects: (await all('SELECT * FROM section_subjects')).filter(
        (x) => manage || wide(u) || sections.has(x.section_id),
      ),
      assignments: as,
      users: staffHierarchy
        ? [
            ...staffHierarchy.users,
            ...((await capabilities(u)).includes('parents.manage')
              ? (await parentCandidates(u)).filter(
                  (parent) => !staffHierarchy.users.some((user) => user.id === parent.id),
                )
              : []),
          ]
        : (await all('SELECT * FROM users ORDER BY name'))
            .filter(
              (x) =>
                wide(u) ||
                x.id === u.id ||
                as.some((a) => [a.teacher_id, a.head_id].includes(x.id)),
            )
            .map(publicUser),
      hierarchy: staffHierarchy?.hierarchy || [],
      reviewers: staffHierarchy?.reviewers || [],
    };
  }
  // Campus and supervisor chosen on the account form. Hierarchy is derived from the campus.
  async function placementInput(u, b, optional = false) {
    for (const key of ['campus_id', 'parent_id'])
      check(
        b[key] === undefined || b[key] === null || typeof b[key] === 'string',
        'Invalid ' + key.replace('_id', ''),
        400,
      );
    const campus_id = b.campus_id || undefined,
      parent_id = b.parent_id || undefined;
    if (campus_id) await require(u, 'assignments.edit');
    if (parent_id) await require(u, 'hierarchy.manage');
    return campus_id || parent_id || !optional ? { campus_id, parent_id } : null;
  }
  async function peopleDirectory(u) {
    // One query at a time: the serverless database pool is small and shared by concurrent requests.
    const users = await all('SELECT * FROM users ORDER BY name'),
      parents = await hierarchy.parentMap(),
      campusOf = await teacherCampus.mappings(),
      secrets = u.role === 'super_admin' ? await security.overview() : null;
    return users.map((x) => {
      const saved = secrets?.accounts.get(x.id);
      return {
        ...publicUser(x),
        created_at: x.created_at,
        updated_at: x.updated_at,
        campus_id: campusOf[x.id] || null,
        reports_to: parents.get(x.id) || null,
        // Super Admin only: security state and any password an administrator issued and nobody replaced.
        ...(secrets && {
          must_change_password: saved?.must_change_password || false,
          mfa_enabled: saved?.mfa_enabled || false,
          temporary_password: saved?.temporary_password || null,
          password_vault: secrets.vaultConfigured,
        }),
      };
    });
  }
  async function parentLinks(u) {
    const ids = await managementAccess.campuses(u);
    const links = await all(
      'SELECT p.*,u.name parent_name,s.name section_name,c.name class_name,cc.campus_id FROM parent_sections p JOIN users u ON u.id=p.parent_id JOIN academics s ON s.id=p.section_id JOIN academics c ON c.id=s.parent_id LEFT JOIN class_campuses cc ON cc.class_id=c.id',
    );
    return ids === null ? links : links.filter((link) => ids.has(link.campus_id));
  }
  async function parentCandidates(u) {
    const permitted = wide(u)
      ? null
      : new Set((await parentLinks(u)).map((link) => link.parent_id));
    return (
      await all(
        "SELECT id,name,email,role,active FROM users WHERE role='parent' AND active=1 ORDER BY name,id",
      )
    )
      .filter((user) => permitted === null || permitted.has(user.id))
      .map((user) => ({ ...user, active: !!user.active }));
  }
  const summaryColumns = db.schoolDiarySummaryColumns || '*';
  const parse = (d) => ({
    ...d,
    content: json(d.content),
    snapshot: json(d.snapshot),
    quotes: json(d.quote_payload),
  });
  async function get(u, did) {
    await require(u, 'diary.view');
    const d = await one('SELECT * FROM school_diaries WHERE id=?', did);
    check(d && (await scoped(u, d)), 'Diary not found', 404);
    return { ...parse(d), force_deleted: (await deletionKeys(db)).has('diary:' + did) };
  }
  async function selectedQuotes(date) {
    const rows = await all(
      "SELECT q.* FROM quote_schedules s JOIN quotes q ON q.id=s.quote_id JOIN users u ON u.id=q.created_by WHERE s.date=? AND s.scope_id IS NULL AND q.scope_id IS NULL AND q.active=1 AND u.role IN('super_admin','school_admin','coordinator','head_teacher') ORDER BY s.priority DESC,s.id LIMIT 1",
      date,
    );
    return rows.map((q) => ({
      id: q.id,
      text: q.text,
      language: q.language,
      direction: q.direction,
    }));
  }
  async function eligible(teacher, sid, date) {
    const m = await meta(sid);
    check(m.active, 'Class, section, campus or branch is archived', 409);
    const as = await all(
      'SELECT a.*,s.name subject_name FROM assignments a JOIN academics s ON s.id=a.subject_id JOIN teacher_reviewers tr ON tr.teacher_id=a.teacher_id JOIN users h ON h.id=tr.head_id WHERE a.teacher_id=? AND a.section_id=? AND a.active=1 AND a.start_date<=? AND a.end_date>=? AND s.active=1 AND h.active=1',
      teacher,
      sid,
      date,
      date,
    );
    const reviewer = await one(
      "SELECT r.head_id FROM teacher_reviewers r JOIN users h ON h.id=r.head_id WHERE r.teacher_id=? AND h.active=1 AND h.role='head_teacher'",
      teacher,
    );
    check(
      reviewer,
      'Configure an active Head Teacher in Hierarchy Management before writing a diary',
      403,
    );
    const result = [];
    for (const a of as)
      if (
        await one(
          'SELECT 1 FROM section_subjects WHERE section_id=? AND subject_id=?',
          sid,
          a.subject_id,
        )
      )
        result.push({ ...a, head_id: reviewer.head_id });
    return result;
  }
  async function version(u, d, action, remarks = '') {
    await run(
      'INSERT INTO school_diary_versions VALUES(?,?,?,?,?,?,?,?)',
      id(),
      d.id,
      d.version,
      u.id,
      action,
      remarks,
      JSON.stringify(d),
      now(),
    );
    await audit(u, 'class_diary_' + action, d.id, {
      version: d.version,
      ...d.snapshot.meta,
      date: d.diary_date,
    });
  }
  async function notices(d, message, suffix, recipients) {
    const current = await one(
      'SELECT head_id FROM teacher_reviewers WHERE teacher_id=?',
      d.teacher_id,
    );
    recipients = recipients.map((uid) => (uid === d.head_id ? current?.head_id : uid));
    const coords = await all(
        'SELECT coordinator_id FROM coordinator_heads WHERE head_id=?',
        current?.head_id || '',
      ),
      admins = await all(
        "SELECT id FROM users WHERE active=1 AND role IN('super_admin','school_admin')",
      );
    for (const uid of new Set(
      [...recipients, ...coords.map((x) => x.coordinator_id), ...admins.map((x) => x.id)].filter(
        Boolean,
      ),
    ))
      await notify(
        uid,
        null,
        message,
        'school:' + d.id + ':' + d.version + ':' + suffix + ':' + uid,
      );
  }
  async function save(u, b, did) {
    check(
      b.submit === undefined || typeof b.submit === 'boolean',
      'Submit must be true or false.',
      400,
    );
    return transaction(async () => {
      await require(u, did ? 'diary.edit' : 'diary.create');
      if (b.submit === true) await require(u, 'diary.submit');
      const old = did ? await get(u, did) : null,
        teacher = old?.teacher_id || (wide(u) ? b.teacher_id || u.id : u.id);
      check(wide(u) || teacher === u.id, 'Only the author can edit a diary');
      await activeUser(teacher);
      check(!old || wide(u) || old.teacher_id === u.id, 'Only the author can edit a diary');
      check(
        !old || ['draft', 'returned'].includes(old.status),
        'Submitted and approved diaries are locked',
        409,
      );
      check(!old?.content.deleted_at, 'Restore this draft from Trash before editing', 409);
      if (old) check(Number(b.version) === old.version, 'Diary changed; reload before saving', 409);
      const sid = old?.section_id || b.section_id,
        date = old?.diary_date || b.diary_date;
      check(validDate(date), 'A valid diary date is required', 400);
      if (b.language !== undefined)
        check(supportedDiaryLanguage(b.language), 'Choose a supported diary language', 400);
      if (b.subject_languages !== undefined)
        check(typeof b.subject_languages === 'boolean', 'Invalid subject language mode', 400);
      const as = await eligible(teacher, sid, date);
      check(as.length, 'Configure section subjects and teacher assignments for this date', 403);
      check(
        Array.isArray(b.rows) && b.rows.length >= 1 && b.rows.length <= 30,
        'Select 1–30 assigned subjects',
        400,
      );
      const perSubject =
        b.subject_languages === true ||
        b.language === undefined ||
        b.rows.some((r) => r && Object.hasOwn(r, 'language'));
      const seen = new Set(),
        heads = new Set();
      const rows = b.rows.map((r) => {
        check(r && typeof r === 'object' && !Array.isArray(r), 'Invalid subject row', 400);
        const a = as.find((a) => a.id === r.assignment_id);
        check(a, 'Subject is outside the teacher’s section assignments', 403);
        check(!seen.has(a.subject_id), 'A subject may appear only once', 400);
        seen.add(a.subject_id);
        heads.add(a.head_id);
        if (r.language !== undefined)
          check(
            r.language === '' || supportedDiaryLanguage(r.language),
            'Choose a supported Language for each subject',
            400,
          );
        const previous = old?.content.homework_rows.find(
            (row) => row.assignment_id === a.id || row.subject_id === a.subject_id,
          ),
          language =
            r.language ??
            (previous ? subjectLanguage(previous, old.language) : perSubject ? '' : b.language);
        check(
          language === '' || supportedDiaryLanguage(language),
          'Choose a supported Language for each subject',
          400,
        );
        if (b.submit)
          check(
            supportedDiaryLanguage(language),
            'Select a Language for every selected subject before submitting',
            400,
          );
        return {
          subject: a.subject_name,
          detail: r.detail,
          hw: r.hw,
          learn: r.learn,
          test: r.test,
          language,
          direction: languageDirection(language),
          subject_id: a.subject_id,
          assignment_id: a.id,
        };
      });
      check(
        heads.size === 1,
        'All selected subjects must have the teacher’s same Head Teacher reviewer',
        409,
      );
      const content = validateContent(
        { diary_layout: 'homework_grid', homework_rows: rows },
        b.submit === true,
      );
      content.homework_rows = content.homework_rows.map((r, i) => ({
        ...r,
        subject_id: rows[i].subject_id,
        assignment_id: rows[i].assignment_id,
      }));
      if (b.submit)
        check(
          content.homework_rows.every((r) => r.detail.trim()),
          'Enter homework detail for every selected subject',
          400,
        );
      check(
        old ||
          !(await one(
            'SELECT 1 FROM school_diaries WHERE teacher_id=? AND section_id=? AND diary_date=?',
            teacher,
            sid,
            date,
          )),
        'A diary already exists for this teacher, class section and date',
        409,
      );
      const teacherUser = await activeUser(teacher),
        head_id = [...heads][0],
        uid = old?.id || id(),
        stamp = now(),
        status = b.submit
          ? old?.status === 'returned'
            ? 'resubmitted'
            : 'submitted'
          : old?.status || 'draft',
        snapshot = old?.snapshot || {
          school: await captureSchool(db),
          meta: await meta(sid),
          teacher_name: teacherUser.name,
        };
      const legacyLanguage =
        old?.language ||
        rows.find((r) => supportedDiaryLanguage(r.language))?.language ||
        b.language ||
        'en';
      if (old)
        await run(
          'UPDATE school_diaries SET head_id=?,language=?,status=?,version=version+1,content=?,submitted_at=?,updated_at=? WHERE id=?',
          head_id,
          legacyLanguage,
          status,
          JSON.stringify(content),
          b.submit ? stamp : old.submitted_at,
          stamp,
          uid,
        );
      else
        await run(
          "INSERT INTO school_diaries VALUES(?,?,?,?,?,?,?,1,?,?,?,'',?,NULL,?,?)",
          uid,
          teacher,
          head_id,
          sid,
          date,
          legacyLanguage,
          status,
          JSON.stringify(content),
          JSON.stringify(snapshot),
          JSON.stringify(await selectedQuotes(date)),
          b.submit ? stamp : null,
          stamp,
          stamp,
        );
      const current = await get(u, uid);
      await version(u, current, b.submit ? status : 'draft_saved');
      if (b.submit)
        await notices(current, 'A class diary was ' + status.replaceAll('_', ' '), 'review', [
          head_id,
          teacher,
        ]);
      return current;
    });
  }
  function operateDiary(...args) {
    const pending = diaryActionTail.then(() => runDiaryAction(...args));
    diaryActionTail = pending.catch(() => {});
    return pending;
  }
  async function runDiaryAction(u, did, b, operation) {
    const actor = await one('SELECT role,active FROM users WHERE id=?', u.id);
    check(
      actor?.active && actor.role === u.role,
      'Your account permissions changed. Sign in again.',
      403,
    );
    if (operation === 'submit') {
      const d = await get(u, did);
      check(!d.force_deleted, 'This diary is read-only.', 409);
      check(
        ['draft', 'returned'].includes(d.status),
        'Only drafts and returned diaries can be submitted',
        409,
      );
      check(Number(b.version) === d.version, 'Diary changed; reload', 409);
      return save(
        u,
        {
          version: d.version,
          subject_languages: true,
          rows: d.content.homework_rows.map((row) => ({
            ...row,
            language: subjectLanguage(row, d.language),
          })),
          submit: true,
        },
        did,
      );
    }
    return transaction(async () => {
      const d = await get(u, did);
      check(u.role !== 'parent', 'Use the approved family diary view');
      check(!d.force_deleted, 'This diary is read-only.', 409);
      check(Number(b.version) === d.version, 'Diary changed; reload', 409);
      if (['trash', 'restore'].includes(operation)) {
        await require(u, 'diary.delete');
        check(
          wide(u) || d.teacher_id === u.id || (supervisor(u) && (await scoped(u, d))),
          'You cannot discard this teacher’s draft',
          403,
        );
        check(
          d.status === 'draft' && !d.submitted_at,
          'Only an unsubmitted draft can be discarded or restored',
          409,
        );
        const content = { ...d.content };
        if (operation === 'restore') {
          check(content.deleted_at, 'Draft is not in Trash', 409);
          delete content.deleted_at;
        } else {
          check(!content.deleted_at, 'Draft is already in Trash', 409);
          content.deleted_at = now();
        }
        await run(
          'UPDATE school_diaries SET content=?,version=version+1,updated_at=? WHERE id=?',
          JSON.stringify(content),
          now(),
          did,
        );
        await version(
          u,
          await get(u, did),
          operation === 'restore' ? 'draft_restored' : 'draft_discarded',
        );
      } else if (operation === 'amend') {
        await require(u, 'diary.amend');
        const reason = text(b.reason, 5, 5000, 'amendment reason');
        check(d.status === 'approved', 'Only the current approved version can be amended', 409);
        await run(
          "UPDATE school_diaries SET status='returned',remarks=?,version=version+1,updated_at=? WHERE id=?",
          'Amendment: ' + reason,
          now(),
          did,
        );
        const revised = await get(u, did);
        await version(u, revised, 'amendment_requested', reason);
        await notices(revised, 'A diary amendment was requested', 'amend', [d.teacher_id]);
      } else {
        check(
          ['approved', 'returned', 'under_review'].includes(operation),
          'Invalid review action',
          400,
        );
        await require(u, {
          approved: 'diary.approve',
          returned: 'diary.return',
          under_review: 'diary.review',
        }[operation]);
        check(
          wide(u) || (supervisor(u) && (await scoped(u, d))),
          'Reviewer is outside this diary scope',
          403,
        );
        check(u.id !== d.teacher_id, 'Self approval is disabled', 403);
        check(
          !d.content.deleted_at && ['submitted', 'resubmitted', 'under_review'].includes(d.status),
          'Diary is not awaiting review',
          409,
        );
        const remarks = text(
            b.remarks || '',
            operation === 'returned' ? 1 : 0,
            5000,
            'review comments',
          ),
          quotes = operation === 'approved' ? await selectedQuotes(d.diary_date) : d.quotes;
        await run(
          'UPDATE school_diaries SET status=?,remarks=?,quote_payload=?,reviewed_at=?,version=version+1,updated_at=? WHERE id=?',
          operation,
          remarks,
          JSON.stringify(quotes),
          now(),
          now(),
          did,
        );
        const reviewed = await get(u, did);
        await version(u, reviewed, operation, remarks);
        await notices(
          reviewed,
          'Your class diary was ' + operation.replaceAll('_', ' '),
          'decision',
          [d.teacher_id],
        );
        if (operation === 'approved')
          for (const p of await all(
            'SELECT parent_id FROM parent_sections WHERE section_id=? AND active=1',
            d.section_id,
          ))
            await notify(
              p.parent_id,
              null,
              'An approved class diary is available',
              'parent:' +
                d.section_id +
                ':' +
                d.diary_date +
                ':' +
                d.id +
                ':' +
                reviewed.version +
                ':' +
                p.parent_id,
            );
      }
      return get(u, did);
    });
  }
  async function schoolSettings() {
    const row = await one('SELECT value FROM settings WHERE id=1');
    return row ? json(row.value) : {};
  }
  async function sources(diaries, parent = false, consolidated = false) {
    if (parent || consolidated) {
      diaries = diaries.filter(isApprovedDiary);
      check(diaries.length, 'No approved diary is available for this class and date', 404);
    }
    const first = diaries[0],
      combined =
        parent || consolidated
          ? consolidateClassDiary(diaries, await all('SELECT * FROM subject_priorities'))
          : null,
      rows = combined
        ? combined.content.homework_rows
        : diaries.flatMap((d) =>
            d.content.homework_rows.map((row) => ({
              ...row,
              language: subjectLanguage(row, d.language),
              teacher_name: d.snapshot.teacher_name,
            })),
          );
    // Display the administrator's current schedule for the diary date.
    // Approval-time quote_payload remains immutable for audit/history.
    const quotes = await selectedQuotes(first.diary_date);
    const m = first.snapshot.meta,
      school = await hydrateSchool(db, first.snapshot.school);
    const synthetic = {
      ...first,
      id: combined?.id || first.id,
      assignment_id: first.id,
      period: 1,
      status: combined?.status || first.status,
      review_remarks: '',
      quote_snapshot: quotes.slice(0, 1),
      notice_snapshot: activeNotice(await schoolSettings(), first.diary_date),
      template_snapshot: {
        ...school,
        assignmentSnapshot: {
          ...m,
          teacher_name: parent
            ? 'Class diary'
            : combined
              ? 'Consolidated class diary'
              : first.snapshot.teacher_name,
          subject_name: 'Class diary',
          session_name: school.session || '',
        },
      },
      assignment: {
        ...m,
        teacher_name: first.snapshot.teacher_name,
        subject_name: 'Class diary',
        session_name: school.session || '',
      },
      content: combined ? combined.content : { ...first.content, homework_rows: rows },
    };
    return [await documents.diarySource(synthetic)];
  }
  // Approval is final only when the current version has its immutable workflow approval record.
  const approvedSql =
    "status='approved' AND submitted_at IS NOT NULL AND reviewed_at IS NOT NULL AND EXISTS (SELECT 1 FROM school_diary_versions v WHERE v.diary_id=school_diaries.id AND v.version=school_diaries.version AND v.action='approved')";
  async function approvedEntries(u, q = {}, summary = false) {
    await require(u, 'diary.view');
    check(u.role !== 'parent', 'Use the approved family diary view');
    for (const key of ['start', 'end', 'date'])
      if (q[key]) check(validDate(q[key]), 'Choose a valid diary date', 400);
    const clauses = [approvedSql],
      args = [];
    for (const [key, column, operator] of [
      ['section', 'section_id', '='],
      ['date', 'diary_date', '='],
      ['start', 'diary_date', '>='],
      ['end', 'diary_date', '<='],
    ])
      if (q[key]) {
        clauses.push(column + operator + '?');
        args.push(q[key]);
      }
    const entries = [],
      removed = await deletionKeys(db),
      canRead = await createDiaryScope(db, u, { readAll: domain.can(u, 'read_all') });
    for (const raw of await all(
      'SELECT ' +
        (summary ? summaryColumns : '*') +
        ' FROM school_diaries WHERE ' +
        clauses.join(' AND ') +
        ' ORDER BY diary_date DESC,created_at,id',
      ...args,
    )) {
      if (!canRead(raw)) continue;
      const d = parse(raw);
      if (d.content.deleted_at || removed.has('diary:' + d.id)) continue;
      entries.push(d);
    }
    return entries;
  }
  async function consolidated(u, q) {
    check(
      typeof q.section === 'string' && q.section && validDate(q.date),
      'Choose a section and diary date',
      400,
    );
    const entries = await approvedEntries(u, { section: q.section, date: q.date });
    check(entries.length, 'No approved diary is available for this class and date', 404);
    return {
      entries,
      diary: consolidateClassDiary(entries, await all('SELECT * FROM subject_priorities')),
    };
  }
  async function family(u, q, full = false) {
    check(u.role === 'parent', 'Parent account required');
    await require(u, 'diary.view');
    const deletedFamily = await deletionKeys(db);
    const links = await all(
        'SELECT p.*,s.name section_name,c.name class_name FROM parent_sections p JOIN academics s ON s.id=p.section_id JOIN academics c ON c.id=s.parent_id WHERE p.parent_id=? AND p.active=1',
        u.id,
      ),
      sid = q.section || links[0]?.section_id;
    if (!sid) return { links, dates: [], entries: [], date: q.date || dateInZone() };
    check(
      links.some((x) => x.section_id === sid),
      'Section is not linked to this parent',
      404,
    );
    const dates = (
        await all(
          'SELECT DISTINCT diary_date FROM school_diaries WHERE section_id=? AND ' +
            approvedSql +
            ' AND ' +
            queries.field('content', ['deleted_at']) +
            ' IS NULL AND ' +
            queries.notDeleted +
            ' ORDER BY diary_date DESC LIMIT 60',
          sid,
        )
      ).map((row) => row.diary_date),
      date = q.date || dates[0] || dateInZone();
    check(validDate(date), 'Invalid date', 400);
    const entries = (
      await all(
        'SELECT ' +
          (full ? '*' : summaryColumns) +
          ' FROM school_diaries WHERE section_id=? AND diary_date=? AND ' +
          approvedSql +
          ' ORDER BY created_at,id',
        sid,
        date,
      )
    )
      .map(parse)
      .filter((d) => isApprovedDiary(d) && !deletedFamily.has('diary:' + d.id));
    return { links, dates, date, section: sid, entries };
  }

  async function report(u, q) {
    await require(u, 'reports.view');
    check(
      validDate(q.start) &&
        validDate(q.end) &&
        q.start <= q.end &&
        (Date.parse(q.end) - Date.parse(q.start)) / 86400000 <= 366,
      'Select a valid range up to 367 days',
      400,
    );
    const curriculum = await all('SELECT * FROM section_subjects');
    const as = (await assignments(u, true)).filter(
      (a) =>
        curriculum.some((x) => x.section_id === a.section_id && x.subject_id === a.subject_id) &&
        (!q.teacher || a.teacher_id === q.teacher) &&
        (!q.section || a.section_id === q.section) &&
        (!q.class || a.meta.class_id === q.class) &&
        (!q.campus || a.meta.campus_id === q.campus) &&
        (!q.branch || a.meta.branch_id === q.branch) &&
        (!q.subject || a.subject_id === q.subject),
    );
    const stateEvents = await all(
      'SELECT * FROM assignment_state_events ORDER BY effective_date DESC,created_at DESC',
    );
    const diaries = (
        await all(
          'SELECT ' + summaryColumns + ' FROM school_diaries WHERE diary_date BETWEEN ? AND ?',
          q.start,
          q.end,
        )
      )
        .map(parse)
        .filter((d) => !d.content.deleted_at),
      exceptions = await all(
        'SELECT * FROM calendar_exceptions WHERE date BETWEEN ? AND ?',
        q.start,
        q.end,
      ),
      slots = [];
    const eventsByAssignment = new Map(),
      diaryByDay = new Map(),
      exceptionsByDay = new Map();
    for (const event of stateEvents) {
      if (!eventsByAssignment.has(event.assignment_id))
        eventsByAssignment.set(event.assignment_id, []);
      eventsByAssignment.get(event.assignment_id).push(event);
    }
    for (const diary of diaries)
      diaryByDay.set(diary.teacher_id + ':' + diary.section_id + ':' + diary.diary_date, diary);
    for (const exception of exceptions) {
      if (!exceptionsByDay.has(exception.date)) exceptionsByDay.set(exception.date, []);
      exceptionsByDay.get(exception.date).push(exception);
    }
    for (let ms = Date.parse(q.start); ms <= Date.parse(q.end); ms += 86400000) {
      const date = new Date(ms).toISOString().slice(0, 10),
        groups = new Map();
      for (const a of as) {
        const event = eventsByAssignment.get(a.id)?.find((e) => e.effective_date <= date),
          effective = event ? event.active : eventsByAssignment.has(a.id) ? 1 : a.active;
        if (
          (!effective &&
            !diaryByDay
              .get(a.teacher_id + ':' + a.section_id + ':' + date)
              ?.content.homework_rows.some((r) => r.subject_id === a.subject_id)) ||
          date < a.start_date ||
          date > a.end_date ||
          !a.weekdays.includes(new Date(ms).getUTCDay()) ||
          (exceptionsByDay.get(date) || []).some(
            (e) => !e.assignment_id || e.assignment_id === a.id,
          )
        )
          continue;
        const key = a.teacher_id + ':' + a.section_id;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(a);
      }
      for (const group of groups.values()) {
        const a = group[0],
          d = diaryByDay.get(a.teacher_id + ':' + a.section_id + ':' + date),
          due = group.map((x) => x.due_time).sort()[0],
          overdue = !d?.submitted_at && new Date() > new Date(zoneTimestamp(date, due));
        const row = {
          date,
          teacher_id: a.teacher_id,
          teacher_name: d?.snapshot.teacher_name || a.teacher_name,
          head_id: d?.head_id || a.head_id,
          ...(d?.snapshot.meta || a.meta),
          subjects: group.map((x) => x.subject_name),
          subject_ids: group.map((x) => x.subject_id),
          status: d?.status || 'not_submitted',
          diary_id: d?.id || null,
          submitted: !!d?.submitted_at,
          overdue,
          due_at: zoneTimestamp(date, due),
          review_due_at: zoneTimestamp(date, group.map((x) => x.review_time).sort()[0]),
        };
        if (!q.status || q.status === row.status || (q.status === 'overdue' && overdue))
          slots.push(row);
      }
    }
    return {
      slots,
      counts: {
        expected: slots.length,
        submitted: slots.filter((s) => s.submitted).length,
        approved: slots.filter((s) => s.status === 'approved').length,
        returned: slots.filter((s) => s.status === 'returned').length,
        pending: slots.filter((s) =>
          ['submitted', 'resubmitted', 'under_review'].includes(s.status),
        ).length,
        overdue: slots.filter((s) => s.overdue).length,
      },
    };
  }
  async function monitoring(u, q = {}, prepared) {
    await require(u, 'reports.view');
    await require(u, 'diary.view');
    check(u.role !== 'parent', 'Staff monitoring access required');
    const date = q.date || dateInZone();
    check(validDate(date), 'Choose a valid diary date', 400);
    const data = prepared?.report || (await report(u, { start: date, end: date })),
      filter = queries.where(u, { start: date, end: date }),
      entries =
        prepared?.diaries ||
        (
          await all(
            'SELECT ' + summaryColumns + ' FROM school_diaries WHERE ' + filter.sql,
            ...filter.args,
          )
        ).map(parse),
      approved = new Set((await approvedEntries(u, { date }, true)).map((d) => d.id));
    const matrix = diaryMonitoring(data.slots, entries, approved, {
      actorId: u.id,
      capabilities: (await capabilities(u)).filter(
        (cap) =>
          !['diary.approve', 'notifications.manage'].includes(cap) || wide(u) || supervisor(u),
      ),
      date,
      campus: q.campus || '',
      timezone: settings().timezone,
    });
    matrix.campuses = [
      ...new Map(
        (await assignments(u)).map((assignment) => [
          assignment.meta.campus_id,
          {
            id: assignment.meta.campus_id,
            name: assignment.meta.campus_name || 'Unassigned campus',
          },
        ]),
      ).values(),
    ];
    if (q.campus)
      check(
        matrix.campuses.some((campus) => campus.id === q.campus),
        'Campus is outside your scheduled teaching scope for this date',
        404,
      );
    return matrix;
  }
  async function deadlines() {
    const admin = await one("SELECT * FROM users WHERE role='super_admin' AND active=1 LIMIT 1");
    if (!admin) return;
    const date = dateInZone(),
      data = await report(admin, { start: date, end: date }),
      administrators = await all(
        "SELECT id FROM users WHERE active=1 AND role IN('super_admin','school_admin')",
      ),
      hierarchy = await all('SELECT * FROM coordinator_heads'),
      pending = [];
    const add = (uid, message, key) => pending.push([id(), uid, null, message, key, now()]);
    for (const s of data.slots) {
      const oversight = [
        s.head_id,
        ...hierarchy.filter((c) => c.head_id === s.head_id).map((c) => c.coordinator_id),
        ...administrators.map((a) => a.id),
      ];
      if (!s.submitted && new Date() > new Date(new Date(s.due_at).getTime() - 3600000))
        for (const uid of new Set([s.teacher_id, ...oversight]))
          add(
            uid,
            (s.overdue ? 'Overdue class diary' : 'Class diary due soon') +
              ': ' +
              s.class_name +
              ' / ' +
              s.section_name,
            'class-deadline:' +
              s.teacher_id +
              ':' +
              s.section_id +
              ':' +
              date +
              ':' +
              s.overdue +
              ':' +
              uid,
          );
      if (
        s.diary_id &&
        ['submitted', 'resubmitted', 'under_review'].includes(s.status) &&
        new Date() > new Date(new Date(s.review_due_at).getTime() - 3600000)
      )
        for (const uid of new Set(oversight))
          add(
            uid,
            'Class diary review needs attention: ' + s.class_name + ' / ' + s.section_name,
            'school:' + s.diary_id + ':review-deadline:' + date + ':' + uid,
          );
      if (s.diary_id && s.status === 'returned')
        add(
          s.teacher_id,
          'A returned class diary needs correction and resubmission',
          'school:' + s.diary_id + ':resubmit-reminder:' + date,
        );
    }
    for (let i = 0; i < pending.length; i += 200) {
      const batch = pending.slice(i, i + 200);
      await run(
        'INSERT OR IGNORE INTO notifications(id,user_id,diary_id,message,dedupe_key,created_at) VALUES ' +
          batch.map(() => '(?,?,?,?,?,?)').join(','),
        ...batch.flat(),
      );
    }
  }
  const service = {
    capabilities,
    push,
    deadlines,
    security,
    async routeCore({ path, method, b, q, u, res, reply, htmlResponse }) {
      check(
        b.submit === undefined || typeof b.submit === 'boolean',
        'Submit must be true or false.',
        400,
      );
      if (
        ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) &&
        (path === '/api/school/permissions' || path.startsWith('/api/school/force-delete/'))
      )
        security.requireRecent(u);
      const deleted = await deletionKeys(db),
        hidden = deletionIds(deleted);
      res.filterDeleted = (value) => filterDeletedResponse(value, path, deleted);
      const forceRoute =
        /^\/api\/school\/force-delete\/(user|academic|node|assignment|diary|legacy_diary|quote)\/([\w-]+)$/.exec(
          path,
        );
      if (forceRoute && method === 'GET')
        return (reply(res, 200, await forceDelete.preview(u, forceRoute[1], forceRoute[2])), true);
      if (forceRoute && method === 'POST')
        return (
          reply(res, 200, await forceDelete.remove(u, forceRoute[1], forceRoute[2], b)),
          true
        );
      if (path === '/api/school/deleted-records' && method === 'GET')
        return (reply(res, 200, await forceDelete.list(u)), true);
      if (!['GET', 'HEAD'].includes(method)) {
        const target =
          /^\/api\/(?:school\/)?(?:structure|academics|people|users|assignments|diaries|quotes)\/([\w-]+)/.exec(
            path,
          );
        check(
          !target || !hidden.has(target[1]),
          'This record was force-deleted. Its historical information is read-only.',
          409,
        );
        const references = (value, key = '') => {
          if (value && typeof value === 'object')
            for (const [name, child] of Object.entries(value)) references(child, name);
          else if (typeof value === 'string' && /(?:_id|_ids|Id|Ids)$/.test(key))
            check(
              !hidden.has(value),
              'A selected record was force-deleted. Refresh the page and choose an active record.',
              409,
            );
        };
        const scan = (value, key = '') => {
          if (Array.isArray(value)) value.forEach((item) => scan(item, key));
          else if (value && typeof value === 'object')
            for (const [name, item] of Object.entries(value)) scan(item, name);
          else references(value, key);
        };
        scan(q);
        scan(b);
      }
      if (await security.route({ path, method, b, u, res, reply })) return true;
      if (
        u.role === 'parent' &&
        path.startsWith('/api/school/') &&
        ![
          '/api/school/bootstrap',
          '/api/school/push',
          '/api/school/push/test',
          '/api/school/dashboard',
          '/api/school/family',
          '/api/school/family/preview',
          '/api/school/alerts',
        ].includes(path)
      )
        check(false, 'Parent accounts can access approved family diaries only');
      if (
        u.role === 'parent' &&
        !path.startsWith('/api/school/') &&
        !['/api/me', '/api/logout', '/api/profile', '/api/notifications'].includes(path)
      )
        check(false, 'Parent accounts can access approved family diaries only');
      if (path === '/api/hierarchy' && ['POST', 'DELETE'].includes(method))
        return (
          reply(
            res,
            method === 'POST' ? 201 : 200,
            await hierarchy.mutate(
              u,
              'coordinator',
              {
                ...q,
                ...b,
                parent_id: b.coordinator_id || q.coordinator_id,
                child_id: b.head_id || q.head_id,
              },
              method === 'POST' ? 'create' : 'remove',
            ),
          ),
          true
        );
      if (path === '/api/teacher-reviewers' && ['POST', 'DELETE'].includes(method)) {
        const old = await one(
          'SELECT head_id FROM teacher_reviewers WHERE teacher_id=?',
          b.teacher_id,
        );
        return (
          reply(
            res,
            200,
            await hierarchy.mutate(
              u,
              'reviewer',
              {
                ...b,
                parent_id: method === 'DELETE' ? old?.head_id : b.head_id,
                child_id: b.teacher_id,
                expected_parent_id: old?.head_id,
              },
              method === 'DELETE' ? 'remove' : old ? 'move' : 'create',
            ),
          ),
          true
        );
      }
      if (path === '/api/users' || path.startsWith('/api/users/'))
        check(wide(u), 'User Management is restricted to authorized administrators');
      if (!wide(u) && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        if (path === '/api/assignment-session')
          check(false, 'Only an administrator can change the school-wide current session.', 403);
        if (path.startsWith('/api/exceptions')) {
          const saved =
            path !== '/api/exceptions'
              ? await one(
                  'SELECT assignment_id FROM calendar_exceptions WHERE id=?',
                  path.split('/').at(-1),
                )
              : null;
          const aid = b.assignment_id || saved?.assignment_id;
          check(aid, 'Only an administrator can change a school-wide calendar exception.', 403);
          const assignment = await one('SELECT teacher_id FROM assignments WHERE id=?', aid);
          check(assignment, 'Teaching assignment not found', 404);
          await managementAccess.teacher(u, assignment.teacher_id);
        }
        const academicTarget = /^\/api\/(?:school\/structure|academics)\/([\w-]+)$/.exec(path);
        if (academicTarget) await managementAccess.academic(u, academicTarget[1]);
        if (['/api/school/structure', '/api/academics'].includes(path)) {
          if (['class_sections', 'class'].includes(b.kind))
            await managementAccess.campus(u, b.parent_id);
          else if (b.kind === 'section') await managementAccess.academic(u, b.parent_id);
          else if (b.kind === 'subject_assignments')
            for (const sid of b.section_ids || []) await managementAccess.section(u, sid);
          else
            check(
              false,
              'An administrator must manage school-wide branches, campuses, sessions and unassigned master records.',
              403,
            );
        }
        if (path === '/api/school/curriculum') await managementAccess.section(u, b.section_id);
        if (b.section_ids && path.startsWith('/api/school/structure'))
          for (const sid of b.section_ids) await managementAccess.section(u, sid);
      }

      if (!path.startsWith('/api/school/')) {
        if (
          path.startsWith('/api/assignments') &&
          ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
        ) {
          const match = /^\/api\/assignments\/([\w-]+)(?:\/schedule)?$/.exec(path),
            old = match ? await one('SELECT * FROM assignments WHERE id=?', match[1]) : null;
          if (old) await managementAccess.teacher(u, old.teacher_id);
          const teacher = b.teacher_id ?? old?.teacher_id;
          if (teacher) await managementAccess.teacher(u, teacher);
          const pairs = Array.isArray(b.pairs)
            ? b.pairs
            : [{ section_id: b.section_id ?? old?.section_id }];
          if (teacher && b.active !== false && method !== 'DELETE')
            for (const pair of pairs)
              await teacherCampus.assertAssignment(teacher, pair.section_id, { legacy: true });
        }
        if (path === '/api/school-identity') await require(u, 'settings.manage');
        if ((path === '/api/settings' && method !== 'GET') || path.startsWith('/api/templates')) {
          await require(u, 'template.manage');
          check(wide(u), 'Administrative scope required');
          u.permissions = JSON.stringify([...new Set([...json(u.permissions), 'manage_settings'])]);
        }
        if (path.startsWith('/api/communication'))
          await require(u, path.includes('/oversight')
            ? 'communication.oversight'
            : 'communication.use');
        const policy = legacyPolicy(path, method, b, q);
        const legacyDiary = /^\/api\/diaries\/([\w-]+)(?:\/|$)/.exec(path);
        if (legacyDiary) await domain.diary(u, legacyDiary[1]);
        const custom =
          (await one('SELECT 1 FROM user_capabilities WHERE user_id=?', u.id)) ||
          (await one('SELECT 1 FROM role_capabilities WHERE role=?', u.role));
        const retained = custom ? new Set() : retainedGrants(u);
        for (const cap of policy.caps) {
          if (!retained.has(cap)) await require(u, cap);
          else if (['structure.manage', 'assignments.manage', 'quotes.manage'].includes(cap))
            check(wide(u) || supervisor(u), 'Staff management scope required');
          else if (cap === 'people.manage') check(wide(u), 'Administrative scope required');
        }
        if (custom && policy.bridge.length)
          u.permissions = JSON.stringify([...new Set([...json(u.permissions), ...policy.bridge])]);
        return false;
      }
      const managed = /^\/api\/school\/(structure|people|assignments|quotes)(?:\/|$)/.exec(path);
      if (managed && !(managed[1] === 'structure' && method === 'GET')) {
        const action = {
          GET: 'view',
          POST: 'create',
          PUT: 'edit',
          PATCH: 'edit',
          DELETE: 'delete',
        }[method];
        if (action) await require(u, managed[1] + '.' + action);
      }
      const teacherCampusRoute = /^\/api\/school\/teacher-campuses\/([\w-]+)$/.exec(path);
      if (teacherCampusRoute && method === 'PUT') {
        await require(u, 'assignments.manage');
        await require(u, 'assignments.edit');
        await managementAccess.teacher(u, teacherCampusRoute[1]);
        await managementAccess.campus(u, b.campus_id);
        check(wide(u) || supervisor(u), 'Staff management scope required', 403);
        return (
          reply(
            res,
            200,
            await teacherCampus.save(u, teacherCampusRoute[1], b.campus_id, b.expected_campus_id),
          ),
          true
        );
      }
      if (path === '/api/school/curriculum') await require(u, 'structure.edit');
      if (await push.route({ path, method, b, u, res, reply, check })) return true;
      if (path === '/api/school/push/test' && method === 'POST') {
        check(push.configured(), 'Push delivery is not configured', 503);
        check(
          await one('SELECT 1 FROM push_subscriptions WHERE user_id=?', u.id),
          'Enable notifications on a device first',
          400,
        );
        await notify(
          u.id,
          null,
          'Your test phone notification is ready.',
          'push-test:' + u.id + ':' + Math.floor(Date.now() / 900000),
        );
        return (reply(res, 200, { ok: true, delivery: await push.dispatch() }), true);
      }
      if (path === '/api/school/readiness' && method === 'GET') {
        await require(u, 'settings.manage');
        check(wide(u), 'Administrative scope required');
        return (reply(res, 200, await readiness(db)), true);
      }
      if (path === '/api/school/bootstrap' && method === 'GET')
        return (
          reply(res, 200, {
            capabilities: await capabilities(u),
            roleDefaults,
            capabilityNames,
            structure: u.role === 'parent' ? null : await structure(u),
          }),
          true
        );
      if (path === '/api/school/structure' && method === 'GET') {
        check(u.role !== 'parent', 'Staff account required');
        return (reply(res, 200, await structure(u)), true);
      }
      if (path === '/api/school/structure' && method === 'POST') {
        await require(u, 'structure.manage');
        if (b.kind === 'subject_assignments') {
          const input = validateSubjectAssignments(b);
          const create = async () => {
            for (let attempt = 0; ; attempt++) {
              try {
                return await transaction(async () => {
                  const catalog = {
                    nodes: (await all('SELECT * FROM school_nodes')).filter(
                      (x) => !hidden.has(x.id),
                    ),
                    academics: (await all('SELECT * FROM academics')).filter(
                      (x) => !hidden.has(x.id),
                    ),
                    classCampuses: (await all('SELECT * FROM class_campuses')).filter(
                      (x) => !hidden.has(x.class_id) && !hidden.has(x.campus_id),
                    ),
                  };
                  validateSubjectAssignments(input, catalog);
                  const subject_id = id();
                  await run(
                    "INSERT INTO academics VALUES(?,'subject',?,NULL,NULL,NULL,1)",
                    subject_id,
                    input.name,
                  );
                  await run(
                    'INSERT INTO subject_priorities VALUES(?,?)',
                    subject_id,
                    input.priority ?? 0,
                  );
                  const classes = new Set();
                  for (const section_id of input.section_ids) {
                    await run('INSERT INTO section_subjects VALUES(?,?)', section_id, subject_id);
                    classes.add(catalog.academics.find((x) => x.id === section_id).parent_id);
                  }
                  for (const class_id of classes)
                    await run('INSERT INTO class_subjects VALUES(?,?)', class_id, subject_id);
                  await audit(u, 'school_subject_assignments_created', subject_id, {
                    campus_id: input.campus_id,
                    section_ids: input.section_ids,
                    priority: input.priority ?? 0,
                  });
                  return { id: subject_id, section_ids: input.section_ids };
                });
              } catch (error) {
                if (attempt >= 2 || !['40001', '40P01'].includes(error.code)) throw error;
              }
            }
          };
          const pending = subjectTail.then(create);
          subjectTail = pending.catch(() => {});
          return (reply(res, 201, await pending), true);
        }
        if (b.kind === 'class_sections') {
          const input = validateClassSections(b);
          const create = async () => {
            for (let attempt = 0; ; attempt++) {
              try {
                return await transaction(async () => {
                  check(
                    await one(
                      "SELECT 1 FROM school_nodes WHERE id=? AND kind='campus' AND active=1",
                      input.parent_id,
                    ),
                    'Select an active parent Campus.',
                    400,
                  );
                  const matches = await all(
                    "SELECT a.* FROM academics a JOIN class_campuses c ON c.class_id=a.id WHERE a.kind='class' AND LOWER(TRIM(a.name))=LOWER(?) AND c.campus_id=? ORDER BY a.active DESC,a.id",
                    input.name,
                    input.parent_id,
                  );
                  for (const klass of matches)
                    for (const section of input.sections)
                      check(
                        !(await one(
                          "SELECT 1 FROM academics WHERE kind='section' AND parent_id=? AND LOWER(TRIM(name))=LOWER(?)",
                          klass.id,
                          section,
                        )),
                        duplicateClassSectionMessage,
                        409,
                      );
                  const existing = matches[0];
                  check(
                    !existing || existing.active,
                    'Activate the existing Class before adding Sections.',
                    409,
                  );
                  const class_id = existing?.id || id();
                  if (!existing) {
                    await run(
                      "INSERT INTO academics VALUES(?,'class',?,NULL,NULL,NULL,1)",
                      class_id,
                      input.name,
                    );
                    await run('INSERT INTO class_campuses VALUES(?,?)', class_id, input.parent_id);
                  }
                  const sections = [];
                  for (const name of input.sections) {
                    const section_id = id();
                    await run(
                      "INSERT INTO academics VALUES(?,'section',?,?,NULL,NULL,1)",
                      section_id,
                      name,
                      class_id,
                    );
                    sections.push({ id: section_id, name });
                  }
                  await audit(u, 'school_class_sections_created', class_id, {
                    campus_id: input.parent_id,
                    class_id,
                    class_created: !existing,
                    section_ids: sections.map((x) => x.id),
                  });
                  return { id: class_id, class_created: !existing, sections };
                });
              } catch (error) {
                if (attempt >= 2 || !['40001', '40P01'].includes(error.code)) throw error;
              }
            }
          };
          const pending = classSectionsTail.then(create);
          classSectionsTail = pending.catch(() => {});
          return (reply(res, 201, await pending), true);
        }
        const kind = b.kind,
          name = text(b.name, 1, 100, 'name'),
          uid = id();
        if (['campus', 'class', 'section'].includes(kind))
          check(typeof b.parent_id === 'string' && b.parent_id, 'Choose a parent school unit', 400);
        await transaction(async () => {
          if (['branch', 'campus'].includes(kind)) {
            const parent = kind === 'campus' ? b.parent_id : null;
            if (kind === 'campus')
              check(
                await one(
                  "SELECT 1 FROM school_nodes WHERE id=? AND kind='branch' AND active=1",
                  parent,
                ),
                'Select an active branch',
                400,
              );
            check(
              !(await one(
                "SELECT 1 FROM school_nodes WHERE kind=? AND LOWER(name)=LOWER(?) AND COALESCE(parent_id,'')=COALESCE(?,'')",
                kind,
                name,
                parent,
              )),
              'This school unit already exists',
              409,
            );
            await run('INSERT INTO school_nodes VALUES(?,?,?,?,1)', uid, kind, name, parent);
          } else {
            check(
              ['class', 'section', 'subject', 'session'].includes(kind),
              'Invalid school structure type',
              400,
            );
            let parent = null;
            if (kind === 'class')
              check(
                await one(
                  "SELECT 1 FROM school_nodes WHERE id=? AND kind='campus' AND active=1",
                  b.parent_id,
                ),
                'Select an active campus',
                400,
              );
            if (kind === 'section') {
              parent = b.parent_id;
              check(
                await one(
                  "SELECT 1 FROM academics WHERE id=? AND kind='class' AND active=1",
                  parent,
                ),
                'Select an active class',
                400,
              );
              check(
                await one('SELECT 1 FROM class_campuses WHERE class_id=?', parent),
                'Link this class to a campus first',
                400,
              );
            }
            if (kind === 'session')
              check(
                validDate(b.start_date) && validDate(b.end_date) && b.start_date <= b.end_date,
                'Valid session dates required',
                400,
              );
            const duplicate =
              kind === 'class'
                ? await one(
                    "SELECT 1 FROM academics a JOIN class_campuses c ON c.class_id=a.id WHERE a.kind='class' AND LOWER(a.name)=LOWER(?) AND c.campus_id=?",
                    name,
                    b.parent_id,
                  )
                : await one(
                    "SELECT 1 FROM academics WHERE kind=? AND LOWER(name)=LOWER(?) AND COALESCE(parent_id,'')=COALESCE(?,'')",
                    kind,
                    name,
                    parent,
                  );
            check(!duplicate, 'This academic record already exists', 409);
            await run(
              'INSERT INTO academics VALUES(?,?,?,?,?,?,1)',
              uid,
              kind,
              name,
              parent,
              kind === 'session' ? b.start_date : null,
              kind === 'session' ? b.end_date : null,
            );
            if (kind === 'class')
              await run('INSERT INTO class_campuses VALUES(?,?)', uid, b.parent_id);
          }
          if (kind === 'subject' && b.priority !== undefined)
            await run(
              'INSERT INTO subject_priorities VALUES(?,?)',
              uid,
              subjectPriority(b.priority),
            );
          await audit(u, 'school_structure_created', uid, {
            kind,
            name,
            parent_id: b.parent_id || null,
          });
        });
        return (reply(res, 201, { id: uid }), true);
      }
      const node = /^\/api\/school\/structure\/([\w-]+)$/.exec(path);
      if (node && method === 'DELETE') {
        await require(u, 'structure.manage');
        await transaction(async () => {
          const school = await one('SELECT * FROM school_nodes WHERE id=?', node[1]);
          if (school) {
            check(
              !(await one('SELECT 1 FROM school_nodes WHERE parent_id=?', school.id)) &&
                !(await one('SELECT 1 FROM class_campuses WHERE campus_id=?', school.id)),
              'School unit is in use; archive it instead',
              409,
            );
            await run('DELETE FROM school_nodes WHERE id=?', school.id);
          } else {
            const a = await one('SELECT * FROM academics WHERE id=?', node[1]);
            check(a, 'School record not found', 404);
            check(
              !(await one('SELECT 1 FROM academics WHERE parent_id=?', a.id)) &&
                !(await one(
                  'SELECT 1 FROM assignments WHERE section_id=? OR subject_id=? OR session_id=?',
                  a.id,
                  a.id,
                  a.id,
                )) &&
                !(await one(
                  'SELECT 1 FROM section_subjects WHERE section_id=? OR subject_id=?',
                  a.id,
                  a.id,
                )) &&
                !(await one('SELECT 1 FROM parent_sections WHERE section_id=?', a.id)) &&
                !(await one('SELECT 1 FROM school_diaries WHERE section_id=?', a.id)),
              'Academic record has responsibilities or history; archive it instead',
              409,
            );
            check(
              settings().assignmentSessionId !== a.id,
              'Select another current session first',
              409,
            );
            await run('DELETE FROM class_campuses WHERE class_id=?', a.id);
            await run('DELETE FROM class_subjects WHERE class_id=? OR subject_id=?', a.id, a.id);
            await run('DELETE FROM academics WHERE id=?', a.id);
          }
          await audit(u, 'unused_school_record_deleted', node[1]);
        });
        return (reply(res, 200, { ok: true }), true);
      }
      if (node && method === 'PATCH') {
        await require(u, 'structure.manage');
        await transaction(async () => {
          let item = await one('SELECT * FROM school_nodes WHERE id=?', node[1]),
            table = 'school_nodes';
          if (!item) {
            item = await one('SELECT * FROM academics WHERE id=?', node[1]);
            table = 'academics';
          }
          check(item, 'School record not found', 404);
          let subjectEdit,
            previousSections,
            previousClassOnlyIds,
            removedClassOnlyIds = [];
          if (b.class_only_ids !== undefined)
            check(
              item.kind === 'subject' && b.section_ids !== undefined,
              'Class assignments must be edited with the subject section selections',
              400,
            );
          if (item.kind === 'subject' && b.section_ids !== undefined) {
            const catalog = {
              nodes: (await all('SELECT * FROM school_nodes')).filter((x) => !hidden.has(x.id)),
              academics: (await all('SELECT * FROM academics')).filter((x) => !hidden.has(x.id)),
              classCampuses: (await all('SELECT * FROM class_campuses')).filter(
                (x) => !hidden.has(x.class_id) && !hidden.has(x.campus_id),
              ),
              sectionSubjects: (await all('SELECT * FROM section_subjects')).filter(
                (x) => !hidden.has(x.section_id) && !hidden.has(x.subject_id),
              ),
            };
            previousSections = catalog.sectionSubjects
              .filter((x) => x.subject_id === item.id)
              .map((x) => x.section_id);
            if (b.expected_section_ids !== undefined) {
              check(
                Array.isArray(b.expected_section_ids) &&
                  JSON.stringify([...b.expected_section_ids].sort()) ===
                    JSON.stringify([...previousSections].sort()),
                'Subject assignments changed. Reload before saving.',
                409,
              );
            }
            const savedPriority =
              (await one('SELECT priority FROM subject_priorities WHERE subject_id=?', item.id))
                ?.priority ?? 0;
            subjectEdit = validateSubjectAssignments(
              { ...b, name: b.name ?? item.name, priority: b.priority ?? savedPriority },
              catalog,
              { subjectId: item.id, editing: true },
            );
            const sectionClasses = new Set(
              catalog.academics
                .filter((x) => previousSections.includes(x.id))
                .map((x) => x.parent_id),
            );
            previousClassOnlyIds = (
              await all('SELECT class_id FROM class_subjects WHERE subject_id=?', item.id)
            )
              .map((x) => x.class_id)
              .filter((cid) => !hidden.has(cid) && !sectionClasses.has(cid));
            if (b.class_only_ids !== undefined) {
              check(
                Array.isArray(b.class_only_ids) &&
                  b.class_only_ids.length <= 1000 &&
                  new Set(b.class_only_ids).size === b.class_only_ids.length &&
                  b.class_only_ids.every((cid) => previousClassOnlyIds.includes(cid)),
                'Choose existing class-only assignments. Use section selections to add new class assignments.',
                400,
              );
              if (b.expected_class_only_ids !== undefined)
                check(
                  Array.isArray(b.expected_class_only_ids) &&
                    JSON.stringify([...b.expected_class_only_ids].sort()) ===
                      JSON.stringify([...previousClassOnlyIds].sort()),
                  'Subject class assignments changed. Reload before saving.',
                  409,
                );
              removedClassOnlyIds = previousClassOnlyIds.filter(
                (cid) => !b.class_only_ids.includes(cid),
              );
              for (const cid of removedClassOnlyIds) {
                check(
                  !(await one(
                    'SELECT 1 FROM assignments a JOIN academics s ON s.id=a.section_id WHERE a.subject_id=? AND s.parent_id=?',
                    item.id,
                    cid,
                  )),
                  'This class-only assignment has teaching responsibilities or history. Keep it to preserve saved work.',
                  409,
                );
                for (const diary of await all(
                  'SELECT d.content FROM school_diaries d JOIN academics s ON s.id=d.section_id WHERE s.parent_id=?',
                  cid,
                ))
                  check(
                    !json(diary.content).homework_rows?.some((row) => row.subject_id === item.id),
                    'This class-only assignment has diary history. Keep it to preserve saved work.',
                    409,
                  );
              }
            }
            const removed = previousSections.filter(
              (sid) => !subjectEdit.section_ids.includes(sid),
            );
            for (const sid of removed)
              check(
                !(await one(
                  'SELECT 1 FROM assignments WHERE subject_id=? AND section_id=?',
                  item.id,
                  sid,
                )),
                'This subject has teaching responsibilities or history in a selected section. Keep that assignment; archive the subject when appropriate.',
                409,
              );
            if (removed.length)
              for (const diary of await all('SELECT section_id,content FROM school_diaries'))
                if (removed.includes(diary.section_id))
                  check(
                    !json(diary.content).homework_rows?.some((row) => row.subject_id === item.id),
                    'This subject has diary history in a selected section. Keep that assignment to preserve saved work.',
                    409,
                  );
          }
          const oldPriority =
            item.kind === 'subject'
              ? ((await one('SELECT priority FROM subject_priorities WHERE subject_id=?', item.id))
                  ?.priority ?? 0)
              : undefined;
          const priority =
            item.kind === 'subject'
              ? subjectPriority(b.priority === undefined ? oldPriority : b.priority)
              : undefined;
          if (b.priority !== undefined)
            check(item.kind === 'subject', 'Priority applies to subjects only', 400);
          const name = text(b.name ?? item.name, 1, 100, 'name');
          check(
            b.active === undefined || typeof b.active === 'boolean',
            'Active must be true or false',
            400,
          );
          const active = b.active === undefined ? item.active : Number(b.active),
            oldParent =
              item.kind === 'class'
                ? (await one('SELECT campus_id FROM class_campuses WHERE class_id=?', item.id))
                    ?.campus_id
                : item.parent_id,
            parent = b.parent_id ?? oldParent ?? null;
          if (['campus', 'class', 'section'].includes(item.kind)) {
            check(typeof parent === 'string' && parent, 'Choose a parent school unit', 400);
            const pt = item.kind === 'section' ? 'academics' : 'school_nodes',
              pk = { campus: 'branch', class: 'campus', section: 'class' }[item.kind];
            check(
              await one(`SELECT 1 FROM ${pt} WHERE id=? AND kind=? AND active=1`, parent, pk),
              'Choose an active parent ' + pk,
              400,
            );
          }
          if (
            parent !== oldParent &&
            oldParent &&
            ['campus', 'class', 'section'].includes(item.kind)
          ) {
            const affected =
              item.kind === 'section'
                ? [item.id]
                : item.kind === 'class'
                  ? (
                      await all(
                        "SELECT id FROM academics WHERE parent_id=? AND kind='section'",
                        item.id,
                      )
                    ).map((x) => x.id)
                  : (
                      await all(
                        "SELECT s.id FROM academics s JOIN class_campuses c ON c.class_id=s.parent_id WHERE c.campus_id=? AND s.kind='section'",
                        item.id,
                      )
                    ).map((x) => x.id);
            for (const sid of affected)
              check(
                !(await one('SELECT 1 FROM assignments WHERE section_id=?', sid)) &&
                  !(await one('SELECT 1 FROM school_diaries WHERE section_id=?', sid)) &&
                  !(await one('SELECT 1 FROM parent_sections WHERE section_id=?', sid)),
                'School unit has responsibilities or history; archive it and create its replacement',
                409,
              );
          }
          if (!active) {
            if (table === 'school_nodes')
              check(
                !(await one(
                  'SELECT 1 FROM school_nodes WHERE parent_id=? AND active=1',
                  item.id,
                )) &&
                  !(await one(
                    'SELECT 1 FROM class_campuses cc JOIN academics c ON c.id=cc.class_id WHERE cc.campus_id=? AND c.active=1',
                    item.id,
                  )),
                'Archive child campuses/classes first',
                409,
              );
            else
              check(
                !(await one('SELECT 1 FROM academics WHERE parent_id=? AND active=1', item.id)) &&
                  !(await one(
                    'SELECT 1 FROM assignments WHERE active=1 AND (section_id=? OR subject_id=? OR session_id=?)',
                    item.id,
                    item.id,
                    item.id,
                  )),
                'Archive child records and teaching assignments first',
                409,
              );
          }
          const duplicate =
            item.kind === 'class'
              ? await one(
                  "SELECT 1 FROM academics a JOIN class_campuses c ON c.class_id=a.id WHERE a.kind='class' AND LOWER(a.name)=LOWER(?) AND c.campus_id=? AND a.id<>?",
                  name,
                  parent,
                  item.id,
                )
              : await one(
                  `SELECT 1 FROM ${table} WHERE kind=? AND LOWER(name)=LOWER(?) AND COALESCE(parent_id,'')=COALESCE(?,'') AND id<>?`,
                  item.kind,
                  name,
                  parent,
                  item.id,
                );
          check(!duplicate, 'A record with this name already exists', 409);
          if (item.kind === 'session') {
            const start = b.start_date ?? item.start_date,
              end = b.end_date ?? item.end_date;
            check(
              validDate(start) && validDate(end) && start <= end,
              'Valid session dates required',
              400,
            );
            if (start !== item.start_date || end !== item.end_date)
              check(
                !(await one('SELECT 1 FROM assignments WHERE session_id=?', item.id)),
                'Session has assignments; create a new session instead of rewriting its dates',
                409,
              );
            await run(
              'UPDATE academics SET start_date=?,end_date=? WHERE id=?',
              start,
              end,
              item.id,
            );
          }
          await run(
            `UPDATE ${table} SET name=?,active=?,parent_id=? WHERE id=?`,
            name,
            active,
            item.kind === 'class' ? null : parent,
            item.id,
          );
          if (item.kind === 'class') {
            await run('DELETE FROM class_campuses WHERE class_id=?', item.id);
            await run('INSERT INTO class_campuses VALUES(?,?)', item.id, parent);
          }
          if (item.kind === 'subject' && b.priority !== undefined)
            await run(
              'INSERT INTO subject_priorities(subject_id,priority) VALUES(?,?) ON CONFLICT(subject_id) DO UPDATE SET priority=excluded.priority',
              item.id,
              priority,
            );
          if (subjectEdit) {
            const current = new Set(previousSections),
              desired = new Set(subjectEdit.section_ids),
              affectedClasses = new Set(removedClassOnlyIds);
            for (const sid of previousSections)
              if (!desired.has(sid)) {
                await run(
                  'DELETE FROM section_subjects WHERE subject_id=? AND section_id=?',
                  item.id,
                  sid,
                );
                affectedClasses.add(
                  (await one('SELECT parent_id FROM academics WHERE id=?', sid)).parent_id,
                );
              }
            for (const sid of subjectEdit.section_ids) {
              if (!current.has(sid))
                await run('INSERT INTO section_subjects VALUES(?,?)', sid, item.id);
              const section = await one('SELECT parent_id FROM academics WHERE id=?', sid);
              await run(
                'INSERT OR IGNORE INTO class_subjects VALUES(?,?)',
                section.parent_id,
                item.id,
              );
            }
            // Preserve independent legacy class-only relationships; reconcile classes whose sections changed.
            for (const cid of affectedClasses)
              if (
                !(await one(
                  'SELECT 1 FROM section_subjects ss JOIN academics s ON s.id=ss.section_id WHERE ss.subject_id=? AND s.parent_id=?',
                  item.id,
                  cid,
                )) &&
                !(await one(
                  'SELECT 1 FROM assignments a JOIN academics s ON s.id=a.section_id WHERE a.subject_id=? AND s.parent_id=?',
                  item.id,
                  cid,
                ))
              )
                await run(
                  'DELETE FROM class_subjects WHERE class_id=? AND subject_id=?',
                  cid,
                  item.id,
                );
          }
          await audit(u, 'school_structure_updated', item.id, {
            before: {
              name: item.name,
              active: item.active,
              parent_id: oldParent,
              ...(item.kind === 'subject'
                ? {
                    priority: oldPriority,
                    ...(subjectEdit
                      ? { section_ids: previousSections, class_only_ids: previousClassOnlyIds }
                      : {}),
                  }
                : {}),
            },
            after: {
              name,
              active,
              parent_id: parent,
              ...(item.kind === 'subject'
                ? {
                    priority,
                    ...(subjectEdit
                      ? {
                          section_ids: subjectEdit.section_ids,
                          class_only_ids: previousClassOnlyIds.filter(
                            (cid) => !removedClassOnlyIds.includes(cid),
                          ),
                        }
                      : {}),
                  }
                : {}),
            },
          });
        });
        return (reply(res, 200, { ok: true }), true);
      }
      if (path === '/api/school/curriculum' && method === 'PUT') {
        await require(u, 'structure.manage');
        await meta(b.section_id);
        check(
          Array.isArray(b.subject_ids) && b.subject_ids.length <= 80,
          'Choose up to 80 subjects',
          400,
        );
        const ids = [...new Set(b.subject_ids)];
        for (const sid of ids)
          check(
            await one("SELECT 1 FROM academics WHERE id=? AND kind='subject' AND active=1", sid),
            'Choose active master subjects',
            400,
          );
        await transaction(async () => {
          const used = await all(
            'SELECT subject_id FROM assignments WHERE section_id=? AND active=1',
            b.section_id,
          );
          check(
            used.every((x) => ids.includes(x.subject_id)),
            'Archive teaching assignments before removing their subject',
            409,
          );
          await run('DELETE FROM section_subjects WHERE section_id=?', b.section_id);
          const m = await meta(b.section_id);
          for (const sid of ids) {
            await run('INSERT INTO section_subjects VALUES(?,?)', b.section_id, sid);
            await run('INSERT OR IGNORE INTO class_subjects VALUES(?,?)', m.class_id, sid);
          }
          await audit(u, 'section_curriculum_updated', b.section_id, { subjects: ids });
        });
        return (reply(res, 200, { ok: true }), true);
      }
      if (path === '/api/school/assignments' && method === 'POST') {
        await require(u, 'assignments.manage');
        await managementAccess.teacher(u, b.teacher_id);
        await activeUser(b.teacher_id, 'teacher');
        const reviewer = await one(
          'SELECT head_id FROM teacher_reviewers WHERE teacher_id=?',
          b.teacher_id,
        );
        check(reviewer, 'Configure the teacher’s Head Teacher first', 400);
        await activeUser(reviewer.head_id, 'head_teacher');
        check(b.teacher_id !== reviewer.head_id, 'Choose a separate reviewer', 400);
        const today = dateInZone(),
          sessions = await all(
            "SELECT * FROM academics WHERE kind='session' AND active=1 AND start_date<=? AND end_date>=? ORDER BY start_date DESC",
            today,
            today,
          ),
          ses = b.session_id
            ? sessions.find((x) => x.id === b.session_id)
            : sessions.find((x) => x.id === settings().assignmentSessionId) || sessions[0];
        check(ses, 'Select an active session covering today', 400);
        check(
          Array.isArray(b.pairs) && b.pairs.length && b.pairs.length <= 100,
          'Choose 1–100 section/subject assignments',
          400,
        );
        check(
          Array.isArray(b.weekdays) &&
            b.weekdays.length &&
            b.weekdays.every((x) => Number.isInteger(x) && x >= 0 && x <= 6),
          'Choose valid weekdays',
          400,
        );
        check(
          domain.validTime(b.due_time) && domain.validTime(b.review_time),
          'Valid deadline times required',
          400,
        );
        const created = [];
        await transaction(async () => {
          for (const p of b.pairs) {
            check(
              p &&
                typeof p === 'object' &&
                !Array.isArray(p) &&
                typeof p.section_id === 'string' &&
                typeof p.subject_id === 'string',
              'Choose a valid section and subject',
              400,
            );
            await teacherCampus.assertAssignment(b.teacher_id, p.section_id);
            check((await meta(p.section_id)).active, 'Choose active sections', 400);
            check(
              await one(
                'SELECT 1 FROM section_subjects WHERE section_id=? AND subject_id=?',
                p.section_id,
                p.subject_id,
              ),
              'Subject is not configured for this section',
              400,
            );
            check(
              await one(
                "SELECT 1 FROM academics WHERE id=? AND kind='subject' AND active=1",
                p.subject_id,
              ),
              'Active subject required',
              400,
            );
            if (
              await one(
                'SELECT 1 FROM assignments WHERE teacher_id=? AND section_id=? AND subject_id=? AND session_id=? AND active=1',
                b.teacher_id,
                p.section_id,
                p.subject_id,
                ses.id,
              )
            )
              continue;
            const aid = id();
            await run(
              'INSERT INTO assignments VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1)',
              aid,
              b.teacher_id,
              reviewer.head_id,
              p.section_id,
              p.subject_id,
              ses.id,
              today,
              ses.end_date,
              JSON.stringify([...new Set(b.weekdays)]),
              '[1]',
              b.due_time,
              b.review_time,
            );
            created.push(aid);
            await audit(u, 'class_subject_assignment_created', aid);
          }
        });
        return (reply(res, 201, { created }), true);
      }
      const assign = /^\/api\/school\/assignments\/([\w-]+)$/.exec(path);
      if (assign && method === 'DELETE') {
        await require(u, 'assignments.manage');
        await transaction(async () => {
          const a = await one('SELECT * FROM assignments WHERE id=?', assign[1]);
          check(a, 'Assignment not found', 404);
          await managementAccess.teacher(u, a.teacher_id);
          check(
            !(await one('SELECT 1 FROM diaries WHERE assignment_id=?', a.id)) &&
              !(await one(
                'SELECT 1 FROM school_diaries WHERE teacher_id=? AND section_id=?',
                a.teacher_id,
                a.section_id,
              )),
            'Assignment has diary history; archive it instead',
            409,
          );
          await run('DELETE FROM calendar_exceptions WHERE assignment_id=?', a.id);
          await run('DELETE FROM assignment_state_events WHERE assignment_id=?', a.id);
          await run('DELETE FROM assignments WHERE id=?', a.id);
          await audit(u, 'unused_assignment_deleted', a.id);
        });
        return (reply(res, 200, { ok: true }), true);
      }
      if (assign && method === 'PUT') {
        await require(u, 'assignments.manage');
        check(
          Array.isArray(b.weekdays) &&
            b.weekdays.length &&
            b.weekdays.every((x) => Number.isInteger(x) && x >= 0 && x <= 6) &&
            domain.validTime(b.due_time) &&
            domain.validTime(b.review_time),
          'Valid weekdays and deadlines required',
          400,
        );
        await transaction(async () => {
          const a = await one('SELECT * FROM assignments WHERE id=?', assign[1]);
          check(a, 'Assignment not found', 404);
          await managementAccess.teacher(u, a.teacher_id);
          check(
            !(await one('SELECT 1 FROM diaries WHERE assignment_id=?', a.id)) &&
              !(await one(
                'SELECT 1 FROM school_diaries WHERE teacher_id=? AND section_id=?',
                a.teacher_id,
                a.section_id,
              )),
            'Assignment has diary history; archive and replace it',
            409,
          );
          const teacher = b.teacher_id ?? a.teacher_id,
            section = b.section_id ?? a.section_id,
            subject = b.subject_id ?? a.subject_id;
          await managementAccess.teacher(u, teacher);
          await activeUser(teacher, 'teacher');
          await teacherCampus.assertAssignment(teacher, section);
          check((await meta(section)).active, 'Choose an active section', 400);
          check(
            await one(
              'SELECT 1 FROM section_subjects WHERE section_id=? AND subject_id=?',
              section,
              subject,
            ),
            'Choose a subject configured for this section',
            400,
          );
          const head = await one(
            'SELECT head_id FROM teacher_reviewers WHERE teacher_id=?',
            teacher,
          );
          check(head, 'Configure the teacher’s Head Teacher first', 400);
          await activeUser(head.head_id, 'head_teacher');
          check(
            !(await one(
              'SELECT 1 FROM assignments WHERE teacher_id=? AND section_id=? AND subject_id=? AND session_id=? AND active=1 AND id<>?',
              teacher,
              section,
              subject,
              a.session_id,
              a.id,
            )),
            'This active teaching assignment already exists',
            409,
          );
          await run(
            'UPDATE assignments SET teacher_id=?,head_id=?,section_id=?,subject_id=?,weekdays=?,due_time=?,review_time=? WHERE id=?',
            teacher,
            head.head_id,
            section,
            subject,
            JSON.stringify([...new Set(b.weekdays)]),
            b.due_time,
            b.review_time,
            a.id,
          );
          await audit(u, 'assignment_schedule_updated', a.id);
        });
        return (reply(res, 200, { ok: true }), true);
      }
      if (assign && method === 'PATCH') {
        await require(u, 'assignments.manage');
        check(typeof b.active === 'boolean', 'Active must be true or false', 400);
        await transaction(async () => {
          const a = await one('SELECT * FROM assignments WHERE id=?', assign[1]);
          check(a, 'Assignment not found', 404);
          await managementAccess.teacher(u, a.teacher_id);
          if (b.active) {
            await teacherCampus.assertAssignment(a.teacher_id, a.section_id);
            await activeUser(a.teacher_id);
            await activeUser(a.head_id, 'head_teacher');
            for (const sid of [a.subject_id, a.session_id])
              check(
                await one('SELECT 1 FROM academics WHERE id=? AND active=1', sid),
                'Activate the subject and academic session first',
                409,
              );
            check((await meta(a.section_id)).active, 'Class or school unit is archived', 409);
            check(
              await one(
                'SELECT 1 FROM section_subjects WHERE section_id=? AND subject_id=?',
                a.section_id,
                a.subject_id,
              ),
              'Configure the section subject first',
              409,
            );
          }
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
      if (path === '/api/school/people' && method === 'GET') {
        await require(u, 'people.manage');
        return (reply(res, 200, await peopleDirectory(u)), true);
      }
      if (path === '/api/school/people' && method === 'POST') {
        await require(u, 'people.manage');
        const name = text(b.name, 2, 120, 'name'),
          email = text(b.email, 3, 254, 'email').toLowerCase();
        check(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'Valid email required', 400);
        check(Object.hasOwn(roleDefaults, b.role), 'Invalid role', 400);
        check(
          u.role === 'super_admin' || !['super_admin', 'school_admin'].includes(b.role),
          'Only Super Admin can create administrative accounts',
        );
        check(
          passwordAcceptable(b.password),
      PASSWORD_MESSAGE,
          400,
        );
        check(
          !(await one('SELECT 1 FROM users WHERE email=?', email)),
          'Email already in use',
          409,
        );
        const placement = await placementInput(u, b);
        const created = await transaction(async () => {
          const created = await createUser({
            name,
            email,
            password: b.password,
            role: b.role,
            permissions: [],
          });
          await security.issueTemporary(created.id, b.password);
          await audit(u, 'user_created', created.id, { role: b.role });
          await hierarchy.place(u, created.id, placement);
          return created;
        });
        return (reply(res, 201, publicUser(created)), true);
      }
      const person = /^\/api\/school\/people\/([\w-]+)$/.exec(path);
      if (person && method === 'PATCH') {
        await require(u, 'people.manage');
        const placement = await placementInput(u, b, true);
        await transaction(async () => {
          const old = await one('SELECT * FROM users WHERE id=?', person[1]);
          check(old, 'Account not found', 404);
          check(
            u.role === 'super_admin' || !['super_admin', 'school_admin'].includes(old.role),
            'Super Admin required',
          );
          const name = text(b.name ?? old.name, 2, 120, 'name'),
            email = text(b.email ?? old.email, 3, 254, 'email').toLowerCase(),
            role = b.role ?? old.role;
          check(Object.hasOwn(roleDefaults, role), 'Invalid role', 400);
          check(
            u.role === 'super_admin' || role === old.role,
            'Super Admin required to change roles',
          );
          check(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'Invalid email', 400);
          check(
            !(await one('SELECT 1 FROM users WHERE email=? AND id<>?', email, old.id)),
            'Email already in use',
            409,
          );
          check(
            b.active === undefined || typeof b.active === 'boolean',
            'Invalid active flag',
            400,
          );
          check(
            old.id !== u.id || b.active !== false,
            'Cannot deactivate your current account',
            409,
          );
          if (old.role === 'super_admin' && (role !== 'super_admin' || b.active === false))
            check(
              Number(
                (await one("SELECT COUNT(*) n FROM users WHERE role='super_admin' AND active=1")).n,
              ) > 1,
              'Keep an active Super Admin',
              409,
            );
          if (b.active === false || role !== old.role) {
            check(
              !(await one(
                "SELECT 1 FROM school_diaries WHERE head_id=? AND status<>'approved'",
                old.id,
              )),
              'Resolve outstanding reviews before changing this reviewer',
              409,
            );
            if (old.role === 'head_teacher')
              check(
                !(await one('SELECT 1 FROM assignments WHERE head_id=? AND active=1', old.id)),
                'Replace or archive Head Teacher assignments first',
                409,
              );
            if (role !== old.role)
              check(
                !(await one(
                  'SELECT 1 FROM teacher_reviewers WHERE teacher_id=? OR head_id=?',
                  old.id,
                  old.id,
                )),
                'Remove hierarchy links before changing role',
                409,
              );
            if (role !== old.role)
              check(
                !(await one('SELECT 1 FROM assignments WHERE teacher_id=? AND active=1', old.id)) &&
                  !(await one(
                    'SELECT 1 FROM coordinator_heads WHERE coordinator_id=? OR head_id=?',
                    old.id,
                    old.id,
                  )) &&
                  !(await one(
                    'SELECT 1 FROM parent_sections WHERE parent_id=? AND active=1',
                    old.id,
                  )),
                'Remove active responsibilities before changing role',
                409,
              );
          }
          if (b.password !== undefined) {
            check(
              passwordAcceptable(b.password),
      PASSWORD_MESSAGE,
              400,
            );
            await run(
              'UPDATE users SET password=? WHERE id=?',
              await db.passwordHashAsync(b.password),
              old.id,
            );
            await security.issueTemporary(old.id, b.password);
          }
          if (b.active === false)
            for (const a of await all(
              'SELECT id FROM assignments WHERE teacher_id=? AND active=1',
              old.id,
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
            }
          if (role !== old.role) await run('DELETE FROM user_capabilities WHERE user_id=?', old.id);
          await run(
            'UPDATE users SET name=?,email=?,role=?,permissions=?,active=?,updated_at=? WHERE id=?',
            name,
            email,
            role,
            role === old.role ? old.permissions : '[]',
            b.active === undefined ? old.active : Number(b.active),
            now(),
            old.id,
          );
          if (placement || role !== old.role) await hierarchy.place(u, old.id, placement || {});
          if (
            b.password !== undefined ||
            role !== old.role ||
            (b.active !== undefined && Number(b.active) !== old.active) ||
            email !== old.email
          )
            await run('DELETE FROM sessions WHERE user_id=?', old.id);
          await audit(u, 'user_updated', old.id, { name, email, role, active: b.active });
        });
        return (reply(res, 200, { ok: true }), true);
      }
      if (path === '/api/school/hierarchy' && method === 'GET')
        return (reply(res, 200, await hierarchy.read(u)), true);
      if (['/api/school/hierarchy', '/api/school/reviewers'].includes(path) && method === 'PUT') {
        const coordinator = path.endsWith('/hierarchy');
        return (
          reply(
            res,
            200,
            await hierarchy.mutate(u, coordinator ? 'coordinator' : 'reviewer', {
              ...b,
              parent_id: coordinator ? b.coordinator_id : b.head_id,
              child_ids: coordinator ? b.head_ids : b.teacher_ids,
            }),
          ),
          true
        );
      }
      const relationship = /^\/api\/school\/hierarchy\/(coordinator|reviewer)\/([\w-]+)$/.exec(
        path,
      );
      if (relationship && ['PATCH', 'DELETE'].includes(method))
        return (
          reply(
            res,
            200,
            await hierarchy.mutate(
              u,
              relationship[1],
              { ...b, child_id: relationship[2] },
              method === 'DELETE' ? 'remove' : 'move',
            ),
          ),
          true
        );

      if (path === '/api/school/parents' && method === 'GET') {
        await require(u, 'parents.manage');
        return (reply(res, 200, await parentLinks(u)), true);
      }
      if (path === '/api/school/parents' && method === 'PUT') {
        await require(u, 'parents.manage');
        await activeUser(b.parent_id, 'parent');
        check(
          wide(u) || (await parentCandidates(u)).some((parent) => parent.id === b.parent_id),
          'An administrator must establish this family’s initial class links.',
          403,
        );
        check(
          Array.isArray(b.links) && b.links.length <= 20,
          'Choose up to 20 child/class links',
          400,
        );
        for (const l of b.links) {
          await managementAccess.section(u, l.section_id);
          check((await meta(l.section_id)).active, 'Choose active sections', 400);
          text(l.child_name || '', 0, 120, 'child name');
        }
        check(
          new Set(b.links.map((l) => l.section_id)).size === b.links.length,
          'Duplicate section link',
          400,
        );
        await transaction(async () => {
          const visible = new Set(
            (await parentLinks(u))
              .filter((link) => link.parent_id === b.parent_id)
              .map((link) => link.section_id),
          );
          if (wide(u)) await run('DELETE FROM parent_sections WHERE parent_id=?', b.parent_id);
          else
            for (const sid of visible)
              await run(
                'DELETE FROM parent_sections WHERE parent_id=? AND section_id=?',
                b.parent_id,
                sid,
              );
          for (const l of b.links)
            await run(
              'INSERT INTO parent_sections VALUES(?,?,?,1)',
              b.parent_id,
              l.section_id,
              (l.child_name || '').trim(),
            );
          await audit(u, 'parent_access_updated', b.parent_id, {
            sections: b.links.map((l) => l.section_id),
          });
        });
        return (reply(res, 200, { ok: true }), true);
      }
      if (path === '/api/school/permissions' && method === 'GET') {
        await require(u, 'permissions.manage');
        return (
          reply(res, 200, {
            capabilityNames,
            roleRestrictions,
            defaults: roleDefaults,
            roles: await all('SELECT * FROM role_capabilities'),
            users: await all('SELECT * FROM user_capabilities'),
          }),
          true
        );
      }
      if (path === '/api/school/permissions' && method === 'PUT') {
        await require(u, 'permissions.manage');
        if (u.role !== 'super_admin') {
          const own = await capabilities(u),
            grants = b.user_id ? [...(b.allows || []), ...(b.denies || [])] : b.grants;
          check(
            Array.isArray(grants) && grants.every((x) => own.includes(x)),
            'Cannot delegate capabilities outside your own permissions',
          );
          const target = b.user_id
            ? await one('SELECT role FROM users WHERE id=?', b.user_id)
            : null;
          check(
            !['super_admin', 'school_admin'].includes(target?.role || b.role),
            'Only Super Admin can change administrative permission policies',
          );
        }
        const valid = (xs) =>
          Array.isArray(xs) &&
          xs.length <= capabilityNames.length &&
          xs.every((x) => capabilityNames.includes(x));
        await transaction(async () => {
          if (b.user_id) {
            const target = await one('SELECT * FROM users WHERE id=?', b.user_id);
            check(
              target && target.role !== 'super_admin',
              'Super Admin capabilities cannot be restricted',
              400,
            );
            check(valid(b.allows) && valid(b.denies), 'Invalid capabilities', 400);
            check(
              !b.allows.some((x) => b.denies.includes(x)),
              'A capability cannot be both allowed and denied',
              400,
            );
            await run('DELETE FROM user_capabilities WHERE user_id=?', b.user_id);
            await run(
              'INSERT INTO user_capabilities VALUES(?,?,?)',
              b.user_id,
              JSON.stringify(b.allows),
              JSON.stringify(b.denies),
            );
            await audit(u, 'user_capabilities_updated', b.user_id, {
              allows: b.allows,
              denies: b.denies,
            });
          } else {
            check(
              Object.hasOwn(roleDefaults, b.role) && b.role !== 'super_admin',
              'Choose a non-Super Admin role',
              400,
            );
            check(valid(b.grants), 'Invalid capabilities', 400);
            await run('DELETE FROM role_capabilities WHERE role=?', b.role);
            await run(
              'INSERT INTO role_capabilities VALUES(?,?)',
              b.role,
              JSON.stringify(b.grants),
            );
            await audit(u, 'role_capabilities_updated', b.role, { grants: b.grants });
          }
        });
        return (reply(res, 200, { ok: true }), true);
      }
      if (path === '/api/school/class-diaries' && method === 'GET') {
        await require(u, 'diary.view');
        check(u.role !== 'parent', 'Use the approved family diary view');
        const result = await queries.consolidatedPage(u, q, approvedSql),
          priorities = await all('SELECT * FROM subject_priorities'),
          items = [];
        for (const key of result.keys) {
          const diary = consolidateClassDiary(
            await approvedEntries(u, { section: key.section_id, date: key.diary_date }, true),
            priorities,
          );
          if (diary) items.push(diary);
        }
        return (reply(res, 200, { total: result.total, page: result.page, items }), true);
      }
      if (path === '/api/school/class-diaries/detail' && method === 'GET')
        return (reply(res, 200, (await consolidated(u, q)).diary), true);
      if (path === '/api/school/class-diaries/preview' && method === 'GET') {
        const data = await consolidated(u, q);
        check(
          !q.format || ['pdf', 'png', 'jpg', 'print'].includes(q.format),
          'Invalid export format',
          400,
        );
        if (q.format) {
          await require(u, 'diary.export');
          await audit(u, 'consolidated_class_diary_exported', data.diary.id, {
            ids: data.diary.entry_ids,
            format: q.format,
          });
        }
        htmlResponse(
          res,
          documents.documentHtml(
            await sources(data.entries, false, true),
            q.format === 'print' ? undefined : q.format,
            (await capabilities(u)).includes('diary.export'),
            'elite-scholars-' +
              data.diary.snapshot.meta.class_name +
              '-' +
              data.diary.snapshot.meta.section_name +
              '-' +
              q.date,
          ),
        );
        return true;
      }
      if (path === '/api/school/class-diaries/export' && method === 'GET') {
        await require(u, 'diary.export');
        check(['pdf', 'png', 'jpg', 'print'].includes(q.format), 'Choose an export format', 400);
        const keys = [...new Set((q.ids || '').split(',').filter(Boolean))];
        check(keys.length > 0 && keys.length <= 30, 'Select 1–30 class diaries', 400);
        const list = [];
        for (const key of keys) {
          const parts = key.split('~');
          check(parts.length === 2, 'Invalid class diary reference', 400);
          const data = await consolidated(u, { section: parts[0], date: parts[1] });
          list.push(...(await sources(data.entries, false, true)));
        }
        await audit(u, 'consolidated_class_diaries_exported', null, {
          ids: keys,
          format: q.format,
        });
        htmlResponse(
          res,
          documents.documentHtml(
            list,
            q.format === 'print' ? undefined : q.format,
            true,
            'elite-scholars-class-diaries',
            { archive: q.format !== 'print' },
          ),
        );
        return true;
      }
      if (path === '/api/school/diaries/export' && method === 'GET') {
        await require(u, 'diary.export');
        check(['pdf', 'png', 'jpg', 'print'].includes(q.format), 'Choose an export format', 400);
        const ids = [...new Set((q.ids || '').split(',').filter(Boolean))];
        check(ids.length > 0 && ids.length <= 30, 'Select 1–30 diary records', 400);
        const sourcesList = [];
        for (const did of ids) {
          const d = await get(u, did);
          check(!d.content.deleted_at, 'Restore discarded drafts before exporting', 409);
          sourcesList.push(...(await sources([d])));
        }
        await audit(u, 'class_diaries_bulk_exported', null, { ids, format: q.format });
        htmlResponse(
          res,
          documents.documentHtml(
            sourcesList,
            q.format === 'print' ? undefined : q.format,
            true,
            'elite-scholars-class-diaries',
            { archive: q.format !== 'print' },
          ),
        );
        return true;
      }
      if (path === '/api/school/diaries/bulk' && method === 'POST') {
        const actionCaps = {
          approved: ['diary.approve'],
          returned: ['diary.return'],
          under_review: ['diary.review'],
          trash: ['diary.delete'],
          restore: ['diary.delete'],
          submit: ['diary.edit', 'diary.submit'],
          amend: ['diary.amend'],
        };
        check(Object.hasOwn(actionCaps, b.action), 'Choose a supported bulk diary action', 400);
        for (const cap of actionCaps[b.action]) await require(u, cap);
        await require(u, 'diary.view');
        check(u.role !== 'parent', 'Staff account required', 403);
        check(
          Array.isArray(b.items) && b.items.length > 0 && b.items.length <= 50,
          'Select 1–50 teacher diaries per request',
          400,
        );
        const seen = new Set();
        for (const item of b.items) {
          check(
            item &&
              typeof item === 'object' &&
              typeof item.id === 'string' &&
              /^[\w-]{1,100}$/.test(item.id) &&
              Number.isInteger(item.version) &&
              item.version > 0,
            'Each diary requires its current ID and version',
            400,
          );
          check(!seen.has(item.id), 'Select each diary only once', 400);
          seen.add(item.id);
        }
        if (b.action === 'returned') text(b.remarks, 1, 5000, 'return comments');
        if (b.action === 'amend') text(b.reason, 5, 5000, 'amendment reason');
        const results = [];
        for (const item of b.items) {
          try {
            const current = await operateDiary(
              u,
              item.id,
              { ...b, version: item.version },
              b.action,
            );
            results.push({
              id: item.id,
              ok: true,
              status: current.status,
              version: current.version,
            });
          } catch (error) {
            results.push({
              id: item.id,
              ok: false,
              status_code:
                error.status || (['40001', '40P01', '23505'].includes(error.code) ? 409 : 500),
              error: error.status
                ? error.message
                : ['40001', '40P01', '23505'].includes(error.code)
                  ? 'Diary changed concurrently. Reload before retrying.'
                  : 'This diary could not be updated. Reload before retrying.',
            });
          }
        }
        const succeeded = results.filter((r) => r.ok).length;
        await audit(u, 'class_diary_bulk_action', null, {
          action: b.action,
          ids: b.items.map((item) => item.id),
          succeeded,
          failed: results.length - succeeded,
        });
        return (
          reply(res, 200, {
            action: b.action,
            succeeded,
            failed: results.length - succeeded,
            results,
          }),
          true
        );
      }
      if (path === '/api/school/diaries' && method === 'POST')
        return (reply(res, 201, await save(u, b)), true);
      if (path === '/api/school/diaries' && method === 'GET') {
        await require(u, 'diary.view');
        check(u.role !== 'parent', 'Use the approved family diary view');
        const page = await queries.page(u, q, summaryColumns);
        return (
          reply(res, 200, { total: page.total, page: page.page, items: page.rows.map(parse) }),
          true
        );
      }
      const diary =
        /^\/api\/school\/diaries\/([\w-]+)(?:\/(review|amend|versions|preview|restore))?$/.exec(
          path,
        );
      if (diary) {
        const [, did, action] = diary,
          d = await get(u, did);
        check(u.role !== 'parent', 'Use the approved family diary view');
        if (!action && method === 'GET') return (reply(res, 200, d), true);
        if (!action && method === 'PUT') return (reply(res, 200, await save(u, b, did)), true);
        if ((!action && method === 'DELETE') || (action === 'restore' && method === 'POST')) {
          await operateDiary(u, did, b, action === 'restore' ? 'restore' : 'trash');
          return (reply(res, 200, { ok: true }), true);
        }
        if (action === 'versions' && method === 'GET')
          return (
            reply(
              res,
              200,
              (
                await all(
                  'SELECT v.*,a.name actor_name FROM school_diary_versions v JOIN users a ON a.id=v.actor_id WHERE diary_id=? ORDER BY version DESC',
                  did,
                )
              ).map((v) => ({ ...v, snapshot: json(v.snapshot) })),
            ),
            true
          );
        if (action === 'review' && method === 'POST') {
          check(
            ['approved', 'returned', 'under_review'].includes(b.action),
            'Invalid review action',
            400,
          );
          return (reply(res, 200, await operateDiary(u, did, b, b.action)), true);
        }
        if (action === 'amend' && method === 'POST')
          return (reply(res, 200, await operateDiary(u, did, b, 'amend')), true);
        if (action === 'preview' && method === 'GET') {
          check(
            !q.format || ['pdf', 'png', 'jpg', 'print'].includes(q.format),
            'Invalid export format',
            400,
          );
          if (q.format) {
            await require(u, 'diary.export');
            await audit(u, 'class_diary_exported', did, { format: q.format });
          }
          htmlResponse(
            res,
            documents.documentHtml(
              await sources([d]),
              q.format === 'print' ? undefined : q.format,
              (await capabilities(u)).includes('diary.export'),
              'elite-scholars-' +
                d.snapshot.meta.class_name +
                '-' +
                d.snapshot.meta.section_name +
                '-' +
                d.diary_date,
            ),
          );
          return true;
        }
      }
      if (path === '/api/school/family' && method === 'GET') {
        const data = await family(u, q);
        return (
          reply(res, 200, {
            links: data.links,
            dates: data.dates,
            section: data.section,
            date: data.date,
            subjects: (
              consolidateClassDiary(data.entries, await all('SELECT * FROM subject_priorities'))
                ?.content.homework_rows || []
            ).map((r) => ({
              subject: r.subject,
              detail: r.detail,
              hw: r.hw,
              learn: r.learn,
              test: r.test,
              direction: r.direction,
              language: r.language,
            })),
            available: data.entries.length > 0,
          }),
          true
        );
      }
      if (path === '/api/school/family/preview' && method === 'GET') {
        const data = await family(u, q, true);
        check(data.entries.length, 'No approved diary has been published for this date', 404);
        check(
          !q.format || ['pdf', 'png', 'print'].includes(q.format),
          'Invalid parent export format',
          400,
        );
        if (q.format) await require(u, 'diary.export');
        await audit(u, 'parent_diary_viewed', data.section, {
          date: data.date,
          format: q.format || 'preview',
        });
        htmlResponse(
          res,
          documents
            .documentHtml(
              await sources(data.entries, true),
              q.format === 'print' ? undefined : q.format,
              (await capabilities(u)).includes('diary.export'),
              'elite-scholars-class-' + data.entries[0].snapshot.meta.class_name + '-' + data.date,
            )
            .replace(
              'href="/#/diaries"',
              'href="/#/family?section=' + data.section + '&amp;date=' + data.date + '"',
            ),
        );
        return true;
      }
      if (path === '/api/school/reports/export' && method === 'GET') {
        await require(u, 'diary.export');
        check(['pdf', 'png', 'print'].includes(q.format), 'Choose PDF, PNG or print', 400);
        const data = await report(u, q),
          e = documents.escapeHtml;
        const source =
          '<article class="document-source"><template class="header"><div class="page-header"><h1>' +
          e(settings().name) +
          '</h1><div>Class diary report · ' +
          e(q.start) +
          ' — ' +
          e(q.end) +
          '</div></div></template><template class="footer"><div class="page-footer"><span class="page-number"></span></div></template><div class="blocks">' +
          (data.slots.length
            ? data.slots
                .map(
                  (r) =>
                    '<section class="block"><h2>' +
                    e(r.teacher_name) +
                    ' · ' +
                    e(r.date) +
                    '</h2><div class="text">' +
                    e(r.class_name + ' / ' + r.section_name + ' — ' + r.subjects.join(', ')) +
                    '\n' +
                    e(r.overdue ? 'Overdue' : r.status.replaceAll('_', ' ')) +
                    '</div></section>',
                )
                .join('')
            : '<section class="block"><h2>No records match this filter</h2></section>') +
          '</div></article>';
        await audit(u, 'class_diary_report_exported', null, {
          start: q.start,
          end: q.end,
          rows: data.slots.length,
        });
        htmlResponse(
          res,
          documents.documentHtml(
            [source],
            q.format === 'print' ? undefined : q.format,
            true,
            'elite-scholars-report-' + q.start + '-' + q.end,
          ),
        );
        return true;
      }
      if (path === '/api/school/reports' && method === 'GET')
        return (reply(res, 200, await report(u, q)), true);
      if (path === '/api/school/monitoring' && method === 'GET')
        return (reply(res, 200, await monitoring(u, q)), true);
      if (path === '/api/school/monitoring/reminders' && method === 'POST') {
        await require(u, 'notifications.manage');
        check(wide(u) || supervisor(u), 'Reviewer scope required');
        const matrix = await monitoring(u, { date: b.date }),
          row = matrix.rows.find((row) => row.section_id === b.section_id);
        check(row, 'Section is outside your scheduled teaching scope', 404);
        const pending = row.teachers.filter((teacher) => !teacher.submitted);
        let sent = 0;
        await transaction(async () => {
          for (const teacher of pending) {
            const key = 'monitoring:' + matrix.date + ':' + row.section_id + ':' + teacher.id;
            if (!(await one('SELECT 1 FROM notifications WHERE dedupe_key=?', key))) {
              await notify(
                teacher.id,
                null,
                'Please submit your class diary for ' +
                  row.class_name +
                  ' / ' +
                  row.section_name +
                  ' on ' +
                  matrix.date +
                  '.',
                key,
              );
              sent++;
            }
          }
          await audit(u, 'diary_monitoring_reminders_sent', row.section_id, {
            date: matrix.date,
            count: sent,
          });
        });
        return (reply(res, 200, { sent, alreadySent: pending.length - sent }), true);
      }
      if (path === '/api/school/dashboard' && method === 'GET') {
        if (u.role === 'parent') {
          const data = await family(u, q);
          return (
            reply(res, 200, {
              parent: true,
              linkedSections: data.links.length,
              publishedDates: data.dates.length,
              date: data.date,
              available: data.entries.length > 0,
            }),
            true
          );
        }
        const date = q.date || dateInZone();
        check(validDate(date), 'Choose a valid diary date', 400);
        const caps = await capabilities(u),
          ds = [],
          canRead = await createDiaryScope(db, u, { readAll: domain.can(u, 'read_all') });
        for (const d of await all(
          'SELECT ' + summaryColumns + ' FROM school_diaries WHERE diary_date=?',
          date,
        ))
          if (canRead(d) && !deleted.has('diary:' + d.id) && !json(d.content).deleted_at)
            ds.push(parse(d));
        const data = caps.includes('reports.view')
          ? await report(u, { start: date, end: date })
          : {
              counts: {
                expected: 0,
                submitted: 0,
                approved: 0,
                returned: 0,
                pending: 0,
                overdue: 0,
              },
            };
        return (
          reply(res, 200, {
            date,
            counts: { ...data.counts, drafts: ds.filter((d) => d.status === 'draft').length },
            diaries: ds,
            monitoring:
              caps.includes('reports.view') && caps.includes('diary.view')
                ? await monitoring(u, q, { report: data, diaries: ds })
                : null,
            quotes: await selectedQuotes(date),
          }),
          true
        );
      }
      if (path === '/api/school/notice' && method === 'GET') {
        await require(u, 'quotes.manage');
        const stored = (await schoolSettings()).diaryNotice;
        return (reply(res, 200, { notice: { ...emptyNotice(), ...(stored || {}) } }), true);
      }
      if (path === '/api/school/notice' && method === 'PUT') {
        await require(u, 'quotes.manage');
        await transaction(async () => {
          const row = await one('SELECT value FROM settings WHERE id=1'),
            current = json(row.value),
            notice = normalizeNotice(b, current.diaryNotice, {
              actor: u.id,
              today: dateInZone(),
              validDate,
              check,
            });
          await run(
            'UPDATE settings SET value=? WHERE id=1',
            JSON.stringify({ ...current, diaryNotice: notice }),
          );
          await audit(u, notice.published ? 'school_notice_published' : 'school_notice_saved', 'notice', {
            published: notice.published,
            startDate: notice.startDate,
            endDate: notice.endDate,
          });
        });
        return (reply(res, 200, { ok: true }), true);
      }
      if (path === '/api/school/quotes' && method === 'GET') {
        await require(u, 'quotes.manage');
        return (
          reply(res, 200, {
            quotes: await all(
              'SELECT * FROM quotes WHERE scope_id IS NULL ORDER BY updated_at DESC',
            ),
            schedules: await all(
              'SELECT s.* FROM quote_schedules s JOIN quotes q ON q.id=s.quote_id WHERE q.scope_id IS NULL AND s.scope_id IS NULL',
            ),
          }),
          true
        );
      }
      if (path === '/api/school/quotes' && method === 'POST') {
        await require(u, 'quotes.manage');
        const value = text(b.text, 1, 300, 'quote text');
        check(['en', 'ur', 'ar'].includes(b.language), 'Choose English, Urdu or Arabic', 400);
        check(validDate(b.date), 'Choose a quote date', 400);
        check(
          b.priority === undefined ||
            (Number.isInteger(b.priority) && Math.abs(b.priority) <= 1000),
          'Priority must be between -1000 and 1000',
          400,
        );
        const qid = id();
        await transaction(async () => {
          await run(
            'INSERT INTO quotes VALUES(?,?,?,?,1,NULL,?,?)',
            qid,
            value,
            b.language,
            b.language === 'en' ? 'ltr' : 'rtl',
            u.id,
            now(),
          );
          await run(
            'INSERT INTO quote_schedules VALUES(?,?,?,NULL,?)',
            id(),
            qid,
            b.date,
            Number.isInteger(b.priority) && Math.abs(b.priority) <= 1000 ? b.priority : 0,
          );
          await audit(u, 'school_quote_created', qid, { date: b.date, language: b.language });
        });
        return (reply(res, 201, { id: qid }), true);
      }
      const quote = /^\/api\/school\/quotes\/([\w-]+)$/.exec(path);
      if (quote && ['PATCH', 'DELETE'].includes(method)) {
        await require(u, 'quotes.manage');
        const old = await one('SELECT * FROM quotes WHERE id=? AND scope_id IS NULL', quote[1]);
        check(old, 'School quote not found', 404);
        await transaction(async () => {
          if (method === 'DELETE') {
            await run('DELETE FROM quote_schedules WHERE quote_id=?', old.id);
            await run('DELETE FROM quotes WHERE id=?', old.id);
          } else {
            check(
              b.active === undefined || typeof b.active === 'boolean',
              'Invalid active flag',
              400,
            );
            const language = b.language ?? old.language;
            check(['en', 'ur', 'ar'].includes(language), 'Choose English, Urdu or Arabic', 400);
            await run(
              'UPDATE quotes SET text=?,language=?,direction=?,active=?,updated_at=? WHERE id=?',
              text(b.text ?? old.text, 1, 300, 'quote text'),
              language,
              language === 'en' ? 'ltr' : 'rtl',
              b.active === undefined ? old.active : Number(b.active),
              now(),
              old.id,
            );
            if (b.date !== undefined) {
              check(validDate(b.date), 'Choose a quote date', 400);
              const priority =
                b.priority === undefined
                  ? ((
                      await one(
                        'SELECT priority FROM quote_schedules WHERE quote_id=? ORDER BY priority DESC,id LIMIT 1',
                        old.id,
                      )
                    )?.priority ?? 0)
                  : b.priority;
              check(
                Number.isInteger(priority) && Math.abs(priority) <= 1000,
                'Priority must be between -1000 and 1000',
                400,
              );
              await run('DELETE FROM quote_schedules WHERE quote_id=?', old.id);
              await run(
                'INSERT INTO quote_schedules VALUES(?,?,?,NULL,?)',
                id(),
                old.id,
                b.date,
                priority,
              );
            }
          }
          await audit(
            u,
            method === 'DELETE' ? 'school_quote_deleted' : 'school_quote_updated',
            old.id,
          );
        });
        return (reply(res, 200, { ok: true }), true);
      }
      if (path === '/api/school/alerts' && method === 'GET') {
        const rows = await all(
          'SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 300',
          u.id,
        );
        return (
          reply(
            res,
            200,
            rows.map((n) => {
              const d = /^school:([\w-]+):/.exec(n.dedupe_key),
                p = /^parent:([\w-]+):(\d{4}-\d{2}-\d{2})/.exec(n.dedupe_key);
              return {
                ...n,
                url: d
                  ? '#/schooldiaries?id=' + d[1]
                  : p
                    ? '#/family?section=' + p[1] + '&date=' + p[2]
                    : n.diary_id
                      ? '#/diary?id=' + n.diary_id
                      : null,
              };
            }),
          ),
          true
        );
      }
      if (path === '/api/school/audit' && method === 'GET') {
        await require(u, 'audit.view');
        check(wide(u), 'School-wide audit access requires an administrative account');
        const conditions = [],
          args = [];
        for (const key of ['start', 'end'])
          if (q[key]) {
            check(validDate(q[key]), 'Choose valid audit dates', 400);
            const day =
              key === 'end'
                ? new Date(Date.parse(q[key] + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10)
                : q[key];
            conditions.push('a.created_at' + (key === 'end' ? '<' : '>=') + '?');
            args.push(zoneTimestamp(day, '00:00'));
          }
        for (const [key, column] of [
          ['actor', 'actor_id'],
          ['resource', 'resource_id'],
        ])
          if (q[key]) {
            conditions.push('a.' + column + '=?');
            args.push(q[key]);
          }
        if (q.action) {
          conditions.push(
            db.dialect === 'postgres' ? 'POSITION(? IN a.action)>0' : 'INSTR(a.action,?)>0',
          );
          args.push(q.action);
        }
        if (q.type) {
          conditions.push('SUBSTR(a.action,1,?)=?');
          args.push(q.type.length, q.type);
        }
        for (const key of ['branch', 'campus', 'class', 'section'])
          if (q[key]) {
            conditions.push(queries.field('a.details', [key + '_id']) + '=?');
            args.push(q[key]);
          }
        const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '',
          page = Math.max(1, Math.floor(Number(q.page) || 1));
        const total = Number((await one('SELECT COUNT(*) n FROM audit a' + where, ...args)).n),
          items = await all(
            'SELECT a.*,u.name actor_name FROM audit a LEFT JOIN users u ON u.id=a.actor_id' +
              where +
              ' ORDER BY a.created_at DESC,a.id LIMIT 100 OFFSET ?',
            ...args,
            (page - 1) * 100,
          );
        return (reply(res, 200, { total, page, items }), true);
      }
      check(false, 'School endpoint not found', 404);
    },
  };
  // Alerts are pushed to devices right after any change, not only by the daily job.
  service.route = async (args) => {
    const handled = await service.routeCore(args);
    if (handled && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(args.method) && push.configured())
      try {
        await push.dispatch();
      } catch (error) {
        console.error('Push dispatch failed:', error.message);
      }
    return handled;
  };
  return service;
}
