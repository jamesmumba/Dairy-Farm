-- Which in-app notifications the farmer has read, so every phone signed in to the account agrees.
-- Items are worked out on the phone from the records; the key is the phone's stable item key
-- (e.g. 'vaccination:<record id>', 'unpaid:<customer id>:ZMW'). Only read marks are stored here.

create table public.notification_reads (
  owner_id   uuid not null references public.farmer_accounts(id) on delete cascade,
  key        text not null check (char_length(key) between 1 and 200),
  read_at    timestamptz not null default now(),
  primary key (owner_id, key)
);
create index notification_reads_owner_time_idx on public.notification_reads (owner_id, read_at);

-- Same lockout as every other table: only the API (as the database owner) reads and writes it.
alter table public.notification_reads enable row level security;
revoke all on public.notification_reads from anon, authenticated;
