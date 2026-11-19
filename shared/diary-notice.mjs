// Optional school notice printed under the homework table (above the quote).
// Stored inside the existing settings JSON (key "diaryNotice"), so no database migration is needed.
export const NOTICE_TITLE_MAX = 80;
export const NOTICE_TEXT_MAX = 400;
export const NOTICE_LABELS = { en: 'Notice', ur: 'اطلاعیہ', ar: 'إعلان' };
export const emptyNotice = () => ({
  published: false,
  title: '',
  text: '',
  language: 'en',
  startDate: '',
  endDate: '',
  updatedAt: '',
  updatedBy: '',
});
// Returns the notice only when it is published, has text and covers the diary date; otherwise null.
export function activeNotice(settings, diaryDate) {
  const n = settings?.diaryNotice;
  if (!n || n.published !== true || typeof n.text !== 'string' || !n.text.trim()) return null;
  if (n.startDate && diaryDate && diaryDate < n.startDate) return null;
  if (n.endDate && diaryDate && diaryDate > n.endDate) return null;
  const language = ['en', 'ur', 'ar'].includes(n.language) ? n.language : 'en';
  return {
    title: String(n.title || '').trim(),
    text: n.text.trim(),
    language,
    direction: language === 'en' ? 'ltr' : 'rtl',
    label: NOTICE_LABELS[language],
  };
}
// Validates an administrator's notice update and returns the value to store.
export function normalizeNotice(body, previous, { actor, today, validDate, check }) {
  const old = { ...emptyNotice(), ...(previous || {}) };
  check(body && typeof body === 'object' && !Array.isArray(body), 'Invalid notice', 400);
  check(
    body.published === undefined || typeof body.published === 'boolean',
    'Choose whether the notice is published',
    400,
  );
  const title = String(body.title ?? old.title ?? '').trim(),
    text = String(body.text ?? old.text ?? '').trim(),
    language = body.language ?? old.language ?? 'en',
    published = body.published ?? old.published;
  check(title.length <= NOTICE_TITLE_MAX, `Notice title must be ${NOTICE_TITLE_MAX} characters or fewer`, 400);
  check(text.length <= NOTICE_TEXT_MAX, `Notice text must be ${NOTICE_TEXT_MAX} characters or fewer so it fits the A4 page`, 400);
  check(['en', 'ur', 'ar'].includes(language), 'Choose English, Urdu or Arabic', 400);
  check(!published || text, 'Write the notice text before publishing', 400);
  let startDate = body.startDate ?? old.startDate ?? '',
    endDate = body.endDate ?? old.endDate ?? '';
  for (const [label, value] of [['start', startDate], ['end', endDate]])
    check(value === '' || validDate(value), `Choose a valid notice ${label} date`, 400);
  // A newly published notice starts today so reprints of older diaries never pick it up.
  if (published && !startDate) startDate = today;
  check(!startDate || !endDate || startDate <= endDate, 'The end date cannot be before the start date', 400);
  return { published, title, text, language, startDate, endDate, updatedAt: new Date().toISOString(), updatedBy: actor };
}
