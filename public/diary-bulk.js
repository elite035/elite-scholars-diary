const labels = {
  approved: 'Approve selected',
  returned: 'Return selected',
  under_review: 'Start review',
  submit: 'Submit selected',
  trash: 'Move drafts to trash',
  restore: 'Restore drafts',
  amend: 'Request amendment',
};
export function diaryBulkToolbar({
  mode = 'submissions',
  caps = [],
  role = '',
  trash = false,
} = {}) {
  const has = (cap) => caps.includes(cap),
    reviewer = ['super_admin', 'school_admin', 'coordinator', 'head_teacher'].includes(role);
  const operations =
    mode === 'consolidated'
      ? []
      : [
          ...(trash
            ? has('diary.delete')
              ? ['restore']
              : []
            : [
                ...(reviewer
                  ? ['approved', 'returned', 'under_review'].filter((key) =>
                      has(
                        {
                          approved: 'diary.approve',
                          returned: 'diary.return',
                          under_review: 'diary.review',
                        }[key],
                      ),
                    )
                  : []),
                ...(has('diary.edit') && has('diary.submit') ? ['submit'] : []),
                ...(has('diary.delete') ? ['trash'] : []),
                ...(has('diary.amend') ? ['amend'] : []),
              ]),
        ];
  return `<div class="diary-bulk-toolbar"><div class="diary-bulk-selection"><label class="checkbox"><input type="checkbox" data-bulk-all>Select all on this page</label><span data-bulk-count role="status">0 selected</span></div><div class="actions diary-bulk-actions">${operations.map((action) => `<button type="button" data-bulk-action="${action}" disabled>${labels[action]}</button>`).join('')}<button type="button" class="diary-bulk-refresh" data-bulk-refresh>Refresh list</button></div>${has('diary.export') && !trash ? `<div class="diary-bulk-exports"><span>Download selected as ZIP</span>${['pdf', 'png', 'jpg'].map((format) => `<button type="button" data-bulk-export="${format}" aria-label="Export selected ${format.toUpperCase()} ZIP" disabled>${format.toUpperCase()}</button>`).join('')}</div>` : ''}<details class="diary-bulk-help"><summary>How bulk actions work</summary><p class="muted">${mode === 'consolidated' ? 'Selected diaries download as individual, named files inside one ZIP. Open Teacher submissions or the Review queue to review individual submissions.' : 'Each selected diary keeps its own permissions, version and workflow history. Bulk downloads contain separate named files in a ZIP. Only unsubmitted drafts can be moved to trash.'}</p></details><div data-bulk-feedback role="status" aria-live="polite"></div></div>`;
}
export function bulkEligible(record, action) {
  const deleted = !!record.content?.deleted_at;
  if (record.force_deleted) return false;
  if (action === 'restore') return record.status === 'draft' && deleted && !record.submitted_at;
  if (deleted) return false;
  if (action === 'trash') return record.status === 'draft' && !record.submitted_at;
  if (action === 'submit') return ['draft', 'returned'].includes(record.status);
  if (action === 'amend') return record.status === 'approved';
  return ['submitted', 'resubmitted', 'under_review'].includes(record.status);
}
export function mountDiaryBulk(
  root,
  {
    records,
    mode = 'submissions',
    api,
    confirm = (message) => window.confirm(message),
    requestComment,
    exportSelected,
    refresh = () => {},
    onSuccess = () => {},
  },
) {
  const all = root.querySelector('[data-bulk-all]'),
    boxes = [...root.querySelectorAll('[data-bulk-id]')],
    count = root.querySelector('[data-bulk-count]'),
    feedback = root.querySelector('[data-bulk-feedback]'),
    buttons = [...root.querySelectorAll('[data-bulk-action],[data-bulk-export]')],
    byId = new Map(records.map((d) => [d.id, d]));
  let running = false;
  const refreshButton = root.querySelector('[data-bulk-refresh]');
  const selected = () =>
    boxes
      .filter((box) => box.checked)
      .map((box) => byId.get(box.dataset.bulkId))
      .filter(Boolean);
  function update() {
    const length = selected().length;
    count.textContent = length + ' selected on this page';
    all.checked = boxes.length > 0 && length === boxes.length;
    all.indeterminate = length > 0 && length < boxes.length;
    all.disabled = running || !boxes.length;
    boxes.forEach((box) => (box.disabled = running));
    buttons.forEach((button) => {
      const action = button.dataset.bulkAction,
        eligible = action ? selected().filter((row) => bulkEligible(row, action)).length : length;
      button.disabled = running || !eligible;
      if (action) {
        button.textContent = labels[action] + ' (' + eligible + ')';
        button.title =
          eligible +
          ' of ' +
          length +
          ' selected diaries have an eligible status. Scope and versions are checked on save.';
      }
    });
    if (refreshButton) refreshButton.disabled = running;
  }
  all.addEventListener('change', () => {
    boxes.forEach((box) => (box.checked = all.checked));
    update();
  });
  boxes.forEach((box) => box.addEventListener('change', update));
  async function run(button) {
    if (running) return;
    const items = selected().filter(
      (row) => !button.dataset.bulkAction || bulkEligible(row, button.dataset.bulkAction),
    );
    if (!items.length) return;
    running = true;
    update();
    feedback.textContent = '';
    try {
      if (button.dataset.bulkExport) {
        await exportSelected(
          items.map((d) => d.id),
          button.dataset.bulkExport,
          mode,
        );
        return;
      }
      const action = button.dataset.bulkAction;
      let remarks = '',
        reason = '';
      if (['returned', 'amend'].includes(action)) {
        const comment = await requestComment(action, items.length);
        if (comment === null) return;
        if (action === 'returned') remarks = comment.trim();
        else reason = comment.trim();
        if ((action === 'returned' ? remarks : reason).length < (action === 'amend' ? 5 : 1))
          throw Error(
            action === 'amend'
              ? 'Enter an amendment reason of at least 5 characters.'
              : 'Enter comments explaining the return.',
          );
      }
      if (
        !(await confirm(
          `${labels[action]} for ${items.length} selected teacher diar${items.length === 1 ? 'y' : 'ies'}? Each record will be validated separately.`,
        ))
      )
        return;
      const results = [];
      // Short sequential requests keep serverless operations bounded and avoid automatic retries.
      for (let start = 0; start < items.length; start += 10) {
        feedback.textContent = `Processing ${Math.min(start + 10, items.length)} of ${items.length} selected diaries…`;
        const batch = items.slice(start, start + 10);
        const response = await api('/api/school/diaries/bulk', {
          method: 'POST',
          body: {
            action,
            items: batch.map((d) => ({ id: d.id, version: d.version })),
            ...(remarks ? { remarks } : {}),
            ...(reason ? { reason } : {}),
          },
        });
        results.push(...response.results);
        for (const result of response.results)
          if (result.ok) {
            const row = byId.get(result.id);
            if (row) {
              row.version = result.version;
              row.status = result.status;
              onSuccess(row, action);
            }
            const box = boxes.find((x) => x.dataset.bulkId === result.id);
            if (box) box.checked = false;
          }
      }
      const succeeded = results.filter((x) => x.ok).length,
        failed = results.filter((x) => !x.ok);
      feedback.textContent = `${succeeded} updated; ${failed.length} not updated.`;
      if (failed.length) {
        const list = root.ownerDocument.createElement('ul');
        for (const result of failed) {
          const row = byId.get(result.id),
            li = root.ownerDocument.createElement('li');
          li.textContent =
            (row ? row.snapshot?.teacher_name + ' · ' + row.diary_date : result.id) +
            ': ' +
            result.error;
          list.append(li);
        }
        feedback.append(list);
      }
    } catch (error) {
      feedback.textContent =
        error.message +
        ' Completed changes stay saved. Reload before retrying any remaining diaries.';
    } finally {
      running = false;
      update();
    }
  }
  refreshButton?.addEventListener('click', () => {
    if (!running) refresh();
  });
  buttons.forEach((button) => button.addEventListener('click', () => run(button)));
  update();
  return { selected };
}
