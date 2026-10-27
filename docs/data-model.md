# Data model

Source of truth: [`supabase/migrations/20261026000001_initial_schema.sql`](../supabase/migrations/20261026000001_initial_schema.sql),
applied to Supabase project `dairy-farm` (`xgdhqmlkjfhcfjkmrqrx`, eu-central-1).

## Owner boundary

`farmer_accounts` maps one Supabase Auth user (`auth_user_id`) to an internal `id`. Every other
table has `owner_id → farmer_accounts.id`. There are no roles, farms or farm-users tables. Farm name
and location are profile fields.

## Entity relationships

```
farmer_accounts 1─* (every table below, via owner_id)

cattle_breeds 1─* cattle
cattle ─ dam_id / sire_id ─> cattle            (parentage)
cattle 1─* milk_production
cattle 1─* animal_health_records 1─* treatments
                                 1─* veterinary_visits
cattle 1─* treatments, veterinary_visits       (health_record_id optional)
cattle 1─* breeding_records 1─* pregnancy_checks
cattle (dam) 1─* calving_records *─1 cattle (calf)
vaccination_schedules 1─* vaccination_records *─1 cattle

customers 1─* milk_sales ─ corrects_sale_id ─> milk_sales
customers 1─* payments 1─* payment_allocations *─1 milk_sales
milk_prices 1─* milk_sales                      (price_id; price/currency also copied onto the sale)

milk_stock_movements ─> milk_production | milk_sales | milk_stock_movements (reverses_id)
audit_logs, notifications, idempotency_keys     (owner-scoped, no business FKs)
```

## Definitions

| Concept | Definition |
|---|---|
| Daily yield | Sum of `quantity` for `status = 'valid'` sessions of one animal on one `production_date`. |
| Eligible milk | Valid production with `restricted = false`. The server sets `restricted` when an active withdrawal (`withdrawal_ends_at` after the session, and not cleared) covers the animal. Finishing a treatment does not clear it. |
| Stock | Signed ledger. Closing stock = sum of `milk_stock_movements.quantity` up to the date. Inflows: `opening_balance`, `production` (eligible only). Outflows: `sale`, `farm_consumption`, `calf_feeding`, `spoilage`, `gift`, `other_use`. `adjustment` can be either sign and needs a reason. |
| Sale total | `round(quantity × price_per_litre, 2)`, enforced by a CHECK constraint. |
| Revenue | Sum of `total` of completed (not voided) sales in the period. |
| Receipts | Sum of completed `payments` with `kind = 'payment'` in the period. Refunds are reported separately. |
| Customer balance | Completed sales total minus allocations from completed payments. |
| Operating result | Revenue minus active expenses for the period, per currency. Labelled "recorded operating result", not profit. |
| Pregnant | Only from a `pregnancy_checks` row with `result = 'pregnant'` (or a recorded calving). Breeding alone never sets it. |

## Precision and types

* Litres `NUMERIC(10,2)`, money `NUMERIC(14,2)`, unit price `NUMERIC(12,2)`, weight `NUMERIC(7,2)`.
* Business dates are `DATE`. Event and audit times are `TIMESTAMPTZ`.
* Currencies are ISO 4217 `char(3)`. The default is `ZMW`. Amounts in different currencies are never summed together.

## Integrity rules enforced in the database

* Unique ear tag per owner (where present). Unique valid milk session per animal, date and session.
* `version` increments on every update of editable tables (trigger `touch_row`). Used for conflict checks.
* Append-only tables, where UPDATE and DELETE raise an error: `audit_logs`, `milk_stock_movements`, `payment_allocations`, `milk_prices`.
* `milk_sales` and `payments`: DELETE is blocked, and UPDATE may only set the void fields, once.
* CHECKs cover: positive quantities and amounts, sign by stock-movement kind, reasons required for
  adjustments and voids, confirmed diagnosis required when `condition_status = 'confirmed'`,
  withdrawal end time required when withdrawal applies, and pregnancy result requiring an exam date.

These rules were checked against the live database on 2026-10-26: 10 of 10 checks passed in a
rolled-back transaction (duplicate ear tag, duplicate session, version bump, wrong total, sale
edit, sale delete, valid void, stock update, wrong stock sign, pregnancy without exam).

## Stage 3 changes (`20261027000001_animals.sql`)

* `cattle.deleted_at`: soft delete, only for animals with no linked records. The ear-tag unique index now
  ignores deleted animals, so their tag can be reused.
