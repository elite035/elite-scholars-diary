// School notices printed under the homework table (above the quote).
// Stored inside the existing settings JSON (key "diaryNotices"), so no database migration is needed.
// Each notice targets chosen classes (none chosen = every class) and a date range; several notices
// may apply to the same class on the same day.
export const NOTICE_TITLE_MAX = 80;
export const NOTICE_TEXT_MAX = 400;
export const NOTICES_MAX = 100;
export const NOTICES_PER_DIARY = 3;
// Together the notices on one diary must still fit the A4 page.
export const NOTICE_COMBINED_MAX = 600;
export const NOTICE_LABELS = { en: 'Notice', ur: 'اطلاعیہ', ar: 'إعلان' };
const LANGUAGES = Object.keys(NOTICE_LABELS);

// The list of stored notices. A notice saved before classes existed becomes an all-classes notice.
export function noticeList(settings) {
  if (Array.isArray(settings?.diaryNotices)) return settings.diaryNotices;
  const old = settings?.diaryNotice;
  return old && typeof old === 'object' && (old.text || old.title)
    ? [{ id: 'legacy', class_ids: [], ...old }]
    : [];
}
const covers = (n, date) =>
  !date || ((!n.startDate || date >= n.startDate) && (!n.endDate || date <= n.endDate));
const targets = (n, classId) =>
  !n.class_ids?.length || (classId !== undefined && n.class_ids.includes(classId));
const isLive = (n) => n.published === true && typeof n.text === 'string' && n.text.trim();
const view = (n) => {
  const language = LANGUAGES.includes(n.language) ? n.language : 'en';
  return {
    id: n.id,
    title: String(n.title || '').trim(),
    text: n.text.trim(),
    language,
    direction: language === 'en' ? 'ltr' : 'rtl',
    label: NOTICE_LABELS[language],
  };
};
// Notices to print on a diary for this date and class: published, in date range, aimed at the class.
export function activeNotices(settings, diaryDate, classId) {
  return noticeList(settings)
    .filter((n) => isLive(n) && covers(n, diaryDate) && targets(n, classId))
    .sort((a, b) => (a.startDate || '').localeCompare(b.startDate || '') || a.id.localeCompare(b.id))
    .slice(0, NOTICES_PER_DIARY)
    .map(view);
}
const overlap = (a, b) =>
  (!a.endDate || !b.startDate || b.startDate <= a.endDate) &&
  (!b.endDate || !a.startDate || a.startDate <= b.endDate);
// Rejects a published notice that would push any class past the notices that fit one diary.
export function checkCapacity(notice, others, classIds, check) {
  if (!notice.published) return;
  const same = others.filter((n) => n.id !== notice.id && isLive(n) && overlap(n, notice));
  for (const classId of classIds) {
    const hit = same.filter((n) => targets(n, classId));
    check(
      hit.length < NOTICES_PER_DIARY,
      `A class can show at most ${NOTICES_PER_DIARY} notices on the same day. Hide or change dates of another notice first.`,
      409,
    );
    check(
      hit.reduce((sum, n) => sum + n.text.trim().length, notice.text.length) <= NOTICE_COMBINED_MAX,
      `Notices shown together must total ${NOTICE_COMBINED_MAX} characters or fewer so they fit the A4 page. Shorten this notice or hide another one.`,
      409,
    );
  }
}
// Validates one notice and returns the value to store. `activeClassIds` are the classes that exist.
export function normalizeNotice(body, previous, { actor, today, validDate, check, activeClassIds }) {
  const old = previous || {};
  check(body && typeof body === 'object' && !Array.isArray(body), 'Invalid notice', 400);
  check(
    body.published === undefined || typeof body.published === 'boolean',
    'Choose whether the notice is published',
    400,
  );
  check(
    body.class_ids === undefined ||
      (Array.isArray(body.class_ids) && body.class_ids.every((x) => typeof x === 'string')),
    'Choose classes from the list',
    400,
  );
  const title = String(body.title ?? old.title ?? '').trim(),
    text = String(body.text ?? old.text ?? '').trim(),
    language = body.language ?? old.language ?? 'en',
    published = body.published ?? old.published ?? false,
    class_ids = [...new Set(body.class_ids ?? old.class_ids ?? [])];
  check(title.length <= NOTICE_TITLE_MAX, `Notice title must be ${NOTICE_TITLE_MAX} characters or fewer`, 400);
  check(text.length <= NOTICE_TEXT_MAX, `Notice text must be ${NOTICE_TEXT_MAX} characters or fewer so it fits the A4 page`, 400);
  check(LANGUAGES.includes(language), 'Choose English, Urdu or Arabic', 400);
  check(!published || text, 'Write the notice text before publishing', 400);
  check(
    class_ids.every((x) => activeClassIds.includes(x)),
    'Choose only active classes',
    400,
  );
  let startDate = body.startDate ?? old.startDate ?? '',
    endDate = body.endDate ?? old.endDate ?? '';
  for (const [label, value] of [['start', startDate], ['end', endDate]])
    check(value === '' || validDate(value), `Choose a valid notice ${label} date`, 400);
  // A newly published notice starts today so reprints of older diaries never pick it up.
  if (published && !startDate) startDate = today;
  check(!startDate || !endDate || startDate <= endDate, 'The end date cannot be before the start date', 400);
  return {
    id: old.id,
    published,
    title,
    text,
    language,
    class_ids,
    startDate,
    endDate,
    updatedAt: new Date().toISOString(),
    updatedBy: actor,
  };
}
