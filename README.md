# Elite Scholars School Daily Diary — Vercel-ready

Teachers write the daily homework diary → Head Teachers review and approve → parents see only the approved class diary (A4 PDF/PNG/print). Roles: Super Admin, School Admin, Coordinator, Head Teacher, Teacher, Parent.

The project root is the app. In Vercel leave **Root Directory** empty, **Framework Preset = Other**; `vercel.json` already sets the build and output.

## Deploy (about 10 minutes)

1. **Database** – in Supabase create a project. Open *SQL Editor*, paste all of `database/setup.sql` and run it once.
2. **Connection string** – Supabase → *Connect* → *Transaction pooler* URI (port 6543). Replace the password placeholder.
3. **Vercel** – import this project, then add *Environment Variables*:

| Name | Value |
|---|---|
| `DATABASE_URL` | the pooler URI from step 2 |
| `COOKIE_SECURE` | `true` |
| `SESSION_HOURS` | `8` |
| `CRON_SECRET` | any random 32+ characters (enables the daily jobs) |
| `SETUP_TOKEN` | any random 16+ characters (used once, below) |
| `PUBLIC_ORIGIN` | your final site address, e.g. `https://diary.elitescholars.edu.pk` (optional until you add a custom domain) |

   Optional: `SUPABASE_URL` + `SUPABASE_SECRET_KEY` (file attachments), `BACKUP_ENCRYPTION_KEY` (64 hex characters; enables the daily encrypted backup), `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` (phone notifications).
4. **Deploy**, open the site. A **First-time setup** screen appears: enter your `SETUP_TOKEN` and create the Super Admin. It never appears again once an admin exists.
5. Sign in → *School structure* (branches, campuses, classes, sections) → *Subjects* → *User management* (campus and hierarchy) → *Teacher assignments*.

If something is missing, the site itself tells you which value to add (it checks `/api/health`).

## GitHub → Vercel (automatic deploys)

```bash
git init -b main
git add .
git commit -m "Elite Scholars daily diary"
git remote add origin https://github.com/<your-user>/<your-repo>.git
git push -u origin main
```

In Vercel choose **Add New → Project → Import Git Repository**, pick the repo, keep **Root Directory** empty and **Framework Preset = Other**, add the environment variables above, then **Deploy**. From then on every `git push` to `main` deploys to production and every other branch gets a preview URL. Never commit `.env` files (they are git-ignored).

## Phone and desktop notifications

1. Generate keys once: `npx web-push generate-vapid-keys`. Add `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (`mailto:you@school.edu.pk` or your site URL) in Vercel and redeploy.
2. After sign-in the app links the device automatically. Browsers always require one permission tap, so the first tap or key press after sign-in (or the **Allow notifications** banner) raises the browser prompt. Once allowed, the device is re-linked on every sign-in and app open.
3. Alerts are pushed as soon as a diary is submitted, returned or approved. Deadline reminders still run from the cron job (daily on Hobby).
4. iPhone and iPad need the app added to the Home Screen first (Share → Add to Home Screen), iOS 16.4 or later.

## Upgrading an existing database
If your Supabase database was already set up with an earlier version, do **not** re-run `setup.sql`. Database changes are versioned in `database/migrations/` and applied once each by `npm run migrate` (it also runs during `npm run build` on Vercel). Set `MIGRATION_DATABASE_URL` to the database owner's connection string, in Vercel (Build) or in `.env.cloud`; without it, migrations are skipped. Until a migration is applied, features that need it (photos/PDFs in Communication, the Super Admin's temporary-password view) fail while everything else works.

## Communication
Chats show people's names, support photos and PDFs (up to 2 MB; photos are shrunk automatically) and a **call** button. A call posts a "Join call" card in the chat that opens a private Jitsi Meet room (meet.jit.si) in a new tab; no extra server or key is needed.

## What runs automatically

- Deadline and review reminders, plus the push outbox, run daily from `vercel.json` (Hobby plan limit: once per day). For every-15-minute reminders use Vercel Pro, or Supabase `pg_cron` calling `/api/cron/deadlines` with `Authorization: Bearer <CRON_SECRET>`.
- A daily encrypted backup runs when `BACKUP_ENCRYPTION_KEY` and Supabase storage are configured; otherwise it is skipped without errors.
- Teacher assignments, default reviewer, quote of the day and the parent-visible combined diary are all derived from the saved structure — nothing is re-typed per day.

## Local use and tests

`npm ci && npm run check && npm test && npm run build` (Node 24). The full application documentation is in `docs/APPLICATION-GUIDE.md`; operations notes are in `docs/`.
