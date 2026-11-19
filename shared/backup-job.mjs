// Record scheduled recovery outcomes without persisting credentials or archive contents.
export async function runBackupJob(createBackup, recordAudit) {
  let result;
  try {
    result = await createBackup();
  } catch (error) {
    try {
      await recordAudit(null, 'cloud_backup_failed', null, {
        status: error.status || 500,
        reason:
          error.code === 'STORAGE_RESTRICTED'
            ? 'Storage service restricted'
            : 'Backup job failed; inspect server logs',
      });
    } catch {
      console.error('Backup failure could not be written to audit history');
    }
    throw error;
  }
  await recordAudit(null, 'cloud_backup_completed', null, {
    created_at: result.createdAt,
    bytes: result.bytes,
    tables: result.tables,
    files: result.files,
  });
  return result;
}
