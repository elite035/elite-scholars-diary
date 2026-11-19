const statusName = (value) =>
  ({
    not_submitted: 'Not submitted',
    draft: 'Draft',
    submitted: 'Pending review',
    resubmitted: 'Pending review',
    under_review: 'Under review',
    returned: 'Returned',
    approved: 'Approved',
  })[value] || 'Approval needs verification';
export function monitoringMarkup(data, esc, { selected = '', collapsed = false } = {}) {
  const open = selected && !collapsed ? data.rows.find((row) => row.section_id === selected) : null,
    detail = (item) =>
      `<tr class="monitoring-detail"><td colspan="4"><section class="monitoring-preview"><div class="monitoring-preview-title"><h3>Subjects in ${esc(item.class_name)} / ${esc(item.section_name)}</h3><button type="button" data-monitor-collapse aria-expanded="true">Hide</button></div><div class="monitoring-subjects">${item.subjects.map((subject) => `<div><span><strong>${esc(subject.name)}</strong> <small>(${esc(subject.teacher_name)})</small></span><span class="badge ${subject.status === 'approved' ? 'approved' : 'pending'}">${esc(statusName(subject.status))}</span>${subject.diary_id ? `<a href="#/schooldiaries?id=${encodeURIComponent(subject.diary_id)}">Open submission</a>` : ''}</div>`).join('')}</div></section></td></tr>`,
    clock = data.cutoff
      ? new Intl.DateTimeFormat('en-GB', {
          timeZone: data.timezone || data.timeZone || undefined,
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
        }).format(new Date(data.cutoff))
      : 'No scheduled cutoff',
    minutes = data.cutoff ? Math.ceil((Date.parse(data.cutoff) - Date.now()) / 60000) : null;
  return `<section class="monitoring-board" aria-label="Grade-wide daily diary monitoring"><div class="monitoring-title"><h2>Grade-wide daily diary monitoring</h2><button type="button" data-monitor-refresh>Refresh</button></div><form class="monitoring-filters" data-monitor-filter><label>Campus<select name="campus"><option value="">All permitted campuses</option>${data.campuses.filter((campus) => campus.id).map((campus) => `<option value="${esc(campus.id)}" ${data.campus && campus.id === data.campus ? 'selected' : ''}>${esc(campus.name)}</option>`).join('')}</select></label><label>Diary date<input name="date" type="date" required value="${esc(data.date)}"></label><div class="monitoring-cutoff"><strong>Cutoff: ${esc(clock)}</strong>${minutes === null ? '' : `<small>${minutes > 0 ? minutes + ' min left' : 'Cutoff passed'}</small>`}</div></form><div class="monitoring-kpis"><div><strong>${data.rows.length}</strong><span>Sections</span></div><div class="ok"><strong>${data.rows.filter((r) => r.complete).length}</strong><span>Ready for families</span></div><div class="wait"><strong>${data.rows.filter((r) => r.pending.length).length}</strong><span>Awaiting approval</span></div><div class="late"><strong>${data.rows.reduce((n, r) => n + r.missingTeachers, 0)}</strong><span>Teachers yet to submit</span></div></div><p class="monitoring-note">Submission progress and official approvals are tracked separately. Only approved content is shared with families.</p><div class="monitoring-table-wrap"><table class="monitoring-table"><caption>Section status matrix</caption><thead><tr><th>Class / section</th><th>Submissions</th><th>Status</th><th>Actions</th></tr></thead><tbody>${data.rows.map((item) => { const isOpen = open?.section_id === item.section_id, pill = item.complete ? ['ok', 'Ready'] : item.percentage === 100 ? ['wait', 'Needs approval'] : ['late', 'Awaiting']; return `<tr class="${isOpen ? 'monitoring-selected' : ''}"><td><span class="monitoring-pill ${pill[0]}">${pill[1]}</span><button type="button" class="monitoring-section" data-monitor-section="${esc(item.section_id)}" aria-pressed="${isOpen}">${esc(item.class_name)} / ${esc(item.section_name)}</button><small>${esc(item.campus_name || 'Unassigned campus')}</small></td><td><strong>${item.submitted} / ${item.expected} teachers</strong><small>${item.approved} officially approved</small></td><td><div class="monitoring-progress ${item.complete ? 'complete' : item.percentage === 100 ? 'pending' : ''}"><progress max="100" value="${item.percentage}" aria-label="Submission completion for ${esc(item.class_name + ' ' + item.section_name)}"></progress><strong>${item.percentage}%</strong></div><small>${item.complete ? 'Ready for families' : item.percentage === 100 ? 'Submitted · approval pending' : item.missingTeachers + ' awaiting submission'}</small></td><td><div class="monitoring-actions"><button type="button" class="${isOpen ? 'on' : ''}" data-monitor-section="${esc(item.section_id)}" aria-expanded="${isOpen}">${isOpen ? 'Hide subjects ▴' : 'Subject status ▾'}</button>${item.hasPublishedContent ? `<a class="button" href="#/schooldiaries?consolidated=1&section=${encodeURIComponent(item.section_id)}&date=${encodeURIComponent(data.date)}">View approved diary</a>` : ''}${item.pending.length ? `<button type="button" class="primary" data-monitor-approve="${esc(item.section_id)}">Review & approve (${item.pending.length})</button>` : ''}${item.missingTeachers && data.canRemind ? `<button type="button" data-monitor-remind="${esc(item.section_id)}">Send reminders</button>` : ''}</div></td></tr>${isOpen ? detail(item) : ''}`; }).join('') || '<tr><td colspan="4">No scheduled teaching assignments for this date and campus.</td></tr>'}</tbody></table></div><p class="monitoring-feedback" role="status" aria-live="polite" data-monitor-feedback></p></section>`;
}
export function mountMonitoring(
  host,
  { data, api, esc, onFilter, confirm = (message) => window.confirm(message) },
) {
  let selected = '',
    collapsed = false,
    busy = false;
  const draw = () => (host.innerHTML = monitoringMarkup(data, esc, { selected, collapsed }));
  draw();
  async function refresh() {
    data = await api(
      '/api/school/monitoring?' +
        new URLSearchParams({ date: data.date, ...(data.campus ? { campus: data.campus } : {}) }),
    );
    draw();
  }
  const feedback = (text) => {
    const node = host.querySelector('[data-monitor-feedback]');
    if (node) node.textContent = text;
  };
  async function operation(work) {
    if (busy) return;
    busy = true;
    host.setAttribute('aria-busy', 'true');
    host.querySelectorAll('button,select,input').forEach((button) => (button.disabled = true));
    try {
      await work();
    } catch (error) {
      feedback(error.message);
    } finally {
      busy = false;
      host.removeAttribute('aria-busy');
      host.querySelectorAll('button,select,input').forEach((button) => (button.disabled = false));
    }
  }
  host.addEventListener('submit', (event) => event.preventDefault());
  host.addEventListener('change', (event) => {
    if (!event.target.closest('[data-monitor-filter]')) return;
    const form = host.querySelector('[data-monitor-filter]');
    if (form.elements.date.value)
      onFilter({ date: form.elements.date.value, campus: form.elements.campus.value });
  });
  host.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button || busy) return;
    if (button.dataset.monitorSection) {
      const same = selected === button.dataset.monitorSection && !collapsed;
      selected = same ? '' : button.dataset.monitorSection;
      collapsed = false;
      draw();
      return;
    }
    if (button.hasAttribute('data-monitor-collapse')) {
      selected = '';
      draw();
      return;
    }
    if (button.hasAttribute('data-monitor-refresh')) return operation(refresh);
    if (button.dataset.monitorRemind)
      return operation(async () => {
        const result = await api('/api/school/monitoring/reminders', {
          method: 'POST',
          body: { section_id: button.dataset.monitorRemind, date: data.date },
        });
        feedback(result.sent + ' reminder(s) sent. ' + result.alreadySent + ' already sent today.');
      });
    if (button.dataset.monitorApprove)
      return operation(async () => {
        const row = data.rows.find((row) => row.section_id === button.dataset.monitorApprove);
        selected = row.section_id;
        collapsed = false;
        draw();
        const subjectList = row.subjects
          .filter((subject) => subject.status !== 'approved')
          .map((subject) => subject.name + ' — ' + subject.teacher_name)
          .join('\n');
        if (
          !(await confirm(
            'Approve ' +
              row.pending.length +
              ' pending teacher diary record(s) for ' +
              row.class_name +
              ' / ' +
              row.section_name +
              '?\n\nReview their full homework using Open submission before approving.\n' +
              subjectList +
              '\n\nOnly successful official approvals will become visible to families.',
          ))
        )
          return;
        const results = [];
        for (let start = 0; start < row.pending.length; start += 10) {
          const result = await api('/api/school/diaries/bulk', {
            method: 'POST',
            body: { action: 'approved', items: row.pending.slice(start, start + 10) },
          });
          results.push(...result.results);
        }
        await refresh();
        const failed = results.filter((result) => !result.ok);
        feedback(
          results.filter((result) => result.ok).length +
            ' approved.' +
            (failed.length
              ? ' ' +
                failed.length +
                ' not approved: ' +
                failed.map((result) => result.error).join(' · ')
              : ''),
        );
      });
  });
  const timer = setInterval(() => {
    if (!host.isConnected) {
      clearInterval(timer);
      return;
    }
    if (!busy && !document.hidden) operation(refresh);
  }, 60000);
  return {
    refresh,
    destroy() {
      clearInterval(timer);
    },
  };
}
