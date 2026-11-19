import { mountAccountSecurity } from './security-form.js';
import { createDraftRecovery } from './draft-recovery.js';
import { createApiClient } from './api-client.js';
import { installDocumentActions } from './diary-actions.js';
import { schoolUI } from './school.js';
import { serializeRender } from './render-queue.js';
import { enhancedUI } from './enhancements.js';
import { showSetup } from './setup.js';
import { autoEnablePush, requestAndSubscribe, releaseDevice } from './push-client.js';
const $ = (s, r = document) => r.querySelector(s),
  $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (x) =>
  String(x ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const state = {
  user: null,
  csrf: '',
  school: null,
  lookups: null,
  dirty: false,
  route: '',
  page: 1,
};
const labels = {
  topic: 'Topic of the Day',
  chapter: 'Chapter / Unit',
  previous_revision: 'Previous Lesson Revision',
  todays_lesson: 'Today’s Lesson',
  learning_objectives: 'Learning Objectives',
  classwork: 'Classwork',
  homework: 'Homework',
  learning_activities: 'Learning Activities',
  syllabus_progress: 'Syllabus Progress',
  student_participation: 'Student Participation',
  difficulties: 'Difficulties / Remarks',
  next_lesson_plan: 'Next Lesson Plan',
  present: 'Students Present',
  absent: 'Students Absent',
  assessment: 'Quiz / Assessment',
  observations: 'General Performance Observations',
  resources: 'Teaching Resources',
};
const roleName = {
  super_admin: 'Super Admin',
  school_admin: 'School Admin',
  coordinator: 'Coordinator',
  head_teacher: 'Head Teacher',
  teacher: 'Teacher',
  parent: 'Parent',
};
const icons = {
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  home: '<path d="m3 10 9-7 9 7v10H3Z"/><path d="M9 20v-7h6v7"/>',
  book: '<path d="M3 4h7l2 2 2-2h7v15h-7l-2 2-2-2H3Z"/><path d="M12 6v15"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  users:
    '<circle cx="9" cy="7" r="3"/><path d="M3 20v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6M18 14a4 4 0 0 1 3 4v2"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  calendar:
    '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 11h18M8 15h1M15 15h1"/>',
  chart: '<path d="M4 3v18h17M8 16v-5M13 16V6M18 16v-8"/>',
  quote: '<path d="M4 13h5v7H3v-7c0-5 2-8 6-9M15 13h5v7h-6v-7c0-5 2-8 6-9"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="m9 3-1 3-3 1-2 4 2 2v4l4 2 3-1 3 1 4-2v-4l2-2-2-4-3-1-1-3Z"/>',
  bell: '<path d="M5 16h14l-2-3V9a5 5 0 0 0-10 0v4ZM10 20h4"/>',
  check: '<path d="m5 12 4 4L20 5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/>',
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  logout: '<path d="M9 4H4v16h5M9 12h12m-5-5 5 5-5 5"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  file: '<path d="M5 3h9l5 5v13H5ZM14 3v6h5M8 13h8M8 17h6"/>',
  user: '<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
};
const icon = (n) =>
  `<span class="icon" aria-hidden="true"><svg viewBox="0 0 24 24">${icons[n] || icons.book}</svg></span>`;
const badge = (s) => `<span class="badge ${esc(s)}">${esc(s.replaceAll('_', ' '))}</span>`;
const can = (p) => state.user?.role === 'super_admin' || state.user?.permissions.includes(p);
const initials = (n) =>
  n
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => x[0])
    .join('')
    .toUpperCase();
const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: state.school?.timezone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
const displayDate = (d) =>
  d
    ? new Date(d.length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        ...(d.length === 10
          ? {}
          : { hour: '2-digit', minute: '2-digit', timeZone: state.school?.timezone || 'UTC' }),
      })
    : '—';
const empty = (title, text = 'Your records will appear here as you work.') =>
  `<div class="empty">${icon('book')}<h3>${esc(title)}</h3><p>${esc(text)}</p></div>`;
const field = (label, name, type = 'text', value = '', extra = '') =>
  `<label class="field">${esc(label)}<input name="${esc(name)}" type="${type}" value="${esc(value)}" ${extra}></label>`;
const options = (rows, value = '', placeholder = 'Choose…') =>
  `<option value="">${esc(placeholder)}</option>` +
  rows
    .map(
      (r) =>
        `<option value="${esc(r.id)}" ${r.id === value ? 'selected' : ''}>${esc(r.name)}</option>`,
    )
    .join('');
const select = (label, name, rows, value = '', extra = '') =>
  `<label class="field">${esc(label)}<select name="${name}" ${extra}>${options(rows, value)}</select></label>`;
const heading = (title, sub, actions = '') =>
  `<div class="pagehead"><div><h1>${esc(title)}</h1><p>${esc(sub)}</p></div><div class="actions">${actions}</div></div>`;
const button = (text, action, cls = '', extra = '') =>
  `<button class="${cls}" data-action="${action}" ${extra}>${text}</button>`;
const card = (title, body, action = '') =>
  `<section class="card"><div class="cardhead"><h2>${title}</h2>${action}</div>${body}</section>`;
