// Select isolation before the test runner can statically import any DB module.
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
const directory = mkdtempSync(join(tmpdir(), 'elite-suite-'));
const files = process.argv.slice(2);
const selected = files.length
  ? files
  : readdirSync(new URL('../tests/', import.meta.url))
      .filter((x) => x.endsWith('.test.mjs'))
      .map((x) => 'tests/' + x);
const child = spawn(process.execPath, ['--test', '--test-concurrency=1', ...selected], {
  cwd: new URL('../', import.meta.url),
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'test',
    TEST_REFERENCE_DATE: process.env.TEST_REFERENCE_DATE || '2026-11-05T12:00:00Z',
    DATA_DIR: directory,
    ELITE_TEST_ROOT: directory,
    TMPDIR: directory,
    TMP: directory,
    TEMP: directory,
  },
});
child.on('error', (error) => {
  console.error(error.message);
  rmSync(directory, { recursive: true, force: true });
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  rmSync(directory, { recursive: true, force: true });
  process.exitCode = code ?? (signal ? 1 : 0);
});