* Private storage bucket `animal-photos`: 2 MB limit, JPEG and PNG only, no storage policies. Only the API's
  secret key signs URLs. Paths are `<owner_id>/<cattle_id>/<uuid>.jpg`.

## Stage 4 changes (`20261028000001_milk_production.sql`)

* `farmer_accounts.decline_rule` (jsonb): the farmer's production-alert rule.
* `milk_production` quantity is limited to 100 L per session.
* At most one `production` stock movement per entry. Later changes are `adjustment` movements that reference the entry.

### Production calculations (on the phone, `apps/mobile/src/production/calc.ts`)

All calculations use whole centilitres (integers), so there is no floating-point error. Voided entries are always excluded.

| Figure | Definition |
|---|---|
| Daily yield (cow) | Sum of the cow's valid sessions that day |
| Total for a period | Sum of valid entries with `production_date` in the range. Restricted milk is shown separately, as "not for sale" |
| Average per producing cow per day | Total ÷ number of (cow, day) pairs with records. Days without records are not counted as zero |
| Per animal / per breed | The same, grouped by cow or by breed |
| High and low producers | Ranked by average daily yield, among cows with at least `min_days` of records (fewer if the period is shorter) |
| Period comparison | Against the period of the same length immediately before |
| Decline | The last `recent_days` up to **yesterday** (today may be incomplete) vs the `baseline_days` before that. Flagged when the change is at or below −`threshold_pct`%. Both periods need at least `min_days` days with records, otherwise the result is "not enough data" |
| Weeks, months, years | Weeks run Monday to Sunday. Months and years are calendar periods |

## Stage 5 changes (`20261029000001_animal_care.sql`)

* `deleted_at` and `delete_reason` on all eight care tables. Removed records are excluded from lists, timelines, withdrawal checks and reproductive status, but stay in the database and audit log.
* `farmer_accounts.breeding_intervals` (jsonb).

### Reminders (on the phone, `apps/mobile/src/care/reminders.ts`)

Computed from synced records, so they work offline. Only animals still on the farm get reminders.

| Reminder | When |
|---|---|
| Milk withdrawal in force | Until the vet's exact `withdrawal_ends_at`. A notification fires at that time |
| Withdrawal ended, confirm clearance | For 7 days after the end, until `withdrawal_cleared_at` is recorded |
| Vaccination due or overdue | A scheduled dose with `due_on`. Notifications follow the schedule's offsets (default 30, 7, 1 days before) |
| Pregnancy check | A pending check with `scheduled_on`. Notifications 1 day before and on the day |
| Expected calving | The latest confirmed pregnancy, until a calving is recorded after it. Notifications 7 days and 1 day before |
| Health follow-up | `follow_up_on`, until recovered or died |

Local notifications are scheduled at the farmer's reminder time, respect their reminder settings, and are capped at 60 (iOS allows 64).
They are rescheduled whenever records change, offline included. The phone asks for notification permission only when
something needs scheduling. The app reports "scheduled on this phone", never "delivered".

## Stage 6 changes (`20261030000001_finance.sql`)

* `updated_at` on `milk_prices`, `milk_stock_movements`, `payment_allocations`, `milk_sales` and `payments`, for incremental sync. Sales and payments stamp it when voided.
* `milk_sales.price_source` (`list` | `override`), and `payments.reason` (required for refunds and adjustments).
* `payment_allocations` may hold several rows for one payment and sale pair, because credit freed by a void can be re-applied.
* Private storage bucket `receipts`.
* The production movement of a milk entry, and the stock movement of a sale, use the same id as the entry or sale.

### Money and stock definitions

| Figure | Definition |
|---|---|
| Sales revenue | Sum of `total` for completed sales whose `sale_at` falls on a farm date in the period (accrual basis) |
| Payments received | Completed `payment`-kind payments in the period. Refunds and adjustments are reported separately |
| Customer balance | Completed sales − payments − adjustments + refunds, per currency. Negative means in credit |
| Recorded operating result | Sales revenue − active expenses in the period. Labelled as not audited profit |
| Closing stock (day) | Opening + eligible production − sales − milk use ± opening balances, adjustments and reversals |
| Saleable stock on date D | The lower of D's closing stock and every later day's closing stock. Restricted milk never enters it |
| Stock discrepancy | Any day whose closing stock is below zero. It's flagged for investigation and never corrected automatically |

## Stage 7: dashboard and reports (no schema change)

