import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { harness } from './harness.js';

let h: Awaited<ReturnType<typeof harness>>;
let db: typeof h.db;
let storage: typeof h.storage;
let app: typeof h.app;
const farmer = () => h.farmer();

beforeAll(async () => {
  h = await harness();
  ({ db, storage, app } = h);
});

const cow = (extra: object = {}) => ({ id: randomUUID(), sex: 'female', ...extra });

describe('animal registration', () => {
  it('registers an animal with the client id and lists it', async () => {
    const { call } = await farmer();
    const body = cow({ ear_tag: 'ZM-001', name: 'Daisy', birth_date: '2022-03-15', weight_kg: '420.5', production_status: 'lactating' });
    const res = await call('POST', '/v1/cattle', body);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      id: body.id,
      ear_tag: 'ZM-001',
      birth_date: '2022-03-15', // exact date, no time-zone shift
      weight_kg: '420.50', // decimal string, fixed precision
      status: 'active',
      version: 1,
    });
    const list = await call('GET', '/v1/cattle');
    expect(list.json().map((c: { id: string }) => c.id)).toEqual([body.id]);
  });

  it('seeds the default breeds for a new farmer', async () => {
    const { call } = await farmer();
    const names = (await call('GET', '/v1/breeds')).json().map((b: { name: string }) => b.name);
    expect(names).toEqual(expect.arrayContaining(['Friesian', 'Jersey', 'Ayrshire', 'Guernsey']));
  });

  it('rejects a duplicate ear tag for the same farmer, but not across farmers', async () => {
    const a = await farmer();
    const b = await farmer();
    expect((await a.call('POST', '/v1/cattle', cow({ ear_tag: 'T-7' }))).statusCode).toBe(201);
    const dup = await a.call('POST', '/v1/cattle', cow({ ear_tag: 'T-7' }));
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toMatchObject({ error: 'ear_tag_taken', field: 'ear_tag' });
    expect((await b.call('POST', '/v1/cattle', cow({ ear_tag: 'T-7' }))).statusCode).toBe(201);
  });

  it('allows several animals without an ear tag', async () => {
    const { call } = await farmer();
    expect((await call('POST', '/v1/cattle', cow({ ear_tag: '' }))).json().ear_tag).toBeNull();
    expect((await call('POST', '/v1/cattle', cow())).statusCode).toBe(201);
  });

  it('replays a retried request instead of creating it twice', async () => {
    const { call } = await farmer();
    const body = cow({ ear_tag: 'R-1' });
    const key = randomUUID();
    const first = await call('POST', '/v1/cattle', body, { 'idempotency-key': key });
    const retry = await call('POST', '/v1/cattle', body, { 'idempotency-key': key });
    expect(retry.statusCode).toBe(201);
    expect(retry.json()).toEqual(first.json());
    expect((await call('GET', '/v1/cattle')).json()).toHaveLength(1);

    const reused = await call('POST', '/v1/cattle', cow(), { 'idempotency-key': key });
    expect(reused.statusCode).toBe(422);
  });

  it('requires an idempotency key on writes', async () => {
    const { authId } = await farmer();
    const res = await app.inject({ method: 'POST', url: '/v1/cattle', payload: cow(), headers: { authorization: `Bearer valid-${authId}` } });
    expect(res.statusCode).toBe(428);
  });

  it.each([
    [{ reproductive_status: 'pregnant' }, 'reproductive_status'],
    [{ birth_date: '2999-01-01' }, 'birth_date'],
    [{ weight_kg: '-3' }, 'weight_kg'],
    [{ purchase_price: '1200.123' }, 'purchase_price'],
    [{ owner_id: randomUUID() }, ''],
  ])('rejects %j', async (extra, field) => {
    const { call } = await farmer();
    const res = await call('POST', '/v1/cattle', cow(extra));
    expect(res.statusCode).toBe(400);
    expect(res.json().field).toBe(field);
  });

  it('checks parents: in this herd and the right sex', async () => {
    const a = await farmer();
    const b = await farmer();
    const dam = cow();
    const bull = cow({ sex: 'male' });
    await a.call('POST', '/v1/cattle', dam);
    await a.call('POST', '/v1/cattle', bull);
    const otherFarmsCow = cow();
    await b.call('POST', '/v1/cattle', otherFarmsCow);

    expect((await a.call('POST', '/v1/cattle', cow({ dam_id: dam.id, sire_id: bull.id }))).statusCode).toBe(201);
    expect((await a.call('POST', '/v1/cattle', cow({ dam_id: bull.id }))).json().field).toBe('dam_id');
    expect((await a.call('POST', '/v1/cattle', cow({ sire_id: dam.id }))).json().field).toBe('sire_id');
    expect((await a.call('POST', '/v1/cattle', cow({ dam_id: otherFarmsCow.id }))).json().field).toBe('dam_id');
  });
});

