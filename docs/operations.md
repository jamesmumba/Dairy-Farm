# Operations guide

How to deploy, build, back up, restore, monitor and support the Dairy Farm app.

## Environments

| | Database / Auth / Storage | API | App build |
|---|---|---|---|
| Development | Supabase project `dairy-farm` (eu-central-1) | Edge Function `api` on `dairy-farm` (or `npm run dev` on a laptop) | Expo Go or a development build |
| Staging | A second Supabase project | Edge Function `api` on that project | EAS `preview` profile (internal APK / TestFlight) |
| Production | A third Supabase project (a paid plan is recommended, for managed backups) | Edge Function `api` on that project | EAS `production` profile (Play Store / App Store) |

Apply the migrations in `supabase/migrations` in order to each new project: `supabase db push`, or the SQL editor. Never point staging or development at production data.

## Secrets and configuration

| Where | Variable | Notes |
|---|---|---|
| Edge Function | `SUPABASE_URL`, `SUPABASE_DB_URL`, `SUPABASE_SECRET_KEYS`, `SUPABASE_JWKS` | Provided by Supabase to every function. **Nothing to set by hand** |
| Local API / scripts | `DATABASE_URL` | Session pooler or direct connection. Secret |
| Local API / scripts | `SUPABASE_URL` | Public |
| Local API / scripts | `SUPABASE_SECRET_KEY` | Secret key (`sb_secret_…`). It signs photo URLs and deletes sign-ins in the erasure script. **Never in the app** |
| Local API | `PORT`, `HOST`, `TRUST_PROXY` | Defaults: 3000, 0.0.0.0, false. Set `TRUST_PROXY=true` only behind a proxy that sets `X-Forwarded-For` |
| App (EAS env) | `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `EXPO_PUBLIC_API_URL` | Public by design. Set per environment with `npx eas-cli env:create`. The app refuses to start without them |
| GitHub | `EXPO_TOKEN`, `BACKUP_DATABASE_URL`, `BACKUP_PASSPHRASE` | Repository secrets |

`.env` files are git-ignored and excluded from the Docker image.

## Supabase settings (each project, once)

1. Authentication › Email: *Confirm email* on, minimum password length 8.
2. Authentication › SMTP: Resend (host `smtp.resend.com`, port 465, user `resend`, password = Resend API key, a sender on the verified domain).
3. Authentication › Email templates: *Confirm signup* and *Reset password* show `{{ .Token }}` (see README).
4. Storage: the `animal-photos` and `receipts` buckets are created by the migrations as private, 2 MB, JPEG/PNG.
5. Database › Backups: check the schedule your plan provides. See below.

## Deploying the API

The API runs as the Supabase Edge Function `api`, so the database, sign-in, storage and API are all on one platform.
`apps/api/src/edge.ts` is the entry point. `npm run build:edge` bundles it with the API into
`supabase/functions/api/index.js` (one file; npm packages load as pinned `npm:` imports). `npm test` rebuilds it
first, and `test/edgeBundle.test.ts` runs that exact file, so commit it together with the source. CI fails if the
committed copy is out of date.

```bash
cd apps/api
npm test                                   # rebuilds and tests the bundle
npx supabase login                         # once
npx supabase functions deploy api --project-ref <project-ref> --no-verify-jwt
```

`--no-verify-jwt` is required: the API verifies tokens itself (against the project's ES256 signing keys), and
`/health` must answer without one. The function is served at `https://<project-ref>.supabase.co/functions/v1/api`.

After deploying:
1. `curl https://<project-ref>.supabase.co/functions/v1/api/health/ready` returns `{"status":"ok","database":"ok"}`,
   and `/v1/me` without a token returns 401.
2. Set `EXPO_PUBLIC_API_URL` to that address in the EAS environment.
3. Run `npm run integrity` against the database.
4. Do manual check M2 in `docs/testing.md`.

Logs: Supabase dashboard › Edge Functions › `api` › Logs. Errors are logged there; responses never include
internal details.

**Running on Node instead (optional).** The same app runs as a Node server (`src/server.ts`, `npm run dev`, or the
Dockerfile, which runs as a non-root user and stops cleanly on SIGTERM). Use it for local development, or if the API
ever needs a long-running host.

