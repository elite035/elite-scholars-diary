# School diary operations and preservation

The existing SQLite/self-hosted and PostgreSQL/cloud adapters remain supported. The modern class-diary approval workflow and immutable legacy records remain authoritative. No cleanup job deletes school diaries, versions, staff history or communication history.

## Upgrade source and compatibility

Ordered files in `supabase/migrations` are the PostgreSQL upgrade history. `cloud/*schema.sql` are fresh-install snapshots and must express the same invariants. SQLite uses `server/schema.sql`, `shared/enhancements-schema.sql` and `shared/school-schema.sql`; its additive startup definitions never merge conflicting records. New academic business-key triggers reject new conflicts without deleting old rows. Run `node --env-file=.env.cloud scripts/schema-audit.mjs` before any upgrade. Resolve conflicts explicitly with the school; do not edit historical IDs or delete rows to make an index succeed.

Versions 5 and 6 add account-security/branding storage and academic uniqueness protection. Older releases can continue reading existing records after the additive migration. Keep the previous release available until the new release is verified. Rolling back application code must not drop these tables, triggers, assets or indexes. Keep schema and application receipts with the corresponding encrypted backup.

## Recovery objectives and responsibilities

Proposed operational targets: a recovery point within 24 hours and a recovery time within four hours. These are targets for the school owner to adopt, not a claim that a provider plan guarantees them. The school owner owns recovery keys and approves emergency cutover. A designated operator checks backup age, scheduler heartbeat and storage health daily in School settings. An independent monitor should check the protected readiness endpoint with an authorized operator session or an equivalently scoped service integration. Never expose readiness publicly or place account cookies in a public monitor.

Hosted backup alarms are independent of website uptime. A backup older than 36 hours, a scheduler heartbeat older than 45 minutes or a storage error needs investigation. HTTP 402 indicates a provider storage/quota/billing restriction; it cannot be fixed by changing diary code. Do not upgrade a plan or change billing automatically. Readiness shows the last recorded success and failure; a success message is not sufficient unless the archive has been retrieved and verified.

## Protected recovery copy

Keep the encryption key separately from each encrypted archive, with two authorized custodians and an offline recovery copy. Keep the existing Android release keystore and its password separately as well; a new key cannot update the installed Android app. Account authenticator secrets use a separate purpose-derived key from the backup key unless ACCOUNT_SECURITY_KEY is explicitly configured. Retain both keys during any planned rotation. Never rotate keys by overwriting the current .env file.

Cloud fallback: `node --env-file=.env.cloud scripts/backup-cloud.mjs /absolute/private/path/snapshot.esb`. The destination must be private, outside public assets, and not already exist. The script records only sizes, checksums and row counts. It verifies decryption before reporting success. For a database beyond that JSON budget, use `node --env-file=.env.cloud scripts/backup-native.mjs /absolute/private/path/snapshot.espg` and `node --env-file=.env.cloud scripts/restore-native-check.mjs /absolute/private/path/snapshot.espg`. The native archive streams pg_dump through authenticated encryption, verifies every decrypted byte, excludes session data, and rehearses restoration by streamed COPY into a temporary schema that is rolled back. It requires compatible pg_dump/pg_restore binaries and a separately protected private-storage copy if attachments exist. The verified current archive contained zero attachments.

The JSON fallback still has bounded memory/attachment limits; for a larger installation use PostgreSQL-native transactional dumps plus a checksummed private-storage manifest, not higher serverless limits.

Rehearsal: `node --env-file=.env.cloud scripts/restore-cloud-check.mjs /absolute/private/path/snapshot.esb`. This uses the separately held operator configuration, restores a temporary schema, validates table counts and foreign keys, confirms sessions are absent, and rolls the schema back. Attachment checks create temporary private objects and remove them after comparison. A rehearsal does not replace a full outage cutover.

## Disaster cutover checklist

