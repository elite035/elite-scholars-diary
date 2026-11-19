import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activeNotices,
  checkCapacity,
  normalizeNotice,
  noticeList,
} from '../shared/diary-notice.mjs';
import { preserveSettingsLinks } from '../shared/settings-publication.mjs';
const validDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const check = (ok, message, status) => {
  if (!ok) throw Object.assign(Error(message), { status });
};
const ctx = { actor: 'u1', today: '2026-11-16', validDate, check, activeClassIds: ['c1', 'c2', 'c3'] };
const make = (body, id = 'n' + Math.random()) => normalizeNotice(body, { id }, ctx);
const settings = (...notices) => ({ diaryNotices: notices });

test('a notice is hidden until it is published', () => {
  assert.deepEqual(activeNotices({}, '2026-11-16', 'c1'), []);
  const draft = make({ text: 'Holiday on Friday', published: false }, 'a');
  assert.deepEqual(activeNotices(settings(draft), '2026-11-16', 'c1'), []);
  const live = normalizeNotice({ published: true }, draft, ctx);
  assert.equal(activeNotices(settings(live), '2026-11-16', 'c1')[0].text, 'Holiday on Friday');
});
test('a newly published notice starts today and respects its end date', () => {
  const n = make({ text: 'Meeting', published: true, endDate: '2026-11-20' });
  assert.equal(n.startDate, '2026-11-16');
  assert.equal(activeNotices(settings(n), '2026-11-10', 'c1').length, 0);
  assert.equal(activeNotices(settings(n), '2026-11-18', 'c1').length, 1);
  assert.equal(activeNotices(settings(n), '2026-11-21', 'c1').length, 0);
});
test('a notice shows only on its chosen classes; none chosen means every class', () => {
  const some = make({ text: 'Trip', published: true, class_ids: ['c1', 'c2'] }, 'a'),
    all = make({ text: 'Fees', published: true }, 'b');
  const texts = (classId) =>
    activeNotices(settings(some, all), '2026-11-16', classId).map((n) => n.text);
  assert.deepEqual(texts('c1'), ['Trip', 'Fees']);
  assert.deepEqual(texts('c3'), ['Fees']);
});
test('several notices on one day are all returned, at most three per diary', () => {
  const list = ['a', 'b', 'c', 'd'].map((id) => make({ text: 'Notice ' + id, published: true }, id));
  assert.deepEqual(
    activeNotices({ diaryNotices: list }, '2026-11-16', 'c1').map((n) => n.id),
    ['a', 'b', 'c'],
  );
});
test('urdu notices render right to left with an Urdu label', () => {
  const n = make({ text: 'کل چھٹی ہے', language: 'ur', published: true });
  const a = activeNotices(settings(n), '2026-11-16', 'c1')[0];
  assert.equal(a.direction, 'rtl');
  assert.equal(a.label, 'اطلاعیہ');
});
test('invalid notices are rejected', () => {
  assert.throws(() => make({ published: true }), /Write the notice text/);
  assert.throws(() => make({ text: 'x'.repeat(401) }), /400 characters/);
  assert.throws(() => make({ text: 'x', startDate: '2026-12-01', endDate: '2026-11-01' }), /end date/);
  assert.throws(() => make({ text: 'x', class_ids: ['missing'] }), /active classes/);
});
test('one class cannot be given more notices or text than fit the page', () => {
  const live = (id, text, class_ids = ['c1']) => make({ text, published: true, class_ids }, id);
  const three = ['a', 'b', 'c'].map((id) => live(id, 'short'));
  assert.throws(() => checkCapacity(live('d', 'short'), three, ['c1'], check), /at most 3/);
  assert.doesNotThrow(() => checkCapacity(live('d', 'short', ['c2']), three, ['c2'], check));
  const long = live('x', 'y'.repeat(400));
  assert.throws(() => checkCapacity(live('z', 'z'.repeat(300)), [long], ['c1'], check), /600 characters/);
  assert.doesNotThrow(() => checkCapacity(make({ text: 'z'.repeat(300) }, 'z'), [long], ['c1'], check));
});
test('a notice saved before classes existed becomes an all-classes notice', () => {
  const [old] = noticeList({ diaryNotice: { published: true, text: 'Keep me', startDate: '' } });
  assert.deepEqual(old.class_ids, []);
  assert.equal(activeNotices({ diaryNotice: { published: true, text: 'Keep me' } }, '2026-11-16', 'c9').length, 1);
});
test('saving school settings never wipes the notices', () => {
  const notices = [{ id: 'a', published: true, text: 'Keep me' }];
  const kept = preserveSettingsLinks({ name: 'School' }, { templateVersion: 3, diaryNotices: notices }, 3);
  assert.deepEqual(kept.diaryNotices, notices);
});
