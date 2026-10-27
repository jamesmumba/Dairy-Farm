-- Dairy Farm Production and Health: initial schema.
--
-- Conventions
--   * Every farmer-owned table has owner_id -> farmer_accounts(id). The API derives
--     owner_id from the verified token; a client-supplied owner_id is never trusted.
--   * Ids are UUIDs. The mobile app may generate them offline (stable client ids).
--   * Litres: NUMERIC(10,2). Money: NUMERIC(14,2). Unit prices: NUMERIC(12,2).
--   * Business dates are DATE; event times are TIMESTAMPTZ.
--   * Editable records carry `version` (bumped on every update) for conflict checks.
--   * Financial and stock records are append-only: corrections void + replace, never overwrite.
--   * RLS is enabled with no policies: the Supabase Data API (anon/authenticated)
--     cannot read or write these tables. Only the backend API connection can.

-- ---------------------------------------------------------------------------
-- Shared trigger functions
-- ---------------------------------------------------------------------------

create or replace function public.touch_row() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.version := old.version + 1;
  return new;
end $$;

create or replace function public.forbid_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception '% is append-only', tg_table_name;
end $$;

-- ---------------------------------------------------------------------------
-- Account
-- ---------------------------------------------------------------------------

create table public.farmer_accounts (
  id                      uuid primary key default gen_random_uuid(),
  auth_user_id            uuid not null unique references auth.users(id) on delete cascade,
  display_name            text,
  preferred_contact       text check (preferred_contact in ('email', 'phone')),
  phone                   text,
  farm_name               text,
  farm_location           text,
  time_zone               text not null default 'Africa/Lusaka',
  currency                char(3) not null default 'ZMW',
  volume_unit             text not null default 'L' check (volume_unit in ('L')),
  weight_unit             text not null default 'kg' check (weight_unit in ('kg')),
  language                text not null default 'en',
  date_format             text not null default 'DD/MM/YYYY',
  notification_prefs      jsonb not null default '{}'::jsonb,
  onboarding_step         text,
  onboarding_completed_at timestamptz,
  deletion_requested_at   timestamptz,
  version                 integer not null default 1,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Animals
-- ---------------------------------------------------------------------------

create table public.cattle_breeds (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.farmer_accounts(id) on delete cascade,
  name       text not null check (length(trim(name)) > 0),
  active     boolean not null default true,
  version    integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index cattle_breeds_owner_name_uq on public.cattle_breeds (owner_id, lower(name));

create table public.cattle (
  id                   uuid primary key default gen_random_uuid(),
  owner_id             uuid not null references public.farmer_accounts(id) on delete cascade,
  ear_tag              text check (ear_tag is null or length(trim(ear_tag)) > 0),
  name                 text,
  breed_id             uuid references public.cattle_breeds(id),
  sex                  text not null check (sex in ('female', 'male')),
  birth_date           date,
  birth_date_estimated boolean not null default false,
  acquisition_date     date,
  acquisition_source   text,
  purchase_price       numeric(14,2) check (purchase_price >= 0),
  purchase_currency    char(3),
  weight_kg            numeric(7,2) check (weight_kg > 0),
  dam_id               uuid references public.cattle(id),
  sire_id              uuid references public.cattle(id),
  sire_identifier      text,
  reproductive_status  text not null default 'not_applicable'
                       check (reproductive_status in ('open', 'bred', 'pregnant', 'not_applicable')),
  production_status    text not null default 'not_applicable'
                       check (production_status in ('calf', 'heifer', 'lactating', 'dry', 'not_applicable')),
  photo_path           text,
  notes                text,
  status               text not null default 'active'
                       check (status in ('active', 'sold', 'deceased', 'transferred', 'inactive')),
  status_date          date,
  status_details       text,
  version              integer not null default 1,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (purchase_price is null or purchase_currency is not null),
  check (status = 'active' or status_date is not null)
);
create unique index cattle_owner_ear_tag_uq on public.cattle (owner_id, ear_tag) where ear_tag is not null;
create index cattle_owner_updated_idx on public.cattle (owner_id, updated_at);

-- ---------------------------------------------------------------------------
-- Milk production
-- ---------------------------------------------------------------------------

create table public.milk_production (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references public.farmer_accounts(id) on delete cascade,
  cattle_id       uuid not null references public.cattle(id),
  production_date date not null,
  session         text not null check (session in ('morning', 'afternoon', 'evening')),
  quantity        numeric(10,2) not null check (quantity > 0),
  unit            text not null default 'L' check (unit in ('L')),
  -- Set by the server: true when an active milk withdrawal covered this session.
  restricted      boolean not null default false,
  notes           text,
  captured_at     timestamptz,             -- local device capture time
  status          text not null default 'valid' check (status in ('valid', 'voided')),
  void_reason     text,
  version         integer not null default 1,
  created_at      timestamptz not null default now(), -- server creation time
  updated_at      timestamptz not null default now(),
  check (status = 'valid' or void_reason is not null)
);
create unique index milk_production_session_uq
  on public.milk_production (owner_id, cattle_id, production_date, session) where status = 'valid';
create index milk_production_owner_date_idx on public.milk_production (owner_id, production_date);
create index milk_production_owner_updated_idx on public.milk_production (owner_id, updated_at);

-- ---------------------------------------------------------------------------
-- Customers, prices, sales, payments
-- ---------------------------------------------------------------------------

create table public.customers (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references public.farmer_accounts(id) on delete cascade,
  name          text not null check (length(trim(name)) > 0),
  phone         text,
  address       text,
  customer_type text not null default 'individual'
                check (customer_type in ('individual', 'business', 'school', 'cooperative', 'other')),
  registered_on date not null default current_date,
  notes         text,
  active        boolean not null default true,
  version       integer not null default 1,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index customers_owner_name_idx on public.customers (owner_id, lower(name));
create index customers_owner_updated_idx on public.customers (owner_id, updated_at);

-- Append-only price history. The applicable price is the latest effective_from <= sale time.
create table public.milk_prices (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references public.farmer_accounts(id) on delete cascade,
  currency        char(3) not null,
  price_per_litre numeric(12,2) not null check (price_per_litre > 0),
  effective_from  timestamptz not null,
  reason          text,
  created_at      timestamptz not null default now(),
  unique (owner_id, currency, effective_from)
);

create table public.milk_sales (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references public.farmer_accounts(id) on delete cascade,
  customer_id     uuid not null references public.customers(id),
  sale_at         timestamptz not null,
  quantity        numeric(10,2) not null check (quantity > 0),
  -- Snapshot: later price changes never alter this sale.
  price_per_litre numeric(12,2) not null check (price_per_litre > 0),
  currency        char(3) not null,
  total           numeric(14,2) not null,
  price_id        uuid references public.milk_prices(id),
  payment_method  text check (payment_method in ('cash', 'mobile_money', 'bank_transfer', 'card', 'credit', 'other')),
  notes           text,
  status          text not null default 'completed' check (status in ('completed', 'voided')),
  void_reason     text,
  voided_at       timestamptz,
  corrects_sale_id uuid references public.milk_sales(id),
  created_at      timestamptz not null default now(),
  check (total = round(quantity * price_per_litre, 2)),
  check (status = 'completed' or (void_reason is not null and voided_at is not null))
);
create index milk_sales_owner_date_idx on public.milk_sales (owner_id, sale_at);
create index milk_sales_customer_idx on public.milk_sales (customer_id);

create table public.payments (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.farmer_accounts(id) on delete cascade,
  customer_id uuid not null references public.customers(id),
  kind        text not null default 'payment' check (kind in ('payment', 'refund', 'adjustment')),
  amount      numeric(14,2) not null check (amount > 0),
  currency    char(3) not null,
  method      text not null check (method in ('cash', 'mobile_money', 'bank_transfer', 'card', 'credit', 'other')),
  paid_at     timestamptz not null,
  reference   text,
  notes       text,
  status      text not null default 'completed' check (status in ('completed', 'voided')),
  void_reason text,
  voided_at   timestamptz,
  created_at  timestamptz not null default now(),
  check (status = 'completed' or (void_reason is not null and voided_at is not null))
);
create index payments_owner_date_idx on public.payments (owner_id, paid_at);
create index payments_customer_idx on public.payments (customer_id);

create table public.payment_allocations (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.farmer_accounts(id) on delete cascade,
  payment_id uuid not null references public.payments(id),
  sale_id    uuid not null references public.milk_sales(id),
  amount     numeric(14,2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique (payment_id, sale_id)
);
create index payment_allocations_sale_idx on public.payment_allocations (sale_id);

-- ---------------------------------------------------------------------------
-- Milk stock (signed ledger). closing = sum(quantity) up to a point in time.
-- ---------------------------------------------------------------------------

create table public.milk_stock_movements (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null references public.farmer_accounts(id) on delete cascade,
  movement_date      date not null,
  occurred_at        timestamptz not null default now(),
  kind               text not null check (kind in (
                       'opening_balance', 'production', 'sale', 'farm_consumption', 'calf_feeding',
                       'spoilage', 'gift', 'other_use', 'adjustment', 'reversal')),
  quantity           numeric(10,2) not null check (quantity <> 0),
  reason             text,
  milk_production_id uuid references public.milk_production(id),
  sale_id            uuid references public.milk_sales(id),
  reverses_id        uuid references public.milk_stock_movements(id),
  created_at         timestamptz not null default now(),
  check (kind not in ('opening_balance', 'production') or quantity > 0),
  check (kind not in ('sale', 'farm_consumption', 'calf_feeding', 'spoilage', 'gift', 'other_use') or quantity < 0),
  check (kind not in ('opening_balance', 'adjustment', 'other_use') or reason is not null),
  check (kind <> 'reversal' or reverses_id is not null)
);
create index milk_stock_owner_date_idx on public.milk_stock_movements (owner_id, movement_date);

-- ---------------------------------------------------------------------------
-- Health, treatments, withdrawal
-- ---------------------------------------------------------------------------

create table public.animal_health_records (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null references public.farmer_accounts(id) on delete cascade,
  cattle_id           uuid not null references public.cattle(id),
  first_symptoms_on   date,
  reported_on         date not null,
  observations        text,
  suspected_issue     text,
  confirmed_diagnosis text,
  condition_status    text not null default 'suspected'
                      check (condition_status in ('suspected', 'confirmed', 'ruled_out')),
  severity            text check (severity in ('low', 'moderate', 'high', 'critical')),
  urgent              boolean not null default false,
  responsible_person  text,
  follow_up_on        date,
  recovery_status     text not null default 'ongoing'
                      check (recovery_status in ('ongoing', 'recovering', 'recovered', 'chronic', 'died')),
  notes               text,
  version             integer not null default 1,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (condition_status <> 'confirmed' or confirmed_diagnosis is not null)
);
create index health_records_cattle_idx on public.animal_health_records (cattle_id);
create index health_records_owner_updated_idx on public.animal_health_records (owner_id, updated_at);

create table public.veterinary_visits (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null references public.farmer_accounts(id) on delete cascade,
  cattle_id        uuid not null references public.cattle(id),
  health_record_id uuid references public.animal_health_records(id),
  visit_at         timestamptz not null,
  veterinarian     text,
  purpose          text,
  findings         text,
  notes            text,
  version          integer not null default 1,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index vet_visits_cattle_idx on public.veterinary_visits (cattle_id);
create index vet_visits_owner_updated_idx on public.veterinary_visits (owner_id, updated_at);

-- Dosage and withdrawal are recorded exactly as instructed by the veterinarian;
-- the app never calculates them.
create table public.treatments (
  id                      uuid primary key default gen_random_uuid(),
  owner_id                uuid not null references public.farmer_accounts(id) on delete cascade,
  cattle_id               uuid not null references public.cattle(id),
  health_record_id        uuid references public.animal_health_records(id),
  medication              text not null,
  dosage_instructions     text,
  administered_by         text,
  started_on              date not null,
  completed_on            date,
  requires_milk_withdrawal boolean not null default false,
  withdrawal_period_text  text,
  withdrawal_ends_at      timestamptz,
  withdrawal_source       text,
  withdrawal_cleared_at   timestamptz,
  withdrawal_clearance_note text,
  notes                   text,
  version                 integer not null default 1,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  check (completed_on is null or completed_on >= started_on),
  check (not requires_milk_withdrawal or withdrawal_ends_at is not null),
  check (withdrawal_cleared_at is null or withdrawal_cleared_at >= withdrawal_ends_at)
);
create index treatments_cattle_idx on public.treatments (cattle_id);
create index treatments_withdrawal_idx on public.treatments (owner_id, withdrawal_ends_at)
  where requires_milk_withdrawal;
create index treatments_owner_updated_idx on public.treatments (owner_id, updated_at);

-- ---------------------------------------------------------------------------
-- Breeding, pregnancy, calving
-- ---------------------------------------------------------------------------

create table public.breeding_records (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null references public.farmer_accounts(id) on delete cascade,
  cattle_id        uuid not null references public.cattle(id),
  event_type       text not null check (event_type in ('heat_observed', 'natural_mating', 'artificial_insemination')),
  event_at         timestamptz not null,
  bull_or_semen_id text,
  performed_by     text,
  notes            text,
  version          integer not null default 1,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index breeding_cattle_idx on public.breeding_records (cattle_id);
create index breeding_owner_updated_idx on public.breeding_records (owner_id, updated_at);

-- Pregnancy status follows a recorded examination, never breeding alone.
create table public.pregnancy_checks (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null references public.farmer_accounts(id) on delete cascade,
  cattle_id           uuid not null references public.cattle(id),
  breeding_record_id  uuid references public.breeding_records(id),
  scheduled_on        date,
  examined_on         date,
  result              text not null default 'pending'
                      check (result in ('pending', 'pregnant', 'not_pregnant', 'inconclusive')),
  examiner            text,
  expected_calving_on date,
  notes               text,
  version             integer not null default 1,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (result = 'pending' or examined_on is not null),
  check (result = 'pregnant' or expected_calving_on is null),
  check (scheduled_on is not null or examined_on is not null)
);
create index pregnancy_checks_cattle_idx on public.pregnancy_checks (cattle_id);
create index pregnancy_checks_owner_updated_idx on public.pregnancy_checks (owner_id, updated_at);

create table public.calving_records (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references public.farmer_accounts(id) on delete cascade,
  dam_id        uuid not null references public.cattle(id),
  calf_id       uuid references public.cattle(id),
  calved_on     date not null,
  outcome       text not null check (outcome in ('live', 'stillborn', 'aborted', 'other')),
  complications text,
  dry_off_on    date,
  observations  text,
  version       integer not null default 1,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (calf_id is null or calf_id <> dam_id)
);
create index calving_dam_idx on public.calving_records (dam_id);
create index calving_owner_updated_idx on public.calving_records (owner_id, updated_at);

-- ---------------------------------------------------------------------------
-- Vaccination
-- ---------------------------------------------------------------------------

-- Farmer-entered schedules based on veterinary guidance; nothing is hardcoded.
create table public.vaccination_schedules (
  id                     uuid primary key default gen_random_uuid(),
  owner_id               uuid not null references public.farmer_accounts(id) on delete cascade,
  vaccine_name           text not null,
  target_disease         text,
  interval_days          integer check (interval_days > 0),
  reminder_offsets_days  integer[] not null default '{30,7,1}',
  guidance_source        text,
  active                 boolean not null default true,
  version                integer not null default 1,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- One row per animal per dose. Group doses share group_batch_id and keep the group
-- label/definition as it was at that time, so historic coverage stays explainable.
create table public.vaccination_records (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null references public.farmer_accounts(id) on delete cascade,
  cattle_id          uuid not null references public.cattle(id),
  schedule_id        uuid references public.vaccination_schedules(id),
  vaccine_name       text not null,
  target_disease     text,
  due_on             date,
  administered_on    date,
  status             text not null default 'scheduled'
                     check (status in ('scheduled', 'completed', 'missed', 'cancelled')),
  batch_number       text,
  dosage_as_directed text,
  administered_by    text,
  next_due_on        date,
  is_booster         boolean not null default false,
  group_batch_id     uuid,
  group_label        text,
  group_definition   text,
  notes              text,
  version            integer not null default 1,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (status <> 'completed' or administered_on is not null),
  check (due_on is not null or administered_on is not null)
);
create index vaccination_cattle_idx on public.vaccination_records (cattle_id);
create index vaccination_owner_due_idx on public.vaccination_records (owner_id, due_on) where status = 'scheduled';
create index vaccination_owner_updated_idx on public.vaccination_records (owner_id, updated_at);

-- ---------------------------------------------------------------------------
-- Expenses
-- ---------------------------------------------------------------------------

create table public.farm_expenses (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references public.farmer_accounts(id) on delete cascade,
  expense_date   date not null,
  category       text not null check (category in (
                   'feed', 'veterinary_care', 'medicines', 'transport', 'equipment', 'utilities', 'labour', 'other')),
  amount         numeric(14,2) not null check (amount > 0),
  currency       char(3) not null,
  payee          text,
  payment_method text check (payment_method in ('cash', 'mobile_money', 'bank_transfer', 'card', 'credit', 'other')),
  payment_status text not null default 'paid' check (payment_status in ('paid', 'unpaid', 'partially_paid')),
  receipt_path   text,
  notes          text,
  status         text not null default 'active' check (status in ('active', 'voided')),
  void_reason    text,
  version        integer not null default 1,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (status = 'active' or void_reason is not null)
);
create index expenses_owner_date_idx on public.farm_expenses (owner_id, expense_date);
create index expenses_owner_updated_idx on public.farm_expenses (owner_id, updated_at);

-- ---------------------------------------------------------------------------
-- Notifications, audit, idempotency
-- ---------------------------------------------------------------------------

create table public.notifications (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null references public.farmer_accounts(id) on delete cascade,
  kind                  text not null check (kind in (
                          'vaccination_due', 'vaccination_overdue', 'pregnancy_check', 'expected_calving',
                          'health_follow_up', 'withdrawal', 'production_decline', 'unpaid_balance',
                          'stock_discrepancy', 'sync_failure')),
  title                 text not null,
  body                  text,
  related_table         text,
  related_id            uuid,
  due_at                timestamptz not null,
  -- 'sent' means handed to the push service; only 'delivered' means confirmed.
  status                text not null default 'pending'
                        check (status in ('pending', 'scheduled_local', 'sent', 'delivered', 'failed', 'dismissed')),
  delivery_confirmed_at timestamptz,
  version               integer not null default 1,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index notifications_owner_due_idx on public.notifications (owner_id, due_at);

create table public.audit_logs (
  id            bigint generated always as identity primary key,
  owner_id      uuid not null references public.farmer_accounts(id) on delete cascade,
  actor_user_id uuid not null,
  action        text not null,  -- e.g. 'milk_production.correct', 'milk_sale.void', 'export.csv'
  entity_table  text,
  entity_id     uuid,
  reason        text,
  before_data   jsonb,
  after_data    jsonb,
  operation_id  uuid,           -- client operation that caused it, when synced
  occurred_at   timestamptz not null default now()
);
create index audit_logs_owner_time_idx on public.audit_logs (owner_id, occurred_at);
create index audit_logs_entity_idx on public.audit_logs (entity_table, entity_id);

-- Replayed operations return the stored response instead of running twice.
create table public.idempotency_keys (
  owner_id        uuid not null references public.farmer_accounts(id) on delete cascade,
  key             uuid not null,
  operation       text not null,
  request_hash    text not null,
  response_status integer not null,
  response_body   jsonb,
  created_at      timestamptz not null default now(),
  primary key (owner_id, key)
);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'farmer_accounts', 'cattle_breeds', 'cattle', 'milk_production', 'customers',
    'animal_health_records', 'veterinary_visits', 'treatments', 'breeding_records',
    'pregnancy_checks', 'calving_records', 'vaccination_schedules', 'vaccination_records',
    'farm_expenses', 'notifications'
  ] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.touch_row()',
                   t || '_touch', t);
  end loop;

  foreach t in array array['audit_logs', 'milk_stock_movements', 'payment_allocations', 'milk_prices'] loop
    execute format('create trigger %I before update or delete on public.%I for each row execute function public.forbid_mutation()',
                   t || '_append_only', t);
  end loop;
end $$;

-- Sales and payments: only the void fields may change, and never back to completed.
create or replace function public.guard_financial_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception '% rows cannot be deleted; void them instead', tg_table_name;
  end if;
  if old.status = 'voided' then
    raise exception '% row % is already voided', tg_table_name, old.id;
  end if;
  if (to_jsonb(new) - array['status', 'void_reason', 'voided_at'])
     <> (to_jsonb(old) - array['status', 'void_reason', 'voided_at']) then
    raise exception 'only void fields of % may change', tg_table_name;
  end if;
  return new;
end $$;

create trigger milk_sales_guard before update or delete on public.milk_sales
  for each row execute function public.guard_financial_update();
create trigger payments_guard before update or delete on public.payments
  for each row execute function public.guard_financial_update();

-- ---------------------------------------------------------------------------
-- Lock out the Supabase Data API; the backend API is the only access path.
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

revoke execute on function public.touch_row(), public.forbid_mutation(), public.guard_financial_update()
  from public, anon, authenticated;
