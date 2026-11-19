import { assertSettingsVersion, preserveSettingsLinks } from './settings-publication.mjs';
import { schoolPlatform } from './school-platform.mjs';
import { management } from './management.mjs';
// Application-only access: no browser database grants. All values are bound parameters.
export function enhancements(db, domain, documents) {
  const { all, one, run, id, now, audit, notify, settings, transaction } = db;
  const manage = management(db, domain);
  const school = schoolPlatform(db, domain, documents);
  const {
    check,
    can,
    visibleAssignments,
    listDiaries,
    dateInZone,
    validDate,
    validTime,
    saveDiary,
  } = domain;
  const MEDIA_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf' };
  const mediaMatches = (mime, b) =>
    (mime === 'image/jpeg' && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) ||
    (mime === 'image/png' && b.subarray(0, 4).toString('hex') === '89504e47') ||
    (mime === 'image/webp' && b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') ||
    (mime === 'image/gif' && b.subarray(0, 4).toString() === 'GIF8') ||
    (mime === 'application/pdf' && b.subarray(0, 4).toString() === '%PDF');
  const text = (v, min, max, label) => {
    check(
      typeof v === 'string' && v.trim().length >= min && v.length <= max,
      'Invalid ' + label,
      400,
    );
    return v.trim();
  };
  const pair = (a, b) => [a, b].sort();
  async function active(uid) {
    const u = await one('SELECT id,name,role FROM users WHERE id=? AND active=1', uid);
    check(u, 'Active account not found', 404);
    return u;
  }
  async function blocked(a, b) {
    return !!(await one(
      'SELECT 1 FROM user_blocks WHERE (user_id=? AND blocked_id=?) OR (user_id=? AND blocked_id=?)',
      a,
      b,
      b,
      a,
    ));
  }
  async function connected(a, b) {
    const [lo, hi] = pair(a, b);
    return (
      !(await blocked(a, b)) &&
      !!(await one(
        "SELECT 1 FROM connections WHERE user_low=? AND user_high=? AND state='accepted'",
        lo,
        hi,
      ))
    );
  }
  async function member(u, cid, oversight = false) {
    const c = await one('SELECT * FROM conversations WHERE id=?', cid);
    check(c, 'Conversation not found', 404);
    if (oversight) {
      check(u.role === 'super_admin', 'Super Admin oversight required');
      return c;
    }
    check(
      await one(
        'SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=? AND active=1',
        cid,
        u.id,
      ),
      'Conversation not found',
      404,
    );
    if (c.kind === 'direct') {
      const conn = await one('SELECT * FROM connections WHERE id=?', c.connection_id);
      check(
        conn?.state === 'accepted' && !(await blocked(conn.user_low, conn.user_high)),
        'Connection is not active',
        403,
      );
      await active(conn.user_low);
      await active(conn.user_high);
    }
    return c;
  }
  async function addMember(u, cid, uid) {
    const existing = await one(
      'SELECT * FROM conversation_members WHERE conversation_id=? AND user_id=?',
      cid,
      uid,
    );
    if (existing?.active) return;
    const t = now();
    if (existing)
      await run(
        'UPDATE conversation_members SET active=1,joined_at=?,last_read_at=? WHERE conversation_id=? AND user_id=?',
        t,
        t,
        cid,
        uid,
      );
    else await run('INSERT INTO conversation_members VALUES(?,?,1,?,?)', cid, uid, t, t);
    await run(
      'INSERT INTO membership_events VALUES(?,?,?,?,?,?)',
      id(),
      cid,
      uid,
      u.id,
      'joined',
      t,
    );
  }
  async function leaveMember(u, cid, uid, action) {
    const row = await one(
      'SELECT * FROM conversation_members WHERE conversation_id=? AND user_id=? AND active=1',
      cid,
      uid,
    );
    check(row, 'Active member not found', 404);
    await run(
      'UPDATE conversation_members SET active=0 WHERE conversation_id=? AND user_id=?',
      cid,
      uid,
    );
    await run(
      'INSERT INTO membership_events VALUES(?,?,?,?,?,?)',
      id(),
      cid,
      uid,
      u.id,
      action,
      now(),
    );
    await audit(u, 'group_member_' + action, cid, { user_id: uid });
  }
  async function handle(u) {
    await run(
      'INSERT OR IGNORE INTO user_handles VALUES(?,?,?)',
      u.id,
      'u_' + u.id.replaceAll('-', ''),
      now(),
    );
    return (await one('SELECT username FROM user_handles WHERE user_id=?', u.id)).username;
  }
  async function config(u) {
    const assignments = await visibleAssignments(u),
      classes = new Set();
    for (const a of assignments) {
      const section = await one('SELECT parent_id FROM academics WHERE id=?', a.section_id);
      if (section) classes.add(section.parent_id);
    }
    return {
      classSubjects: (await all('SELECT * FROM class_subjects')).filter(
        (x) => can(u, 'manage_academics') || can(u, 'read_all') || classes.has(x.class_id),
      ),
      reviewers: (await all('SELECT * FROM teacher_reviewers')).filter(
        (x) => can(u, 'manage_academics') || x.teacher_id === u.id,
      ),
      username: await handle(u),
    };
  }
  async function classData(u, q) {
    check(validDate(q.date), 'Valid diary date required', 400);
    const as = (await visibleAssignments(u)).filter((a) => a.section_id === q.section);
    check(as.length, 'Class section not found', 404);
    const entries = (
      await listDiaries(u, { start: q.date, end: q.date, section: q.section })
    ).filter((d) => !q.period || d.period === Number(q.period));
    return { section: q.section, date: q.date, assignments: as, entries };
  }
  async function classSource(u, q) {
    const data = await classData(u, q);
    check(data.entries.length, 'No accessible class entries for this date', 404);
    const first = data.entries[0],
      rows = [],
      quotes = [],
      seen = new Set();
    for (const d of data.entries) {
      const details = d.content.homework_rows?.filter((r) => r.detail) || [
        {
          subject: d.assignment.subject_name,
          detail: Object.entries(d.content)
            .filter(([k, v]) => k !== 'diary_layout' && typeof v === 'string' && v)
            .map(([k, v]) => k.replaceAll('_', ' ') + ': ' + v)
            .join('\n'),
        },
      ];
      for (const row of details)
        rows.push({
          ...row,
          teacher_name: undefined,
          detail:
            row.detail +
            '\n' +
            d.assignment.teacher_name +
            ' · ' +
            d.status.replaceAll('_', ' ') +
            ' · Period ' +
            d.period +
            ' · v' +
            d.version +
            (d.review_remarks ? '\nReview: ' + d.review_remarks : ''),
        });
      if (d.status === 'approved')
        for (const quote of d.quote_snapshot)
          if (!seen.has(quote.id)) {
            quotes.push(quote);
            seen.add(quote.id);
          }
    }
    check(rows.length <= 200, 'Select a single period or fewer entries for a class export', 400);
    return {
      ...first,
      id: 'class-' + q.section + '-' + q.date,
      content: { diary_layout: 'homework_grid', homework_rows: rows },
      quote_snapshot: quotes,
      template_snapshot: {
        ...first.template_snapshot,
        assignmentSnapshot: {
          ...(first.template_snapshot.assignmentSnapshot || first.assignment),
          subject_name: 'Class diary',
          teacher_name: 'Class subject entries',
        },
      },
      status: 'class diary',
    };
  }
  return {
    school,
    config,
    classData,
    classSource,
    handle,
    async route({ path, method, b, q, u, res, reply, htmlResponse }) {
      if (await school.route({ path, method, b, q, u, res, reply, htmlResponse })) return true;
      if (await manage({ path, method, b, u, res, reply })) return true;
      if (path === '/api/enhancements' && method === 'GET')
        return (reply(res, 200, await config(u)), true);
      if (path === '/api/school-identity' && method === 'PATCH') {
        check(
          ['super_admin', 'school_admin'].includes(u.role) &&
            (await school.capabilities(u)).includes('settings.manage'),
          'School settings permission required',
        );
        const old = settings();
        assertSettingsVersion(b.expected_template_version, old);
        const logo = b.logo ?? old.logo ?? '';
        check(
          typeof logo === 'string' &&
            (logo === '' ||
              (/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(logo) &&
                logo.length < 270000)),
          'PNG/JPG logo must be under 200 KB',
          400,
        );
        if (logo) {
          const bytes = Buffer.from(logo.split(',')[1], 'base64');
          check(
            bytes.length <= 200000 &&
              ((logo.startsWith('data:image/png') &&
                bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
                (logo.startsWith('data:image/jpeg') &&
                  bytes[0] === 255 &&
                  bytes[1] === 216 &&
                  bytes[2] === 255)),
            'Invalid logo image signature',
            400,
          );
        }
        const value = {
          ...old,
          name: text(b.name, 2, 300, 'school name'),
          address: text(b.address || '', 0, 300, 'address'),
          contact: text(b.contact || '', 0, 300, 'contact'),
          logo,
          templateVersion: old.templateVersion + 1,
        };
        await transaction(async () => {
          const row = await one('SELECT value FROM settings WHERE id=1'),
            current = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
          Object.assign(value, preserveSettingsLinks(value, current, old.templateVersion));
          await run('UPDATE settings SET value=? WHERE id=1', JSON.stringify(value));
          await run(
            'INSERT INTO template_versions VALUES(?,?,?,?)',
            value.templateVersion,
            u.id,
            JSON.stringify(value),
            now(),
          );
          await audit(u, 'school_identity_updated', null, { version: value.templateVersion });
        });
        return (reply(res, 200, value), true);
      }
      if (path === '/api/class-subjects' && method === 'POST') {
        check(can(u, 'manage_academics'), 'Academic management permission required');
        check(
          await one("SELECT 1 FROM academics WHERE id=? AND kind='class' AND active=1", b.class_id),
          'Active class required',
          400,
        );
        check(
          Array.isArray(b.subject_ids) && b.subject_ids.length > 0 && b.subject_ids.length <= 50,
          'Select subjects',
          400,
        );
        for (const sid of b.subject_ids)
          check(
            await one("SELECT 1 FROM academics WHERE id=? AND kind='subject' AND active=1", sid),
            'Active subject required',
            400,
          );
        await transaction(async () => {
          for (const sid of new Set(b.subject_ids))
            await run('INSERT OR IGNORE INTO class_subjects VALUES(?,?)', b.class_id, sid);
          await audit(u, 'class_subjects_linked', b.class_id, { subjects: b.subject_ids });
        });
        return (reply(res, 200, { ok: true }), true);
      }
      if (path === '/api/assignment-session' && method === 'POST') {
        check(can(u, 'manage_academics'), 'Academic management permission required');
        check(
          await one(
            "SELECT 1 FROM academics WHERE id=? AND kind='session' AND active=1",
            b.session_id,
          ),
          'Active academic session required',
          400,
        );
        await transaction(async () => {
          const row = await one('SELECT value FROM settings WHERE id=1');
          const old = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
          await run(
            'UPDATE settings SET value=? WHERE id=1',
            JSON.stringify({ ...old, assignmentSessionId: b.session_id }),
          );
          await audit(u, 'assignment_session_configured', b.session_id);
        });
        return (reply(res, 200, { ok: true }), true);
      }
      if (path === '/api/teacher-reviewers' && method === 'POST') {
        check(can(u, 'manage_academics'), 'Academic management permission required');
        await active(b.teacher_id);
        check(
          (await active(b.head_id)).role === 'head_teacher' && b.teacher_id !== b.head_id,
          'Separate Head Teacher required',
          400,
        );
        await transaction(async () => {
          if (await one('SELECT 1 FROM teacher_reviewers WHERE teacher_id=?', b.teacher_id))
            await run(
              'UPDATE teacher_reviewers SET head_id=? WHERE teacher_id=?',
              b.head_id,
              b.teacher_id,
            );
          else await run('INSERT INTO teacher_reviewers VALUES(?,?)', b.teacher_id, b.head_id);
          await audit(u, 'teacher_reviewer_configured', b.teacher_id, { head_id: b.head_id });
        });
        return (reply(res, 200, { ok: true }), true);
      }
      if (path === '/api/assignments/bulk' && method === 'POST') {
        check(can(u, 'manage_academics'), 'Academic management permission required');
        const teacher = await active(b.teacher_id),
          reviewer = await one('SELECT * FROM teacher_reviewers WHERE teacher_id=?', teacher.id);
        check(reviewer, 'Configure the teacher’s reviewer in People & Roles first', 400);
        check(
          (await active(reviewer.head_id)).role === 'head_teacher',
          'Active Head Teacher required',
          400,
        );
        check(
          Array.isArray(b.pairs) && b.pairs.length > 0 && b.pairs.length <= 100,
          'Select class/subject combinations (max 100)',
          400,
        );
        check(
          Array.isArray(b.weekdays) &&
            b.weekdays.length &&
            b.weekdays.every((v) => Number.isInteger(v) && v >= 0 && v <= 6),
          'Valid weekdays required',
          400,
        );
        check(
          Array.isArray(b.periods) &&
            b.periods.length &&
            b.periods.every((v) => Number.isInteger(v) && v >= 1 && v <= 20),
          'Valid periods required',
          400,
        );
        check(validTime(b.due_time) && validTime(b.review_time), 'Valid deadlines required', 400);
        const date = dateInZone(),
          sessions = await all(
            "SELECT * FROM academics WHERE kind='session' AND active=1 AND start_date<=? AND end_date>=? ORDER BY start_date DESC",
            date,
            date,
          );
        check(
          sessions.length > 0,
          'Configure an active academic session covering today in Academic Setup',
          400,
        );
        const ses =
          sessions.find((s) => s.id === settings().assignmentSessionId) ||
          sessions.find((s) => s.name === settings().session) ||
          sessions[0];
        const unique = new Map();
        for (const p of b.pairs) {
          const section = await one(
            "SELECT * FROM academics WHERE id=? AND kind='section' AND active=1",
            p.section_id,
          );
          check(
            section &&
              (await one(
                'SELECT 1 FROM class_subjects WHERE class_id=? AND subject_id=?',
                section.parent_id,
                p.subject_id,
              )),
            'Subject must be linked to the selected class',
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
          unique.set(p.section_id + ':' + p.subject_id, p);
        }
        const created = [],
          skipped = [];
        await transaction(async () => {
          for (const p of unique.values()) {
            const old = await one(
              'SELECT id FROM assignments WHERE teacher_id=? AND section_id=? AND subject_id=? AND session_id=? AND active=1',
              teacher.id,
              p.section_id,
              p.subject_id,
              ses.id,
            );
            if (old) {
              skipped.push(old.id);
              continue;
            }
            const aid = id();
            await run(
              'INSERT INTO assignments VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1)',
              aid,
              teacher.id,
              reviewer.head_id,
              p.section_id,
              p.subject_id,
              ses.id,
              date,
              ses.end_date,
              JSON.stringify([...new Set(b.weekdays)]),
              JSON.stringify([...new Set(b.periods)]),
              b.due_time,
              b.review_time,
            );
            created.push(aid);
            await audit(u, 'assignment_created', aid, { bulk: true });
          }
        });
        return (reply(res, 201, { created, skipped }), true);
      }
      if (path === '/api/class-diary' && method === 'GET')
        return (reply(res, 200, await classData(u, q)), true);
      if (path === '/api/class-diary/preview' && method === 'GET') {
        const d = await classSource(u, q);
        const format = q.format;
        check(
          !format || ['pdf', 'png', 'jpg', 'print'].includes(format),
          'Invalid export format',
          400,
        );
        if (format) check(can(u, 'export'), 'Export permission required');
        if (format) await audit(u, 'class_diary_exported', q.section, { date: q.date, format });
        htmlResponse(
          res,
          documents.documentHtml(
            [await documents.diarySource(d)],
            format === 'print' ? undefined : format,
            can(u, 'export'),
            'elite-scholars-class-' +
              d.assignment.class_name +
              '-' +
              d.assignment.section_name +
              '-' +
              q.date,
          ),
        );
        return true;
      }
      if (path === '/api/class-diary/save' && method === 'POST') {
        check(validDate(b.diary_date), 'Valid diary date required', 400);
        check(
          Array.isArray(b.entries) && b.entries.length > 0 && b.entries.length <= 30,
          'Add 1–30 subject entries',
          400,
        );
        const as = await visibleAssignments(u);
        const used = new Set();
        for (const e of b.entries) {
          const a = as.find(
            (a) =>
              a.id === e.assignment_id &&
              a.teacher_id === u.id &&
              a.section_id === b.section_id &&
              a.active,
          );
          check(a, 'Only your assigned subjects in this class can be entered', 403);
          check(!used.has(a.id), 'Duplicate subject entry', 400);
          if (e.id) {
            const old = await one('SELECT * FROM diaries WHERE id=?', e.id);
            check(
              old &&
                old.assignment_id === a.id &&
                old.diary_date === b.diary_date &&
                old.period === Number(e.period),
              'Diary does not match this class, date and assignment',
              409,
            );
          }
          used.add(a.id);
        }
        const saved = await transaction(async () => {
          const result = [];
          for (const e of b.entries)
            result.push(
              await saveDiary(
                u,
                { ...e, diary_date: b.diary_date, submit: b.submit === true },
                e.id,
              ),
            );
          return result;
        });
        return (reply(res, 200, { entries: saved }), true);
      }
      if (!path.startsWith('/api/communication')) return false;
      const username = await handle(u);
      if (path === '/api/communication/username' && method === 'PUT') {
        const value = text(b.username, 3, 40, 'username').toLowerCase();
        check(
          /^[a-z0-9_][a-z0-9_.-]{2,39}$/.test(value),
          'Use 3–40 letters, numbers, dot, dash or underscore',
          400,
        );
        check(
          !(await one('SELECT 1 FROM user_handles WHERE username=? AND user_id<>?', value, u.id)),
          'Username already in use',
          409,
        );
        await run(
          'UPDATE user_handles SET username=?,updated_at=? WHERE user_id=?',
          value,
          now(),
          u.id,
        );
        await audit(u, 'username_changed', u.id);
        return (reply(res, 200, { username: value }), true);
      }
      if (path === '/api/communication/search' && method === 'GET') {
        const term = text(q.username || '', 2, 40, 'username search').toLowerCase();
        const rows = await all(
          'SELECT h.username,u.id,u.name FROM user_handles h JOIN users u ON u.id=h.user_id WHERE u.active=1 AND h.username>=? AND h.username<? ORDER BY h.username LIMIT 30',
          term,
          term + '\uffff',
        );
        const result = [];
        for (const x of rows) if (x.id !== u.id && !(await blocked(u.id, x.id))) result.push(x);
        return (reply(res, 200, result), true);
      }
      if (path === '/api/communication' && method === 'GET') {
        const connections = await all(
          'SELECT c.*,s.name sender_name,r.name recipient_name FROM connections c JOIN users s ON s.id=c.sender_id JOIN users r ON r.id=c.recipient_id WHERE c.user_low=? OR c.user_high=? ORDER BY c.updated_at DESC',
          u.id,
          u.id,
        );
        const conversations = await all(
          'SELECT c.*,m.last_read_at FROM conversations c JOIN conversation_members m ON m.conversation_id=c.id WHERE m.user_id=? AND m.active=1 ORDER BY c.created_at DESC',
          u.id,
        );
        const visible = [];
        for (const c of conversations) {
          try {
            await member(u, c.id);
          } catch {
            continue;
          }
          const unread = await one(
            'SELECT COUNT(*) n FROM chat_messages WHERE conversation_id=? AND sender_id<>? AND created_at>?',
            c.id,
            u.id,
            c.last_read_at || '',
          );
          const members = await all(
            'SELECT m.user_id,u.name,h.username,m.active FROM conversation_members m JOIN users u ON u.id=m.user_id LEFT JOIN user_handles h ON h.user_id=u.id WHERE conversation_id=?',
            c.id,
          );
          visible.push({ ...c, unread: Number(unread.n), members });
        }
        const blocks = await all(
          'SELECT b.blocked_id,u.name FROM user_blocks b JOIN users u ON u.id=b.blocked_id WHERE b.user_id=?',
          u.id,
        );
        return (
          reply(res, 200, {
            username,
            connections,
            conversations: visible,
            blocks,
            disclosure:
              'Authorized Super Admins can read private and group messages through audited oversight. Messages and membership history are retained until a documented school retention decision; no automatic message deletion is enabled.',
          }),
          true
        );
      }
      if (path === '/api/communication/requests' && method === 'POST') {
        await active(b.user_id);
        check(b.user_id !== u.id, 'Cannot request yourself', 400);
        check(!(await blocked(u.id, b.user_id)), 'This connection is unavailable', 403);
        const [lo, hi] = pair(u.id, b.user_id);
        const c = await one('SELECT * FROM connections WHERE user_low=? AND user_high=?', lo, hi);
        check(
          !c || !['pending', 'accepted'].includes(c.state),
          'A request or connection already exists',
          409,
        );
        const cid = c?.id || id(),
          t = now();
        await transaction(async () => {
          if (c)
            await run(
              "UPDATE connections SET sender_id=?,recipient_id=?,state='pending',updated_at=? WHERE id=?",
              u.id,
              b.user_id,
              t,
              cid,
            );
          else
            await run(
              "INSERT INTO connections VALUES(?,?,?,?,?,'pending',?,?)",
              cid,
              lo,
              hi,
              u.id,
              b.user_id,
              t,
              t,
            );
          await notify(
            b.user_id,
            null,
            'New connection request from @' + username,
            cid + ':request:' + t,
          );
          await audit(u, 'connection_requested', cid);
        });
        return (reply(res, 201, { id: cid }), true);
      }
      const request = /^\/api\/communication\/requests\/([\w-]+)$/.exec(path);
      if (request && method === 'PATCH') {
        const c = await one('SELECT * FROM connections WHERE id=?', request[1]);
        check(c && [c.sender_id, c.recipient_id].includes(u.id), 'Request not found', 404);
        check(
          ['accept', 'reject', 'cancel', 'remove'].includes(b.action),
          'Invalid request action',
          400,
        );
        if (b.action === 'remove') check(c.state === 'accepted', 'No accepted connection', 409);
        else {
          check(c.state === 'pending', 'Request is no longer pending', 409);
          check((b.action === 'cancel' ? c.sender_id : c.recipient_id) === u.id, 'Not allowed');
        }
        if (b.action === 'accept') {
          await active(c.sender_id);
          await active(c.recipient_id);
          check(!(await blocked(c.sender_id, c.recipient_id)), 'Connection unavailable');
        }
        const state = {
          accept: 'accepted',
          reject: 'rejected',
          cancel: 'cancelled',
          remove: 'removed',
        }[b.action];
        let conversation;
        await transaction(async () => {
          await run('UPDATE connections SET state=?,updated_at=? WHERE id=?', state, now(), c.id);
          if (state === 'accepted') {
            const old = await one('SELECT id FROM conversations WHERE connection_id=?', c.id);
            conversation = old?.id || id();
            if (!old)
              await run(
                "INSERT INTO conversations VALUES(?,'direct','',?,?,?)",
                conversation,
                c.sender_id,
                c.id,
                now(),
              );
            await addMember(u, conversation, c.sender_id);
            await addMember(u, conversation, c.recipient_id);
          }
          await audit(u, 'connection_' + state, c.id);
          await notify(
            c.sender_id === u.id ? c.recipient_id : c.sender_id,
            null,
            'Connection request ' + state,
            c.id + ':' + state + ':' + now(),
          );
        });
        return (reply(res, 200, { state, conversation }), true);
      }
      if (path === '/api/communication/blocks' && method === 'POST') {
        await active(b.user_id);
        check(b.user_id !== u.id, 'Cannot block yourself', 400);
        await transaction(async () => {
          await run('INSERT OR IGNORE INTO user_blocks VALUES(?,?,?)', u.id, b.user_id, now());
          const [lo, hi] = pair(u.id, b.user_id);
          await run(
            "UPDATE connections SET state='removed',updated_at=? WHERE user_low=? AND user_high=?",
            now(),
            lo,
            hi,
          );
          await audit(u, 'user_blocked', b.user_id);
        });
        return (reply(res, 200, { ok: true }), true);
      }
      if (path === '/api/communication/blocks' && method === 'DELETE') {
        await run('DELETE FROM user_blocks WHERE user_id=? AND blocked_id=?', u.id, b.user_id);
        await audit(u, 'user_unblocked', b.user_id);
        return (reply(res, 200, { ok: true }), true);
      }
      if (path === '/api/communication/reports' && method === 'POST') {
        await active(b.user_id);
        check(b.user_id !== u.id, 'Cannot report yourself', 400);
        if (b.conversation_id) await member(u, b.conversation_id);
        const reason = text(b.reason, 5, 2000, 'report reason'),
          rid = id();
        await run(
          'INSERT INTO communication_reports VALUES(?,?,?,?,?,?)',
          rid,
          u.id,
          b.user_id,
          b.conversation_id || null,
          reason,
          now(),
        );
        await audit(u, 'communication_reported', rid, { reported_user_id: b.user_id });
        return (reply(res, 201, { id: rid }), true);
      }
      if (path === '/api/communication/groups' && method === 'POST') {
        const name = text(b.name, 2, 100, 'group name');
        check(
          Array.isArray(b.members) && b.members.length > 0 && b.members.length <= 49,
          'Select 1–49 connected users',
          400,
        );
        const members = [...new Set(b.members)].filter((x) => x !== u.id);
        check(members.length, 'Select other members', 400);
        for (const uid of members) {
          await active(uid);
          check(await connected(u.id, uid), 'Group members must be accepted connections', 403);
          for (const other of members)
            if (uid !== other)
              check(!(await blocked(uid, other)), 'A block prevents this group membership', 403);
        }
        const cid = id();
        await transaction(async () => {
          await run(
            "INSERT INTO conversations VALUES(?,'group',?,?,NULL,?)",
            cid,
            name,
            u.id,
            now(),
          );
          for (const uid of [u.id, ...members]) {
            await addMember(u, cid, uid);
            if (uid !== u.id)
              await notify(uid, null, 'Added to group: ' + name, cid + ':joined:' + uid);
          }
          await audit(u, 'group_created', cid, { members });
        });
        return (reply(res, 201, { id: cid }), true);
      }
      const cm =
        /^\/api\/communication\/conversations\/([\w-]+)(?:\/(messages|members|read|media))?$/.exec(path);
      const oversight = /^\/api\/communication\/oversight(?:\/([\w-]+))?$/.exec(path);
      if (oversight) {
        check(method === 'GET', 'Method not allowed', 405);
        check(u.role === 'super_admin', 'Super Admin oversight required');
        if (!oversight[1]) {
          await audit(u, 'communication_oversight_opened', null);
          const page = Math.max(1, Number(q.page) || 1),
            offset = (page - 1) * 100;
          return (
            reply(res, 200, {
              page,
              users: await all(
                'SELECT u.id,u.name,h.username FROM users u LEFT JOIN user_handles h ON h.user_id=u.id',
              ),
              connections: await all(
                'SELECT * FROM connections ORDER BY updated_at DESC LIMIT 100 OFFSET ?',
                offset,
              ),
              groups: await all(
                'SELECT * FROM conversations ORDER BY created_at DESC LIMIT 100 OFFSET ?',
                offset,
              ),
              members: await all(
                'SELECT * FROM conversation_members WHERE conversation_id IN (SELECT id FROM conversations ORDER BY created_at DESC LIMIT 100 OFFSET ?)',
                offset,
              ),
              events: await all(
                'SELECT * FROM membership_events ORDER BY created_at DESC LIMIT 100 OFFSET ?',
                offset,
              ),
              reports: await all(
                'SELECT * FROM communication_reports ORDER BY created_at DESC LIMIT 100 OFFSET ?',
                offset,
              ),
            }),
            true
          );
        }
        await member(u, oversight[1], true);
        await audit(u, 'communication_messages_accessed', oversight[1], {
          page: Math.max(1, Number(q.page) || 1),
        });
        const page = Math.max(1, Number(q.page) || 1);
        return (
          reply(res, 200, {
            messages: await all(
              'SELECT m.*,h.username FROM chat_messages m LEFT JOIN user_handles h ON h.user_id=m.sender_id WHERE conversation_id=? ORDER BY created_at DESC,id DESC LIMIT 50 OFFSET ?',
              oversight[1],
              (page - 1) * 50,
            ),
          }),
          true
        );
      }
      const mediaGet = /^\/api\/communication\/media\/([\w-]{8,64})$/.exec(path);
      if (mediaGet) {
        check(method === 'GET', 'Method not allowed', 405);
        const m = await one('SELECT * FROM chat_media WHERE id=?', mediaGet[1]);
        check(m, 'Media not found', 404);
        const inChat = await one(
          'SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=? AND active=1',
          m.conversation_id,
          u.id,
        );
        if (!inChat) {
          check(u.role === 'super_admin', 'Not allowed', 403);
          await audit(u, 'communication_media_accessed', m.id);
        }
        const bytes = Buffer.from(m.data, 'base64');
        res.writeHead(200, {
          'Content-Type': m.mime,
          'Content-Length': bytes.length,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'private, max-age=3600',
          'Content-Disposition':
            (m.mime === 'application/pdf' ? 'attachment' : 'inline') +
            '; filename="' + String(m.name).replace(/[^\w. -]/g, '_') + '"',
        });
        res.end(bytes);
        return true;
      }
      if (cm) {
        const [, cid, action] = cm,
          c = await member(u, cid);
        if (action === 'media' && method === 'POST') {
          const mime = String(b.mime || ''),
            data = String(b.data || '');
          check(MEDIA_EXT[mime], 'Only photos (JPG, PNG, WebP, GIF) and PDF files can be shared', 400);
          check(
            /^[A-Za-z0-9+/]+={0,2}$/.test(data) && data.length <= 3000000,
            'The file is damaged or larger than 2 MB',
            413,
          );
          const bytes = Buffer.from(data, 'base64');
          check(bytes.length > 0 && bytes.length <= 2200000, 'The file is larger than 2 MB', 413);
          check(mediaMatches(mime, bytes), 'The file content does not match its type', 400);
          const recent = await one(
            'SELECT COUNT(*) n FROM chat_media WHERE uploader_id=? AND created_at>?',
            u.id,
            new Date(Date.now() - 600000).toISOString(),
          );
          check(Number(recent.n) < 30, 'Too many uploads. Please wait a few minutes.', 429);
          const name = String(b.name || 'file').replace(/[^\w. -]/g, '_').slice(0, 80) || 'file',
            mid = id();
          await run('INSERT INTO chat_media VALUES(?,?,?,?,?,?,?,?)', mid, cid, u.id, mime, name, bytes.length, data, now());
          return (reply(res, 201, { id: mid, mime, name, size: bytes.length }), true);
        }
        if (action === 'messages' && method === 'GET') {
          const page = Math.max(1, Number(q.page) || 1),
            rows = await all(
              'SELECT m.*,u.name,h.username FROM chat_messages m JOIN users u ON u.id=m.sender_id LEFT JOIN user_handles h ON h.user_id=u.id WHERE conversation_id=? ORDER BY m.created_at DESC,m.id DESC LIMIT 50 OFFSET ?',
              cid,
              (page - 1) * 50,
            );
          return (reply(res, 200, { messages: rows.reverse(), page }), true);
        }
        if (action === 'messages' && method === 'POST') {
          const body = text(b.body, 1, 4000, 'message'),
            client = text(b.client_id, 8, 100, 'message identifier');
          const mediaRef = /^\[\[media:([\w-]{8,64}):(img|pdf)\]\]/.exec(body);
          if (mediaRef) {
            const stored = await one(
              'SELECT mime FROM chat_media WHERE id=? AND conversation_id=? AND uploader_id=?',
              mediaRef[1],
              cid,
              u.id,
            );
            check(
              stored && (mediaRef[2] === 'pdf') === (stored.mime === 'application/pdf'),
              'Attachment not found',
              400,
            );
          }
          check(
            !body.includes('[[call:') || /^\[\[call:ES-[a-f0-9]{16}\]\]$/.test(body),
            'Invalid call invitation',
            400,
          );
          const members = await all(
            'SELECT m.user_id,u.active FROM conversation_members m JOIN users u ON u.id=m.user_id WHERE conversation_id=? AND m.active=1',
            cid,
          );
          for (const m of members)
            if (m.user_id !== u.id) {
              check(m.active, 'An account in this conversation is inactive', 403);
              check(
                !(await blocked(u.id, m.user_id)),
                'A block prevents sending to this conversation',
                403,
              );
            }
          const duplicate = await one(
            'SELECT * FROM chat_messages WHERE sender_id=? AND client_id=?',
            u.id,
            client,
          );
          if (duplicate) {
            check(
              duplicate.conversation_id === cid && duplicate.body === body,
              'Message identifier already used',
              409,
            );
            return (reply(res, 200, duplicate), true);
          }
          const mid = id(),
            t = now();
          await transaction(async () => {
            await run(
              'INSERT INTO chat_messages VALUES(?,?,?,?,?,?)',
              mid,
              cid,
              u.id,
              client,
              body,
              t,
            );
            for (const m of members)
              if (m.user_id !== u.id)
                await notify(
                  m.user_id,
                  null,
                  'New message from @' + username,
                  mid + ':' + m.user_id,
                );
          });
          return (reply(res, 201, { id: mid, body, created_at: t, sender_id: u.id }), true);
        }
        if (action === 'read' && method === 'POST') {
          const seen = b.last_seen || now();
          check(
            typeof seen === 'string' &&
              /^\d{4}-\d{2}-\d{2}T/.test(seen) &&
              !Number.isNaN(Date.parse(seen)) &&
              seen <= now(),
            'Invalid read timestamp',
            400,
          );
          const previous = await one(
            'SELECT last_read_at FROM conversation_members WHERE conversation_id=? AND user_id=?',
            cid,
            u.id,
          );
          if (!previous.last_read_at || previous.last_read_at < seen)
            await run(
              'UPDATE conversation_members SET last_read_at=? WHERE conversation_id=? AND user_id=?',
              seen,
              cid,
              u.id,
            );
          return (reply(res, 200, { ok: true }), true);
        }
        if (action === 'members' && method === 'GET')
          return (
            reply(res, 200, {
              members: await all(
                'SELECT m.*,u.name,h.username FROM conversation_members m JOIN users u ON u.id=m.user_id LEFT JOIN user_handles h ON h.user_id=u.id WHERE conversation_id=?',
                cid,
              ),
              events: await all(
                'SELECT * FROM membership_events WHERE conversation_id=? ORDER BY created_at DESC',
                cid,
              ),
            }),
            true
          );
        if (action === 'members' && ['POST', 'DELETE'].includes(method)) {
          check(c.kind === 'group', 'Group required', 400);
          if (method === 'DELETE') {
            check(
              c.creator_id === u.id || b.user_id === u.id,
              'Only creator can remove another member',
            );
            check(
              b.user_id !== c.creator_id,
              'Group creator cannot leave; members may leave their group',
              400,
            );
            await leaveMember(u, cid, b.user_id, b.user_id === u.id ? 'left' : 'removed');
          } else {
            check(c.creator_id === u.id, 'Only group creator can add members');
            await active(b.user_id);
            check(await connected(u.id, b.user_id), 'Accepted connection required');
            const members = await all(
              'SELECT user_id FROM conversation_members WHERE conversation_id=? AND active=1',
              cid,
            );
            check(members.length < 50, 'Maximum 50 group members', 400);
            for (const m of members)
              check(!(await blocked(m.user_id, b.user_id)), 'A block prevents membership');
            await transaction(async () => {
              await addMember(u, cid, b.user_id);
              await audit(u, 'group_member_added', cid, { user_id: b.user_id });
              await notify(
                b.user_id,
                null,
                'Added to group: ' + c.name,
                cid + ':member:' + b.user_id + ':' + now(),
              );
            });
          }
          return (reply(res, 200, { ok: true }), true);
        }
      }
      check(false, 'Communication route not found', 404);
    },
  };
}
