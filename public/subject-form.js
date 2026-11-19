import { subjectPriority } from './subject-priority.js';
export const duplicateSubjectMessage =
  'A subject with this name already exists. Edit that subject to manage its assignments.';
const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};

export function subjectAssignments(catalog, subjectId) {
  const sectionIds = new Set(
    (catalog.sectionSubjects || [])
      .filter((x) => x.subject_id === subjectId)
      .map((x) => x.section_id),
  );
  const sections = catalog.academics.filter((x) => x.kind === 'section' && sectionIds.has(x.id));
  const classIds = new Set([
    ...(catalog.classSubjects || [])
      .filter((x) => x.subject_id === subjectId)
      .map((x) => x.class_id),
    ...sections.map((x) => x.parent_id),
  ]);
  const classes = catalog.academics.filter((x) => x.kind === 'class' && classIds.has(x.id));
  const campusIds = new Set(
    catalog.classCampuses.filter((x) => classIds.has(x.class_id)).map((x) => x.campus_id),
  );
  return {
    sections,
    classes,
    campuses: catalog.nodes.filter((x) => x.kind === 'campus' && campusIds.has(x.id)),
  };
}
export function campusClasses(catalog, campusId, retainedIds = []) {
  const retained = new Set(retainedIds),
    campusActive = catalog.nodes.some((x) => x.id === campusId && x.kind === 'campus' && x.active);
  return catalog.academics
    .filter(
      (x) =>
        x.kind === 'class' &&
        catalog.classCampuses.some((c) => c.class_id === x.id && c.campus_id === campusId),
    )
    .map((x) => ({
      ...x,
      sections: catalog.academics.filter(
        (s) =>
          s.kind === 'section' &&
          s.parent_id === x.id &&
          ((campusActive && x.active && s.active) || retained.has(s.id)),
      ),
    }))
    .filter((x) => (campusActive && x.active) || x.sections.length);
}
export function selectionState(ids, selected) {
  const count = ids.filter((id) => selected.has(id)).length;
  return {
    checked: ids.length > 0 && count === ids.length,
    indeterminate: count > 0 && count < ids.length,
  };
}
export function toggleSelection(selected, ids, checked) {
  for (const id of ids) {
    if (checked) selected.add(id);
    else selected.delete(id);
  }
}
export function validateSubjectAssignments(input, catalog, { subjectId, editing = false } = {}) {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 100) fail('Enter a Subject Name with 1–100 characters.');
  if (input.priority === undefined) fail('Subject Priority is required.');
  const priority = subjectPriority(input.priority);
  if (!editing && (typeof input.campus_id !== 'string' || !input.campus_id))
    fail('Select a Campus.');
  if (
    !Array.isArray(input.section_ids) ||
    (!editing && !input.section_ids.length) ||
    input.section_ids.length > 1000 ||
    input.section_ids.some((x) => typeof x !== 'string' || !x)
  )
    fail('Select at least one class or section (up to 1,000 sections).');
  if (new Set(input.section_ids).size !== input.section_ids.length)
    fail('The same section cannot be assigned more than once.', 409);
  if (catalog) {
    if (
      !editing &&
      !catalog.nodes.some((x) => x.id === input.campus_id && x.kind === 'campus' && x.active)
    )
      fail('Select an active Campus.');
    const retained = editing
      ? subjectAssignments(catalog, subjectId).sections.map((x) => x.id)
      : [];
    const available = new Set(
      (editing
        ? catalog.nodes
            .filter((x) => x.kind === 'campus')
            .flatMap((x) => campusClasses(catalog, x.id, retained))
        : campusClasses(catalog, input.campus_id)
      ).flatMap((x) => x.sections.map((s) => s.id)),
    );
    if (input.section_ids.some((id) => !available.has(id)))
      fail('Choose active classes and sections belonging to the selected Campus.');
    if (
      catalog.academics.some(
        (x) =>
          x.kind === 'subject' &&
          x.id !== subjectId &&
          x.name.trim().toLowerCase() === name.toLowerCase(),
      )
    )
      fail(duplicateSubjectMessage, 409);
  }
  return {
    priority,
    name,
    ...(!editing ? { campus_id: input.campus_id } : {}),
    section_ids: [...input.section_ids],
  };
}

// Checkbox state lives independently of expansion; hiding rows never changes assignments.
export function mountSubjectTree(form, catalog, esc, { sectionIds = [], editing = false } = {}) {
  const campus = form.querySelector('[name=campus_id]'),
    tree = form.querySelector('[data-subject-tree]');
  const selected = new Set(sectionIds),
    collapsed = new Set();
  let classes = [];
  const idsFor = (classId) =>
    classes.filter((c) => !classId || c.id === classId).flatMap((c) => c.sections.map((s) => s.id));
  function sync() {
    for (const box of tree.querySelectorAll('input')) {
      if (box.dataset.section) box.checked = selected.has(box.dataset.section);
      else Object.assign(box, selectionState(idsFor(box.dataset.class), selected));
    }
    form.querySelector('[data-subject-count]').textContent =
      `${selected.size} section${selected.size === 1 ? '' : 's'} selected${editing ? ' across saved campuses' : ''}`;
  }
  function draw() {
    if (!editing) selected.clear();
    collapsed.clear();
    classes = campusClasses(catalog, campus.value, sectionIds);
    const node = catalog.nodes.find(
      (x) => x.id === campus.value && x.kind === 'campus' && (x.active || editing),
    );
    tree.innerHTML = !node
      ? '<p class="muted">Select a campus to see its classes and sections.</p>'
      : `<label class="subject-campus checkbox"><input type="checkbox" data-campus ${idsFor().length ? '' : 'disabled'}>${esc(node.name)} <small>Select all</small></label>` +
        (classes.length
          ? classes
              .map(
                (c, i) =>
                  `<div class="subject-class"><div class="subject-class-heading"><button type="button" data-expand="${esc(c.id)}" aria-expanded="true" aria-controls="subject-sections-${i}" aria-label="Collapse ${esc(c.name)}">−</button><label class="checkbox"><input type="checkbox" data-class="${esc(c.id)}" ${c.sections.length ? '' : 'disabled'}>${esc(c.name)}</label></div><div id="subject-sections-${i}" class="subject-sections">${c.sections.map((s) => `<label class="checkbox"><input type="checkbox" data-section="${esc(s.id)}">${esc(s.name)}</label>`).join('') || '<p class="muted">No active sections available.</p>'}</div></div>`,
              )
              .join('')
          : '<p class="muted">No active classes or sections available in this campus.</p>');
    sync();
  }
  campus.addEventListener('change', draw);
  tree.addEventListener('change', (event) => {
    const box = event.target;
    if (box.dataset.section) toggleSelection(selected, [box.dataset.section], box.checked);
    else if (box.matches('input'))
      toggleSelection(selected, idsFor(box.dataset.class), box.checked);
    sync();
  });
  tree.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-expand]');
    if (!button) return;
    const id = button.dataset.expand,
      closed = !collapsed.has(id);
    if (closed) collapsed.add(id);
    else collapsed.delete(id);
    button.setAttribute('aria-expanded', String(!closed));
    button.setAttribute(
      'aria-label',
      `${closed ? 'Expand' : 'Collapse'} ${classes.find((c) => c.id === id).name}`,
    );
    button.textContent = closed ? '+' : '−';
    form.querySelector('#' + button.getAttribute('aria-controls')).hidden = closed;
  });
  draw();
  return () => [...selected];
}
