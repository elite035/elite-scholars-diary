import { portraitDiaryCss, portraitFittingCss } from './portrait-diary.mjs';
import { consolidatedCss } from './consolidated-layout.mjs';
import {
  supportedDiaryLanguage,
  subjectLanguage,
  languageDirection,
} from '../public/diary-languages.js';
const esc = (x) =>
  String(x ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
export const homeworkSubjects = [
  'English A',
  'English B',
  'Mathematics',
  'Science',
  'Computer',
  'Urdu',
  'Islamiat',
  'Art & Craft',
];
export function normalizeHomework(content, submit, check) {
  const layout = content.diary_layout || 'teaching';
  check(['teaching', 'homework_grid'].includes(layout), 'Unknown diary format', 400);
  if (layout === 'teaching') return content.diary_layout ? { diary_layout: layout } : {};
  check(
    Array.isArray(content.homework_rows) && content.homework_rows.length <= 30,
    'Add up to 30 subject rows',
    400,
  );
  const rows = content.homework_rows
    .map((row) => {
      check(row && typeof row === 'object' && !Array.isArray(row), 'Invalid subject row', 400);
      check(
        typeof row.subject === 'string' &&
          row.subject.length <= 100 &&
          typeof row.detail === 'string' &&
          row.detail.length <= 12000,
        'Subject names or homework details are too long',
        400,
      );
      for (const flag of ['hw', 'learn', 'test'])
        check(
          row[flag] === undefined || typeof row[flag] === 'boolean',
          'Homework marks must be checked or unchecked',
          400,
        );
      check(
        ['auto', 'ltr', 'rtl'].includes(row.direction || 'auto'),
        'Invalid homework text direction',
        400,
      );
      if (row.language !== undefined)
        check(
          row.language === '' || supportedDiaryLanguage(row.language),
          'Choose a supported subject language',
          400,
        );
      return {
        ...(row.language !== undefined ? { language: row.language } : {}),
        subject: row.subject.trim(),
        detail: row.detail.trim(),
        hw: row.hw === true,
        learn: row.learn === true,
        test: row.test === true,
        direction:
          row.language !== undefined ? languageDirection(row.language) : row.direction || 'auto',
      };
    })
    .filter((row) => row.subject || row.detail);
  if (submit) {
    check(
      rows.some((row) => row.subject && row.detail),
      'Enter homework for at least one subject',
      400,
    );
    check(
      rows.every((row) => !row.detail || row.subject),
      'Name every subject with homework',
      400,
    );
  }
  return { diary_layout: layout, homework_rows: rows };
}
const svg = (body) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">${body}</svg>`;
const calendar = svg(
  '<path d="M5 2h2v3h10V2h2v3h2v17H3V5h2V2Zm0 8v10h14V10H5Zm2 2h3v3H7v-3Zm5 0h3v3h-3v-3Zm-5 5h3v2H7v-2Zm5 0h3v2h-3v-2Z"/>',
);
const cap = svg(
  '<path d="m1 8 11-5 11 5-11 5L1 8Zm4 4 7 3 7-3v6c-5 3-9 3-14 0v-6Zm16-1 2-1v10h-2v-9Z"/>',
);
const people = svg(
  '<circle cx="12" cy="5" r="4"/><circle cx="4" cy="7" r="3"/><circle cx="20" cy="7" r="3"/><path d="M6 22v-8a6 6 0 0 1 12 0v8H6ZM0 21v-7a4 4 0 0 1 5-4l-1 4v7H0Zm20 0v-7l-1-4a4 4 0 0 1 5 4v7h-4Z"/>',
);
const bell = svg(
  '<path d="M12 2a6 6 0 0 0-6 6v4l-2 3v1h16v-1l-2-3V8a6 6 0 0 0-6-6Zm-2.5 17a2.5 2.5 0 0 0 5 0h-5Z"/>',
);
// Optional school notice. Rendered only when the administrator has published one for this diary date.
function noticesHtml(list) {
  return [].concat(list || []).map(noticeHtml).join('');
}
function noticeHtml(n) {
  if (!n || !String(n.text || '').trim()) return '';
  const lang = ['en', 'ur', 'ar'].includes(n.language) ? n.language : 'en',
    dir = lang === 'en' ? 'ltr' : 'rtl';
  return `<section class="homework-notice" aria-label="Notice"><div class="homework-notice-head">${bell}<span lang="${lang}" dir="${dir}">${esc(n.label || (lang === 'ur' ? 'اطلاعیہ' : lang === 'ar' ? 'إعلان' : 'Notice'))}</span></div><div class="homework-notice-body" lang="${lang}" dir="${dir}">${n.title ? `<strong class="homework-notice-title">${esc(n.title)}</strong>` : ''}<p>${esc(n.text)}</p></div></section>`;
}
// Quote card: ornamental divider, large opening mark, centred italic text.
function quotesHtml(quotes) {
  if (!quotes?.length) return '';
  return `<div class="homework-quotes">${quotes
    .map(
      (q) =>
        `<figure class="homework-quote-card"><div class="homework-quote-orn" aria-hidden="true"><i></i><b>&#9670;</b><i></i></div><blockquote lang="${esc(q.language)}" dir="${esc(q.direction)}">${esc(q.text)}</blockquote></figure>`,
    )
    .join('')}</div>`;
}
export const homeworkCss = portraitDiaryCss + consolidatedCss + portraitFittingCss;
export function homeworkSource(d) {
  const a = d.template_snapshot.assignmentSnapshot || d.assignment,
    s = d.template_snapshot,
    c = d.content,
    consolidated = c.consolidated === true,
    schoolName = consolidated ? 'Elite Scholars School & College' : s.name,
    date = new Date(d.diary_date + 'T12:00:00Z');
  const rows = (c.homework_rows || []).filter(
    (row) => String(row.subject || '').trim() || String(row.detail || '').trim(),
  );
  const meta = [
    [
      'Date:',
      new Intl.DateTimeFormat('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(date),
      calendar,
    ],
    [
      'Day:',
      new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' }).format(date),
      calendar,
    ],
    ['Class:', a.class_name, cap],
    ['Section:', a.section_name, people],
  ];
  return `<article class="document-source" data-layout="homework_grid" data-consolidated="${consolidated}" data-reference="${esc(d.id)}" data-version="${esc(d.version || 1)}" data-class-name="${esc(a.class_name)}" data-section-name="${esc(a.section_name)}" data-diary-date="${esc(d.diary_date)}"><template class="header"><div class="page-header"><div class="homework-brand"><div class="homework-crest"><img src="/assets/diary-template-crest.png" alt="Elite Scholars school crest"></div><div class="homework-identity"><h1 aria-label="${esc(schoolName)}" class="${schoolName.length > 48 ? 'school-name-long' : schoolName.length > 30 ? 'school-name-medium' : ''}">${/elite\s+scholars/i.test(schoolName) ? '<span class="school-title-main">Elite Scholars</span> <span class="school-title-secondary">School &amp; College</span>' : esc(schoolName)}</h1>${s.address || s.contact ? `<div class="homework-contact">${esc(s.address)} ${esc(s.contact)}</div>` : ''}<div class="homework-tagline">Learn&nbsp; • &nbsp;Grow&nbsp; • &nbsp;Succeed</div></div><div class="homework-motto">A Brighter<br>Tomorrow<br>Starts Today</div></div><div class="homework-meta">${meta
    .map(
      ([label, value, icon], index) =>
        `<div data-meta="${['date', 'day', 'class', 'section'][index]}">${icon}<span><b>${label}</b><span class="homework-meta-value">${esc(
          String(value ?? '')
            .replace(/\s+/g, ' ')
            .trim(),
        )}</span></span></div>`,
    )
    .join(
      '',
    )}</div><div class="homework-columns"><div>Subject</div><div>Detail of Home Work</div><div>H.W</div><div>L.W</div><div>Test</div></div></div></template><template class="footer"><div class="homework-footer">${noticesHtml(d.notice_snapshot)}${quotesHtml(d.quote_snapshot)}</div></template><div class="blocks">${rows
    .map((row) => {
      const language = subjectLanguage(row, d.language);
      return `<section class="block homework-row"><h2>${esc(row.subject || 'Subject')}</h2><div class="text" lang="${esc(language)}" dir="${esc(language ? languageDirection(language) : row.direction || 'auto')}">${esc(/^\s*[-–—]\s*$/.test(row.detail || '') ? '' : row.detail || '')}</div>${['hw', 'learn', 'test'].map((k) => `<div class="homework-mark" aria-label="${row[k] ? 'Checked' : 'Not checked'}">${row[k] ? '<svg class="homework-check" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4 4L19 6"/></svg>' : ''}</div>`).join('')}</section>`;
    })
    .join('')}</div></article>`;
}
export function homeworkSample(s) {
  const details = [
    'Chapter No: 4 “The Clever Fox” – Reading Practice and Comprehension Questions.',
    'Grammar: Present Continuous Tense – Worksheet No. 6.',
    'Chapter No: 5 “Fractions” – Exercise 5.2 (Q1 to Q5).',
    'Chapter No: 3 “Living Things” – Answer the short questions on page 42.',
    'Chapter No: 2 “MS Word” – Create a simple document with 5 lines and save it.',
    'سبق نمبر 5 نظم کی مشق اور سوالات — صفحہ 32 تا 35۔',
    'Chapter No: 2 “Good Manners” – Complete Exercise Questions (Page 28).',
    'Page No: 12 – Draw and colour a flower using crayons.',
  ];
  return homeworkSource({
    id: 'template-sample',
    diary_date: '2026-10-14',
    version: s.templateVersion || 1,
    status: 'Template sample',
    template_snapshot: {
      ...s,
      assignmentSnapshot: {
        class_name: '6th',
        section_name: 'Blue + Pink',
        teacher_name: 'Template preview',
      },
    },
    content: {
      homework_rows: homeworkSubjects.map((subject, i) => ({
        subject,
        detail: details[i],
        hw: true,
        learn: true,
        test: i === 2,
        direction: i === 5 ? 'rtl' : 'ltr',
      })),
    },
    quote_snapshot: [
      { id: 'sample', language: 'en', direction: 'ltr', text: 'Education is the most powerful weapon which you can use to change the world.' },
    ],
  });
}
