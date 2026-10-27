# Dairy Farm Production and Health

A mobile app for one farmer to keep records for a dairy farm in Zambia: herd, milk production,
animal health, breeding, vaccination, sales, stock, expenses and reports. It works offline and
syncs when there is a connection.

**Status:** All 8 stages are built and tested (182 API and 123 mobile automated tests passing). The API is deployed as a Supabase Edge Function. Before release, run the manual device checks in [docs/testing.md](docs/testing.md). See [Stages](#stages).

## Repository layout

| Path | What |
|---|---|
| `apps/mobile` | React Native + Expo (SDK 58) + TypeScript app, Expo Router, routes in `src/app` |
| `apps/api` | Hono TypeScript REST API: auth, owner scoping, business rules. Runs as a Supabase Edge Function (or on Node locally) |
| `supabase/functions/api` | The built Edge Function (`npm run build:edge`, generated; do not edit) |
| `supabase/migrations` | PostgreSQL schema (applied to the hosted project) |
| `docs/` | [design](docs/design.md), [API contract](docs/api-contract.md), [data model](docs/data-model.md), [testing record](docs/testing.md), [operations](docs/operations.md) (deploy, builds, backup/restore, monitoring, deletion, support), [privacy](docs/privacy.md), [farmer guide](docs/farmer-guide.md) |
| `.github/workflows/ci.yml` | Typecheck, tests, bundle check; manual EAS build |

## Architecture decisions

| Decision | Choice |
|---|---|
| Backend | The API holds all business rules. Supabase provides managed Postgres, Auth and private Storage, and runs the API as an Edge Function, so there is one platform to operate. |
| Data access | Only the API reaches the tables. The Supabase Data API is locked out (RLS on, no policies, grants revoked). |
| Sign-in | Supabase Auth with email and password. Email verification and password reset use 6-digit codes typed in the app (no deep links). Email is sent through Resend SMTP. |
| App lock | Optional. Uses the phone's fingerprint, face or screen lock (expo-local-authentication). Locks on launch and after 5 minutes in the background. |
| Owner scoping | `owner_id` comes only from the verified token, through `farmer_accounts.auth_user_id`. |
| Offline | expo-sqlite local copy with an outbox queue, built in Stage 3 and reused by later modules. Client UUIDs and idempotency keys make retries safe. Details are in the [data model](docs/data-model.md#offline-copy-on-the-phone-expo-sqlite). |
| Animal ID | Each animal has a permanent UUID. The farmer sees the first 6 characters (e.g. `3F9A2C`), which exist offline and never change. |
| Photos | One per animal. Resized to 1280 px JPEG on the phone, uploaded separately with progress through signed URLs, and stored in a private bucket. |
| Conflicts | `version` column with `If-Match`. A mismatch returns 409 and the app shows both versions. Financial and stock rows are append-only. |
| Milk sessions | morning, afternoon, evening. One valid entry per animal, date and session. |
| Milk entry | A milking round (one session, the whole herd, saved at once), plus single entries |
| Corrections | Corrected in place with a required reason, with the old value kept in the audit log. A void keeps the entry but stops it counting |
| Milk stock | The ledger starts with production in Stage 4. Only eligible milk (not under withdrawal) enters saleable stock |
| Withdrawal | Recording, correcting or removing a withdrawal re-checks milk already entered in its window: entries are re-marked and stock adjusted automatically, with an audit trail |
| Breeding intervals | Set by the farmer: pregnancy check after 35 days and gestation of 283 days to start with, labelled "confirm with your vet". A vet's expected calving date always wins |
| Notifications | Worked out on the phone from the records. An in-app **Notifications** inbox (bell with unread count in the tab headers) lists everything: withdrawals, vaccinations, pregnancy checks, calvings, follow-ups, clearance, unpaid balances, stock below zero, falling milk and sync problems. The same items are scheduled as local phone notifications (expo-notifications): dated reminders at the farmer's reminder time, problems once each while they last, sync problems within a minute. No server push for now |
| Care records | One generic lifecycle on the API and one field-driven form on the phone, for health, vet visits, treatments, breeding, pregnancy checks, calvings, vaccinations and schedules |
| Sales offline | Allowed. The phone checks stock first, and the server checks again on sync. A sale the server rejects goes to Sync issues with a "make a stock adjustment" action |
| Prices | A listed price per currency with dated history. A sale can use a special price, recorded as an override. The server computes every total |
| Payments | Applied to the oldest unpaid sales first, with any extra kept as credit. Refunds and write-offs need a reason and are limited to the credit or the amount owed |
| Corrections | A sale correction voids the original and records a linked corrected sale. Voids, corrections, adjustments and price changes are all audited and visible under Audit history |
| Reports | Built on the phone from synced records, so they work offline. Six report groups with filters, definitions and missing-record warnings. CSV and PDF are made on the phone (expo-print, expo-sharing) and shared after a warning. Every export is written to the audit history |
| Dashboard | Home shows needs attention, herd, milk, and sales and money for a chosen period, with charts and coming-up items. Every tile opens its details |
| Production alerts | By default, the last 7 days vs the 7 before, flagged at −20% with at least 4 days of records in each. The farmer can change this in settings |
| Database | Supabase project `dairy-farm`, eu-central-1 (Frankfurt), free tier |
| API hosting | Supabase Edge Function `api` on the `dairy-farm` project: `https://xgdhqmlkjfhcfjkmrqrx.supabase.co/functions/v1/api`. Steps are in [operations.md](docs/operations.md#deploying-the-api) |
| Account deletion | An operator script erases all of a farmer's records, photos and sign-in after their request, and keeps an anonymous receipt |
| Backups | Nightly `pg_dump`, checked and AES-256 encrypted, kept 30 days (`.github/workflows/backup.yml`), plus a monthly restore test |

## Development setup

Requirements: Node 24+, npm 11+, the Expo Go app on a phone (or an Android emulator or iOS simulator).

### API

```bash
cd apps/api
cp .env.example .env    # DATABASE_URL, SUPABASE_URL, SUPABASE_SECRET_KEY (server only)
npm install
npm test                # builds the Edge Function, then tests on PGlite (in-process Postgres with all migrations); no DB needed
npm run test:postgres   # the same tests through postgres.js, the driver the Edge Function uses
npm run dev             # local Node server: http://localhost:3000/health
npm run build:edge      # rebuild supabase/functions/api/index.js after changing src/
```

### Mobile

```bash
cd apps/mobile
cp .env.example .env    # Supabase URL + publishable key, API URL
npm install
npx expo start          # scan the QR code with Expo Go
npm test                # offline-sync tests: real store/engine on node:sqlite, fake API
npm run lint
```

`EXPO_PUBLIC_API_URL` points at the deployed Edge Function. To use a local API on a real phone instead, set it to your
computer's LAN address (e.g. `http://192.168.1.20:3000`), not `localhost`. The phone and computer must be on the same Wi-Fi.

### Supabase Auth settings (one-time, in the dashboard)

1. **Authentication › Sign In / Providers › Email:** turn on *Confirm email*. Set *Minimum password length* to 8.
2. **Authentication › Emails › SMTP Settings:** turn on custom SMTP with Resend. Host `smtp.resend.com`,
   port `465`, user `resend`, password = your Resend API key, sender = an address on your verified Resend domain.
3. **Authentication › Emails › Templates:** the app needs the code (`{{ .Token }}`), not a link:
   * *Confirm signup*: subject `Your Dairy Farm code`, body `<p>Your confirmation code is <strong>{{ .Token }}</strong>. It expires in 1 hour.</p>`
   * *Reset password*: subject `Your Dairy Farm reset code`, body `<p>Your password reset code is <strong>{{ .Token }}</strong>. If you did not ask for this, ignore this email.</p>`
4. **Authentication › Rate Limits:** keep the defaults. They limit sign-in, sign-up and code requests per IP.

Use `npx expo install <pkg>` to add packages, so versions match the Expo SDK.

### Database

The schema is applied to the hosted project. To recreate it on a new project, run the migration
files in `supabase/migrations` in order (with the Supabase CLI, `supabase db push`, or by pasting them into the SQL editor).

## Builds

EAS profiles are in `apps/mobile/eas.json` (`development`, `preview` (APK), `production`). To build
from CI, add an `EXPO_TOKEN` repository secret and run the CI workflow manually with `eas_profile`.
Locally: `npx eas-cli build --profile preview --platform android`.

## Environments

`development` (local API + hosted dev DB), `staging` and `production` are separate Supabase projects
with separate API deployments. Secrets live only in the API's environment. The app only receives the
Supabase URL and publishable key, which are public by design.

## Stages

| # | Stage | Status |
|---|---|---|
| 1 | Foundation: schema, API contract, app shell, accessibility baseline, CI | ✅ Done |
| 2 | Identity and onboarding: sign-up/in, email codes, reset, onboarding, settings, app lock, sync status, deletion request | ✅ Done |
| 3 | Animals: register, search and filter, profile with timeline, photos, status changes, breeds, offline outbox sync, sync issues | ✅ Done |
| 4 | Production: milking round, single entry, corrections and voids, withdrawal restriction, stock ledger, summaries, charts, decline alerts | ✅ Done |
| 5 | Animal care: health, vet visits, treatments and withdrawal, breeding, pregnancy, calving (with calf registration), vaccinations (single, group, schedules), reminders and notifications | ✅ Done |
| 6 | Customers and finance: customers and statements, prices, sales with an oversell guard, payments and credit, stock reconciliation and milk use, expenses with receipts, money summary, audit history | ✅ Done |
| 7 | Dashboard and reports: dashboard with charts, six reports with filters and definitions, CSV/PDF export with share warning and audit log | ✅ Done |
| 8 | Hardening and release: owner-isolation sweep of every route, security headers and limits, account erasure, integrity checks, accessibility scan, permission texts, backup workflow, deployment and build guide, testing record, privacy notice, farmer guide | ✅ Done (manual device checks and deployment are left to you) |
