// School structure workspace: setup checklist, structure tree, subjects-by-class grid and a
// Quick Setup wizard that creates branches, campuses, classes, sections, subjects and the session in bulk.
const key = (value) => String(value ?? '').trim().toLowerCase();
export const CLASS_PRESETS = {
  'Early years': ['Playgroup', 'Nursery', 'Prep'],
  Primary: ['Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5'],
  Secondary: ['Class 6', 'Class 7', 'Class 8', 'Class 9', 'Class 10'],
};
export const SECTION_PRESETS = [
  ['A, B', ['A', 'B']],
  ['A, B, C', ['A', 'B', 'C']],
  ['Green, Blue, Red', ['Green', 'Blue', 'Red']],
];
export const SUBJECT_PRESETS = [
  'English',
  'Urdu',
  'Mathematics',
  'Science',
  'Islamiat',
  'Social Studies',
  'Computer',
  'General Knowledge',
  'Drawing',
  'Nazra / Quran',
  'Pak Studies',
  'Physics',
  'Chemistry',
  'Biology',
];
const EARLY = ['playgroup', 'play group', 'nursery', 'kg', 'prep', 'prep 1', 'prep 2'];
export const classRank = (name) => {
  const n = key(name),
    early = EARLY.indexOf(n);
  if (early >= 0) return [0, early, ''];
  const num = /(\d+)/.exec(n);
  return num ? [1, Number(num[1]), n] : [2, 0, n];
};
export const compareClasses = (a, b) => {
  const x = classRank(a),
    y = classRank(b);
  return x[0] - y[0] || x[1] - y[1] || x[2].localeCompare(y[2]);
};
export const parseList = (text) => {
  const seen = new Set();
  return String(text ?? '')
    .split(/[\r\n,]+/)
    .map((x) => x.trim().replace(/\s+/g, ' '))
    .filter((x) => x && !seen.has(key(x)) && seen.add(key(x)));
};
// Pakistani academic year: April to March.
export function sessionDefaults(today) {
  const year = Number(today.slice(0, 4)),
    month = Number(today.slice(5, 7)),
    start = month >= 4 ? year : year - 1;
  return {
    name: `${start}–${String(start + 1).slice(2)}`,
    start_date: `${start}-04-01`,
    end_date: `${start + 1}-03-31`,
  };
}
// Works out exactly what the wizard will create and what already exists (nothing is duplicated).
export function planSetup(catalog, input) {
  const nodes = catalog.nodes || [],
    academics = catalog.academics || [],
    links = catalog.classCampuses || [],
    sectionSubjects = catalog.sectionSubjects || [];
  const branch = nodes.find((n) => n.kind === 'branch' && n.id === input.branchId) ||
      nodes.find((n) => n.kind === 'branch' && key(n.name) === key(input.branchName)),
    campus =
      nodes.find((n) => n.kind === 'campus' && n.id === input.campusId) ||
      nodes.find(
        (n) =>
          n.kind === 'campus' &&
          key(n.name) === key(input.campusName) &&
          (!branch || n.parent_id === branch.id),
      );
  const classes = (input.classes || []).map((name) => {
    const found = campus
      ? academics.find(
          (a) =>
            a.kind === 'class' &&
            key(a.name) === key(name) &&
            links.some((l) => l.class_id === a.id && l.campus_id === campus.id),
        )
      : null;
    const existing = found
      ? academics.filter((a) => a.kind === 'section' && a.parent_id === found.id)
      : [];
    const missing = (input.sections || []).filter(
      (s) => !existing.some((e) => key(e.name) === key(s)),
    );
    return {
      name,
      id: found?.id || null,
      create: !found,
      blocked: !!found && !found.active,
      existing: existing.filter((e) => e.active),
      missing: found && !found.active ? [] : missing,
    };
  });
  const subjects = (input.subjects || []).map((name) => {
    const found = academics.find((a) => a.kind === 'subject' && key(a.name) === key(name));
    return { name, id: found?.id || null, create: !found, inactive: !!found && !found.active };
  });
  const targets = new Set((input.subjectClasses || input.classes || []).map(key));
  const targetClasses = classes.filter((c) => targets.has(key(c.name)) && !c.blocked);
  const sectionCount = targetClasses.reduce((n, c) => n + c.existing.length + c.missing.length, 0);
  let linkCount = 0;
  for (const c of targetClasses)
    for (const s of c.existing)
      for (const subject of subjects)
        if (!subject.id || !sectionSubjects.some((x) => x.section_id === s.id && x.subject_id === subject.id))
          linkCount++;
  for (const c of targetClasses) linkCount += c.missing.length * subjects.length;
  return {
    branch: { id: branch?.id || null, name: input.branchName, create: !branch },
    campus: { id: campus?.id || null, name: input.campusName, create: !campus },
    classes,
    subjects,
    newClasses: classes.filter((c) => c.create).length,
    newSections: classes.reduce((n, c) => n + c.missing.length, 0),
    newSubjects: subjects.filter((s) => s.create).length,
    sectionCount,
    linkCount,
    blocked: classes.filter((c) => c.blocked).map((c) => c.name),
  };
}
// Subjects of a class are the union of its sections' subjects; state is all / some / none.
export function cellState(catalog, classId, subjectId) {
  const sections = (catalog.academics || []).filter(
    (a) => a.kind === 'section' && a.parent_id === classId && a.active,
  );
  if (!sections.length) return 'none';
  const hits = sections.filter((s) =>
    (catalog.sectionSubjects || []).some((x) => x.section_id === s.id && x.subject_id === subjectId),
  ).length;
  return hits === sections.length ? 'all' : hits ? 'some' : 'none';
}

