// Read-only deployment preflight using the configured runtime identity.
import * as db from '../cloud/db.mjs';
import { integrityAudit } from '../shared/integrity-audit.mjs';
try {
  console.log(
    JSON.stringify(
      { checkedAt: new Date().toISOString(), conflicts: await integrityAudit(db) },
      null,
      2,
    ),
  );
} finally {
  await db.db.close();
}
