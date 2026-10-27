-- Stage 8: processing an account deletion request.
--
-- Audit, stock and money records are append-only for everyone, always. The single exception
-- is erase_farmer_account(): inside its own transaction it sets app.erase = 'on', which the
-- guards below allow, deletes every row the farmer owns, and keeps an anonymous receipt.

-- Proof that a requested deletion was carried out, without any personal data.
create table public.account_deletions (
  id           bigint generated always as identity primary key,
  requested_at timestamptz not null,
  erased_at    timestamptz not null default now(),
  rows_erased  integer not null
);
alter table public.account_deletions enable row level security;
revoke all on public.account_deletions from anon, authenticated;

create or replace function public.forbid_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and current_setting('app.erase', true) = 'on' then
    return old;
  end if;
  raise exception '% is append-only', tg_table_name;
end $$;

create or replace function public.guard_financial_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if current_setting('app.erase', true) = 'on' then
      return old;
    end if;
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

-- Deletes everything a farmer owns. Refuses unless the farmer asked for deletion.
-- Returns the number of rows erased. Storage objects and the sign-in (auth user) are
-- removed by the operator script (apps/api/scripts/erase-account.ts).
create or replace function public.erase_farmer_account(p_owner uuid) returns integer
language plpgsql set search_path = '' as $$
declare
  requested timestamptz;
  total integer := 0;
  n integer;
  t text;
begin
  select deletion_requested_at into requested from public.farmer_accounts where id = p_owner for update;
  if not found then
    raise exception 'No farmer account %', p_owner;
  end if;
  if requested is null then
    raise exception 'Farmer % has not requested deletion', p_owner;
  end if;

  perform set_config('app.erase', 'on', true); -- this transaction only

  -- Count first (for the receipt), then one cascade from the account removes every owned row.
  for t in select table_name from information_schema.columns
           where table_schema = 'public' and column_name = 'owner_id' loop
    execute format('select count(*) from public.%I where owner_id = $1', t) into n using p_owner;
    total := total + n;
  end loop;
  delete from public.farmer_accounts where id = p_owner;

  perform set_config('app.erase', 'off', true);
  insert into public.account_deletions (requested_at, rows_erased) values (requested, total + 1);
  return total + 1;
end $$;

revoke execute on function public.erase_farmer_account(uuid) from public, anon, authenticated;
