import { restoreBackup } from '../shared/local-recovery.mjs';
const [source, destination] = process.argv.slice(2);
if (!source || !destination) {
  console.error('Usage: node scripts/restore.mjs /backup-directory /empty-destination');
  process.exit(1);
}
restoreBackup(source, destination);
console.log(
  'Restore verified. Sessions invalidated. Point DATA_DIR at the restored directory and start the server.',
);
