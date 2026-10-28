-- Early warning: what the farmer did about an alert, and how it turned out.
--
-- Alerts themselves (a sudden milk drop, a steady decline) are worked out on the phone from the
-- records, by transparent rules. This table keeps the farmer's response: the action taken, a
-- follow-up date while the cow is being watched, and the outcome once it is resolved. An open
-- (monitoring) action holds back the same alert until the follow-up.

create table public.alert_actions (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references public.farmer_accounts(id) on delete cascade,
  cattle_id     uuid not null references public.cattle(id),
  alert_type    text not null check (alert_type in ('milk_drop', 'milk_decline', 'other')),
  alert_reason  text,
  action_taken  text not null
                check (action_taken in ('checked_record', 'checked_feed_water', 'observed', 'called_vet', 'treated', 'other')),
  action_on     date not null,
  notes         text,
  status        text not null default 'monitoring' check (status in ('monitoring', 'resolved')),
  follow_up_on  date,
  resolved_on   date,
  outcome       text,
  deleted_at    timestamptz,
  delete_reason text,
  version       integer not null default 1,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (status <> 'monitoring' or follow_up_on is not null),
  check (status <> 'resolved' or resolved_on is not null),
  check (resolved_on is null or resolved_on >= action_on)
);
create index alert_actions_cattle_idx on public.alert_actions (cattle_id);
create index alert_actions_owner_updated_idx on public.alert_actions (owner_id, updated_at);

create trigger alert_actions_touch before update on public.alert_actions
  for each row execute function public.touch_row();

-- Same lockout as every other table: only the API reads and writes it.
alter table public.alert_actions enable row level security;
revoke all on public.alert_actions from anon, authenticated;
