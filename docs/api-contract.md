# API contract (v1)

The Fastify API in `apps/api` is the only way the app reads or writes farm data. The Supabase
Data API is locked out: RLS is on, there are no policies, and grants are revoked for `anon` and
`authenticated`. The app talks to Supabase directly only for **Auth** (sign-in, refresh, recovery)
and, from Stage 3, for **Storage** uploads through short-lived signed URLs that the API issues.

## Conventions

| Topic | Rule |
|---|---|
| Base path | `/v1`. `GET /health` is the only unauthenticated route. |
| Auth | `Authorization: Bearer <Supabase access token>`. The API verifies it against the project JWKS and sets `owner_id` from the token. Any `owner_id` in a body, query or header is ignored. |
| JSON | `snake_case` keys, matching the database columns. |
| Decimals | Money and litres are **strings** with fixed precision (`"100.00"`, `"12.50"`), never JSON numbers. Litres use 2 dp, money uses 2 dp, unit price uses 2 dp. |
| Dates | Business dates are `YYYY-MM-DD`. Event times are ISO 8601 with offset. |
| IDs | UUIDs. The app generates them for records it creates, so a record keeps the same id offline and online. |
| Errors | `{ "error": "<code>", "message": "<safe text>" }`. 5xx responses never include internal details. |
| Rate limit | 300 requests/minute per client address (`TRUST_PROXY=true` behind a hosting proxy). Exceeding it returns 429. |
| Headers | Every response has `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`. Request bodies are limited to 256 KB (otherwise `413`). |
| Owner checks | A record of another farmer always answers `404 not_found`, before any other validation of the request. This is checked for every id route by `test/isolation.test.ts`. |

### Writes, idempotency and conflicts

* **Create:** `POST` with a client-generated `id` and an `Idempotency-Key: <uuid>` header. The
  server stores the key with the response. A retry with the same key returns the stored response.
  It does not create a second record. The same key with a different body returns `422 idempotency_mismatch`.
* **Update (editable records):** `PATCH /<resource>/:id` with `If-Match: <version>`. If the stored
  `version` differs, the server returns `409 version_conflict` with the current server row, and the
  app shows both versions for the farmer to choose.
* **Financial and stock records** (sales, payments, allocations, stock movements, prices) are never
  updated. Corrections go through explicit endpoints (`/void`, `/correct`, `/adjust`) that require a
  `reason` and write an audit log entry.

### Sync

* **Push:** the app's outbox sends each queued change to its normal REST endpoint, one at a time
  and in order per record, with the op's id as `Idempotency-Key`. No separate batch endpoint is
  needed, because one code path serves online and offline writes.
* **Pull:** `GET /v1/sync/pull?entity=<cattle|cattle_breeds>&after=<ts>&after_id=<uuid>&limit=200` returns
  `{ rows, next, has_more }`.
  * `rows` are the owner's rows changed after the cursor, ordered by `(updated_at, id)`. They include soft-deleted rows, so other phones remove them.
  * `next` is the cursor after the last row: a microsecond-precision timestamp plus id. It is `null` only when there are no rows.
  * The app stores `next` and passes it back next time.

### Idempotency (all Stage 3+ writes)

`Idempotency-Key: <uuid>` is required on every create, update, status change, delete and photo confirmation (otherwise `428`).
The successful response is stored in the same transaction as the write:
* A retry with the same key gets the stored response back, and nothing runs twice.
* The same key with a different request returns `422 idempotency_mismatch`.
* Errors are not stored, so a corrected request can be sent again under a new key.

## Endpoints by stage

