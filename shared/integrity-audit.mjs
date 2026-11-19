// Read-only diagnostics. Conflicting historical records are never merged or deleted.
export async function integrityAudit(db) {
  const checks = {
    duplicateActiveAssignments:
      'SELECT COUNT(*) n FROM (SELECT teacher_id,section_id,subject_id,session_id FROM assignments WHERE active=1 GROUP BY teacher_id,section_id,subject_id,session_id HAVING COUNT(*)>1) conflicts',
    duplicateSubjectNames:
      "SELECT COUNT(*) n FROM (SELECT LOWER(TRIM(name)) FROM academics WHERE kind='subject' AND active=1 GROUP BY LOWER(TRIM(name)) HAVING COUNT(*)>1) conflicts",
    duplicateCampusClasses:
      'SELECT COUNT(*) n FROM (SELECT cc.campus_id,LOWER(TRIM(a.name)) FROM class_campuses cc JOIN academics a ON a.id=cc.class_id WHERE a.active=1 GROUP BY cc.campus_id,LOWER(TRIM(a.name)) HAVING COUNT(*)>1) conflicts',
    duplicateSectionNames:
      "SELECT COUNT(*) n FROM (SELECT parent_id,LOWER(TRIM(name)) FROM academics WHERE kind='section' AND active=1 GROUP BY parent_id,LOWER(TRIM(name)) HAVING COUNT(*)>1) conflicts",
    incompatibleSectionSubjects:
      "SELECT COUNT(*) n FROM section_subjects ss JOIN academics sec ON sec.id=ss.section_id JOIN academics sub ON sub.id=ss.subject_id WHERE sec.kind<>'section' OR sub.kind<>'subject'",
    incompatibleReviewers:
      "SELECT COUNT(*) n FROM teacher_reviewers r JOIN users t ON t.id=r.teacher_id JOIN users h ON h.id=r.head_id WHERE t.role<>'teacher' OR h.role<>'head_teacher'",
  };
  const result = {};
  for (const [name, sql] of Object.entries(checks)) result[name] = Number((await db.one(sql)).n);
  return result;
}
