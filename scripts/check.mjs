import { fileURLToPath } from 'node:url';
import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const root = new URL('../', import.meta.url);
let count = 0;
async function check(directory) {
  for (const entry of await readdir(new URL(directory, root), { withFileTypes: true })) {
    const name = directory + entry.name;
    if (entry.isDirectory()) await check(name + '/');
    else if (/\.(mjs|js)$/.test(name)) {
      const result = spawnSync(process.execPath, ['--check', fileURLToPath(new URL(name, root))], {
        encoding: 'utf8',
      });
      if (result.status !== 0) {
        process.stderr.write(result.stderr || 'Syntax check failed: ' + name);
        process.exit(1);
      }
      count++;
    }
  }
}
for (const directory of ['server/', 'cloud/', 'shared/', 'public/', 'client/', 'api/', 'scripts/'])
  await check(directory);
console.log(`Syntax checked ${count} application modules.`);
