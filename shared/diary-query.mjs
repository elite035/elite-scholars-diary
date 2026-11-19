export function diaryQuery(db, domain) {
  const pg = db.dialect === 'postgres';
  const field = (column, path) =>
    pg
      ? `(${column}::jsonb #>> '{${path.join(',')}}')`
      : `json_extract(${column},'$.${path.join('.')}')`;
  const notDeleted =
    "NOT EXISTS(SELECT 1 FROM audit a WHERE a.action='record_force_deleted' AND a.resource_id='diary:'||school_diaries.id)";
  function scope(user) {
    if (
      ['super_admin', 'school_admin'].includes(user.role) ||
      (['coordinator', 'head_teacher'].includes(user.role) && domain.can(user, 'read_all'))
    )
      return { sql: '1=1', args: [] };
    if (user.role === 'head_teacher')
      return {
        sql: "(teacher_id=? OR teacher_id IN(SELECT r.teacher_id FROM teacher_reviewers r JOIN users h ON h.id=r.head_id WHERE h.active=1 AND h.role='head_teacher' AND r.head_id=?))",
        args: [user.id, user.id],
      };
    if (user.role === 'coordinator')
      return {
        sql: "(teacher_id=? OR teacher_id IN(SELECT r.teacher_id FROM teacher_reviewers r JOIN users h ON h.id=r.head_id JOIN coordinator_heads c ON c.head_id=r.head_id WHERE h.active=1 AND h.role='head_teacher' AND c.coordinator_id=?))",
        args: [user.id, user.id],
      };
    return { sql: 'teacher_id=?', args: [user.id] };
  }
  function where(user, q = {}) {
    const access = scope(user),
      clauses = [
        access.sql,
        notDeleted,
        field('content', ['deleted_at']) + (q.deleted === '1' ? ' IS NOT NULL' : ' IS NULL'),
      ],
      args = [...access.args];
    for (const [name, column, operator] of [
      ['id', 'id', '='],
      ['teacher', 'teacher_id', '='],
      ['section', 'section_id', '='],
      ['start', 'diary_date', '>='],
      ['end', 'diary_date', '<='],
    ])
      if (q[name]) {
        if (['start', 'end'].includes(name))
          domain.check(domain.validDate(q[name]), 'Choose a valid diary date', 400);
        clauses.push(column + operator + '?');
        args.push(q[name]);
      }
    for (const name of ['class', 'campus', 'branch'])
      if (q[name]) {
        clauses.push(field('snapshot', ['meta', name + '_id']) + '=?');
        args.push(q[name]);
      }
    if (q.status) {
      if (q.status === 'pending')
        clauses.push("status IN('submitted','resubmitted','under_review')");
      else {
        clauses.push('status=?');
        args.push(q.status);
      }
    }
    if (q.subject) {
      clauses.push(
        pg
          ? "EXISTS(SELECT 1 FROM jsonb_array_elements(content::jsonb->'homework_rows') row WHERE row->>'subject_id'=?)"
          : "EXISTS(SELECT 1 FROM json_each(content,'$.homework_rows') row WHERE json_extract(row.value,'$.subject_id')=?)",
      );
      args.push(q.subject);
    }
    if (q.search) {
      clauses.push(
        pg ? 'POSITION(LOWER(?) IN LOWER(content))>0' : 'INSTR(LOWER(content),LOWER(?))>0',
      );
      args.push(q.search);
    }
    return { sql: clauses.join(' AND '), args };
  }
  async function page(user, q, columns) {
    const filter = where(user, q),
      page = Math.max(1, Math.floor(Number(q.page) || 1)),
      total = Number(
        (await db.one('SELECT count(*) n FROM school_diaries WHERE ' + filter.sql, ...filter.args))
          .n,
      );
    const rows = await db.all(
      'SELECT ' +
        columns +
        ' FROM school_diaries WHERE ' +
        filter.sql +
        ' ORDER BY diary_date DESC,updated_at DESC,id LIMIT 30 OFFSET ?',
      ...filter.args,
      (page - 1) * 30,
    );
    return { total, page, rows };
  }
  async function consolidatedPage(user, q, approvedSql) {
    const filter = where(user, {
      ...q,
      teacher: undefined,
      subject: undefined,
      search: undefined,
      status: 'approved',
      deleted: undefined,
    });
    const clauses = [filter.sql, approvedSql],
      args = [...filter.args],
      having = [];
    for (const [name, condition] of [
      ['teacher', 'teacher_id=?'],
      [
        'subject',
        pg
          ? "EXISTS(SELECT 1 FROM jsonb_array_elements(content::jsonb->'homework_rows') row WHERE row->>'subject_id'=?)"
          : "EXISTS(SELECT 1 FROM json_each(content,'$.homework_rows') row WHERE json_extract(row.value,'$.subject_id')=?)",
      ],
      [
        'search',
        pg ? 'POSITION(LOWER(?) IN LOWER(content))>0' : 'INSTR(LOWER(content),LOWER(?))>0',
      ],
    ])
      if (q[name]) {
        having.push('MAX(CASE WHEN ' + condition + ' THEN 1 ELSE 0 END)=1');
        args.push(q[name]);
      }
    if (q.status && q.status !== 'approved') clauses.push('1=0');
    const classId = field('snapshot', ['meta', 'class_id']);
    const grouped =
      'SELECT section_id,diary_date,' +
      classId +
      ' class_id,MIN(' +
      field('snapshot', ['meta', 'class_name']) +
      ') class_name,MIN(' +
      field('snapshot', ['meta', 'section_name']) +
      ') section_name FROM school_diaries WHERE ' +
      clauses.join(' AND ') +
      ' GROUP BY section_id,diary_date,' +
      classId +
      (having.length ? ' HAVING ' + having.join(' AND ') : '');
    const page = Math.max(1, Math.floor(Number(q.page) || 1)),
      total = Number(
        (await db.one('SELECT COUNT(*) n FROM (' + grouped + ') grouped_diaries', ...args)).n,
      );
    return {
      page,
      total,
      keys: await db.all(
        grouped + ' ORDER BY diary_date DESC,class_name,section_name,section_id LIMIT 30 OFFSET ?',
        ...args,
        (page - 1) * 30,
      ),
    };
  }
  return { scope, where, page, field, notDeleted, consolidatedPage };
}