describe('editing and status', () => {
  it('updates with If-Match and rejects a stale version with the current row', async () => {
    const { call } = await farmer();
    const c = cow({ name: 'Daisy' });
    await call('POST', '/v1/cattle', c);
    const ok = await call('PATCH', `/v1/cattle/${c.id}`, { name: 'Daisy II' }, { 'if-match': '1' });
    expect(ok.json()).toMatchObject({ name: 'Daisy II', version: 2 });
    const stale = await call('PATCH', `/v1/cattle/${c.id}`, { name: 'Other' }, { 'if-match': '1' });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: 'version_conflict', current: { name: 'Daisy II', version: 2 } });
  });

  it('records a sale with a date and keeps the animal and its history', async () => {
    const { call } = await farmer();
    const c = cow({ ear_tag: 'S-1' });
    await call('POST', '/v1/cattle', c);
    const noDate = await call('POST', `/v1/cattle/${c.id}/status`, { status: 'sold' }, { 'if-match': '1' });
    expect(noDate.json().field).toBe('status_date');

    const sold = await call('POST', `/v1/cattle/${c.id}/status`, { status: 'sold', status_date: '2026-10-01', status_details: 'Sold to Mr Phiri' }, { 'if-match': '1' });
    expect(sold.json()).toMatchObject({ status: 'sold', status_date: '2026-10-01', status_details: 'Sold to Mr Phiri' });

    const back = await call('POST', `/v1/cattle/${c.id}/status`, { status: 'active' }, { 'if-match': '2' });
    expect(back.json().field).toBe('reason');
    const reactivated = await call('POST', `/v1/cattle/${c.id}/status`, { status: 'active', reason: 'Sale cancelled' }, { 'if-match': '2' });
    expect(reactivated.json()).toMatchObject({ status: 'active', status_date: null });

    const events = (await call('GET', `/v1/cattle/${c.id}/timeline`)).json();
    expect(events.map((e: { title: string }) => e.title)).toEqual(['Back to active', 'Sold', 'Registered']);
    expect(events[0].detail).toBe('Sale cancelled');
  });
});

describe('deletion', () => {
  it('soft-deletes an animal with no history and frees its ear tag', async () => {
    const { call } = await farmer();
    const c = cow({ ear_tag: 'D-1' });
    await call('POST', '/v1/cattle', c);
    const del = await call('DELETE', `/v1/cattle/${c.id}`, undefined, { 'if-match': '1' });
    expect(del.statusCode).toBe(200);
    expect((await call('GET', '/v1/cattle')).json()).toHaveLength(0);
    expect((await call('GET', `/v1/cattle/${c.id}`)).statusCode).toBe(404);
    // Other phones learn about the deletion through sync.
    const pulled = (await call('GET', '/v1/sync/pull?entity=cattle')).json().rows;
    expect(pulled[0]).toMatchObject({ id: c.id });
    expect(pulled[0].deleted_at).not.toBeNull();
    expect((await call('POST', '/v1/cattle', cow({ ear_tag: 'D-1' }))).statusCode).toBe(201);
  });

  it('refuses to delete an animal with linked records', async () => {
    const { call } = await farmer();
    const c = cow();
    const created = await call('POST', '/v1/cattle', c);
    const { rows } = await db.query('select owner_id from public.cattle where id = $1', [c.id]);
    await db.query(
      `insert into public.milk_production (owner_id, cattle_id, production_date, session, quantity) values ($1, $2, '2026-10-20', 'morning', 12)`,
      [rows[0].owner_id, c.id],
    );
    const del = await call('DELETE', `/v1/cattle/${c.id}`, undefined, { 'if-match': String(created.json().version) });
    expect(del.statusCode).toBe(409);
    expect(del.json().error).toBe('has_history');
  });
});

