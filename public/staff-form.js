// Campus and supervisor fields shared by the Add and Edit account forms.
// Hierarchy follows the campus: Teacher -> Head Teacher -> Coordinator of the same campus.
const SUPERVISOR_ROLE = { teacher: 'head_teacher', head_teacher: 'coordinator' };
const ROLE_NAME = { head_teacher: 'Head Teacher', coordinator: 'Coordinator' };
export const isStaff = (role) => ['teacher', 'head_teacher', 'coordinator'].includes(role);

export function activeCampuses(nodes) {
  return nodes.filter(
    (x) =>
      x.kind === 'campus' &&
      x.active &&
      (!x.parent_id || nodes.some((p) => p.id === x.parent_id && p.active)),
  );
}

export function staffFields({ nodes, person }, { select }) {
  const campuses = activeCampuses(nodes);
  return `<div data-staff-fields>${select('Campus', 'campus_id', campuses, person?.campus_id || '', 'data-campus')}<label class="field" data-supervisor-field>Reports to<select name="parent_id" data-supervisor></select></label><p class="muted" data-supervisor-note></p></div>`;
}

// Shows the campus fields for staff roles and offers only supervisors of the chosen campus.
export function mountStaffFields(form, { users, person }) {
  if (!form) return;
  const role = form.querySelector('[name=role]'),
    wrap = form.querySelector('[data-staff-fields]'),
    campus = form.querySelector('[data-campus]'),
    supervisor = form.querySelector('[data-supervisor]'),
    note = form.querySelector('[data-supervisor-note]');
  const currentRole = () => role?.value || person?.role;
  function update() {
    const staff = isStaff(currentRole()),
      parentRole = SUPERVISOR_ROLE[currentRole()];
    wrap.hidden = !staff;
    campus.required = staff && !person;
    campus.disabled = !staff;
    supervisor.parentElement.hidden = !parentRole;
    supervisor.disabled = !staff || !parentRole;
    if (!staff || !parentRole) return (note.textContent = '');
    const matches = users.filter(
      (x) =>
        x.active &&
        x.role === parentRole &&
        x.id !== person?.id &&
        campus.value &&
        x.campus_id === campus.value,
    );
    const keep = supervisor.value || person?.reports_to || '';
    supervisor.innerHTML =
      `<option value="">Automatic (${matches.length ? esc(matches[0].name) : 'none on this campus yet'})</option>` +
      matches.map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('') +
      (person?.reports_to ? '<option value="none">No supervisor</option>' : '');
    if ([...supervisor.options].some((o) => o.value === keep)) supervisor.value = keep;
    note.textContent = campus.value
      ? `Supervisor must be a ${ROLE_NAME[parentRole]} of the same campus. Staff are linked automatically when one is added.`
      : 'Choose a campus to link this account automatically.';
  }
  role?.addEventListener('change', update);
  campus.addEventListener('change', () => {
    supervisor.value = '';
    update();
  });
  update();
}

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// Request fields for the account API: empty values mean "automatic".
export function staffPayload(data, role) {
  return isStaff(role)
    ? { campus_id: data.campus_id || undefined, parent_id: data.parent_id || undefined }
    : {};
}
