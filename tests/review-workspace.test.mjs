import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { schoolUI } from '../public/school.js';

function workspace({ route, diary = null } = {}) {
  const { document, window } = parseHTML('<html><body><main id="content"></main></body></html>');
  globalThis.document = document;
  globalThis.window = window;
  const capabilities = ['diary.review', 'diary.return', 'diary.approve', 'diary.export'],
    state = {
      user: { id: 'head-1', role: 'head_teacher', name: 'Head Teacher' },
      capabilities,
      schoolConfig: null,
    },
    structure = {
      academics: [],
      nodes: [],
      reviewers: [{ teacher_id: 'teacher-1', head_id: 'head-1' }],
    },
    api = async (path) => {
      if (path === '/api/school/bootstrap') return { capabilities, structure };
      if (path.startsWith('/api/school/diaries/') && path.endsWith('/versions')) return [];
      if (path.startsWith('/api/school/diaries/') && diary) return diary;
      if (path.startsWith('/api/school/diaries?'))
        return { items: [], total: 0, page: 1 };
      throw new Error(`Unexpected API request: ${path}`);
    },
    esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
    ),
    field = (label, name, type, value = '', attrs = '') =>
      `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${attrs}></label>`,
    select = (label, name, options, value = '') =>
      `<label>${label}<select name="${name}"><option value="">All</option>${options
        .map((option) => `<option value="${esc(option.id)}">${esc(option.name)}</option>`)
        .join('')}</select></label>`,
    heading = (title, description, actions = '') =>
      `<header class="pagehead"><div><h1>${esc(title)}</h1><p>${esc(description)}</p></div><div class="actions">${actions}</div></header>`,
    card = (title, body, action = '') =>
      `<section class="card"><header class="cardhead"><h2>${esc(title)}</h2>${action}</header>${body}</section>`,
    ui = schoolUI({
      api,
      state,
      esc,
      field,
      select,
      button: (label, action, cls = '', attrs = '') =>
        `<button class="${cls}" data-action="${action}" ${attrs}>${label}</button>`,
      card,
      heading,
      empty: (title, description) => `<p>${title}: ${description}</p>`,
      today: () => '2026-11-15',
      displayDate: (date) => date,
      toast: () => {},
      modal: () => {},
      render: async () => {},
    });
  return { document, ui, route };
}

const sampleDiary = {
  id: 'diary-1',
  teacher_id: 'teacher-1',
  status: 'submitted',
  version: 3,
  language: 'en',
  diary_date: '2026-11-15',
  content: { homework_rows: [{ subject: 'English' }] },
  snapshot: {
    meta: { class_name: 'Class 4', section_name: 'Blue' },
    teacher_name: 'Teacher One',
  },
};

test('review detail keeps the authorized decision actions and presents the new review context', async () => {
  const page = workspace({ diary: sampleDiary });
  await page.ui.route('review', { id: sampleDiary.id });
  assert.equal(page.document.querySelectorAll('.review-detail').length, 1);
  assert.equal(page.document.querySelectorAll('.review-detail-summary').length, 1);
  assert.equal(page.document.querySelector('#school-review').querySelectorAll('button').length, 3);
  assert.ok(page.document.querySelector('[value="approved"]'));
  assert.ok(page.document.querySelector('[value="returned"]'));
  assert.ok(page.document.querySelector('[value="under_review"]'));
  assert.ok(page.document.querySelector('.review-back'));
  assert.ok(page.document.querySelector('textarea[name="remarks"]'));
});

test('review queue empty state and metric summary render when there is nothing to review', async () => {
  const page = workspace();
  await page.ui.route('review', {});
  assert.equal(page.document.querySelectorAll('.review-overview').length, 1);
  assert.match(page.document.querySelector('.review-empty').textContent, /Nothing waiting for review/);
  assert.equal(page.document.querySelectorAll('.review-item').length, 0);
});
