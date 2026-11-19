export function enhancedUI({
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
}) {
  const $ = (s, r = document) => r.querySelector(s),
    $$ = (s, r = document) => [...r.querySelectorAll(s)];
  let poll, selected;
  const multi = (label, name, rows) =>
    `<fieldset class="choice-list"><legend>${esc(label)}</legend>${rows.map((r) => `<label class="checkbox"><input type="checkbox" name="${name}" value="${esc(r.id)}">${esc(r.name)}</label>`).join('') || '<p>No configured choices.</p>'}</fieldset>`;
  const submit = (label = 'Save') =>
    `<div class="alert error" role="alert" data-extra-error hidden></div><button type="submit" class="primary">${label}</button>`;
  async function act(form, fn) {
    const buttons = $$('button', form);
    buttons.forEach((x) => (x.disabled = true));
    const error = $('[data-extra-error]', form);
    if (error) error.hidden = true;
    try {
      await fn();
    } catch (e) {
      if (error) {
        error.textContent = e.message;
        error.hidden = false;
      } else toast(e.message);
    } finally {
      buttons.forEach((x) => (x.disabled = false));
    }
  }
  const formBody = (f) => Object.fromEntries(new FormData(f));
  function ownForm(id, fn) {
    const f = $('#' + id);
    if (f)
      f.addEventListener('submit', (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        act(f, () => fn(formBody(f), f, e.submitter?.value));
      });
  }
  function connectedUsers(data) {
    return data.connections
      .filter((c) => c.state === 'accepted')
      .map((c) => ({
        id: c.sender_id === state.user.id ? c.recipient_id : c.sender_id,
        name: c.sender_id === state.user.id ? c.recipient_name : c.sender_name,
      }));
  }
  async function identity() {
    const s = await api('/api/settings');
    state.school = s;
    $('#content').innerHTML =
      heading('School settings', 'School name, logo and essential contact details.') +
      card(
        'School identity',
        `<form class="cardbody form-grid" id="extra-identity">${field('School name', 'name', 'text', s.name || 'Elite Scholars School and College', 'required maxlength="300"')}${field('School address (optional)', 'address', 'text', s.address || '', 'maxlength="300"')}${field('Contact details (optional)', 'contact', 'text', s.contact || '', 'maxlength="300"')}<label class="field">School logo (PNG/JPG, up to 200 KB)<input type="file" name="logoFile" accept="image/png,image/jpeg"></label><div id="identity-logo">${s.logo ? `<img class="settings-logo" alt="School logo preview" src="${esc(s.logo)}">` : ''}</div><label class="checkbox"><input type="checkbox" name="clearLogo">Remove current logo</label><div class="full">${submit('Save school identity')}</div></form>`,
      );
    const read = (f) =>
      new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(Error('Image could not be read'));
        r.readAsDataURL(f);
      });
    $('input[name=logoFile]').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 200000) {
        toast('Choose a PNG/JPG up to 200 KB.');
        e.target.value = '';
        return;
      }
      $('#identity-logo').innerHTML =
        `<img class="settings-logo" alt="New school logo preview" src="${esc(await read(file))}">`;
    });
    ownForm('extra-identity', async (d, f) => {
      const file = f.elements.logoFile.files[0];
      if (file && (file.size > 200000 || !['image/png', 'image/jpeg'].includes(file.type)))
        throw Error('Choose a PNG/JPG up to 200 KB.');
      await api('/api/school-identity', {
        method: 'PATCH',
        body: {
          expected_template_version: s.templateVersion,
          name: d.name,
          address: d.address,
          contact: d.contact,
          logo: d.clearLogo ? '' : file ? await read(file) : s.logo || '',
        },
      });
      toast('School identity saved.');
      await render();
    });
  }
  async function assignment() {
    const lk = await lookups(),
      cfg = await api('/api/enhancements'),
      active = (k) => lk.academics.filter((a) => a.kind === k && a.active);
    modal(
      'Assign teaching responsibilities',
      select(
        'Teacher',
        'teacher_id',
        lk.users.filter((u) => u.active),
        '',
        'required',
      ) +
        `<div class="callout" id="assignment-reviewer">Choose a teacher to see their configured reviewer.</div>` +
        multi(
          'Classes / Sections',
          'sections',
          active('section').map((s) => ({
            id: s.id,
            name: (lk.academics.find((a) => a.id === s.parent_id)?.name || '') + ' / ' + s.name,
          })),
        ) +
        `<div id="assignment-subjects"></div><label class="field">Teaching weekdays</label><div class="weekdays">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => `<label><input name="weekdays" value="${i}" type="checkbox" ${i > 0 && i < 6 ? 'checked' : ''}>${d}</label>`).join('')}</div>` +
        field('Periods (comma-separated 1–20)', 'periods', 'text', '1', 'required') +
        field('Submission deadline', 'due_time', 'time', state.school.submissionTime, 'required') +
        field('Review deadline', 'review_time', 'time', state.school.reviewTime, 'required'),
      async (d, f) => {
        const pairs = $$('input[name=pairs]:checked', f).map((e) => {
          const [section_id, subject_id] = e.value.split(':');
          return { section_id, subject_id };
        });
        const result = await api('/api/assignments/bulk', {
          method: 'POST',
          body: {
            teacher_id: d.teacher_id,
            pairs,
            weekdays: $$('input[name=weekdays]:checked', f).map((x) => Number(x.value)),
            periods: d.periods.split(',').map((x) => Number(x.trim())),
            due_time: d.due_time,
            review_time: d.review_time,
          },
        });
        toast(
          `${result.created.length} assignments created; ${result.skipped.length} existing assignments preserved.`,
        );
      },
    );
    const form = $('#modal-form');
    $('select[name=teacher_id]', form).addEventListener('change', (e) => {
      const reviewer = cfg.reviewers.find((x) => x.teacher_id === e.target.value);
      $('#assignment-reviewer').textContent = reviewer
        ? 'Reviewer: ' +
          (lk.users.find((x) => x.id === reviewer.head_id)?.name || 'Configured Head Teacher')
        : 'Configure this teacher’s reviewer under People & Roles first.';
    });
    form.addEventListener('change', (e) => {
      if (e.target.name !== 'sections') return;
      const selected = $$('input[name=sections]:checked', form).map((x) => x.value);
      $('#assignment-subjects').innerHTML = selected
        .map((sid) => {
          const section = lk.academics.find((x) => x.id === sid),
            subjects = active('subject').filter((x) =>
              cfg.classSubjects.some(
                (c) => c.class_id === section.parent_id && c.subject_id === x.id,
              ),
            );
          return multi(
            'Subjects for ' +
              (lk.academics.find((a) => a.id === section.parent_id)?.name || '') +
              ' / ' +
              section.name,
            'pairs',
            subjects.map((x) => ({ id: sid + ':' + x.id, name: x.name })),
          );
        })
        .join('');
    });
  }
  async function augment(path) {
    if (path !== 'messages') clearInterval(poll);
    if (
      path === 'dashboard' &&
      (state.user.role === 'super_admin' || state.user.permissions.includes('manage_academics'))
    ) {
      const lk = await lookups();
      if (!lk.assignments.length)
        $('#content').insertAdjacentHTML(
          'afterbegin',
          card(
            'Set up your school',
            `<div class="cardbody"><p>Your diary workspace is ready. Add your school’s actual records to begin.</p><ol><li><a href="#/academics?kind=session">Create the current academic session</a>.</li><li><a href="#/academics?kind=class">Add classes, sections and subjects</a>, then link subjects to each class.</li><li><a href="#/users">Create staff accounts</a> and select each teacher’s Head Teacher reviewer.</li><li><a href="#/timetable">Assign teaching responsibilities</a>, weekdays, periods and deadlines.</li><li>Teachers can save drafts and submit diaries. Heads review, return or approve them.</li></ol></div>`,
          ),
        );
    }
    if (
      path === 'users' &&
      (state.user.role === 'super_admin' || state.user.permissions.includes('manage_academics'))
    ) {
      const lk = state.lookups,
        cfg = await api('/api/enhancements');
      $('#content').insertAdjacentHTML(
        'beforeend',
        card(
          'Teacher → Head Teacher reviewer',
          `<form class="cardbody form-grid" id="extra-reviewer">${select(
            'Teacher',
            'teacher_id',
            lk.users.filter((u) => u.active),
            '',
            'required',
          )}${select(
            'Head Teacher reviewer',
            'head_id',
            lk.users.filter((u) => u.active && u.role === 'head_teacher'),
            '',
            'required',
          )}${submit('Save reviewer')}</form><div class="cardbody">${cfg.reviewers.map((r) => `<p>${esc(lk.users.find((x) => x.id === r.teacher_id)?.name)} → ${esc(lk.users.find((x) => x.id === r.head_id)?.name)} ${button('Remove default', 'extra-unlink-reviewer', 'small', `data-id="${r.teacher_id}"`)}</p>`).join('')}</div><p class="cardbody muted">Used automatically for new assignments. Existing diary reviewers and history are preserved.</p>`,
        ),
      );
      ownForm('extra-reviewer', async (d) => {
        await api('/api/teacher-reviewers', { method: 'POST', body: d });
        toast('Reviewer saved.');
        await render();
      });
    }
    if (path === 'academics') {
      const lk = state.lookups,
        cfg = await api('/api/enhancements');
      const sessions = lk.academics.filter((a) => a.kind === 'session' && a.active);
      $('#content').insertAdjacentHTML(
        'beforeend',
        card(
          'Session for new teaching assignments',
          `<form class="cardbody form-grid" id="extra-assignment-session">${select('Academic session', 'session_id', sessions, state.school.assignmentSessionId || '', 'required')}${submit('Use for new assignments')}</form><p class="cardbody muted">Used automatically on Teacher Assignment. Until configured, the current session with the latest start date is selected. Historical assignments keep their original session.</p>`,
        ),
      );
      ownForm('extra-assignment-session', async (d) => {
        await api('/api/assignment-session', { method: 'POST', body: d });
        toast('Default assignment session saved.');
        await render();
      });
      $('#content').insertAdjacentHTML(
        'beforeend',
        card(
          'Subjects / early-years categories by class',
          `<form class="cardbody" id="extra-class-subjects">${select(
            'Class',
            'class_id',
            lk.academics.filter((x) => x.kind === 'class' && x.active),
            '',
            'required',
          )}${multi(
            'Subjects / configured book or activity categories',
            'subjects',
            lk.academics.filter((x) => x.kind === 'subject' && x.active),
          )}${submit('Link selected subjects')}</form><div class="cardbody">${cfg.classSubjects.map((c) => `<p>${esc(lk.academics.find((x) => x.id === c.class_id)?.name)} → ${esc(lk.academics.find((x) => x.id === c.subject_id)?.name)} ${button('Unlink', 'extra-unlink-subject', 'small', `data-class="${c.class_id}" data-subject="${c.subject_id}"`)}</p>`).join('')}</div>`,
        ),
      );
      ownForm('extra-class-subjects', async (d, f) => {
        await api('/api/class-subjects', {
          method: 'POST',
          body: {
            class_id: d.class_id,
            subject_ids: $$('input[name=subjects]:checked', f).map((x) => x.value),
          },
        });
        toast('Class subjects linked.');
        await render();
      });
    }
  }
  async function classDiary(q) {
    const lk = await lookups(),
      as = lk.assignments,
      sections = [
        ...new Map(
          as.map((a) => [
            a.section_id,
            { id: a.section_id, name: a.class_name + ' / ' + a.section_name },
          ]),
        ).values(),
      ];
    const section = q.section || sections[0]?.id,
      date = q.date || today(),
      period = q.period || '1';
    if (!section) {
      $('#content').innerHTML =
        heading('Class diary', 'Subject entries assembled with teacher attribution.') +
        empty('No assigned classes');
      return;
    }
    const data = await api('/api/class-diary?' + new URLSearchParams({ section, date, period })),
      own = as.filter(
        (a) =>
          a.section_id === section &&
          a.teacher_id === state.user.id &&
          a.active &&
          a.periods.includes(Number(period)),
      );
    const content =
      heading(
        'Class diary',
        'Each teacher enters assigned subjects. Reviewers see the subject entries within their responsibility.',
      ) +
      card(
        'Class and date',
        `<form class="cardbody filters" id="extra-class-filter">${select('Class / Section', 'section', sections, section, 'required')}${field('Date', 'date', 'date', date, 'required')}${field('Period', 'period', 'number', period, 'required min="1" max="20"')}${submit('Open class diary')}</form>`,
      ) +
      card(
        'Combined diary',
        `<div class="cardbody">${data.entries.length ? `<div class="actions"><a class="button" href="/api/class-diary/preview?${new URLSearchParams({ section, date, period })}">Open combined preview</a>${state.user.role === 'super_admin' || state.user.permissions.includes('export') ? ['pdf', 'png', 'jpg', 'print'].map((format) => `<a class="button" href="/api/class-diary/preview?${new URLSearchParams({ section, date, period, format })}">${format.toUpperCase()}</a>`).join('') : ''}</div><iframe class="homework-template-preview" title="Combined class diary preview" src="/api/class-diary/preview?${new URLSearchParams({ section, date, period })}"></iframe>` : empty('No entries for this class period', 'Save subject entries below, or select another date.')}</div>`,
      ) +
      card(
        'Your assigned subject entries',
        own.length
          ? `<form class="cardbody" id="extra-class-save">${own
              .map((a) => {
                const d = data.entries.find((x) => x.assignment_id === a.id),
                  locked = d && !['draft', 'returned'].includes(d.status);
                return `<fieldset data-entry="${esc(a.id)}" data-id="${d?.id || ''}" data-version="${d?.version || ''}" ${locked ? 'disabled' : ''}><legend>${esc(a.subject_name)} · Reviewer ${esc(a.head_name)} · ${esc(d?.status || 'new draft')}</legend>${locked ? `<a href="#/diary?id=${d.id}">Open diary / review history</a>` : `${field('Topic', 'topic', 'text', d?.content.topic || 'Daily Homework', 'required maxlength="30000"')}<label class="field">Homework / lesson detail<textarea name="detail" maxlength="12000">${esc(d?.content.homework_rows?.map((r) => r.detail).join('\n') || d?.content.homework || '')}</textarea></label><label class="checkbox"><input name="hw" type="checkbox" ${d?.content.homework_rows?.[0]?.hw ? 'checked' : ''}>H.W</label><label class="checkbox"><input name="learn" type="checkbox" ${d?.content.homework_rows?.[0]?.learn ? 'checked' : ''}>Learn</label><label class="checkbox"><input name="test" type="checkbox" ${d?.content.homework_rows?.[0]?.test ? 'checked' : ''}>Test</label>${d?.review_remarks ? `<p>Review: ${esc(d.review_remarks)}</p>` : ''}`}</fieldset>`;
              })
              .join('')}<div class="alert error" data-extra-error role="alert" hidden></div>${
              own.some((a) => {
                const d = data.entries.find((d) => d.assignment_id === a.id);
                return !d || ['draft', 'returned'].includes(d.status);
              })
                ? `<div class="actions"><button type="submit" value="draft">Save all drafts</button><button type="submit" class="primary" value="submit">Submit subject entries</button></div>`
                : '<p>These subject entries are locked. Open an entry to review its status or request an authorized amendment.</p>'
            }</form>`
          : empty('No editable subject assignments for this period'),
      );
    $('#content').innerHTML = content;
    ownForm('extra-class-filter', async (d) => {
      location.hash = '#/classdiary?' + new URLSearchParams(d);
    });
    $('#extra-class-save')?.addEventListener('input', () => (state.dirty = true));
    ownForm('extra-class-save', async (d, f, intent) => {
      const entries = $$('fieldset[data-entry]:not([disabled])', f).map((el) => {
        const a = own.find((a) => a.id === el.dataset.entry),
          old = data.entries.find((x) => x.id === el.dataset.id);
        return {
          assignment_id: a.id,
          id: el.dataset.id || undefined,
          version: Number(el.dataset.version) || undefined,
          period: Number(period),
          content: {
            ...old?.content,
            topic: $('input[name=topic]', el).value,
            diary_layout: 'homework_grid',
            homework_rows: [
              {
                subject: a.subject_name,
                detail: $('textarea[name=detail]', el).value,
                hw: $('input[name=hw]', el).checked,
                learn: $('input[name=learn]', el).checked,
                test: $('input[name=test]', el).checked,
                direction: 'auto',
              },
            ],
          },
        };
      });
      await api('/api/class-diary/save', {
        method: 'POST',
        body: { section_id: section, diary_date: date, entries, submit: intent === 'submit' },
      });
      state.dirty = false;
      toast('Subject entries saved with their assigned reviewers.');
      await render();
    });
  }
  const svg = (d) =>
    `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICON = {
    phone: svg('<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>'),
    clip: svg('<path d="M20 11.5 12 19.5a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L9.5 17.2a1.7 1.7 0 0 1-2.4-2.4L15 7"/>'),
    send: svg('<path d="M21 3 10 14"/><path d="M21 3l-7 18-4-7-7-4z"/>'),
    back: svg('<path d="M15 5l-7 7 7 7"/>'),
    chat: svg('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>'),
    file: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>'),
    close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  };
  const initials = (t) =>
    String(t || '?')
      .replace(/\(.*?\)/g, '')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0] || '')
      .join('')
      .toUpperCase() || '?';
  const avatar = (t, kind) =>
    `<span class="comm-avatar ${kind === 'group' ? 'group' : ''}" aria-hidden="true">${esc(initials(t))}</span>`;
  const chatName = (c) =>
    c.kind === 'group'
      ? c.name
      : c.members.find((m) => m.user_id !== state.user.id)?.name || 'Private chat';
  function messageBody(m) {
    const media = /^\[\[media:([\w-]{8,64}):(img|pdf)\]\]\s*([\s\S]*)$/.exec(m.body),
      call = /^\[\[call:(ES-[a-f0-9]{16})\]\]$/.exec(m.body);
    if (call)
      return `<div class="call-card"><span class="call-ico">${ICON.phone}</span><div><b>Call invitation</b><small>Voice or video call in a new tab</small></div><a class="call-join" href="https://meet.jit.si/${call[1]}" target="_blank" rel="noopener noreferrer">Join call</a></div>`;
    if (media) {
      const url = '/api/communication/media/' + media[1];
      return (
        (media[2] === 'pdf'
          ? `<a class="file-card" href="${url}" target="_blank" rel="noopener"><span>${ICON.file}</span><div><b>PDF document</b><small>Tap to open</small></div></a>`
          : `<a class="comm-media" href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="Shared photo" loading="lazy"></a>`) +
        (media[3] ? `<p>${esc(media[3])}</p>` : '')
      );
    }
    return `<p>${esc(m.body)}</p>`;
  }
  function messageRows(rows) {
    return (
      rows
        .map((m) => {
          const own = m.sender_id === state.user.id;
          return `<article class="msg ${own ? 'own' : ''}">${own ? '' : `<b class="msg-name">${m.name ? esc(m.name) : '@' + esc(m.username || m.sender_id)}</b>`}<div class="msg-bubble">${messageBody(m)}</div><time class="msg-time">${displayDate(m.created_at)}</time></article>`;
        })
        .join('') ||
      `<div class="comm-empty small">${ICON.chat}<p>No messages yet. Say hello 👋</p></div>`
    );
  }
  async function messages(q) {
    clearInterval(poll);
    const data = await api('/api/communication'),
      connections = connectedUsers(data),
      cid = q.id;
    selected = cid;
    state.communication = data;
    const current = cid ? data.conversations.find((x) => x.id === cid) : null;
    const items =
      data.conversations
        .map((c) => {
          const n = chatName(c);
          return `<a class="comm-item ${c.id === cid ? 'active' : ''}" href="#/messages?id=${c.id}">${avatar(n, c.kind)}<span class="comm-item-text"><b>${esc(n)}</b><small>${c.kind === 'group' ? 'Group' : 'Private'} · ${displayDate(c.created_at)}</small></span><span class="comm-unread" id="chat-unread-${c.id}" ${Number(c.unread) ? '' : 'hidden'}>${c.unread}</span></a>`;
        })
        .join('') ||
      `<div class="comm-empty small">${ICON.chat}<p>No chats yet. Send a connection request below; once accepted, your chat appears here.</p></div>`;
    const extras =
      card(
        'Your username',
        `<form class="cardbody form-grid" id="extra-username">${field('Unique username', 'username', 'text', data.username, 'required minlength="3" maxlength="40"')}${submit('Save username')}</form>`,
      ) +
      card(
        'Find a user',
        `<form class="cardbody filters" id="extra-user-search">${field('Username starts with', 'username', 'text', '', 'required minlength="2" maxlength="40"')}${submit('Search')}</form><div class="cardbody" id="user-search-results"></div>`,
      ) +
      card(
        'Connection requests',
        `<div class="cardbody">${data.connections.length ? data.connections.map((c) => `<div class="notification"><p>${esc(c.sender_name)} → ${esc(c.recipient_name)} <b>${esc(c.state)}</b></p><div class="actions">${button('Block user', 'extra-block-user', 'small', `data-id="${c.sender_id === state.user.id ? c.recipient_id : c.sender_id}"`)}${c.state === 'pending' ? (c.recipient_id === state.user.id ? button('Accept', 'extra-request', 'small', `data-id="${c.id}" data-choice="accept"`) + button('Reject', 'extra-request', 'small', `data-id="${c.id}" data-choice="reject"`) : button('Cancel', 'extra-request', 'small', `data-id="${c.id}" data-choice="cancel"`)) : c.state === 'accepted' ? button('Remove connection', 'extra-request', 'small', `data-id="${c.id}" data-choice="remove"`) : ''}</div></div>`).join('') : empty('No connection requests')}</div>`,
      ) +
      card(
        'Safety controls',
        `<form class="cardbody form-grid" id="extra-block">${select('User', 'user_id', connections, '', 'required')}${submit('Block user')}</form><form class="cardbody form-grid" id="extra-report">${select('User to report', 'user_id', connections, '', 'required')}<label class="field">Reason<textarea name="reason" minlength="5" maxlength="2000" required></textarea></label>${submit('Send report to Super Admin')}</form><div class="cardbody">${data.blocks.map((b) => `<p>${esc(b.name)} ${button('Unblock', 'extra-unblock', 'small', `data-id="${b.blocked_id}"`)}</p>`).join('')}</div>`,
      );
    const pane = current
      ? `<header class="comm-head"><a class="comm-back" href="#/messages" aria-label="Back to chats">${ICON.back}</a>${avatar(chatName(current), current.kind)}<div class="comm-head-text"><b id="chat-title"></b><small id="chat-sub"></small></div><div class="comm-head-actions"><button type="button" class="comm-iconbtn" data-action="extra-call" aria-label="Start a voice or video call" title="Start a call">${ICON.phone}</button>${current.kind === 'group' ? button('Members', 'extra-members', 'small', `data-id="${cid}"`) : ''}</div></header><div id="chat-messages" class="comm-thread" role="log" aria-live="polite"></div><div id="chat-pager" class="comm-pager"></div><form id="extra-send" class="comm-composer"><div id="chat-attachment" class="comm-attach" hidden></div><div class="comm-composer-row"><label class="comm-iconbtn" title="Attach a photo or PDF" aria-label="Attach a photo or PDF">${ICON.clip}<input type="file" id="chat-file" accept="image/*,application/pdf" hidden></label><textarea name="body" maxlength="3900" rows="1" placeholder="Write a message…" aria-label="Message"></textarea><button type="submit" class="comm-send" aria-label="Send message">${ICON.send}</button></div></form><p id="chat-status" class="comm-status" role="status"></p>`
      : cid
        ? `<div class="comm-empty"><p>This conversation is unavailable.</p></div>`
        : `<div class="comm-empty">${ICON.chat}<h3>Your messages</h3><p>Choose a chat to start, share photos or PDFs, or start a call.</p></div>`;
    $('#content').innerHTML =
      `<div class="comm ${cid ? 'comm-open' : ''}"><aside class="comm-side"><div class="comm-side-head"><h2>Chats</h2><div class="comm-side-actions">${button('New group', 'extra-group', 'small')}${button('Refresh', 'extra-refresh', 'small')}</div></div><div class="comm-list">${items}</div><details class="comm-more"><summary>Connections, username &amp; safety</summary>${extras}</details><p class="comm-note">${esc(data.disclosure)}</p></aside><section class="comm-main">${pane}</section></div>`;
    ownForm('extra-username', async (d) => {
      await api('/api/communication/username', { method: 'PUT', body: d });
      toast('Username saved.');
    });
    ownForm('extra-user-search', async (d) => {
      const users = await api(
        '/api/communication/search?username=' + encodeURIComponent(d.username),
      );
      $('#user-search-results').innerHTML = users.length
        ? users
            .map(
              (u) =>
                `<p>${esc(u.name)} · @${esc(u.username)} ${button('Send request', 'extra-connect', 'small', `data-id="${u.id}"`)}</p>`,
            )
            .join('')
        : 'No matching active users.';
    });
    ownForm('extra-block', async (d) => {
      await api('/api/communication/blocks', { method: 'POST', body: d });
      toast('User blocked.');
      location.hash = '#/messages';
      await render();
    });
    ownForm('extra-report', async (d) => {
      await api('/api/communication/reports', {
        method: 'POST',
        body: { ...d, conversation_id: cid },
      });
      toast('Report saved for Super Admin oversight.');
    });
    if (cid) {
      const c = data.conversations.find((c) => c.id === cid);
      if (!c) return;
      $('#chat-title').textContent = chatName(c);
      $('#chat-sub').textContent = c.members
        .filter((m) => m.active)
        .map((m) => m.name)
        .join(', ');
      let page = 1;
      const refresh = async (mark = true) => {
        const d = await api('/api/communication/conversations/' + cid + '/messages?page=' + page);
        $('#chat-messages').innerHTML = messageRows(d.messages);
        const thread = $('#chat-messages');
        thread.scrollTop = thread.scrollHeight;
        $('#chat-pager').innerHTML =
          `${page > 1 ? button('Newer', 'extra-chat-page', 'small', `data-page="${page - 1}"`) : ''}${d.messages.length === 50 ? button('Older', 'extra-chat-page', 'small', `data-page="${page + 1}"`) : ''}`;
        $('#chat-status').textContent = 'Updated ' + new Date().toLocaleTimeString();
        if (mark)
          await api('/api/communication/conversations/' + cid + '/read', {
            method: 'POST',
            body: { last_seen: d.messages.at(-1)?.created_at },
          });
        if (mark) {
          const counts = await api('/api/communication');
          for (const c of counts.conversations) {
            const el = $('#chat-unread-' + c.id);
            if (el) {
              el.textContent = String(c.unread);
              el.hidden = !Number(c.unread);
            }
          }
        }
      };
      state.chatPage = async (p) => {
        page = p;
        await refresh(false);
      };
      await refresh();
      state.chatRefresh = () => refresh();
      let pending = null;
      const need = (ok, message) => {
        if (!ok) throw Error(message);
      };
      const attach = $('#chat-attachment'),
        fileInput = $('#chat-file'),
        box = $('#extra-send'),
        area = $('textarea', box);
      const readDataUrl = (file) =>
        new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result);
          r.onerror = () => reject(Error('The file could not be read.'));
          r.readAsDataURL(file);
        });
      const shrink = async (file) => {
        const src = await readDataUrl(file);
        const img = await new Promise((resolve, reject) => {
          const i = new Image();
          i.onload = () => resolve(i);
          i.onerror = () => reject(Error('This image could not be opened.'));
          i.src = src;
        });
        const scale = Math.min(1, 1600 / Math.max(img.width, img.height)),
          canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        for (const quality of [0.85, 0.7, 0.55]) {
          const url = canvas.toDataURL('image/jpeg', quality);
          if (url.length < 2_600_000) return url;
        }
        throw Error('This photo is too large. Please choose a smaller one.');
      };
      const clearAttachment = () => {
        pending = null;
        attach.hidden = true;
        attach.innerHTML = '';
        fileInput.value = '';
      };
      fileInput.addEventListener('change', async () => {
        const file = fileInput.files[0];
        if (!file) return;
        try {
          let url, mime;
          if (file.type === 'application/pdf') {
            need(file.size <= 2_000_000, 'PDF files must be 2 MB or smaller.');
            url = await readDataUrl(file);
            mime = 'application/pdf';
          } else if (file.type === 'image/gif') {
            need(file.size <= 2_000_000, 'GIF files must be 2 MB or smaller.');
            url = await readDataUrl(file);
            mime = 'image/gif';
          } else if (file.type.startsWith('image/')) {
            url = await shrink(file);
            mime = 'image/jpeg';
          } else throw Error('Only photos and PDF files can be shared.');
          pending = { mime, name: file.name, data: url.slice(url.indexOf(',') + 1) };
          attach.hidden = false;
          attach.innerHTML = `${mime === 'application/pdf' ? `<span class="attach-file">${ICON.file}</span>` : `<img src="${url}" alt="">`}<span class="attach-name">${esc(file.name)}</span><button type="button" class="comm-iconbtn" aria-label="Remove attachment">${ICON.close}</button>`;
          $('button', attach).addEventListener('click', clearAttachment);
        } catch (error) {
          clearAttachment();
          toast(error.message);
        }
      });
      area.addEventListener('input', () => {
        area.style.height = 'auto';
        area.style.height = Math.min(area.scrollHeight, 140) + 'px';
      });
      area.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && matchMedia('(pointer: fine)').matches) {
          e.preventDefault();
          box.requestSubmit();
        }
      });
      ownForm('extra-send', async (d, f) => {
        const text = (d.body || '').trim();
        need(text || pending, 'Write a message or attach a photo or PDF.');
        const key = f.dataset.clientId || (f.dataset.clientId = crypto.randomUUID());
        let body = text;
        if (pending) {
          if (!pending.id) {
            const up = await api('/api/communication/conversations/' + cid + '/media', {
              method: 'POST',
              body: { mime: pending.mime, name: pending.name, data: pending.data },
            });
            pending.id = up.id;
          }
          body =
            `[[media:${pending.id}:${pending.mime === 'application/pdf' ? 'pdf' : 'img'}]]` +
            (text ? ' ' + text : '');
        }
        await api('/api/communication/conversations/' + cid + '/messages', {
          method: 'POST',
          body: { body, client_id: key },
        });
        f.reset();
        area.style.height = 'auto';
        clearAttachment();
        delete f.dataset.clientId;
        page = 1;
        await refresh();
      });
      poll = setInterval(() => {
        if (state.route !== 'messages' || selected !== cid) {
          clearInterval(poll);
          return;
        }
        if (document.visibilityState === 'visible')
          refresh().catch((e) => {
            if ($('#chat-status')) $('#chat-status').textContent = 'Update failed: ' + e.message;
          });
      }, 15000);
    }
  }
  async function oversight(q) {
    const d = await api('/api/communication/oversight?page=' + (q.page || 1));
    const person = (id) => {
      const u = d.users.find((u) => u.id === id);
      return esc(u ? u.name + ' (@' + u.username + ')' : id);
    };
    $('#content').innerHTML =
      heading(
        'Communication oversight',
        'Super Admin only. Opening message contents is recorded in the audit log.',
      ) +
      card(
        'Connections',
        `<div class="cardbody">${d.connections.map((c) => `<p>${person(c.sender_id)} → ${person(c.recipient_id)} · ${esc(c.state)}</p>`).join('') || 'No connections.'}</div>`,
      ) +
      card(
        'Conversations and groups',
        `<div class="cardbody">${
          d.groups
            .map(
              (c) =>
                `<div class="notification"><div><b>${esc(c.name || 'Private conversation')}</b><p>${esc(c.id)} · Creator ${person(c.creator_id)} · ${displayDate(c.created_at)}</p><p>Members: ${d.members
                  .filter((m) => m.conversation_id === c.id && m.active)
                  .map((m) => person(m.user_id))
                  .join(
                    ', ',
                  )}</p></div>${button('Read audited history', 'extra-oversight-read', 'small', `data-id="${c.id}" data-page="1"`)}</div>`,
            )
            .join('') || 'No groups.'
        }</div>`,
      ) +
      card(
        'Membership changes',
        `<div class="cardbody">${d.events.map((e) => `<p>${displayDate(e.created_at)} · ${esc(e.conversation_id)} · ${person(e.user_id)} · ${esc(e.action)} · Actor ${person(e.actor_id)}</p>`).join('') || 'No changes.'}</div>`,
      ) +
      card(
        'Reports',
        `<div class="cardbody">${d.reports.map((r) => `<p>${displayDate(r.created_at)} · ${person(r.reporter_id)} reported ${person(r.reported_user_id)}<br>${esc(r.reason)}</p>`).join('') || 'No reports.'}</div>`,
      ) +
      `<div class="actions">${Number(q.page || 1) > 1 ? `<a href="#/oversight?page=${Number(q.page) - 1}">Previous</a>` : ''}<a href="#/oversight?page=${Number(q.page || 1) + 1}">Next page</a></div><div id="oversight-messages"></div>`;
  }
  async function manageClick(action, target) {
    const uid = target.dataset.id;
    if (action === 'extra-edit-assignment') {
      const a = state.lookups.assignments.find((a) => a.id === uid);
      modal(
        'Edit assignment schedule',
        '<p>Assignments with diary history must be archived and replaced.</p>' +
          multi(
            'Teaching weekdays',
            'weekdays',
            ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((name, id) => ({ id, name })),
          ) +
          field('Periods (comma separated)', 'periods', 'text', a.periods.join(','), 'required') +
          field('Submission time', 'due_time', 'time', a.due_time, 'required') +
          field('Review time', 'review_time', 'time', a.review_time, 'required'),
        (d, f) =>
          api('/api/assignments/' + uid + '/schedule', {
            method: 'PATCH',
            body: {
              ...d,
              weekdays: $$('input[name=weekdays]:checked', f).map((x) => Number(x.value)),
              periods: d.periods.split(',').map((x) => Number(x.trim())),
            },
          }),
      );
      $$('input[name=weekdays]', $('#modal-form')).forEach(
        (x) => (x.checked = a.weekdays.includes(Number(x.value))),
      );
      return true;
    }
    const removals = {
      'extra-delete-academic': [
        'Delete unused academic record',
        '/api/academics/' + uid,
        undefined,
      ],
      'extra-delete-assignment': ['Delete unused assignment', '/api/assignments/' + uid, undefined],
      'extra-unlink-subject': [
        'Unlink class subject',
        '/api/class-subjects',
        { class_id: target.dataset.class, subject_id: target.dataset.subject },
      ],
      'extra-unlink-reviewer': [
        'Remove default reviewer',
        '/api/teacher-reviewers',
        { teacher_id: uid },
      ],
    };
    if (removals[action]) {
      const [title, path, body] = removals[action];
      modal(
        title,
        '<p>Records with teaching or communication history are protected. Archive them when deletion is unavailable. Removing a reviewer default does not change existing diary reviewers.</p>' +
          field('Type REMOVE to confirm', 'confirmation', 'text', '', 'required pattern="REMOVE"'),
        async (d) => {
          if (d.confirmation !== 'REMOVE') throw Error('Type REMOVE to confirm.');
          await api(path, { method: 'DELETE', body });
          toast('Management record removed.');
        },
      );
      return true;
    }
    return false;
  }
  async function click(action, target) {
    if (await manageClick(action, target)) return;
    const data = state.communication;
    if (action === 'extra-call') {
      const room =
        'ES-' +
        Array.from(crypto.getRandomValues(new Uint8Array(8)), (n) => n.toString(16).padStart(2, '0')).join('');
      await api('/api/communication/conversations/' + selected + '/messages', {
        method: 'POST',
        body: { body: `[[call:${room}]]`, client_id: crypto.randomUUID() },
      });
      toast('Call invitation sent. Tap “Join call” to enter the room.');
      if (state.chatRefresh) await state.chatRefresh();
      return;
    }
    if (action === 'extra-refresh') {
      await render();
      return;
    }
    if (action === 'extra-connect') {
      await api('/api/communication/requests', {
        method: 'POST',
        body: { user_id: target.dataset.id },
      });
      toast('Connection request sent.');
      await render();
    }
    if (action === 'extra-block-user') {
      await api('/api/communication/blocks', {
        method: 'POST',
        body: { user_id: target.dataset.id },
      });
      toast('User blocked.');
      location.hash = '#/messages';
      await render();
    }
    if (action === 'extra-request') {
      await api('/api/communication/requests/' + target.dataset.id, {
        method: 'PATCH',
        body: { action: target.dataset.choice },
      });
      toast('Connection updated.');
      await render();
    }
    if (action === 'extra-unblock') {
      await api('/api/communication/blocks', {
        method: 'DELETE',
        body: { user_id: target.dataset.id },
      });
      await render();
    }
    if (action === 'extra-group')
      modal(
        'Create group',
        field('Group name', 'name', 'text', '', 'required minlength="2" maxlength="100"') +
          multi('Accepted connections', 'members', connectedUsers(data)),
        async (d, f) => {
          const c = await api('/api/communication/groups', {
            method: 'POST',
            body: {
              name: d.name,
              members: $$('input[name=members]:checked', f).map((e) => e.value),
            },
          });
          location.hash = '#/messages?id=' + c.id;
        },
      );
    if (action === 'extra-chat-page') await state.chatPage(Number(target.dataset.page));
    if (action === 'extra-members') {
      const cid = target.dataset.id,
        c = data.conversations.find((c) => c.id === cid),
        d = await api('/api/communication/conversations/' + cid + '/members');
      modal(
        'Group members and history',
        `<p>Only the creator can add/remove other members. Members can leave.</p>${d.members.map((m) => `<p>${esc(m.name)} · ${m.active ? 'Active' : 'Removed'} ${m.active && m.user_id !== c.creator_id && (state.user.id === c.creator_id || m.user_id === state.user.id) ? button(m.user_id === state.user.id ? 'Leave' : 'Remove member', 'extra-remove-member', 'small', `type="button" data-id="${cid}" data-user="${m.user_id}"`) : ''}</p>`).join('')}${
          state.user.id === c.creator_id
            ? select(
                'Add accepted connection',
                'user_id',
                connectedUsers(data).filter(
                  (u) => !d.members.some((m) => m.user_id === u.id && m.active),
                ),
              )
            : ''
        }<h3>Membership history</h3>${d.events.map((e) => `<p>${displayDate(e.created_at)} · ${esc(e.user_id)} · ${esc(e.action)}</p>`).join('')}`,
        async (d) => {
          if (d.user_id)
            await api('/api/communication/conversations/' + cid + '/members', {
              method: 'POST',
              body: { user_id: d.user_id },
            });
        },
      );
    }
    if (action === 'extra-remove-member') {
      await api('/api/communication/conversations/' + target.dataset.id + '/members', {
        method: 'DELETE',
        body: { user_id: target.dataset.user },
      });
      $('#modal').close();
      await render();
    }
    if (action === 'extra-oversight-read') {
      const page = Number(target.dataset.page) || 1,
        cid = target.dataset.id,
        d = await api('/api/communication/oversight/' + cid + '?page=' + page);
      $('#oversight-messages').innerHTML = card(
        'Audited message history',
        `<div class="cardbody">${messageRows([...d.messages].reverse())}<div class="actions">${page > 1 ? button('Newer', 'extra-oversight-read', 'small', `data-id="${cid}" data-page="${page - 1}"`) : ''}${d.messages.length === 50 ? button('Older', 'extra-oversight-read', 'small', `data-id="${cid}" data-page="${page + 1}"`) : ''}</div></div>`,
      );
      $('#oversight-messages').scrollIntoView();
    }
  }
  return { identity, assignment, augment, classDiary, messages, oversight, click };
}