| Stage | Endpoints |
|---|---|
| 1 ✅ | `GET /health`, `GET /v1/me` (creates the farmer account and default breeds on first call) |
| 2 ✅ | `PATCH /v1/me` (profile, onboarding progress, preferences), `POST /v1/me/deletion-request` |
| 3 ✅ | breeds, cattle, status, delete, photos, timeline, `GET /v1/sync/pull` (see below) |
| 4 ✅ | `GET/POST /v1/milk-production`, `POST /v1/milk-production/:id/correct`, `POST /v1/milk-production/:id/void`, `milk_production` in `sync/pull`, `decline_rule` on `/v1/me` |
| 5 ✅ | Eight care record types with one shared lifecycle (below), care tables in `sync/pull`, `breeding_intervals` on `/v1/me` |
| 6 ✅ | customers (+ statement), milk prices, sales (+ void, correct), payments (+ void), stock movements (+ reverse, available), expenses (+ receipt photo, void), audit history |
| 7 ✅ | `POST /v1/exports` (export log). The dashboard and reports are built on the phone, so there are no report endpoints |

The full request and response schemas for each stage are added to this file when that stage is built.

## Stage 1–2: account

### `GET /v1/me` → `200 FarmerAccount`

Returns the signed-in farmer's account. On the first call for a new auth user, it also creates the
account and the default breed list (Friesian, Jersey, Ayrshire, Guernsey, Boran, Tonga, Crossbreed),
and audits `account.created`.

`FarmerAccount`: `id, display_name, preferred_contact ('email'|'phone'|null), phone, farm_name,
farm_location, time_zone, currency, volume_unit ('L'), weight_unit ('kg'), language ('en'),
date_format, notification_prefs, onboarding_step, onboarding_completed_at, deletion_requested_at,
version, created_at, updated_at`.

### `PATCH /v1/me` (header `If-Match: <version>` required)

The body has only the fields being changed, and every field is optional. Unknown fields (including `owner_id`) return 400.

| Field | Rule |
|---|---|
| `display_name` | 1–80 characters after trimming |
| `preferred_contact` | `email` or `phone`. `phone` needs a phone number, either already saved or sent in this request |
| `phone` | `^\+?[0-9 ]{7,20}$`, or `null` |
| `farm_name`, `farm_location` | ≤120 and ≤200 characters. An empty string becomes `null` |
| `time_zone` | Valid IANA zone, e.g. `Africa/Lusaka` |
| `currency` | `ZMW` or `USD`. Past sales keep their own currency |
| `language` | `en` |
| `date_format` | `DD/MM/YYYY` or `YYYY-MM-DD` |
| `notification_prefs` | `{ reminder_time: "HH:MM", vaccinations, breeding, health, withdrawal, finance, sync_problems: boolean }` |
| `onboarding_step` | `profile`, `farm`, `units`, `reminders`, `lock`, `first_task`, or `null` |
| `onboarding_completed` | `true`. Sets `onboarding_completed_at` once |

Responses:
* `200 FarmerAccount`. Every change writes an `account.settings_updated` audit entry with before and after values of the changed fields.
* `400 validation_failed`, with `field` set to the dotted path of the bad field.
* `409 version_conflict`, with `current` set to the server row.
* `428 version_required`.

### `POST /v1/me/deletion-request` → `200 FarmerAccount`

Body `{ reason?: string (≤500) }`. Sets `deletion_requested_at` (once) and audits
`account.deletion_requested`. Deletion itself is the procedure documented in Stage 8.

### Auth (Supabase, from the app)

| Flow | Calls |
|---|---|
| Sign up | `auth.signUp({ email, password })` → email code → `auth.verifyOtp({ email, token, type: 'email' })` |
| Sign in | `auth.signInWithPassword`. If the error is `email_not_confirmed`, the app resends the code and opens verification |
| Reset or change password | `auth.resetPasswordForEmail(email)` → code → `verifyOtp({ type: 'recovery' })` → `auth.updateUser({ password })` |
| Sign out | `auth.signOut({ scope: 'local' | 'global' })`. Local farm data is wiped from the phone |

The session is stored in the iOS Keychain or Android Keystore (expo-secure-store, chunked), never in plain storage.

## Stage 3: animals