Reports are built on the phone (`apps/mobile/src/reports/build.ts`) from synced records, so they work offline. Each report carries its period, filters, generation time, units or currency, definitions, and a list of missing or incomplete records.

| Report | Filters | Contents |
|---|---|---|
| Herd | breed | Active and recorded animals, cows in milk, confirmed pregnancies, animals that left in the period, breed distribution |
| Milk production | animal, breed | Total, withdrawal milk, average per producing cow per day, change vs the previous period, daily totals, by cow, by breed, high/low producers, decline flags |
| Animal health | animal, breed | Under treatment, withdrawal in force, concerns in the period (suspected / confirmed), treatments, outcomes, follow-ups due |
| Reproduction | animal, breed | Breeding attempts, check results (including unsuccessful), confirmed pregnancies with expected calving, calvings, calving intervals (only between two recorded calvings of the same cow) |
| Vaccination | animal, breed | Doses given, overdue, due within 30 days, compliance (doses due in the period that were given), coverage per vaccine (a completed dose within the schedule interval, or 365 days without one), group doses as defined at the time |
| Sales, money and stock | currency, customer, payment method, paid/unpaid, expense category | Revenue, receipts, refunds and write-offs, expenses, recorded operating result, amounts owed, sales, payments, balances, expenses by category, stock by day |

**Animals needing attention** (dashboard): active animals with a milk withdrawal in force, an urgent or ongoing health concern, an overdue vaccination, pregnancy check or follow-up, or a production decline.

**Exports:**
* **CSV:** starts with report, period, filters, generation time, units and source, then the summary, each table, the definitions, and anything missing. It is UTF-8 with a byte order mark so Excel reads it correctly. Cells starting with `= + - @` (other than plain numbers) are prefixed with `'` so spreadsheets don't run them as formulas.
* **PDF:** HTML rendered with expo-print. All record text is HTML-escaped.
* **Sharing:** the app warns before sharing that the file contains farm records (and customer data for the money report). Every export is logged via `POST /v1/exports`.

## Offline copy on the phone (expo-sqlite)

| Table | Purpose |
|---|---|
| `records(entity, id, data, sync_state, deleted)` | The phone's copy of each synced entity, stored as JSON. `sync_state` is `synced`, `pending` (saved on this phone, waiting) or `attention` (rejected) |
| `outbox(seq, op_id, entity, record_id, kind, method, path, body, if_match, state, attempts, next_attempt_at, error_*)` | Queued changes in order. `op_id` doubles as the Idempotency-Key |
| `kv` | Account cache, pull cursors, drafts, last photo URLs and timelines |

Rules:
* A record and its outbox op are written in one SQLite transaction.
* Edits made before the first sync are folded into the create. Consecutive edits are folded into one update.
* Ops for one record go in order. When an op succeeds, the later ops for that record move their If-Match to the returned version.
* A rejected op (4xx) blocks only its own record and appears under *Sync issues*. A network or 5xx failure stops the push and retries with backoff (2 s doubling, up to 5 min), and immediately when connectivity returns.
* Pull never overwrites a record that has unsent local changes.
* An op that was in flight when the app was killed is resent on the next start. Its idempotency key makes this safe.

## Stage 8 changes (`20261031000001_account_erasure.sql`)

* `public.erase_farmer_account(owner)` erases every row a farmer owns, and refuses unless `deletion_requested_at` is set.
  The append-only guards (`forbid_mutation`, `guard_financial_update`) allow deletes only while `app.erase = 'on'`. The function sets that for its own transaction only.
* `public.account_deletions(requested_at, erased_at, rows_erased)` is an anonymous receipt with no personal data.
* The operator script `apps/api/scripts/erase-account.ts` also removes Storage objects and the auth user. The procedure is in [operations.md](operations.md#processing-an-account-deletion-request).
* `apps/api/src/integrity.ts` holds the cross-table checks the schema cannot express (run with `npm run integrity`):
  * each milk entry's stock equals its saleable litres
  * each completed sale has one unreversed stock movement
  * payment allocations stay within the payment and the sale total
  * cross-owner references
  * negative stock days (a warning only).

## Known follow-ups

* **Allocations of voided payments** stay in the table. Balance queries must join to `payments.status = 'completed'`.
* **First sync volume:** a new phone downloads the full history (about 6 MB per year of milk records for 30 cows). Limiting the initial pull to recent periods is a possible future improvement.
