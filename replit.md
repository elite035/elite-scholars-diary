# Running this project on Replit

## Start the app

The **Start application** workflow runs the Node.js app on port 5000. To start it manually, use:

```sh
PORT=5000 HOST=0.0.0.0 npm start
```

The local app uses SQLite and creates its database under `var/`; a Supabase connection is not required.

## First-time administrator setup

Before creating the first account, add a `SETUP_TOKEN` secret in Replit's Secrets tool. Use a randomly generated value with at least 16 characters, then restart the app. The first-time setup screen accepts that token along with the Super Admin's name, email, and a password of at least 12 characters. Once an account exists, the first-time setup screen is disabled.

For local setup through the command line instead, set `ADMIN_EMAIL`, `ADMIN_NAME`, and `ADMIN_PASSWORD` (at least 12 characters) as environment secrets and run `npm run bootstrap`.

## Checks

```sh
npm run check
npm test
npm run build
```
