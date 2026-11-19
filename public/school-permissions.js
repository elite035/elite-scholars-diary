// Permissions workspace: role defaults and individual overrides, grouped by area with plain-English labels.
export const GROUPS = [
  {
    id: 'diary',
    title: 'Diaries',
    note: 'Writing, reviewing and publishing class diaries.',
    caps: [
      ['diary.view', 'View diaries'],
      ['diary.create', 'Write diaries'],
      ['diary.edit', 'Edit own diaries'],
      ['diary.delete', 'Move draft diaries to trash'],
      ['diary.submit', 'Submit diaries for review'],
      ['diary.review', 'Start a review'],
      ['diary.approve', 'Approve diaries'],
      ['diary.return', 'Return diaries with comments'],
      ['diary.amend', 'Amend approved diaries'],
      ['diary.export', 'Download and export diaries'],
    ],
  },
  {
    id: 'structure',
    title: 'School structure',
    note: 'Branches, campuses, classes, sections, subjects and sessions.',
    caps: [
      ['structure.view', 'View structure'],
      ['structure.create', 'Add structure items'],
      ['structure.edit', 'Edit and archive structure items'],
      ['structure.delete', 'Delete structure items'],
      ['structure.manage', 'Full control, including Quick setup'],
    ],
  },
  {
    id: 'people',
    title: 'People and hierarchy',
    note: 'User accounts, parents and who reports to whom.',
    caps: [
      ['people.view', 'View users'],
      ['people.create', 'Add users'],
      ['people.edit', 'Edit users'],
      ['people.delete', 'Delete users'],
      ['people.manage', 'Full control of users'],
      ['hierarchy.manage', 'Manage hierarchy'],
      ['parents.manage', 'Manage parent access'],
    ],
  },
  {
    id: 'assignments',
    title: 'Teacher assignments',
    note: 'Which teacher teaches which subject in which section.',
    caps: [
      ['assignments.view', 'View assignments'],
      ['assignments.create', 'Add assignments'],
      ['assignments.edit', 'Edit assignments'],
      ['assignments.delete', 'Delete assignments'],
      ['assignments.manage', 'Full control of assignments'],
    ],
  },
  {
    id: 'quotes',
    title: 'Daily quotes',
    note: 'The quote printed on diaries.',
    caps: [
      ['quotes.view', 'View quotes'],
      ['quotes.create', 'Add quotes'],
      ['quotes.edit', 'Edit quotes'],
      ['quotes.delete', 'Delete quotes'],
      ['quotes.manage', 'Full control of quotes'],
    ],
  },
  {
    id: 'notices',
    title: 'Diary notices',
    note: 'Notices printed on the diaries of the classes they are assigned to.',
    caps: [
      ['notices.view', 'View notices'],
      ['notices.create', 'Add notices'],
      ['notices.edit', 'Edit, publish and hide notices'],
      ['notices.delete', 'Delete notices'],
      ['notices.manage', 'Full control of notices'],
    ],
  },
  {
    id: 'reports',
    title: 'Reports and communication',
    note: 'Monitoring, audit history and messaging.',
    caps: [
      ['reports.view', 'View reports and monitoring'],
      ['audit.view', 'View audit history'],
      ['communication.use', 'Use communication'],
      ['communication.oversight', 'Oversee all communication'],
    ],
  },
  {
    id: 'system',
    title: 'System',
    note: 'Settings, templates and sensitive actions.',
    caps: [
      ['settings.manage', 'Change school settings'],
      ['template.manage', 'Change the diary template'],
      ['notifications.manage', 'Manage notifications'],
      ['permissions.manage', 'Manage permissions'],
      ['records.force_delete', 'Permanently delete records'],
    ],
  },
];
export const labelOf = (id) => {
  for (const g of GROUPS) for (const [cap, label] of g.caps) if (cap === id) return label;
  return id.replaceAll('.', ' · ');
};
// Puts every known capability in its group; anything new from the server lands in "Other".
export function groupCapabilities(names) {
  const known = new Set(GROUPS.flatMap((g) => g.caps.map(([id]) => id))),
    groups = GROUPS.map((g) => ({ ...g, caps: g.caps.filter(([id]) => names.includes(id)) })).filter(
      (g) => g.caps.length,
    ),
    other = names.filter((id) => !known.has(id));
  if (other.length)
    groups.push({ id: 'other', title: 'Other', note: '', caps: other.map((id) => [id, labelOf(id)]) });
  return groups;
}
export const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
export const countChanges = (saved, draft) =>
  [...draft].filter((x) => !saved.has(x)).length + [...saved].filter((x) => !draft.has(x)).length;
