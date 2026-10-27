import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { runIntegrityChecks } from '../src/integrity.js';
import { harness } from './harness.js';

let h: Awaited<ReturnType<typeof harness>>;
const ids: Record<string, string> = {};
let owner = '';

// A realistic month: milk, a withdrawal re-check, corrections, voids, sales, payments,
// a refund, a sale correction, milk use and a reversal — all through the API.
beforeAll(async () => {
  h = await harness();
  const f = await h.farmer();
  owner = await f.ownerId();
  const post = (url: string, body: object, headers: Record<string, string> = {}) => f.call('POST', url, { id: randomUUID(), ...body }, headers);
  ids.cow = randomUUID();
  await f.call('POST', '/v1/cattle', { id: ids.cow, sex: 'female' });
  ids.m1 = (await post('/v1/milk-production', { cattle_id: ids.cow, production_date: '2026-10-05', session: 'morning', quantity: '20' })).json().id;
  ids.m2 = (await post('/v1/milk-production', { cattle_id: ids.cow, production_date: '2026-10-06', session: 'morning', quantity: '15' })).json().id;
  await f.call('POST', `/v1/milk-production/${ids.m2}/correct`, { quantity: '14', production_date: '2026-10-07', reason: 'Wrong day' }, { 'if-match': '1' });
  ids.m3 = (await post('/v1/milk-production', { cattle_id: ids.cow, production_date: '2026-10-08', session: 'morning', quantity: '9' })).json().id;
  await f.call('POST', `/v1/milk-production/${ids.m3}/void`, { reason: 'Mistake' }, { 'if-match': '1' });
  await post('/v1/treatments', { cattle_id: ids.cow, medication: 'X', started_on: '2026-10-04', requires_milk_withdrawal: true, withdrawal_ends_at: '2026-10-05T23:00:00Z' });
  const customer = randomUUID();
  await f.call('POST', '/v1/customers', { id: customer, name: 'Mrs Phiri' });
  await post('/v1/milk-prices', { currency: 'ZMW', price_per_litre: '10', effective_from: '2026-01-01T00:00:00Z' });
  await post('/v1/stock/movements', { kind: 'opening_balance', quantity: '50', movement_date: '2026-10-01', reason: 'Counted' });
  const s1 = (await post('/v1/milk-sales', { customer_id: customer, sale_at: '2026-10-07T10:00:00Z', quantity: '5', currency: 'ZMW', amount_paid: '20', payment_method: 'cash' })).json();
  const s2 = (await post('/v1/milk-sales', { customer_id: customer, sale_at: '2026-10-07T11:00:00Z', quantity: '3', currency: 'ZMW' })).json();
  await f.call('POST', `/v1/milk-sales/${s1.id}/correct`, { new_id: randomUUID(), quantity: '4', reason: 'Returned 1 L' });
  await f.call('POST', `/v1/milk-sales/${s2.id}/void`, { reason: 'Cancelled' });
  await post('/v1/payments', { customer_id: customer, kind: 'payment', amount: '50', currency: 'ZMW', method: 'cash', paid_at: '2026-10-08T10:00:00Z' });
  await post('/v1/payments', { customer_id: customer, kind: 'refund', amount: '10', currency: 'ZMW', method: 'cash', paid_at: '2026-10-09T10:00:00Z', reason: 'Overpaid' });
  const use = (await post('/v1/stock/movements', { kind: 'spoilage', quantity: '2', movement_date: '2026-10-07' })).json();
  await f.call('POST', `/v1/stock/movements/${use.id}/reverse`, { id: randomUUID(), reason: 'Entered twice' });
});

describe('integrity checks', () => {
  it('ran against a real month of records (the setup succeeded)', async () => {
    const count = async (sql: string) => Number((await h.db.query(sql, [owner])).rows[0].n);
    expect(await count(`select count(*) n from public.milk_sales where owner_id = $1`)).toBe(3); // original, its correction, the voided one
    expect(await count(`select count(*) n from public.milk_sales where owner_id = $1 and status = 'completed'`)).toBe(1);
    expect(await count(`select count(*) n from public.payments where owner_id = $1`)).toBe(3); // at sale, later, refund
    expect(await count(`select count(*) n from public.milk_production where owner_id = $1 and restricted`)).toBe(1); // re-marked by the treatment
    expect(await count(`select count(*) n from public.milk_stock_movements where owner_id = $1 and kind = 'reversal'`)).toBe(3); // 2 sale voids + 1 use
  });

  it('find no problems after a month of normal use, corrections and voids', async () => {
    const results = await runIntegrityChecks(h.db);
    expect(results.filter((r) => r.problems.length).map((r) => r.name)).toEqual([]);
  });

  it('detect a stock ledger that no longer matches a milk entry', async () => {
    await h.db.query(`insert into public.milk_stock_movements (owner_id, movement_date, kind, quantity, reason, milk_production_id) values ($1, '2026-10-05', 'adjustment', 3, 'tampered', $2)`, [owner, ids.m1]);
    const results = await runIntegrityChecks(h.db);
    const broken = results.find((r) => r.name.startsWith('Milk entry stock'))!;
    expect(broken.problems).toEqual([expect.objectContaining({ id: ids.m1 })]);
  });
});
