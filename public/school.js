import { mountMonitoring } from './diary-monitoring.js';
import { pushStatus, requestAndSubscribe, turnOffThisDevice } from './push-client.js';
import { diaryBulkToolbar, mountDiaryBulk } from './diary-bulk.js';
import { historicalDisplay } from './historical-display.js';
import { staffFields, mountStaffFields, staffPayload } from './staff-form.js';
import { assignmentChoices, mountAssignmentSubjects } from './assignment-subjects.js';
import { subjectPriority } from './subject-priority.js';
import {
  diaryLanguages,
  subjectLanguage,
  languageDirection,
  languageName,
  mountSubjectLanguages,
} from './diary-languages.js';
import {
  mountSubjectTree,
  validateSubjectAssignments,
  subjectAssignments,
} from './subject-form.js';
import { validateClassSections } from './class-sections.js';
import { structureWorkspace } from './school-structure.js';
import { permissionsWorkspace } from './school-permissions.js';
export function schoolUI({
  api,
  state,
  esc,
  field,
  select,
  button,
  card,
  heading,
  empty,
  today,
  displayDate,
  toast,
  modal,
  render,
}) {
  const $ = (s, r = document) => r.querySelector(s),
    $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const roles = {
    super_admin: 'Super Admin',
    school_admin: 'School Admin',
    coordinator: 'Coordinator',
    head_teacher: 'Head Teacher',
    teacher: 'Teacher',
    parent: 'Parent',
  };
  const has = (p) => state.capabilities?.includes(p),
    isAdmin = () => ['super_admin', 'school_admin'].includes(state.user.role),
    params = (x) =>
      new URLSearchParams(
        Object.entries(x).filter(([, v]) => v !== '' && v !== undefined),
      ).toString();
  const canForce = () => isAdmin() && has('records.force_delete');
  const forceButton = (type, id) =>
    canForce() &&
    has(
      {
        user: 'people',
        academic: 'structure',
        node: 'structure',
        assignment: 'assignments',
        diary: 'diary',
        legacy_diary: 'diary',
        quote: 'quotes',
      }[type] + '.delete',
    ) &&
    !(type === 'user' && id === state.user.id)
      ? button(
          'Force Delete',
          'school-force-delete',
          'small danger',
          `data-type="${type}" data-id="${id}"`,
        )
      : '';
  const badge = (s) => `<span class="badge ${esc(s)}">${esc(s.replaceAll('_', ' '))}</span>`;
  const link = (label, path, cls = 'button') =>
    `<a class="${cls}" href="${esc(path)}">${esc(label)}</a>`;
  const checks = (name, items, selected = []) =>
    `<div class="choice-list">${items.map((i) => `<label class="checkbox"><input type="checkbox" name="${name}" value="${esc(i.id)}" ${selected.includes(i.id) ? 'checked' : ''}>${esc(i.name)}</label>`).join('') || '<p class="muted">No choices configured.</p>'}</div>`;
  const actions =
    '<div class="alert error" data-school-error role="alert" hidden></div><button class="primary" type="submit">Save</button>';
  const table = (heads, rows) =>
    rows.length
      ? `<div class="table-wrap"><table><thead><tr>${heads.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
      : empty('No records yet', 'Add your school’s actual information to get started.');
  function form(id, fn) {
    const f = $('#' + id);
    if (!f) return;
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (f.dataset.submitting === 'true') return;
      f.dataset.submitting = 'true';
      f.setAttribute('aria-busy', 'true');
      const error = $('[data-school-error]', f);
      if (error) error.hidden = true;
      const buttons = $$('button', f).map((button) => ({ button, disabled: button.disabled }));
      buttons.forEach(({ button }) => (button.disabled = true));
      try {
        await fn(Object.fromEntries(new FormData(f)), f, e.submitter?.value);
      } catch (err) {
        if (error) {
          error.hidden = false;
          error.textContent = err.message;
        } else toast(err.message);
      } finally {
        buttons.forEach(({ button, disabled }) => (button.disabled = disabled));
        delete f.dataset.submitting;
        f.removeAttribute('aria-busy');
      }
    });
  }
  async function config() {
    const b = await api('/api/school/bootstrap');
    state.capabilities = b.capabilities;
    state.schoolConfig = b.structure;
    return b.structure;
  }
  const workspace = structureWorkspace({
    api,
    state,
    esc,
    button,
    card,
    heading,
    toast,
    modal,
    render,
    has,
    today,
    reload: () => config(),
  });
  const academic = (s, k) => s.academics.filter((x) => x.kind === k),
    name = (s, id) =>
      s.academics.find((x) => x.id === id)?.name || s.nodes.find((x) => x.id === id)?.name || '—';
  function sectionName(s, id) {
    const sec = s.academics.find((x) => x.id === id);
    return sec ? name(s, sec.parent_id) + ' / ' + sec.name : '—';
  }
  function nav() {
    if (state.user.role === 'parent')
      return [
        ['dashboard', 'home', 'Family overview'],
        ['family', 'book', 'Approved diaries'],
        ['notifications', 'bell', 'Notifications'],
      ];
    const items = [['dashboard', 'home', 'Overview']];
    if (has('diary.view')) items.push(['schooldiaries', 'book', 'Class diaries']);
    if (has('diary.create')) items.push(['new', 'plus', 'Write diary']);
    if (has('diary.review') || has('diary.approve') || has('diary.return'))
      items.push(['review', 'check', 'Review queue']);
    if (has('structure.manage')) items.push(['academics', 'grid', 'School structure']);
    if (canForce()) items.push(['deleted', 'file', 'Deleted records']);
    if (isAdmin() && has('people.manage')) items.push(['users', 'users', 'User Management']);
    if (['coordinator', 'head_teacher'].includes(state.user.role))
      items.push(['hierarchy', 'users', 'My team']);
    if (has('assignments.manage')) items.push(['timetable', 'calendar', 'Teacher assignments']);
    if (has('parents.manage')) items.push(['parents', 'users', 'Parent access']);
    if (has('permissions.manage')) items.push(['permissions', 'settings', 'Permissions']);
    if (has('quotes.manage')) items.push(['quotes', 'quote', 'Daily quotes']);
    if (has('quotes.manage')) items.push(['notice', 'bell', 'Diary notice']);
    if (has('reports.view')) items.push(['reports', 'chart', 'Diary reports']);
    items.push(['notifications', 'bell', 'Notifications']);
    if (has('audit.view') && isAdmin()) items.push(['audit', 'clock', 'Audit history']);
    if (isAdmin() && has('settings.manage'))
      items.push(['settings', 'settings', 'School settings']);
    if (isAdmin() && has('template.manage')) items.push(['template', 'file', 'Diary template']);
    if (has('communication.use')) items.push(['messages', 'users', 'Communication']);
    if (state.user.role === 'super_admin' && has('communication.oversight'))
      items.push(['oversight', 'users', 'Communication oversight']);
    return items;
  }
  const selectionCell = (d) =>
    `<label class="checkbox"><input type="checkbox" data-bulk-id="${esc(d.id)}" aria-label="Select diary for ${esc(d.snapshot.teacher_name || d.snapshot.meta.class_name)} on ${esc(d.diary_date)}"></label>`;
  // Diary records as cards: readable on phones, tidy on desktop.
  function diaryCards(rows, { selectable = false, consolidated = false } = {}) {
    if (!rows.length) return empty('No diaries to show', 'Try different filters.');
    return `<div class="diary-cards" role="list">${rows
      .map((d) => {
        const subjects = [...new Set(d.content.homework_rows.map((r) => r.subject))],
          shown = subjects.slice(0, 6),
          who = consolidated
            ? d.contributors.length + ' teacher' + (d.contributors.length === 1 ? '' : 's')
            : d.snapshot.teacher_name || 'Teacher not recorded',
          href = consolidated ? classDiaryLink(d) : '#/schooldiaries?id=' + d.id;
        return `<article class="diary-card" role="listitem">${
          selectable ? `<div class="diary-card-select">${selectionCell(d)}</div>` : ''
        }<div class="diary-card-body"><div class="diary-card-top"><div><strong class="diary-card-title">${esc(d.snapshot.meta.class_name)} / ${esc(d.snapshot.meta.section_name)}</strong><span class="diary-card-date">${esc(displayDate(d.diary_date))}</span></div>${badge(d.status)}</div><div class="diary-card-who">${esc(who)}</div>${
          shown.length
            ? `<div class="diary-card-subjects">${shown.map((x) => `<span class="subject-tag">${esc(x)}</span>`).join('')}${subjects.length > shown.length ? `<span class="subject-tag more">+${subjects.length - shown.length}</span>` : ''}</div>`
            : ''
        }</div><div class="diary-card-open">${link('Open', href, 'button small')}</div></article>`;
      })
      .join('')}</div>`;
  }
  const diaryTable = (rows, selectable = false) => diaryCards(rows, { selectable });
  async function dashboard(q) {
    const data = await api(
      '/api/school/dashboard?' + params({ date: q.date || today(), ...(q.campus ? { campus: q.campus } : {}) }),
    );
    if (data.parent) {
      $('#content').innerHTML =
        heading('Your child’s school day', 'Approved homework, together in one place.') +
        `<div class="hero"><div><div class="eyebrow">ELITE SCHOLARS · FAMILY</div><h2>Welcome, ${esc(state.user.name.split(' ')[0])}.</h2><p>Only approved diaries from your linked classes are shared here.</p>${link('View approved diaries', '#/family', 'button primary')}</div><img class="school-emblem" src="/assets/official-school-logo.jpeg" alt="Elite Scholars school logo"></div>` +
        card(
          'Your school connection',
          `<div class="cardbody"><p>${data.linkedSections} linked class sections · ${data.publishedDates} published dates</p>${!data.linkedSections ? '<p>Contact the school administrator to link your child’s class.</p>' : ''}</div>`,
        );
      return;
    }
    const c = data.counts,
      s = state.schoolConfig;
    $('#content').innerHTML =
      heading(
        roles[state.user.role] + ' overview',
        'One class diary. Clear responsibilities. A connected school day.',
        has('diary.create') ? link('Write diary', '#/new', 'button primary') : '',
      ) +
      `<div class="hero"><div><div class="eyebrow">${displayDate(data.date)} · LEARN • GROW • SUCCEED</div><h2>Welcome, ${esc(state.user.name.split(' ')[0])}.</h2><p>${state.user.role === 'teacher' ? 'Bring today’s homework together, then send it to your Head Teacher.' : state.user.role === 'head_teacher' ? 'Review your teachers’ class diaries and share approved learning with families.' : 'A clear view of class diaries, school responsibilities and the next action.'}</p></div><img class="school-emblem" src="/assets/official-school-logo.jpeg" alt="Elite Scholars school logo"></div>` +
      ((!s?.nodes.length || !s?.assignments.length) && has('structure.manage')
        ? card(
            'Start with your school',
            `<div class="cardbody setup-steps">${link('1. Branches, campuses & classes', '#/academics')}${link('2. User Management (campus & hierarchy)', '#/users')}${link('3. Section subjects & assignments', '#/timetable')}${link('4. Link parent accounts', '#/parents')}</div>`,
          )
        : '') +
      `<div class="stats">${[
        ['Expected', c.expected],
        ['Submitted', c.submitted],
        ['Pending review', c.pending],
        ['Approved', c.approved],
        ['Returned', c.returned],
        ['Drafts', c.drafts],
        ['Overdue', c.overdue],
      ]
        .map(
          ([label, value]) =>
            `<article class="stat"><span class="label">${label}</span><strong>${value || 0}</strong><span class="foot">Class diaries today</span></article>`,
        )
        .join('')}</div>` +
      (data.monitoring ? '<div id="overview-monitoring"></div>' : '') +
      card(
        'Words for the day',
        `<div class="cardbody">${data.quotes.map((q) => `<blockquote class="quote-text" lang="${q.language}" dir="${q.direction}">${esc(q.text)}</blockquote>`).join('') || '<p class="muted">No school-wide quote scheduled for today.</p>'}</div>`,
      );
    if (data.monitoring)
      mountMonitoring($('#overview-monitoring'), {
        data: data.monitoring,
        api,
        esc,
        onFilter: (filters) => {
          location.hash = '#/dashboard?' + params(filters);
        },
      });
  }
  async function structure(q) {
    if (!q.kind || q.kind === 'setup') return workspace.page(q);
    const s = state.schoolConfig,
      kind = q.kind === 'section' ? 'class' : q.kind || 'branch',
      types = {
        branch: 'Branches',
        campus: 'Campuses',
        class: 'Classes and Sections',
        subject: 'Subjects',
        session: 'Academic sessions',
      },
      rows = ['branch', 'campus'].includes(kind)
        ? s.nodes.filter((x) => x.kind === kind)
        : academic(s, kind);
    const manage = (x) =>
      (has('structure.edit')
        ? button('Edit / archive', 'school-edit-structure', 'small', `data-id="${x.id}"`)
        : '') +
      (has('structure.delete')
        ? button('Delete unused', 'school-delete-structure', 'small', `data-id="${x.id}"`)
        : '') +
      forceButton(['branch', 'campus'].includes(x.kind) ? 'node' : 'academic', x.id);
    const add = has('structure.create')
      ? kind === 'class'
        ? button('Add Class and Section', 'school-add-class-section', 'primary')
        : button('Add ' + kind, 'school-add-structure', 'primary', `data-kind="${kind}"`)
      : '';
    if (kind === 'subject')
      rows.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0) || a.id.localeCompare(b.id));
    const subjectRows = () =>
      rows.map((x) => {
        const saved = subjectAssignments(s, x.id),
          campusName = (classId) =>
            s.nodes.find(
              (n) => n.id === s.classCampuses.find((c) => c.class_id === classId)?.campus_id,
            )?.name || 'Not assigned';
        const campuses =
          saved.campuses.map((c) => esc(c.name)).join('<br>') ||
          '<span class="muted">Not assigned</span>';
        const classes =
          saved.classes.map((c) => esc(campusName(c.id) + ' / ' + c.name)).join('<br>') ||
          '<span class="muted">Not assigned</span>';
        const sections = saved.sections.length
          ? `<details><summary>${saved.sections.length} section${saved.sections.length === 1 ? '' : 's'} · View details</summary><ul>${saved.sections.map((sec) => `<li>${esc(campusName(sec.parent_id) + ' / ' + sectionName(s, sec.id))}${sec.active ? '' : ' · Archived'}</li>`).join('')}</ul></details>`
          : '<span class="muted">Not assigned</span>';
        return [
          esc(x.name),
          campuses,
          classes,
          sections,
          esc(x.priority ?? 0),
          badge(x.active ? 'active' : 'archived'),
          manage(x),
        ];
      });
    const contents =
      kind === 'subject'
        ? '<div class="cardbody subject-search"><label class="field">Search subjects, campuses or classes<input type="search" id="subject-search" placeholder="Find a subject or assignment"></label><label class="field">Status<select id="subject-status"><option value="">All statuses</option><option value="active">Active</option><option value="archived">Archived</option></select></label><p data-subject-results role="status"></p></div><div id="subject-management-list">' +
          table(
            [
              'Subject Name',
              'Assigned Campus',
              'Assigned Classes',
              'Assigned Sections',
              'Priority',
              'Status',
              'Manage',
            ],
            subjectRows(),
          ) +
          '</div>'
        : kind === 'class'
          ? table(
              ['Campus', 'Class', 'Sections', 'Status', 'Manage'],
              rows.map((x) => [
                esc(name(s, s.classCampuses.find((c) => c.class_id === x.id)?.campus_id)),
                esc(x.name),
                academic(s, 'section')
                  .filter((section) => section.parent_id === x.id)
                  .map(
                    (section) =>
                      `<div><strong>${esc(section.name)}</strong> ${badge(section.active ? 'active' : 'archived')} ${manage(section)}</div>`,
                  )
                  .join('') || '<span class="muted">No sections yet.</span>',
                badge(x.active ? 'active' : 'archived'),
                manage(x),
              ]),
            )
          : table(
              [
                'Name',
                ...(kind === 'subject' ? ['Priority'] : []),
                'Parent / dates',
                'Status',
                'Manage',
              ],
              rows.map((x) => [
                esc(x.name),
                ...(kind === 'subject' ? [esc(x.priority ?? 0)] : []),
                esc(
                  x.parent_id
                    ? name(s, x.parent_id)
                    : [x.start_date, x.end_date].filter(Boolean).join(' → '),
                ),
                badge(x.active ? 'active' : 'archived'),
                manage(x),
              ]),
            );
    $('#content').innerHTML =
      heading(
        'School structure',
        'Branch → Campus → Class and Sections. Manage subject assignments through Add Subject and Edit / archive.',
        add,
      ) +
      workspace.tabs(kind) +
      card(types[kind], contents);
    if (kind === 'session' && isAdmin() && has('structure.edit')) {
      $('#content').insertAdjacentHTML(
        'beforeend',
        card(
          'Current academic session',
          `<form class="cardbody form-grid" id="school-current-session">${select(
            'Session for new teaching assignments',
            'session_id',
            rows.filter((row) => row.active),
            state.school?.assignmentSessionId || '',
            'required',
          )}<p class="muted">The session must cover the teaching day. Existing assignments and diary history keep their original session.</p>${actions}</form>`,
        ),
      );
      form('school-current-session', async (data) => {
        await api('/api/assignment-session', { method: 'POST', body: data });
        (state.school ||= {}).assignmentSessionId = data.session_id;
        toast('Current session updated. Existing records were preserved.');
        await render();
      });
    }
    if (kind === 'subject') {
      const filterSubjects = () => {
        const query = $('#subject-search').value.trim().toLowerCase(),
          status = $('#subject-status').value,
          tableRows = $$('#subject-management-list tbody tr');
        let shown = 0;
        tableRows.forEach((row, index) => {
          row.hidden =
            !row.textContent.toLowerCase().includes(query) ||
            (!!status && (rows[index]?.active ? 'active' : 'archived') !== status);
          if (!row.hidden) shown++;
        });
        $('[data-subject-results]').textContent = shown + ' of ' + rows.length + ' subjects';
      };
      $('#subject-search').addEventListener('input', filterSubjects);
      $('#subject-status').addEventListener('change', filterSubjects);
      filterSubjects();
      const labels = [
        'Subject Name',
        'Assigned Campus',
        'Assigned Classes',
        'Assigned Sections',
        'Priority',
        'Status',
        'Manage',
      ];
      $$('#subject-management-list tbody tr').forEach((row) =>
        [...row.children].forEach((cell, i) => {
          cell.dataset.label = labels[i];
          cell.innerHTML = '<div class="subject-cell-value">' + cell.innerHTML + '</div>';
        }),
      );
    }
  }

  async function people() {
    if (!isAdmin() || !has('people.manage'))
      throw Error('User Management is restricted to authorized administrators.');
    const users = await api('/api/school/people'),
      superAdmin = state.user.role === 'super_admin',
      name = (id) => users.find((x) => x.id === id)?.name || '—',
      campusName = (id) => state.schoolConfig.nodes.find((x) => x.id === id)?.name || '—';
    state.schoolConfig.users = users;
    $('#content').innerHTML =
      heading(
        'User Management',
        'Create accounts and assign each staff member a campus. Supervisors are linked automatically by campus and can be changed here.',
        has('people.create') ? button('Add account', 'school-add-person', 'primary') : '',
      ) +
      card(
        'Find users',
        `<form id="user-management-filters" class="cardbody filters">${field('Search name or email', 'search', 'search', '', 'placeholder="Search users"')}${select(
          'Role',
          'role',
          Object.entries(roles).map(([id, name]) => ({ id, name })),
          '',
        )}${select(
          'Account status',
          'status',
          [
            { id: 'active', name: 'Active' },
            { id: 'inactive', name: 'Inactive' },
          ],
          'active',
        )}<button type="reset">Clear filters</button></form>`,
      ) +
      card('School accounts', '<div id="user-management-list"></div>');
    const filters = $('#user-management-filters');
    function display() {
      const search = $('[name=search]', filters).value.trim().toLowerCase(),
        role = $('[name=role]', filters).value,
        status = $('[name=status]', filters).value,
        rows = users.filter(
          (u) =>
            (!search || (u.name + ' ' + u.email).toLowerCase().includes(search)) &&
            (!role || u.role === role) &&
            (!status || (u.active ? 'active' : 'inactive') === status),
        );
      $('#user-management-list').innerHTML =
        '<p class="cardbody muted" role="status">' +
        rows.length +
        ' of ' +
        users.length +
        ' accounts</p>' +
        (rows.length
          ? table(
              ['Name / email', 'Role', 'Campus / reports to', ...(superAdmin ? ['Password'] : []), 'Status', 'Manage'],
              rows.map((u) => [
                esc(u.name) + '<small>' + esc(u.email) + '</small>',
                roles[u.role],
                esc(campusName(u.campus_id)) +
                  (u.reports_to ? '<small>Reports to ' + esc(name(u.reports_to)) + '</small>' : ''),
                ...(superAdmin ? [passwordCell(u)] : []),
                badge(u.active ? 'active' : 'inactive'),
                (has('people.edit')
                  ? button('Edit account', 'school-edit-person', 'small', `data-id="${u.id}"`)
                  : '') +
                  (has('people.delete') &&
                  state.user.role === 'super_admin' &&
                  u.id !== state.user.id &&
                  u.role !== 'super_admin'
                    ? button('Delete unused', 'school-delete-person', 'small', `data-id="${u.id}"`)
                    : '') +
                  forceButton('user', u.id),
              ]),
            )
          : empty('No matching users', 'Change or clear the filters to find an account.'));
    }
    filters.addEventListener('input', display);
    filters.addEventListener('change', display);
    filters.addEventListener('submit', (e) => e.preventDefault());
    filters.addEventListener('reset', () =>
      queueMicrotask(() => {
        $$('[name]', filters).forEach((x) => (x.value = ''));
        display();
      }),
    );
    display();
  }
  // Super Admin only: the password an administrator issued, until the user replaces it.
  function passwordCell(u) {
    if (u.temporary_password)
      return `<details><summary>Show</summary><code>${esc(u.temporary_password)}</code><small>Temporary — user must change it at first sign-in</small></details><details><summary>All fields</summary>${accountFields(u)}</details>`;
    const state_ = u.must_change_password
      ? u.password_vault
        ? 'Temporary password unavailable'
        : 'Not stored (encryption key not set)'
      : 'Changed by the user';
    return `<small>${state_}</small><details><summary>All fields</summary>${accountFields(u)}</details>`;
  }
  function accountFields(u) {
    return `<dl class="muted"><dt>ID</dt><dd>${esc(u.id)}</dd><dt>Created</dt><dd>${displayDate(u.created_at)}</dd><dt>Updated</dt><dd>${displayDate(u.updated_at)}</dd><dt>Must change password</dt><dd>${u.must_change_password ? 'Yes' : 'No'}</dd><dt>Two-step sign-in</dt><dd>${u.mfa_enabled ? 'On' : 'Off'}</dd></dl>`;
  }
  async function deletedRecords() {
    const records = await api('/api/school/deleted-records');
    $('#content').innerHTML =
      heading(
        'Deleted records',
        'Read-only historical references and deletion decisions. These records cannot be selected or reactivated in normal management.',
      ) +
      card(
        'Preserved deletion history',
        table(
          ['Record', 'Deleted by / when', 'Reason / impact', 'Historical information'],
          records.map((record) => [
            esc(record.record_name) +
              '<small>' +
              esc(record.snapshot.kind || record.record_type) +
              '</small>',
            esc(record.actor) + '<small>' + displayDate(record.created_at) + '</small>',
            esc(record.reason) +
              '<small>' +
              esc(JSON.stringify(record.impact.summary)) +
              '</small>',
            (record.record_type === 'diary'
              ? link('Open historical diary', '#/schooldiaries?id=' + record.record_id)
              : record.record_type === 'legacy_diary'
                ? link('Open historical diary', '#/diary?id=' + record.record_id)
                : '') +
              '<details><summary>View preserved record</summary><pre class="preserve-lines">' +
              esc(JSON.stringify(historicalDisplay(record.snapshot), null, 2)) +
              '</pre></details>',
          ]),
        ),
      );
  }
  async function teamPage() {
    const data = await api('/api/school/hierarchy'),
      name = (id) => data.users.find((x) => x.id === id)?.name || 'Unavailable staff member',
      rows = [
        ...data.hierarchy.map((r) => [r.coordinator_id, r.head_id, 'Head Teacher']),
        ...data.reviewers.map((r) => [r.head_id, r.teacher_id, 'Teacher']),
      ].map(([parent, child, role]) => [esc(name(parent)), esc(name(child)), role]);
    $('#content').innerHTML =
      heading('My team', 'Staff connected to you. An administrator manages these links in User Management.') +
      card('Team', table(['Supervisor', 'Staff member', 'Role'], rows));
  }

  function teacherAssignmentTable(s) {
    const groups = new Map();
    for (const assignment of s.assignments) {
      const teacher = s.users.find((x) => x.id === assignment.teacher_id);
      if (teacher && !teacher.active) continue;
      if (!groups.has(assignment.teacher_id)) groups.set(assignment.teacher_id, []);
      groups.get(assignment.teacher_id).push(assignment);
    }
    const priority = (a) => s.academics.find((x) => x.id === a.subject_id)?.priority ?? 0;
    const location = (a) => {
      const campus = s.nodes.find(
        (x) =>
          x.id ===
          (a.meta?.campus_id ||
            s.classCampuses.find(
              (c) => c.class_id === s.academics.find((sec) => sec.id === a.section_id)?.parent_id,
            )?.campus_id),
      );
      return (campus ? campus.name + ' · ' : '') + sectionName(s, a.section_id);
    };
    const rows = [...groups.entries()]
      .sort(
        ([id, a], [otherId, b]) =>
          a[0].teacher_name.localeCompare(b[0].teacher_name) || id.localeCompare(otherId),
      )
      .map(([teacherId, assignments]) => {
        const heads = [...new Map(assignments.map((a) => [a.head_id, a.head_name])).values()],
          sections = [...new Map(assignments.map((a) => [a.section_id, location(a)])).values()];
        const subjects = [...new Map(assignments.map((a) => [a.subject_id, a])).values()].sort(
          (a, b) => priority(a) - priority(b) || a.subject_id.localeCompare(b.subject_id),
        );
        const active = assignments.filter((a) => a.active).length,
          archived = assignments.length - active;
        const details = [...assignments]
          .sort(
            (a, b) =>
              location(a).localeCompare(location(b)) ||
              priority(a) - priority(b) ||
              a.id.localeCompare(b.id),
          )
          .map((a) => {
            const controls =
              (has('assignments.edit')
                ? button(
                    'Edit assignment',
                    'school-edit-assignment',
                    'small',
                    `data-id="${a.id}"`,
                  ) +
                  button(
                    a.active ? 'Archive' : 'Activate',
                    'school-toggle-assignment',
                    'small',
                    `data-id="${a.id}" data-active="${!a.active}"`,
                  )
                : '') +
              (has('assignments.delete')
                ? button('Delete unused', 'school-delete-assignment', 'small', `data-id="${a.id}"`)
                : '') +
              forceButton('assignment', a.id);
            return `<div class="teacher-assignment-item" data-assignment-id="${esc(a.id)}"><strong>${esc(location(a))} — ${esc(a.subject_name)}</strong><small>${esc(a.weekdays.map((day) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day]).join(', '))} · Submission ${esc(a.due_time)} · Review ${esc(a.review_time)} · ${esc(a.head_name)}</small>${badge(a.active ? 'active' : 'archived')}${controls ? '<div class="actions">' + controls + '</div>' : ''}</div>`;
          })
          .join('');
        return [
          esc(assignments[0].teacher_name) + '<small>' + heads.map(esc).join('<br>') + '</small>',
          sections.map(esc).join('<br>'),
          subjects.map((a) => esc(a.subject_name)).join('<br>'),
          (active ? badge('active') + ' ' + active : '') +
            (active && archived ? '<br>' : '') +
            (archived ? badge('archived') + ' ' + archived : ''),
          `<details class="teacher-assignment-details"><summary>${has('assignments.edit') || has('assignments.delete') ? 'Manage' : 'View'} ${assignments.length} assignment${assignments.length === 1 ? '' : 's'}</summary>${details}</details>`,
        ];
      });
    return (
      '<div id="teacher-assignment-list">' +
      table(
        ['Teacher / Head', 'Classes / sections', 'Subjects', 'Status', 'Assignments / Manage'],
        rows,
      ) +
      '</div>'
    );
  }
  // Load per teacher: active assignments, classes and subjects. Bars compare teachers with each other.
  function workloadSummary(s) {
    const teachers = s.users.filter((x) => x.active && x.role === 'teacher'),
      load = teachers
        .map((t) => {
          const mine = s.assignments.filter((a) => a.teacher_id === t.id && a.active);
          return {
            name: t.name,
            count: mine.length,
            classes: new Set(mine.map((a) => a.section_id)).size,
            subjects: new Set(mine.map((a) => a.subject_id)).size,
          };
        })
        .sort((x, y) => y.count - x.count || x.name.localeCompare(y.name)),
      most = Math.max(1, ...load.map((x) => x.count));
    return load.length
      ? `<div class="cardbody ta-load-list">${load
          .map((x) =>
            x.count
              ? `<div class="ta-load"><div class="ta-load-head"><strong>${esc(x.name)}</strong><span>${x.count} active</span></div><meter min="0" max="${most}" value="${x.count}" aria-label="Active assignments for ${esc(x.name)}"></meter><small>${x.classes} section${x.classes === 1 ? '' : 's'} · ${x.subjects} subject${x.subjects === 1 ? '' : 's'}</small></div>`
              : `<div class="ta-load"><div class="ta-load-head"><strong>${esc(x.name)}</strong>${badge('none')}</div><small>No assignments yet</small></div>`,
          )
          .join('')}</div>`
      : empty('No teachers yet', 'Create teacher accounts in User Management first.');
  }
  async function timetable() {
    const s = state.schoolConfig,
      step = (n, title, body) =>
        `<section class="ta-step"><h3><span class="ta-num">${n}</span>${title}</h3>${body}</section>`;
    $('#content').innerHTML =
      heading(
        'Teacher assignments',
        'Only assigned class-section-subject combinations are available when a teacher writes a diary.',
      ) +
      `<div class="ta-layout">${card(
        'Assign teaching responsibilities',
        `<form id="school-assign" class="cardbody ta-form">${step(
          1,
          'Teacher',
          select(
            'Teacher',
            'teacher_id',
            s.users.filter((x) => x.active && x.role === 'teacher'),
            '',
            'required',
          ) +
            '<p class="ta-info" data-teacher-info></p><p class="muted">The current academic session is selected automatically from Academic Setup.</p>',
        )}${step(
          2,
          'Classes and subjects',
          '<p class="muted">Choose the classes to assign. Only subjects configured for their sections will appear below.</p><div data-assignment-classes></div><div data-assignment-subjects></div>',
        )}${step(
          3,
          'Schedule',
          `<fieldset><legend>Teaching weekdays</legend>${checks(
            'weekdays',
            ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((name, i) => ({
              id: String(i),
              name,
            })),
            ['1', '2', '3', '4', '5'],
          )}</fieldset><div class="form-grid">${field('Submission deadline', 'due_time', 'time', state.school.submissionTime || '16:00', 'required')}${field('Review deadline', 'review_time', 'time', state.school.reviewTime || '18:00', 'required')}</div><p class="muted">The saved Head Teacher is selected automatically. One class diary may contain several assigned subjects.</p>`,
        )}<p class="ta-summary" data-assign-summary role="status"></p><div class="alert error" data-school-error role="alert" hidden></div><button class="primary" type="submit" data-assign-submit>Assign</button></form>`,
      )}${card('Workload by teacher', workloadSummary(s))}</div>` +
      card('Assignments', teacherAssignmentTable(s));
    const formEl = $('#school-assign'),
      subjectPicker = mountAssignmentSubjects(formEl, s, { checks });
    const teacherInfo = (id) => {
      const teacher = s.users.find((x) => x.id === id);
      if (!teacher) return 'Choose a teacher to see their campus and Head Teacher.';
      const campus = s.nodes.find(
          (x) =>
            x.id ===
            (s.teacherCampuses?.find((c) => c.teacher_id === id)?.campus_id || teacher.campus_id),
        ),
        head = s.users.find(
          (x) => x.id === s.reviewers?.find((r) => r.teacher_id === id)?.head_id,
        );
      return `${campus ? 'Campus: ' + campus.name : 'No campus assigned'} · ${head ? 'Reports to ' + head.name : 'No Head Teacher linked yet'}`;
    };
    const refresh = () => {
      const pairs = subjectPicker.pairs().length,
        days = $$('input[name=weekdays]:checked', formEl).length,
        ready = $('[name=teacher_id]', formEl).value && pairs && days,
        plural = (n, one, many) => n + ' ' + (n === 1 ? one : many),
        summary = $('[data-assign-summary]', formEl);
      $('[data-teacher-info]', formEl).textContent = teacherInfo($('[name=teacher_id]', formEl).value);
      summary.className = 'ta-summary ' + (ready ? 'ok' : 'wait');
      summary.textContent = ready
        ? `Ready: ${plural(pairs, 'subject-class pair', 'subject-class pairs')}, ${plural(days, 'day', 'days')} a week.`
        : 'Choose a teacher, at least one subject and at least one teaching day.';
      $('[data-assign-submit]', formEl).textContent = pairs
        ? 'Assign ' + plural(pairs, 'responsibility', 'responsibilities')
        : 'Assign';
    };
    formEl.addEventListener('change', refresh);
    refresh();
    if (!has('assignments.create'))
      $$('input,select,button', formEl).forEach((e) => (e.disabled = true));
    form('school-assign', async (d, f) => {
      if (!d.teacher_id) throw new Error('Select a teacher.');
      if (!subjectPicker.pairs().length)
        throw new Error('Select at least one subject from the chosen classes.');
      const result = await api('/api/school/assignments', {
        method: 'POST',
        body: {
          ...d,
          pairs: subjectPicker.pairs(),
          weekdays: $$('input[name=weekdays]:checked', f).map((x) => Number(x.value)),
        },
      });
      toast(result.created.length + ' assignments added. Existing assignments preserved.');
      await render();
    });
  }
  async function calendar() {
    if (!has('structure.edit')) return;
    const lookups = await api('/api/lookups');
    $('#content').insertAdjacentHTML(
      'beforeend',
      card(
        'Holidays and calendar exceptions',
        `<form class="cardbody form-grid" id="school-calendar">${field('Date', 'date', 'date', today(), 'required')}${select(
          isAdmin() ? 'Teaching assignment (blank means school-wide)' : 'Teaching assignment',
          'assignment_id',
          state.schoolConfig.assignments.map((a) => ({
            id: a.id,
            name:
              a.teacher_name +
              ' · ' +
              sectionName(state.schoolConfig, a.section_id) +
              ' · ' +
              a.subject_name,
          })),
          '',
          isAdmin() ? '' : 'required',
        )}${field('Reason', 'reason', 'text', '', 'required maxlength="200"')}${actions}</form>` +
          table(
            ['Date', 'Reason', 'Scope', 'Action'],
            lookups.exceptions.map((e) => [
              esc(e.date),
              esc(e.reason),
              e.assignment_id ? 'Selected teaching responsibility' : 'School-wide',
              button('Remove exception', 'school-delete-exception', 'small', `data-id="${e.id}"`),
            ]),
          ),
      ),
    );
    form('school-calendar', async (data) => {
      await api('/api/exceptions', { method: 'POST', body: data });
      toast('Calendar exception saved.');
      await render();
    });
  }
  async function parents() {
    const s = state.schoolConfig,
      links = await api('/api/school/parents'),
      accounts = s.users.filter((x) => x.active && x.role === 'parent');
    const campusFor = (sectionId) => {
      const section = s.academics.find((x) => x.id === sectionId),
        campusId = s.classCampuses?.find((x) => x.class_id === section?.parent_id)?.campus_id;
      return s.nodes.find((x) => x.id === campusId);
    };
    const sectionLabel = (id) =>
      [campusFor(id)?.name, sectionName(s, id)].filter(Boolean).join(' · ');
    const sections = academic(s, 'section')
      .filter((x) => x.active)
      .map((x) => ({ id: x.id, name: sectionLabel(x.id) }));
    $('#content').innerHTML =
      heading(
        'Parent access',
        'Connect families with the right classes. Parents see only approved diaries for their linked sections.',
      ) +
      `<div class="parent-access-workspace"><div class="parent-access-summary">${[
        ['Parent accounts', accounts.length, 'Active family logins'],
        [
          'Connected families',
          new Set(links.map((x) => x.parent_id)).size,
          'Families with saved access',
        ],
        ['Section links', links.length, 'Approved diary access'],
      ]
        .map(
          ([title, count, note]) =>
            `<article><span>${title}</span><strong>${count}</strong><small>${note}</small></article>`,
        )
        .join('')}</div><div class="parent-access-grid">` +
      card(
        'Link a parent to class sections',
        `<form class="cardbody" id="school-parent-link"><div class="parent-access-intro"><span class="eyebrow">Family connections</span><p>Select a parent, then choose the class sections they can follow.</p></div>${!accounts.length ? '<div class="alert">No active parent accounts yet. Create a Parent account in User Management before linking a family.</div>' : ''}${select('Parent account', 'parent_id', accounts, '', 'required')}${field('Child name (optional label)', 'child_name', 'text', '', 'maxlength="120"')}<fieldset class="parent-section-picker"><legend>Class sections</legend>${field('Search campus, class or section', 'section_search', 'search', '', 'placeholder="Find a class or section" autocomplete="off"')}<p class="selection-count" data-parent-section-count aria-live="polite">0 sections selected</p><div data-parent-section-choices>${checks('sections', sections)}</div><p class="muted" data-parent-no-results hidden>No matching sections. Try another class or campus name.</p></fieldset>${actions}<p class="parent-access-note">Saving replaces this parent’s section links. Clear the selections to revoke access. Historical diaries remain unchanged.</p></form>`,
      ) +
      card(
        'Authorized family links',
        `<div class="cardbody parent-access-list-intro"><p>Saved connections determine which approved class diaries each family can open.</p></div>` +
          table(
            ['Parent', 'Child label', 'Campus / class / section'],
            links.map((l) => [
              esc(l.parent_name),
              esc(l.child_name || '—'),
              esc(
                [campusFor(l.section_id)?.name, l.class_name + ' / ' + l.section_name]
                  .filter(Boolean)
                  .join(' · '),
              ),
            ]),
          ),
      ) +
      '</div></div>';
    const f = $('#school-parent-link'),
      boxes = $$('input[name=sections]', f),
      updateCount = () => {
        $('[data-parent-section-count]', f).textContent =
          boxes.filter((x) => x.checked).length + ' sections selected';
      };
    $('[name=parent_id]', f).addEventListener('change', (e) => {
      boxes.forEach(
        (x) =>
          (x.checked = links.some(
            (l) => l.parent_id === e.target.value && l.section_id === x.value,
          )),
      );
      $('[name=child_name]', f).value =
        links.find((l) => l.parent_id === e.target.value)?.child_name || '';
      updateCount();
    });
    f.addEventListener('change', updateCount);
    $('[name=section_search]', f).addEventListener('input', (e) => {
      const query = e.target.value.trim().toLowerCase();
      boxes.forEach(
        (x) =>
          (x.closest('label').hidden = !x
            .closest('label')
            .textContent.toLowerCase()
            .includes(query)),
      );
      $('[data-parent-no-results]', f).hidden =
        !boxes.length || boxes.some((x) => !x.closest('label').hidden);
    });
    form('school-parent-link', async (d, f) => {
      await api('/api/school/parents', {
        method: 'PUT',
        body: {
          parent_id: d.parent_id,
          links: boxes
            .filter((x) => x.checked)
            .map((x) => ({ section_id: x.value, child_name: d.child_name })),
        },
      });
      toast('Parent access updated.');
      await render();
    });
  }
  async function editor(q) {
    const s = state.schoolConfig,
      d = q.id ? await api('/api/school/diaries/' + q.id) : null;
    state.schoolDiary = d;
    const active = s.assignments.filter(
        (a) =>
          a.active &&
          s.sectionSubjects.some(
            (x) => x.section_id === a.section_id && x.subject_id === a.subject_id,
          ),
      ),
      teacher = d?.teacher_id || q.teacher || (isAdmin() ? active[0]?.teacher_id : state.user.id),
      own = active.filter((a) => a.teacher_id === teacher),
      date = d?.diary_date || q.date || today(),
      classID = d?.snapshot.meta.class_id || q.class || own[0]?.meta.class_id,
      sections = own.filter((a) => a.meta.class_id === classID),
      sid = d?.section_id || q.section || sections[0]?.section_id;
    if (d && !['draft', 'returned'].includes(d.status)) {
      location.hash = '#/schooldiaries?id=' + d.id;
      return;
    }
    const classOptions = [
        ...new Map(
          own.map((a) => [a.meta.class_id, { id: a.meta.class_id, name: a.meta.class_name }]),
        ).values(),
      ],
      sectionOptions = [
        ...new Map(
          sections.map((a) => [a.section_id, { id: a.section_id, name: a.meta.section_name }]),
        ).values(),
      ];
    const as = own.filter(
      (a) =>
        a.section_id === sid &&
        date >= a.start_date &&
        date <= a.end_date &&
        s.sectionSubjects.some((x) => x.section_id === sid && x.subject_id === a.subject_id),
    );
    const unique = [...new Map(as.map((a) => [a.subject_id, a])).values()];
    $('#content').innerHTML =
      heading(
        d ? 'Continue class diary' : 'Write class diary',
        'Pick the day, write each subject’s homework, then submit for review.',
      ) +
      `<ol class="diary-steps" aria-label="Diary steps"><li class="done"><span>1</span>Day &amp; class</li><li class="${unique.length ? 'done' : 'now'}"><span>2</span>Subjects</li><li class="${unique.length ? 'now' : ''}"><span>3</span>Write homework</li><li><span>4</span>Preview</li><li><span>5</span>Submit</li></ol>` +
      `<div class="diary-context"><span class="diary-chip">${esc(displayDate(date))}</span><span class="diary-chip">${esc(classOptions.find((x) => x.id === classID)?.name || 'Choose class')}</span><span class="diary-chip">${esc(sectionOptions.find((x) => x.id === sid)?.name || 'Choose section')}</span><span class="diary-chip soft">${unique.length} assigned subject${unique.length === 1 ? '' : 's'}</span></div>` +
      card(
        'Choose the teaching day',
        `<form id="school-diary-filter" class="cardbody form-grid diary-picker">${field('Diary date', 'date', 'date', date, d ? 'disabled' : 'required')}${
          isAdmin()
            ? select(
                'Teacher',
                'teacher',
                s.users.filter((x) => active.some((a) => a.teacher_id === x.id)),
                teacher,
                d ? 'disabled' : 'required',
              )
            : ''
        }${select('Class', 'class', classOptions, classID, d ? 'disabled' : 'required')}${select('Section', 'section', sectionOptions, sid, d ? 'disabled' : 'required')}<button class="dark" type="submit">Load assigned subjects</button></form>`,
      ) +
      card(
        'Subjects & homework',
        unique.length
          ? `<form id="school-diary-write" class="cardbody diary-composer"><p class="muted">Tick the subjects you are completing. Only your assigned subjects can be saved. One entry is created for the complete class diary.</p>${unique
              .map((a) => {
                const row = d?.content.homework_rows.find((r) => r.subject_id === a.subject_id),
                  language = row ? subjectLanguage(row, d.language) : '';
                return `<fieldset class="school-subject subject-card" data-assignment="${a.id}"><legend><label class="checkbox"><input name="selected" type="checkbox" ${!d || row ? 'checked' : ''}>${esc(a.subject_name)}</label></legend>${select('Language', 'language', diaryLanguages, language, 'required')}<label class="field">Detail of Home Work<textarea name="detail" dir="${languageDirection(language)}" lang="${language}" maxlength="12000" rows="4">${esc(row?.detail || '')}</textarea></label><div class="actions">${[
                  ['hw', 'H.W'],
                  ['learn', 'Learn'],
                  ['test', 'Test'],
                ]
                  .map(
                    ([key, label]) =>
                      `<label class="checkbox chip-check"><input type="checkbox" name="${key}" ${row?.[key] ? 'checked' : ''}><span>${label}</span></label>`,
                  )
                  .join(
                    '',
                  )}<span class="muted">Reviewer: ${esc(a.head_name)}</span></div></fieldset>`;
              })
              .join(
                '',
              )}${d?.remarks ? `<div class="callout"><strong>Reviewer comments</strong><p>${esc(d.remarks)}</p></div>` : ''}${!d && sectionOptions.length > 1 ? `<fieldset class="school-multi-section"><legend>Also write this diary for other sections</legend><p class="muted">The same homework is saved for each ticked section, only for subjects you are assigned there. Each section keeps its own diary, status and review.</p>${sectionOptions.filter((x) => x.id !== sid).map((x) => `<label class="checkbox"><input type="checkbox" name="extra_section" value="${esc(x.id)}">${esc(x.name)}</label>`).join('')}</fieldset>` : ''}<div class="alert error" data-school-error role="alert" hidden></div><div class="diary-actionbar"><span class="diary-summary" data-diary-summary aria-live="polite"></span><div class="actions"><button type="submit" value="draft" formnovalidate>Save draft</button><button type="submit" value="preview" formnovalidate>Save & preview</button><button class="primary" type="submit" value="submit">Submit for review</button></div></div></form>`
          : empty(
              'No assigned subjects for this selection',
              'Your administrator must configure section subjects and your teaching assignments for this date.',
            ),
      );
    const filter = $('#school-diary-filter'),
      teacherSelect = $('select[name=teacher]', filter),
      classSelect = $('select[name=class]', filter),
      sectionSelect = $('select[name=section]', filter);
    const setOptions = (el, options) =>
      (el.innerHTML =
        '<option value="">Choose…</option>' +
        options.map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join(''));
    teacherSelect?.addEventListener('change', () => {
      const assignments = active.filter((a) => a.teacher_id === teacherSelect.value);
      setOptions(classSelect, [
        ...new Map(
          assignments.map((a) => [
            a.meta.class_id,
            { id: a.meta.class_id, name: a.meta.class_name },
          ]),
        ).values(),
      ]);
      setOptions(sectionSelect, []);
    });
    classSelect?.addEventListener('change', () => {
      const t = teacherSelect?.value || teacher;
      setOptions(sectionSelect, [
        ...new Map(
          active
            .filter((a) => a.teacher_id === t && a.meta.class_id === classSelect.value)
            .map((a) => [a.section_id, { id: a.section_id, name: a.meta.section_name }]),
        ).values(),
      ]);
    });
    form('school-diary-filter', async (data) => {
      if (state.dirty && !confirm('Load another selection and discard unsaved changes?')) return;
      state.dirty = false;
      location.hash = '#/new?' + params(d ? { id: d.id } : data);
      await render();
    });
    mountSubjectLanguages($('#school-diary-write'));
    const summarize = () => {
      const f = $('#school-diary-write'),
        out = f && $('[data-diary-summary]', f);
      if (!out) return;
      const cards = $$('.school-subject', f),
        picked = cards.filter((el) => $('input[name=selected]', el).checked),
        written = picked.filter((el) => $('textarea', el).value.trim()).length;
      cards.forEach((el) =>
        el.classList.toggle('is-off', !$('input[name=selected]', el).checked),
      );
      out.textContent = picked.length + ' of ' + cards.length + ' subjects selected · ' + written + ' with homework written';
    };
    $('#school-diary-write')?.addEventListener('input', summarize);
    $('#school-diary-write')?.addEventListener('change', summarize);
    summarize();
    $('#school-diary-write')?.addEventListener('change', () => (state.dirty = true));
    $('#school-diary-write')?.addEventListener('input', () => (state.dirty = true));
    form('school-diary-write', async (data, f, intent) => {
      const rows = $$('.school-subject', f)
        .filter((el) => $('input[name=selected]', el).checked)
        .map((el) => ({
          assignment_id: el.dataset.assignment,
          detail: $('textarea', el).value,
          language: $('select[name=language]', el).value,
          ...Object.fromEntries(
            ['hw', 'learn', 'test'].map((k) => [k, $('input[name=' + k + ']', el).checked]),
          ),
        }));
      const extras = d ? [] : $$('input[name=extra_section]:checked', f).map((x) => x.value),
        send = (target, targetRows) =>
          api('/api/school/diaries' + (d ? '/' + d.id : ''), {
            method: d ? 'PUT' : 'POST',
            body: {
              teacher_id: teacher,
              section_id: target,
              diary_date: date,
              subject_languages: true,
              rows: targetRows,
              version: d?.version,
              submit: intent === 'submit',
            },
          });
      const saved = await send(sid, rows);
      const failed = [];
      let savedCount = 1;
      for (const target of extras) {
        const targetRows = rows
          .map((r) => {
            const source = own.find((a) => a.id === r.assignment_id),
              match = own.find(
                (a) =>
                  a.section_id === target &&
                  a.subject_id === source?.subject_id &&
                  date >= a.start_date &&
                  date <= a.end_date &&
                  s.sectionSubjects.some(
                    (x) => x.section_id === target && x.subject_id === a.subject_id,
                  ),
              );
            return match ? { ...r, assignment_id: match.id } : null;
          })
          .filter(Boolean);
        const name = sectionOptions.find((x) => x.id === target)?.name || 'section';
        if (!targetRows.length) {
          failed.push(name + ' (no matching assigned subjects)');
          continue;
        }
        try {
          await send(target, targetRows);
          savedCount++;
        } catch (error) {
          failed.push(name + ' (' + error.message + ')');
        }
      }
      state.dirty = false;
      toast(
        (intent === 'submit'
          ? 'Class diary submitted to the assigned Head Teacher.'
          : 'Class diary saved.') +
          (extras.length
            ? ' ' + savedCount + ' of ' + (extras.length + 1) + ' sections done.' +
              (failed.length ? ' Not saved: ' + failed.join('; ') : '')
            : ''),
      );
      location.hash = extras.length
        ? '#/schooldiaries?' + params({ date, submissions: '1' })
        : '#/schooldiaries?id=' + saved.id;
    });
  }
  const classDiaryLink = (d) =>
    '#/schooldiaries?' + params({ section: d.section_id, date: d.diary_date, consolidated: 1 });
  const consolidatedTable = (rows, selectable = false) =>
    diaryCards(rows, { selectable, consolidated: true });
  async function consolidatedDetail(q) {
    const query = params({ section: q.section, date: q.date }),
      d = await api('/api/school/class-diaries/detail?' + query);
    $('#content').innerHTML =
      heading(
        d.snapshot.meta.class_name + ' / ' + d.snapshot.meta.section_name,
        displayDate(d.diary_date) +
          ' · ' +
          d.contributors.length +
          ' contributing teacher' +
          (d.contributors.length === 1 ? '' : 's'),
        link('Back to class diaries', '#/schooldiaries'),
      ) +
      card(
        'Class diary preview',
        `<div class="cardbody"><div class="actions">${has('diary.export') ? ['pdf', 'png', 'jpg', 'print'].map((format) => link(format.toUpperCase(), '/api/school/class-diaries/preview?' + query + '&format=' + format)).join('') : ''}</div><iframe class="homework-template-preview" title="Consolidated class diary preview" src="/api/school/class-diaries/preview?${query}"></iframe></div>`,
      ) +
      card(
        'Contributing submissions',
        table(
          ['Teacher', 'Subjects', 'Status', 'Original submission'],
          d.contributors.map((c) => [
            esc(c.teacher_name),
            esc(
              [
                ...new Set(
                  d.content.homework_rows
                    .filter((r) => r.contributors.some((x) => x.diary_id === c.diary_id))
                    .map((r) => r.subject),
                ),
              ].join(', '),
            ),
            badge(c.status),
            link('Open submission', '#/schooldiaries?id=' + c.diary_id),
          ]),
        ),
      ) +
      '<p class="muted">Only approved work is combined live. Review, corrections and permanent history remain on each original submission. Parents receive approved contributions only.</p>';
  }
  async function diaries(q, review = false) {
    if (q.id) return detail(q, review);
    if (q.consolidated === '1') return consolidatedDetail(q);
    const original = review || q.submissions === '1' || q.deleted === '1',
      s = state.schoolConfig,
      data = await api(
        (original ? '/api/school/diaries?' : '/api/school/class-diaries?') +
          params({ ...q, ...(review ? { status: q.status || 'pending' } : {}) }),
      );
    const reviewCounts = review
      ? data.items.reduce(
          (counts, item) => {
            counts[item.status] = (counts[item.status] || 0) + 1;
            return counts;
          },
          {},
        )
      : {};
    const reviewList = (items) =>
      items.length
        ? `<div class="review-list" role="list" aria-label="Diaries awaiting review">${items
            .map((d) => {
              const className = d.snapshot.meta.class_name || 'Class diary',
                sectionNameValue = d.snapshot.meta.section_name || 'Section not recorded',
                subjects = [...new Set(d.content.homework_rows.map((row) => row.subject))];
              return `<article class="review-item" role="listitem"><div class="review-item-select">${selectionCell(d)}</div><div class="review-item-content"><div class="review-item-heading"><div><span class="review-kicker">${esc(displayDate(d.diary_date))} · v${esc(d.version)}</span><h3>${esc(className)} <span class="review-slash">/</span> ${esc(sectionNameValue)}</h3></div>${badge(d.status)}</div><div class="review-item-meta"><span>${esc(d.snapshot.teacher_name || 'Teacher not recorded')}</span><span>${subjects.length} subject${subjects.length === 1 ? '' : 's'}</span></div><p class="review-subjects">${esc(subjects.join(' · ') || 'No subject details')}</p></div><div class="review-item-action">${link('Open review', '#/review?id=' + encodeURIComponent(d.id), 'button review-open')}</div></article>`;
            })
            .join('')}</div>`
        : `<div class="review-empty"><span class="review-empty-mark" aria-hidden="true">ES</span><h3>${q.search || q.section || q.start || q.end || (q.status && q.status !== 'pending') ? 'No diaries match this view' : 'Nothing waiting for review'}</h3><p>${q.search || q.section || q.start || q.end || (q.status && q.status !== 'pending') ? 'Adjust the filters to broaden your search, or return to the pending queue.' : 'New submissions from your assigned teachers will appear here. You are all caught up for now.'}</p>${(q.search || q.section || q.start || q.end || (q.status && q.status !== 'pending')) ? link('Show pending diaries', '#/review', 'button review-open') : '<span class="review-empty-note">The queue refreshes whenever you open this page.</span>'}</div>`;
    const queueContent =
      (review
        ? `<div class="review-overview" aria-label="Review queue summary"><div class="review-overview-intro"><span class="review-kicker">HEAD TEACHER DESK</span><strong>${esc(String(data.total))}</strong><span>matching ${data.total === 1 ? 'diary' : 'diaries'}</span></div><div class="review-overview-stats"><div><b>${reviewCounts.submitted || 0}</b><span>Submitted</span></div><div><b>${reviewCounts.resubmitted || 0}</b><span>Resubmitted</span></div><div><b>${reviewCounts.under_review || 0}</b><span>In review</span></div><small>Counts shown for this page</small></div></div>`
        : '') +
      card(
        review ? 'Refine the queue' : 'Find diaries',
        `<form id="school-diary-search" class="cardbody filters${review ? ' review-filters' : ''}">${field('From', 'start', 'date', q.start || '')}${field('To', 'end', 'date', q.end || '')}${select(
          'Section',
          'section',
          academic(s, 'section').map((x) => ({ id: x.id, name: sectionName(s, x.id) })),
          q.section || '',
        )}${select(
          'Status',
          'status',
          [
            ...(original
              ? [
                  ...(review ? ['pending'] : []),
                  'draft',
                  'submitted',
                  'resubmitted',
                  'under_review',
                  'returned',
                  'approved',
                ]
              : ['approved']),
          ].map((id) => ({ id, name: id.replaceAll('_', ' ') })),
          q.status || (review ? 'pending' : ''),
        )}${field('Search homework', 'search', 'text', q.search || '')}<button class="dark" type="submit">Apply filters</button></form>`,
      ) +
      card(
        review ? 'Teacher submissions' : 'Diary records',
        '<div id="diary-bulk">' +
          (data.items.length
            ? diaryBulkToolbar({
                mode: original ? 'submissions' : 'consolidated',
                caps: state.capabilities,
                role: state.user.role,
                trash: q.deleted === '1',
              })
            : '') +
          (review ? reviewList(data.items) : original ? diaryTable(data.items, true) : consolidatedTable(data.items, true)) +
          '</div>',
      ) +
      `<div class="pager review-pager"><span>${data.total} ${data.total === 1 ? 'diary' : 'diaries'} · Page ${data.page}</span><div class="actions">${data.page > 1 ? link('Previous', '#/' + (review ? 'review' : 'schooldiaries') + '?' + params({ ...q, page: data.page - 1 })) : ''}${data.page * 30 < data.total ? link('Next', '#/' + (review ? 'review' : 'schooldiaries') + '?' + params({ ...q, page: data.page + 1 })) : ''}${link(q.deleted === '1' ? 'Active diaries' : 'Draft trash', q.deleted === '1' ? '#/schooldiaries' : '#/schooldiaries?deleted=1') + link(q.submissions === '1' ? 'Consolidated class diaries' : 'Original teacher submissions', q.submissions === '1' ? '#/schooldiaries' : '#/schooldiaries?submissions=1') + link('Earlier teaching records', '#/legacy')}</div></div>`;
    $('#content').innerHTML =
      (review ? '<div class="review-queue">' : '') +
      heading(
        review
          ? 'Head Teacher review queue'
          : original
            ? q.deleted === '1'
              ? 'Draft trash'
              : 'Original teacher submissions'
            : 'Class diaries',
        review
          ? 'A considered review keeps every classroom in sync. Approve to publish, or return with clear guidance.'
          : 'Only approved work combined into one diary per class, section and date.',
        has('diary.create') ? link('Write diary', '#/new', 'button primary') : '',
      ) +
      queueContent +
      (review ? '</div>' : '');
    if (data.items.length)
      mountDiaryBulk($('#diary-bulk'), {
        records: data.items,
        mode: original ? 'submissions' : 'consolidated',
        api,
        refresh: render,
        requestComment: async (action) =>
          window.prompt(
            action === 'returned'
              ? 'Return comments (required for every selected diary)'
              : 'Amendment reason (at least 5 characters)',
          ),
        exportSelected: async (ids, format, mode) => {
          const url =
            (mode === 'consolidated'
              ? '/api/school/class-diaries/export?'
              : '/api/school/diaries/export?') + params({ ids: ids.join(','), format });
          const link = document.createElement('a');
          link.href = url;
          link.hidden = true;
          document.body.append(link);
          link.click();
          link.remove();
        },
        onSuccess: (record, action) => {
          const row = $('[data-bulk-id="' + record.id + '"]')?.closest('tr,.diary-card');
          const status = row?.querySelector('.badge');
          if (status)
            status.outerHTML = badge(
              action === 'trash' ? 'discarded' : action === 'restore' ? 'draft' : record.status,
            );
        },
      });
    form('school-diary-search', async (data) => {
      location.hash =
        '#/' +
        (review ? 'review' : 'schooldiaries') +
        '?' +
        params({
          ...data,
          ...(q.submissions === '1' ? { submissions: 1 } : {}),
          ...(q.deleted === '1' ? { deleted: 1 } : {}),
        });
      await render();
    });
  }
  async function detail(q, review = false) {
    const d = await api('/api/school/diaries/' + q.id),
      versions = await api('/api/school/diaries/' + q.id + '/versions');
    state.schoolDiary = d;
    const editable =
        !d.force_deleted &&
        ['draft', 'returned'].includes(d.status) &&
        (d.teacher_id === state.user.id || isAdmin()),
      reviewable =
        !d.force_deleted &&
        ['submitted', 'resubmitted', 'under_review'].includes(d.status) &&
        d.teacher_id !== state.user.id &&
        ((state.user.role === 'head_teacher' &&
          state.schoolConfig.reviewers.some(
            (r) => r.teacher_id === d.teacher_id && r.head_id === state.user.id,
          )) ||
          isAdmin() ||
          state.user.role === 'coordinator');
    $('#content').innerHTML =
      (review ? '<div class="review-detail">' : '') +
      heading(
        d.snapshot.meta.class_name + ' / ' + d.snapshot.meta.section_name,
        displayDate(d.diary_date) +
          ' · ' +
          d.snapshot.teacher_name +
          ' · ' +
          [...new Set(d.content.homework_rows.map((r) => subjectLanguage(r, d.language)))]
            .map(languageName)
            .join(' + ') +
          ' · Version ' +
          d.version,
        (review ? link('Back to review queue', '#/review', 'button review-back') : '') +
          (editable && !d.content.deleted_at && has('diary.edit')
          ? link('Edit diary', '#/new?id=' + d.id, 'button primary')
          : '') +
          (!d.force_deleted && d.status === 'draft' && has('diary.delete')
            ? button(
                d.content.deleted_at ? 'Restore draft' : 'Move draft to trash',
                'school-trash-draft',
                'small',
                `data-id="${d.id}" data-version="${d.version}" data-restore="${!!d.content.deleted_at}"`,
              )
            : '') +
          (!d.force_deleted ? forceButton('diary', d.id) : '') +
          badge(d.force_deleted ? 'deleted' : d.content.deleted_at ? 'discarded' : d.status),
      ) +
      (review
        ? `<section class="review-detail-summary" aria-label="Submission details"><div><span class="review-kicker">SUBMITTED BY</span><strong>${esc(d.snapshot.teacher_name || 'Teacher not recorded')}</strong></div><div><span class="review-kicker">DIARY DATE</span><strong>${esc(displayDate(d.diary_date))}</strong></div><div><span class="review-kicker">VERSION</span><strong>${esc(String(d.version))}</strong></div><p>Review the class diary below. Approved work becomes visible to families.</p></section>`
        : '') +
      card(
        'Class diary preview',
        `<div class="cardbody"><div class="actions">${['pdf', 'png', 'print']
          .filter(() => has('diary.export'))
          .map((format) =>
            link(format.toUpperCase(), '/api/school/diaries/' + d.id + '/preview?format=' + format),
          )
          .join(
            '',
          )}</div><iframe class="homework-template-preview" title="Class diary preview" src="/api/school/diaries/${d.id}/preview"></iframe></div>`,
      ) +
      (d.remarks
        ? card(
            'Internal review comments',
            `<div class="cardbody"><p class="preserve-lines">${esc(d.remarks)}</p><small>Comments appear to authorized staff only, never in the parent diary.</small></div>`,
          )
        : '') +
      (reviewable
        ? `<section class="card review-decision-card"><header class="cardhead"><div><span class="review-kicker">NEXT STEP</span><h2>Make a review decision</h2></div><small>Only approved diaries are shared with families</small></header><form id="school-review" class="cardbody review-decision-form"><label class="field">Comments for the teacher <span class="muted">(required when returning)</span><textarea name="remarks" maxlength="5000" rows="4" placeholder="Add clear, helpful guidance if changes are needed…"></textarea></label><div class="alert error" data-school-error role="alert" hidden></div><div class="actions">${has('diary.review') ? '<button type="submit" value="under_review">Start review</button>' : ''}${has('diary.return') ? '<button type="submit" value="returned">Return for correction</button>' : ''}${has('diary.approve') ? '<button class="primary" type="submit" value="approved">Approve & publish</button>' : ''}</div></form></section>`
        : '') +
      (!d.force_deleted && d.status === 'approved' && has('diary.amend')
        ? card(
            'Authorized amendment',
            `<form class="cardbody" id="school-amend">${field('Reason for reopening', 'reason', 'text', '', 'required minlength="5" maxlength="5000"')}${actions}<p class="muted">The original approved version remains in history. Parents will see this contribution again after it is approved.</p></form>`,
          )
        : '') +
      card(
        'Permanent workflow history',
        table(
          ['When', 'Actor', 'Action', 'Version / comments'],
          versions.map((v) => [
            displayDate(v.created_at),
            esc(v.actor_name),
            esc(v.action.replaceAll('_', ' ')),
            'v' + v.version + '<small>' + esc(v.remarks) + '</small>',
          ]),
        ),
      ) +
      (review ? '</div>' : '');
    form('school-review', async (data, f, action) => {
      await api('/api/school/diaries/' + d.id + '/review', {
        method: 'POST',
        body: { ...data, action, version: d.version },
      });
      toast('Diary ' + action.replaceAll('_', ' ') + '.');
      await render();
    });
    form('school-amend', async (data) => {
      await api('/api/school/diaries/' + d.id + '/amend', {
        method: 'POST',
        body: { ...data, version: d.version },
      });
      toast('Amendment opened with history preserved.');
      await render();
    });
  }
  async function family(q) {
    const d = await api('/api/school/family?' + params(q));
    $('#content').innerHTML =
      heading(
        'Approved class diaries',
        'Published homework from your linked classes. Staff review comments stay private.',
      ) +
      card(
        'Choose class and date',
        `<form class="cardbody filters" id="school-family-filter">${select(
          'Your child / class',
          'section',
          d.links.map((x) => ({
            id: x.section_id,
            name:
              (x.child_name ? x.child_name + ' — ' : '') + x.class_name + ' / ' + x.section_name,
          })),
          d.section || '',
          'required',
        )}${field('Diary date', 'date', 'date', d.date, 'required')}<button class="primary" type="submit">View diary</button></form>`,
      ) +
      card(
        'Published diary',
        d.available
          ? `<div class="cardbody"><div class="actions">${has('diary.export') ? ['pdf', 'png', 'print'].map((format) => link(format.toUpperCase(), '/api/school/family/preview?' + params({ section: d.section, date: d.date, format }))).join('') : ''}</div><iframe class="homework-template-preview" title="Approved family diary" src="/api/school/family/preview?${params({ section: d.section, date: d.date })}"></iframe></div>`
          : empty(
              d.links.length ? 'No approved diary for this date' : 'No class linked yet',
              d.links.length
                ? 'Choose another date, or check again after the Head Teacher approves the diary.'
                : 'Please contact the school administrator to link your child’s class.',
            ),
      ) +
      (d.dates.length
        ? card(
            'Published dates',
            `<div class="cardbody actions">${d.dates.map((date) => link(displayDate(date), '#/family?' + params({ section: d.section, date }))).join('')}</div>`,
          )
        : '');
    form('school-family-filter', async (data) => {
      location.hash = '#/family?' + params(data);
      await render();
    });
  }
  async function quotes() {
    const data = await api('/api/school/quotes');
    state.schoolQuotes = data;
    $('#content').innerHTML =
      heading(
        'Daily quotes',
        'School-wide words for the day. The selected quote is saved once in the approved diary footer.',
        has('quotes.create') ? button('Add dated quote', 'school-add-quote', 'primary') : '',
      ) +
      `<div class="callout">English, Urdu and Arabic are supported independently of diary language. The highest priority active school-wide quote for the date is selected. Existing approved diaries preserve their quote. Quotes do not send push alerts.</div>` +
      card(
        'Quote library',
        table(
          ['Quote', 'Language / scheduled date', 'Status', 'Manage'],
          data.quotes.map((q) => [
            `<p lang="${q.language}" dir="${q.direction}" class="preserve-lines">${esc(q.text)}</p>`,
            esc(q.language) +
              '<small>' +
              data.schedules
                .filter((s) => s.quote_id === q.id)
                .map((s) => esc(s.date) + ' · priority ' + s.priority)
                .join('<br>') +
              '</small>',
            badge(q.active ? 'active' : 'inactive'),
            (has('quotes.edit')
              ? button('Edit', 'school-edit-quote', 'small', `data-id="${q.id}"`) +
                button(
                  q.active ? 'Deactivate' : 'Activate',
                  'school-toggle-quote',
                  'small',
                  `data-id="${q.id}" data-active="${!q.active}"`,
                )
              : '') +
              (has('quotes.delete')
                ? button('Delete', 'school-delete-quote', 'small', `data-id="${q.id}"`)
                : '') +
              forceButton('quote', q.id),
          ]),
        ),
      );
  }
  async function diaryNotice() {
    const { notice: n } = await api('/api/school/notice');
    state.schoolNotice = n;
    const labels = { en: 'Notice', ur: 'اطلاعیہ', ar: 'إعلان' },
      hasText = !!(n.text || '').trim(),
      range =
        (n.startDate ? 'from ' + esc(n.startDate) : 'from the day it is published') +
        (n.endDate ? ' to ' + esc(n.endDate) : ' until you hide it');
    $('#content').innerHTML =
      heading(
        'Diary notice',
        'A boxed notice printed under the homework table and above the daily quote. It stays hidden until you publish it.',
        button(hasText ? 'Edit notice' : 'Write notice', 'school-edit-notice', 'primary'),
      ) +
      `<div class="callout">Status: ${badge(n.published && hasText ? 'published' : 'hidden')} ${
        n.published && hasText
          ? 'The notice is printed on diaries dated ' + range + '.'
          : 'No notice is printed on any diary.'
      } Keep it short (400 characters at most) so the diary still fits one A4 page.</div>` +
      card(
        'Preview',
        hasText
          ? `<section class="homework-notice notice-preview"><div class="homework-notice-head"><span lang="${n.language}" dir="${n.language === 'en' ? 'ltr' : 'rtl'}">${esc(labels[n.language] || 'Notice')}</span></div><div class="homework-notice-body" lang="${n.language}" dir="${n.language === 'en' ? 'ltr' : 'rtl'}">${n.title ? `<strong class="homework-notice-title">${esc(n.title)}</strong>` : ''}<p>${esc(n.text)}</p></div></section>` +
              `<div class="actions">${
                n.published
                  ? button('Hide notice', 'school-toggle-notice', '', 'data-published="false"')
                  : button('Publish notice', 'school-toggle-notice', 'primary', 'data-published="true"')
              }</div>`
          : '<p class="muted">No notice written yet. Choose “Write notice”, then publish it when you want it to appear.</p>',
      );
  }
  const permissionsUI = permissionsWorkspace({ api, state, esc, heading, toast, render, roles });
  const permissions = () => permissionsUI.page();
  function reportFilters(q, s) {
    return `<form class="cardbody filters" id="school-report-filter">${field('From', 'start', 'date', q.start || today(), 'required')}${field('To', 'end', 'date', q.end || today(), 'required')}${select(
      'Branch',
      'branch',
      s.nodes.filter((x) => x.kind === 'branch'),
      q.branch || '',
    )}${select(
      'Campus',
      'campus',
      s.nodes.filter((x) => x.kind === 'campus'),
      q.campus || '',
    )}${select('Class', 'class', academic(s, 'class'), q.class || '')}${select(
      'Section',
      'section',
      academic(s, 'section').map((x) => ({ id: x.id, name: sectionName(s, x.id) })),
      q.section || '',
    )}${select(
      'Teacher',
      'teacher',
      s.users.filter((x) => x.role === 'teacher'),
      q.teacher || '',
    )}${select('Subject', 'subject', academic(s, 'subject'), q.subject || '')}${select(
      'Status',
      'status',
      [
        'draft',
        'submitted',
        'resubmitted',
        'under_review',
        'approved',
        'returned',
        'not_submitted',
        'overdue',
      ].map((id) => ({ id, name: id.replaceAll('_', ' ') })),
      q.status || '',
    )}<button class="dark" type="submit">Apply filters</button></form>`;
  }
  async function reports(q) {
    q = { start: today(), end: today(), ...q };
    const data = await api('/api/school/reports?' + params(q)),
      s = state.schoolConfig;
    $('#content').innerHTML =
      heading(
        'Diary reports',
        'Expected class diaries, submissions and review outcomes within your authorized scope.',
        has('diary.export')
          ? ['pdf', 'png', 'print']
              .map((format) =>
                link(
                  format.toUpperCase(),
                  '/api/school/reports/export?' + params({ ...q, format }),
                ),
              )
              .join('')
          : '',
      ) +
      card('Filter diary records', reportFilters(q, s)) +
      `<div class="stats">${Object.entries(data.counts)
        .map(
          ([name, value]) =>
            `<article class="stat"><span>${esc(name)}</span><strong>${value}</strong></article>`,
        )
        .join('')}</div>` +
      card(
        'Expected class diaries',
        table(
          ['Date / teacher', 'Class / section', 'Subjects', 'Status', 'Action'],
          data.slots.map((r) => [
            displayDate(r.date) + '<small>' + esc(r.teacher_name) + '</small>',
            esc(r.class_name) + ' / ' + esc(r.section_name),
            esc(r.subjects.join(', ')),
            badge(r.status) + (r.overdue ? badge('overdue') : ''),
            r.diary_id ? link('Open', '#/schooldiaries?id=' + r.diary_id) : 'Not submitted',
          ]),
        ),
      );
    form('school-report-filter', async (data) => {
      location.hash = '#/reports?' + params(data);
      await render();
    });
  }
  async function audit(q) {
    const data = await api('/api/school/audit?' + params(q)),
      s = state.schoolConfig;
    $('#content').innerHTML =
      heading(
        'Audit history',
        'Read-only records of school changes and workflow actions. Authentication secrets are never logged.',
      ) +
      card(
        'Filter activity',
        `<form class="cardbody filters" id="school-audit-filter">${field('From', 'start', 'date', q.start || '')}${field('To', 'end', 'date', q.end || '')}${select('Actor', 'actor', s.users, q.actor || '')}${field('Action contains', 'action', 'text', q.action || '')}${field('Record identifier', 'resource', 'text', q.resource || '')}${select(
          'Record type',
          'type',
          [
            { id: 'class_diary', name: 'Class diary' },
            { id: 'school_structure', name: 'School structure' },
            { id: 'user_', name: 'Account' },
            { id: 'school_quote', name: 'Daily quote' },
            { id: 'assignment', name: 'Assignment' },
            { id: 'hierarchy', name: 'Hierarchy' },
            { id: 'parent_access', name: 'Parent access' },
            { id: 'role_capabilities', name: 'Role permissions' },
            { id: 'user_capabilities', name: 'User permissions' },
          ],
          q.type || '',
        )}${select(
          'Branch',
          'branch',
          s.nodes.filter((x) => x.kind === 'branch'),
          q.branch || '',
        )}${select(
          'Campus',
          'campus',
          s.nodes.filter((x) => x.kind === 'campus'),
          q.campus || '',
        )}${select('Class', 'class', academic(s, 'class'), q.class || '')}${select('Section', 'section', academic(s, 'section'), q.section || '')}<button class="dark" type="submit">Filter history</button></form>`,
      ) +
      card(
        'School activity',
        table(
          ['Time', 'Actor / role', 'Action', 'Reference / changes'],
          data.items.map((r) => [
            displayDate(r.created_at),
            esc(r.actor_name || 'System') +
              '<small>' +
              esc(JSON.parse(r.details || '{}').actor_role || '') +
              '</small>',
            esc(r.action.replaceAll('_', ' ')),
            esc(r.resource_id || '—') +
              '<details><summary>View recorded changes</summary><pre class="preserve-lines">' +
              esc(JSON.stringify(JSON.parse(r.details || '{}'), null, 2)) +
              '</pre></details>',
          ]),
        ),
      ) +
      `<div class="pager"><span>${data.total} events</span><div class="actions">${data.page > 1 ? link('Previous', '#/audit?' + params({ ...q, page: data.page - 1 })) : ''}${data.page * 100 < data.total ? link('Next', '#/audit?' + params({ ...q, page: data.page + 1 })) : ''}</div></div>`;
    form('school-audit-filter', async (data) => {
      location.hash = '#/audit?' + params(data);
      await render();
    });
  }
  async function notifications() {
    const [rows, pref] = await Promise.all([api('/api/school/alerts'), api('/api/school/push')]);
    state.schoolPush = pref;
    const status = await pushStatus(pref),
      view = {
        on: ['good', 'On for this device', 'Diary alerts reach this device automatically, even when the app is closed or in the background.'],
        prompt: ['wait', 'Waiting for your permission', 'Tap “Allow notifications” and choose Allow in the browser prompt. This is the only step the browser asks you to do yourself.'],
        denied: ['bad', 'Blocked in this browser', 'Notifications are blocked for this site. Open your browser or phone settings for this site, set Notifications to Allow, then reload.'],
        off: ['wait', 'Turned off on this device', 'You turned alerts off here. Turn them on again to receive diary updates.'],
        ios_install: ['wait', 'Add the app to your Home Screen', 'On iPhone and iPad, alerts work only from the installed app: tap Share, choose Add to Home Screen, open the app from your Home Screen, then sign in again.'],
        unsupported: ['bad', 'Not supported in this browser', 'Use Chrome, Edge, Firefox or Safari (installed to the Home Screen on iPhone) to receive device alerts. Updates still appear below.'],
        not_configured: ['bad', 'Not set up by the school yet', 'The administrator has not finished push setup. Updates still appear below.'],
        error: ['bad', 'Could not link this device', 'Check your connection and reload. If it keeps happening, turn notifications off and on again.'],
      }[status] || ['wait', 'Checking', ''],
      buttons =
        (['prompt', 'off', 'denied'].includes(status) && status !== 'denied'
          ? button('Allow notifications', 'school-enable-push', 'primary')
          : '') +
        (status === 'on' ? button('Send test alert', 'school-test-push', 'primary') : '') +
        (status === 'on' ? button('Turn off on this device', 'school-disable-push', '') : '') +
        (pref.devices > 1 ? button('Turn off on all my devices', 'school-disable-all-push', 'small') : '');
    $('#content').innerHTML =
      heading(
        'Notifications',
        'Important diary updates stay here, and reach your phone or computer as they happen.',
        button('Mark all read', 'school-read-all', 'small'),
      ) +
      `<section class="push-panel ${view[0]}"><div class="push-state"><span class="push-dot"></span><div><strong>${esc(view[1])}</strong><p>${esc(view[2])}</p><small>${pref.devices} linked device${pref.devices === 1 ? '' : 's'} on your account</small></div></div><div class="actions">${buttons}</div></section>` +
      card(
        'Your updates',
        rows.length
          ? rows
              .map(
                (n) =>
                  `<div class="notification ${n.read_at ? '' : 'unread'}"><div><p>${esc(n.message)}</p><small>${displayDate(n.created_at)}</small></div><div class="actions">${n.url ? link('Open', n.url) : ''}${!n.read_at ? button('Mark read', 'school-read-alert', 'small', `data-id="${n.id}"`) : ''}</div></div>`,
              )
              .join('')
          : empty('You’re all caught up', 'Diary updates and deadlines will appear here.'),
      );
  }
  async function route(path, q) {
    const routes = {
      dashboard: () => dashboard(q),
      academics: () => structure(q),
      users: people,
      hierarchy: teamPage,
      deleted: deletedRecords,
      timetable,
      parents,
      permissions,
      new: () => editor(q),
      schooldiaries: () => diaries(q),
      diaries: () => diaries(q),
      review: () => diaries(q, true),
      family: () => family(q),
      quotes,
      notice: diaryNotice,
      reports: () => reports(q),
      audit: () => audit(q),
      notifications,
    };
    if (!routes[path]) return false;
    await config();
    if (state.user.role === 'parent' && !['dashboard', 'family', 'notifications'].includes(path))
      throw Error('Parents can access approved family diaries only.');
    await routes[path]();
    if (path === 'timetable') await calendar();
    return true;
  }
  async function click(action, target) {
    if (workspace.isMine(action)) return workspace.click(action, target);
    if (permissionsUI.isMine(action)) return permissionsUI.click(action, target);
    const s = state.schoolConfig;
    if (action === 'school-delete-exception') {
      if (!window.confirm('Remove this calendar exception? Historical diaries are preserved.'))
        return;
      await api('/api/exceptions/' + target.dataset.id, { method: 'DELETE' });
      toast('Calendar exception removed.');
      await render();
      return;
    }
    if (action === 'school-trash-draft') {
      const restore = target.dataset.restore === 'true';
      await api('/api/school/diaries/' + target.dataset.id + (restore ? '/restore' : ''), {
        method: restore ? 'POST' : 'DELETE',
        body: { version: Number(target.dataset.version) },
      });
      toast(restore ? 'Draft restored.' : 'Draft moved to Trash. Its history is preserved.');
      location.hash = restore
        ? '#/schooldiaries?id=' + target.dataset.id
        : '#/schooldiaries?deleted=1';
      await render();
    }
    if (action === 'school-force-delete') {
      if (!canForce()) throw Error('Force Delete is restricted to authorized administrators.');
      const type = target.dataset.type,
        id = target.dataset.id,
        impact = await api('/api/school/force-delete/' + type + '/' + id);
      const labels = {
        academic: 'Academic records',
        assignment: 'Teacher assignments',
        node: 'School units',
        user: 'Accounts',
        diary: 'Diaries',
        legacy_diary: 'Teacher diaries',
        quote: 'Quotes',
      };
      const summary = Object.entries(impact.summary)
        .map(([kind, count]) => esc(labels[kind] || kind) + ': ' + count)
        .join(' · ');
      modal(
        'Force Delete',
        '<p><strong>' +
          esc(impact.name) +
          '</strong> · ' +
          esc(impact.recordKind || impact.type) +
          '</p><div class="alert error">This record will be removed from normal active views and selection lists. Related diary entries, approvals, names, dates, reports and audit history will remain readable. Historical information stays available under Deleted records and in historical diary views.</div><p>Affected records: ' +
          summary +
          '</p><p>Historical diaries preserved: ' +
          impact.history.diaries +
          ' (' +
          impact.history.approved +
          ' approved). Hierarchy relationships retained for history: ' +
          impact.dependentRelationships +
          '.</p>' +
          field(
            'Reason for deletion',
            'reason',
            'text',
            '',
            'required minlength="5" maxlength="2000"',
          ) +
          field('Type the exact record name', 'confirm_name', 'text', '', 'required') +
          field(
            'Type FORCE DELETE',
            'confirmation',
            'text',
            '',
            'required pattern="FORCE DELETE"',
          ) +
          (impact.requiresAdditionalConfirmation
            ? '<label class="checkbox"><input name="confirm_related" type="checkbox" required>I reviewed the affected records and understand that active responsibilities will be removed while historical information is preserved.</label>'
            : ''),
        async (d) => {
          if (d.confirm_name !== impact.name || d.confirmation !== 'FORCE DELETE')
            throw Error('Type the exact record name and FORCE DELETE.');
          await api('/api/school/force-delete/' + type + '/' + id, {
            method: 'POST',
            body: { ...d, confirm_related: !!d.confirm_related, fingerprint: impact.fingerprint },
          });
          toast('Record force-deleted. Historical information is preserved.');
          if ((type === 'diary' || type === 'legacy_diary') && state.route !== 'deleted')
            location.hash = '#/deleted';
        },
      );
      $('#modal')?.classList.add('force-delete-dialog');
      const submit = $('#modal-form button[type=submit]');
      if (submit) submit.textContent = 'Force Delete';
      return;
    }
    if (
      action === 'school-add-class-section' ||
      (action === 'school-add-structure' && ['class', 'section'].includes(target.dataset.kind))
    ) {
      modal(
        'Add Class and Section',
        select(
          'Parent Campus',
          'parent_id',
          s.nodes.filter((x) => x.kind === 'campus' && x.active),
          '',
          'required',
        ) +
          field('Class name', 'name', 'text', '', 'required maxlength="100"') +
          '<label class="field">Section names (one per line)<textarea name="sections" rows="5" maxlength="5100" required placeholder="A&#10;B&#10;C"></textarea></label><p class="muted">Add one or more sections here. If the class already exists in this campus, new sections are added to it.</p>',
        async (d) => {
          const input = validateClassSections(d, s);
          await api('/api/school/structure', {
            method: 'POST',
            body: { kind: 'class_sections', ...input },
          });
          toast('Class and Sections saved.');
        },
      );
      return;
    }
    const editSubject =
      action === 'school-edit-structure'
        ? s.academics.find((x) => x.id === target.dataset.id && x.kind === 'subject')
        : null;
    if ((action === 'school-add-structure' && target.dataset.kind === 'subject') || editSubject) {
      const saved = editSubject
          ? subjectAssignments(s, editSubject.id)
          : { sections: [], classes: [], campuses: [] },
        sectionIds = saved.sections.map((x) => x.id);
      const classOnly = saved.classes.filter(
          (c) => !saved.sections.some((sec) => sec.parent_id === c.id),
        ),
        classOnlyIds = classOnly.map((c) => c.id);
      let selected = () => sectionIds;
      const campuses = s.nodes.filter(
          (x) => x.kind === 'campus' && (x.active || saved.campuses.some((c) => c.id === x.id)),
        ),
        campus = saved.campuses[0]?.id || '';
      modal(
        editSubject ? 'Edit Subject' : 'Add Subject',
        '<div class="subject-assignment-form">' +
          field(
            'Subject Name',
            'name',
            'text',
            editSubject?.name || '',
            'required maxlength="100" placeholder="Enter subject name"',
          ) +
          field(
            'Subject Priority',
            'priority',
            'number',
            editSubject?.priority ?? 0,
            'required min="0" max="1000000" step="1"',
          ) +
          select('Assign to Campus', 'campus_id', campuses, campus, editSubject ? '' : 'required') +
          '<fieldset class="subject-assignment-tree"><legend>Classes / Sections</legend><div data-subject-tree></div></fieldset><p class="muted" data-subject-count role="status" aria-live="polite">0 sections selected</p>' +
          (editSubject
            ? (classOnly.length
                ? '<fieldset><legend>Existing class-only assignments</legend>' +
                  checks(
                    'class_only_ids',
                    classOnly.map((c) => ({
                      id: c.id,
                      name:
                        name(s, s.classCampuses.find((m) => m.class_id === c.id)?.campus_id) +
                        ' / ' +
                        c.name,
                    })),
                    classOnlyIds,
                  ) +
                  '<p class="muted">These saved class assignments have no selected sections. Keep them selected to preserve them, or use the tree to assign specific sections.</p></fieldset>'
                : '') +
              '<p class="muted">Selections in other campuses stay selected. To move assignments, clear their checkboxes before selecting another campus. Existing archived selections are retained. Teaching and diary history protect used assignments.</p><label class="checkbox"><input name="active" type="checkbox" ' +
              (editSubject.active ? 'checked' : '') +
              '>Active</label>'
            : '') +
          '</div>',
        async (d, f) => {
          const input = validateSubjectAssignments({ ...d, section_ids: selected() }, s, {
            subjectId: editSubject?.id,
            editing: !!editSubject,
          });
          if (editSubject)
            await api('/api/school/structure/' + editSubject.id, {
              method: 'PATCH',
              body: {
                ...input,
                active: !!d.active,
                expected_section_ids: sectionIds,
                ...(classOnlyIds.length
                  ? {
                      class_only_ids: $$('input[name=class_only_ids]:checked', f).map(
                        (x) => x.value,
                      ),
                      expected_class_only_ids: classOnlyIds,
                    }
                  : {}),
              },
            });
          else
            await api('/api/school/structure', {
              method: 'POST',
              body: { kind: 'subject_assignments', ...input },
            });
          toast(
            editSubject ? 'Subject and assignments updated.' : 'Subject and assignments saved.',
          );
        },
      );
      selected = mountSubjectTree(document.querySelector('#modal-form'), s, esc, {
        sectionIds,
        editing: !!editSubject,
      });
      return;
    }
    if (action === 'school-add-structure') {
      const kind = target.dataset.kind,
        parents =
          kind === 'campus'
            ? s.nodes.filter((x) => x.kind === 'branch' && x.active)
            : kind === 'class'
              ? s.nodes.filter((x) => x.kind === 'campus' && x.active)
              : kind === 'section'
                ? academic(s, 'class').filter((x) => x.active)
                : null;
      modal(
        'Add ' + kind,
        field('Name', 'name', 'text', '', 'required maxlength="100"') +
          (parents
            ? select(
                'Parent ' + { campus: 'branch', class: 'campus', section: 'class' }[kind],
                'parent_id',
                parents,
                '',
                'required',
              )
            : '') +
          (kind === 'session'
            ? field('Start date', 'start_date', 'date', '', 'required') +
              field('End date', 'end_date', 'date', '', 'required')
            : ''),
        (d) => api('/api/school/structure', { method: 'POST', body: { ...d, kind } }),
      );
    }
    if (action === 'school-edit-structure') {
      const x = [...s.nodes, ...s.academics].find((x) => x.id === target.dataset.id);
      const parents =
          x.kind === 'campus'
            ? s.nodes.filter((a) => a.kind === 'branch' && a.active)
            : x.kind === 'class'
              ? s.nodes.filter((a) => a.kind === 'campus' && a.active)
              : x.kind === 'section'
                ? academic(s, 'class').filter((a) => a.active)
                : null,
        parent =
          x.kind === 'class'
            ? s.classCampuses.find((c) => c.class_id === x.id)?.campus_id
            : x.parent_id;
      modal(
        'Edit ' + x.kind,
        field('Name', 'name', 'text', x.name, 'required maxlength="100"') +
          (x.kind === 'subject'
            ? field(
                'Subject Priority',
                'priority',
                'number',
                x.priority ?? 0,
                'required min="0" max="1000000" step="1"',
              )
            : '') +
          (parents
            ? select(
                'Parent ' + { campus: 'branch', class: 'campus', section: 'class' }[x.kind],
                'parent_id',
                parents,
                parent,
                'required',
              )
            : '') +
          (x.kind === 'session'
            ? field('Start date', 'start_date', 'date', x.start_date, 'required') +
              field('End date', 'end_date', 'date', x.end_date, 'required')
            : '') +
          `<label class="checkbox"><input name="active" type="checkbox" ${x.active ? 'checked' : ''}>Active</label><p class="muted">Relationships and dates with existing history are protected. Archive those records and create replacements.</p>`,
        (d) =>
          api('/api/school/structure/' + x.id, {
            method: 'PATCH',
            body: {
              ...d,
              ...(x.kind === 'subject' && d.priority !== undefined
                ? { priority: subjectPriority(d.priority) }
                : {}),
              active: !!d.active,
            },
          }),
      );
    }
    if (action === 'school-add-person')
      modal(
        'Add school account',
        field('Full name', 'name', 'text', '', 'required minlength="2" maxlength="120"') +
          field('Email', 'email', 'email', '', 'required maxlength="254"') +
          select(
            'Role',
            'role',
            Object.entries(roles)
              .filter(
                ([id]) =>
                  state.user.role === 'super_admin' ||
                  !['super_admin', 'school_admin'].includes(id),
              )
              .map(([id, name]) => ({ id, name })),
            'teacher',
            'required',
          ) +
          staffFields({ nodes: s.nodes }, { select }) +
          field(
            'Temporary password (6 or more characters)',
            'password',
            'password',
            '',
            'required minlength="6" maxlength="128" autocomplete="new-password"',
          ) +
          '<p class="muted">The user must change this password at first sign-in.</p>',
        (d) =>
          api('/api/school/people', {
            method: 'POST',
            body: { name: d.name, email: d.email, role: d.role, password: d.password, ...staffPayload(d, d.role) },
          }),
      );
      mountStaffFields($('#modal-form'), { users: s.users, person: null });
    if (action === 'school-edit-person') {
      const x = s.users.find((x) => x.id === target.dataset.id);
      modal(
        'Edit account',
        field('Full name', 'name', 'text', x.name, 'required minlength="2" maxlength="120"') +
          field('Email', 'email', 'email', x.email, 'required maxlength="254"') +
          (state.user.role === 'super_admin'
            ? select(
                'Role',
                'role',
                Object.entries(roles).map(([id, name]) => ({ id, name })),
                x.role,
                'required',
              )
            : '') +
          staffFields({ nodes: s.nodes, person: x }, { select }) +
          `<label class="checkbox"><input type="checkbox" name="active" ${x.active ? 'checked' : ''}>Active</label>` +
          field(
            'Reset password (leave blank to keep)',
            'password',
            'password',
            '',
            'minlength="6" maxlength="128" autocomplete="new-password"',
          ) +
          '<p class="muted">Saving revokes this account’s sessions. Archive responsibilities before removing a reviewer.</p>',
        (d) =>
          api('/api/school/people/' + x.id, {
            method: 'PATCH',
            body: {
              name: d.name,
              email: d.email,
              ...(d.role ? { role: d.role } : {}),
              password: d.password || undefined,
              active: !!d.active,
              ...staffPayload(d, d.role || x.role),
            },
          }),
      );
      mountStaffFields($('#modal-form'), { users: s.users, person: x });
    }
    if (action === 'school-edit-assignment') {
      const a = s.assignments.find((a) => a.id === target.dataset.id);
      const pairs = assignmentChoices(s, a.teacher_id).pairs;
      modal(
        'Edit teaching responsibility',
        select(
          'Teacher',
          'teacher_id',
          s.users.filter((x) => x.role === 'teacher' && x.active),
          a.teacher_id,
          'required',
        ) +
          select(
            'Class / section / subject',
            'pair',
            pairs,
            a.section_id + ':' + a.subject_id,
            'required',
          ) +
          checks(
            'weekdays',
            ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((name, id) => ({
              id: String(id),
              name,
            })),
            a.weekdays.map(String),
          ) +
          field('Submission time', 'due_time', 'time', a.due_time, 'required') +
          field('Review time', 'review_time', 'time', a.review_time, 'required') +
          '<p>Assignments with diary history must be archived and replaced.</p>',
        (d, f) =>
          api('/api/school/assignments/' + a.id, {
            method: 'PUT',
            body: {
              ...d,
              section_id: d.pair.split(':')[0],
              subject_id: d.pair.split(':')[1],
              weekdays: $$('input[name=weekdays]:checked', f).map((x) => Number(x.value)),
            },
          }),
      );
      const form = document.querySelector('dialog form');
      if (form) {
        const teacher = form.querySelector('[name=teacher_id]'),
          pair = form.querySelector('[name=pair]');
        teacher.addEventListener('change', () => {
          pair.innerHTML =
            '<option value="">Choose…</option>' +
            assignmentChoices(s, teacher.value)
              .pairs.map((x) => '<option value="' + esc(x.id) + '">' + esc(x.name) + '</option>')
              .join('');
        });
      }
    }
    if (action === 'school-delete-person')
      modal(
        'Delete unused account',
        '<p>Accounts with school records or messages must be deactivated instead. Type REMOVE.</p>' +
          field('Confirmation', 'confirmation', 'text', '', 'required pattern="REMOVE"'),
        (d) => api('/api/users/' + target.dataset.id, { method: 'DELETE' }),
      );
    const deletes = {
      'school-delete-structure': 'structure',
      'school-delete-assignment': 'assignments',
      'school-delete-quote': 'quotes',
    };
    if (deletes[action])
      modal(
        'Delete unused record',
        '<p>History and referenced records are protected. Approved diary snapshots remain preserved. Type REMOVE to confirm.</p>' +
          field('Confirmation', 'confirmation', 'text', '', 'required pattern="REMOVE"'),
        async (d) => {
          if (d.confirmation !== 'REMOVE') throw Error('Type REMOVE.');
          await api('/api/school/' + deletes[action] + '/' + target.dataset.id, {
            method: 'DELETE',
          });
        },
      );
    if (action === 'school-toggle-assignment') {
      await api('/api/school/assignments/' + target.dataset.id, {
        method: 'PATCH',
        body: { active: target.dataset.active === 'true' },
      });
      await render();
    }
    if (action === 'school-edit-notice') {
      const n = state.schoolNotice || {};
      modal(
        'Diary notice',
        field('Title (optional)', 'title', 'text', n.title || '', 'maxlength="80"') +
          select(
            'Notice language',
            'language',
            [
              { id: 'en', name: 'English' },
              { id: 'ur', name: 'Urdu' },
              { id: 'ar', name: 'Arabic' },
            ],
            n.language || 'en',
            'required',
          ) +
          '<label class="field">Notice text<textarea name="text" dir="auto" maxlength="400" rows="5" required>' +
          esc(n.text || '') +
          '</textarea></label>' +
          select(
            'Status',
            'published',
            [
              { id: 'false', name: 'Hidden (not printed)' },
              { id: 'true', name: 'Published (printed on diaries)' },
            ],
            String(n.published === true),
            'required',
          ) +
          field('Show from (optional)', 'startDate', 'date', n.startDate || '', '') +
          field('Show until (optional)', 'endDate', 'date', n.endDate || '', '') +
          '<p class="muted">If you leave “Show from” empty, a published notice starts today. Older diaries are not changed.</p>',
        (d) =>
          api('/api/school/notice', {
            method: 'PUT',
            body: {
              title: d.title || '',
              text: d.text,
              language: d.language,
              published: d.published === 'true',
              startDate: d.startDate || '',
              endDate: d.endDate || '',
            },
          }),
      );
    }
    if (action === 'school-toggle-notice') {
      await api('/api/school/notice', {
        method: 'PUT',
        body: { published: target.dataset.published === 'true' },
      });
      await render();
    }
    if (action === 'school-add-quote')
      modal(
        'Schedule school-wide quote',
        field('Quote date', 'date', 'date', today(), 'required') +
          select(
            'Quote language',
            'language',
            [
              { id: 'en', name: 'English' },
              { id: 'ur', name: 'Urdu' },
              { id: 'ar', name: 'Arabic' },
            ],
            'en',
            'required',
          ) +
          '<label class="field">Exact approved quote<textarea name="text" dir="auto" maxlength="300" required rows="4"></textarea></label>' +
          field('Priority', 'priority', 'number', '0', 'required min="-1000" max="1000"') +
          '<p class="muted">Keep the quote short (300 characters at most). It is printed in a decorative card under the homework table and shrinks automatically to fit the A4 page.</p>',
        (d) =>
          api('/api/school/quotes', {
            method: 'POST',
            body: { ...d, priority: Number(d.priority) },
          }),
      );
    if (action === 'school-edit-quote') {
      const q = state.schoolQuotes.quotes.find((x) => x.id === target.dataset.id);
      const schedule = state.schoolQuotes.schedules.find((x) => x.quote_id === q.id);
      modal(
        'Edit scheduled quote',
        field('Quote date', 'date', 'date', schedule?.date || today(), 'required') +
          select(
            'Quote language',
            'language',
            [
              { id: 'en', name: 'English' },
              { id: 'ur', name: 'Urdu' },
              { id: 'ar', name: 'Arabic' },
            ],
            q.language,
            'required',
          ) +
          '<label class="field">Quote text<textarea name="text" maxlength="300" dir="auto" rows="4" required>' +
          esc(q.text) +
          '</textarea></label>' +
          field(
            'Priority',
            'priority',
            'number',
            schedule?.priority ?? 0,
            'required min="-1000" max="1000"',
          ) +
          '<p>Approved diaries keep their saved quote text.</p>',
        (d) =>
          api('/api/school/quotes/' + q.id, {
            method: 'PATCH',
            body: { ...d, priority: Number(d.priority) },
          }),
      );
    }
    if (action === 'school-toggle-quote') {
      await api('/api/school/quotes/' + target.dataset.id, {
        method: 'PATCH',
        body: { active: target.dataset.active === 'true' },
      });
      await render();
    }
    if (action === 'school-read-all' || action === 'school-read-alert') {
      await api('/api/notifications', {
        method: 'PATCH',
        body: action === 'school-read-alert' ? { id: target.dataset.id } : {},
      });
      await render();
    }
    if (action === 'school-enable-push') {
      await requestAndSubscribe(api);
      state.pushStatus = 'on';
      $('#push-banner')?.remove();
      toast('Notifications are on for this device.');
      await render();
    }
    if (action === 'school-test-push') {
      await api('/api/school/push/test', { method: 'POST', body: {} });
      toast('Test alert sent. It should appear on this device in a moment.');
    }
    if (action === 'school-disable-push' || action === 'school-disable-all-push') {
      await turnOffThisDevice(api, { everywhere: action === 'school-disable-all-push' });
      state.pushStatus = 'off';
      toast(action === 'school-disable-push' ? 'Notifications turned off on this device.' : 'Notifications turned off on all your devices.');
      await render();
    }
  }
  return { nav, route, click };
}