1. Record the incident time and isolate the new recovery target from parents and staff. Keep the original database intact. Preserve incident logs and the last usable deployment URL.
2. Retrieve a verified archive and its separately protected key. Verify the receipt SHA-256, authenticated decryption, table list and file checksums. Choose the latest complete archive within the accepted recovery point.
3. Provision a separate PostgreSQL instance or schema with the matching ordered migrations and restricted runtime role. Restore in dependency order. Reuse neither existing authenticated sessions nor live push deliveries. Restore attachments to a separate private bucket and verify each byte checksum.
4. Validate original IDs, row counts, relationships, immutable versions, approvals, teacher scopes and representative multilingual exports. Test login with an authorized administrator and confirm old sessions cannot access the recovered instance. Do not use a seed/demo script.
5. Stage the same application revision against the recovered target using private environment settings. Keep PUBLIC_ORIGIN aligned with the final domain. Verify permissions, approved-only parent access, save/review behavior, exports, backup and scheduler jobs before cutover.
6. During the agreed maintenance window, stop writes to the previous target, promote the tested deployment or update the existing domain target, and run the same smoke checks. Record actual recovery point and elapsed time. Retain the old target read-only; do not destroy it.
7. If verification fails before new writes, restore the previous deployment/domain. If any new writes have reached the recovered target, stop and reconcile them explicitly before rollback; never overwrite either database with an older snapshot.

The current automated rehearsal proves restoration into an isolated schema and test PostgreSQL instance. It does not prove an executed production disaster cutover or a four-hour operational service level.

## Account operations and effective access

New and reset temporary credentials require a different password before normal work. Existing accounts and password hashes are preserved. Each user can enable an authenticator, save the one-time recovery codes privately, inspect/revoke their sessions and confirm identity before sensitive administrative changes. Do not enable MFA on someone else's behalf or store recovery codes in support tickets. A lost-factor recovery requires school identity verification and a separately reviewed operator procedure; resetting a password must not silently disable MFA.

Role capability grants do not override role hard limits. User, hierarchy, permission, audit and destructive school administration remain administrative responsibilities. Operational delegation for Coordinators and Heads is limited to saved hierarchy and campus. An administrator must establish a family's first class link; delegated parent managers can then manage only authorized existing family links. Staff campus moves require incompatible active assignments to be explicitly archived or replaced; historical diaries are preserved.

## Retention and privacy

The school owner sets retention periods by category: accounts and hierarchy; teaching assignments; diary content and approval versions; audits; family links; communication history; generated exports; and private credential handover documents. The existing retentionDays field records policy only. It is not an automatic deletion timer.

Diaries, approvals and audit history remain available only through existing authorized scope. Exported files leave application access control: staff must save them to school-approved devices/storage and share them only through the approved parent channel. Temporary staff-password lists must be held privately and removed through the school's reviewed credential-handling process after password changes. No credential list belongs in public assets or a source repository.

A retention, redaction or exceptional erasure request must identify the records, purpose, authorizer and historical dependencies. Preview its effect, preserve the required audit evidence, and use a separately reviewed export/redaction procedure. Do not delete immutable history or historical accounts as routine maintenance. This document is an engineering operating policy; the school must approve its retention and incident responsibilities.

## Release and device verification

Use Node 24.22.2, a clean locked dependency install, isolated tests, syntax checks and the deterministic export bundle. The GitHub workflow requires browser prerequisites; missing Chromium fails the release run. Local browser-skipped tests do not count as production acceptance. Test with synthetic data on both adapters. Tests inject only the business calendar; authentication/session time remains real.

Keep the brown/cream/gold branding and approved A4 template. A complete diary that cannot fit legibly on one A4 page must produce the existing clear error, never clipping or silent content deletion. Test mixed-language fonts and school logos. The self-hosted Noto font is distributed unmodified with its upstream OFL license and source receipt.

Android 1.0.2 uses the same release identity, acknowledges save/cancel/error after the actual file picker operation, and writes outside the UI thread. Older installed versions retain their existing bridge fallback. Physical Android file-picker/cancellation/storage failures and native printing still require device verification. PWA offline behavior caches only the public shell and branding; it never caches private diary APIs or staff drafts persistently.
