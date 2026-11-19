# Elite Scholars School Diary — application guide

Live service: https://diary.elitescholars.edu.pk

A responsive, database-backed school diary application for Super Admin, School Admin, Coordinator, Head Teacher, Teacher and Parent accounts. The official logo is the unchanged artwork supplied in the owner’s master prompt. No test data is seeded into production.

## Architecture

- Node.js 24, native HTTP server, ES modules and plain JavaScript/CSS frontend.
- PostgreSQL in a dedicated private Supabase schema for the hosted service; Node SQLite for local operation.
- Server-managed scrypt password hashes, expiring HttpOnly/SameSite sessions and CSRF tokens.
- Role capabilities plus individual allow/deny overrides, combined with hierarchy/assignment scope. Super Admin remains the recovery authority.
- Shared A4 portrait homework renderer for staff, Head review, approved family view, PDF, PNG and print. `html-to-image` and jsPDF produce browser downloads; Playwright server rendering remains optional.
- Private Supabase attachment storage for the retained teaching-record module; AES-256-GCM encrypted scheduled cloud backups include all application tables and private attachments, excluding sessions.
- Opt-in Web Push through `web-push`, VAPID keys and a root service worker. Subscriptions are authenticated, endpoint restricted, per-account, and removable. Delivery uses a deduplicated persistent outbox, bounded retries and expired-subscription cleanup.

## Main workflows

1. Create branches, then campuses, classes and sections in **School structure**. Create the master subjects and academic session. Use Add Subject to assign one master subject to checked sections; sections within the same class can differ.
2. Create named staff/parent accounts in **User Management**: choose a campus for each Coordinator, Head Teacher and Teacher and the hierarchy (Teacher → Head Teacher → Coordinator of the same campus) is linked automatically; change a supervisor or campus later by editing the account. Passwords are 6 or more characters; each new user must change the temporary password at first sign-in, and a Super Admin can see the temporary password until then (needs `ACCOUNT_SECURITY_KEY` or `BACKUP_ENCRYPTION_KEY`). 
3. In **Teacher assignments**, save the teacher’s campus in **Teacher campus**, then assign the exact section/subject combinations, current session, weekdays and deadlines. The saved Head is automatic. Assignments with diary history are archived and replaced rather than rewritten.
4. Teachers choose date, class and section, then select English/Urdu independently for each subject. One diary per teacher, section and date holds several authorized subjects. Save draft, preview or submit. Wrong subjects, dates, reviewers and stale versions are rejected.
5. Heads review, return with private comments, or approve/publish. Returns remain editable and support resubmission. Approved records are locked; authorized amendments preserve all prior versions. Workflow/version history is append-only.
6. Link each parent account to its child’s section(s) under **Parent access**. Parents see only approved subject contributions for those sections, combined into the final class diary. Internal comments, staff APIs, reports, audit and drafts are inaccessible.
7. Admins schedule school-wide English, Urdu or Arabic quotes by date. Highest priority selects one quote; the current scheduled wording is displayed once in previews and exports. Approval-time quote snapshots remain stored unchanged for audit history. When no quote is scheduled, no invented fallback is shown. Long text wraps without truncation. Quotes do not generate notifications.
8. Reports filter dates, branch, campus, class, section, teacher, subject and status. Counts group expected class diaries rather than creating one final diary for each subject. Historical assignment activation events are respected. Authorized PDF/PNG/print reports are available separately from Audit History.
9. In **Notifications**, enable phone alerts on each supported device through an explicit browser permission request, send a test alert, or disable linked devices. Important alerts remain in-app.

The earlier period/reflection diary records and consent-based communication features remain available; no existing school records or credentials are reset by this update. The former period reminders skip assignments configured for the new class workflow so submitted class diaries are not falsely reported as missing subject diaries.

## Local setup

```sh
npm ci
cp .env.example .env
# Set ADMIN_NAME, ADMIN_EMAIL and a strong ADMIN_PASSWORD in the private .env file.
npm run bootstrap
npm run build
npm start
```

