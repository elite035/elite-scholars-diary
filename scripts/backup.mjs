const destination = process.argv[2] || process.env.BACKUP_DIR;
if (!destination) {
  console.error('Usage: node scripts/backup.mjs /absolute/new-backup-directory');
  process.exit(1);
}
const { createBackup } = await import('../server/backup.mjs'),
  { db } = await import('../server/db.mjs');
const manifest = createBackup(destination);
db.close();
console.log(
  'Verified snapshot created:',
  manifest.created_at,
  'Attachments:',
  manifest.files.length,
);
