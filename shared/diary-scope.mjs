// A fresh predicate per operation: no cross-request cache of authorization state.
export async function createDiaryScope(db, user, { readAll = false, reviewers } = {}) {
  if (
    ['super_admin', 'school_admin'].includes(user.role) ||
    (['coordinator', 'head_teacher'].includes(user.role) && readAll)
  )
    return () => true;
  if (!['coordinator', 'head_teacher'].includes(user.role))
    return (diary) => diary.teacher_id === user.id;
  const heads =
    reviewers ||
    new Map(
      (
        await db.all(
          "SELECT r.teacher_id,r.head_id FROM teacher_reviewers r JOIN users h ON h.id=r.head_id WHERE h.active=1 AND h.role='head_teacher'",
        )
      ).map((row) => [row.teacher_id, row]),
    );
  const permitted =
    user.role === 'head_teacher'
      ? new Set([user.id])
      : new Set(
          (
            await db.all('SELECT head_id FROM coordinator_heads WHERE coordinator_id=?', user.id)
          ).map((row) => row.head_id),
        );
  return (diary) =>
    diary.teacher_id === user.id || permitted.has(heads.get(diary.teacher_id)?.head_id);
}