function toast(message) {
  $('#toast').textContent = message;
  $('#toast').style.display = 'block';
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ($('#toast').style.display = 'none'), 5000);
}
const recovery = createDraftRecovery();
let startupError = '';
const api = createApiClient({
  csrf: () => state.csrf,
  onUnauthorized: () => {
    if (state.user) {
      if (state.dirty)
        recovery.capture(
          document.querySelector('#school-diary-write') || document.querySelector('#diary-form'),
          state.user.id,
          location.hash,
        );
      state.user = null;
      state.dirty = false;
      location.hash = '#/login';
    }
  },
});
const documentActions = installDocumentActions({ notify: toast });
async function download(path, trigger) {
  if (path.includes('format=csv')) {
    const link = document.createElement('a');
    link.href = path;
    link.download = 'school-report.csv';
    link.click();
    return;
  }
  return documentActions.run(path, trigger);
}
async function lookups() {
  state.lookups = await api('/api/lookups');
  return state.lookups;
}
function routeParts() {
  const [path, qs] = location.hash.replace(/^#\/?/, '').split('?');
  return { path: path || 'dashboard', q: Object.fromEntries(new URLSearchParams(qs)) };
}
function navItems() {
  return school.nav();
}
function setSidebarOpen(open) {
  const sidebar = $('.sidebar'),
    toggle = $('[data-action="menu"]');
  if (!sidebar) return;
  sidebar.classList.toggle('open', open);
  document.body.classList.toggle('sidebar-open', open);
  toggle?.setAttribute('aria-expanded', String(open));
  const workspace = $('.workspace');
  if (workspace) workspace.inert = open;
  if (open) sidebar.querySelector('button,a')?.focus();
  else toggle?.focus();
}
function shell(title) {
  document.body.classList.remove('sidebar-open');
  const active = routeParts().path;
  $('#app').innerHTML =
    `<button class="skip-link" data-action="skip-content">Skip to main content</button><aside class="sidebar" id="workspace-sidebar">${button(icon('close'), 'menu-close', 'sidebar-close ghost', 'aria-label="Close navigation"')}<a class="brand" href="#/dashboard"><img class="brand-logo" src="/assets/official-school-logo.jpeg" alt="Elite Scholars school logo"><div><strong>Elite Scholars</strong><small>Daily Diary</small></div></a><div class="navlabel">YOUR WORKSPACE</div><nav aria-label="Main navigation">${navItems()
      .map(
        ([r, i, t]) =>
          `<a href="#/${r}" class="${r === active ? 'active' : ''}">${icon(i)}${t}</a>`,
      )
      .join(
        '',
      )}</nav><div class="sidebar-bottom"><a href="#/profile"><strong>${esc(state.user.name)}</strong><span class="role">${esc(roleName[state.user.role])}</span></a>${button(icon('logout') + ' Sign out', 'logout', 'ghost small')}</div></aside><button type="button" class="sidebar-backdrop" data-action="menu-close" aria-label="Close navigation" tabindex="-1"></button><div class="workspace"><header class="topbar"><div class="actions">${button(icon('menu'), 'menu', 'ghost mobile-menu', 'aria-label="Open navigation" aria-controls="workspace-sidebar" aria-expanded="false"')}<div class="breadcrumbs">Workspace <b>/ ${esc(title)}</b></div></div><div class="top-right"><small class="date-label">${displayDate(today())}</small><a href="#/notifications" aria-label="Notifications">${icon('bell')}</a><a href="#/profile" class="avatar" aria-label="Your profile">${esc(initials(state.user.name))}</a></div></header>${state.user.email.endsWith('@example.invalid') ? '<div class="test-banner">TEST WORKSPACE · Sample accounts and academic data · Configure a fresh database for production</div>' : ''}<main class="main" id="content" tabindex="-1"><div class="boot">Loading…</div></main></div>${
      state.user.role === 'teacher'
        ? `<nav class="bottomnav">${[
            ['dashboard', 'home', 'Home'],
            ['diaries', 'book', 'My Diaries'],
            ['new', 'plus', 'New Diary'],
            ['profile', 'user', 'Profile'],
          ]
            .map(
              ([r, i, t]) =>
                `<a href="#/${r}" class="${active === r ? 'active' : ''}">${icon(i)}${t}</a>`,
            )
            .join('')}</nav>`
        : ''
    }`;
}
function login() {
  document.body.classList.remove('sidebar-open');
  state.route = 'login';
  $('#app').innerHTML =
    `<div class="login"><section class="login-brand"><div class="brand"><img class="brand-logo" src="/assets/official-school-logo.jpeg" alt="Elite Scholars school logo"><div><strong>Elite Scholars School</strong><small>Daily Diary Management</small></div></div><div><div class="eyebrow">A little reflection. Every day.</div><h1>Better records.<br><em>Thoughtful teaching.</em><br>Brighter futures.</h1><p>A dedicated space to record your lessons, reflect on your classroom, and keep every teaching day connected.</p></div><footer><div class="eyebrow">Plan · Teach · Reflect · Grow</div></footer></section><section class="login-form"><form id="login-form"><div class="eyebrow">Welcome to your workspace</div><h2>A new day of learning.</h2><p class="muted">Sign in with your school account to continue.</p><div class="alert error" id="form-error" role="alert"></div>${field('Email address', 'email', 'email', '', 'required autocomplete="username"')}${field('Password', 'password', 'password', '', 'required autocomplete="current-password"')}${field('Authenticator or recovery code (if enabled)', 'otp', 'text', '', 'autocomplete="one-time-code" maxlength="100"')}<button class="primary" type="submit">Sign in ${icon('arrow')}</button><p class="footnote">Need an account or a password reset? Contact your school administrator. Access is assigned by the school.</p></form></section></div>`;
}
// First sign-in with an administrator-issued password: nothing else is reachable until it is replaced.
function firstLogin() {
  document.body.classList.remove('sidebar-open');
  state.route = 'first-login';
  $('#app').innerHTML =
    `<div class="login"><section class="login-form"><form id="first-login-form"><div class="eyebrow">Welcome, ${esc(state.user.name)}</div><h2>First, change your password.</h2><p class="muted">Your account was created with a temporary password. Choose your own password (6 or more characters) to continue.</p><div class="alert error" id="form-error" role="alert"></div>${field('Temporary password', 'currentPassword', 'password', '', 'required autocomplete="current-password"')}${field('New password', 'newPassword', 'password', '', 'required minlength="6" maxlength="128" autocomplete="new-password"')}${field('Confirm new password', 'confirmPassword', 'password', '', 'required minlength="6" maxlength="128" autocomplete="new-password"')}<button class="primary" type="submit">Save and continue ${icon('arrow')}</button><p class="footnote">${button('Sign out', 'logout', '')}</p></form></section></div>`;
}
function diaryRows(items) {
  return `<div class="table-wrap"><table><thead><tr><th>Teaching diary</th><th>Teacher</th><th>Date / period</th><th>Status</th><th></th></tr></thead><tbody>${items.map((d) => `<tr><td><strong>${esc(d.assignment.subject_name)}</strong><small>${esc(d.assignment.class_name)} · ${esc(d.assignment.section_name)}</small><small>${esc(d.content.topic || 'Untitled draft')}</small></td><td>${esc(d.assignment.teacher_name)}</td><td>${displayDate(d.diary_date)}<small>Period ${d.period}</small></td><td>${badge(d.status)}</td><td><a href="#/diary?id=${d.id}">${button('Open ' + icon('arrow'), '', 'ghost small')}</a></td></tr>`).join('')}</tbody></table></div>`;
}
async function dashboard(q) {
  const data = await api('/api/dashboard?date=' + encodeURIComponent(q.date || today())),
    c = data.counts,
    teacher = state.user.role === 'teacher';
  const stats = [
    ['Expected diaries', c.expected, 'Scheduled teaching periods', 'calendar'],
    ['Submitted', c.submitted, c.rate + '% of expected diaries', 'book'],
    ['Awaiting review', c.awaiting, 'Submitted and resubmitted', 'clock'],
    ['Approved', c.approved, 'Reviewed teaching records', 'check'],
    ['Drafts', c.drafts, 'Ready to continue', 'file'],
    ['Returned', c.returned, 'Corrections requested', 'arrow'],
    ['Overdue', c.overdue, 'Past the submission deadline', 'clock'],
    [
      'Submission rate',
      c.rate + '%',
      c.expected ? 'Based on scheduled periods' : 'No scheduled periods',
      'chart',
    ],
  ];
  $('#content').innerHTML =
    heading(
      teacher ? 'Your teaching day' : `${roleName[state.user.role]} overview`,
      'A clear view of your lessons, records, and next steps.',
      `<label class="field"><span class="sr-only">Diary date</span><input id="dashboard-date" type="date" value="${esc(data.date)}" aria-label="Dashboard date"></label><a href="#/new">${button(icon('plus') + ' New diary', '', 'primary')}</a>`,
    ) +
    `<div class="hero"><div><div class="eyebrow">${esc(new Date(data.date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }))}</div><h2>Hello, ${esc(state.user.name.split(' ')[0])}.</h2><p>${c.returned ? `${c.returned} ${c.returned === 1 ? 'diary needs' : 'diaries need'} a little attention. Review the feedback and continue your teaching record.` : teacher ? 'Every lesson is a step forward. Record what mattered in your classroom today.' : 'Keep your team’s daily teaching records moving, from first draft to thoughtful review.'}</p></div><div class="emblem" aria-hidden="true">E</div></div><div class="stats">${stats.map(([label, value, foot, i]) => `<article class="stat"><div class="label">${label}${icon(i)}</div><strong>${value}</strong><span class="foot">${foot}</span></article>`).join('')}</div><div class="grid2"><div>${card(teacher ? 'Your teaching schedule' : 'Scheduled teaching diaries', data.slots.length ? data.slots.map((s) => `<div class="schedule-item"><div class="period"><small>PERIOD</small>${s.period}</div><div class="info"><h3>${esc(s.subject_name)}</h3><p>${esc(s.class_name)} · Section ${esc(s.section_name)} ${teacher ? '' : '· ' + esc(s.teacher_name)}</p><p>Due ${displayDate(s.due_at)}</p></div>${badge(s.overdue ? 'overdue' : s.status)}<a href="${s.diary_id ? '#/diary?id=' + s.diary_id : '#/new?assignment=' + s.assignment_id + '&date=' + s.date + '&period=' + s.period}">${button(s.diary_id ? 'Open' : 'Create', '', 'small')}</a></div>`).join('') : empty('No teaching periods scheduled', 'Your school administrator can configure assignments and the timetable.'), `<small>${data.slots.length} periods</small>`)}</div><div><section class="card quote-card"><div class="cardbody"><div class="eyebrow">Words for the day</div><div class="quote-mark">“</div>${data.quotes.length ? data.quotes.map((q) => `<p class="quote-text" lang="${esc(q.language)}" dir="${q.direction}">${esc(q.text)}</p>`).join('') : '<h2>A space for daily inspiration.</h2><p class="muted">No school-approved quote is scheduled for this date.</p>'}</div></section><div class="card"><div class="cardbody"><div class="section-title">Your next step</div><h2>${c.returned ? 'Continue a returned diary' : c.awaiting && !teacher ? 'Make time for a review' : 'Keep the record growing'}</h2><p class="muted">${teacher ? 'Drafts save your progress. Submit when your teaching record is ready for review.' : 'Open the review queue to see diaries within your assigned responsibility.'}</p><a href="${teacher ? '#/diaries' : '#/review'}">${button((teacher ? 'View diaries' : 'Review queue') + ' ' + icon('arrow'), '', 'small')}</a></div></div></div></div>` +
    card(
      'Recent teaching records',
      data.diaries.length ? diaryRows(data.diaries.slice(0, 8)) : empty('No diaries for this date'),
      '<a href="#/diaries" class="muted">View all →</a>',
    );
}
function filterForm(q = {}, report = false) {
  const lk = state.lookups,
    a = lk.academics;
  return `<form class="filters" id="filters"><label>From<input name="start" type="date" value="${esc(q.start || (report ? today() : ''))}"></label><label>To<input name="end" type="date" value="${esc(q.end || (report ? today() : ''))}"></label><label>Teacher<select name="teacher">${options(
    lk.users.map((u) => ({ id: u.id, name: u.name })),
    q.teacher || '',
    'All teachers',
  )}</select></label><label>Class<select name="class">${options(
    a.filter((x) => x.kind === 'class').map((x) => ({ id: x.name, name: x.name })),
    q.class || '',
    'All classes',
  )}</select></label><label>Section<select name="section">${options(
    a.filter((x) => x.kind === 'section'),
    q.section || '',
    'All sections',
  )}</select></label><label>Subject<select name="subject">${options(
    a.filter((x) => x.kind === 'subject'),
    q.subject || '',
    'All subjects',
  )}</select></label><label>Department<select name="department">${options(
    a.filter((x) => x.kind === 'department'),
    q.department || '',
    'All departments',
  )}</select></label><label>Session<select name="session">${options(
    a.filter((x) => x.kind === 'session'),
    q.session || '',
    'All sessions',
  )}</select></label><label>Status<select name="status">${options(
    [
      'draft',
      'submitted',
      'under_review',
      'returned',
      'resubmitted',
      'approved',
      ...(report ? ['overdue', 'not_submitted'] : []),
    ].map((x) => ({ id: x, name: x.replaceAll('_', ' ') })),
    q.status || '',
    'All statuses',
  )}</select></label>${report ? '' : `<label>Search content<input name="search" value="${esc(q.search || '')}" placeholder="Topic, lesson, homework…"></label>`}<div class="actions"><button class="dark small" type="submit">Apply filters</button><a href="#/${report ? 'reports' : 'diaries'}">${button('Reset', '', 'ghost small')}</a></div></form>`;
}
function qs(q) {
  return new URLSearchParams(
    Object.entries(q).filter(([, v]) => v !== '' && v !== undefined),
  ).toString();
}
async function history(q, review = false) {
  await lookups();
  const data = await api(
    '/api/diaries?' + qs({ ...q, ...(review ? { review_queue: 'true' } : {}) }),
  );
  $('#content').innerHTML =
    heading(
      review
        ? 'Review queue'
        : state.user.role === 'teacher'
          ? 'My diaries'
          : 'All teaching diaries',
      review
        ? 'Thoughtful feedback keeps the teaching cycle moving.'
        : 'Your teaching history, organized and easy to find.',
      can('export')
        ? button(
            icon('download') + ' Export filtered PDF',
            'bulk-export',
            '',
            `data-query="${esc(qs(q))}"`,
          )
        : '',
    ) +
    `<section class="card">${filterForm(q)}${data.items.length ? diaryRows(data.items) : empty(review ? 'No diaries awaiting your review' : 'No matching diaries', 'Try another date range or filter.')}<div class="pager"><span>${data.total} records${' · Page ' + data.page + ' of ' + Math.max(1, Math.ceil(data.total / 30))}</span>${`<div class="actions">${data.page > 1 ? `<a href="#/${review ? 'review' : 'diaries'}?${qs({ ...q, page: data.page - 1 })}">${button('Previous', '', 'small')}</a>` : ''}${data.page * 30 < data.total ? `<a href="#/${review ? 'review' : 'diaries'}?${qs({ ...q, page: data.page + 1 })}">${button('Next', '', 'small')}</a>` : ''}</div>`}</div></section>`;
}
const defaultHomeworkSubjects = [
  'English A',
  'English B',
  'Mathematics',
  'Science',
  'Computer',
  'Urdu',
  'Islamiat',
  'Art & Craft',
];
function homeworkRow(row = {}) {
  return `<div class="homework-editor-row"><label><span class="sr-only">Subject</span><input name="homework_subject" maxlength="100" value="${esc(row.subject || '')}" placeholder="Subject"></label><label><span class="sr-only">Detail of Home Work</span><textarea name="homework_detail" maxlength="12000" dir="auto" placeholder="Chapter, exercise, reading or other homework…">${esc(row.detail || '')}</textarea></label>${[
    ['hw', 'H.W'],
    ['learn', 'Learn'],
    ['test', 'Test'],
  ]
    .map(
      ([key, label]) =>
        `<label class="homework-flag"><input type="checkbox" data-homework-flag="${key}" aria-label="${label}" ${row[key] ? 'checked' : ''}><span class="sr-only">${label}</span></label>`,
    )
    .join(
      '',
    )}<button type="button" data-action="remove-homework-row" class="ghost small" aria-label="Remove subject">×</button></div>`;
}
function homeworkEditor(content) {
  const rows = content.homework_rows || defaultHomeworkSubjects.map((subject) => ({ subject }));
  return `<section class="card diary-layout-section" data-layout="homework_grid"><div class="cardhead"><div><h2>Daily homework</h2><small>One row per subject · tick H.W, Learn and Test as appropriate</small></div>${button('+ Add subject', 'add-homework-row', 'small', 'type="button"')}</div><div class="cardbody"><div class="homework-editor-scroll"><div class="homework-editor-head"><b>Subject</b><b>Detail of Home Work</b><b>H.W</b><b>Learn</b><b>Test</b><span></span></div><div id="homework-rows">${rows.map(homeworkRow).join('')}</div></div></div></section>`;
}
function showDiaryLayout() {
  const layout = $('#diary-layout').value;
  $$('.diary-layout-section').forEach((el) => (el.hidden = el.dataset.layout !== layout));
}
async function diaryForm(q) {
  const lk = await lookups(),
    d = q.id ? await api('/api/diaries/' + q.id) : null;
  const assignments = lk.assignments.filter((a) => a.teacher_id === state.user.id && a.active);
  if (d && !['draft', 'returned'].includes(d.status)) throw Error('This diary is locked.');
  if (!assignments.length) {
    $('#content').innerHTML =
      heading('New diary', 'A separate record for every assigned teaching period.') +
      card(
        'Teaching assignment needed',
        empty(
          'No active teaching assignments',
          'Ask your school administrator to assign your class, subject, reviewer, and timetable.',
        ),
      );
    return;
  }
  const aid = d?.assignment_id || q.assignment || assignments[0].id,
    a = assignments.find((a) => a.id === aid) || assignments[0],
    content = d?.content || {},
    layout = content.diary_layout || (d ? 'teaching' : state.school.diaryLayout || 'homework_grid');
  $('#content').innerHTML =
    heading(
      d ? 'Continue your diary' : 'A new daily diary',
      'Choose the homework sheet or teaching reflection format. Use Class Diary for multiple subject entries.',
      d ? badge(d.status) : '<span class="badge draft">New draft</span>',
    ) +
    `${d?.review_remarks ? `<div class="alert"><b>Reviewer feedback:</b> ${esc(d.review_remarks)}</div>` : ''}<form id="diary-form" data-id="${d?.id || ''}" data-version="${d?.version || ''}"><div class="alert error" id="form-error" role="alert"></div><section class="card"><div class="cardhead"><h2>The essentials</h2><small>Assigned teaching responsibility</small></div><div class="cardbody form-grid three">${select(
      'Class / section / subject',
      'assignment_id',
      assignments.map((a) => ({
        id: a.id,
        name: `${a.class_name} / ${a.section_name} · ${a.subject_name} · ${a.session_name}`,
      })),
      a.id,
      d ? 'disabled' : 'required',
    )}${field('Diary date', 'diary_date', 'date', d?.diary_date || q.date || today(), d ? 'disabled' : 'required')}${select(
      'Period',
      'period',
      a.periods.map((p) => ({ id: String(p), name: 'Period ' + p })),
      String(d?.period || q.period || a.periods[0]),
      d ? 'disabled' : 'required',
    )}<label class="field">Diary format<select name="diary_layout" id="diary-layout"><option value="homework_grid" ${layout === 'homework_grid' ? 'selected' : ''}>Homework · landscape sheet</option><option value="teaching" ${layout === 'teaching' ? 'selected' : ''}>Teaching reflection · portrait</option></select></label>${field('Diary title / Topic *', 'topic', 'text', content.topic || (layout === 'homework_grid' ? 'Daily Homework' : ''), 'maxlength="30000"')}<div class="field"><label>Reviewer</label><input value="${esc(a.head_name)}" disabled><span class="hint">${esc(a.session_name)} · ${displayDate(a.start_date)} – ${displayDate(a.end_date)}</span></div></div></section>${homeworkEditor({ ...content, homework_rows: content.homework_rows || [{ subject: a.subject_name }] })}<section class="card diary-layout-section" data-layout="teaching"><div class="cardhead"><h2>The lesson & learning</h2><small>* Required when submitting</small></div><div class="cardbody form-grid">${field('Chapter / Unit', 'chapter', 'text', content.chapter || '')}${Object.entries(
      labels,
    )
      .filter(
        ([k]) =>
          ![
            'topic',
            'chapter',
            'present',
            'absent',
            'assessment',
            'observations',
            'resources',
          ].includes(k),
      )
      .map(
        ([k, label]) =>
          `<label class="field">${esc(label)} ${state.school.requiredFields.includes(k) ? '*' : ''}<textarea name="${k}" maxlength="30000">${esc(content[k] || '')}</textarea></label>`,
      )
      .join(
        '',
      )}</div></section><section class="card diary-layout-section" data-layout="teaching"><div class="cardhead"><h2>A little more detail</h2><small>Optional classroom information</small></div><div class="cardbody form-grid">${field('Students present', 'present', 'number', content.present || '', 'min="0" max="9999"')}${field('Students absent', 'absent', 'number', content.absent || '', 'min="0" max="9999"')}${['assessment', 'observations', 'resources'].map((k) => `<label class="field">${labels[k]}<textarea name="${k}" maxlength="30000">${esc(content[k] || '')}</textarea></label>`).join('')}</div></section><div class="callout">Save a draft to preview the template and add private PNG, JPG or PDF attachments.</div><div class="formfoot"><a href="${d ? '#/diary?id=' + d.id : '#/diaries'}">${button('Cancel', '', 'ghost', 'type="button"')}</a><div class="actions"><button name="intent" value="draft" type="submit">Save draft</button><button name="intent" value="preview" type="submit">Save & preview</button><button name="intent" value="submit" type="submit" class="primary">Submit diary ${icon('arrow')}</button></div></div></form>`;
  showDiaryLayout();
  $$('input[name=homework_subject]').forEach((el) => (el.readOnly = true));
  $$('[data-action=add-homework-row],[data-action=remove-homework-row]').forEach(
    (el) => (el.hidden = true),
  );
  state.dirty = false;
  $('#diary-form').addEventListener('input', () => (state.dirty = true));
  $('#diary-layout').addEventListener('change', () => {
    showDiaryLayout();
    state.dirty = true;
  });
  $('select[name=assignment_id]')?.addEventListener('change', (event) => {
    const selected = assignments.find((a) => a.id === event.target.value);
    $('#homework-rows').innerHTML = homeworkRow({ subject: selected.subject_name });
    $$('input[name=homework_subject]').forEach((el) => (el.readOnly = true));
    $$('[data-action=remove-homework-row]').forEach((el) => (el.hidden = true));
    $('input[disabled]', $('#diary-form')).value = selected.head_name;
    $('select[name=period]').innerHTML = options(
      selected.periods.map((p) => ({ id: String(p), name: 'Period ' + p })),
      String(selected.periods[0]),
    );
  });
}
async function diaryDetail(q) {
  const d = await api('/api/diaries/' + q.id),
    editable =
      !d.force_deleted &&
      d.teacher_id === state.user.id &&
      ['draft', 'returned'].includes(d.status);
  state.diary = d;
  $('#content').innerHTML =
    heading(
      d.content.topic || 'Teaching diary',
      `${d.assignment.class_name} / ${d.assignment.section_name} · ${d.assignment.subject_name} · ${displayDate(d.diary_date)} · Period ${d.period}`,
      `${badge(d.force_deleted ? 'deleted' : d.status)}${!d.force_deleted && ['super_admin', 'school_admin'].includes(state.user.role) && state.capabilities?.includes('records.force_delete') ? button('Force Delete', 'school-force-delete', 'small danger', `data-type="legacy_diary" data-id="${d.id}"`) : ''}${editable ? `<a href="#/legacynew?id=${d.id}">${button('Continue editing', '', 'primary')}</a>` : ''}`,
    ) +
    `<div class="actions" style-placeholder="none"></div><section class="card"><div class="cardhead"><div class="actions"><h2>Diary preview</h2><small>Version ${d.version}</small></div><div class="actions">${button('Version history', 'versions', 'small')}${d.canExport ? ['pdf', 'png', 'jpg'].map((f) => button(icon('download') + f.toUpperCase(), 'export', 'small', `data-format="${f}"`)).join('') + button('Print', 'print', 'small') : ''}</div></div><iframe id="preview" title="Daily teaching diary preview" class="iframe" src="/api/diaries/${d.id}/preview"></iframe></section>${d.review_remarks ? `<div class="alert"><b>Latest review:</b> ${esc(d.review_remarks)}</div>` : ''}${!d.force_deleted && d.canReview && ['submitted', 'resubmitted', 'under_review'].includes(d.status) ? card('Review this diary', `<form class="cardbody" id="review-form"><p class="muted">Add specific, constructive feedback. A reason is required when returning a diary.</p><div class="alert error" id="form-error" role="alert"></div><label class="field">Review remarks<textarea name="remarks" maxlength="10000" placeholder="What went well? What needs attention?"></textarea></label><div class="actions">${d.status !== 'under_review' ? '<button name="intent" value="under_review" type="submit">Start review</button>' : ''}<button name="intent" value="returned" type="submit" class="danger">Return for correction</button><button name="intent" value="approved" type="submit" class="primary">Approve diary</button></div></form>`) : ''}${!d.force_deleted && d.canAmend && d.status === 'approved' ? card('Preserve the original, request an amendment', `<div class="cardbody"><p class="muted">An amendment keeps the approved version and returns a new version to the teacher for correction and review.</p>${button('Request amendment', 'amend', 'danger')}</div>`) : ''}${card('Attachments', `<div class="cardbody">${d.attachments.length ? `<div class="file-list">${d.attachments.map((f) => `<a href="/api/attachments/${f.id}" download>${icon('file')}${esc(f.name)} · ${Math.round(f.size / 1024)} KB</a>`).join('')}</div>` : '<p class="muted">No attachments added.</p>'}${editable ? `<form id="upload-form"><label class="field">Add a private attachment (PNG, JPG, PDF · up to ${Math.round((state.school.uploadMaxBytes || 5242880) / 1048576)} MB)<input name="attachment" type="file" accept="image/png,image/jpeg,application/pdf" required></label><button type="submit" class="small">Upload attachment</button></form>` : ''}</div>`)}<div id="version-history"></div>`;
}
async function reports(q) {
  await lookups();
  q = { start: today(), end: today(), ...q };
  const data = await api('/api/reports?' + qs(q));
  state.report = data;
  state.reportQ = q;
  const group = q.group || 'teacher',
    grouped = new Map();
  for (const s of data.slots) {
    const key =
      group === 'class'
        ? s.class_name + ' / ' + s.section_name
        : group === 'subject'
          ? s.subject_name
          : group === 'date'
            ? s.date
            : s.teacher_name;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(s);
  }
  $('#content').innerHTML =
    heading(
      'Reports & teaching progress',
      'Daily, weekly, monthly and filtered views of your authorized records.',
      can('export')
        ? `${button('PDF report', 'report-export', '', 'data-format="pdf"')}${button('Spreadsheet (CSV)', 'report-export', 'primary', 'data-format="csv"')}`
        : '',
    ) +
    `<section class="card">${filterForm(q, true)}<div class="cardbody actions"><label>Group by <select id="report-group">${['teacher', 'class', 'subject', 'date'].map((v) => `<option ${group === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>${button('Daily', 'report-window', 'small', 'data-days="0"')}${button('Last 7 days', 'report-window', 'small', 'data-days="6"')}${button('Last 30 days', 'report-window', 'small', 'data-days="29"')}</div><div class="report-summary"><div><b>${data.total}</b><small>Expected periods</small></div><div><b>${data.submitted}</b><small>Submitted</small></div><div><b>${data.overdue}</b><small>Overdue</small></div><div><b>${data.total ? Math.round((data.submitted / data.total) * 100) : 0}%</b><small>Submission rate</small></div></div>${grouped.size ? `<div class="table-wrap"><table><thead><tr><th>${esc(group)}</th><th>Expected</th><th>Submitted</th><th>Approved</th><th>Returned</th><th>Overdue</th><th>Submission</th></tr></thead><tbody>${[...grouped].map(([key, rows]) => `<tr><td><strong>${esc(key)}</strong></td><td>${rows.length}</td><td>${rows.filter((s) => s.submitted).length}</td><td>${rows.filter((s) => s.status === 'approved').length}</td><td>${rows.filter((s) => s.status === 'returned').length}</td><td>${rows.filter((s) => s.overdue).length}</td><td>${Math.round((rows.filter((s) => s.submitted).length / rows.length) * 100)}%</td></tr>`).join('')}</tbody></table></div>` : empty('No scheduled periods in this range')}</section>` +
    card(
      'Syllabus & lesson progress',
      data.diaries.length
        ? `<div class="table-wrap"><table><thead><tr><th>Date / teacher</th><th>Class / subject</th><th>Topic</th><th>Syllabus progress</th><th>Status</th></tr></thead><tbody>${data.diaries.map((d) => `<tr><td>${displayDate(d.diary_date)}<small>${esc(d.assignment.teacher_name)}</small></td><td>${esc(d.assignment.class_name)} / ${esc(d.assignment.section_name)}<small>${esc(d.assignment.subject_name)}</small></td><td>${esc(d.content.topic)}</td><td>${esc(d.content.syllabus_progress || 'Not recorded')}</td><td>${badge(d.status)}</td></tr>`).join('')}</tbody></table></div>`
        : empty('No diaries in this range'),
    );
}
async function notifications() {
  const rows = await api('/api/notifications');
  $('#content').innerHTML =
    heading(
      'Notifications',
      'Submissions, review decisions, and upcoming deadlines.',
      button('Mark all as read', 'read-all', 'small'),
    ) +
    card(
      'Your updates',
      rows.length
        ? rows
            .map(
              (n) =>
                `<div class="notification ${n.read_at ? '' : 'unread'}"><div><p>${esc(n.message)}</p><small>${displayDate(n.created_at)}</small></div><div class="actions">${n.diary_id ? `<a href="#/diary?id=${n.diary_id}">${button('Open', '', 'small')}</a>` : ''}${!n.read_at ? button('Mark read', 'read', 'ghost small', `data-id="${n.id}"`) : ''}</div></div>`,
            )
            .join('')
        : empty('You’re all caught up', 'New updates will appear here.'),
    );
}
async function academics(q) {
  const lk = await lookups(),
    kind = q.kind || 'session',
    kinds = {
      session: 'Academic sessions',
      department: 'Departments',
      class: 'Classes',
      section: 'Sections',
      subject: 'Subjects',
    };
  $('#content').innerHTML =
    heading(
      'Academic setup',
      'A clear structure for every teaching responsibility.',
      button(icon('plus') + ' Add ' + kind, 'new-academic', 'primary', `data-kind="${kind}"`),
    ) +
    `<div class="actions" style-placeholder="none">${Object.entries(kinds)
      .map(
        ([key, label]) =>
          `<a href="#/academics?kind=${key}">${button(label, '', key === kind ? 'dark' : '')}</a>`,
      )
      .join('')}</div><br>` +
    card(
      kinds[kind],
      lk.academics.filter((a) => a.kind === kind).length
        ? `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Parent / dates</th><th>Status</th><th>Manage</th></tr></thead><tbody>${lk.academics
            .filter((a) => a.kind === kind)
            .map(
              (a) =>
                `<tr><td><strong>${esc(a.name)}</strong></td><td>${esc(a.parent_id ? lk.academics.find((p) => p.id === a.parent_id)?.name : [a.start_date, a.end_date].filter(Boolean).join(' → '))}</td><td>${badge(a.active ? 'active' : 'archived')}</td><td>${button('Edit / archive', 'edit-academic', 'small', `data-id="${a.id}"`)} ${button('Delete unused', 'extra-delete-academic', 'small', `data-id="${a.id}"`)}</td></tr>`,
            )
            .join('')}</tbody></table></div>`
        : empty('No ' + kinds[kind].toLowerCase() + ' configured'),
    );
}
async function timetable() {
  const lk = await lookups();
  $('#content').innerHTML =
    heading(
      'Timetable & deadlines',
      'Expected diaries follow these teaching periods and school calendar exceptions.',
      button(icon('plus') + ' Add assignment', 'new-assignment', 'primary'),
    ) +
    card(
      'Teaching assignments',
      lk.assignments.length
        ? `<div class="table-wrap"><table><thead><tr><th>Teacher / reviewer</th><th>Class / subject</th><th>Schedule</th><th>Deadlines</th><th>Status</th><th></th></tr></thead><tbody>${lk.assignments.map((a) => `<tr><td><strong>${esc(a.teacher_name)}</strong><small>Reviewer: ${esc(a.head_name)}</small></td><td>${esc(a.class_name)} / ${esc(a.section_name)}<small>${esc(a.subject_name)} · ${esc(a.session_name)}</small></td><td>${a.weekdays.map((n) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][n]).join(', ')}<small>Periods ${a.periods.join(', ')} · ${a.start_date} → ${a.end_date}</small></td><td>Submit ${a.due_time}<small>Review ${a.review_time} · ${esc(state.school.timezone)}</small></td><td>${badge(a.active ? 'active' : 'archived')}</td><td>${button('Edit schedule', 'extra-edit-assignment', 'small', `data-id="${a.id}"`)} ${button('Delete unused', 'extra-delete-assignment', 'small', `data-id="${a.id}"`)} ${button(a.active ? 'Archive' : 'Activate', 'toggle-assignment', 'small', `data-id="${a.id}" data-active="${a.active ? 'false' : 'true'}"`)}</td></tr>`).join('')}</tbody></table></div>`
        : empty(
            'No teaching assignments',
            'Configure sessions, classes, sections and subjects first.',
          ),
    ) +
    card(
      'Holidays & calendar exceptions',
      `<div class="cardbody"><form id="exception-form" class="form-grid three">${field('Date', 'date', 'date', today(), 'required')}${select(
        'Assignment (blank = school holiday)',
        'assignment_id',
        lk.assignments.map((a) => ({ id: a.id, name: a.teacher_name + ' · ' + a.subject_name })),
      )}${field('Reason', 'reason', 'text', '', 'required maxlength="200"')}<div><button type="submit" class="primary">Add exception</button></div></form>${lk.exceptions.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Scope</th><th>Reason</th><th></th></tr></thead><tbody>${lk.exceptions.map((x) => `<tr><td>${x.date}</td><td>${esc(x.assignment_id ? lk.assignments.find((a) => a.id === x.assignment_id)?.teacher_name : 'Whole school')}</td><td>${esc(x.reason)}</td><td>${button('Remove', 'delete-exception', 'small', `data-id="${x.id}"`)}</td></tr>`).join('')}</tbody></table></div>` : ''}</div>`,
    );
}
async function quotes() {
  await lookups();
  const data = await api('/api/quotes');
  state.quotes = data;
  $('#content').innerHTML =
    heading(
      'Words for the day',
      'School-approved quotes, in every language your community needs.',
      button(icon('plus') + ' Add quote', 'new-quote', 'primary'),
    ) +
    `<div class="alert">Use exact approved text. Urdu and Arabic use right-to-left display. Submitted diary records preserve their selected quote text.</div><div class="grid-equal">${data.quotes.map((q) => `<section class="card quote-card"><div class="cardbody"><div class="actions"><span class="eyebrow">${esc(q.language)}</span>${badge(q.active ? 'active' : 'inactive')}</div><p class="quote-text" lang="${esc(q.language)}" dir="${q.direction}">${esc(q.text)}</p><small>${esc(q.scope_id ? state.lookups.users.find((u) => u.id === q.scope_id)?.name || 'Assigned scope' : 'Whole school')}</small><div class="actions">${button('Schedule', 'schedule-quote', 'small', `data-id="${q.id}"`)}${button('Edit text', 'edit-quote', 'small', `data-id="${q.id}"`)}${button(q.active ? 'Deactivate' : 'Activate', 'toggle-quote', 'small', `data-id="${q.id}" data-active="${q.active ? 'false' : 'true'}"`)}</div></div></section>`).join('')}</div>${!data.quotes.length ? card('Quote library', empty('No approved quotes yet', 'Add exact school-approved text and schedule it for a teaching date.')) : ''}` +
    card(
      'Scheduled selections',
      data.schedules.length
        ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Language / quote</th><th>Priority</th><th></th></tr></thead><tbody>${data.schedules
            .sort((a, b) => b.date.localeCompare(a.date))
            .map(
              (s) =>
                `<tr><td>${s.date}</td><td>${esc(s.language)}<small>${esc(s.text)}</small></td><td>${s.priority}</td><td>${button('Remove', 'delete-schedule', 'small', `data-id="${s.id}"`)}</td></tr>`,
            )
            .join('')}</tbody></table></div>`
        : empty(
            'No quotes scheduled',
            'Higher priority selects the quote when more than one applies in a language.',
          ),
    );
}
async function schoolSettings(template = false) {
  if (!template) {
    await extraUI.identity();
    const { mountDiagnostics } = await import('./admin-diagnostics.js');
    await mountDiagnostics($('#content'), { api, esc });
    return;
  }
  const s = await api('/api/settings');
  state.school = s;
  const versions = await api('/api/templates');
  $('#content').innerHTML =
    heading(
      template ? 'Diary template' : 'School settings',
      template
        ? 'One versioned template for preview, PDF, images, and print.'
        : 'Verified school identity, deadlines, and operating preferences.',
    ) +
    `<form id="settings-form"><div class="alert error" id="form-error" role="alert"></div><section class="card"><div class="cardhead"><h2>${template ? 'Branding & required fields' : 'School identity & calendar'}</h2><small>Version ${s.templateVersion}</small></div><div class="cardbody form-grid">${select(
      'Legacy reflection diary layout',
      'diaryLayout',
      [
        { id: 'homework_grid', name: 'Homework · landscape sheet' },
        { id: 'teaching', name: 'Teaching reflection · portrait' },
      ],
      s.diaryLayout || 'teaching',
      'required',
    )}${field('School name', 'name', 'text', s.name, 'required maxlength="300"')}${field('School address (optional)', 'address', 'text', s.address, 'maxlength="300"')}${field('Contact details (optional)', 'contact', 'text', s.contact, 'maxlength="300"')}${field('Session label (optional)', 'session', 'text', s.session, 'maxlength="300"')}${field('School timezone (IANA)', 'timezone', 'text', s.timezone, 'required placeholder="e.g. Asia/Karachi"')}${field('Default submission time', 'submissionTime', 'time', s.submissionTime, 'required')}${field('Default review time', 'reviewTime', 'time', s.reviewTime, 'required')}${field('Retention policy (days)', 'retentionDays', 'number', s.retentionDays, 'required min="30" max="36500"')}<div class="full callout">Deadline changes apply to new assignments. Existing assignment deadlines remain explicit. Historical diary templates and quote text remain preserved. Retention is recorded as policy; deletion requires an explicit reviewed operation.</div><label class="field full">School logo (optional PNG/JPG, under 200 KB)<input type="file" name="logoFile" accept="image/png,image/jpeg"></label>${s.logo ? `<img class="settings-logo" src="${esc(s.logo)}" alt="Configured school logo">` : ''}<label class="checkbox"><input type="checkbox" name="clearLogo">Remove current logo</label><div class="full"><div class="section-title">Required reflection fields (legacy diaries)</div><div class="templatefields">${Object.entries(
      labels,
    )
      .map(
        ([k, label]) =>
          `<label class="checkbox"><input type="checkbox" name="requiredFields" value="${k}" ${s.requiredFields.includes(k) ? 'checked' : ''} ${k === 'topic' ? 'disabled' : ''}>${esc(label)}</label>`,
      )
      .join(
        '',
      )}</div></div>${state.user.role === 'super_admin' ? `<label class="checkbox full"><input name="allowSelfApproval" type="checkbox" ${s.allowSelfApproval ? 'checked' : ''}>Legacy reflection diaries only: authorize self-approval for users who hold review permission (audited). Modern class diaries always require another reviewer.</label>` : ''}</div><div class="formfoot"><small class="muted">Publishing creates a new immutable template version.</small><button class="primary" type="submit">Publish settings & template</button></div></section></form>` +
    card(
      'Template structure',
      `<div class="cardbody"><div class="callout">School header → date/session/teacher/class/subject/period → topic/chapter → academic fields → optional classroom information → review history → approved multilingual quote footer → page number. Long content flows across A4 pages.</div><p class="muted">Open a diary preview to see the configured template with real diary content. Historical diaries retain the version used at creation.</p></div>`,
    ) +
    card(
      'Homework template',
      `<div class="cardbody"><p class="muted">A4 portrait · subject homework rows · R.W, L.W and Test. Sample content below is for template preview only.</p><div class="actions"><a href="/api/templates/homework-preview?format=pdf">${button('Download sample PDF', '', 'small')}</a><a href="/api/templates/homework-preview?format=png">${button('Download sample PNG', '', 'small')}</a></div><iframe class="homework-template-preview" title="Homework diary template preview" src="/api/templates/homework-preview"></iframe></div>`,
    ) +
    card(
      'Published template versions',
      `<div class="cardbody">${versions.length ? versions.map((v) => `<p>Version ${v.version} · ${displayDate(v.created_at)} · ${esc(v.snapshot.name)}</p>`).join('') : 'Initial template · Version 1'}</div>`,
    );
}
async function profile() {
  const u = state.user;
  $('#content').innerHTML =
    heading('Your profile', 'Your account, password, and school responsibilities.') +
    card(
      'Account details',
      `<form id="profile-form" class="cardbody form-grid"><div class="alert error full" id="form-error" role="alert"></div>${field('Full name', 'name', 'text', u.name, 'required maxlength="120"')}${field('Email', 'email', 'email', u.email, 'disabled')}${field('Role', 'role', 'text', roleName[u.role], 'disabled')}${field('Current password (to change password)', 'currentPassword', 'password', '', 'autocomplete="current-password"')}${field('New password (6–128 characters)', 'newPassword', 'password', '', 'minlength="12" maxlength="128" autocomplete="new-password"')}<div class="full"><button type="submit" class="primary">Save profile</button></div></form>`,
    ) +
    card(
      'Account access',
      `<div class="cardbody"><p class="muted">Sessions expire after the configured session window. A password change signs out other sessions. Your administrator manages academic assignments and permissions.</p>${button(icon('logout') + ' Sign out', 'logout', '')}</div>`,
    );
  await mountAccountSecurity($('#content'), { api, esc, toast });
}
async function auditPage(q) {
  const d = await api('/api/audit?page=' + (q.page || 1));
  $('#content').innerHTML =
    heading(
      'Audit history',
      'A permanent record of account, diary, review, configuration and download actions.',
    ) +
    card(
      'School activity',
      `<div class="table-wrap"><table><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Reference</th></tr></thead><tbody>${d.items.map((a) => `<tr><td>${displayDate(a.created_at)}</td><td>${esc(a.actor_name || 'System')}</td><td>${esc(a.action.replaceAll('_', ' '))}</td><td>${esc(a.resource_id?.slice(0, 8) || 'School settings')}</td></tr>`).join('')}</tbody></table></div><div class="pager"><span>${d.total} events</span><div class="actions">${Number(q.page || 1) > 1 ? `<a href="#/audit?page=${Number(q.page || 1) - 1}">${button('Previous', '', 'small')}</a>` : ''}${Number(q.page || 1) * 100 < d.total ? `<a href="#/audit?page=${Number(q.page || 1) + 1}">${button('Next', '', 'small')}</a>` : ''}</div></div>`,
    );
}
let generation = 0;
async function renderPage() {
  const gen = ++generation;
  const { path, q } = routeParts();
  if (!state.user) {
    if (location.hash && !location.hash.includes('/login')) state.afterLogin = location.hash;
    login();
    return;
  }
  if (state.user.mustChangePassword) return firstLogin();
  state.route = path;
  shell(navItems().find((x) => x[0] === path)?.[2] || 'Teaching diary');
  try {
    if (await school.route(path, q)) {
      if (
        recovery.restore(
          document.querySelector('#school-diary-write'),
          state.user.id,
          location.hash,
        )
      ) {
        state.dirty = true;
        toast('Your unsaved diary has been recovered. Review it before saving.');
      }
      return;
    }
    const routes = {
      legacynew: () => diaryForm(q),
      legacy: () => history(q),
      classdiary: () => extraUI.classDiary(q),
      messages: () => extraUI.messages(q),
      oversight: () => extraUI.oversight(q),
      dashboard: () => dashboard(q),
      diaries: () => history(q),
      review: () => history(q, true),
      new: () => diaryForm(q),
      diary: () => diaryDetail(q),
      reports: () => reports(q),
      notifications,
      academics: () => academics(q),
      timetable,
      quotes,
      settings: () => schoolSettings(false),
      template: () => schoolSettings(true),
      profile,
      audit: () => auditPage(q),
    };
    if (!routes[path]) throw Error('Page not found.');
    await routes[path]();
    await extraUI.augment(path);
    if (recovery.restore(document.querySelector('#diary-form'), state.user.id, location.hash)) {
      state.dirty = true;
      toast('Your unsaved diary has been recovered. Review it before saving.');
    }
  } catch (e) {
    if (gen === generation && $('#content'))
      $('#content').innerHTML =
        `<div class="alert error" role="alert">${esc(e.message)}</div>${button('Try again', 'reload', '')} <a href="#/dashboard">Return to overview</a>`;
  }
}
const render = serializeRender(renderPage);
function formData(form) {
  return Object.fromEntries(new FormData(form));
}
function modal(title, body, onSubmit) {
  const el = $('#modal');
  el.classList.remove('force-delete-dialog');
  el.setAttribute('aria-labelledby', 'modal-title');
  el.innerHTML = `<form id="modal-form"><h2 id="modal-title">${esc(title)}</h2><div class="alert error" id="modal-error" role="alert"></div>${body}<div class="actions"><button type="button" data-action="close-modal">Cancel</button><button class="primary" type="submit">Save</button></div></form>`;
  el.showModal();
  $('#modal-form').onsubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    await busy(
      form,
      async () => {
        await onSubmit(formData(form), form);
        el.close();
        await render();
      },
      '#modal-error',
    );
  };
}
async function busy(form, fn, errorTarget = '#form-error') {
  if (form.dataset.submitting === 'true') return;
  form.dataset.submitting = 'true';
  form.setAttribute('aria-busy', 'true');
  const buttons = $$('button', form).map((button) => ({ button, disabled: button.disabled }));
  buttons.forEach(({ button }) => (button.disabled = true));
  try {
    await fn();
  } catch (e) {
    const target = $(errorTarget);
    if (target) {
      target.textContent = e.message;
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else toast(e.message);
  } finally {
    buttons.forEach(({ button, disabled }) => (button.disabled = disabled));
    delete form.dataset.submitting;
    form.removeAttribute('aria-busy');
  }
}
async function askConfirm(title, message, fn) {
  return new Promise((resolve) => {
    const el = $('#modal');
    el.setAttribute('aria-labelledby', 'modal-title');
    el.innerHTML = `<h2 id="modal-title">${esc(title)}</h2><p>${esc(message)}</p><div class="alert error" id="modal-error"></div><div class="actions">${button('Cancel', 'close-modal', '')}<button class="primary" id="confirm-action">Confirm</button></div>`;
    el.showModal();
    $('#confirm-action').onclick = async () => {
      await busy(
        el,
        async () => {
          await fn();
          el.close();
          resolve(true);
          await render();
        },
        '#modal-error',
      );
    };
  });
}
document.addEventListener('submit', async (event) => {
  const form = event.target;
  if (!form.id || form.id === 'modal-form' || form.id.startsWith('school-')) return;
  event.preventDefault();
  const data = formData(form),
    intent = event.submitter?.value;
  await busy(form, async () => {
    if (form.id === 'login-form') {
      const result = await api('/api/login', { method: 'POST', body: data });
      state.user = result.user;
      state.csrf = result.csrf;
      const me = await api('/api/me');
      state.school = me.school;
      const boot = await api('/api/school/bootstrap');
      state.capabilities = boot.capabilities;
      state.schoolConfig = boot.structure;
      location.hash = state.user.mustChangePassword
        ? '#/first-login'
        : recovery.route(state.user.id) || state.afterLogin || '#/dashboard';
      state.afterLogin = null;
      await render();
      startPush();
    }
    if (form.id === 'filters') {
      const path =
        state.route === 'review' ? 'review' : state.route === 'reports' ? 'reports' : 'diaries';
      location.hash = '#/' + path + '?' + qs(data);
    }
    if (form.id === 'diary-form') {
      const content = Object.fromEntries(Object.keys(labels).map((k) => [k, data[k] || '']));
      content.diary_layout = data.diary_layout;
      if (data.diary_layout === 'homework_grid') {
        content.homework_rows = $$('.homework-editor-row', form).map((row) => ({
          subject: $('input[name=homework_subject]', row).value,
          detail: $('textarea[name=homework_detail]', row).value,
          ...Object.fromEntries(
            ['hw', 'learn', 'test'].map((k) => [
              k,
              $('[data-homework-flag=' + k + ']', row).checked,
            ]),
          ),
          direction: 'auto',
        }));
      }
      const did = form.dataset.id,
        body = {
          assignment_id: data.assignment_id,
          diary_date: data.diary_date,
          period: Number(data.period),
          version: Number(form.dataset.version),
          content,
          submit: intent === 'submit',
        };
      const d = await api('/api/diaries' + (did ? '/' + did : ''), {
        method: did ? 'PUT' : 'POST',
        body,
      });
      state.dirty = false;
      toast(intent === 'submit' ? 'Diary submitted for review.' : 'Your draft is saved.');
      location.hash = '#/diary?id=' + d.id;
    }
    if (form.id === 'review-form') {
      await api('/api/diaries/' + state.diary.id + '/review', {
        method: 'POST',
        body: { action: intent, remarks: data.remarks, version: state.diary.version },
      });
      toast(
        intent === 'returned'
          ? 'Diary returned with feedback.'
          : intent === 'approved'
            ? 'Diary approved.'
            : 'Review started.',
      );
      await render();
    }
    if (form.id === 'profile-form') {
      await api('/api/profile', { method: 'PATCH', body: data });
      const me = await api('/api/me');
      state.user = me.user;
      toast('Profile updated.');
      await render();
    }
    if (form.id === 'first-login-form') {
      if (data.newPassword !== data.confirmPassword) throw Error('The two new passwords do not match.');
      await api('/api/profile', {
        method: 'PATCH',
        body: {
          name: state.user.name,
          currentPassword: data.currentPassword,
          newPassword: data.newPassword,
        },
      });
      state.user = (await api('/api/me')).user;
      const boot = await api('/api/school/bootstrap');
      state.capabilities = boot.capabilities;
      state.schoolConfig = boot.structure;
      toast('Password changed. Welcome!');
      location.hash = '#/dashboard';
      await render();
    }
    if (form.id === 'exception-form') {
      await api('/api/exceptions', { method: 'POST', body: data });
      toast('Calendar exception added.');
      await render();
    }
    if (form.id === 'upload-form') {
      const file = form.attachment.files[0];
      if (file.size > (state.school.uploadMaxBytes || 5242880))
        throw Error('File exceeds the configured upload limit.');
      const dataUrl = await fileUrl(file);
      await api('/api/diaries/' + state.diary.id + '/attachments', {
        method: 'POST',
        body: { name: file.name, mime: file.type, data: dataUrl.split(',')[1] },
      });
      toast('Attachment saved.');
      await render();
    }
    if (form.id === 'settings-form') {
      const logoFile = form.logoFile.files[0];
      let logo = state.school.logo || '';
      if (logoFile) {
        if (logoFile.size > 200000) throw Error('Logo must be under 200 KB.');
        logo = await fileUrl(logoFile);
      }
      if (form.clearLogo.checked) logo = '';
      const requiredFields = [
        'topic',
        ...$$('input[name=requiredFields]:checked', form)
          .map((x) => x.value)
          .filter((k) => k !== 'topic'),
      ];
      await api('/api/settings', {
        method: 'PUT',
        body: {
          ...data,
          expected_template_version: state.school.templateVersion,
          logo,
          requiredFields,
          retentionDays: Number(data.retentionDays),
          allowSelfApproval: form.allowSelfApproval?.checked || false,
        },
      });
      toast('New settings and template version published.');
      await render();
    }
  });
});
function fileUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(Error('File could not be read.'));
    r.readAsDataURL(file);
  });
}
document.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-action]');
  if (!target || !target.dataset.action) return;
  event.preventDefault();
  const action = target.dataset.action;
  try {
    if (action.startsWith('school-') || action.startsWith('ss-')) {
      await school.click(action, target);
      return;
    }
    if (action.startsWith('extra-')) {
      await extraUI.click(action, target);
      return;
    }
    if (action === 'add-homework-row') {
      if ($$('.homework-editor-row').length >= 30) throw Error('Use at most 30 subject rows.');
      $('#homework-rows').insertAdjacentHTML('beforeend', homeworkRow());
      state.dirty = true;
      return;
    }
    if (action === 'remove-homework-row') {
      target.closest('.homework-editor-row').remove();
      state.dirty = true;
      return;
    }

    if (action === 'skip-content') $('#content')?.focus();
    if (action === 'menu') setSidebarOpen(!$('.sidebar').classList.contains('open'));
    if (action === 'menu-close') setSidebarOpen(false);
    if (action === 'close-modal') $('#modal').close();
    if (action === 'reload') await render();
    if (action === 'logout') {
      if (state.dirty && !confirm('Leave without saving this diary?')) return;
      await releaseDevice(api);
      await api('/api/logout', { method: 'POST' });
      state.pushStarted = null;
      $('#push-banner')?.remove();
      state.user = null;
      state.dirty = false;
      recovery.clear();
      location.hash = '#/login';
      login();
    }
    if (action === 'export')
      await download(
        '/api/diaries/' + state.diary.id + '/export?format=' + target.dataset.format,
        target,
      );
    if (action === 'bulk-export')
      await download('/api/export?' + target.dataset.query + '&format=pdf', target);
    if (action === 'report-export')
      await download(
        '/api/reports?' + qs({ ...state.reportQ, format: target.dataset.format }),
        target,
      );
    if (action === 'print')
      await documentActions.run('/api/diaries/' + state.diary.id + '/print', target);
    if (action === 'versions') {
      const versions = await api('/api/diaries/' + state.diary.id + '/versions');
      $('#version-history').innerHTML = card(
        'Preserved diary versions',
        versions
          .map(
            (v) =>
              `<details class="version"><summary>Version ${v.version} · ${esc(v.action.replaceAll('_', ' '))} · ${esc(v.actor_name)} · ${displayDate(v.created_at)}</summary>${v.reason ? `<p><b>Reason:</b> ${esc(v.reason)}</p>` : ''}${Object.entries(
                labels,
              )
                .filter(([key]) => v.snapshot.content[key])
                .map(([key, label]) => `<p><b>${label}</b><br>${esc(v.snapshot.content[key])}</p>`)
                .join(
                  '',
                )}${v.snapshot.content.homework_rows ? `<div>${v.snapshot.content.homework_rows.map((r) => `<p><b>${esc(r.subject)}</b> · ${esc(r.teacher_name || '')}<br>${esc(r.detail)}<br>H.W ${r.hw ? '✓' : '–'} · Learn ${r.learn ? '✓' : '–'} · Test ${r.test ? '✓' : '–'}</p>`).join('')}</div>` : ''}<p>Status: ${esc(v.snapshot.status)}</p>${v.snapshot.quote_snapshot.map((q) => `<p lang="${esc(q.language)}" dir="${q.direction}">${esc(q.text)}</p>`).join('')}</details>`,
          )
          .join(''),
      );
      $('#version-history').scrollIntoView({ behavior: 'smooth' });
    }
    if (action === 'amend')
      modal(
        'Request a preserved amendment',
        '<label class="field">Reason (required)<textarea name="reason" required minlength="5" maxlength="10000"></textarea></label>',
        (data) =>
          api('/api/diaries/' + state.diary.id + '/amend', {
            method: 'POST',
            body: { ...data, version: state.diary.version },
          }),
      );
    if (action === 'read' || action === 'read-all') {
      await api('/api/notifications', {
        method: 'PATCH',
        body: action === 'read' ? { id: target.dataset.id } : {},
      });
      await render();
    }
    if (action === 'report-window') {
      const end = today(),
        start = new Date(Date.parse(end) - Number(target.dataset.days) * 86400000)
          .toISOString()
          .slice(0, 10);
      location.hash = '#/reports?' + qs({ ...state.reportQ, start, end });
    }
    if (action === 'new-academic') {
      const kind = target.dataset.kind;
      modal(
        'Add ' + kind,
        `<input type="hidden" name="kind" value="${kind}">${field('Name', 'name', 'text', '', 'required maxlength="100"')}${
          kind === 'section' || kind === 'subject'
            ? select(
                kind === 'section' ? 'Parent class' : 'Department (optional)',
                'parent_id',
                state.lookups.academics.filter(
                  (a) => a.kind === (kind === 'section' ? 'class' : 'department') && a.active,
                ),
                '',
                kind === 'section' ? 'required' : '',
              )
            : ''
        }${kind === 'session' ? field('Start date', 'start_date', 'date', '', 'required') + field('End date', 'end_date', 'date', '', 'required') : ''}`,
        (data) => api('/api/academics', { method: 'POST', body: data }),
      );
    }
    if (action === 'edit-academic') {
      const a = state.lookups.academics.find((a) => a.id === target.dataset.id);
      modal(
        'Edit ' + a.kind,
        field('Name', 'name', 'text', a.name, 'required maxlength="100"') +
          (a.kind === 'section' || a.kind === 'subject'
            ? select(
                a.kind === 'section' ? 'Parent class' : 'Department (optional)',
                'parent_id',
                state.lookups.academics.filter(
                  (x) => x.kind === (a.kind === 'section' ? 'class' : 'department') && x.active,
                ),
                a.parent_id || '',
                a.kind === 'section' ? 'required' : '',
              )
            : '') +
          (a.kind === 'session'
            ? field('Start date', 'start_date', 'date', a.start_date, 'required') +
              field('End date', 'end_date', 'date', a.end_date, 'required')
            : '') +
          `<label class="checkbox"><input type="checkbox" name="active" ${a.active ? 'checked' : ''}>Active</label>`,
        (data) =>
          api('/api/academics/' + a.id, {
            method: 'PATCH',
            body: { ...data, active: !!data.active },
          }),
      );
    }
    if (action === 'new-assignment') {
      await extraUI.assignment();
      return;
    }
    if (action === 'toggle-assignment')
      await askConfirm(
        'Change assignment status',
        'Archived assignments keep their diary history. They stop producing expected periods in reports.',
        () =>
          api('/api/assignments/' + target.dataset.id, {
            method: 'PATCH',
            body: { active: target.dataset.active === 'true' },
          }),
      );
    if (action === 'delete-exception')
      await askConfirm(
        'Remove calendar exception',
        'The teaching periods on this date will count toward expected diaries again.',
        () => api('/api/exceptions/' + target.dataset.id, { method: 'DELETE' }),
      );
    if (action === 'new-quote')
      modal(
        'Add exact approved quote',
        `<label class="field">Approved quote text<textarea name="text" required maxlength="1200"></textarea></label>${field('Language tag', 'language', 'text', 'en', 'required placeholder="en, ur, ar, …"')}${select(
          'Text direction',
          'direction',
          [
            { id: 'ltr', name: 'Left to right' },
            { id: 'rtl', name: 'Right to left' },
          ],
          'ltr',
          'required',
        )}${select('Scope (blank = school-wide)', 'scope_id', state.lookups.users)}`,
        (data) => api('/api/quotes', { method: 'POST', body: data }),
      );
    if (action === 'edit-quote') {
      const quote = state.quotes.quotes.find((x) => x.id === target.dataset.id);
      modal(
        'Edit quote text',
        `<p class="muted">Historical diaries retain their preserved text.</p><label class="field">Exact approved text<textarea name="text" required maxlength="1200">${esc(quote.text)}</textarea></label>`,
        (data) => api('/api/quotes/' + quote.id, { method: 'PATCH', body: data }),
      );
    }
    if (action === 'toggle-quote') {
      await api('/api/quotes/' + target.dataset.id, {
        method: 'PATCH',
        body: { active: target.dataset.active === 'true' },
      });
      await render();
    }
    if (action === 'schedule-quote') {
      const quote = state.quotes.quotes.find((x) => x.id === target.dataset.id);
      modal(
        'Schedule daily quote',
        field('Teaching date', 'date', 'date', today(), 'required') +
          field(
            'Selection priority',
            'priority',
            'number',
            '0',
            'required min="-1000" max="1000"',
          ) +
          select(
            'Scope (blank = quote scope)',
            'scope_id',
            state.lookups.users,
            quote.scope_id || '',
          ),
        (data) =>
          api('/api/quote-schedules', { method: 'POST', body: { ...data, quote_id: quote.id } }),
      );
    }
    if (action === 'delete-schedule') {
      await api('/api/quote-schedules/' + target.dataset.id, { method: 'DELETE' });
      await render();
    }
  } catch (e) {
    toast(e.message);
  }
});
document.addEventListener('change', (event) => {
  if (event.target.id === 'dashboard-date')
    location.hash = '#/dashboard?date=' + event.target.value;
  if (event.target.id === 'report-group')
    location.hash = '#/reports?' + qs({ ...state.reportQ, group: event.target.value });
});
document.addEventListener('click', (event) => {
  const a = event.target.closest('a[href^="#/"]');
  if (a && state.dirty && !confirm('Leave without saving your diary changes?'))
    event.preventDefault();
  else if (a) state.dirty = false;
});
window.addEventListener('beforeunload', (event) => {
  if (state.dirty) {
    event.preventDefault();
    event.returnValue = '';
  }
});
window.addEventListener('hashchange', () => render());
const school = schoolUI({
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
});
const extraUI = enhancedUI({
  api,
  state,
  esc,
  field,
  select,
  options,
  button,
  card,
  heading,
  empty,
  today,
  displayDate,
  toast,
  modal,
  lookups,
  render,
});
const setupShown = await showSetup(document.querySelector('#app'));
if (!setupShown)
  try {
  const me = await api('/api/me');
  state.user = me.user;
  state.csrf = me.csrf;
  state.school = me.school;
  const boot = await api('/api/school/bootstrap');
  state.capabilities = boot.capabilities;
  state.schoolConfig = boot.structure;
} catch (error) {
  if (error.status !== 401) startupError = error.message;
}
if (!setupShown) await render();
if (state.user) startPush();
if (startupError) {
  const form = $('#login-form');
  if (form) {
    const error = document.createElement('div');
    error.className = 'alert error';
    error.setAttribute('role', 'alert');
    error.textContent = startupError + ' You can retry signing in when the service is available.';
    form.prepend(error);
  }
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && $('.sidebar.open')) setSidebarOpen(false);
  if (event.key === 'Tab' && $('.sidebar.open')) {
    const items = [...$('.sidebar').querySelectorAll('button,a[href]')].filter((x) => !x.disabled),
      first = items[0],
      last = items.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }
});
window.addEventListener('resize', () => {
  if (window.innerWidth > 760 && $('.sidebar.open')) setSidebarOpen(false);
});

// ---- Device notifications: enabled automatically after sign-in ----
function pushBanner(status) {
  if (sessionStorage.getItem('push-banner-dismissed') === status) return;
  const text = {
      prompt: 'Get diary alerts on this device, even when the app is closed.',
      denied: 'Notifications are blocked for this site. Allow them in your browser’s site settings to get diary alerts.',
      ios_install: 'To get alerts on iPhone or iPad: tap Share, choose Add to Home Screen, then open the app from your Home Screen.',
    }[status],
    node = $('#push-banner') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'push-banner' }));
  if (!text) return node.remove();
  node.setAttribute('role', 'status');
  node.innerHTML = `<span>${esc(text)}</span>${status === 'prompt' ? '<button type="button" class="primary" data-push-allow>Allow notifications</button>' : ''}<button type="button" data-push-dismiss aria-label="Dismiss">✕</button>`;
  node.onclick = async (event) => {
    if (event.target.closest('[data-push-dismiss]')) {
      sessionStorage.setItem('push-banner-dismissed', status);
      return node.remove();
    }
    if (!event.target.closest('[data-push-allow]')) return;
    try {
      await enablePushNow();
    } catch (error) {
      toast(error.message);
    }
  };
}
async function enablePushNow() {
  await requestAndSubscribe(api);
  state.pushStatus = 'on';
  $('#push-banner')?.remove();
  toast('Notifications are on for this device.');
  if (location.hash.startsWith('#/notifications')) await render();
}
async function startPush() {
  if (!state.user || state.pushStarted === state.user.id) return;
  state.pushStarted = state.user.id;
  try {
    state.pushStatus = await autoEnablePush({
      api,
      onPrompt: () =>
        enablePushNow().catch((error) => {
          state.pushStatus = Notification.permission === 'denied' ? 'denied' : 'prompt';
          pushBanner(state.pushStatus);
          if (Notification.permission === 'denied') toast(error.message);
        }),
    });
    if (['prompt', 'denied', 'ios_install'].includes(state.pushStatus)) pushBanner(state.pushStatus);
  } catch {}
}
navigator.serviceWorker?.addEventListener('message', (event) => {
  if (event.data?.type === 'push-resync' && state.user) {
    state.pushStarted = null;
    startPush();
  }
});
let lastPushSync = Date.now();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !state.user || Date.now() - lastPushSync < 600000) return;
  lastPushSync = Date.now();
  state.pushStarted = null;
  startPush();
});

if (
  'serviceWorker' in navigator &&
  (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))
)
  navigator.serviceWorker.register('/sw.js').catch(() => {});
