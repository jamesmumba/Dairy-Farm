import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { harness } from './harness.js';

let h: Awaited<ReturnType<typeof harness>>;
beforeAll(async () => {
  h = await harness();
});

/** A farmer with records in every kind of table, including append-only ones. */
async function busyFarmer() {
  const f = await h.farmer();
  const post = (url: string, body: object) => f.call('POST', url, { id: randomUUID(), ...body });
  const cow = randomUUID();
  await f.call('POST', '/v1/cattle', { id: cow, sex: 'female' });
  await post('/v1/milk-production', { cattle_id: cow, production_date: '2026-10-05', session: 'morning', quantity: '20' });
  await post('/v1/treatments', { cattle_id: cow, medication: 'X', started_on: '2026-10-05' });
  const customer = randomUUID();
  await f.call('POST', '/v1/customers', { id: customer, name: 'Mrs Phiri' });
  await post('/v1/milk-prices', { currency: 'ZMW', price_per_litre: '10', effective_from: '2026-01-01T00:00:00Z' });
  await post('/v1/milk-sales', { customer_id: customer, sale_at: '2026-10-05T10:00:00Z', quantity: '5', currency: 'ZMW', amount_paid: '20', payment_method: 'cash' });
  await post('/v1/expenses', { expense_date: '2026-10-05', category: 'feed', amount: '100', currency: 'ZMW' });
  return { ...f, owner: await f.ownerId() };
}

const owned = async (owner: string) => {
  const { rows } = await h.db.query<{ t: string }>(`select table_name as t from information_schema.columns where table_schema = 'public' and column_name = 'owner_id'`);
  let n = 0;
  for (const { t } of rows) n += Number((await h.db.query(`select count(*)::int as n from public.${t} where owner_id = $1`, [owner])).rows[0].n);
  return n;
};

describe('account erasure', () => {
  it('refuses unless the farmer requested deletion', async () => {
    const f = await busyFarmer();
    await expect(h.db.query('select public.erase_farmer_account($1)', [f.owner])).rejects.toThrow(/has not requested deletion/);
  });

  it('erases every row of the farmer, including append-only records, and keeps an anonymous receipt', async () => {
    const a = await busyFarmer();
    const b = await busyFarmer();
    const bBefore = await owned(b.owner);
    expect(await owned(a.owner)).toBeGreaterThan(10);

    await a.call('POST', '/v1/me/deletion-request', { reason: 'Selling the farm' });
    const { rows } = await h.db.query('select public.erase_farmer_account($1) as n', [a.owner]);
    expect(rows[0].n).toBeGreaterThan(10);

    expect(await owned(a.owner)).toBe(0);
    expect((await h.db.query('select 1 from public.farmer_accounts where id = $1', [a.owner])).rows).toHaveLength(0);
    expect(await owned(b.owner)).toBe(bBefore); // nobody else touched
    const receipt = (await h.db.query('select * from public.account_deletions order by id desc limit 1')).rows[0];
    expect(receipt).toMatchObject({ rows_erased: rows[0].n });
    expect(Object.keys(receipt)).not.toContain('owner_id');
  });

  it('keeps the append-only guards in force outside the erasure', async () => {
    const f = await busyFarmer();
    await expect(h.db.query('delete from public.audit_logs where owner_id = $1', [f.owner])).rejects.toThrow(/append-only/);
    await expect(h.db.query('delete from public.milk_sales where owner_id = $1', [f.owner])).rejects.toThrow(/void them instead/);
    // Erasing someone else does not leave the permission switched on for later statements.
    const other = await busyFarmer();
    await other.call('POST', '/v1/me/deletion-request', {});
    await h.db.query('select public.erase_farmer_account($1)', [other.owner]);
    expect((await h.db.query(`select coalesce(current_setting('app.erase', true), '') as v`)).rows[0].v).not.toBe('on');
    await expect(h.db.query('delete from public.audit_logs where owner_id = $1', [f.owner])).rejects.toThrow(/append-only/);
  });
});
