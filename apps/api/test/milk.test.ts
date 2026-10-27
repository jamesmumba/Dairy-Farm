import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { harness } from './harness.js';

let h: Awaited<ReturnType<typeof harness>>;
beforeAll(async () => {
  h = await harness();
});

/** A farmer with one cow (or the given animal) registered. */
async function farmWithCow(animal: object = {}) {
  const f = await h.farmer();
  const cowId = randomUUID();
  const res = await f.call('POST', '/v1/cattle', { id: cowId, sex: 'female', production_status: 'lactating', ...animal });
  expect(res.statusCode).toBe(201);
  return { ...f, cowId };
}

const entry = (cattle_id: string, extra: object = {}) => ({
  id: randomUUID(),
  cattle_id,
  production_date: '2026-10-05',
  session: 'morning',
  quantity: '12',
  ...extra,
});

/** Sum of stock movements, optionally for one date: the saleable litres the ledger holds. */
async function stock(ownerId: string, date?: string) {
  const { rows } = await h.db.query(
    `select coalesce(sum(quantity), 0)::text as litres from public.milk_stock_movements
     where owner_id = $1 and ($2::date is null or movement_date = $2)`,
    [ownerId, date ?? null],
  );
  return rows[0].litres as string;
}

describe('recording milk', () => {
  it('stores session yields with exact decimals; the daily yield is their sum (spec: 12 L + 8 L = 20 L)', async () => {
    const f = await farmWithCow();
    const m = await f.call('POST', '/v1/milk-production', entry(f.cowId, { quantity: '12' }));
    const a = await f.call('POST', '/v1/milk-production', entry(f.cowId, { session: 'afternoon', quantity: '8' }));
    expect(m.statusCode).toBe(201);
    expect(m.json()).toMatchObject({ quantity: '12.00', production_date: '2026-10-05', restricted: false, status: 'valid', version: 1 });
    expect(a.json().quantity).toBe('8.00');

    const { rows } = await h.db.query(
      `select sum(quantity)::text as daily from public.milk_production where cattle_id = $1 and production_date = '2026-10-05' and status = 'valid'`,
      [f.cowId],
    );
    expect(rows[0].daily).toBe('20.00');
    expect(await stock(await f.ownerId())).toBe('20.00');
  });

  it('rejects a second entry for the same cow, date and session, returning the existing one', async () => {
    const f = await farmWithCow();
    const first = (await f.call('POST', '/v1/milk-production', entry(f.cowId))).json();
    const dup = await f.call('POST', '/v1/milk-production', entry(f.cowId, { quantity: '5' }));
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toMatchObject({ error: 'session_exists', existing: { id: first.id, quantity: '12.00' } });
  });

  it.each([['0'], ['-1'], ['150'], ['12.345'], ['twelve']])('rejects quantity %s', async (quantity) => {
    const f = await farmWithCow();
    const res = await f.call('POST', '/v1/milk-production', entry(f.cowId, { quantity }));
    expect(res.statusCode).toBe(400);
    expect(res.json().field).toBe('quantity');
  });

  it('rejects future dates, males, and dates after the animal left the farm', async () => {
    const f = await farmWithCow();
    expect((await f.call('POST', '/v1/milk-production', entry(f.cowId, { production_date: '2999-01-01' }))).json().field).toBe('production_date');

    const bull = randomUUID();
    await f.call('POST', '/v1/cattle', { id: bull, sex: 'male' });
    expect((await f.call('POST', '/v1/milk-production', entry(bull))).json().field).toBe('cattle_id');

    await f.call('POST', `/v1/cattle/${f.cowId}/status`, { status: 'sold', status_date: '2026-10-03' }, { 'if-match': '1' });
    expect((await f.call('POST', '/v1/milk-production', entry(f.cowId, { production_date: '2026-10-04' }))).json().field).toBe('production_date');
    expect((await f.call('POST', '/v1/milk-production', entry(f.cowId, { production_date: '2026-10-02' }))).statusCode).toBe(201);
  });

  it('does not record twice when a request is retried', async () => {
    const f = await farmWithCow();
    const body = entry(f.cowId);
    const key = randomUUID();
    await f.call('POST', '/v1/milk-production', body, { 'idempotency-key': key });
    const retry = await f.call('POST', '/v1/milk-production', body, { 'idempotency-key': key });
    expect(retry.statusCode).toBe(201);
    expect((await f.call('GET', '/v1/milk-production')).json()).toHaveLength(1);
    expect(await stock(await f.ownerId())).toBe('12.00');
  });
});

