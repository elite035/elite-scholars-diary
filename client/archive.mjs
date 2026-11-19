import { zipSync } from 'fflate';
import { safeDocumentName } from '../public/document-filename.js';

export function archiveEntryNames(pages, kind) {
  const counts = new Map(),
    seen = new Set(),
    numbers = new Map();
  const group = (page) => page.dataset.sourceIndex ?? page.dataset.reference;
  for (const page of pages) {
    const key = group(page);
    if (key === undefined) throw Error('Diary page metadata is missing. Reload before exporting.');
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return pages.map((page) => {
    const { className, sectionName, diaryDate } = page.dataset,
      key = group(page);
    if (
      !className ||
      !sectionName ||
      !/^\d{4}-\d{2}-\d{2}$/.test(diaryDate || '') ||
      !Number.isFinite(Date.parse(diaryDate + 'T12:00:00Z')) ||
      new Date(diaryDate + 'T12:00:00Z').toISOString().slice(0, 10) !== diaryDate
    )
      throw Error('Diary class, section or date is missing. Reload before exporting.');
    const klass = safeDocumentName(
        /^(grade|class)\b/i.test(className) ? className : 'Class ' + className,
      ).slice(0, 60),
      section = safeDocumentName(
        /^section\b/i.test(sectionName) ? sectionName : 'Section ' + sectionName,
      ).slice(0, 45);
    const number = (numbers.get(key) || 0) + 1;
    numbers.set(key, number);
    const base =
      klass + '_' + section + '_' + diaryDate + (counts.get(key) > 1 ? '_Page_' + number : '');
    let name = base + '.' + kind,
      suffix = 2;
    while (seen.has(name.toLowerCase())) {
      name = base + '_' + suffix + '.' + kind;
      suffix++;
    }
    seen.add(name.toLowerCase());
    return name;
  });
}
export async function renderDiaryArchive(
  doc,
  kind,
  { renderPage, onProgress = () => {}, maxBytes = 64 * 1024 * 1024, ...renderOptions } = {},
) {
  if (!['pdf', 'png', 'jpg'].includes(kind)) throw Error('Choose PDF, PNG or JPG.');
  const pages = [...doc.querySelectorAll('#pages > .page')];
  if (!pages.length) throw Error('The diary has no printable pages.');
  if (pages.length > 200) throw Error('Select fewer diaries: a ZIP can contain up to 200 pages.');
  const names = archiveEntryNames(pages, kind),
    files = Object.create(null);
  let size = 0;
  for (let index = 0; index < pages.length; index++) {
    const page = pages[index];
    onProgress('Preparing ' + (index + 1) + ' of ' + pages.length + ': ' + names[index]);
    const pageDoc = {
      body: doc.body,
      defaultView: doc.defaultView,
      createElement: (...args) => doc.createElement(...args),
      querySelectorAll: (selector) =>
        selector === '#pages > .page' || selector === '.document-source'
          ? [page]
          : doc.querySelectorAll(selector),
    };
    const result = await renderPage(pageDoc, kind, {
      ...renderOptions,
      onProgress: (text) =>
        onProgress('File ' + (index + 1) + ' of ' + pages.length + ' · ' + text),
    });
    size += result.blob.size;
    if (size > maxBytes)
      throw Error('This ZIP exceeds the safe download limit. Select fewer diaries and try again.');
    files[names[index]] = new Uint8Array(await result.blob.arrayBuffer());
  }
  onProgress('Packaging ' + pages.length + ' individual files…');
  // These PDFs/images are already compressed; stored entries avoid wasteful recompression.
  const bytes = zipSync(files, { level: 0 });
  if (bytes.length > maxBytes)
    throw Error('This ZIP exceeds the safe download limit. Select fewer diaries and try again.');
  return {
    blob: new Blob([bytes], { type: 'application/zip' }),
    filename: 'Class_Diaries_' + kind.toUpperCase() + '.zip',
    pages: pages.length,
    files: names,
    archive: true,
  };
}
