import { documentHtml } from '../shared/document-shell.mjs';
export { documentHtml, documentCss } from '../shared/document-shell.mjs';
import { paginationScript } from '../shared/document-pagination.mjs';
export { paginationScript };
import { homeworkSource, homeworkCss } from '../shared/homework-template.mjs';
import { existsSync } from 'node:fs';
import { all, settings, now } from './db.mjs';
export const escapeHtml = (x) =>
  String(x ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
export const labels = {
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
export function diarySource(d) {
  if (d.content.diary_layout === 'homework_grid') return homeworkSource(d);
  const a = d.template_snapshot.assignmentSnapshot || d.assignment,
    s = d.template_snapshot,
    e = escapeHtml;
  const teacher = a.teacher_name;
  const reviews = all(
    'SELECT r.*,u.name FROM reviews r JOIN users u ON u.id=r.actor_id WHERE diary_id=? ORDER BY created_at',
    d.id,
  );
  const files = all('SELECT name,mime,size FROM attachments WHERE diary_id=?', d.id);
  const meta = [
    ['Date', d.diary_date],
    ['Academic session', a.session_name],
    ['Teacher', teacher],
    ['Class / Section', `${a.class_name} / ${a.section_name}`],
    ['Subject', a.subject_name],
    ['Period', d.period],
  ];
  return `<article class="document-source" data-reference="${e(d.id.slice(0, 8))}" data-version="${d.version}" data-class-name="${e(a.class_name)}" data-section-name="${e(a.section_name)}" data-diary-date="${e(d.diary_date)}"><template class="header"><div class="page-header">${s.logo ? `<img src="${e(s.logo)}" alt="School logo">` : ''}<h1>${e(s.name)}</h1>${s.address || s.contact ? `<small>${e(s.address)} ${e(s.contact)}</small>` : ''}<div>DAILY TEACHING DIARY</div></div></template><template class="footer"><div class="page-footer">${d.quote_snapshot.length ? `<div class="quotes">${d.quote_snapshot.map((q) => `<p lang="${e(q.language)}" dir="${e(q.direction)}">${e(q.text)}</p>`).join('')}</div>` : ''}<div class="folio"><span>${e(s.name)} · ${e(d.id.slice(0, 8))} · Version ${d.version}</span><span class="page-number"></span></div><div>Generated ${e(now())}</div></div></template><div class="blocks"><div class="meta">${meta.map(([k, v]) => `<div><b>${e(k)}</b><br>${e(v)}</div>`).join('')}</div>${Object.entries(
    labels,
  )
    .filter(
      ([key]) =>
        d.content[key] ||
        !['present', 'absent', 'assessment', 'observations', 'resources'].includes(key),
    )
    .map(
      ([key, label]) =>
        `<section class="block"><h2>${e(label)}</h2><div class="text">${e(d.content[key] || '—')}</div></section>`,
    )
    .join(
      '',
    )}<section class="block"><h2>Review and submission</h2><div class="text">Submitted by: ${e(teacher)}
Submitted: ${e(d.submitted_at || 'Not submitted')}
Status: ${e(d.status.replaceAll('_', ' '))}
Reviewed: ${e(d.reviewed_at || '—')}
${
  reviews
    .map((r) => `${r.created_at} · ${r.name} · ${r.action}: ${r.remarks}`)
    .map(e)
    .join('\n') || 'No review yet.'
}</div></section>${files.length ? `<section class="block"><h2>Attachment manifest</h2><div class="text">${files.map((f) => e(`${f.name} (${f.mime}, ${f.size} bytes)`)).join('\n')}</div></section>` : ''}</div></article>`;
}
export function reportSource(rows, title) {
  const s = settings(),
    e = escapeHtml;
  return `<article class="document-source"><template class="header"><div class="page-header"><h1>${e(s.name)}</h1><div>${e(title)}</div></div></template><template class="footer"><div class="page-footer folio"><span>Generated ${e(now())}</span><span class="page-number"></span></div></template><div class="blocks">${
    rows.length
      ? rows
          .map(
            (
              r,
            ) => `<section class="block"><h2>${e(r.teacher_name)} · ${e(r.date)} · Period ${r.period}</h2><div class="text">${e(r.class_name)} / ${e(r.section_name)} · ${e(r.subject_name)}
Status: ${e(r.status.replaceAll('_', ' '))} · ${r.overdue ? 'Overdue' : r.late ? 'Submitted late' : r.submitted ? 'Submitted' : 'Not yet due'}
Due: ${e(r.due_at)}</div></section>`,
          )
          .join('')
      : '<div class="block">No records for the selected period.</div>'
  }</div></article>`;
}

export function browserOptions() {
  return process.env.CHROMIUM_EXECUTABLE_PATH
    ? { headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH }
    : process.env.CHROMIUM_CHANNEL
      ? { headless: true, channel: process.env.CHROMIUM_CHANNEL }
      : existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
        ? { headless: true, channel: 'chrome' }
        : { headless: true };
}
let browserPromise;
export async function renderExport(html, kind) {
  if (!browserPromise) {
    browserPromise = import('playwright')
      .then(({ chromium }) => chromium.launch(browserOptions()))
      .catch((e) => {
        browserPromise = null;
        throw e;
      });
  }
  const browser = await browserPromise;
  const page = await browser.newPage({
    viewport: { width: 1000, height: 1300 },
    deviceScaleFactor: 2,
  });
  try {
    await page.setContent(html, { waitUntil: 'load' });
    await page.waitForFunction(() => window.documentReady || window.documentError, {
      timeout: 30000,
    });
    const error = await page.evaluate(() => window.documentError);
    if (error) throw Error(error);
    if (kind === 'pdf')
      return {
        buffer: await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true }),
        type: 'application/pdf',
      };
    const pages = page.locator('.page');
    const count = await pages.count();
    if (count === 1)
      return {
        buffer: await pages.first().screenshot({
          type: kind === 'jpg' ? 'jpeg' : 'png',
          ...(kind === 'jpg' ? { quality: 94 } : {}),
        }),
        type: kind === 'jpg' ? 'image/jpeg' : 'image/png',
      };
    const { Buffer: NodeBuffer } = await import('node:buffer');
    const files = [];
    for (let i = 0; i < count; i++)
      files.push({
        name: `page-${String(i + 1).padStart(3, '0')}.${kind}`,
        data: await pages.nth(i).screenshot({
          type: kind === 'jpg' ? 'jpeg' : 'png',
          ...(kind === 'jpg' ? { quality: 94 } : {}),
        }),
      });
    return { buffer: zip(files), type: 'application/zip', extension: 'zip' };
  } finally {
    await page.close();
  }
}
// Uncompressed ZIP with CRC32: all pages remain separate, full-resolution images.
export function zip(files) {
  const locals = [],
    central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name),
      data = f.data;
    let crc = 0xffffffff;
    for (const b of data) {
      crc ^= b;
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const l = Buffer.alloc(30);
    l.writeUInt32LE(0x04034b50);
    l.writeUInt16LE(20, 4);
    l.writeUInt32LE(crc, 14);
    l.writeUInt32LE(data.length, 18);
    l.writeUInt32LE(data.length, 22);
    l.writeUInt16LE(name.length, 26);
    locals.push(l, name, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += l.length + name.length + data.length;
  }
  const cb = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cb.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cb, end]);
}
export async function closeRenderer() {
  if (browserPromise) {
    const b = await browserPromise;
    await b.close();
    browserPromise = null;
  }
}