describe('corrections and voids', () => {
  it('corrects with a reason, keeps the old value in the audit log, and adjusts stock', async () => {
    const f = await farmWithCow();
    const e = (await f.call('POST', '/v1/milk-production', entry(f.cowId))).json();

    expect((await f.call('POST', `/v1/milk-production/${e.id}/correct`, { quantity: '10' }, { 'if-match': '1' })).json().field).toBe('reason');
    const fixed = await f.call('POST', `/v1/milk-production/${e.id}/correct`, { quantity: '10', reason: 'Misread the bucket' }, { 'if-match': '1' });
    expect(fixed.json()).toMatchObject({ quantity: '10.00', version: 2 });

    const { rows } = await h.db.query(`select action, reason, before_data, after_data from public.audit_logs where entity_id = $1 order by id`, [e.id]);
    expect(rows[1]).toMatchObject({
      action: 'milk_production.corrected',
      reason: 'Misread the bucket',
      before_data: { quantity: '12.00' },
      after_data: { quantity: '10.00' },
    });
    expect(await stock(await f.ownerId())).toBe('10.00');

    const stale = await f.call('POST', `/v1/milk-production/${e.id}/correct`, { quantity: '9', reason: 'Again' }, { 'if-match': '1' });
    expect(stale.json().error).toBe('version_conflict');
  });

  it('moves stock to the new date when the date is corrected', async () => {
    const f = await farmWithCow();
    const e = (await f.call('POST', '/v1/milk-production', entry(f.cowId))).json();
    await f.call('POST', `/v1/milk-production/${e.id}/correct`, { production_date: '2026-10-06', reason: 'Wrong day' }, { 'if-match': '1' });
    const owner = await f.ownerId();
    expect(await stock(owner, '2026-10-05')).toBe('0.00');
    expect(await stock(owner, '2026-10-06')).toBe('12.00');
  });

  it('will not correct into a session that is already recorded', async () => {
    const f = await farmWithCow();
    await f.call('POST', '/v1/milk-production', entry(f.cowId));
    const pm = (await f.call('POST', '/v1/milk-production', entry(f.cowId, { session: 'evening' }))).json();
    const res = await f.call('POST', `/v1/milk-production/${pm.id}/correct`, { session: 'morning', reason: 'Wrong session' }, { 'if-match': '1' });
    expect(res.json().error).toBe('session_exists');
  });

  it('voids an entry: kept, excluded from stock, the session can be entered again', async () => {
    const f = await farmWithCow();
    const e = (await f.call('POST', '/v1/milk-production', entry(f.cowId))).json();
    const voided = await f.call('POST', `/v1/milk-production/${e.id}/void`, { reason: 'Entered for the wrong cow' }, { 'if-match': '1' });
    expect(voided.json()).toMatchObject({ status: 'voided', void_reason: 'Entered for the wrong cow' });
    expect(await stock(await f.ownerId())).toBe('0.00');

    const again = await f.call('POST', `/v1/milk-production/${e.id}/correct`, { quantity: '1', reason: 'Try' }, { 'if-match': '2' });
    expect(again.json().error).toBe('voided');
    expect((await f.call('POST', '/v1/milk-production', entry(f.cowId, { quantity: '11' }))).statusCode).toBe(201);
    expect(await stock(await f.ownerId())).toBe('11.00');
  });
});

