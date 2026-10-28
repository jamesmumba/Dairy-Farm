-- Phones signed in to the account. Each phone makes up its own id on first launch and sends it, with a
-- name, on every API request; the API records it here. The farmer sees the list under Security and can
-- sign a phone out (a lost phone, a worker who left).
--
-- session_id is the Supabase Auth session the phone last used. Signing a phone out removes that session
-- (so its refresh token stops working) and sets signed_out_at; requests still carrying that session are
-- refused until the phone signs in again, which starts a new session and clears signed_out_at.

create table public.devices (
  owner_id      uuid not null references public.farmer_accounts(id) on delete cascade,
  device_id     uuid not null,
  name          text not null check (char_length(name) between 1 and 60),
  platform      text not null check (char_length(platform) between 1 and 20),
  app_version   text check (char_length(app_version) <= 20),
  session_id    text check (char_length(session_id) <= 64),
  first_seen    timestamptz not null default now(),
  last_seen     timestamptz not null default now(),
  signed_out_at timestamptz,
  primary key (owner_id, device_id)
);

-- Which phone made each change, for the audit history ("on Grace's phone"). Null for changes made before
-- phones were recorded.
alter table public.audit_logs add column device_id uuid;

-- Same lockout as every other table: only the API (as the database owner) reads and writes it.
alter table public.devices enable row level security;
revoke all on public.devices from anon, authenticated;
