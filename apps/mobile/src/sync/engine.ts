import NetInfo from '@react-native-community/netinfo';
import { File, UploadType } from 'expo-file-system';
import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { api, ApiError, NetworkError } from '../lib/api';
import { db, getJson, setJson } from '../lib/localDb';
import {
  applyServerRow,
  markDone,
  markFailed,
  markRetryLater,
  markSending,
  notify,
  getOp,
  type Op,
  outboxCounts,
  pendingOps,
} from './store';

// Entities pulled from the server, in dependency order (breeds before animals before records).
const PULL_ENTITIES = [
  'cattle_breeds',
  'cattle',
  'milk_production',
  'vaccination_schedules',
  'animal_health_records',
  'veterinary_visits',
  'treatments',
  'breeding_records',
  'pregnancy_checks',
  'calving_records',
  'vaccination_records',
  // Finance: payments and stock before sales, so a sale's payment and stock movement are
  // never missing while the sale itself is already shown as synced.
  'customers',
  'milk_prices',
  'milk_stock_movements',
  'payments',
  'payment_allocations',
  'milk_sales',
  'farm_expenses',
] as const;

export interface SyncStatus {
  state: 'idle' | 'syncing' | 'offline' | 'attention';
  message: string | null;
  lastSyncedAt: string | null;
  pending: number; // saved on this phone, waiting to sync
  failed: number; // needs the farmer's attention
  photo: { recordId: string; fraction: number } | null;
}

// --- Status store -------------------------------------------------------------

let status: SyncStatus = {
  state: 'idle',
  message: null,
  lastSyncedAt: getJson<string>('sync.last'),
  ...outboxCounts(),
  photo: null,
};
const listeners = new Set<() => void>();

function setStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...outboxCounts(), ...patch };
  listeners.forEach((l) => l());
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status,
  );
}

/** After a local save: show "waiting to sync" at once and try to send it. */
export function syncSoon() {
  setStatus({});
  void runSync();
}

// --- Extra work after each pull (the account profile registers here) ----------

const pullHooks = new Set<() => Promise<void>>();
export function addPullHook(fn: () => Promise<void>) {
  pullHooks.add(fn);
  return () => pullHooks.delete(fn);
}

// --- Running a sync -----------------------------------------------------------

let running: Promise<void> | null = null;
let again = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

/** Starts a sync, or queues one more pass if a sync is already running. */
export function runSync(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      await cycle();
    } while (again);
  })().finally(() => {
    running = null;
    scheduleRetry();
  });
  return running;
}

async function cycle() {
  setStatus({ state: 'syncing', message: null });
  try {
    await push();
    await pull();
    for (const hook of pullHooks) await hook();
    const now = new Date().toISOString();
    setJson('sync.last', now);
    const { failed } = outboxCounts();
    setStatus({
      state: failed ? 'attention' : 'idle',
      message: failed ? `${failed} change${failed === 1 ? '' : 's'} could not be saved. Tap to review.` : null,
      lastSyncedAt: now,
    });
  } catch (err) {
    if (err instanceof NetworkError) setStatus({ state: 'offline', message: null });
    else setStatus({ state: 'attention', message: err instanceof Error ? err.message : 'Sync failed. Will retry.' });
  }
}

/** 2 s, 4 s, 8 s … capped at 5 minutes. */
const backoff = (attempts: number) => Math.min(5 * 60_000, 2000 * 2 ** Math.max(0, attempts - 1));

async function push() {
  // Ops for one record are sent strictly in order; a failed op blocks the ones after it.
  // Backoff only paces the automatic retry timer: an explicit sync (farmer tap, connectivity
  // back, new local change) tries everything at once.
  const blocked = new Set<string>();
  for (const { seq } of pendingOps()) {
    // Re-read: an earlier op's success may have moved this op's If-Match base forward.
    const op = getOp(seq);
    if (!op) continue;
    const key = `${op.entity}:${op.record_id}`;
    if (blocked.has(key)) continue;
    if (op.state === 'failed') {
      blocked.add(key);
      continue;
    }
    markSending(op);
    try {
      const row = op.kind === 'photo' ? await sendPhoto(op) : await send(op);
      markDone(op, row);
    } catch (err) {
      const retryable =
        err instanceof NetworkError || !(err instanceof ApiError) || err.status >= 500 || err.status === 429 || err.status === 401;
      if (retryable) {
        markRetryLater(op, backoff(op.attempts + 1));
        throw err; // stop pushing: the server is unreachable or unwell
      }
      markFailed(op, err.code, err.message, err.body);
      blocked.add(key);
    }
  }
}

