-- Stage 5: animal care.

-- Care records entered by mistake are removed with a reason (soft delete, audited), so the
-- removal reaches other phones through sync and the history stays explainable.
do $$
declare t text;
begin
  foreach t in array array[
    'animal_health_records', 'veterinary_visits', 'treatments', 'breeding_records',
    'pregnancy_checks', 'calving_records', 'vaccination_schedules', 'vaccination_records'
  ] loop
    execute format('alter table public.%I add column deleted_at timestamptz', t);
    execute format('alter table public.%I add column delete_reason text', t);
  end loop;
end $$;

create index vaccination_schedules_owner_updated_idx on public.vaccination_schedules (owner_id, updated_at);

-- Intervals the farmer sets from their vet's guidance. Prefilled values are commonly used
-- starting points that the app labels "confirm with your vet"; nothing is fixed in code.
alter table public.farmer_accounts
  add column breeding_intervals jsonb not null
  default '{"pregnancy_check_days": 35, "gestation_days": 283}'::jsonb;
