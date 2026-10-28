# Testing record

Recorded on **27 Oct 2026** (Stage 8). Automated tests run with `npm test` in `apps/api` and `apps/mobile`, and in CI on every push.

## Automated results

| Suite | What it runs against | Tests | Result |
|---|---|---|---|
| API (`apps/api`) | The real API, with every migration applied, on PGlite (an in-process PostgreSQL). Only sign-in tokens and file storage are faked | **187** | **187 passed, 0 failed** |
| API through postgres.js (`npm run test:postgres`) | The same tests, with PGlite reached over a Postgres socket by postgres.js, the driver the Edge Function uses | **187** | **187 passed, 0 failed** |
| Mobile (`apps/mobile`) | The real sync store, sync engine and calculations, on Node's built-in SQLite. The HTTP API is faked | **129** | **129 passed, 0 failed** |

Mutation checks: for each critical rule, the code was broken on purpose to confirm a test fails. All were caught, and the code was then restored.
* Breeding counted as pregnancy.
* The withdrawal re-check switched off.
* The morning session moved to 11:00.
* Correcting a milk entry no longer adjusting stock.
* Refunded money being reusable as credit.
* The back-dated oversell check removed.

| API file | Tests | Covers |
|---|---|---|
| `app.test.ts` | 8 | Health check, token required, forged token, owner taken only from the token, no internal details in errors, cache and nosniff headers, oversized bodies and invalid JSON refused, rate limit per client |
| `notifications.test.ts` | 4 | Inbox read marks: shared across phones, safe to send twice, one farmer only, `since` filter, bad input refused, sign-in required |
| `auth.test.ts` | 5 | Supabase token verification: a valid token is accepted; tokens from another project, for a non-user audience, expired, or signed with another key are refused |
| `account.test.ts` | 2 | Settings stored as JSON objects (not strings), with a version bump and audit; default breeds created once |
| `edgeBundle.test.ts` | 3 | The built Edge Function file itself, under a stand-in for Deno, over postgres.js: health, readiness, 401s, and account, animal, milk, customer, price and sale end to end with a safe retry |
| `profile.test.ts` | 13 | Profile and onboarding updates, If-Match conflicts, validation, deletion request |
| `animals.test.ts` | 21 | Registration, duplicate ear tags, idempotent retries, parents, status changes, deletion rules, photos, sync paging, audit |
| `milk.test.ts` | 17 | Sessions and the daily sum, duplicates, limits, corrections and voids with stock, withdrawal restriction, timeline |
| `care.test.ts` | 22 | Withdrawal re-check, breeding → pregnancy only by exam, calving with calf, vaccination next dose and groups, removal, isolation |
| `finance.test.ts` | 18 | The four spec money and stock scenarios, idempotent sales, overrides, currencies, oversell (including back-dated), oldest-first allocation and credit, refunds and write-offs, voids, stock reversals, expenses and receipts, export log |
| `isolation.test.ts` | 68 | Farmer B tries **every** route that takes an id, every link to A's records, every sync pull and every list. All denied, and A's records are left unchanged |
| `erasure.test.ts` | 3 | Deletion refused without a request. Erasure removes everything of one farmer (append-only tables included), leaves other farmers untouched and keeps an anonymous receipt. Guards stay on afterwards |
| `integrity.test.ts` | 3 | A month of real use (corrections, voids, re-checks, refunds, reversals) passes every cross-table check, and a tampered ledger is detected |

| Mobile file | Tests | Covers |
|---|---|---|
| `palette.test.ts` | 42 | WCAG AA contrast of every text/background pair in the light and dark palettes, and 3:1 for chart marks |
| `sync.test.ts` | 15 | Offline save, then one sync with no duplicates. A lost response plus an app restart. Resending an in-flight op. Folding edits. Version chaining. Rejections blocking only their own record. Conflicts (keep mine / use saved). Pull never overwriting unsent edits. Remote deletions |
| `calc.test.ts` | 14 | Exact litres, periods, totals, averages, breeds, high/low, decline rule |
| `finance.test.ts` | 13 | Sale totals, price lookup, balances, unsynced payments, stock ledger and oversell, reconciliation, duplicate customers, money summary |
| `reminders.test.ts` / `plan.test.ts` | 10 / 10 | Vaccination due in 7 days, overdue, withdrawal until the vet's time, clearance, pregnancy checks, calving, follow-ups. Notification times, preferences and the 60-notification limit. Problems (unpaid balance, falling milk, sync) notify once at the reminder time or within a minute, are not repeated, notify again only after clearing, and respect the switches |
| `forms.test.ts` | 7 | Care form rules and prefills (withdrawal end time, expected calving, next dose, calf registration) |
| `financeReminders.test.ts` | 2 | Unpaid balances, stock discrepancy flagged without auto-correction |
| `reports.test.ts` | 10 | All six reports, filters, needing-attention, CSV quoting and formula guard, HTML escaping |
| `accessibility.test.ts` | 6 | Every pressable has a role. Every text input, switch and image has a spoken label. No empty button labels |

## Spec §17 core scenarios

