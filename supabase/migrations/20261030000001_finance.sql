-- Stage 6: customers, prices, sales, payments, stock, expenses.

-- Incremental sync needs updated_at on every synced table. Append-only tables never change,
-- so updated_at is simply their creation time.
alter table public.milk_prices          add column updated_at timestamptz not null default now();
alter table public.milk_stock_movements add column updated_at timestamptz not null default now();
alter table public.payment_allocations  add column updated_at timestamptz not null default now();
alter table public.milk_sales           add column updated_at timestamptz not null default now();
alter table public.payments             add column updated_at timestamptz not null default now();

create index milk_prices_owner_updated_idx on public.milk_prices (owner_id, updated_at);
create index milk_stock_owner_updated_idx on public.milk_stock_movements (owner_id, updated_at);
create index payment_alloc_owner_updated_idx on public.payment_allocations (owner_id, updated_at);
create index milk_sales_owner_updated_idx on public.milk_sales (owner_id, updated_at);
create index payments_owner_updated_idx on public.payments (owner_id, updated_at);
create index customers_owner_phone_idx on public.customers (owner_id, phone);

-- Sales and payments change only when voided; stamp that change for sync.
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;

create trigger milk_sales_zz_touch before update on public.milk_sales for each row execute function public.touch_updated_at();
create trigger payments_zz_touch before update on public.payments for each row execute function public.touch_updated_at();

-- The guard compares rows without the void fields; updated_at is bookkeeping, not data.
create or replace function public.guard_financial_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception '% rows cannot be deleted; void them instead', tg_table_name;
  end if;
  if old.status = 'voided' then
    raise exception '% row % is already voided', tg_table_name, old.id;
  end if;
  if (to_jsonb(new) - array['status', 'void_reason', 'voided_at', 'updated_at'])
     <> (to_jsonb(old) - array['status', 'void_reason', 'voided_at', 'updated_at']) then
    raise exception 'only void fields of % may change', tg_table_name;
  end if;
  return new;
end $$;

-- Whether the sale used the listed price or a price the farmer entered for that sale.
alter table public.milk_sales add column price_source text not null default 'list' check (price_source in ('list', 'override'));

-- Refunds and adjustments must say why.
alter table public.payments add column reason text;
alter table public.payments add constraint payments_reason_check check (kind = 'payment' or reason is not null);

-- Credit freed by a void can be re-applied to a sale the same payment already part-paid,
-- so one payment may hold more than one allocation row for the same sale.
alter table public.payment_allocations drop constraint payment_allocations_payment_id_sale_id_key;

-- Private bucket for expense receipt photos (same rules as animal photos).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 2097152, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;
