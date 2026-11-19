const conflict = () => {
  throw Object.assign(Error('Settings changed. Reload before saving.'), { status: 409 });
};
export function assertSettingsVersion(expected, current) {
  if (expected === undefined) return; // Compatible with existing API clients.
  if (!Number.isInteger(expected) || expected < 1)
    throw Object.assign(Error('Invalid settings version'), { status: 400 });
  if (expected !== current.templateVersion) conflict();
}
export function preserveSettingsLinks(proposed, current, expected) {
  if (current.templateVersion !== expected) conflict();
  return {
    ...proposed,
    teacherCampusAssignments: current.teacherCampusAssignments || {},
    ...(current.diaryNotice !== undefined ? { diaryNotice: current.diaryNotice } : {}),
    ...(current.diaryNotices !== undefined ? { diaryNotices: current.diaryNotices } : {}),
    ...(current.assignmentSessionId !== undefined
      ? { assignmentSessionId: current.assignmentSessionId }
      : {}),
  };
}
