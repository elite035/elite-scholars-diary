import { subjectLanguage, languageDirection } from '../public/diary-languages.js';

export const isApprovedDiary = (d) =>
  d.status === 'approved' && !!d.submitted_at && !!d.reviewed_at && !d.content.deleted_at;
// A read model only: teacher submissions, statuses and append-only history remain authoritative.
export function consolidateClassDiary(entries, priorities = []) {
  const unique = [...new Map(entries.filter(isApprovedDiary).map((d) => [d.id, d])).values()].sort(
    (a, b) => a.id.localeCompare(b.id),
  );
  if (!unique.length) return null;
  const first = unique[0],
    meta = first.snapshot.meta,
    rows = new Map();
  for (const d of unique) {
    if (
      d.section_id !== first.section_id ||
      d.diary_date !== first.diary_date ||
      d.snapshot.meta.class_id !== meta.class_id
    )
      throw new Error('Cannot consolidate different classes, sections or dates');
    for (const source of d.content.homework_rows) {
      const language = subjectLanguage(source, d.language),
        row = {
          ...source,
          language,
          direction: language ? languageDirection(language) : source.direction,
        };
      const key = JSON.stringify([
        row.subject_id || row.subject,
        row.detail,
        !!row.hw,
        !!row.learn,
        !!row.test,
        row.direction || 'auto',
        row.language,
      ]);
      if (!rows.has(key)) rows.set(key, { ...row, contributors: [] });
      const target = rows.get(key);
      if (!target.contributors.some((x) => x.diary_id === d.id))
        target.contributors.push({
          diary_id: d.id,
          teacher_id: d.teacher_id,
          teacher_name: d.snapshot.teacher_name,
        });
    }
  }
  const order = new Map(priorities.map((p) => [p.subject_id, p.priority]));
  const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const orderedRows = [...rows.values()]
    .map((row) => ({ ...row, priority: order.get(row.subject_id) ?? 0 }))
    .sort(
      (a, b) =>
        a.priority - b.priority ||
        compare(a.subject_id || a.assignment_id || '', b.subject_id || b.assignment_id || '') ||
        compare(
          JSON.stringify([a.language, a.detail, a.hw, a.learn, a.test]),
          JSON.stringify([b.language, b.detail, b.hw, b.learn, b.test]),
        ),
    );
  const statuses = [...new Set(unique.map((d) => d.status))];
  return {
    id: first.section_id + '~' + first.diary_date,
    section_id: first.section_id,
    diary_date: first.diary_date,
    snapshot: first.snapshot,
    status: statuses.length === 1 ? statuses[0] : 'mixed',
    statuses,
    contributors: unique.map((d) => ({
      diary_id: d.id,
      teacher_id: d.teacher_id,
      teacher_name: d.snapshot.teacher_name,
      status: d.status,
      version: d.version,
      content_version: d.content_version || d.version,
      submitted_at: d.submitted_at,
    })),
    content: {
      diary_layout: 'homework_grid',
      homework_rows: orderedRows.map((row) => ({
        ...row,
        teacher_name: [...new Set(row.contributors.map((c) => c.teacher_name))].join(', '),
      })),
      consolidated: true,
    },
    entry_ids: unique.map((d) => d.id),
  };
}
export function groupClassDiaries(entries, priorities = []) {
  const groups = new Map();
  for (const d of entries.filter(isApprovedDiary)) {
    const key = JSON.stringify([d.snapshot.meta.class_id, d.section_id, d.diary_date]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(d);
  }
  return [...groups.values()]
    .map((group) => consolidateClassDiary(group, priorities))
    .sort(
      (a, b) =>
        b.diary_date.localeCompare(a.diary_date) ||
        a.snapshot.meta.class_name.localeCompare(b.snapshot.meta.class_name) ||
        a.snapshot.meta.section_name.localeCompare(b.snapshot.meta.section_name) ||
        a.id.localeCompare(b.id),
    );
}
export function matchesClassDiary(d, q) {
  const m = d.snapshot.meta;
  return !(
    (q.start && d.diary_date < q.start) ||
    (q.end && d.diary_date > q.end) ||
    (q.section && d.section_id !== q.section) ||
    (q.class && m.class_id !== q.class) ||
    (q.campus && m.campus_id !== q.campus) ||
    (q.branch && m.branch_id !== q.branch) ||
    (q.teacher && !d.contributors.some((c) => c.teacher_id === q.teacher)) ||
    (q.status &&
      !(q.status === 'pending'
        ? d.statuses.some((s) => ['submitted', 'resubmitted', 'under_review'].includes(s))
        : d.statuses.includes(q.status) || d.status === q.status)) ||
    (q.subject && !d.content.homework_rows.some((r) => r.subject_id === q.subject)) ||
    (q.search &&
      !d.content.homework_rows.some((r) =>
        [r.subject, r.detail].some((v) => String(v).toLowerCase().includes(q.search.toLowerCase())),
      ))
  );
}