function send(op: Op) {
  return api<{ id: string; version: number }>(op.path, {
    method: op.method,
    body: op.body ? JSON.parse(op.body) : undefined,
    ifMatch: op.if_match ?? undefined,
    idempotencyKey: op.op_id,
  });
}

/**
 * Photos go separately: get a signed URL, upload the file with progress, then confirm.
 * The op names its own endpoints (animal photos from Stage 3 queued only `local_uri`).
 */
async function sendPhoto(op: Op) {
  const body = JSON.parse(op.body ?? '{}') as { local_uri: string; upload_path?: string; confirm_path?: string };
  const { local_uri } = body;
  const uploadPath = body.upload_path ?? `/v1/cattle/${op.record_id}/photo-upload`;
  const confirmPath = body.confirm_path ?? `/v1/cattle/${op.record_id}/photo`;
  const file = new File(local_uri);
  if (!file.exists) throw new ApiError(400, 'photo_missing_locally', 'The photo file is no longer on this phone. Take it again.', {});

  const { path, upload_url } = await api<{ path: string; upload_url: string }>(uploadPath, { method: 'POST' });
  let result;
  try {
    result = await file.upload(upload_url, {
      httpMethod: 'PUT',
      uploadType: UploadType.BINARY_CONTENT,
      headers: { 'Content-Type': 'image/jpeg' },
      onProgress: ({ bytesSent, totalBytes }) =>
        setStatus({ photo: { recordId: op.record_id, fraction: totalBytes ? bytesSent / totalBytes : 0 } }),
    });
  } catch {
    throw new NetworkError('Photo upload interrupted.');
  } finally {
    setStatus({ photo: null });
  }
  if (result.status >= 300) {
    throw new ApiError(result.status >= 500 ? 503 : 400, 'upload_failed', 'The photo could not be uploaded (too large or not a JPEG/PNG).', {});
  }
  const row = await api<{ id: string; version: number }>(confirmPath, {
    method: 'POST',
    body: { path },
    idempotencyKey: op.op_id,
  });
  file.delete();
  return row;
}

async function pull() {
  for (const entity of PULL_ENTITIES) {
    let cursor = getJson<{ after: string; after_id: string }>(`cursor.${entity}`);
    for (;;) {
      const q = new URLSearchParams({ entity, limit: '200', ...(cursor ?? {}) });
      const page = await api<{ rows: { id: string }[]; next: { after: string; after_id: string } | null; has_more: boolean }>(
        `/v1/sync/pull?${q}`,
      );
      db.withTransactionSync(() => page.rows.forEach((row) => applyServerRow(entity, row)));
      if (page.next) {
        cursor = page.next;
        setJson(`cursor.${entity}`, cursor);
      }
      if (!page.has_more) break;
    }
  }
  notify();
}

/** Wakes the engine when the next backed-off op is due. */
function scheduleRetry() {
  if (retryTimer) clearTimeout(retryTimer);
  const due = pendingOps()
    .filter((o) => o.state === 'queued')
    .map((o) => o.next_attempt_at);
  if (!due.length) return;
  retryTimer = setTimeout(() => void runSync(), Math.max(1000, Math.min(...due) - Date.now()));
}

/** Sync when connectivity returns and when the app comes to the foreground. */
export function startSyncTriggers() {
  const net = NetInfo.addEventListener((s) => {
    if (s.isConnected && s.isInternetReachable !== false) void runSync();
  });
  const app = AppState.addEventListener('change', (s) => {
    if (s === 'active') void runSync();
  });
  return () => {
    net();
    app.remove();
    if (retryTimer) clearTimeout(retryTimer);
  };
}

/** After sign-out: forget the cached status of the previous farmer. */
export function resetSyncStatus() {
  setStatus({ state: 'idle', message: null, lastSyncedAt: null, photo: null });
}