export function structureWorkspace(ctx) {
  const { api, state, esc, button, card, heading, toast, modal, render, has, today, reload } = ctx;
  const $ = (s, r = document) => r.querySelector(s),
    $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const S = () => state.schoolConfig;
  const manage = () => has('structure.manage');
  const tabs = (active) => {
    const items = [
      ['', 'Overview'],
      ['setup', 'Quick setup'],
      ['branch', 'Branches'],
      ['campus', 'Campuses'],
      ['class', 'Classes and Sections'],
      ['subject', 'Subjects'],
      ['session', 'Academic sessions'],
    ];
    return `<nav class="ss-tabs" aria-label="School structure sections">${items
      .map(
        ([k, label]) =>
          `<a class="${k === active ? 'on' : ''}" href="#/academics${k ? '?kind=' + k : ''}">${esc(label)}</a>`,
      )
      .join('')}</nav>`;
  };
  const sectionsOf = (classId) =>
    S().academics.filter((a) => a.kind === 'section' && a.parent_id === classId);
  const subjectIdsOf = (sectionId) =>
    S().sectionSubjects.filter((x) => x.section_id === sectionId).map((x) => x.subject_id);
  const activeSubjects = () =>
    S()
      .academics.filter((a) => a.kind === 'subject' && a.active)
      .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0) || a.name.localeCompare(b.name));
  const campusOfClass = (classId) => S().classCampuses.find((l) => l.class_id === classId)?.campus_id;
  const classesOf = (campusId) =>
    S()
      .academics.filter((a) => a.kind === 'class' && campusOfClass(a.id) === campusId)
      
      .sort((a, b) => compareClasses(a.name, b.name));

  // ---------- checklist ----------
  function checklist() {
    const s = S(),
      branches = s.nodes.filter((n) => n.kind === 'branch' && n.active),
      campuses = s.nodes.filter((n) => n.kind === 'campus' && n.active),
      classes = s.academics.filter((a) => a.kind === 'class' && a.active),
      sections = s.academics.filter((a) => a.kind === 'section' && a.active),
      subjects = activeSubjects(),
      covered = sections.filter((x) => subjectIdsOf(x.id).length).length,
      day = today(),
      sessions = s.academics.filter((a) => a.kind === 'session' && a.active),
      live = sessions.find((x) => x.start_date <= day && x.end_date >= day);
    return [
      { ok: branches.length > 0, label: 'Branch', note: `${branches.length} active`, step: 1 },
      { ok: campuses.length > 0, label: 'Campus', note: `${campuses.length} active`, step: 1 },
      { ok: sections.length > 0, label: 'Classes and sections', note: `${classes.length} classes · ${sections.length} sections`, step: 2 },
      { ok: subjects.length > 0, label: 'Subjects', note: `${subjects.length} subjects`, step: 3 },
      { ok: sections.length > 0 && covered === sections.length, label: 'Subjects assigned to every section', note: `${covered} of ${sections.length} sections`, step: 3 },
      { ok: !!live, label: 'Current academic session', note: live ? live.name : 'None covers today', step: 4 },
    ];
  }

  // ---------- overview ----------
  function overview(q) {
    const s = S(),
      items = checklist(),
      next = items.find((x) => !x.ok),
      done = items.filter((x) => x.ok).length,
      can = manage();
    const progress = `<section class="ss-progress ${next ? '' : 'complete'}"><div class="ss-progress-head"><div><strong>${next ? 'Finish setting up your school' : 'Your school structure is complete'}</strong><p>${next ? `Next: ${esc(next.label)}. The Quick setup wizard creates everything in one go.` : 'Teachers can now be assigned to sections and write diaries.'}</p></div>${
      next && can
        ? `<a class="button primary" href="#/academics?kind=setup&step=${next.step}">Continue setup</a>`
        : ''
    }</div><progress class="ss-bar" max="${items.length}" value="${done}">${done} of ${items.length} steps done</progress><ul class="ss-check">${items
      .map(
        (x) =>
          `<li class="${x.ok ? 'ok' : ''}"><i aria-hidden="true">${x.ok ? '✓' : ''}</i><span>${esc(x.label)}</span><small>${esc(x.note)}</small></li>`,
      )
      .join('')}</ul></section>`;
    const campuses = s.nodes.filter((n) => n.kind === 'campus'),
      branches = s.nodes.filter((n) => n.kind === 'branch');
    const tree = branches.length
      ? branches
          .map((b) => {
            const own = campuses.filter((c) => c.parent_id === b.id);
            return `<section class="ss-branch ${b.active ? '' : 'off'}"><header><div><span class="ss-kind">Branch</span><h3>${esc(b.name)}</h3></div><div class="actions">${
              has('structure.edit') ? button('Edit', 'school-edit-structure', 'small', `data-id="${b.id}"`) : ''
            }${can ? `<a class="button small" href="#/academics?kind=setup&step=1&branch=${b.id}">＋ Campus</a>` : ''}</div></header>${
              own.length
                ? own.map((c) => campusBlock(c, can)).join('')
                : '<p class="muted">No campus yet.</p>'
            }</section>`;
          })
          .join('')
      : `<div class="ss-empty"><strong>No branch yet</strong><p>Start with Quick setup. It creates the branch, campus, classes, sections and subjects together.</p>${can ? '<a class="button primary" href="#/academics?kind=setup">Start Quick setup</a>' : ''}</div>`;
    return (
      progress +
      `<h2 class="ss-h">Structure</h2><div class="ss-tree">${tree}</div>` +
      matrix(q, can)
    );
  }
  function campusBlock(c, can) {
    const classes = classesOf(c.id);
    return `<div class="ss-campus ${c.active ? '' : 'off'}"><header><div><span class="ss-kind">Campus</span><h4>${esc(c.name)}</h4></div><div class="actions">${
      has('structure.edit') ? button('Edit', 'school-edit-structure', 'small', `data-id="${c.id}"`) : ''
    }${can ? `<a class="button small" href="#/academics?kind=setup&step=2&campus=${c.id}">＋ Classes</a>` : ''}</div></header>${
      classes.length
        ? `<div class="ss-classes">${classes.map((k) => classCard(k, c, can)).join('')}</div>`
        : '<p class="muted">No classes yet.</p>'
    }</div>`;
  }
  function classCard(k, campus, can) {
    const sections = sectionsOf(k.id).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
      subjects = new Set(sections.flatMap((x) => subjectIdsOf(x.id)));
    return `<article class="ss-class ${k.active ? '' : 'off'}"><header><strong>${esc(k.name)}</strong><span>${sections.length} section${sections.length === 1 ? '' : 's'} · ${subjects.size} subject${subjects.size === 1 ? '' : 's'}</span>${
      has('structure.edit') ? button('Edit', 'school-edit-structure', 'small ghost', `data-id="${k.id}"`) : ''
    }</header><div class="ss-sections">${sections
      .map(
        (x) =>
          `<button type="button" class="ss-chip ${x.active ? '' : 'off'}" data-action="ss-section" data-id="${x.id}">${esc(x.name)}<small>${subjectIdsOf(x.id).length}</small></button>`,
      )
      .join('')}${can && k.active ? `<button type="button" class="ss-chip add" data-action="ss-add-sections" data-class="${k.id}" data-campus="${campus.id}">＋ Section</button>` : ''}</div></article>`;
  }

  // ---------- subjects by class grid ----------
  function matrix(q, can) {
    const s = S(),
      campuses = s.nodes.filter((n) => n.kind === 'campus' && n.active && classesOf(n.id).some((k) => k.active));
    if (!campuses.length || !activeSubjects().length)
      return `<h2 class="ss-h">Subjects by class</h2><div class="ss-empty"><strong>Nothing to assign yet</strong><p>Add classes and subjects with Quick setup, then tick which class studies which subject.</p></div>`;
    const campus = campuses.find((c) => c.id === q.campus) || campuses[0],
      classes = classesOf(campus.id).filter((k) => k.active),
      subjects = activeSubjects();
    const picker =
      campuses.length > 1
        ? `<label class="ss-campus-pick">Campus<select id="ss-campus-pick">${campuses
            .map((c) => `<option value="${c.id}" ${c.id === campus.id ? 'selected' : ''}>${esc(c.name)}</option>`)
            .join('')}</select></label>`
        : '';
    const head = `<tr><th class="sticky">Subject</th>${classes.map((k) => `<th>${esc(k.name)}</th>`).join('')}</tr>`;
    const body = subjects
      .map(
        (sub) =>
          `<tr><th class="sticky"><span>${esc(sub.name)}</span>${can ? `<button type="button" class="ss-all" data-action="ss-row" data-subject="${sub.id}" data-campus="${campus.id}" title="Toggle for every class">all</button>` : ''}</th>${classes
            .map((k) => {
              const st = cellState(s, k.id, sub.id);
              return `<td><button type="button" class="ss-cell ${st}" ${can ? `data-action="ss-cell" data-class="${k.id}" data-subject="${sub.id}"` : 'disabled'} aria-label="${esc(sub.name)} in ${esc(k.name)}: ${st === 'all' ? 'assigned' : st === 'some' ? 'some sections' : 'not assigned'}">${st === 'all' ? '✓' : st === 'some' ? '–' : ''}</button></td>`;
            })
            .join('')}</tr>`,
      )
      .join('');
    return `<h2 class="ss-h">Subjects by class</h2><section class="ss-matrix"><div class="ss-matrix-head"><p>${can ? 'Tap a box to give a subject to every section of that class. “–” means only some sections have it.' : 'Subjects taught in each class.'}</p>${picker}</div><div class="ss-scroll"><table><thead>${head}</thead><tbody>${body}</tbody></table></div></section>`;
  }
  async function toggleCells(pairs, on) {
    // pairs: [{section, subject}], on: add or remove
    const jobs = new Map();
    for (const { section, subject } of pairs) {
      const set = jobs.get(section) || new Set(subjectIdsOf(section));
      if (on) set.add(subject);
      else set.delete(subject);
      jobs.set(section, set);
    }
    let failed = 0,
      lastError = '';
    for (const [section, set] of jobs) {
      const before = subjectIdsOf(section);
      if (before.length === set.size && before.every((x) => set.has(x))) continue;
      try {
        await api('/api/school/curriculum', { method: 'PUT', body: { section_id: section, subject_ids: [...set] } });
      } catch (error) {
        failed++;
        lastError = error.message;
      }
    }
    await reload();
    await render();
    if (failed) toast(`${failed} section${failed === 1 ? '' : 's'} not changed: ${lastError}`);
  }

  // ---------- section dialog ----------
  function sectionDialog(sectionId) {
    const s = S(),
      section = s.academics.find((a) => a.id === sectionId),
      klass = s.academics.find((a) => a.id === section.parent_id),
      subjects = activeSubjects(),
      chosen = new Set(subjectIdsOf(sectionId)),
      others = s.academics.filter(
        (a) => a.kind === 'section' && a.id !== sectionId && a.active && campusOfClass(a.parent_id) === campusOfClass(klass.id),
      );
    const body = `<p class="muted">Tick the subjects taught in <strong>${esc(klass.name)} / ${esc(section.name)}</strong>.</p><div class="ss-toolbar"><button type="button" class="small" data-ss-all="1">Select all</button><button type="button" class="small" data-ss-all="0">Clear</button>${
      others.length
        ? `<label>Copy from<select data-ss-copy><option value="">Choose a section</option>${others
            .map((o) => `<option value="${o.id}">${esc(s.academics.find((a) => a.id === o.parent_id)?.name || '')} / ${esc(o.name)}</option>`)
            .join('')}</select></label>`
        : ''
    }</div><div class="ss-checks">${subjects
      .map(
        (sub) =>
          `<label class="checkbox chip-check"><input type="checkbox" name="subject" value="${sub.id}" ${chosen.has(sub.id) ? 'checked' : ''}><span>${esc(sub.name)}</span></label>`,
      )
      .join('')}</div>${subjects.length ? '' : '<p class="muted">No subjects yet. Create them in Quick setup.</p>'}`;
    modal(`${klass.name} / ${section.name}`, body, async (_data, form) => {
      const ids = $$('input[name=subject]:checked', form).map((x) => x.value);
      await api('/api/school/curriculum', { method: 'PUT', body: { section_id: sectionId, subject_ids: ids } });
      await reload();
      toast('Subjects saved for this section.');
    });
    const form = $('#modal-form');
    form.addEventListener('click', (event) => {
      const all = event.target.closest('[data-ss-all]');
      if (all) $$('input[name=subject]', form).forEach((x) => (x.checked = all.dataset.ssAll === '1'));
    });
    form.addEventListener('change', (event) => {
      if (!event.target.matches('[data-ss-copy]') || !event.target.value) return;
      const from = new Set(subjectIdsOf(event.target.value));
      $$('input[name=subject]', form).forEach((x) => (x.checked = from.has(x.value)));
    });
  }
  function addSectionsDialog(classId, campusId) {
    const s = S(),
      klass = s.academics.find((a) => a.id === classId),
      existing = sectionsOf(classId).map((x) => x.name);
    const body = `<p class="muted">Adds new sections to <strong>${esc(klass.name)}</strong>${existing.length ? ` (existing: ${esc(existing.join(', '))})` : ''}.</p><label class="field">New section names<input name="names" placeholder="C, D" required></label><p class="muted">Separate several sections with commas.</p>`;
    modal('Add sections', body, async (data) => {
      const names = parseList(data.names).filter((n) => !existing.some((e) => key(e) === key(n)));
      if (!names.length) throw new Error('Those sections already exist.');
      await api('/api/school/structure', { method: 'POST', body: { kind: 'class_sections', parent_id: campusId, name: klass.name, sections: names } });
      await reload();
      toast(`${names.length} section${names.length === 1 ? '' : 's'} added.`);
    });
  }

  // ---------- quick setup wizard ----------
  let wiz = null;
  const stepNames = ['School', 'Classes and sections', 'Subjects', 'Session', 'Review'];
  function startWizard(q) {
    const s = S(),
      day = today(),
      defaults = sessionDefaults(day),
      campus = s.nodes.find((n) => n.kind === 'campus' && n.id === q.campus),
      branch =
        s.nodes.find((n) => n.kind === 'branch' && n.id === (q.branch || campus?.parent_id)) ||
        s.nodes.find((n) => n.kind === 'branch' && n.active),
      firstBranch = branch,
      live = s.academics.some((a) => a.kind === 'session' && a.active && a.start_date <= day && a.end_date >= day);
    wiz = {
      step: Math.min(5, Math.max(1, Number(q.step) || 1)),
      log: [],
      running: false,
      done: false,
      input: {
        branchId: firstBranch?.id || '',
        branchName: firstBranch ? firstBranch.name : 'Main Branch',
        campusId: campus?.id || '',
        campusName: campus ? campus.name : '',
        classes: [],
        customClasses: '',
        sections: ['A', 'B'],
        sectionsText: 'A, B',
        subjects: ['English', 'Urdu', 'Mathematics', 'Science', 'Islamiat'],
        customSubjects: '',
        subjectClasses: null,
        makeSession: !live,
        makeCurrent: true,
        session: { ...defaults },
      },
    };
  }
  const classList = () => [...new Set([...wiz.input.classes, ...parseList(wiz.input.customClasses)])];
  const finalInput = () => {
    const i = wiz.input,
      classes = classList(),
      subjectClasses = (i.subjectClasses || classes).filter((c) => classes.some((x) => key(x) === key(c)));
    return {
      branchId: i.branchId,
      branchName: i.branchName.trim(),
      campusId: i.campusId,
      campusName: i.campusName.trim(),
      classes,
      sections: parseList(i.sectionsText),
      subjects: [...new Set([...i.subjects, ...parseList(i.customSubjects)])],
      subjectClasses,
    };
  };
  const chip = (label, on, action, attrs = '') =>
    `<button type="button" class="ss-pill ${on ? 'on' : ''}" aria-pressed="${on}" data-action="${action}" ${attrs}>${esc(label)}</button>`;
  function wizardStep() {
    const s = S(),
      i = wiz.input;
    if (wiz.step === 1) {
      const branches = s.nodes.filter((n) => n.kind === 'branch' && n.active),
        campuses = s.nodes.filter((n) => n.kind === 'campus' && n.active && (!i.branchId || n.parent_id === i.branchId));
      return `<h3>Which branch and campus?</h3><p class="muted">Pick existing ones or type new names. Nothing is duplicated.</p><div class="form-grid">${
        branches.length
          ? `<label class="field">Branch<select data-field="branchChoice"><option value="">➕ New branch…</option>${branches.map((b) => `<option value="${b.id}" ${b.id === i.branchId ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label>`
          : ''
      }<label class="field">${i.branchId ? 'Branch name' : 'New branch name'}<input data-field="branchName" value="${esc(i.branchName)}" ${i.branchId ? 'readonly' : ''} placeholder="e.g. Main Branch"></label>${
        campuses.length
          ? `<label class="field">Campus<select data-field="campusChoice"><option value="">➕ New campus…</option>${campuses.map((c) => `<option value="${c.id}" ${c.id === i.campusId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>`
          : ''
      }<label class="field">${i.campusId ? 'Campus name' : 'New campus name'}<input data-field="campusName" value="${esc(i.campusName)}" ${i.campusId ? 'readonly' : ''} placeholder="e.g. Boys Campus"></label></div>`;
    }
    if (wiz.step === 2) {
      const exist = i.campusId ? classesOf(i.campusId).map((k) => key(k.name)) : [];
      const groups = Object.entries(CLASS_PRESETS)
        .map(
          ([group, names]) =>
            `<div class="ss-group"><div class="ss-group-head"><strong>${esc(group)}</strong><button type="button" class="small" data-action="ss-class-group" data-group="${esc(group)}">Toggle all</button></div><div class="ss-pills">${names
              .map((n) => chip(n + (exist.includes(key(n)) ? ' ✓' : ''), i.classes.includes(n), 'ss-chip-class', `data-value="${esc(n)}"`))
              .join('')}</div></div>`,
        )
        .join('');
      return `<h3>Classes and sections</h3><p class="muted">Tap the classes your school has. “✓” means the class already exists on this campus; only its missing sections are added.</p>${groups}<label class="field">Other classes (one per line or comma separated)<textarea data-field="customClasses" rows="2" placeholder="KG, Class 11">${esc(i.customClasses)}</textarea></label><div class="ss-group"><div class="ss-group-head"><strong>Sections for every class</strong></div><div class="ss-pills">${SECTION_PRESETS.map(([label, list]) => chip(label, key(list.join(',')) === key(parseList(i.sectionsText).join(',')), 'ss-sections-preset', `data-value="${esc(list.join(', '))}"`)).join('')}</div><label class="field">Section names<input data-field="sectionsText" value="${esc(i.sectionsText)}" placeholder="A, B, C"></label></div>`;
    }
    if (wiz.step === 3) {
      const classes = classList(),
        picked = i.subjectClasses || classes;
      return `<h3>Subjects</h3><p class="muted">Choose the subjects and the classes that study them. Fine-tune per class later in “Subjects by class”.</p><div class="ss-group"><div class="ss-group-head"><strong>Subjects</strong><button type="button" class="small" data-action="ss-subject-all">Select all</button></div><div class="ss-pills">${SUBJECT_PRESETS.map((n) => chip(n, i.subjects.includes(n), 'ss-chip-subject', `data-value="${esc(n)}"`)).join('')}</div><label class="field">Other subjects (one per line or comma separated)<textarea data-field="customSubjects" rows="2" placeholder="Arabic, Art">${esc(i.customSubjects)}</textarea></label></div><div class="ss-group"><div class="ss-group-head"><strong>Taught in</strong><span><button type="button" class="small" data-action="ss-scope" data-scope="all">All classes</button><button type="button" class="small" data-action="ss-scope" data-scope="early">Early years</button><button type="button" class="small" data-action="ss-scope" data-scope="primary">Primary</button><button type="button" class="small" data-action="ss-scope" data-scope="secondary">Secondary</button></span></div><div class="ss-pills">${classes.length ? classes.map((n) => chip(n, picked.some((x) => key(x) === key(n)), 'ss-chip-scope', `data-value="${esc(n)}"`)).join('') : '<span class="muted">Choose classes in the previous step first.</span>'}</div></div>`;
    }
    if (wiz.step === 4) {
      const ses = i.session;
      return `<h3>Academic session</h3><p class="muted">${i.makeSession ? 'Teachers can only be assigned inside a session that covers today.' : 'A session covering today already exists. You can skip this step.'}</p><label class="checkbox chip-check"><input type="checkbox" data-field="makeSession" ${i.makeSession ? 'checked' : ''}><span>Create a session</span></label><div class="form-grid"><label class="field">Session name<input data-field="sessionName" value="${esc(ses.name)}"></label><label class="field">Starts<input type="date" data-field="sessionStart" value="${esc(ses.start_date)}"></label><label class="field">Ends<input type="date" data-field="sessionEnd" value="${esc(ses.end_date)}"></label></div><label class="checkbox chip-check"><input type="checkbox" data-field="makeCurrent" ${i.makeCurrent ? 'checked' : ''}><span>Use it for new teaching assignments</span></label>`;
    }
    if (wiz.done)
      return `<h3>All done</h3><p class="muted">Your school structure is ready.</p><ul class="ss-review">${wiz.before.map(([a, b]) => `<li class="${b ? 'new' : ''}"><span>${esc(a)}</span><strong>${esc(b)}</strong></li>`).join('')}</ul><div class="ss-log" id="ss-log" aria-live="polite">${logHtml()}</div>`;
    const plan = planSetup(s, finalInput()),
      rows = [
        [plan.branch.create ? 'New branch' : 'Branch', plan.branch.name || '—', plan.branch.create],
        [plan.campus.create ? 'New campus' : 'Campus', plan.campus.name || '—', plan.campus.create],
        ['New classes', plan.newClasses, plan.newClasses > 0],
        ['New sections', plan.newSections, plan.newSections > 0],
        ['New subjects', plan.newSubjects, plan.newSubjects > 0],
        ['Subject links to add', plan.linkCount, plan.linkCount > 0],
        ['New session', wiz.input.makeSession ? wiz.input.session.name : 'None', wiz.input.makeSession],
      ];
    return `<h3>Review</h3><p class="muted">Existing items are kept. Only what is missing is created.</p><ul class="ss-review">${rows.map(([a, b, on]) => `<li class="${on ? 'new' : ''}"><span>${esc(a)}</span><strong>${esc(b)}</strong></li>`).join('')}</ul>${plan.blocked.length ? `<div class="alert error" role="alert">Archived classes will be skipped: ${esc(plan.blocked.join(', '))}. Activate them first.</div>` : ''}<div class="ss-log" id="ss-log" aria-live="polite">${logHtml()}</div>`;
  }
  const logHtml = () =>
    wiz.log.map((x) => `<div class="${x.ok === false ? 'bad' : x.ok ? 'good' : ''}">${x.ok === false ? '✗' : x.ok ? '✓' : '…'} ${esc(x.text)}</div>`).join('');
  function drawWizard() {
    const root = $('#ss-wizard');
    if (!root) return;
    const last = wiz.step === 5;
    root.innerHTML = `<ol class="ss-steps">${stepNames
      .map((n, k) => `<li class="${k + 1 === wiz.step ? 'now' : k + 1 < wiz.step ? 'done' : ''}"><span>${k + 1}</span>${esc(n)}</li>`)
      .join('')}</ol><div class="ss-step" id="ss-step-body">${wizardStep()}</div><div class="alert error" id="ss-wiz-error" role="alert"></div><div class="ss-nav">${
      wiz.done
        ? '<a class="button primary" href="#/academics">Go to overview</a><a class="button" href="#/users">Next: add teachers and users</a>'
        : `${wiz.step > 1 ? button('Back', 'ss-back', '', wiz.running ? 'disabled' : '') : '<span></span>'}${
            last
              ? button(wiz.running ? 'Creating…' : 'Create everything', 'ss-run', 'primary', wiz.running ? 'disabled' : '')
              : button('Next', 'ss-next', 'primary')
          }`
    }</div>`;
  }
  function wizardPage(q) {
    if (!manage())
      return heading('Quick setup', 'You need school structure management permission.') + tabs('setup');
    if (!wiz || q.fresh !== undefined || q.campus || q.branch || wiz.done) startWizard(q);
    else if (q.step) wiz.step = Math.min(5, Math.max(1, Number(q.step)));
    return (
      heading('Quick setup', 'Create your whole school structure in a few taps. Existing items are never duplicated.') +
      tabs('setup') +
      '<section class="ss-wizard" id="ss-wizard"></section>'
    );
  }
  function mountWizard() {
    const root = $('#ss-wizard');
    if (!root) return;
    drawWizard();
    const i = () => wiz.input;
    root.addEventListener('input', (event) => {
      const f = event.target.dataset.field;
      if (!f) return;
      const v = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
      if (f === 'branchName') i().branchName = v;
      if (f === 'campusName') i().campusName = v;
      if (f === 'customClasses') i().customClasses = v;
      if (f === 'sectionsText') i().sectionsText = v;
      if (f === 'customSubjects') i().customSubjects = v;
      if (f === 'sessionName') i().session.name = v;
      if (f === 'sessionStart') i().session.start_date = v;
      if (f === 'sessionEnd') i().session.end_date = v;
      if (f === 'makeSession') {
        i().makeSession = v;
        drawWizard();
      }
      if (f === 'makeCurrent') i().makeCurrent = v;
    });
    root.addEventListener('change', (event) => {
      const f = event.target.dataset.field,
        s = S();
      if (f === 'branchChoice') {
        const b = s.nodes.find((n) => n.id === event.target.value);
        i().branchId = b?.id || '';
        i().branchName = b?.name || '';
        i().campusId = '';
        i().campusName = '';
        drawWizard();
      }
      if (f === 'campusChoice') {
        const c = s.nodes.find((n) => n.id === event.target.value);
        i().campusId = c?.id || '';
        i().campusName = c?.name || '';
        drawWizard();
      }
    });
  }
  function validateStep() {
    const i = wiz.input,
      fail = (m) => {
        throw new Error(m);
      };
    if (wiz.step === 1) {
      if (!i.branchName.trim()) fail('Enter a branch name.');
      if (!i.campusName.trim()) fail('Enter a campus name.');
    }
    if (wiz.step === 2) {
      if (!classList().length) fail('Choose at least one class.');
      if (!parseList(i.sectionsText).length) fail('Enter at least one section name, for example A, B.');
    }
    if (wiz.step === 4 && i.makeSession) {
      const ses = i.session;
      if (!ses.name.trim()) fail('Enter a session name.');
      if (!ses.start_date || !ses.end_date || ses.start_date > ses.end_date) fail('Choose valid session dates.');
    }
  }
  async function runWizard() {
    const input = finalInput(),
      say = (text, ok) => {
        wiz.log.push({ text, ok });
        const box = $('#ss-log');
        if (box) box.innerHTML = logHtml();
      },
      mark = (ok) => {
        wiz.log[wiz.log.length - 1].ok = ok;
        const box = $('#ss-log');
        if (box) box.innerHTML = logHtml();
      };
    wiz.before = (() => {
      const first = planSetup(S(), input);
      return [
        ['Classes created', first.newClasses],
        ['Sections created', first.newSections],
        ['Subjects created', first.newSubjects],
        ['Subject links added', first.linkCount],
      ];
    })();
    wiz.running = true;
    wiz.log = [];
    drawWizard();
    try {
      await reload();
      let plan = planSetup(S(), input);
      let branchId = plan.branch.id,
        campusId = plan.campus.id;
      if (!branchId) {
        say(`Creating branch “${input.branchName}”`);
        branchId = (await api('/api/school/structure', { method: 'POST', body: { kind: 'branch', name: input.branchName } })).id;
        mark(true);
      }
      if (!campusId) {
        say(`Creating campus “${input.campusName}”`);
        campusId = (await api('/api/school/structure', { method: 'POST', body: { kind: 'campus', name: input.campusName, parent_id: branchId } })).id;
        mark(true);
      }
      await reload();
      plan = planSetup(S(), { ...input, branchId, campusId });
      let failures = 0;
      for (const c of plan.classes) {
        if (c.blocked) {
          say(`${c.name} is archived and was skipped`, false);
          failures++;
          continue;
        }
        if (!c.missing.length) continue;
        say(`${c.create ? 'Creating' : 'Adding sections to'} ${c.name} (${c.missing.join(', ')})`);
        try {
          await api('/api/school/structure', { method: 'POST', body: { kind: 'class_sections', parent_id: campusId, name: c.name, sections: c.missing } });
          mark(true);
        } catch (error) {
          mark(false);
          say(error.message, false);
          failures++;
        }
      }
      await reload();
      plan = planSetup(S(), { ...input, branchId, campusId });
      let order = Math.max(-1, ...S().academics.filter((a) => a.kind === 'subject').map((a) => a.priority ?? 0)) + 1;
      const subjectIds = new Map();
      for (const sub of plan.subjects) {
        if (sub.id && !sub.inactive) subjectIds.set(key(sub.name), sub.id);
        else if (!sub.id) {
          say(`Creating subject ${sub.name}`);
          try {
            const created = await api('/api/school/structure', { method: 'POST', body: { kind: 'subject', name: sub.name, priority: order++ } });
            subjectIds.set(key(sub.name), created.id);
            mark(true);
          } catch (error) {
            mark(false);
            say(error.message, false);
            failures++;
          }
        } else {
          say(`${sub.name} is archived and was skipped`, false);
          failures++;
        }
      }
      await reload();
      const targets = plan.classes.filter((c) => (input.subjectClasses || []).some((x) => key(x) === key(c.name)) && !c.blocked && c.id !== undefined);
      const want = [...subjectIds.values()],
        jobs = [];
      for (const c of targets) {
        const klass = S().academics.find((a) => a.kind === 'class' && key(a.name) === key(c.name) && campusOfClass(a.id) === campusId);
        if (!klass) continue;
        for (const section of sectionsOf(klass.id).filter((x) => x.active)) {
          const have = new Set(subjectIdsOf(section.id)),
            next = new Set([...have, ...want]);
          if (next.size !== have.size) jobs.push({ section, ids: [...next], label: `${klass.name} / ${section.name}` });
        }
      }
      if (jobs.length) {
        say(`Assigning subjects to ${jobs.length} section${jobs.length === 1 ? '' : 's'}`);
        let n = 0,
          bad = 0;
        const worker = async () => {
          while (jobs.length) {
            const job = jobs.shift();
            try {
              await api('/api/school/curriculum', { method: 'PUT', body: { section_id: job.section.id, subject_ids: job.ids } });
            } catch {
              bad++;
            }
            n++;
          }
        };
        const total = jobs.length;
        await Promise.all([worker(), worker(), worker(), worker()]);
        mark(bad === 0);
        if (bad) {
          say(`${bad} of ${total} sections could not be updated`, false);
          failures++;
        }
      }
      if (wiz.input.makeSession) {
        const ses = wiz.input.session,
          known = S().academics.find((a) => a.kind === 'session' && key(a.name) === key(ses.name));
        say(`Creating session ${ses.name}`);
        try {
          const id = known?.id || (await api('/api/school/structure', { method: 'POST', body: { kind: 'session', name: ses.name.trim(), start_date: ses.start_date, end_date: ses.end_date } })).id;
          if (wiz.input.makeCurrent) {
            await api('/api/assignment-session', { method: 'POST', body: { session_id: id } });
            (state.school ||= {}).assignmentSessionId = id;
          }
          mark(true);
        } catch (error) {
          mark(false);
          say(error.message, false);
          failures++;
        }
      }
      await reload();
      say(failures ? `Finished with ${failures} item${failures === 1 ? '' : 's'} to check.` : 'Everything is ready.', !failures);
      wiz.done = true;
    } catch (error) {
      say(error.message, false);
    } finally {
      wiz.running = false;
      drawWizard();
    }
  }

  // ---------- public ----------
  return {
    page(q) {
      const kind = q.kind || '';
      if (kind === 'setup') {
        $('#content').innerHTML = wizardPage(q);
        mountWizard();
        return;
      }
      const can = manage();
      $('#content').innerHTML =
        heading(
          'School structure',
          'Branch → Campus → Class → Sections → Subjects. Everything for your school in one place.',
          can ? '<a class="button primary" href="#/academics?kind=setup&fresh=1">Quick setup</a>' : '',
        ) +
        tabs('') +
        overview(q);
      $('#ss-campus-pick')?.addEventListener('change', (event) => {
        location.hash = '#/academics?campus=' + event.target.value;
      });
    },
    tabs,
    isMine: (action) => action.startsWith('ss-'),
    async click(action, target) {
      const d = target.dataset;
      if (action === 'ss-section') return sectionDialog(d.id);
      if (action === 'ss-add-sections') return addSectionsDialog(d.class, d.campus);
      if (action === 'ss-cell') {
        const sections = sectionsOf(d.class).filter((x) => x.active),
          on = cellState(S(), d.class, d.subject) !== 'all';
        return toggleCells(sections.map((x) => ({ section: x.id, subject: d.subject })), on);
      }
      if (action === 'ss-row') {
        const classes = classesOf(d.campus).filter((k) => k.active),
          on = classes.some((k) => cellState(S(), k.id, d.subject) !== 'all'),
          pairs = classes.flatMap((k) => sectionsOf(k.id).filter((x) => x.active).map((x) => ({ section: x.id, subject: d.subject })));
        return toggleCells(pairs, on);
      }
      if (!wiz) return;
      const i = wiz.input,
        flip = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
      if (action === 'ss-chip-class') i.classes = flip(i.classes, d.value);
      if (action === 'ss-class-group') {
        const names = CLASS_PRESETS[d.group],
          all = names.every((n) => i.classes.includes(n));
        i.classes = all ? i.classes.filter((n) => !names.includes(n)) : [...new Set([...i.classes, ...names])];
      }
      if (action === 'ss-sections-preset') i.sectionsText = d.value;
      if (action === 'ss-chip-subject') i.subjects = flip(i.subjects, d.value);
      if (action === 'ss-subject-all') i.subjects = i.subjects.length >= SUBJECT_PRESETS.length ? [] : [...SUBJECT_PRESETS];
      if (action === 'ss-chip-scope') {
        const list = i.subjectClasses || classList();
        i.subjectClasses = flip(list, d.value);
      }
      if (action === 'ss-scope') {
        const all = classList(),
          set = { all, early: CLASS_PRESETS['Early years'], primary: CLASS_PRESETS.Primary, secondary: CLASS_PRESETS.Secondary }[d.scope];
        i.subjectClasses = all.filter((c) => set.some((x) => key(x) === key(c)));
      }
      if (action === 'ss-next' || action === 'ss-back') {
        try {
          if (action === 'ss-next') {
            validateStep();
            wiz.step = Math.min(5, wiz.step + 1);
          } else wiz.step = Math.max(1, wiz.step - 1);
        } catch (error) {
          const box = $('#ss-wiz-error');
          if (box) box.textContent = error.message;
          return;
        }
      }
      if (action === 'ss-run') return runWizard();
      drawWizard();
      if (action === 'ss-next' || action === 'ss-back') window.scrollTo({ top: 0, behavior: 'smooth' });
    },
  };
}
