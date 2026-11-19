import test from 'node:test';
import assert from 'node:assert/strict';
import { activeNotice, normalizeNotice } from '../shared/diary-notice.mjs';
import { preserveSettingsLinks } from '../shared/settings-publication.mjs';
const validDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const check = (ok, message, status) => {
  if (!ok) throw Object.assign(Error(message), { status });
};
const ctx = { actor: 'u1', today: '2026-11-16', validDate, check };
test('a notice is hidden until it is published', () => {
  assert.equal(activeNotice({}, '2026-11-16'), null);
  const draft = normalizeNotice({ text: 'Holiday on Friday', published: false }, undefined, ctx);
  assert.equal(activeNotice({ diaryNotice: draft }, '2026-11-16'), null);
  const live = normalizeNotice({ published: true }, draft, ctx);
  assert.equal(activeNotice({ diaryNotice: live }, '2026-11-16').text, 'Holiday on Friday');
});
test('a newly published notice starts today and respects its end date', () => {
  const n = normalizeNotice({ text: 'Meeting', published: true, endDate: '2026-11-20' }, undefined, ctx);
  assert.equal(n.startDate, '2026-11-16');
  assert.equal(activeNotice({ diaryNotice: n }, '2026-11-10'), null);
  assert.ok(activeNotice({ diaryNotice: n }, '2026-11-18'));
  assert.equal(activeNotice({ diaryNotice: n }, '2026-11-21'), null);
});
test('urdu notices render right to left with an Urdu label', () => {
  const n = normalizeNotice({ text: 'کل چھٹی ہے', language: 'ur', published: true }, undefined, ctx);
  const a = activeNotice({ diaryNotice: n }, '2026-11-16');
  assert.equal(a.direction, 'rtl');
  assert.equal(a.label, 'اطلاعیہ');
});
test('invalid notices are rejected', () => {
  assert.throws(() => normalizeNotice({ published: true }, undefined, ctx), /Write the notice text/);
  assert.throws(() => normalizeNotice({ text: 'x'.repeat(401) }, undefined, ctx), /400 characters/);
  assert.throws(() => normalizeNotice({ text: 'x', startDate: '2026-12-01', endDate: '2026-11-01' }, undefined, ctx), /end date/);
});
test('saving school settings never wipes the published notice', () => {
  const notice = { published: true, text: 'Keep me' };
  const kept = preserveSettingsLinks({ name: 'School' }, { templateVersion: 3, diaryNotice: notice }, 3);
  assert.deepEqual(kept.diaryNotice, notice);
});
