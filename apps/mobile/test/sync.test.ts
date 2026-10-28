import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDatabase } from './shims/expo-sqlite';
import { createServer } from './fakeServer';

// The real store and engine run against real SQLite; only the HTTP API is faked.
let server: ReturnType<typeof createServer>;
vi.mock('../src/lib/api', async () => {
  const { ApiError, NetworkError } = await import('./fakeServer');
  return { ApiError, NetworkError, api: (path: string, options: object) => server.api(path, options) };
});

type Modules = {
  store: typeof import('../src/sync/store');
  engine: typeof import('../src/sync/engine');
};

/** Loads the app modules fresh, as on app start. The SQLite database is kept. */
async function startApp(): Promise<Modules> {
  vi.resetModules();
  return { store: await import('../src/sync/store'), engine: await import('../src/sync/engine') };
}

let app: Modules;
beforeEach(async () => {
  resetDatabase();
  server = createServer();
  app = await startApp();
});

function register(fields: Record<string, unknown> = {}) {
  const id = crypto.randomUUID();
  const data = { id, sex: 'female', status: 'active', version: 0, deleted_at: null, ...fields };
  app.store.saveLocal('cattle', id, data, { kind: 'create', method: 'POST', path: '/v1/cattle', body: { id, sex: 'female', ...fields } });
  return id;
}

function edit(id: string, changes: Record<string, unknown>) {
  const current = app.store.getRecord<{ version: number }>('cattle', id)!;
  app.store.saveLocal('cattle', id, { ...current.data, ...changes }, {
    kind: 'update',
    method: 'PATCH',
    path: `/v1/cattle/${id}`,
    body: changes,
    ifMatch: current.data.version,
  });
}

const local = (id: string) => app.store.getRecord<Record<string, unknown>>('cattle', id);

describe('offline queue', () => {
  it('keeps records made offline on the phone and syncs them once when back online', async () => {
    server.online = false;
    const id = register({ ear_tag: 'A-1' });
    await app.engine.runSync();
    expect(local(id)?.sync_state).toBe('pending');
    expect(server.rows.size).toBe(0);

    server.online = true;
    await app.engine.runSync();
    expect(local(id)).toMatchObject({ sync_state: 'synced', data: { ear_tag: 'A-1', version: 1 } });
    expect(server.rows.size).toBe(1);
    expect(app.store.outboxCounts()).toEqual({ pending: 0, failed: 0 });
  });

  it('does not duplicate a record when the response was lost and the app restarted', async () => {
    const id = register({ ear_tag: 'B-1' });
    server.loseNextResponse = true;
    await app.engine.runSync(); // applied on the server, but the phone never heard back
    expect(local(id)?.sync_state).toBe('pending');

    app = await startApp(); // app killed and reopened
    await app.engine.runSync();
    expect(server.rows.size).toBe(1);
    expect(local(id)).toMatchObject({ sync_state: 'synced', data: { version: 1 } });
  });

  it('resends an op that was in flight when the app was killed', async () => {
    const id = register();
    const [op] = app.store.pendingOps();
    app.store.markSending(op);
    app = await startApp();
    expect(app.store.pendingOps()[0].state).toBe('queued');
    await app.engine.runSync();
    expect(server.rows.get(id)).toBeDefined();
  });

  it('folds edits made before the first sync into the create', async () => {
    server.online = false;
    const id = register({ name: 'Daisy' });
    edit(id, { name: 'Daisy II', ear_tag: 'C-1' });
    expect(app.store.pendingOps()).toHaveLength(1);

    server.online = true;
    await app.engine.runSync();
    expect(server.writes).toBe(1);
    expect(server.rows.get(id)).toMatchObject({ name: 'Daisy II', ear_tag: 'C-1', version: 1 });
  });

  it('merges consecutive offline edits into one update with the right version', async () => {
    const id = register();
    await app.engine.runSync();
    server.online = false;
    edit(id, { name: 'One' });
    edit(id, { weight_kg: '400.00' });
    expect(app.store.pendingOps()).toHaveLength(1);

    server.online = true;
    await app.engine.runSync();
    expect(server.rows.get(id)).toMatchObject({ name: 'One', weight_kg: '400.00', version: 2 });
    expect(local(id)?.sync_state).toBe('synced');
  });

  it('sends a later change with the version returned by the earlier one', async () => {
    const id = register();
    await app.engine.runSync();
    edit(id, { name: 'X' });
    app.store.saveLocal('cattle', id, { ...local(id)!.data, status: 'sold' }, {
      kind: 'status',
      method: 'POST',
      path: `/v1/cattle/${id}/status`,
      body: { status: 'sold' },
      ifMatch: 1,
    });
    await app.engine.runSync();
    expect(server.rows.get(id)).toMatchObject({ name: 'X', status: 'sold', version: 3 });
    expect(app.store.outboxCounts().failed).toBe(0);
  });

  it('drops an unsynced record entirely when it is deleted before syncing', async () => {
    server.online = false;
    const id = register();
    expect(app.store.deleteUnsynced('cattle', id)).toBe(true);
    server.online = true;
    await app.engine.runSync();
    expect(server.writes).toBe(0);
    expect(local(id)).toBeNull();
  });
});

