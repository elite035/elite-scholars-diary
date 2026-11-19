export const safeDocumentName = (value) =>
  String(value || 'Elite_Scholars_Diary')
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}._-]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 140) || 'Elite_Scholars_Diary';
export function documentFilename(doc) {
  const sources = doc.querySelectorAll('.document-source');
  if (sources.length === 1) {
    const { className, sectionName, diaryDate } = sources[0].dataset;
    if (className && sectionName && /^\d{4}-\d{2}-\d{2}$/.test(diaryDate || '')) {
      const date = new Date(diaryDate + 'T12:00:00Z');
      if (!Number.isNaN(date.getTime())) {
        const day = new Intl.DateTimeFormat('en-GB', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
          timeZone: 'UTC',
        }).format(date);
        return safeDocumentName(
          (/^class\b/i.test(className) ? className : 'Class ' + className) +
            ' ' +
            sectionName +
            ' ' +
            day,
        );
      }
    }
  }
  return safeDocumentName(doc.body.dataset.exportName);
}