Default URL is http://127.0.0.1:4317. Set `DATA_DIR` to a persistent private directory. Existing local SQLite account tables are upgraded safely to support the Parent role, preserving credentials and references. Use `npm run check`, `npm test` and `npm run build` for verification. Test fixtures are isolated, explicitly marked, and excluded from deployment.

## Cloud configuration and deployment

Keep `.env.cloud`, `.env.provision-state.json`, Vercel credentials and backup keys private and outside version control. Required server configuration: `DATABASE_URL` for the restricted runtime DB role, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `PUBLIC_ORIGIN`, `COOKIE_SECURE=true`, `SESSION_HOURS`, `CRON_SECRET`, `BACKUP_ENCRYPTION_KEY`. Web Push additionally needs `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`.

For a fresh database, apply `cloud/schema.sql`, `cloud/enhancements-schema.sql`, then `cloud/school-schema.sql` with an authorized migration/operator connection; grant the dedicated application role using the documented migration policies. Do not grant browser `anon`/`authenticated` roles access to the private schema. Bootstrap the first Super Admin only once with `npm run bootstrap:cloud`.

Existing databases are upgraded by running `database/upgrade.sql` once; the same change is in `supabase/migrations/`. It is additive and never resets data.

Set production environment variables through Vercel, link the intended team/project, run the checks/build and deploy with `vercel deploy --prod`. New environment variables require a new deployment. The production domain must equal `PUBLIC_ORIGIN` for write-origin checks.

The existing authorized scheduler invokes `/api/cron/deadlines` every 15 minutes and `/api/cron/backup` daily with the private `CRON_SECRET`. Deadline execution also dispatches the push outbox. Quote creation never enqueues push messages. Keep the separate backup encryption key in a protected recovery location.

## Backup and recovery

Cloud backups encrypt all tables and private file bytes and verify storage checksums. Seven-day cloud rotation and the existing attachment/archive size limits apply. The migration also saves a private local recovery copy. `scripts/restore-cloud-check.mjs <archive-name>` rehearses table/FK and file recovery in a temporary schema, revokes sessions and rolls the schema back; it does not cut over production. A real disaster cutover requires a separately verified target and application configuration. SQLite backup/restore commands require a fresh destination and validate database/file checksums and foreign keys.

## Verification and limits

The automated suites cover both HTTP/database runtimes, authentication, CSRF, hierarchy/IDOR isolation, parent publication/redaction/revocation, multi-subject EN/UR diaries, return/resubmit/final Head approval, immutable history, quote snapshots, management CRUD guards, granular deny precedence, reports/exports, migration preservation and push deduplication/invalid endpoints/expired devices. Browser checks cover the teacher → Head → parent path and the actual document renderer. Current run results and production evidence are supplied separately in the completion report.