All responses use the row shape of `cattle` or `cattle_breeds`, with dates as `YYYY-MM-DD` and decimals as strings. Another owner's
record always looks like `404 not_found`.

| Endpoint | Headers | Body → result |
|---|---|---|
| `GET /v1/breeds` | | The farmer's breeds, including inactive ones |
| `POST /v1/breeds` | Idempotency-Key | `{ id, name }` → `201`. `409 breed_exists` |
| `PATCH /v1/breeds/:id` | Idempotency-Key, If-Match | `{ name?, active? }`. Breeds are never deleted |
| `GET /v1/cattle` | | Active and retired animals. Deleted animals are excluded |
| `GET /v1/cattle/:id` | | One animal |
| `POST /v1/cattle` | Idempotency-Key | `{ id (client UUID), sex, …optional fields }` → `201`. `409 ear_tag_taken` (field `ear_tag`), `409 id_taken` |
| `PATCH /v1/cattle/:id` | Idempotency-Key, If-Match | Changed fields only → `200`. `409 version_conflict` returns `current` |
| `POST /v1/cattle/:id/status` | Idempotency-Key, If-Match | `{ status, status_date (required unless active), status_details?, reason (required to reactivate) }` |
| `DELETE /v1/cattle/:id` | Idempotency-Key, If-Match | Soft delete, for animals entered by mistake. `409 has_history` if any record links to the animal |
| `POST /v1/cattle/:id/photo-upload` | | → `{ path, upload_url }`: a signed upload URL into the private `animal-photos` bucket. The app sends the JPEG to it with `PUT` |
| `POST /v1/cattle/:id/photo` | Idempotency-Key | `{ path }`: confirms the upload. The path must be under `<owner>/<animal>/` and the object must exist (`400 photo_missing`). The old photo is removed |
| `GET /v1/cattle/:id/photo-url` | | → `{ url, expires_in: 600 }` |
| `GET /v1/cattle/:id/timeline` | | → `[{ at, kind, title, detail }]`, newest first. Covers milk (daily totals), health, treatments, vet visits, breeding, pregnancy checks, calvings, vaccinations and audit events |

Validation of animal fields:
* Ear tag: ≤30 characters, optional, unique per owner among non-deleted animals.
* Dates: not in the future.
* `weight_kg` and `purchase_price`: decimal strings with ≤2 decimals. A purchase price needs a currency.
* `reproductive_status`: only `open` or `not_applicable`. `bred` and `pregnant` come only from Stage 5 records.
* Sex rules: `lactating` and `dry` are for females only.
* Parents: the mother must be a female, and the father a male, in the same herd.

## Stage 4: milk production

Entry shape: `{ id, cattle_id, production_date, session ('morning'|'afternoon'|'evening'), quantity ("12.50"), unit 'L',
restricted, notes, captured_at, status ('valid'|'voided'), void_reason, version, created_at, updated_at }`.

| Endpoint | Headers | Body → result |
|---|---|---|
| `GET /v1/milk-production?from&to&cattle_id` | | Entries, newest first, including voided ones |
| `POST /v1/milk-production` | Idempotency-Key | `{ id, cattle_id, production_date, session, quantity, notes?, captured_at? }` → `201`. `409 session_exists` returns `existing` |
| `POST /v1/milk-production/:id/correct` | Idempotency-Key, If-Match | `{ quantity?, production_date?, session?, cattle_id?, notes?, reason }` → `200`. Audited with before and after. `409 session_exists`, `409 voided`, `409 version_conflict` |
| `POST /v1/milk-production/:id/void` | Idempotency-Key, If-Match | `{ reason }`: kept, but excluded from totals and stock. The session can be entered again |

