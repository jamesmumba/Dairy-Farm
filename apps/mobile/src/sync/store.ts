import { randomUUID } from 'expo-crypto';
import { useMemo, useSyncExternalStore } from 'react';
import { db } from '../lib/localDb';

/** What the farmer sees per record: saved on this phone and waiting, synced, or needs attention. */
export type SyncState = 'synced' | 'pending' | 'attention';

export interface Stored<T> {
  data: T;
  sync_state: SyncState;
}

export type OpKind = 'create' | 'update' | 'status' | 'delete' | 'photo' | 'correct' | 'void';

export interface Op {
  seq: number;
  op_id: string;
  entity: string;
  record_id: string;
  kind: OpKind;
  method: 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body: string | null;
  if_match: number | null;
  state: 'queued' | 'sending' | 'failed';
  attempts: number;
  next_attempt_at: number;
  error_code: string | null;
  error_message: string | null;
  error_body: string | null;
  created_at: string;
}

// --- Change notifications so screens re-render after local or synced writes ----

let revision = 0;
const listeners = new Set<() => void>();
export function notify() {
  revision++;
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
/** Re-runs `read` whenever local data changes, or when `key` (e.g. a record id) changes. */
export function useLocal<T>(read: () => T, key = ''): T {
  const rev = useSyncExternalStore(subscribe, () => revision);
  // `read` is a new closure each render; `rev` and `key` are what its result depends on.
  return useMemo(() => read(), [rev, key]); // eslint-disable-line react-hooks/exhaustive-deps
}

// --- Records ---------------------------------------------------------------

export function getRecord<T>(entity: string, id: string): Stored<T> | null {
  const row = db.getFirstSync<{ data: string; sync_state: SyncState }>(
    'select data, sync_state from records where entity = ? and id = ? and deleted = 0',
    entity,
    id,
  );
  return row ? { data: JSON.parse(row.data), sync_state: row.sync_state } : null;
}

export function listRecords<T>(entity: string): Stored<T>[] {
  return db
    .getAllSync<{ data: string; sync_state: SyncState }>('select data, sync_state from records where entity = ? and deleted = 0', entity)
    .map((r) => ({ data: JSON.parse(r.data), sync_state: r.sync_state }));
}

function putRecord(entity: string, id: string, data: unknown, syncState: SyncState, deleted = false) {
  db.runSync(
    `insert into records (entity, id, data, sync_state, deleted) values (?, ?, ?, ?, ?)
     on conflict(entity, id) do update set data = excluded.data, sync_state = excluded.sync_state, deleted = excluded.deleted`,
    entity,
    id,
    JSON.stringify(data),
    syncState,
    deleted ? 1 : 0,
  );
}

/**
 * Shows a record the server will create as a side effect of another queued change (e.g. the
 * corrected sale of a correction). It has no op of its own; the server's copy replaces it.
 */
export function putPending(entity: string, id: string, data: unknown) {
  putRecord(entity, id, data, 'pending');
  notify();
}

export function removeRecord(entity: string, id: string) {
  db.runSync('delete from records where entity = ? and id = ?', entity, id);
}

function opsFor(entity: string, id: string): Op[] {
  return db.getAllSync<Op>('select * from outbox where entity = ? and record_id = ? order by seq', entity, id);
}

export function hasLocalChanges(entity: string, id: string) {
  return opsFor(entity, id).length > 0;
}

/** Applies a row from the server unless this phone has unsent changes to the same record. */
export function applyServerRow(entity: string, row: { id: string; deleted_at?: string | null }) {
  if (hasLocalChanges(entity, row.id)) return;
  putRecord(entity, row.id, row, 'synced', !!row.deleted_at);
}

// --- Writing locally + queueing for the server ------------------------------

export interface QueueRequest {
  kind: OpKind;
  method: Op['method'];
  path: string;
  body?: Record<string, unknown>;
  ifMatch?: number;
}

/**
 * Saves the record on the phone and queues the change in one SQLite transaction, so a record is
 * never saved without its change (or the other way round), even if the app is killed.
 */
export function saveLocal(entity: string, id: string, data: unknown, request: QueueRequest) {
  db.withTransactionSync(() => {
    putRecord(entity, id, data, 'pending', !!(data as { deleted_at?: string | null }).deleted_at);
    const ops = opsFor(entity, id).filter((o) => o.state !== 'sending');
    const last = ops[ops.length - 1];
    const create = ops.find((o) => o.kind === 'create');

    if ((request.kind === 'update' || request.kind === 'correct') && create) {
      // Not on the server yet: fold the edit into the create. A correction's reason has
      // nothing to explain there, since the server only ever sees the corrected value.
      const { reason: _reason, ...changes } = request.body ?? {};
      mergeInto(create, { ...JSON.parse(create.body ?? '{}'), ...changes });
    } else if (request.kind === 'update' && last?.kind === 'update') {
      mergeInto(last, { ...JSON.parse(last.body ?? '{}'), ...request.body });
    } else {
      db.runSync(
        `insert into outbox (op_id, entity, record_id, kind, method, path, body, if_match, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        randomUUID(),
        entity,
        id,
        request.kind,
        request.method,
        request.path,
        request.body ? JSON.stringify(request.body) : null,
        request.ifMatch ?? null,
        new Date().toISOString(),
      );
    }
    // A record with a failed change stays blocked until the farmer resolves it.
    if (opsFor(entity, id).some((o) => o.state === 'failed')) {
      db.runSync("update records set sync_state = 'attention' where entity = ? and id = ?", entity, id);
    }
  });
  notify();
}

/** Replaces an unsent op's body. A new op id (= idempotency key) because the request changed. */
function mergeInto(op: Op, body: Record<string, unknown>) {
  db.runSync(
    `update outbox set body = ?, op_id = ?, state = 'queued', attempts = 0, next_attempt_at = 0,
       error_code = null, error_message = null, error_body = null
     where seq = ?`,
    JSON.stringify(body),
    randomUUID(),
    op.seq,
  );
}

/** Deleting a record the server never saw: drop it and its queued changes entirely. */
export function deleteUnsynced(entity: string, id: string): boolean {
  const ops = opsFor(entity, id);
  if (!ops.some((o) => o.kind === 'create') || ops.some((o) => o.state === 'sending')) return false;
  db.withTransactionSync(() => {
    db.runSync('delete from outbox where entity = ? and record_id = ?', entity, id);
    removeRecord(entity, id);
  });
  notify();
  return true;
}

// --- Outbox access for the sync engine and the "Sync issues" screen -----------

export function getOp(seq: number): Op | null {
  return db.getFirstSync<Op>("select * from outbox where seq = ? and state != 'sending'", seq);
}

/** Every op not currently in flight, oldest first. */
export function pendingOps(): Op[] {
  return db.getAllSync<Op>("select * from outbox where state != 'sending' order by seq");
}

export function failedOps(): Op[] {
  return db.getAllSync<Op>("select * from outbox where state = 'failed' order by seq");
}

export function outboxCounts() {
  return db.getFirstSync<{ pending: number; failed: number }>(
    "select count(*) filter (where state != 'failed') as pending, count(*) filter (where state = 'failed') as failed from outbox",
  ) ?? { pending: 0, failed: 0 };
}

export function markSending(op: Op) {
  db.runSync("update outbox set state = 'sending', attempts = attempts + 1 where seq = ?", op.seq);
}

export function markRetryLater(op: Op, delayMs: number) {
  db.runSync("update outbox set state = 'queued', next_attempt_at = ? where seq = ?", Date.now() + delayMs, op.seq);
}

export function markFailed(op: Op, code: string, message: string, body: unknown) {
  db.withTransactionSync(() => {
    db.runSync(
      "update outbox set state = 'failed', error_code = ?, error_message = ?, error_body = ? where seq = ?",
      code,
      message,
      JSON.stringify(body ?? null),
      op.seq,
    );
    db.runSync("update records set sync_state = 'attention' where entity = ? and id = ?", op.entity, op.record_id);
  });
  notify();
}

/**
 * The server accepted the op. Store its row as the record; if more local changes to the same
 * record are queued, keep the local data and move their If-Match base to the new version.
 */
export function markDone(op: Op, serverRow: { id: string; version?: number; deleted_at?: string | null } | null) {
  db.withTransactionSync(() => {
    db.runSync('delete from outbox where seq = ?', op.seq);
    const remaining = opsFor(op.entity, op.record_id);
    if (!serverRow) return;
    if (remaining.length === 0) {
      putRecord(op.entity, op.record_id, serverRow, 'synced', !!serverRow.deleted_at);
    } else if (serverRow.version !== undefined) {
      db.runSync(
        'update outbox set if_match = ? where entity = ? and record_id = ? and if_match is not null',
        serverRow.version,
        op.entity,
        op.record_id,
      );
      const local = getRecord<Record<string, unknown>>(op.entity, op.record_id);
      if (local) putRecord(op.entity, op.record_id, { ...local.data, version: serverRow.version }, 'pending');
    }
  });
  notify();
}

/** Farmer chose to retry a failed op (after editing, or "keep my version" with a new base). */
export function requeue(op: Op, ifMatch?: number) {
  db.withTransactionSync(() => {
    db.runSync(
      `update outbox set state = 'queued', next_attempt_at = 0, if_match = coalesce(?, if_match),
         error_code = null, error_message = null, error_body = null where seq = ?`,
      ifMatch ?? null,
      op.seq,
    );
    db.runSync("update records set sync_state = 'pending' where entity = ? and id = ?", op.entity, op.record_id);
  });
  notify();
}

/** Farmer chose the saved (server) version: drop all local changes to this record. */
export function discardChanges(entity: string, id: string, serverRow: { id: string } | null) {
  db.withTransactionSync(() => {
    db.runSync('delete from outbox where entity = ? and record_id = ?', entity, id);
    if (serverRow) putRecord(entity, id, serverRow, 'synced');
    else removeRecord(entity, id);
  });
  notify();
}