Web Push delivery requires HTTPS, supported browser/device behavior and explicit permission. A successful mocked push transport is not a claim of physical Android acceptance: actual closed-browser delivery must be checked on the school’s enabled device. See [MDN Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API) and the [web-push project](https://github.com/web-push-libs/web-push).

This release provides the working school-diary basics, not a student-information/attendance/fees platform. Child names are optional labels on parent-class links. Reviews use class-level comments; per-cell inline annotations are not implemented. PNG/PDF exports are rasterized. Physical-device delivery and large-scale load certification are not claimed. All locked dependency versions and licenses remain in the package lock and corresponding packages.

## CRUD repair acceptance

Draft Trash preserves content and versions; restore a discarded same-date draft before editing it. Structure relationships/session dates and assignments can be changed while unused; archive and replace records with history. The review queue includes Submitted, Resubmitted and Under Review. School Admin policies cannot expand beyond the administrator’s own capabilities or modify administrative policies. Main CRUD modules provide separate view/create/edit/delete capabilities; individual denials also protect retained mutation endpoints.

## Force Delete and historical preservation

Authorized Super Admin and School Admin accounts can use the separate **Force Delete** action on users, branches/campuses, academic records (including subjects, classes and sections), teaching assignments, individual diaries and quotes. The `records.force_delete` capability and the entity's existing delete capability are both required. Ordinary staff cannot use the API, even with a forged frontend button.

The impact dialog requires a reason, the exact record name and `FORCE DELETE`; dependencies/history require an additional acknowledgment. Changed dependencies invalidate the confirmation. Transactions retain original rows and foreign keys, deactivate affected operational records, revoke deleted users' sessions and append immutable deletion events containing historical snapshots. Deleted records cannot be reactivated through ordinary edit endpoints. Existing approved diary content, versions, review history, original dates and historical reports remain readable. Directly force-deleted diaries leave current publication lists but retain their historical preview and audit record.

The administrator-only **Deleted records** page provides read-only snapshots, deletion reasons, actor/time and retained diary links. Force Delete is distinct from Archive and ordinary Delete. It does not purge immutable audit/workflow history or global settings, and it has no ordinary restore action. Encrypted backups include the deletion events; no new schema migration is required.

## Teacher campus scope

Teacher Assignments reads the teacher's saved campus ID from `settings.teacherCampusAssignments`. Selecting a teacher automatically shows active classes in that campus, then the configured subjects for the selected sections. Changing teachers clears the old choices. Missing or unavailable campus mappings never fall back to school-wide classes.

Creation, editing and reactivation validate campus ownership on the server, using fresh configuration inside the assignment transaction. Existing historical assignments and diaries remain unchanged. The retained period module's records without a campus model keep their existing behavior; campus-linked records cannot bypass the rule through its older endpoints. Authorized administrators with `assignments.edit` can provision a mapping through `PUT /api/school/teacher-campuses/:teacherId` with `campus_id` and `expected_campus_id` (null for a first mapping). Changes are audited, stale mappings are rejected, and ordinary school-settings updates preserve these mappings. Backups already include this existing settings record.

## Reliability and operational audit — 5 November 2026

Both HTTP adapters share byte-limited JSON parsing, preserving Unicode split across network chunks and rejecting non-object request bodies. Pagination is validated before queries. The browser transport has a 45-second request deadline, clear network errors and no automatic write retries. Forms prevent overlapping submissions and restore disabled controls correctly.

List/report/dashboard queries omit repeated branding in SQL while detail and export queries retain the full original snapshots. Diary lists use a fresh batched hierarchy predicate for each operation, preserving current role/assignment scope while avoiding permission and deletion queries per diary. No authorization decision is cached across requests. Settings/template forms submit their loaded version; stale versions return 409. Publication preserves fresh teacher campus mappings and academic-session choices.

Teacher campus setup is available on Teacher Assignments to authorized administrators with assignments.edit. The API validates an active Teacher, an active Campus and its active Branch, and requires the previous saved campus ID for optimistic concurrency. Existing assignments and historical diaries are preserved. New assignment choices refresh after campus setup.

Cloud backups use AES-256-GCM and read existing ESSB1 archives. New ESSB2 archives store repeated data-URI branding once and restore the exact original historical JSON strings. Both creation and recovery enforce a 256 MB uncompressed payload limit; hosted archives also retain the existing 48 MB compressed/encrypted limit. This supports the current larger historical snapshots without unbounded decompression. Scheduled backup outcomes are recorded as cloud_backup_completed or cloud_backup_failed in Audit History. Hosting quota restrictions return an actionable 503 error. Resolve provider restrictions before relying on scheduled hosted backups; a successful database/cron query alone does not verify storage availability.

## Diary notices

Super Admin and School Admin manage notices under **Diary notices**; other staff can be given the separate *Diary notices* permissions (view, add, edit/publish, delete) in Permissions. Each notice has its own classes (or all classes), language, and dates. A class shows up to 3 published notices on the same day, 600 characters in total, so the diary still fits one A4 page. Notices are stored in the school settings, so no database change is needed; a notice saved by an earlier version becomes an all-classes notice.