Rules:
* Quantity is more than 0 and at most 100 L per session, with ≤2 decimals.
* The cow must be female and in this herd. She must not be past the date she left the farm, or before her birth date.
* The date may not be in the future.
* There is one valid entry per cow, date and session.
* **Milk withdrawal:** `restricted` is set by the server, never by the app. It is true when a treatment for the cow with
  `requires_milk_withdrawal` started on or before the date, and its `withdrawal_ends_at` is after the session's nominal time.
  Session times are 06:00, 12:00 and 18:00 in the farm's time zone. Finishing the treatment does not clear the restriction.
  The restriction is re-evaluated on every correction.
* **Stock:** an eligible entry (valid and not restricted) writes one `production` stock movement. Corrections and voids write
  `adjustment` movements for the change in eligible litres, on the affected dates. For every entry, the sum of its movements equals its current eligible litres.

## Stage 5: animal care

The eight record types share one lifecycle, implemented once in `apps/api/src/care.ts`:

| Route | Headers | Behaviour |
|---|---|---|
| `GET /v1/<path>?cattle_id=` | | Records not removed, newest first |
| `POST /v1/<path>` | Idempotency-Key | `{ id (client UUID), …fields }` → `201` |
| `PATCH /v1/<path>/:id` | Idempotency-Key, If-Match | Changed fields → `200`. The whole record is re-validated after merging. `409 version_conflict` returns `current` |
| `POST /v1/<path>/:id/remove` | Idempotency-Key, If-Match | `{ reason }`: soft delete (`deleted_at`, `delete_reason`), audited, synced to other phones |

| Path | Table | Rules and side effects |
|---|---|---|
| `health-records` | `animal_health_records` | `confirmed` needs `confirmed_diagnosis`. First symptoms must be on or before the report date. Suspected and confirmed conditions are kept distinct |
| `vet-visits` | `veterinary_visits` | A linked health record must be about the same animal |
| `treatments` | `treatments` | Dosage and withdrawal are stored **as instructed by the vet**, never calculated. `requires_milk_withdrawal` needs the exact `withdrawal_ends_at`. Clearance cannot be before the end. **Side effect:** the cow's milk in the old and new withdrawal window is re-checked; entries are re-marked, stock adjusted and the change audited. The response includes `milk_entries_rechecked` |
| `breeding` | `breeding_records` | Females only. A mating or AI creates a `pending` pregnancy check `pregnancy_check_days` later. Changing the event date moves it. Removing the breeding removes the check if still pending |
| `pregnancy-checks` | `pregnancy_checks` | A result other than `pending` needs `examined_on`. `expected_calving_on` only when pregnant |
| `calvings` | `calving_records` | Optional `calf: { id, sex, ear_tag?, name? }` on create (live births only) registers the calf, linked to its mother, with birth date, `production_status: calf` and the bull or semen from the last breeding. The mother becomes `lactating` |
| `vaccination-schedules` | `vaccination_schedules` | Entered by the farmer from vet guidance. Nothing is built in. `reminder_offsets_days` defaults to `[30, 7, 1]` |
| `vaccinations` | `vaccination_records` | `completed` needs `administered_on`. A completed dose with `next_due_on` schedules the next dose once. A group dose is one record per animal, all sharing `group_batch_id`, `group_label` and `group_definition` |

**Reproductive status** (`cattle.reproductive_status`) is derived after every breeding, check or calving change:
* It takes the latest of three events: a mating or AI (**bred**), a check result (**pregnant** or **open**), or a calving (**open**).
* Breeding alone never sets *pregnant*.
* Heat observations change nothing.
* Every derived change is audited.

`breeding_intervals` on `PATCH /v1/me` is `{ pregnancy_check_days 14–120, gestation_days 260–300 }`. The default is `{ 35, 283 }`, which the app labels "confirm with your vet".

## Stage 6: customers and finance

All writes take an `Idempotency-Key`. Money and litres are decimal strings. Currencies are `ZMW` or `USD` and are never added together.

