import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { createStaticCache } from '../shared/static-cache.mjs';

const dir = mkdtempSync(join(tmpdir(), 'static-'));
const url = pathToFileURL(dir + '/');
const big = 'console.log("hello world");\n'.repeat(200);
writeFileSync(join(dir, 'app.js'), big);
writeFileSync(join(dir, 'logo.png'), Buffer.alloc(5000, 1));

test('text files are compressed once, smaller, and decode back to the original', () => {
  const load = createStaticCache(url);
  const br = load('app.js', 'gzip, deflate, br');
  assert.equal(br.encoding, 'br');
  assert.ok(br.body.length < big.length / 5);
  assert.equal(brotliDecompressSync(br.body).toString(), big);
  const gz = load('app.js', 'gzip');
  assert.equal(gz.encoding, 'gzip');
  assert.equal(gunzipSync(gz.body).toString(), big);
  assert.equal(load('app.js', 'br').body, br.body, 'compressed bytes are cached');
});
test('no compression when the browser does not ask for it, and never for images', () => {
  const load = createStaticCache(url);
  assert.equal(load('app.js', '').encoding, '');
  assert.equal(load('logo.png', 'br, gzip').encoding, '');
});
test('each representation has its own ETag and a changed file gets a new one', () => {
  const load = createStaticCache(url),
    plain = load('app.js', ''),
    br = load('app.js', 'br');
  assert.notEqual(plain.etag, br.etag);
  assert.equal(load('app.js', '').etag, plain.etag);
  writeFileSync(join(dir, 'app.js'), big + '// changed\n');
  const later = new Date(Date.now() + 5000);
  utimesSync(join(dir, 'app.js'), later, later);
  assert.notEqual(load('app.js', '').etag, plain.etag);
});
