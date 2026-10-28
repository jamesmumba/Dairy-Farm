import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { harness } from './harness.js';

let h: Awaited<ReturnType<typeof harness>>;
beforeAll(async () => {
  h = await harness();
});

/** A farmer with a customer, a ZMW 10/L price from 1 Jan, and (optionally) opening stock. */
async function shop(openingLitres: string | null = '100') {
  const f = await h.farmer();
  const customerId = randomUUID();
  expect((await f.call('POST', '/v1/customers', { id: customerId, name: 'Mrs Phiri', phone: '+260 97 111 2222' })).statusCode).toBe(201);
  expect((await f.call('POST', '/v1/milk-prices', { id: randomUUID(), currency: 'ZMW', price_per_litre: '10', effective_from: '2026-01-01T00:00:00Z' })).statusCode).toBe(201);
  if (openingLitres) {
    const ob = await f.call('POST', '/v1/stock/movements', { id: randomUUID(), kind: 'opening_balance', quantity: openingLitres, movement_date: '2026-10-01', reason: 'Counted in the cooler' });
    expect(ob.statusCode).toBe(201);
  }
  const sell = (extra: object = {}) =>
    f.call('POST', '/v1/milk-sales', { id: randomUUID(), customer_id: customerId, sale_at: '2026-10-05T08:00:00+02:00', quantity: '10', currency: 'ZMW', ...extra });
  const pay = (extra: object = {}) =>
    f.call('POST', '/v1/payments', { id: randomUUID(), customer_id: customerId, kind: 'payment', amount: '10', currency: 'ZMW', method: 'cash', paid_at: '2026-10-06T08:00:00+02:00', ...extra });
  const statement = async () => (await f.call('GET', `/v1/customers/${customerId}/statement`)).json();
  return { ...f, customerId, sell, pay, statement };
}

async function stockOn(f: { ownerId: () => Promise<string> }, date: string) {
  const { rows } = await h.db.query(`select coalesce(sum(quantity), 0)::text as l from public.milk_stock_movements where owner_id = $1 and movement_date <= $2`, [await f.ownerId(), date]);
  return rows[0].l as string;
}

describe('spec scenarios', () => {
  it('10 L at ZMW 10/L totals ZMW 100; a later price of 12 gives 120 and the old sale stays 100', async () => {
    const s = await shop();
    const first = (await s.sell()).json();
    expect(first).toMatchObject({ total: '100.00', price_per_litre: '10.00', currency: 'ZMW', price_source: 'list' });

    await s.call('POST', '/v1/milk-prices', { id: randomUUID(), currency: 'ZMW', price_per_litre: '12', effective_from: '2026-10-05T12:00:00+02:00', reason: 'New season' });
    const second = (await s.sell({ sale_at: '2026-10-06T08:00:00+02:00' })).json();
    expect(second).toMatchObject({ total: '120.00', price_per_litre: '12.00' });
    const sales = (await s.call('GET', '/v1/milk-sales')).json();
    expect(sales.find((x: { id: string }) => x.id === first.id).total).toBe('100.00');
  });

  it('ZMW 60 paid on a ZMW 100 sale leaves 40; a later 40 clears it; revenue and receipts stay distinct', async () => {
    const s = await shop();
    const sale = (await s.sell({ amount_paid: '60', payment_method: 'mobile_money' })).json();
    let st = await s.statement();
    expect(st.balances.ZMW).toBe('40.00');
    expect(st.sales[0]).toMatchObject({ id: sale.id, paid: '60.00', due: '40.00' });

    await s.pay({ amount: '40' });
    st = await s.statement();
    expect(st.balances.ZMW).toBe('0.00');
    expect(st.sales[0]).toMatchObject({ paid: '100.00', due: '0.00' });
    // One sale of 100 (revenue), two separate payments totalling 100 (receipts).
    expect(st.sales).toHaveLength(1);
    expect(st.payments.map((p: { amount: string }) => p.amount).sort()).toEqual(['40.00', '60.00']);
  });

  it('opening 100 + production 50 − sale 30 − disposal 5 = closing 115; an oversell is blocked until a justified adjustment', async () => {
    const s = await shop('100');
    const cow = randomUUID();
    await s.call('POST', '/v1/cattle', { id: cow, sex: 'female' });
    await s.call('POST', '/v1/milk-production', { id: randomUUID(), cattle_id: cow, production_date: '2026-10-05', session: 'morning', quantity: '30' });
    await s.call('POST', '/v1/milk-production', { id: randomUUID(), cattle_id: cow, production_date: '2026-10-05', session: 'evening', quantity: '20' });
    expect((await s.sell({ quantity: '30' })).statusCode).toBe(201);
    expect((await s.call('POST', '/v1/stock/movements', { id: randomUUID(), kind: 'spoilage', quantity: '5', movement_date: '2026-10-05' })).statusCode).toBe(201);
    expect(await stockOn(s, '2026-10-05')).toBe('115.00');

    const over = await s.sell({ quantity: '200' });
    expect(over.statusCode).toBe(409);
    expect(over.json()).toMatchObject({ error: 'insufficient_stock', available: '115.00', requested: '200' });

    const noReason = await s.call('POST', '/v1/stock/movements', { id: randomUUID(), kind: 'adjustment', direction: 'add', quantity: '85', movement_date: '2026-10-05' });
    expect(noReason.json().field).toBe('reason');
    await s.call('POST', '/v1/stock/movements', { id: randomUUID(), kind: 'adjustment', direction: 'add', quantity: '85', movement_date: '2026-10-05', reason: 'Evening milk not recorded on the 5th' });
    expect((await s.sell({ quantity: '200' })).statusCode).toBe(201);
  });

  it('correcting a completed sale keeps the original, the reason, both values and the time in the audit history', async () => {
    const s = await shop();
    const sale = (await s.sell()).json();
    const newId = randomUUID();
    const res = await s.call('POST', `/v1/milk-sales/${sale.id}/correct`, { new_id: newId, quantity: '8', reason: 'Customer returned 2 L' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ id: newId, quantity: '8.00', total: '80.00', corrects_sale_id: sale.id });

    const sales = (await s.call('GET', '/v1/milk-sales')).json();
    expect(sales.find((x: { id: string }) => x.id === sale.id)).toMatchObject({ status: 'voided', total: '100.00' });
    const audit = (await s.call('GET', `/v1/audit?entity_table=milk_sales&entity_id=${sale.id}`)).json();
    const entry = audit.find((a: { action: string }) => a.action === 'milk_sale.corrected');
    expect(entry).toMatchObject({ reason: 'Customer returned 2 L', before_data: { quantity: '10.00', total: '100.00' }, after_data: { quantity: '8.00', total: '80.00', corrected_sale_id: newId } });
    expect(entry.occurred_at).toBeTruthy();
    expect(await stockOn(s, '2026-10-31')).toBe('92.00');
    expect((await s.statement()).balances.ZMW).toBe('80.00');
  });
});