## Building the app

```bash
cd apps/mobile
npx eas-cli login
npx eas-cli build --profile preview --platform android     # installable APK for testers
npx eas-cli build --profile production --platform all      # store builds
npx eas-cli submit --profile production --platform android # or ios
```
* iOS builds need an Apple Developer account. Android store release needs a Google Play Console account.
* Version numbers are managed remotely by EAS (`appVersionSource: remote`, auto-increment on production). Raise `expo.version` in `app.json` for each user-visible release.
* The permission texts (camera, photos, Face ID) are set in `app.json`. Unused Android storage and microphone permissions are blocked.
* CI can start builds: run the *CI* workflow manually with `eas_profile`.

## Backups and restore

**Managed:** Supabase paid plans take daily backups, with point-in-time recovery as an add-on. The free plan does not offer downloadable backups, so use the workflow below in any case.

**Encrypted nightly dump:** `.github/workflows/backup.yml` runs at 02:30 Zambia time. It:
1. runs `pg_dump` of the `public` and `auth` schemas
2. checks the dump is readable (`pg_restore --list`)
3. encrypts it with AES-256 (`gpg --symmetric`)
4. keeps it for 30 days as a private workflow artifact.

A failed run sends GitHub's failure email to the repository owner. That email is the completion monitor: investigate any failure the same day. Keep `BACKUP_PASSPHRASE` in a password manager as well. Without it, backups cannot be read.

**Restore** (into a new, empty project, never over live data unless recovering from a disaster):
```bash
gpg --decrypt dairy-YYYY-MM-DD.dump.gpg > dairy.dump
pg_restore --no-owner --no-privileges --clean --if-exists --dbname "$TARGET_DATABASE_URL" dairy.dump
```
Then point a staging API at it, run `npm run integrity`, and sign in with a test account.

**Restore test:** monthly, and after any schema change. Restore the latest backup into a scratch project, run `npm run integrity`, and record the date and result in a log. Photos are in Storage, not in the dump: export them with the Supabase dashboard or CLI if a full copy is needed.

## Monitoring

| What | How | How often |
|---|---|---|
| API up | The host's health check on `/health` | Continuous |
| Errors | API logs (JSON). Authorization headers are redacted, and clients never see internal errors | Daily glance |
| Data integrity | `npm run integrity` (exit code 1 on any error; warnings are negative stock days to investigate) | Weekly, and after incidents |
| Backups | Backup workflow failure email | Daily |
| Security advisor | Supabase dashboard › Advisors | After each migration |
| Dependencies | `npm audit --omit=dev` (API), `npx expo install --check` (app) | Monthly |

## Processing an account deletion request

Farmers request deletion in the app (More › Delete account). This sets `deletion_requested_at` and writes an audit entry.

1. Contact the farmer by email. Confirm the request, and remind them to export any records they want to keep (Reports › Share CSV/PDF).
2. Find the account id. In the SQL editor: `select id, deletion_requested_at from public.farmer_accounts where deletion_requested_at is not null;`
3. Dry run: `cd apps/api && npm run erase-account -- <id>`. This shows the request date and the number of stored files.
4. Erase: `npm run erase-account -- <id> --confirm`. In one transaction it:
   * deletes every database row of that farmer, including append-only audit, stock and money records (the guards are lifted for that transaction only)
   * writes an anonymous receipt to `public.account_deletions`.

   Then it removes the farmer's photos and receipts, and finally their sign-in, which ends all their sessions. If a later step fails, run the same command again.
5. Tell the farmer it is done. Backups age out within 30 days.

## First farmer account

There is no admin console. The farmer installs the app, signs up with their email, confirms the 6-digit code, and completes onboarding. Their account and default breeds are created automatically on first sign-in. To help them start, suggest:
* set the milk price (Sales › Milk prices)
* record an opening stock balance (Sales › Milk stock › Opening balance)
* register the herd.

## Support

* Questions go to the support email given in the store listing. Ask for the phone model, app version and what they saw, never their password.
* Sync problems: ask the farmer to open More › Sync issues. Every rejected change is listed there with its reason and the actions available.
* Data questions: the audit history (More › Audit history) shows every correction, void, price change, adjustment and export with its reason.