| # | Scenario (spec §17) | Automated evidence | Result |
|---|---|---|---|
| 1 | Create account, onboarding, recovery; all records belong to the signed-in farmer | `profile.test.ts`, `app.test.ts`, `isolation.test.ts`. Sign-up and recovery codes are Supabase Auth: see manual check M1 | Pass (automated part) |
| 2 | Register animal: stable ID, searchable, duplicate ear tag rejected online and during sync | `animals.test.ts` (ear tag, client id), `sync.test.ts` ("flags a duplicate ear tag…") | Pass |
| 3 | 12 L morning + 8 L afternoon = 20 L, correct grouping | `milk.test.ts`, `calc.test.ts`, `reports.test.ts` | Pass |
| 4 | 10 L @ ZMW 10 = 100; price → 12 gives 120; old sale stays 100 | `finance.test.ts` (API) and `finance.test.ts` (mobile) | Pass |
| 5 | 60 paid on 100 → 40; later 40 → 0; revenue and receipts distinct | `finance.test.ts` (both) | Pass |
| 6 | 100 + 50 − 30 − 5 = 115; oversell blocked pending justified adjustment | `finance.test.ts` (both) | Pass |
| 7 | Withdrawal: warning and ineligible until the end time, even if treatment is complete | `milk.test.ts`, `care.test.ts`, `reminders.test.ts` | Pass |
| 8 | Vaccination due in 7 days: upcoming, overdue, offline local reminder | `reminders.test.ts`, `plan.test.ts`. Delivery on a phone: M6 | Pass (automated part) |
| 9 | Breeding without exam → not pregnant; exam sets status | `care.test.ts` | Pass |
| 10 | Correct completed sale: reason, original and corrected values, timestamp in audit | `finance.test.ts` (API) | Pass |
| 11 | Offline: add production and payment, restart, reconnect; sync once, no loss or duplication | `sync.test.ts` | Pass |
| 12 | Conflicting edits and rejections: clear resolution, financial and stock history kept | `sync.test.ts`, `animals.test.ts`, `finance.test.ts`, `integrity.test.ts` | Pass |
| 13 | Another owner's ids denied; exports owner-scoped | `isolation.test.ts` (68 checks), `finance.test.ts` (export log) | Pass |
| 14 | Screen reader labels, contrast, text scaling, touch targets, errors, date and number entry | `accessibility.test.ts`. Contrast is validated in the theme. The rest: M3–M5 | Pass (automated part) |

## Other checks run in Stage 8

| Check | Result |
|---|---|
| `npm audit --omit=dev` (API) | 0 vulnerabilities |
| `npm audit --omit=dev` (mobile) | 6 high, all in Expo's command-line tooling (`@expo/cli`: `zod`, `node-forge`), which runs on the developer's machine and CI, not inside the app. The suggested fix is a downgrade to SDK 44, so it is not applied. Re-check with `npx expo install --check` when Expo patches SDK 58 |
| Integrity checks (`npm run integrity`) on the hosted dev database | All 6 pass, but the database was **empty** (no farmer accounts). See the note below |
| Supabase security advisor | Only the expected "RLS enabled, no policy" notices. They are intended, because the Data API is locked out |
| expo-doctor | 20/20 |
| Bundles | Android and iOS export successfully |
| API production build | `npm run build` compiles, and `dist` loads |

**Note on the hosted database:** on 27 Oct 2026 the dev project `dairy-farm` had no accounts or records. So the phone testing so far did not go through this project's API. The Edge Function was deployed on 27 Oct 2026: `/health`, `/health/ready` (database reached) and 401 for missing or forged tokens were checked against it. Signed-in use has not been exercised against the deployment yet: run M2.

## Manual device checks

Fill in on real phones before release. Record the device, OS version, date, result and any notes.

| # | Check | Android (device, OS) | iPhone (device, iOS) |
|---|---|---|---|
| M1 | Sign up with the email link, sign in, wrong password, password reset by link (opened on the same phone, and once on another device to see the clear refusal), change password in Security, sign out; a new phone sees the same data | | |
| M2 | **End to end against the deployed API**: register cows, milk round, treatment with withdrawal, sale with part payment, later payment, export a PDF. Then run `npm run integrity` on the database | | |
| M3 | TalkBack / VoiceOver: every screen readable, buttons announced, errors read out | | |
| M4 | Largest system text size: nothing cut off on Home, New sale, Milking round and Reports | | |
| M5 | Small screen (about 5"), and a one-handed reach check on the main actions | | |
| M6 | Notifications: permission prompt, a vaccination reminder arrives offline, and a withdrawal-end notification arrives | | |
| M7 | Airplane mode: milking round, sale, payment. Kill the app, reopen, reconnect. Records sync once and the status updates | | |
| M8 | Denied camera, photos and notification permissions: the app explains and keeps working | | |
| M9 | Two phones with the same account editing the same animal: the conflict appears in Sync issues | | |
| M10 | App lock: turn on, background more than 5 minutes, unlock with biometrics or passcode | | |
| M11 | CSV opens in Excel / Google Sheets with correct columns. The PDF is readable when printed | | |
