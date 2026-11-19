# Live deployment

Production: https://elite-scholars-diary.vercel.app

Vercel project elite-scholars-diary, team iqrannwl (Hobby). Supabase project fpllvutoexblrwjbtnrl, elite-scholars-diary, MI organization, Singapore (Free). The older paused elite project is unchanged.

The cloud adapter in cloud/ uses api/index.mjs and validated nested-route rewrites. PostgreSQL queries are asynchronous and parameterized; transaction-pooler prepared statements are disabled. The private elite_diary schema has 19 RLS-enabled tables, no browser-role access, and a dedicated application runtime role. Authentication is custom scrypt/session authentication, not Supabase Auth.

Production secrets are configured on Vercel. Local .env.cloud and .env.provision-state.json files are gitignored and mode 600. Never publish these files. Preserve BACKUP_ENCRYPTION_KEY offline. PUBLIC_ORIGIN matches the production HTTPS origin. Hosted attachments use the private elite-scholars-private bucket and a 3 MB limit with signature/checksum checks.

Supabase pg_cron/pg_net call protected endpoints using a scoped token stored in Vault: deadlines every 15 minutes, encrypted backups daily 03:15 UTC. The private elite-scholars-backups bucket retains seven days. Backups include 18 tables (no sessions) plus referenced files, gzip and AES-256-GCM encryption, a 32 MB attachment budget and 48 MB archive ceiling.

A real hosted backup and non-destructive restoration rehearsal passed. scripts/restore-cloud-check.mjs decrypts/checks the archive, restores data into a scratch schema with actual foreign keys, rolls back the schema and verifies temporary Storage bytes. It does not perform disaster cutover. Actual recovery needs a separately restored target, record/file verification and deployment reconfiguration by an operator.

The landscape homework template is now the default. Diary Template provides a sample and download controls; New Diary supports editable rows, H.W/Learn/Test marks. Portrait teaching reflection and immutable historical snapshots remain supported.

The suite passed 66 tests, zero failures, three optional skips. Live role isolation, workflow, private Storage, reports, browser downloads and encrypted restore were verified. Replace TEST records and verification quotes with approved school data; confirm contacts, calendar, monitoring and recovery ownership. Email/SMS, self-service email recovery, physical Android tests and production load tests are not included. See README.md for local operation and limits.

## Class diaries and communication release

Production origin is https://diary.elitescholars.edu.pk. The additive migration `20261020193414_class_diaries_and_communications.sql` preserves all prior user, diary, version and audit rows. It adds ten application-private tables (29 total): usernames, class-subject links, reviewer defaults, connections, blocks, conversations, membership, membership history, messages and reports. RLS is enabled on every table; only the server runtime role receives access. Browser roles remain denied. Communication history is append-only. Backups now include 28 tables, excluding sessions.

In Academic Setup, link each class to its subjects or early-years book/activity categories and optionally select the academic session used for new assignments. Without an explicit default, the current session with the latest start date is selected. In People & Roles, configure each teacher's Head Teacher reviewer. Teacher Assignment then supports multiple class/section and subject choices, filters subjects per class and applies the configured reviewer automatically. Its Academic Session, Active From and Effective Until input fields are removed; internal session/date relationships remain for timetable and history.

Use Class Diary for class/date/period entry and a combined preview. Teachers can save or submit only their own assigned subject entries. Each subject keeps its own diary, author, reviewer, status, versions and amendment process. Reviewers and administrators see only the class entries permitted by their existing scope. A teacher's combined preview does not grant access to other teachers' private diaries. Approved entries stay locked. The Head Teacher's scheduled daily quote is captured at approval and preserved against later quote edits. If no Head quote is scheduled, the pre-existing quote snapshot remains; no quote is invented. Old approved records are not rewritten.

School Settings now exposes only name, logo, address and contact. Diary Template and the Daily Quotes add form retain their configuration and layout. Identity changes create a new immutable template snapshot; old diaries retain their branding.

Communication uses existing accounts and sessions. Every account gets a unique generated username, which can be changed on Communication. Search uses username prefixes. Requests must be accepted before private chat or group invitations. Group creators manage membership; other members may leave. Blocks stop new requests and private/group sends, and reports are visible to Super Admin. Open conversations poll every 15 seconds; this is polling rather than a WebSocket service. Use Refresh for the conversation/request list. The disclosure explains that Super Admin can read messages. Oversight is a separate Super Admin-only endpoint and every privileged history read is audited without message text in the audit log. No end-to-end encryption claim is made. Messages and membership history are retained until a documented school retention decision; there is no automatic destructive message purge.

Successful staff logins no longer consume the shared-IP failure limit. Failed authentication is limited by account (12 per 15-minute window) and IP (100 per window), while passwords remain scrypt-hashed and sessions/CSRF checks remain enforced.

Before-change and after-change encrypted backups were generated. The operator should monitor the existing 32 MB attachment budget and keep the encryption key offline. A rollback should use the previous application release while preserving the additive tables; do not drop tables or overwrite live data. A full data recovery requires a separate restored target and verification before cutover.