describe('milk withdrawal', () => {
  it('marks sessions before the vet’s end time as restricted and keeps them out of stock, even after treatment ends', async () => {
    const f = await farmWithCow();
    const owner = await f.ownerId();
    // Withdrawal ends 10:00 Lusaka time (08:00 UTC) on 10 Oct; the treatment itself finished on the 3rd.
    await h.db.query(
      `insert into public.treatments (owner_id, cattle_id, medication, started_on, completed_on, requires_milk_withdrawal, withdrawal_ends_at)
       values ($1, $2, 'Oxytetracycline', '2026-10-01', '2026-10-03', true, '2026-10-10T08:00:00Z')`,
      [owner, f.cowId],
    );
    const morning = (await f.call('POST', '/v1/milk-production', entry(f.cowId, { production_date: '2026-10-10', session: 'morning' }))).json();
    const afternoon = (await f.call('POST', '/v1/milk-production', entry(f.cowId, { production_date: '2026-10-10', session: 'afternoon', quantity: '9' }))).json();
    const before = (await f.call('POST', '/v1/milk-production', entry(f.cowId, { production_date: '2026-09-30', quantity: '7' }))).json();

    expect(morning.restricted).toBe(true); // 06:00 < 10:00
    expect(afternoon.restricted).toBe(false); // 12:00 > 10:00
    expect(before.restricted).toBe(false); // before the treatment started
    expect(await stock(owner)).toBe('16.00'); // 9 + 7, not the 12 restricted litres

    // Correcting a restricted entry to another day re-evaluates the restriction.
    await f.call('POST', `/v1/milk-production/${morning.id}/correct`, { production_date: '2026-10-11', reason: 'Wrong day' }, { 'if-match': '1' });
    expect(await stock(owner)).toBe('28.00');
  });
});

describe('owner isolation and sync', () => {
  it('keeps one farmer’s milk records away from another', async () => {
    const a = await farmWithCow();
    const b = await h.farmer();
    const e = (await a.call('POST', '/v1/milk-production', entry(a.cowId))).json();
    expect((await b.call('POST', '/v1/milk-production', entry(a.cowId))).json().field).toBe('cattle_id');
    expect((await b.call('POST', `/v1/milk-production/${e.id}/correct`, { quantity: '1', reason: 'mine' }, { 'if-match': '1' })).statusCode).toBe(404);
    expect((await b.call('POST', `/v1/milk-production/${e.id}/void`, { reason: 'mine' }, { 'if-match': '1' })).statusCode).toBe(404);
    expect((await b.call('GET', '/v1/milk-production')).json()).toHaveLength(0);
    expect((await b.call('GET', '/v1/sync/pull?entity=milk_production')).json().rows).toHaveLength(0);
  });

  it('includes milk entries, voided ones too, in the sync pull', async () => {
    const f = await farmWithCow();
    const e = (await f.call('POST', '/v1/milk-production', entry(f.cowId))).json();
    await f.call('POST', `/v1/milk-production/${e.id}/void`, { reason: 'Mistake' }, { 'if-match': '1' });
    const rows = (await f.call('GET', '/v1/sync/pull?entity=milk_production')).json().rows;
    expect(rows).toEqual([expect.objectContaining({ id: e.id, status: 'voided' })]);
  });

  it('shows daily milk totals on the animal timeline', async () => {
    const f = await farmWithCow();
    await f.call('POST', '/v1/milk-production', entry(f.cowId, { quantity: '12' }));
    await f.call('POST', '/v1/milk-production', entry(f.cowId, { session: 'afternoon', quantity: '8' }));
    const events = (await f.call('GET', `/v1/cattle/${f.cowId}/timeline`)).json();
    expect(events.find((e: { kind: string }) => e.kind === 'milk')).toMatchObject({ title: 'Milk 20.00 L', detail: 'afternoon, morning' });
  });
});
