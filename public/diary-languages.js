// Existing Write Diary language options, shared by the form, validation and renderer.
export const diaryLanguages = [
  { id: 'en', name: 'English', direction: 'ltr' },
  { id: 'ur', name: 'اردو — Urdu', direction: 'rtl' },
];
export const supportedDiaryLanguage = (value) => diaryLanguages.some((x) => x.id === value);
export const languageDirection = (value) =>
  diaryLanguages.find((x) => x.id === value)?.direction || 'auto';
export const languageName = (value) =>
  diaryLanguages.find((x) => x.id === value)?.name || 'Not selected';
export function subjectLanguage(row, legacyLanguage = '') {
  if (Object.hasOwn(row, 'language'))
    return supportedDiaryLanguage(row.language) ? row.language : '';
  if (supportedDiaryLanguage(legacyLanguage)) return legacyLanguage;
  return diaryLanguages.find((x) => x.direction === row.direction)?.id || '';
}
export function mountSubjectLanguages(form) {
  if (!form) return;
  for (const card of form.querySelectorAll('.school-subject')) {
    const selected = card.querySelector('[name=selected]'),
      language = card.querySelector('select[name=language]'),
      text = card.querySelector('textarea');
    const sync = () => {
      language.required = selected.checked;
      language.disabled = !selected.checked;
      text.lang = language.value || '';
      text.dir = languageDirection(language.value);
    };
    language.addEventListener('change', sync);
    selected.addEventListener('change', sync);
    sync();
  }
}
