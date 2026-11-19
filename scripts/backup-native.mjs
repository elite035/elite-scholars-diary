// Memory-bounded PostgreSQL operator archive. Never runs in an HTTP request.
import { spawn } from 'node:child_process';
import { createWriteStream, createReadStream } from 'node:fs';
import { readFile, writeFile, open, stat, unlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
process.umask(0o077);
const destination = process.argv[2],
  target = destination && resolve(destination),
  publicRoot = resolve('public');
if (
  !target ||
  !target.endsWith('.espg') ||
  target === publicRoot ||
  target.startsWith(publicRoot + '/')
)
  throw Error('Choose a new private .espg destination outside public/.');
const encoded = process.env.BACKUP_ENCRYPTION_KEY;
if (!/^[a-f0-9]{64}$/.test(encoded || '')) throw Error('Backup encryption is not configured.');
const state = JSON.parse(
  await readFile(new URL('../.env.provision-state.json', import.meta.url), 'utf8'),
);
if (state.ref !== 'fpllvutoexblrwjbtnrl') throw Error('Unexpected project identity.');
const url = new URL(process.env.DATABASE_URL);
const env = {
  ...process.env,
  PGHOST: url.hostname,
  PGPORT: url.port || '5432',
  PGDATABASE: url.pathname.slice(1) || 'postgres',
  PGUSER: 'postgres.' + state.ref,
  PGPASSWORD: state.dbPassword,
  PGSSLMODE: 'require',
  PGCONNECT_TIMEOUT: '20',
};
const { sealNative, verifyNative } = await import('../shared/native-backup.mjs');
let child;
try {
  child = spawn(
    'pg_dump',
    [
      '--format=custom',
      '--compress=gzip:6',
      '--no-owner',
      '--no-acl',
      '--schema=elite_diary',
      '--exclude-table-data=elite_diary.sessions',
    ],
    { env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let error = '';
  child.stderr.on('data', (chunk) => {
    if (error.length < 2000) error += chunk;
  });
  const completed = new Promise((yes, no) => {
    child.on('error', no);
    child.on('close', (code) =>
      code === 0
        ? yes()
        : no(
            Error(
              'Native PostgreSQL archive failed. Check operator connectivity and pg_dump compatibility.',
            ),
          ),
    );
  });
  const result = await Promise.all([sealNative(child.stdout, target), completed]);
  const receipt = {
    format: 'elite-scholars-native-postgres',
    version: 1,
    createdAt: new Date().toISOString(),
    ...(await verifyNative(target)),
    sessionsExcluded: true,
    privateStorage: 'Attachment objects require their separate checksummed storage copy.',
  };
  await writeFile(target + '.receipt.json', JSON.stringify(receipt, null, 2), {
    flag: 'wx',
    mode: 0o600,
  });
  console.log(JSON.stringify({ verified: true, ...receipt }));
} catch (error) {
  child?.kill();
  throw error;
}
