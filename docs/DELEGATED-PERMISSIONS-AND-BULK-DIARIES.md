# Delegated permissions and bulk diaries

Coordinator and Head Teacher accounts can use explicitly granted operational capabilities for Daily Quotes, School Structure, Teacher Assignments (including campus setup), and Parent Access. Capabilities and individual denials remain checked on the server. Account creation/management, hierarchy mutation, permission administration, full audit administration and Force Delete retain their existing administrator boundaries; no user grants are changed by deployment.

Daily Quotes honors view/create/edit/delete grants, including the compatibility manage grant. Quotes created by an authorized Coordinator or Head Teacher can be selected for approval snapshots; historical approved quote snapshots remain unchanged.

The Review queue and Original teacher submissions provide a checkbox per record, Select all on this page, a selected count and permission-dependent operations:

- Approve, return with required comments, or start review.
- Submit eligible authored drafts/returned diaries.
- Move unsubmitted drafts to Trash and restore them, preserving diary/version history. Explicitly authorized supervisors can manage drafts in their accessible hierarchy.
- Request an amendment to approved diaries with a required reason. This uses the normal correction/reapproval workflow.
- Export selected diaries as PDF, PNG or JPG. Approved consolidated class diaries provide selected exports; their individual teacher contributions are managed through the Review queue or Original teacher submissions.

Selection applies to the visible page (up to 30 records), rather than silently including unseen results. Browser requests process ten selected diaries at a time, sequentially. The API accepts up to 50 unique diary IDs with current versions per request.

Single-record and bulk transitions use the same operation implementation. Every record independently validates permissions, author/reviewer scope, current version, lifecycle state and force-delete status. Successful operations commit their usual immutable history and notifications. Failures leave the affected diary unchanged and appear in per-record results. A stale or inaccessible record does not erase successful results. Concurrent/repeated approvals cannot add a second approval to the same version.

Mutations require confirmation. Cancellation performs no writes. Duplicate button clicks are locked while processing, and network failures are never automatically retried. Use Refresh list after an interrupted operation to reload current versions before retrying.

No schema migration or production diary mutation is required to deploy the feature. Automated acceptance uses disposable SQLite and PostgreSQL/PGlite databases. Manual browser verification covers Head Teacher quote access, select-all approval of two pending diaries, and the responsive consolidated export toolbar at 390px.
