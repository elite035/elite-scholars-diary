// Use the saved section curriculum, never the school's entire subject catalog.
export function assignmentChoices(catalog, teacherId) {
  const campusId =
    teacherId === undefined
      ? undefined
      : catalog.teacherCampuses?.find((x) => x.teacher_id === teacherId)?.campus_id;
  const academics = new Map(catalog.academics.map((x) => [x.id, x])),
    nodes = new Map(catalog.nodes.map((x) => [x.id, x]));
  const classes = catalog.academics
    .filter((x) => {
      if (x.kind !== 'class' || !x.active) return false;
      const campus = nodes.get(catalog.classCampuses.find((m) => m.class_id === x.id)?.campus_id);
      return (
        (teacherId === undefined || campusId === campus?.id) &&
        campus?.active &&
        (!campus.parent_id || nodes.get(campus.parent_id)?.active)
      );
    })
    .map((x) => ({
      ...x,
      campus_name: nodes.get(catalog.classCampuses.find((m) => m.class_id === x.id)?.campus_id)
        ?.name,
    }));
  const classIds = new Set(classes.map((x) => x.id)),
    seen = new Set();
  const pairs = catalog.sectionSubjects.flatMap((x) => {
    const section = academics.get(x.section_id),
      subject = academics.get(x.subject_id),
      klass = academics.get(section?.parent_id),
      id = x.section_id + ':' + x.subject_id;
    if (
      !section?.active ||
      subject?.active === 0 ||
      subject?.active === false ||
      subject?.kind !== 'subject' ||
      !classIds.has(klass?.id) ||
      seen.has(id)
    )
      return [];
    seen.add(id);
    const campus = classes.find((c) => c.id === klass.id).campus_name;
    return [
      {
        id,
        class_id: klass.id,
        name: campus + ' · ' + klass.name + ' / ' + section.name + ' — ' + subject.name,
      },
    ];
  });
  return {
    classes: classes.map((c) => ({ id: c.id, name: c.campus_name + ' · ' + c.name })),
    pairs,
  };
}
export function mountAssignmentSubjects(form, catalog, { checks }) {
  let pairs = [];
  const teacher = form.querySelector('[name=teacher_id]'),
    classContainer = form.querySelector('[data-assignment-classes]');
  const container = form.querySelector('[data-assignment-subjects]'),
    selected = new Set();
  function teacherChanged() {
    selected.clear();
    const choices = assignmentChoices(catalog, teacher.value);
    pairs = choices.pairs;
    const assigned = catalog.teacherCampuses?.some((x) => x.teacher_id === teacher.value);
    classContainer.innerHTML = !teacher.value
      ? '<p class="muted">Select a teacher to see their campus classes.</p>'
      : !assigned
        ? '<p class="muted" role="status">This teacher has no campus assignment. Assign a campus before adding teaching responsibilities.</p>'
        : choices.classes.length
          ? checks('assignment_classes', choices.classes)
          : '<p class="muted" role="status">No active classes are available in this teacher’s assigned campus.</p>';
    draw();
  }
  function draw() {
    const classes = new Set(
      [...form.querySelectorAll('input[name=assignment_classes]')]
        .filter((x) => x.checked)
        .map((x) => x.value),
    );
    const available = pairs.filter((x) => classes.has(x.class_id)),
      ids = new Set(available.map((x) => x.id));
    for (const id of selected) if (!ids.has(id)) selected.delete(id);
    container.innerHTML = classes.size
      ? checks('pairs', available, [...selected])
      : '<p class="muted">Select one or more classes above to see their assigned subjects and sections.</p>';
    for (const box of container.querySelectorAll('input[name=pairs]'))
      box.checked = selected.has(box.value);
  }
  form.addEventListener('change', (event) => {
    if (event.target.name === 'teacher_id') teacherChanged();
    if (event.target.name === 'pairs') {
      if (event.target.checked) selected.add(event.target.value);
      else selected.delete(event.target.value);
    }
    if (event.target.name === 'assignment_classes') draw();
  });
  teacherChanged();
  return {
    pairs() {
      const visible = new Set(
        [...form.querySelectorAll('input[name=pairs]')]
          .filter((x) => x.checked)
          .map((x) => x.value),
      );
      return pairs
        .filter((x) => visible.has(x.id))
        .map((x) => {
          const [section_id, subject_id] = x.id.split(':');
          return { section_id, subject_id };
        });
    },
  };
}