describe('sales', () => {
  it('a retried sale is recorded once, with one stock movement and one payment', async () => {
    const s = await shop();
    const body = { id: randomUUID(), customer_id: s.customerId, sale_at: '2026-10-05T08:00:00+02:00', quantity: '10', currency: 'ZMW', amount_paid: '100', payment_method: 'cash' };
    const key = randomUUID();
    await s.call('POST', '/v1/milk-sales', body, { 'idempotency-key': key });
    const retry = await s.call('POST', '/v1/milk-sales', body, { 'idempotency-key': key });
    expect(retry.statusCode).toBe(201);
    expect((await s.call('GET', '/v1/milk-sales')).json()).toHaveLength(1);
    expect((await s.call('GET', '/v1/payments')).json()).toHaveLength(1);
    expect(await stockOn(s, '2026-10-31')).toBe('90.00');
  });

  it('records a price entered for one sale as an override; the server computes the total', async () => {
    const s = await shop();
    expect((await s.sell({ price_per_litre: '9.5', quantity: '3' })).json()).toMatchObject({ total: '28.50', price_source: 'override', price_id: null });
  });

  it('refuses a currency with no price, never mixing currencies', async () => {
    const s = await shop();
    expect((await s.sell({ currency: 'USD' })).json().error).toBe('no_price');
    await s.call('POST', '/v1/milk-prices', { id: randomUUID(), currency: 'USD', price_per_litre: '0.5', effective_from: '2026-01-01T00:00:00Z' });
    await s.sell({ currency: 'USD' });
    await s.sell();
    expect((await s.statement()).balances).toEqual({ ZMW: '100.00', USD: '5.00' });
  });

  it('blocks a back-dated sale that would make a later day’s stock negative', async () => {
    const s = await shop('10');
    expect((await s.sell({ sale_at: '2026-10-03T08:00:00+02:00' })).statusCode).toBe(201); // uses all 10 L
    const back = await s.sell({ sale_at: '2026-10-02T08:00:00+02:00', quantity: '5' });
    expect(back.json()).toMatchObject({ error: 'insufficient_stock', available: '0.00' });
  });

  it('voiding a sale returns the milk to stock and turns money received into credit', async () => {
    const s = await shop();
    const sale = (await s.sell({ amount_paid: '100', payment_method: 'cash' })).json();
    await s.call('POST', `/v1/milk-sales/${sale.id}/void`, { reason: 'Milk was sour, taken back' });
    expect(await stockOn(s, '2026-10-31')).toBe('100.00');
    expect((await s.statement()).balances.ZMW).toBe('-100.00'); // in credit
    // The credit pays the next sale automatically.
    const next = (await s.sell({ quantity: '5' })).json();
    const st = await s.statement();
    expect(st.sales.find((x: { id: string }) => x.id === next.id)).toMatchObject({ paid: '50.00', due: '0.00' });
    expect(st.balances.ZMW).toBe('-50.00');
  });

  it('will not sell more than paid for at the sale, nor take money without a method', async () => {
    const s = await shop();
    expect((await s.sell({ amount_paid: '150', payment_method: 'cash' })).json().field).toBe('amount_paid');
    expect((await s.sell({ amount_paid: '50' })).json().field).toBe('payment_method');
  });
});

