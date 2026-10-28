import { openDatabaseSync } from 'expo-sqlite';

// On-device working copy: key/value (account cache, cursors, drafts), synced records,
// and the outbox of changes waiting to reach the server.
export const db = openDatabaseSync('dairy.db');

db.execSync(`
  pragma journal_mode = wal;
  create table if not exists kv (
    key        text primary key not null,
    value      text not null,
    updated_at text not null
  );
  create table if not exists records (
    entity     text not null,
    id         text not null,
    data       text not null,
    sync_state text not null default 'synced', -- synced | pending | attention
    deleted    integer not null default 0,
    primary key (entity, id)
  );
  create table if not exists outbox (
    seq             integer primary key autoincrement,
    op_id           text not null unique,       -- also the Idempotency-Key
    entity          text not null,
    record_id       text not null,
    kind            text not null,              -- create | update | status | delete | photo
    method          text not null,
    path            text not null,
    body            text,
    if_match        integer,
    state           text not null default 'queued', -- queued | sending | failed
    attempts        integer not null default 0,
    next_attempt_at integer not null default 0,
    error_code      text,
    error_message   text,
    error_body      text,
    created_at      text not null
  );
  create index if not exists outbox_record_idx on outbox (entity, record_id);
`);
// An app killed mid-request leaves ops in 'sending'; they are safe to resend (idempotent).
db.runSync("update outbox set state = 'queued' where state = 'sending'");

export function getJson<T>(key: string): T | null {
  const row = db.getFirstSync<{ value: string }>('select value from kv where key = ?', key);
  return row ? (JSON.parse(row.value) as T) : null;
}

export function setJson(key: string, value: unknown): void {
  db.runSync(
    'insert into kv (key, value, updated_at) values (?, ?, ?) on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at',
    key,
    JSON.stringify(value),
    new Date().toISOString(),
  );
}

export function remove(key: string): void {
  db.runSync('delete from kv where key = ?', key);
}

/** Removes this farmer's data from the phone (used on sign-out). */
export function clearLocalData(): void {
  // Farm data goes; the phone's own look (light or dark) and its device id and name stay.
  db.execSync("delete from kv where key not in ('appearance', 'device.id', 'device.name'); delete from records; delete from outbox;");
}
