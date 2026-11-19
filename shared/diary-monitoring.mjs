const submittedStates = new Set(['submitted', 'resubmitted', 'under_review', 'approved']);
const pendingStates = new Set(['submitted', 'resubmitted', 'under_review']);
// Internal staff read model. Official approvals remain the source of publication truth.
export function diaryMonitoring(
  slots,
  diaries,
  approvedIds,
  { actorId, capabilities = [], date, campus = '', timezone = 'UTC' } = {},
) {
  const byTeacherSection = new Map(diaries.map((d) => [d.teacher_id + ':' + d.section_id, d])),
    groups = new Map();
  for (const slot of slots) {
    if (!groups.has(slot.section_id))
      groups.set(slot.section_id, {
        section_id: slot.section_id,
        class_id: slot.class_id,
        class_name: slot.class_name,
        section_name: slot.section_name,
        campus_id: slot.campus_id,
        campus_name: slot.campus_name,
        teachers: [],
      });
    const group = groups.get(slot.section_id);
    if (group.teachers.some((teacher) => teacher.id === slot.teacher_id)) continue;
    const diary = byTeacherSection.get(slot.teacher_id + ':' + slot.section_id),
      approved = !!diary && approvedIds.has(diary.id),
      submitted = !!diary?.submitted_at && submittedStates.has(diary.status);
    const subjects = slot.subjects.map((name, index) => {
      const id = slot.subject_ids?.[index],
        entry = diary?.content.homework_rows.find((row) =>
          id ? row.subject_id === id : row.subject === name,
        );
      return {
        id: id || name,
        name,
        recorded: !!entry?.detail?.trim(),
        status: entry?.detail?.trim()
          ? approved
            ? 'approved'
            : diary.status === 'approved'
              ? 'approval_unverified'
              : diary.status
          : 'not_submitted',
      };
    });
    group.teachers.push({
      id: slot.teacher_id,
      name: slot.teacher_name,
      diary_id: diary?.id || null,
      version: diary?.version || null,
      status: diary?.status || 'not_submitted',
      submitted,
      approved,
      subjects,
      due_at: slot.due_at,
      overdue: slot.overdue,
      canApprove:
        !!diary &&
        pendingStates.has(diary.status) &&
        diary.teacher_id !== actorId &&
        capabilities.includes('diary.approve'),
    });
  }
  const all = [...groups.values()].sort(
    (a, b) =>
      String(a.class_name).localeCompare(String(b.class_name), undefined, { numeric: true }) ||
      String(a.section_name).localeCompare(String(b.section_name)) ||
      a.section_id.localeCompare(b.section_id),
  );
  const campuses = [
    ...new Map(
      all.map((row) => [
        row.campus_id || '',
        { id: row.campus_id || '', name: row.campus_name || 'Unassigned campus' },
      ]),
    ).values(),
  ];
  const rows = all
    .filter((row) => !campus || row.campus_id === campus)
    .map((row) => {
      const expected = row.teachers.length,
        submitted = row.teachers.filter((t) => t.submitted).length,
        approved = row.teachers.filter((t) => t.approved).length,
        subjects = row.teachers.flatMap((t) =>
          t.subjects.map((subject) => ({
            ...subject,
            teacher_id: t.id,
            teacher_name: t.name,
            diary_id: t.diary_id,
          })),
        ),
        pending = row.teachers
          .filter((t) => t.canApprove)
          .map((t) => ({ id: t.diary_id, version: t.version })),
        missing = row.teachers.filter((t) => !t.submitted);
      return {
        ...row,
        expected,
        submitted,
        approved,
        percentage: expected ? Math.round((submitted / expected) * 100) : 0,
        complete:
          expected > 0 &&
          approved === expected &&
          subjects.every((subject) => subject.status === 'approved'),
        subjects,
        pending,
        missingTeachers: missing.length,
        hasPublishedContent: approved > 0,
      };
    });
  const deadlines = rows
    .flatMap((row) => row.teachers.map((teacher) => teacher.due_at))
    .filter(Boolean)
    .sort();
  return {
    date,
    campus,
    timeZone: timezone,
    campuses,
    rows,
    cutoff: deadlines[0] || null,
    canRemind: capabilities.includes('notifications.manage'),
    refreshedAt: new Date().toISOString(),
  };
}
