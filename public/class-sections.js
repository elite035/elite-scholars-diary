export const duplicateClassSectionMessage =
  'This class and section are already assigned to this campus.';
const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
export const academicNameKey = (value) => value.trim().toLowerCase();

// Shared by the form and API; the API additionally checks current database rows.
export function validateClassSections(input, catalog) {
  const parent_id = typeof input.parent_id === 'string' ? input.parent_id.trim() : '';
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!parent_id) fail('Select a parent Campus.');
  if (!name || name.length > 100) fail('Enter a Class name of 1–100 characters.');
  const sections =
    typeof input.sections === 'string'
      ? input.sections
          .split(/\r?\n/)
          .map((value) => value.trim())
          .filter(Boolean)
      : Array.isArray(input.sections)
        ? input.sections.map((value) => (typeof value === 'string' ? value.trim() : null))
        : [];
  if (!sections.length || sections.length > 50) fail('Enter 1–50 Section names, one per line.');
  if (sections.some((value) => !value || value.length > 100))
    fail('Each Section name must contain 1–100 characters.');
  if (new Set(sections.map(academicNameKey)).size !== sections.length)
    fail(duplicateClassSectionMessage, 409);
  if (catalog) {
    if (
      !catalog.nodes.some((node) => node.id === parent_id && node.kind === 'campus' && node.active)
    )
      fail('Select an active parent Campus.');
    const classes = catalog.academics.filter(
      (item) =>
        item.kind === 'class' &&
        academicNameKey(item.name) === academicNameKey(name) &&
        catalog.classCampuses.some(
          (link) => link.class_id === item.id && link.campus_id === parent_id,
        ),
    );
    if (
      catalog.academics.some(
        (item) =>
          item.kind === 'section' &&
          classes.some((klass) => klass.id === item.parent_id) &&
          sections.some((value) => academicNameKey(value) === academicNameKey(item.name)),
      )
    )
      fail(duplicateClassSectionMessage, 409);
  }
  return { parent_id, name, sections };
}