| Endpoint | Body → result and rules |
|---|---|
| `GET/POST /v1/customers`, `PATCH /v1/customers/:id` (If-Match) | name, phone, address, type, notes, active. Duplicate checking happens in the app: same phone, or a similar name, triggers a confirmation |
| `GET /v1/customers/:id/statement` | `{ customer, balances: { ZMW: "40.00" }, sales: [...with paid/due], payments, generated_at }` |
| `GET/POST /v1/milk-prices` | `{ id, currency, price_per_litre, effective_from, reason? }`. Append-only history, audited |
| `POST /v1/milk-sales` | `{ id, customer_id, sale_at, quantity, currency, price_per_litre?, amount_paid?, payment_id?, payment_method?, notes? }`. Rules below |
| `POST /v1/milk-sales/:id/void` | `{ reason }`. The milk goes back into stock (a `reversal` movement). Money already paid becomes credit |
| `POST /v1/milk-sales/:id/correct` | `{ new_id, …changes, reason }`. Voids the original and creates a corrected sale with `corrects_sale_id`. Audited with before and after values |
| `GET/POST /v1/payments`, `POST /v1/payments/:id/void` | Rules below |
| `GET /v1/stock/available?date=` | `{ date, available }` |
| `POST /v1/stock/movements` | `{ id, kind, quantity (positive), direction? ('add'/'remove', for adjustments), movement_date, reason? }`. Kinds: `farm_consumption`, `calf_feeding`, `spoilage`, `gift`, `other_use`, `adjustment`, `opening_balance`. Reason required for adjustments, opening balances and other use |
| `POST /v1/stock/movements/:id/reverse` | `{ id, reason }`. Reverses a mistaken use, adjustment or opening balance once. Production and sales are corrected through their own records |
| `GET/POST /v1/expenses`, `PATCH /:id` (If-Match), `POST /:id/void` (If-Match) | Corrections are audited field by field |
| `POST /v1/expenses/:id/receipt-upload` then `POST /:id/receipt { path }`, `GET /:id/receipt-url` | The same signed-URL flow as animal photos, in the private `receipts` bucket |
| `GET /v1/audit?entity_table&entity_id&before_id&limit` | The owner's audit log, newest first |

Sale rules:
* The total is `round(quantity × price, 2)`, computed by the server.
* Without `price_per_litre`, the sale uses the latest listed price for its currency at `sale_at` (`price_source: 'list'`). Otherwise the price is recorded as `'override'`.
* With no price for that currency, the server returns `400 no_price`.
* Every sale keeps its own price and currency.
* `amount_paid` can be at most the total, and needs a method. It creates a payment linked to the sale.
* **Stock:** the server returns `409 insufficient_stock { available, requested, date }` unless the quantity fits within the closing stock of the sale's farm date **and of every later day**. A back-dated sale lowers all later days. The sale's stock movement shares the sale's id.

Payment rules:
* Kinds are `payment` (money in), `refund` (money out, limited to the customer's credit, reason required) and `adjustment` (discount or write-off, limited to what's owed, reason required).
* After every sale, payment or void, the customer's credit is re-applied to their **oldest unpaid sales first**.
* Refunded money is taken from the oldest credit and never pays a sale.
* Balance = completed sales − payments − adjustments + refunds, per currency.

## Stage 7: export log

The phone builds every report and file. The server only records that an export happened, which the spec requires to be audited.

| Endpoint | Headers | Body → result |
|---|---|---|
| `POST /v1/exports` | Idempotency-Key | `{ id, report, format ('csv'\|'pdf'), filters: { name: value }, row_count, generated_at }` → `201`. Writes an `export.csv` or `export.pdf` audit entry (`entity_table: 'exports'`, `reason` = report id). A retry logs once |

The phone queues this call like any other change, so an export made offline is logged when the phone next syncs. Exports appear under `GET /v1/audit?entity_table=exports`.

`decline_rule` on `PATCH /v1/me` is `{ recent_days 3–30, baseline_days 3–60, threshold_pct 5–80, min_days ≤ both periods }`.
The default is `{ 7, 7, 20, 4 }`.