describe('owner isolation', () => {
  it('hides other farmers’ animals on every route', async () => {
    const a = await farmer();
    const b = await farmer();
    const c = cow({ ear_tag: 'PRIVATE' });
    await a.call('POST', '/v1/cattle', c);

    expect((await b.call('GET', `/v1/cattle/${c.id}`)).statusCode).toBe(404);
    expect((await b.call('PATCH', `/v1/cattle/${c.id}`, { name: 'Mine' }, { 'if-match': '1' })).statusCode).toBe(404);
    expect((await b.call('POST', `/v1/cattle/${c.id}/status`, { status: 'sold', status_date: '2026-10-01' }, { 'if-match': '1' })).statusCode).toBe(404);
    expect((await b.call('DELETE', `/v1/cattle/${c.id}`, undefined, { 'if-match': '1' })).statusCode).toBe(404);
    expect((await b.call('GET', `/v1/cattle/${c.id}/timeline`)).statusCode).toBe(404);
    expect((await b.call('POST', `/v1/cattle/${c.id}/photo-upload`)).statusCode).toBe(404);
    expect((await b.call('GET', '/v1/cattle')).json()).toHaveLength(0);
    expect((await b.call('GET', '/v1/sync/pull?entity=cattle')).json().rows).toHaveLength(0);
    // The id cannot be claimed by another farmer either.
    expect((await b.call('POST', '/v1/cattle', { ...c, ear_tag: 'X' })).statusCode).toBe(409);
  });
});

describe('photos', () => {
  it('issues an owner-scoped path, confirms only finished uploads, and replaces the old photo', async () => {
    const { call } = await farmer();
    const c = cow();
    await call('POST', '/v1/cattle', c);

    const first = (await call('POST', `/v1/cattle/${c.id}/photo-upload`)).json();
    expect(first.path).toMatch(new RegExp(`/${c.id}/[0-9a-f-]+\\.jpg$`));
    expect((await call('POST', `/v1/cattle/${c.id}/photo`, { path: first.path })).json().error).toBe('photo_missing');

    storage.upload(first.path);
    expect((await call('POST', `/v1/cattle/${c.id}/photo`, { path: first.path })).json().photo_path).toBe(first.path);
    expect((await call('GET', `/v1/cattle/${c.id}/photo-url`)).json().url).toContain(first.path);

    const second = (await call('POST', `/v1/cattle/${c.id}/photo-upload`)).json();
    storage.upload(second.path);
    await call('POST', `/v1/cattle/${c.id}/photo`, { path: second.path });
    expect(storage.removed).toContain(first.path);
  });

  it('rejects a path outside this animal’s folder', async () => {
    const { call } = await farmer();
    const c = cow();
    await call('POST', '/v1/cattle', c);
    const res = await call('POST', `/v1/cattle/${c.id}/photo`, { path: `someone-else/${c.id}/x.jpg` });
    expect(res.json().field).toBe('path');
  });
});

describe('sync pull', () => {
  it('pages by cursor without repeating or skipping rows', async () => {
    const { call } = await farmer();
    const ids = [cow(), cow(), cow()];
    for (const c of ids) await call('POST', '/v1/cattle', c);

    const page1 = (await call('GET', '/v1/sync/pull?entity=cattle&limit=2')).json();
    expect(page1.rows).toHaveLength(2);
    const { after, after_id } = page1.next;
    const page2 = (await call('GET', `/v1/sync/pull?entity=cattle&limit=2&after=${encodeURIComponent(after)}&after_id=${after_id}`)).json();
    expect(page2.rows).toHaveLength(1);
    expect(page2.has_more).toBe(false);
    // Nothing new after the final cursor.
    const empty = (await call('GET', `/v1/sync/pull?entity=cattle&after=${encodeURIComponent(page2.next.after)}&after_id=${page2.next.after_id}`)).json();
    expect(empty).toEqual({ rows: [], next: null, has_more: false });
    const seen = [...page1.rows, ...page2.rows].map((r: { id: string }) => r.id).sort();
    expect(seen).toEqual(ids.map((c) => c.id).sort());
  });

  it('writes an audit entry for each change', async () => {
    const { call } = await farmer();
    const c = cow();
    await call('POST', '/v1/cattle', c);
    await call('PATCH', `/v1/cattle/${c.id}`, { name: 'Bella' }, { 'if-match': '1' });
    const { rows } = await db.query(`select action, before_data, after_data from public.audit_logs where entity_id = $1 order by id`, [c.id]);
    expect(rows.map((r) => r.action)).toEqual(['cattle.created', 'cattle.updated']);
    expect(rows[1]).toMatchObject({ before_data: { name: null }, after_data: { name: 'Bella' } });
  });
});