describe('payments', () => {
  it('pays the oldest sales first and keeps the rest as credit', async () => {
    const s = await shop();
    const a = (await s.sell({ sale_at: '2026-10-03T08:00:00+02:00' })).json();
    const b = (await s.sell({ sale_at: '2026-10-04T08:00:00+02:00' })).json();
    await s.pay({ amount: '150' });
    let st = await s.statement();
    expect(st.sales.find((x: { id: string }) => x.id === a.id).due).toBe('0.00');
    expect(st.sales.find((x: { id: string }) => x.id === b.id).due).toBe('50.00');
    await s.pay({ amount: '80' });
    st = await s.statement();
    expect(st.balances.ZMW).toBe('-30.00');
  });

  it('accepts a payment as the phone sends it, with empty fields as null', async () => {
    const s = await shop();
    const res = await s.pay({ reference: null, notes: null, reason: null });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ reference: null, notes: null, reason: null });
    // A refund still needs a reason.
    expect((await s.pay({ kind: 'refund', amount: '5', reason: null })).json().field).toBe('reason');
  });

  it('refunds only up to the credit and write-offs only up to what is owed, both with a reason', async () => {
    const s = await shop();
    await s.pay({ amount: '50' }); // paid in advance
    expect((await s.pay({ kind: 'refund', amount: '20' })).json().field).toBe('reason');
    expect((await s.pay({ kind: 'refund', amount: '60', reason: 'Moving away' })).json().field).toBe('amount');
    expect((await s.pay({ kind: 'refund', amount: '20', reason: 'Returned part of the deposit' })).statusCode).toBe(201);
    // The refunded 20 is gone: only 30 of credit pays the next sale.
    const sale = (await s.sell()).json();
    let st = await s.statement();
    expect(st.sales.find((x: { id: string }) => x.id === sale.id)).toMatchObject({ paid: '30.00', due: '70.00' });
    expect((await s.pay({ kind: 'adjustment', amount: '80', method: 'other', reason: 'Bad debt' })).json().field).toBe('amount');
    await s.pay({ kind: 'adjustment', amount: '70', method: 'other', reason: 'Agreed discount' });
    st = await s.statement();
    expect(st.balances.ZMW).toBe('0.00');
  });

  it('voiding a payment puts the amount back on the account', async () => {
    const s = await shop();
    await s.sell();
    const p = (await s.pay({ amount: '100' })).json();
    expect((await s.statement()).balances.ZMW).toBe('0.00');
    await s.call('POST', `/v1/payments/${p.id}/void`, { reason: 'Mobile money transfer reversed' });
    const st = await s.statement();
    expect(st.balances.ZMW).toBe('100.00');
    expect(st.sales[0].due).toBe('100.00');
  });
});

describe('stock records', () => {
  it('reverses a mistaken use, but not production or sales', async () => {
    const s = await shop('20');
    const use = (await s.call('POST', '/v1/stock/movements', { id: randomUUID(), kind: 'calf_feeding', quantity: '6', movement_date: '2026-10-05' })).json();
    expect(await stockOn(s, '2026-10-05')).toBe('14.00');
    await s.call('POST', `/v1/stock/movements/${use.id}/reverse`, { id: randomUUID(), reason: 'Entered twice' });
    expect(await stockOn(s, '2026-10-05')).toBe('20.00');
    expect((await s.call('POST', `/v1/stock/movements/${use.id}/reverse`, { id: randomUUID(), reason: 'Again' })).json().error).toBe('already_reversed');

    await s.sell({ quantity: '2' });
    const { rows } = await h.db.query(`select id from public.milk_stock_movements where owner_id = $1 and kind = 'sale'`, [await s.ownerId()]);
    expect((await s.call('POST', `/v1/stock/movements/${rows[0].id}/reverse`, { id: randomUUID(), reason: 'x x x' })).json().error).toBe('not_reversible');
  });

  it('will not let milk use exceed stock either', async () => {
    const s = await shop('5');
    const res = await s.call('POST', '/v1/stock/movements', { id: randomUUID(), kind: 'farm_consumption', quantity: '6', movement_date: '2026-10-05' });
    expect(res.json().error).toBe('insufficient_stock');
  });
});