// Individual override state for one capability: default, allow or deny.
export const overrideState = (id, allows, denies) =>
  denies.has(id) ? 'deny' : allows.has(id) ? 'allow' : 'default';

export function permissionsWorkspace(ctx) {
  const { api, state, esc, heading, toast, render, roles } = ctx;
  const $ = (s, r = document) => r.querySelector(s),
    $$ = (s, r = document) => [...r.querySelectorAll(s)];
  let data,
    tab = 'roles',
    role = 'teacher',
    userId = '',
    saved = new Set(),
    draft = new Set(),
    savedOver = { allows: new Set(), denies: new Set() },
    over = { allows: new Set(), denies: new Set() },
    filter = '';
  const roleList = () =>
    Object.entries(roles).filter(
      ([id]) => id !== 'super_admin' && (state.user.role === 'super_admin' || id !== 'school_admin'),
    );
  const userList = () =>
    state.schoolConfig.users
      .filter((u) => u.role !== 'super_admin' && (state.user.role === 'super_admin' || u.role !== 'school_admin'))
      .sort((a, b) => a.name.localeCompare(b.name));
  const roleGrants = (r) => {
    const row = data.roles.find((x) => x.role === r);
    return new Set(row ? JSON.parse(row.grants) : data.defaults[r] || []);
  };
  const reasonFor = (r, cap) => data.roleRestrictions?.[r]?.[cap] || '';
  function loadRole() {
    saved = roleGrants(role);
    for (const cap of saved) if (reasonFor(role, cap)) saved.delete(cap);
    draft = new Set(saved);
  }
  function loadUser() {
    const row = data.users.find((x) => x.user_id === userId);
    savedOver = {
      allows: new Set(row ? JSON.parse(row.allows) : []),
      denies: new Set(row ? JSON.parse(row.denies) : []),
    };
    over = { allows: new Set(savedOver.allows), denies: new Set(savedOver.denies) };
  }
  const switchRow = (id, label, checked, reason) =>
    `<label class="perm-row ${reason ? 'locked' : ''}" data-cap="${esc(id)}" data-text="${esc((label + ' ' + id).toLowerCase())}" ${reason ? `title="${esc(reason)}"` : ''}><span class="perm-name"><strong>${esc(label)}</strong><small>${reason ? '🔒 ' + esc(reason) : esc(id)}</small></span><span class="perm-switch"><input type="checkbox" data-perm-cap="${esc(id)}" ${checked ? 'checked' : ''} ${reason ? 'disabled' : ''}><i aria-hidden="true"></i></span></label>`;
  const stateRow = (id, label, current, roleAllows, blocked) =>
    `<div class="perm-row perm-3" data-cap="${esc(id)}" data-text="${esc((label + ' ' + id).toLowerCase())}"><span class="perm-name"><strong>${esc(label)}</strong><small>Role default: ${roleAllows ? 'allowed' : 'not allowed'}</small></span><span class="perm-seg" role="radiogroup" aria-label="${esc(label)}">${[
      ['default', 'Role default'],
      ['allow', 'Allow'],
      ['deny', 'Deny'],
    ]
      .map(
        ([v, t]) =>
          `<label class="${v}"><input type="radio" name="o-${esc(id)}" value="${v}" data-perm-over="${esc(id)}" ${current === v ? 'checked' : ''} ${v === 'allow' && blocked ? 'disabled' : ''}><span>${t}</span></label>`,
      )
      .join('')}</span></div>`;
  function groups(rowFn) {
    const names = data.capabilityNames;
    return groupCapabilities(names)
      .map(
        (g) =>
          `<section class="perm-group" data-group="${g.id}"><header><div><h3>${esc(g.title)}</h3><p>${esc(g.note)}</p></div><div class="perm-group-tools"><span class="perm-count" data-group-count></span>${
            tab === 'roles'
              ? `<button type="button" class="small" data-action="school-perm-group" data-group="${g.id}" data-on="1">Allow all</button><button type="button" class="small" data-action="school-perm-group" data-group="${g.id}" data-on="0">None</button>`
              : `<button type="button" class="small" data-action="school-perm-group" data-group="${g.id}" data-on="default">Reset</button>`
          }</div></header><div class="perm-rows">${g.caps.map(([id, label]) => rowFn(id, label)).join('')}</div></section>`,
      )
      .join('');
  }
  function body() {
    if (tab === 'roles') {
      loadRoleIfNeeded();
      return `<div class="perm-pills" role="tablist" aria-label="Role">${roleList()
        .map(
          ([id, name]) =>
            `<button type="button" class="ss-pill ${id === role ? 'on' : ''}" data-action="school-perm-role" data-role="${id}" aria-pressed="${id === role}">${esc(name)}</button>`,
        )
        .join('')}</div><p class="perm-hint">These switches apply to <strong>every ${esc(roles[role])}</strong>. Locked items cannot be given to this role.</p>${groups((id, label) => switchRow(id, label, draft.has(id), reasonFor(role, id)))}`;
    }
    const users = userList(),
      user = users.find((u) => u.id === userId);
    const base = user ? roleGrants(user.role) : new Set();
    return `<label class="field perm-user">Person<select id="perm-user"><option value="">Choose a person…</option>${users
      .map((u) => `<option value="${u.id}" ${u.id === userId ? 'selected' : ''}>${esc(u.name)} · ${esc(roles[u.role] || u.role)}</option>`)
      .join('')}</select></label>${
      user
        ? `<p class="perm-hint">Changes apply only to <strong>${esc(user.name)}</strong> (${esc(roles[user.role])}). <strong>Deny always wins</strong> over the role.</p>${groups((id, label) =>
            stateRow(id, label, overrideState(id, over.allows, over.denies), base.has(id), !!reasonFor(user.role, id)),
          )}`
        : '<div class="ss-empty"><strong>Choose a person</strong><p>Then give them extra permissions, or take some away, without changing their role.</p></div>'
    }`;
  }
  let lastRole = '';
  function loadRoleIfNeeded() {
    if (lastRole !== role) {
      loadRole();
      lastRole = role;
    }
  }
  const dirty = () =>
    tab === 'roles'
      ? countChanges(saved, draft)
      : countChanges(savedOver.allows, over.allows) + countChanges(savedOver.denies, over.denies);
  function refresh() {
    const root = $('#perm-root');
    if (!root) return;
    for (const row of $$('.perm-row', root)) {
      const id = row.dataset.cap,
        hit = !filter || row.dataset.text.includes(filter);
      row.hidden = !hit;
      row.classList.toggle('changed', tab === 'roles' ? draft.has(id) !== saved.has(id) : overrideState(id, over.allows, over.denies) !== overrideState(id, savedOver.allows, savedOver.denies));
    }
    for (const group of $$('.perm-group', root)) {
      const rows = $$('.perm-row', group),
        visible = rows.filter((r) => !r.hidden);
      group.hidden = !visible.length;
      const on =
        tab === 'roles'
          ? rows.filter((r) => draft.has(r.dataset.cap)).length
          : rows.filter((r) => overrideState(r.dataset.cap, over.allows, over.denies) !== 'default').length;
      $('[data-group-count]', group).textContent =
        tab === 'roles' ? `${on} of ${rows.length} allowed` : on ? `${on} override${on === 1 ? '' : 's'}` : 'No overrides';
    }
    const n = dirty(),
      bar = $('#perm-bar');
    if (bar) {
      bar.classList.toggle('on', n > 0);
      $('[data-perm-dirty]', bar).textContent = n ? `${n} unsaved change${n === 1 ? '' : 's'}` : 'No changes';
      $$('button', bar).forEach((b) => (b.disabled = n === 0));
    }
  }
  function draw() {
    const root = $('#perm-root');
    root.innerHTML = `<div class="perm-tabs"><button type="button" class="${tab === 'roles' ? 'on' : ''}" data-action="school-perm-tab" data-tab="roles">Roles</button><button type="button" class="${tab === 'people' ? 'on' : ''}" data-action="school-perm-tab" data-tab="people">Individuals</button></div><div class="perm-search"><input type="search" id="perm-search" placeholder="Search permissions…" value="${esc(filter)}" aria-label="Search permissions"></div>${body()}<div class="perm-bar" id="perm-bar"><span data-perm-dirty></span><div class="actions"><button type="button" data-action="school-perm-reset">Discard</button><button type="button" class="primary" data-action="school-perm-save">Save changes</button></div></div>`;
    refresh();
  }
  const confirmLeave = () => !dirty() || window.confirm('You have unsaved changes. Discard them?');
  return {
    async page() {
      data = await api('/api/school/permissions');
      state.schoolPolicies = data;
      lastRole = '';
      const roles0 = roleList();
      if (!roles0.some(([id]) => id === role)) role = roles0[0]?.[0] || 'teacher';
      $('#content').innerHTML =
        heading('Permissions', 'Decide who can do what. Role switches apply to everyone in that role; individual overrides change one person.') +
        '<div id="perm-root" class="perm"></div>';
      draw();
      const root = $('#perm-root');
      root.addEventListener('input', (event) => {
        if (event.target.id === 'perm-search') {
          filter = event.target.value.trim().toLowerCase();
          refresh();
        }
      });
      root.addEventListener('change', (event) => {
        const t = event.target;
        if (t.dataset.permCap) {
          t.checked ? draft.add(t.dataset.permCap) : draft.delete(t.dataset.permCap);
          refresh();
        }
        if (t.dataset.permOver) {
          const id = t.dataset.permOver;
          over.allows.delete(id);
          over.denies.delete(id);
          if (t.value === 'allow') over.allows.add(id);
          if (t.value === 'deny') over.denies.add(id);
          refresh();
        }
        if (t.id === 'perm-user') {
          if (!confirmLeave()) {
            t.value = userId;
            return;
          }
          userId = t.value;
          loadUser();
          draw();
        }
      });
    },
    isMine: (action) => action.startsWith('school-perm-'),
    async click(action, target) {
      const d = target.dataset;
      if (action === 'school-perm-tab') {
        if (d.tab === tab || !confirmLeave()) return;
        tab = d.tab;
        if (tab === 'roles') lastRole = '';
        return draw();
      }
      if (action === 'school-perm-role') {
        if (d.role === role || !confirmLeave()) return;
        role = d.role;
        lastRole = '';
        return draw();
      }
      if (action === 'school-perm-group') {
        const group = $(`.perm-group[data-group="${d.group}"]`);
        for (const row of $$('.perm-row', group)) {
          const id = row.dataset.cap;
          if (tab === 'roles') {
            const box = $('input[data-perm-cap]', row);
            if (box.disabled) continue;
            d.on === '1' ? draft.add(id) : draft.delete(id);
            box.checked = d.on === '1';
          } else {
            over.allows.delete(id);
            over.denies.delete(id);
            const radio = $('input[value=default]', row);
            radio.checked = true;
          }
        }
        return refresh();
      }
      if (action === 'school-perm-reset') {
        if (tab === 'roles') draft = new Set(saved);
        else over = { allows: new Set(savedOver.allows), denies: new Set(savedOver.denies) };
        return draw();
      }
      if (action === 'school-perm-save') {
        if (tab === 'roles') {
          await api('/api/school/permissions', { method: 'PUT', body: { role, grants: [...draft] } });
          toast(`${roles[role]} permissions saved.`);
        } else {
          if (!userId) return toast('Choose a person first.');
          await api('/api/school/permissions', {
            method: 'PUT',
            body: { user_id: userId, allows: [...over.allows], denies: [...over.denies] },
          });
          toast('Individual permissions saved.');
        }
        await this.page();
        if (tab === 'people' && userId) loadUser();
        draw();
      }
    },
  };
}