describe('rejections and conflicts', () => {
  it('flags a duplicate ear tag on that record only, and keeps syncing the others', async () => {
    const first = register({ ear_tag: 'DUP' });
    await app.engine.runSync();
    server.online = false;
    const dup = register({ ear_tag: 'DUP' });
    const fine = register({ ear_tag: 'OK-1' });

    server.online = true;
    await app.engine.runSync();
    expect(local(dup)?.sync_state).toBe('attention');
    expect(app.store.failedOps()[0]).toMatchObject({ record_id: dup, error_code: 'ear_tag_taken' });
    expect(local(fine)?.sync_state).toBe('synced');
    expect(local(first)?.sync_state).toBe('synced');

    // The farmer fixes the tag: the failed create is resent with the new value.
    edit(dup, { ear_tag: 'DUP-2' });
    await app.engine.runSync();
    expect(local(dup)).toMatchObject({ sync_state: 'synced', data: { ear_tag: 'DUP-2' } });
  });

  it('keeps both versions on a conflicting edit until the farmer chooses', async () => {
    const id = register({ name: 'Original' });
    await app.engine.runSync();
    server.editElsewhere(id, { name: 'From other phone' });
    edit(id, { name: 'From this phone' });
    await app.engine.runSync();

    const [op] = app.store.failedOps();
    expect(op.error_code).toBe('version_conflict');
    expect(JSON.parse(op.error_body!).current.name).toBe('From other phone');
    expect(local(id)?.data.name).toBe('From this phone'); // nothing silently overwritten

    app.store.requeue(op, 2); // "Keep my version"
    await app.engine.runSync();
    expect(server.rows.get(id)).toMatchObject({ name: 'From this phone', version: 3 });
    expect(local(id)?.sync_state).toBe('synced');
  });

  it('restores the saved version when the farmer discards their change', async () => {
    const id = register({ name: 'Original' });
    await app.engine.runSync();
    server.editElsewhere(id, { name: 'From other phone' });
    edit(id, { name: 'Mine' });
    await app.engine.runSync();

    const [op] = app.store.failedOps();
    app.store.discardChanges('cattle', id, JSON.parse(op.error_body!).current);
    expect(local(id)).toMatchObject({ sync_state: 'synced', data: { name: 'From other phone' } });
    expect(app.store.outboxCounts()).toEqual({ pending: 0, failed: 0 });
  });
});

describe('pull', () => {
  it('brings in changes from other devices but never overwrites unsent local edits', async () => {
    const a = register({ name: 'A' });
    const b = register({ name: 'B' });
    await app.engine.runSync();
    server.editElsewhere(a, { name: 'A from server' });
    server.editElsewhere(b, { name: 'B from server' });

    server.online = false;
    edit(b, { name: 'B local' });
    server.online = true;
    // Pull runs before the queued edit is pushed again only if push fails; force that order:
    server.loseNextResponse = false;
    await app.engine.runSync();

    expect(local(a)?.data.name).toBe('A from server');
    // b's edit hit a version conflict (server moved on) and is kept for the farmer to resolve.
    expect(local(b)?.data.name).toBe('B local');
    expect(local(b)?.sync_state).toBe('attention');
  });

  it('removes animals deleted on another device', async () => {
    const id = register();
    await app.engine.runSync();
    const row = server.rows.get(id)!;
    server.rows.set(id, { ...row, deleted_at: new Date().toISOString(), version: row.version + 1, _seq: 999 });
    await app.engine.runSync();
    expect(local(id)).toBeNull();
  });
});

describe('milk corrections before the first sync', () => {
  it('folds a correction into the create, without the reason, since the server never saw the old value', () => {
    const id = crypto.randomUUID();
    const body = { id, cattle_id: 'c', production_date: '2026-10-05', session: 'morning', quantity: '12' };
    app.store.saveLocal('milk_production', id, { ...body, status: 'valid', version: 0 }, { kind: 'create', method: 'POST', path: '/v1/milk-production', body });
    app.store.saveLocal('milk_production', id, { ...body, quantity: '10', status: 'valid', version: 0 }, {
      kind: 'correct',
      method: 'POST',
      path: `/v1/milk-production/${id}/correct`,
      body: { quantity: '10', reason: 'Misread' },
      ifMatch: 0,
    });
    const ops = app.store.pendingOps();
    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('create');
    expect(JSON.parse(ops[0].body!)).toEqual({ ...body, quantity: '10' });
  });

  it('removes an unsynced entry entirely when it is voided', () => {
    const id = crypto.randomUUID();
    app.store.saveLocal('milk_production', id, { id, status: 'valid', version: 0 }, { kind: 'create', method: 'POST', path: '/v1/milk-production', body: { id } });
    expect(app.store.deleteUnsynced('milk_production', id)).toBe(true);
    expect(app.store.pendingOps()).toHaveLength(0);
    expect(app.store.getRecord('milk_production', id)).toBeNull();
  });
});

describe('records created by another queued change', () => {
  it('shows a pending copy until the server sends the real one', () => {
    app.store.putPending('milk_sales', 'new-sale', { id: 'new-sale', total: '80.00' });
    expect(app.store.getRecord('milk_sales', 'new-sale')).toMatchObject({ sync_state: 'pending', data: { total: '80.00' } });
    expect(app.store.pendingOps()).toHaveLength(0); // nothing of its own to send
    app.store.applyServerRow('milk_sales', { id: 'new-sale', total: '80.00', status: 'completed' } as never);
    expect(app.store.getRecord('milk_sales', 'new-sale')?.sync_state).toBe('synced');
  });
});

describe('photo upload progress', () => {
  it('works with the BigInt byte counts the phone reports', async () => {
    const { engine } = await startApp();
    expect(engine.uploadFraction(BigInt(50), BigInt(200))).toBe(0.25);
    expect(engine.uploadFraction(BigInt(300), BigInt(200))).toBe(1);
    expect(engine.uploadFraction(10, 0)).toBe(0);
    expect(Math.round(engine.uploadFraction(BigInt(1), BigInt(3)) * 100)).toBe(33);
  });
});
