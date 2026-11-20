import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function suite(runtime) {
  process.env.NODE_ENV = 'test';
  process.env.COOKIE_SECURE = 'false';
  process.env.BACKUP_ENCRYPTION_KEY = 'ab'.repeat(32);
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'elite-people-'));
  if (runtime === 'cloud') process.env.CLOUD_TEST_PGLITE = 'true';
  const { server, shutdown } = await import('../' + runtime + '/index.mjs');
  const { fixtures } = await import('../scripts/' + (runtime === 'cloud' ? 'cloud-' : '') + 'fixtures.mjs');
  const f = await fixtures();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  after(shutdown);
  const base = 'http://127.0.0.1:' + server.address().port,
    auth = {};
  async function req(path, user = 'super', method = 'GET', body) {
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
  async function login(key, email, password) {
    const r = await req('/api/login', null, 'POST', { email, password });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    auth[key] = { cookie: r.cookie.split(';')[0], csrf: r.data.csrf };
    return r.data;
  }
  for (const key of ['super', 'admin']) await login(key, f.users[key].email, f.password);
  const make = (kind, name, parent_id) => ok('/api/school/structure', 'super', 'POST', { kind, name, parent_id }, 201);
  const branch = (await make('branch', 'People Branch')).id,
    campusA = (await make('campus', 'Campus A', branch)).id,
    campusB = (await make('campus', 'Campus B', branch)).id;
  const create = (name, role, campus_id, extra = {}) =>
    ok('/api/school/people', 'super', 'POST', {
      name,
      email: name.replaceAll(' ', '').toLowerCase() + '@example.invalid',
      role,
      password: 'abc123',
      campus_id,
      ...extra,
    }, 201);
  const directory = async () => new Map((await ok('/api/school/people')).map((x) => [x.id, x]));

  test(runtime + ': passwords of 6 or more characters are accepted, shorter ones are not', async () => {
    const short = await req('/api/school/people', 'super', 'POST', {
      name: 'Short Pass', email: 'short@example.invalid', role: 'teacher', password: '12345',
    });
    assert.equal(short.status, 400);
    await create('Six Pass', 'parent');
  });

  test(runtime + ': hierarchy is built from the assigned campus when accounts are created', async () => {
    const coordinator = await create('Auto Coordinator', 'coordinator', campusA),
      head = await create('Auto Head', 'head_teacher', campusA),
      teacher = await create('Auto Teacher', 'teacher', campusA),
      other = await create('Other Campus Teacher', 'teacher', campusB);
    let people = await directory();
    assert.equal(people.get(head.id).reports_to, coordinator.id);
    assert.equal(people.get(teacher.id).reports_to, head.id);
    assert.equal(people.get(teacher.id).campus_id, campusA);
    assert.equal(people.get(other.id).reports_to, null);
    const otherHead = await create('Other Head', 'head_teacher', campusB);
    people = await directory();
    assert.equal(people.get(other.id).reports_to, otherHead.id, 'new supervisor adopts unassigned staff of the campus');
    assert.equal((await req('/api/school/people/' + teacher.id, 'super', 'PATCH', { parent_id: otherHead.id })).status, 409);
  });

  test(runtime + ': a supervisor can be changed later and staff follow a campus change', async () => {
    const head2 = await create('Second Head', 'head_teacher', campusA),
      teacher = await create('Movable Teacher', 'teacher', campusA);
    await ok('/api/school/people/' + teacher.id, 'super', 'PATCH', { parent_id: head2.id });
    assert.equal((await directory()).get(teacher.id).reports_to, head2.id);
    await ok('/api/school/people/' + teacher.id, 'super', 'PATCH', { campus_id: campusB });
    const moved = (await directory()).get(teacher.id);
    assert.equal(moved.campus_id, campusB);
    assert.notEqual(moved.reports_to, head2.id);
  });

  test(runtime + ': super admin sees the temporary password until the user changes it', async () => {
    const created = await create('First Login', 'teacher', campusA);
    assert.equal((await directory()).get(created.id).temporary_password, 'abc123');
    assert.equal((await ok('/api/school/people', 'admin')).find((x) => x.id === created.id).temporary_password, undefined);
    const session = await login('first', created.email, 'abc123');
    assert.equal(session.user.mustChangePassword, true);
    assert.equal((await req('/api/school/diaries', 'first')).status, 403);
    assert.equal((await req('/api/profile', 'first', 'PATCH', { name: 'First Login', currentPassword: 'abc123', newPassword: '12345' })).status, 400);
    await ok('/api/profile', 'first', 'PATCH', { name: 'First Login', currentPassword: 'abc123', newPassword: 'mine99' });
    const after_ = (await directory()).get(created.id);
    assert.equal(after_.temporary_password, null);
    assert.equal(after_.must_change_password, false);
  });

  test(runtime + ': no response ever carries a password hash', async () => {
    const created = await create('Leak Check', 'teacher', campusA);
    await login('leak', created.email, 'abc123');
    for (const user of ['super', 'admin', 'leak'])
      for (const path of ['/api/me', '/api/school/people', '/api/school/bootstrap', '/api/school/hierarchy']) {
        const r = await req(path, user);
        if (r.status !== 200) continue;
        const text = JSON.stringify(r.data);
        assert.ok(!/[a-f0-9]{32}:[a-f0-9]{128}/.test(text), user + ' ' + path + ' exposes a password hash');
        assert.ok(!/"password"/.test(text), user + ' ' + path + ' exposes a password field');
      }
  });
}
