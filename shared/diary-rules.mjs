export function assignedHomework(content, assignments, a, old, check) {
  if (content.diary_layout !== 'homework_grid') return;
  const permitted = assignments.filter(
    (x) =>
      x.teacher_id === a.teacher_id &&
      x.section_id === a.section_id &&
      x.head_id === a.head_id &&
      x.session_id === a.session_id &&
      x.active,
  );
  content.homework_rows = content.homework_rows.filter((row) => {
    const match = permitted.find(
      (x) => x.subject_name.trim().toLowerCase() === row.subject.toLowerCase(),
    );
    if (!match) {
      const legacy = old?.content?.homework_rows?.some(
        (r) =>
          r.subject === row.subject &&
          r.detail === row.detail &&
          !!r.hw === row.hw &&
          !!r.learn === row.learn &&
          !!r.test === row.test,
      );
      check(
        !row.detail || legacy,
        'You may enter homework only for your assigned class subjects',
        403,
      );
      return !!legacy;
    }
    row.subject_id = match.subject_id;
    row.teacher_id = a.teacher_id;
    row.teacher_name = a.teacher_name;
    return true;
  });
}
