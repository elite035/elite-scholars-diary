import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('first-run setup requires the configured token and can create only one administrator', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'elite-first-run-'));
  process.env.NODE_ENV = 'test';
  process.env.DATA_DIR = dataDir;
  process.env.SETUP_TOKEN = 'unit-test-only-random-setup-token';
  process.env.REPLIT_DEV_DOMAIN = 'school-preview.replit.dev';
  const { server, shutdown } = await import('../server/index.mjs');

  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`,
      health = await fetch(base + '/api/health').then((response) => response.json());
    assert.equal(health.configured, false);
    assert.equal(health.setupEnabled, true);

    const create = (token, origin) =>
      fetch(base + '/api/setup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(origin ? { Origin: origin } : {}),
        },
        body: JSON.stringify({
          token,
          name: 'First Administrator',
          email: 'first-admin@example.invalid',
          password: 'Test-Only-Admin-Password!2026',
        }),
      });
    assert.equal((await create('incorrect-setup-key')).status, 403);
    const previewOrigin = await create(
      'incorrect-setup-key',
      'https://school-preview.replit.dev',
    );
    assert.equal(previewOrigin.status, 403);
    assert.equal((await previewOrigin.json()).error, 'Setup key is not correct.');
    const attackerOrigin = await create(
      'incorrect-setup-key',
      'https://attacker.invalid',
    );
    assert.equal((await attackerOrigin.json()).error, 'Untrusted request origin');
    assert.equal((await create(process.env.SETUP_TOKEN)).status, 201);
    assert.equal((await create(process.env.SETUP_TOKEN)).status, 409);

    const login = await fetch(base + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'first-admin@example.invalid',
        password: 'Test-Only-Admin-Password!2026',
      }),
    });
    assert.equal(login.status, 200);
    assert.equal((await login.json()).user.role, 'super_admin');
    assert.equal((await fetch(base + '/api/health').then((response) => response.json())).configured, true);
  } finally {
    await shutdown();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