describe('expenses', () => {
  it('records, corrects with history, attaches a receipt, and voids', async () => {
    const f = await h.farmer();
    const id = randomUUID();
    const e = await f.call('POST', '/v1/expenses', { id, expense_date: '2026-10-04', category: 'feed', amount: '450', currency: 'ZMW', payee: 'Agro shop', payment_method: 'cash' });
    expect(e.json()).toMatchObject({ amount: '450.00', status: 'active', payment_status: 'paid' });
    await f.call('PATCH', `/v1/expenses/${id}`, { amount: '540' }, { 'if-match': '1' });
    const audit = (await f.call('GET', `/v1/audit?entity_id=${id}`)).json();
    expect(audit[0]).toMatchObject({ action: 'expense.corrected', before_data: { amount: '450.00' }, after_data: { amount: '540.00' } });

    const up = (await f.call('POST', `/v1/expenses/${id}/receipt-upload`)).json();
    h.receiptStorage.upload(up.path);
    expect((await f.call('POST', `/v1/expenses/${id}/receipt`, { path: up.path })).json().receipt_path).toBe(up.path);

    const voided = await f.call('POST', `/v1/expenses/${id}/void`, { reason: 'Paid by the cooperative' }, { 'if-match': '3' });
    expect(voided.json()).toMatchObject({ status: 'voided', void_reason: 'Paid by the cooperative' });
  });
});

describe('owner isolation', () => {
  it('keeps customers, sales, payments, stock and expenses private to each farmer', async () => {
    const a = await shop();
    const b = await h.farmer();
    await b.call('POST', '/v1/milk-prices', { id: randomUUID(), currency: 'ZMW', price_per_litre: '10', effective_from: '2026-01-01T00:00:00Z' });
    const sale = (await a.sell()).json();
    expect((await b.call('POST', '/v1/milk-sales', { id: randomUUID(), customer_id: a.customerId, sale_at: '2026-10-05T08:00:00+02:00', quantity: '1', currency: 'ZMW' })).statusCode).toBe(404);
    expect((await b.call('GET', `/v1/customers/${a.customerId}/statement`)).statusCode).toBe(404);
    expect((await b.call('POST', `/v1/milk-sales/${sale.id}/void`, { reason: 'mine' })).statusCode).toBe(404);
    expect((await b.call('POST', '/v1/payments', { id: randomUUID(), customer_id: a.customerId, kind: 'payment', amount: '1', currency: 'ZMW', method: 'cash', paid_at: '2026-10-06T08:00:00Z' })).statusCode).toBe(404);
    for (const entity of ['customers', 'milk_sales', 'payments', 'payment_allocations', 'milk_stock_movements', 'milk_prices', 'farm_expenses']) {
      expect((await b.call('GET', `/v1/sync/pull?entity=${entity}`)).json().rows.length).toBeLessThanOrEqual(entity === 'milk_prices' ? 1 : 0);
    }
    expect((await b.call('GET', '/v1/audit')).json().every((x: { entity_id: string }) => x.entity_id !== sale.id)).toBe(true);
  });
});

describe('export log', () => {
  it('records each export in the owner’s audit history, once per retry key', async () => {
    const f = await h.farmer();
    const body = { id: randomUUID(), report: 'production', format: 'pdf', filters: { from: '2026-10-01', to: '2026-10-31' }, row_count: 31, generated_at: '2026-10-31T10:00:00Z' };
    const key = randomUUID();
    expect((await f.call('POST', '/v1/exports', body, { 'idempotency-key': key })).statusCode).toBe(201);
    await f.call('POST', '/v1/exports', body, { 'idempotency-key': key });
    const audit = (await f.call('GET', '/v1/audit?entity_table=exports')).json();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'export.pdf', reason: 'production', after_data: { row_count: 31 } });
    const other = await h.farmer();
    expect((await other.call('GET', '/v1/audit?entity_table=exports')).json()).toHaveLength(0);
  });
});
