import {asyncMap,asyncFilter,asyncSome,asyncFind,asyncForEach} from '../cloud/async-arrays.mjs';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
process.env.NODE_ENV = 'test';
process.env.CLOUD_TEST_PGLITE = 'true';
process.env.COOKIE_SECURE = 'false';
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'elite-test-'));
const { server, shutdown } = await import('../cloud/index.mjs');
const { fixtures } = await import('../scripts/cloud-fixtures.mjs');
const { one, all, run, settings, now, id } = await import('../cloud/db.mjs');
const { expected, zoneTimestamp, sendDeadlineNotifications } = await import('../cloud/domain.mjs');
const { browserOptions } = await import('../cloud/documents.mjs');

const fixture = await fixtures();
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const auth = {};
async function call(path, { user = 'teacher', method = 'GET', body, headers = {} } = {}) { const a = auth[user]; const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(a ? { Cookie: a.cookie, 'X-CSRF-Token': a.csrf } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) }); let data; if (r.headers.get('content-type')?.includes('application/json'))
    data = await r.json();
else
    data = Buffer.from(await r.arrayBuffer()); return { status: r.status, data, response: r }; }
for (const key of Object.keys(fixture.users)) {
    const r = await call('/api/login', { user: null, method: 'POST', body: { email: fixture.users[key].email, password: fixture.password } });
    assert.equal(r.status, 200);
    auth[key] = { cookie: r.response.headers.get('set-cookie').split(';')[0], csrf: r.data.csrf };
}
let d;
const content = { topic: 'TEST Fractions', todays_lesson: 'Equivalent fractions', learning_objectives: 'Recognize equivalent fractions', present: '24', absent: '2', syllabus_progress: 'Unit 2 of 8', assessment: 'Exit ticket', resources: 'Fraction cards', observations: 'Group discussion' };
const newDiary = (period = 1, date = '2026-10-19') => ({ assignment_id: fixture.assignments.a, diary_date: date, period, content, submit: false });
after(async () => { await shutdown(); });
test('anonymous and fabricated local sessions cannot access protected records', async () => { assert.equal((await call('/api/diaries', { user: null })).status, 401); assert.equal((await call('/api/me', { user: null, headers: { Cookie: 'ess_session=forged-super-admin' } })).status, 401); });
test('CSRF and cross-origin writes are rejected', async () => { assert.equal((await call('/api/diaries', { method: 'POST', body: newDiary(), headers: { 'X-CSRF-Token': 'bad' } })).status, 403); assert.equal((await call('/api/diaries', { method: 'POST', body: newDiary(), headers: { Origin: 'https://attacker.invalid' } })).status, 403); });
test('five roles and assignment hierarchy remain separate', async () => { for (const key of ['teacher', 'head', 'coordinator']) {
    const r = await call('/api/lookups', { user: key });
    assert.equal(r.data.assignments.length, 1);
    assert.equal(r.data.assignments[0].id, fixture.assignments.a);
} assert.equal((await call('/api/lookups', { user: 'teacherB' })).data.assignments[0].id, fixture.assignments.b); assert.equal((await call('/api/lookups', { user: 'super' })).data.assignments.length, 2); });
test('teacher cannot escalate roles or configure the school', async () => { assert.equal((await call('/api/users', { method: 'POST', body: {} })).status, 403); assert.equal((await call('/api/settings', { method: 'PUT', body: {} })).status, 403); assert.equal((await call('/api/audit')).status, 403); });
test('draft save/reopen persists all optional and teaching fields', async () => { const r = await call('/api/diaries', { method: 'POST', body: newDiary() }); assert.equal(r.status, 201, JSON.stringify(r.data)); d = r.data; const reopened = await call('/api/diaries/' + d.id); assert.equal(reopened.data.content.observations, content.observations); assert.equal(reopened.data.content.present, '24'); assert.equal(d.reviewer_id, fixture.users.head.id); });
test('serverless rewrites preserve nested API paths and query parameters',async()=>{const r=await call('/api/index?__route=diaries%2F'+d.id);assert.equal(r.status,200);assert.equal(r.data.id,d.id);const list=await call('/api/index?__route=diaries&search=TEST');assert.equal(list.status,200);assert.ok(list.data.items.some(x=>x.id===d.id));assert.equal((await call('/api/index?__route=..%2Fprivate')).status,400);});
test('out-of-scope teachers and reviewers cannot read, update, approve or download a diary', async () => { for (const user of ['teacherB', 'headB']) {
    for (const path of ['', '/versions', '/preview', '/export?format=pdf'])
        assert.equal((await call('/api/diaries/' + d.id + path, { user })).status, 404);
    assert.equal((await call('/api/diaries/' + d.id, { user, method: 'PUT', body: { content, version: d.version } })).status, 404);
    assert.equal((await call('/api/diaries/' + d.id + '/review', { user, method: 'POST', body: { action: 'approved', version: d.version } })).status, 404);
} });
test('assignment enforcement and multiple periods per day', async () => { assert.equal((await call('/api/diaries', { method: 'POST', body: { ...newDiary(), assignment_id: fixture.assignments.b } })).status, 404); assert.equal((await call('/api/diaries', { method: 'POST', body: newDiary() })).status, 409); const second = await call('/api/diaries', { method: 'POST', body: newDiary(2) }); assert.equal(second.status, 201); assert.notEqual(second.data.id, d.id); assert.equal((await call('/api/diaries', { method: 'POST', body: { ...newDiary(3) } })).status, 400); });
test('submit requires configured fields and stale updates cannot overwrite drafts', async () => { let r = await call('/api/diaries/' + d.id, { method: 'PUT', body: { version: d.version, content: { topic: 'Only topic' }, submit: true } }); assert.equal(r.status, 400); r = await call('/api/diaries/' + d.id, { method: 'PUT', body: { version: 999, content, submit: false } }); assert.equal(r.status, 409); });
test('private file handling verifies signatures and rejects unauthorized attachment access', async () => { const bad = await call('/api/diaries/' + d.id + '/attachments', { method: 'POST', body: { name: 'bad.png', mime: 'image/png', data: Buffer.from('<script>bad</script>').toString('base64') } }); assert.equal(bad.status, 400); const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jqGQAAAAASUVORK5CYII=', 'base64'); const good = await call('/api/diaries/' + d.id + '/attachments', { method: 'POST', body: { name: 'test.png', mime: 'image/png', data: png.toString('base64') } }); assert.equal(good.status, 201, JSON.stringify(good.data)); assert.equal((await call('/api/attachments/' + good.data.id, { user: 'teacherB' })).status, 404); const file = await call('/api/attachments/' + good.data.id); assert.equal(file.status, 200); assert.deepEqual(file.data, png); });
test('draft submission routes to assigned reviewer and creates notifications', async () => { const r = await call('/api/diaries/' + d.id, { method: 'PUT', body: { version: d.version, content, submit: true } }); assert.equal(r.status, 200); d = r.data; assert.equal(d.status, 'submitted'); assert.ok(d.submitted_at); assert.ok((await call('/api/notifications', { user: 'head' })).data.some(n => n.diary_id === d.id)); });
test('teachers cannot edit submitted diaries or review themselves', async () => { assert.equal((await call('/api/diaries/' + d.id, { method: 'PUT', body: { version: d.version, content } })).status, 409); assert.equal((await call('/api/diaries/' + d.id + '/review', { method: 'POST', body: { version: d.version, action: 'approved' } })).status, 403); });
test('review → mandatory return reason → correction → resubmit → approval', async () => { let r = await call('/api/diaries/' + d.id + '/review', { user: 'head', method: 'POST', body: { version: d.version, action: 'under_review' } }); assert.equal(r.status, 200); d = r.data; r = await call('/api/diaries/' + d.id + '/review', { user: 'head', method: 'POST', body: { version: d.version, action: 'returned', remarks: '   ' } }); assert.equal(r.status, 400); r = await call('/api/diaries/' + d.id + '/review', { user: 'head', method: 'POST', body: { version: d.version, action: 'returned', remarks: 'Please clarify the assessment.' } }); assert.equal(r.status, 200); d = r.data; r = await call('/api/diaries/' + d.id, { method: 'PUT', body: { version: d.version, content: { ...content, assessment: 'Corrected exit-ticket plan' }, submit: true } }); assert.equal(r.status, 200); d = r.data; assert.equal(d.status, 'resubmitted'); r = await call('/api/diaries/' + d.id + '/review', { user: 'coordinator', method: 'POST', body: { version: d.version, action: 'approved', remarks: 'Reviewed correction.' } }); assert.equal(r.status, 200); d = r.data; assert.equal(d.status, 'approved'); });
test('approved content is immutable and audit/version history is append-only', async () => { assert.equal((await call('/api/diaries/' + d.id, { method: 'PUT', body: { version: d.version, content } })).status, 409); const versions = (await call('/api/diaries/' + d.id + '/versions')).data; assert.equal(versions.length, 6); assert.equal(versions.at(-1).snapshot.content.assessment, 'Exit ticket'); await assert.rejects(async () => await run('DELETE FROM diary_versions WHERE diary_id=?', d.id), /append-only/); await assert.rejects(async () => await run('UPDATE audit SET action=\'tampered\''), /append-only/); });
test('authorized amendment preserves original approval and requires a reason', async () => { assert.equal((await call('/api/diaries/' + d.id + '/amend', { user: 'head', method: 'POST', body: { version: d.version, reason: 'Correct details' } })).status, 403); assert.equal((await call('/api/diaries/' + d.id + '/amend', { user: 'super', method: 'POST', body: { version: d.version, reason: '' } })).status, 400); const r = await call('/api/diaries/' + d.id + '/amend', { user: 'super', method: 'POST', body: { version: d.version, reason: 'Correct the resource reference' } }); assert.equal(r.status, 200); d = r.data; assert.equal(d.status, 'returned'); assert.ok((await call('/api/diaries/' + d.id + '/versions')).data.some(v => v.snapshot.status === 'approved')); });
test('school Admin has explicitly granted reading but no implicit approval permission', async () => { const list = await call('/api/diaries', { user: 'admin' }); assert.ok(list.data.items.some(x => x.id === d.id)); assert.equal((await call('/api/diaries/' + d.id + '/review', { user: 'admin', method: 'POST', body: { version: d.version, action: 'approved' } })).status, 403); });
test('quotes: authorization, EN/UR/AR scheduling and immutable historical snapshot', async () => { assert.equal((await call('/api/quotes', { method: 'POST', body: {} })).status, 403); for (const [language, text, direction] of [['en', 'TEST quote for verification only', 'ltr'], ['ur', 'یہ صرف آزمائشی عبارت ہے', 'rtl'], ['ar', 'هذا نص اختباري فقط', 'rtl']]) {
    const r = await call('/api/quotes', { user: 'super', method: 'POST', body: { text, language, direction } });
    assert.equal(r.status, 201);
    const s = await call('/api/quote-schedules', { user: 'super', method: 'POST', body: { quote_id: r.data.id, date: '2026-10-20', priority: 0 } });
    assert.equal(s.status, 201);
} const r = await call('/api/diaries', { method: 'POST', body: newDiary(1, '2026-10-20') }); assert.equal(r.status, 201); assert.equal(r.data.quote_snapshot.length, 3); const qid = r.data.quote_snapshot[0].id; await call('/api/quotes/' + qid, { user: 'super', method: 'PATCH', body: { text: 'TEST changed quote' } }); const saved = await call('/api/diaries/' + r.data.id); assert.notEqual(saved.data.quote_snapshot[0].text, 'TEST changed quote'); assert.equal(saved.data.quote_snapshot.find(q => q.language === 'ar').direction, 'rtl'); });
test('expected schedules, holidays, timezone conversion and overdue independent of status', async () => { assert.equal(zoneTimestamp('2026-10-19', '16:00', 'Asia/Karachi'), '2026-10-19T11:00:00.000Z'); const teacher = fixture.users.teacher; assert.equal((await expected(teacher, '2026-10-18', '2026-10-18')).length, 0); const slots = await expected(teacher, '2026-10-19', '2026-10-19', new Date('2026-10-19T17:00:00Z')); assert.equal(slots.length, 2); assert.equal(slots.filter(s => s.overdue).length, 1); const r = await call('/api/exceptions', { user: 'super', method: 'POST', body: { date: '2026-10-21', reason: 'TEST holiday' } }); assert.equal(r.status, 201); assert.equal((await expected(teacher, '2026-10-21', '2026-10-21')).length, 0); });
test('deadline notifications are scoped and idempotent', async () => { await sendDeadlineNotifications(new Date('2026-10-22T16:10:00Z')); const n = (await one('SELECT count(*) n FROM notifications')).n; await sendDeadlineNotifications(new Date('2026-10-22T16:10:00Z')); assert.equal((await one('SELECT count(*) n FROM notifications')).n, n); const r = await call('/api/notifications'); assert.ok(r.data.every(n => n.user_id === fixture.users.teacher.id)); });
test('filters/reports are accurate and CSV exports match authorized rows', async () => { const r = await call('/api/diaries?search=Fractions&start=2026-10-19&end=2026-10-19'); assert.equal(r.data.total, 2); assert.equal((await call('/api/diaries?teacher=' + fixture.users.teacherB.id)).data.total, 0); const report = await call('/api/reports?start=2026-10-19&end=2026-10-19'); assert.equal(report.data.total, 2); assert.equal(report.data.submitted, 1); assert.equal((await call('/api/reports?start=2026-01-01&end=2027-12-31')).status, 400); const csv = await call('/api/reports?start=2026-10-19&end=2026-10-19&format=csv'); assert.equal(csv.status, 200); assert.ok(csv.data.toString().includes('TEST Mathematics')); assert.ok(!csv.data.toString().includes('Test Teacher B')); });
test('deactivation revokes existing sessions without deleting diary history', async () => { const before = (await one('SELECT count(*) n FROM diaries')).n; const r = await call('/api/users/' + fixture.users.teacherB.id, { user: 'super', method: 'PATCH', body: { active: false } }); assert.equal(r.status, 200); assert.equal((await call('/api/me', { user: 'teacherB' })).status, 401); assert.equal((await one('SELECT count(*) n FROM diaries')).n, before); });
test('settings publish validates fields, preserves versions and forbids role escalation', async () => { const s = settings(); assert.equal((await call('/api/settings', { user: 'super', method: 'PUT', body: { ...s, timezone: 'not/a-zone', logo: '' } })).status, 400); const r = await call('/api/settings', { user: 'super', method: 'PUT', body: { ...s, timezone: 'Asia/Karachi', logo: '' } }); assert.equal(r.status, 200); assert.equal(r.data.templateVersion, 2); await assert.rejects(async () => await run('UPDATE template_versions SET snapshot=\'{}\''), /append-only/); });
test('encrypted PostgreSQL backup restores rows and private files into an isolated instance with sessions revoked',async()=>{
 const {PGlite}=await import('@electric-sql/pglite');const {buildCloudArchive,openBackup,backupTables}=await import('../cloud/backup.mjs');const {getFile}=await import('../cloud/storage.mjs');
 process.env.BACKUP_ENCRYPTION_KEY='c'.repeat(64);const {bytes,payload}=await buildCloudArchive();assert.deepEqual(openBackup(bytes),payload);assert.equal(payload.sessionsExcluded,true);assert.equal(payload.tables.sessions,undefined);
 const restored=new PGlite();
 try{
  await restored.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);");
  for(const file of ['schema.sql','enhancements-schema.sql','school-schema.sql'])await restored.exec(readFileSync(new URL('../cloud/'+file,import.meta.url),'utf8'));
  await restored.exec('TRUNCATE '+backupTables.map(table=>'elite_diary.'+table).join(',')+' CASCADE');
  for(const table of backupTables){let rows=payload.tables[table];if(table==='academics'){rows=[...rows];const sorted=[],seen=new Set();while(rows.length){const index=rows.findIndex(row=>!row.parent_id||seen.has(row.parent_id));assert.ok(index>=0);const [row]=rows.splice(index,1);seen.add(row.id);sorted.push(row);}rows=sorted;}
   for(const row of rows){const columns=Object.keys(row);await restored.query('INSERT INTO elite_diary.'+table+' ('+columns.join(',')+') VALUES ('+columns.map((_,index)=>'$'+(index+1)).join(',')+')',columns.map(column=>row[column]));}
   const actual=(await restored.query('SELECT * FROM elite_diary.'+table)).rows;assert.deepEqual(actual.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),[...payload.tables[table]].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
  }
  assert.equal((await restored.query('SELECT count(*) n FROM elite_diary.sessions')).rows[0].n,0);
  for(const file of payload.files)assert.deepEqual(Buffer.from(file.data,'base64'),await getFile(file.key));
 }finally{await restored.close();}
});
test('optional server-rendered multipage exports (requires headless browser)', async (t) => { const long = { ...content, todays_lesson: Array.from({ length: 260 }, (_, i) => `Line ${i + 1}: equivalent fractions and classroom reflection.`).join('\n') + '\nFINAL CONTENT MARKER' }; const r = await call('/api/diaries', { method: 'POST', body: { ...newDiary(2, '2026-10-20'), content: long } }); assert.equal(r.status, 201); const did = r.data.id; const { chromium } = await import('playwright'); let browser; try {
    browser = await chromium.launch(browserOptions());
}
catch (e) {
    if(process.env.REQUIRE_BROWSER_TESTS==='1')throw Error('Required Chromium acceptance browser could not launch');
    t.skip('Headless browser launch blocked; actual browser export acceptance remains unverified in this environment.');
    return;
} try {
    const ctx = await browser.newContext();
    await ctx.addCookies([{ name: 'ess_session', value: auth.teacher.cookie.split('=')[1], url: base }]);
    const page = await ctx.newPage();
    await page.goto(base + '/api/diaries/' + did + '/preview');
    await page.waitForFunction(() => window.documentReady);
    const pageCount = await page.locator('.page').count();
    assert.ok(pageCount > 2);
    const text = await page.locator('#pages').innerText();
    assert.ok(text.includes('FINAL CONTENT MARKER'));
    assert.ok(text.includes('Students Present'));
    assert.ok(text.includes('24'));
    assert.ok(text.includes('TEST quote') || text.includes('TEST changed quote'));
    assert.equal(await page.locator('.page .quotes [lang=ar][dir=rtl]').count(), pageCount);
    assert.ok(await page.locator('.page').evaluateAll(pages => pages.every(p => { const b = p.querySelector('.page-body'); return b.scrollHeight <= b.clientHeight + 1; })));
    process.env.SERVER_RENDER_EXPORTS = 'true';
    for (const format of ['pdf', 'png', 'jpg']) {
        const exp = await call('/api/diaries/' + did + '/export?format=' + format);
        assert.equal(exp.status, 200, exp.data.toString().slice(0, 200));
        assert.ok(exp.data.length > 10000);
        assert.equal(exp.data.subarray(0, format === 'pdf' ? 4 : 2).toString(), format === 'pdf' ? '%PDF' : 'PK');
    }
    await page.emulateMedia({ media: 'print' });
    assert.equal(await page.locator('.toolbar').isVisible(), false);
}
finally {
    await browser.close();
} });
test('browser renderer exports are authorized and include complete source plus shared template', async () => { delete process.env.SERVER_RENDER_EXPORTS; for (const format of ['pdf', 'png', 'jpg']) {
    const r = await call('/api/diaries/' + d.id + '/export?format=' + format);
    assert.equal(r.status, 200);
    const text = r.data.toString();
    assert.ok(text.includes(`data-export-format="${format}"`));
    assert.ok(text.includes('src="/export.js"'));
    assert.ok(text.includes('LEARNING') || text.includes('Learning Objectives'));
    assert.ok(text.includes('Corrected exit-ticket plan'));
} assert.equal((await call('/api/export?format=exe')).status, 400); });
test('administration API creates validated academics and an assignment with correct relationships', async () => { const subj = await call('/api/academics', { user: 'super', method: 'POST', body: { kind: 'subject', name: 'TEST Biology', parent_id: fixture.academics.department } }); assert.equal(subj.status, 201); await call('/api/class-subjects',{user:'super',method:'POST',body:{class_id:fixture.academics.class,subject_ids:[subj.data.id]}});const body = { teacher_id: fixture.users.super.id, head_id: fixture.users.head.id, section_id: fixture.academics.section, subject_id: subj.data.id, session_id: fixture.academics.session, start_date: '2026-01-01', end_date: '2027-12-31', weekdays: [1], periods: [1], due_time: '16:00', review_time: '18:00' }; const a = await call('/api/assignments', { user: 'super', method: 'POST', body }); assert.equal(a.status, 201, JSON.stringify(a.data)); const saved = await call('/api/diaries', { user: 'super', method: 'POST', body: { assignment_id: a.data.id, diary_date: '2026-10-19', period: 1, content, submit: true } }); assert.equal(saved.status, 201); const self = await call('/api/diaries/' + saved.data.id + '/review', { user: 'super', method: 'POST', body: { version: saved.data.version, action: 'approved' } }); assert.equal(self.status, 403); });
test('archiving an assignment preserves historical expected periods', async () => { const date = '2026-10-19'; const before = (await expected(fixture.users.super, date, date)).filter(s => s.assignment_id === fixture.assignments.a).length; await run('INSERT INTO assignment_state_events VALUES(?,?,?,?,?)', id(), fixture.assignments.a, '2026-10-23', 0, now()); await run('UPDATE assignments SET active=0 WHERE id=?', fixture.assignments.a); assert.equal((await expected(fixture.users.super, date, date)).filter(s => s.assignment_id === fixture.assignments.a).length, before); assert.equal((await expected(fixture.users.super, '2026-10-26', '2026-10-26')).filter(s => s.assignment_id === fixture.assignments.a).length, 0); await run('UPDATE assignments SET active=1 WHERE id=?', fixture.assignments.a); });
test('demoted Head Teacher loses role-derived access even if old assignment still references them', async () => { await run("UPDATE users SET role='teacher' WHERE id=?", fixture.users.headB.id); const r = await call('/api/lookups', { user: 'headB' }); assert.equal(r.status, 200); assert.equal(r.data.assignments.length, 0); await run("UPDATE users SET role='head_teacher' WHERE id=?", fixture.users.headB.id); });
test('export permission is enforced independently from read access and cannot be forged', async () => { await run("UPDATE users SET permissions='[]' WHERE id=?", fixture.users.teacher.id); assert.equal((await call('/api/diaries/' + d.id)).status, 200); for (const suffix of ['/export?format=pdf', '/print'])
    assert.equal((await call('/api/diaries/' + d.id + suffix)).status, 403); const preview = await call('/api/diaries/' + d.id + '/preview'); assert.ok(!preview.data.toString().includes('Print A4 document')); await run('UPDATE users SET permissions=? WHERE id=?', JSON.stringify(['export']), fixture.users.teacher.id); });
test('teacher profile visibility and notification updates cannot cross user boundaries', async () => { const lk = (await call('/api/lookups')).data; assert.equal(lk.users.length, 1); assert.equal(lk.users[0].id, fixture.users.teacher.id); const n = await one('SELECT * FROM notifications WHERE user_id=? AND read_at IS NULL', fixture.users.head.id); assert.ok(n); await call('/api/notifications', { method: 'PATCH', body: { id: n.id } }); assert.equal((await one('SELECT read_at FROM notifications WHERE id=?', n.id)).read_at, null); });
test('passwords are hashed with independent salts and expired sessions fail closed', async () => { const a = (await one('SELECT password FROM users WHERE id=?', fixture.users.teacher.id)).password, b = (await one('SELECT password FROM users WHERE id=?', fixture.users.teacherB.id)).password; assert.notEqual(a, fixture.password); assert.notEqual(a, b); const head = fixture.users.headB; await run('UPDATE sessions SET expires_at=? WHERE user_id=?', '2000-01-01T00:00:00.000Z', head.id); assert.equal((await call('/api/me', { user: 'headB' })).status, 401); });
test('same teacher can keep separate class/subject diaries for the same day and period', async () => { const c = await call('/api/academics', { user: 'super', method: 'POST', body: { kind: 'class', name: 'TEST Class 7' } }); assert.equal(c.status, 201); const section = await call('/api/academics', { user: 'super', method: 'POST', body: { kind: 'section', name: 'TEST B', parent_id: c.data.id } }); assert.equal(section.status, 201); await call('/api/class-subjects',{user:'super',method:'POST',body:{class_id:c.data.id,subject_ids:[fixture.academics.subject]}});const a = await call('/api/assignments', { user: 'super', method: 'POST', body: { teacher_id: fixture.users.teacher.id, head_id: fixture.users.head.id, section_id: section.data.id, subject_id: fixture.academics.subject, session_id: fixture.academics.session, start_date: '2026-01-01', end_date: '2027-12-31', weekdays: [1, 2, 3, 4, 5], periods: [1], due_time: '16:00', review_time: '18:00' } }); assert.equal(a.status, 201); const record = await call('/api/diaries', { method: 'POST', body: { ...newDiary(), assignment_id: a.data.id } }); assert.equal(record.status, 201); assert.notEqual(record.data.id, d.id); assert.equal(record.data.assignment.class_name, 'TEST Class 7'); });
test('Supabase private schema grants deny browser API roles and attachment bucket is private',async()=>{const row=await one("SELECT has_schema_privilege('anon','elite_diary','USAGE') anon_access, has_schema_privilege('authenticated','elite_diary','USAGE') user_access");assert.equal(row.anon_access,false);assert.equal(row.user_access,false);const bucket=await one("SELECT public FROM storage.buckets WHERE id='elite-scholars-private'");assert.equal(bucket.public,false);});

test('homework sheets persist subject marks without retired assessment fields, validate submissions, and preserve earlier layouts',async()=>{
 await run('UPDATE assignments SET active=1 WHERE id=?',fixture.assignments.a);
 await run('UPDATE users SET active=1 WHERE id=?',fixture.users.head.id);
 const old=(await call('/api/diaries/'+d.id,{user:'super'})).data;
 for(const subject of ['Mathematics','Urdu']){const sid=id();await run('INSERT INTO academics(id,kind,name,parent_id) VALUES(?,?,?,?)',sid,'subject',subject,fixture.academics.department);await run('INSERT OR IGNORE INTO class_subjects VALUES(?,?)',fixture.academics.class,sid);await run('INSERT INTO assignments VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1)',id(),fixture.users.teacher.id,fixture.users.head.id,fixture.academics.section,sid,fixture.academics.session,'2026-01-01','2027-12-31',JSON.stringify([1]),JSON.stringify([1,2]),'16:00','18:00');}
 const grid={topic:'TEST Daily Homework',diary_layout:'homework_grid',homework_rows:[{subject:'Mathematics',detail:'Fractions exercise 5.2',hw:true,learn:true,test:false,direction:'auto'},{subject:'Urdu',detail:'سبق کی دہرائی',hw:true,learn:false,test:true,direction:'rtl'}],hygiene:{uniform:'tidy',hair:'untidy',nails:'',teeth:'tidy',shoes:''}};
 let r=await call('/api/diaries',{method:'POST',body:{assignment_id:fixture.assignments.a,diary_date:'2027-01-11',period:1,content:grid}});assert.equal(r.status,201,JSON.stringify(r.data));let sheet=r.data;
 assert.deepEqual(sheet.content.homework_rows.map(({teacher_id,teacher_name,subject_id,...row})=>row),grid.homework_rows);assert.ok(sheet.content.homework_rows.every(r=>r.teacher_id===fixture.users.teacher.id&&r.subject_id));assert.equal('hygiene' in sheet.content,false);
 assert.equal((await call('/api/diaries/'+sheet.id,{method:'PUT',body:{version:sheet.version,content:{...grid,homework_rows:[{subject:'X',detail:'',hw:false}]},submit:true}})).status,400);
 assert.equal((await call('/api/diaries/'+sheet.id,{method:'PUT',body:{version:sheet.version,content:{...grid,homework_rows:[{subject:'X',detail:'Y',hw:'yes'}]}}})).status,400);
 r=await call('/api/diaries/'+sheet.id,{method:'PUT',body:{version:sheet.version,content:grid,submit:true}});assert.equal(r.status,200);sheet=r.data;assert.equal(sheet.status,'submitted');
 const preview=(await call('/api/diaries/'+sheet.id+'/preview')).data.toString();assert.ok(preview.includes('data-layout="homework_grid"'));assert.ok(preview.includes('Detail of Home Work'));assert.doesNotMatch(preview,/hygiene|tidy|untidy/i);assert.ok(preview.includes('A4 portrait'));
 const matched=(await call('/api/diaries?search=Fractions')).data;assert.ok(matched.items.some(x=>x.id===sheet.id));
 assert.equal((await call('/api/templates/homework-preview')).status,403);
 const sample=await call('/api/templates/homework-preview',{user:'super'});assert.equal(sample.status,200);assert.ok(sample.data.toString().includes('Blue + Pink'));
 const current=(await call('/api/settings',{user:'super'})).data;
 const published=await call('/api/settings',{user:'super',method:'PUT',body:{...current,logo:current.logo||'',diaryLayout:'homework_grid'}});assert.equal(published.status,200);assert.equal(published.data.diaryLayout,'homework_grid');
 const historic=(await call('/api/diaries/'+d.id,{user:'super'})).data;assert.deepEqual(historic.template_snapshot,old.template_snapshot);assert.ok(!(await call('/api/diaries/'+d.id+'/preview',{user:'super'})).data.toString().includes('data-layout="homework_grid"'));
});
