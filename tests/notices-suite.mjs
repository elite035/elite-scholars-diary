import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function suite(runtime) {
  process.env.NODE_ENV = 'test';
  process.env.COOKIE_SECURE = 'false';
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'elite-notices-'));
  if (runtime === 'cloud') process.env.CLOUD_TEST_PGLITE = 'true';
  const { server, shutdown } = await import('../' + runtime + '/index.mjs');
  const { fixtures } = await import('../scripts/' + (runtime === 'cloud' ? 'cloud-' : '') + 'fixtures.mjs');
  const f = await fixtures();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  after(shutdown);
  const base = 'http://127.0.0.1:' + server.address().port,
    auth = {};
  async function req(path, user, method = 'GET', body) {
    const a = auth[user],
      r = await fetch(base + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(a ? { Cookie: a.cookie, 'X-CSRF-Token': a.csrf } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    return { status: r.status, data: await r.json(), cookie: r.headers.get('set-cookie') };
  }
  async function ok(path, user, method, body, status = 200) {
    const r = await req(path, user, method, body);
    assert.equal(r.status, status, JSON.stringify(r.data));
    return r.data;
  }
  for (const key of ['super', 'head']) {
    const r = await req('/api/login', null, 'POST', { email: f.users[key].email, password: f.password });
    auth[key] = { cookie: r.cookie.split(';')[0], csrf: r.data.csrf };
  }
  const make = (kind, name, parent_id) => ok('/api/school/structure', 'super', 'POST', { kind, name, parent_id }, 201);
  const branch = (await make('branch', 'Notice Branch')).id,
    campus = (await make('campus', 'Notice Campus', branch)).id,
    class1 = (await make('class', 'Class One', campus)).id,
    class2 = (await make('class', 'Class Two', campus)).id;
  const post = (body, user = 'super') => req('/api/school/notices', user, 'POST', { text: 'Notice text', published: true, ...body });

  test(runtime + ': several notices can be assigned to different classes on the same day', async () => {
    await ok('/api/school/notices', 'super', 'POST', { text: 'For class one', published: true, class_ids: [class1] }, 201);
    await ok('/api/school/notices', 'super', 'POST', { text: 'For class two', published: true, class_ids: [class2] }, 201);
    await ok('/api/school/notices', 'super', 'POST', { text: 'For everyone', published: true }, 201);
    const list = (await ok('/api/school/notices', 'super')).notices;
    assert.equal(list.length, 3);
    assert.deepEqual(list.find((n) => n.text === 'For class one').class_ids, [class1]);
  });

  test(runtime + ': a class cannot exceed three notices a day, and drafts do not count', async () => {
    assert.equal((await post({ text: 'Third for class one', class_ids: [class1] })).status, 201);
    const fourth = await post({ text: 'Fourth', class_ids: [class1] });
    assert.equal(fourth.status, 409, JSON.stringify(fourth.data));
    assert.equal((await post({ text: 'Draft', published: false, class_ids: [class1] })).status, 201);
  });

  test(runtime + ': the notices permission is separate and can be granted to one person', async () => {
    assert.equal((await req('/api/school/notices', 'head')).status, 403);
    await ok('/api/school/permissions', 'super', 'PUT', { user_id: f.users.head.id, allows: ['notices.view'], denies: [] });
    assert.equal((await req('/api/school/notices', 'head')).status, 200);
    assert.equal((await post({ class_ids: [class2], text: 'Nope' }, 'head')).status, 403);
    await ok('/api/school/permissions', 'super', 'PUT', { user_id: f.users.head.id, allows: ['notices.manage'], denies: [] });
    assert.equal((await post({ class_ids: [class2], text: 'Allowed' }, 'head')).status, 201);
  });
}
