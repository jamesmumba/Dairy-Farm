import { describe, expect, it } from 'vitest';
import { availableOn, balances, ledger, likelyDuplicates, listPrice, money, reconcile, saleDue, saleTotal, summarize, toCents } from '../src/finance/calc';
import type { Allocation, Customer, Expense, Movement, Payment, Sale } from '../src/finance/model';

const day = (iso: string) => iso.slice(0, 10);
const mv = (movement_date: string, kind: Movement['kind'], quantity: string, id = `${kind}-${movement_date}-${quantity}`): Movement => ({
  id,
  movement_date,
  kind,
  quantity,
  reason: null,
  milk_production_id: null,
  sale_id: null,
  reverses_id: null,
});
const sale = (extra: Partial<Sale> = {}): Sale => ({
  id: 's1',
  customer_id: 'c1',
  sale_at: '2026-10-05T08:00:00Z',
  quantity: '10',
  price_per_litre: '10',
  currency: 'ZMW',
  total: '100.00',
  price_id: null,
  price_source: 'list',
  payment_method: null,
  notes: null,
  status: 'completed',
  void_reason: null,
  voided_at: null,
  corrects_sale_id: null,
  ...extra,
});
const payment = (extra: Partial<Payment> = {}): Payment => ({
  id: 'p1',
  customer_id: 'c1',
  kind: 'payment',
  amount: '60.00',
  currency: 'ZMW',
  method: 'cash',
  paid_at: '2026-10-05T09:00:00Z',
  reference: null,
  notes: null,
  reason: null,
  status: 'completed',
  void_reason: null,
  ...extra,
});

describe('sale total (spec)', () => {
  it('10 L × ZMW 10 = ZMW 100; × 12 = 120; rounds half up to cents', () => {
    expect(saleTotal('10', '10')).toBe(10000);
    expect(saleTotal('10', '12')).toBe(12000);
    expect(saleTotal('3', '9.5')).toBe(2850);
    expect(saleTotal('0.33', '0.15')).toBe(5); // 0.0495 → 0.05
    expect(money(123456, 'ZMW')).toBe('ZMW 1,234.56');
  });

  it('uses the latest price that has started, per currency', () => {
    const prices = [
      { id: 'a', currency: 'ZMW', price_per_litre: '10.00', effective_from: '2026-01-01T00:00:00.000Z', reason: null },
      { id: 'b', currency: 'ZMW', price_per_litre: '12.00', effective_from: '2026-10-05T10:00:00.000Z', reason: null },
      { id: 'c', currency: 'USD', price_per_litre: '0.50', effective_from: '2026-01-01T00:00:00.000Z', reason: null },
    ];
    expect(listPrice(prices, 'ZMW', '2026-10-05T08:00:00.000Z')?.id).toBe('a');
    expect(listPrice(prices, 'ZMW', '2026-10-06T08:00:00.000Z')?.id).toBe('b');
    expect(listPrice(prices, 'USD', '2025-12-31T00:00:00.000Z')).toBeNull();
  });
});

describe('balances (spec: 60 paid on 100 leaves 40; a later 40 clears it)', () => {
  it('keeps revenue and receipts separate and balances per currency', () => {
    const sales = [sale(), sale({ id: 's2', currency: 'USD', total: '5.00' })];
    expect(balances('c1', sales, [payment()])).toEqual({ ZMW: 4000, USD: 500 });
    expect(balances('c1', sales, [payment(), payment({ id: 'p2', amount: '40.00' })])).toEqual({ ZMW: 0, USD: 500 });
  });

  it('refunds add back, adjustments reduce, voided items do not count', () => {
    const pays = [payment({ amount: '150.00' }), payment({ id: 'r', kind: 'refund', amount: '20.00' }), payment({ id: 'v', amount: '999.00', status: 'voided' })];
    expect(balances('c1', [sale()], pays)).toEqual({ ZMW: -3000 });
    expect(balances('c1', [sale({ status: 'voided' })], [])).toEqual({});
  });

  it('counts money taken with an unsynced sale until its payment arrives, then not twice', () => {
    const offline = sale({ local_amount_paid: '60.00', local_payment_id: 'p1' });
    expect(balances('c1', [offline], [])).toEqual({ ZMW: 4000 });
    expect(balances('c1', [offline], [payment()])).toEqual({ ZMW: 4000 });
  });

  it('shows what is still due on each sale from allocations', () => {
    const allocations: Allocation[] = [{ id: 'a', payment_id: 'p1', sale_id: 's1', amount: '60.00' }];
    expect(saleDue([sale()], [payment()], allocations).get('s1')).toBe(4000);
    expect(saleDue([sale()], [payment({ status: 'voided' })], allocations).get('s1')).toBe(10000);
  });
});

describe('stock (spec: 100 + 50 − 30 − 5 = 115)', () => {
  const movements = [
    mv('2026-10-01', 'opening_balance', '100.00'),
    mv('2026-10-05', 'production', '50.00'),
    mv('2026-10-05', 'sale', '-30.00'),
    mv('2026-10-05', 'spoilage', '-5.00'),
  ];

  it('reconciles day by day', () => {
    const [d1, , , , d5] = reconcile(movements, [], '2026-10-01', '2026-10-05');
    expect(d1).toMatchObject({ opening: 0, adjusted: 10000, closing: 10000 });
    expect(d5).toMatchObject({ opening: 10000, produced: 5000, sold: 3000, used: 500, closing: 11500 });
  });

  it('shows restricted milk as produced but never in stock', () => {
    const milk = [{ id: 'm', cattle_id: 'c', production_date: '2026-10-05', session: 'morning' as const, quantity: '12', status: 'valid' as const, restricted: true }];
    expect(reconcile(movements, milk, '2026-10-05', '2026-10-05')[0]).toMatchObject({ restricted: 1200, closing: 11500 });
  });

  it('checks oversell the way the server does, including later days', () => {
    const entries = ledger(movements, { sales: [], production: [] }, day);
    expect(availableOn(entries, '2026-10-05')).toBe(11500);
    const tight = ledger([mv('2026-10-01', 'opening_balance', '10.00'), mv('2026-10-03', 'sale', '-10.00')], { sales: [], production: [] }, day);
    expect(availableOn(tight, '2026-10-02')).toBe(0); // a back-dated sale would make the 3rd negative
  });

  it('includes this phone’s unsynced sales and production, without double counting once synced', () => {
    const pending = { sales: [sale({ id: 'x', quantity: '15' })], production: [{ id: 'm1', quantity: '20', production_date: '2026-10-05' }] };
    expect(availableOn(ledger(movements, pending, day), '2026-10-05')).toBe(11500 - 1500 + 2000);
    const synced = [...movements, mv('2026-10-05', 'sale', '-15.00', 'x'), mv('2026-10-05', 'production', '20.00', 'm1')];
    expect(availableOn(ledger(synced, pending, day), '2026-10-05')).toBe(11500 - 1500 + 2000);
  });
});

describe('customers', () => {
  const people: Customer[] = [
    { id: 'a', name: 'Mrs Grace Phiri', phone: '+260 97 111 2222', address: null, customer_type: 'individual', registered_on: '2026-01-01', notes: null, active: true, version: 1 },
    { id: 'b', name: 'Chisamba School', phone: null, address: null, customer_type: 'school', registered_on: '2026-01-01', notes: null, active: true, version: 1 },
  ];
  it('finds likely duplicates by name or phone before adding', () => {
    expect(likelyDuplicates(people, 'grace phiri', null).map((c) => c.id)).toEqual(['a']);
    expect(likelyDuplicates(people, 'Someone else', '0971112222').map((c) => c.id)).toEqual(['a']);
    expect(likelyDuplicates(people, 'Jo', null)).toEqual([]);
  });
});

describe('financial summary', () => {
  it('separates revenue, receipts, refunds, expenses and the recorded operating result per currency', () => {
    const expenses: Expense[] = [
      { id: 'e', expense_date: '2026-10-04', category: 'feed', amount: '30.00', currency: 'ZMW', payee: null, payment_method: 'cash', payment_status: 'paid', receipt_path: null, notes: null, status: 'active', void_reason: null, version: 1 },
      { id: 'v', expense_date: '2026-10-04', category: 'feed', amount: '999.00', currency: 'ZMW', payee: null, payment_method: 'cash', payment_status: 'paid', receipt_path: null, notes: null, status: 'voided', void_reason: 'x', version: 2 },
    ];
    const customers = [{ id: 'c1' } as Customer];
    const s = summarize('ZMW', '2026-10-01', '2026-10-31', { sales: [sale()], payments: [payment(), payment({ id: 'r', kind: 'refund', amount: '5.00' })], expenses, customers }, day);
    expect(s).toMatchObject({ revenueCents: 10000, receiptsCents: 6000, refundsCents: 500, expensesCents: 3000, operatingResultCents: 7000, outstandingCents: 4500, litresCl: 1000 });
    // Milk sales less feed only (voided feed not counted): what is left before other costs.
    expect(s).toMatchObject({ feedCents: 3000, afterFeedCents: 7000 });
  });

  it('takes discounts and write-offs off the result, breaks expenses down, and shows cash in and out', () => {
    const exp = (id: string, category: Expense['category'], amount: string, payment_status: Expense['payment_status']): Expense => ({
      id, expense_date: '2026-10-04', category, amount, currency: 'ZMW', payee: null, payment_method: 'cash', payment_status, receipt_path: null, notes: null, status: 'active', void_reason: null, version: 1,
    });
    const expenses = [exp('f', 'feed', '30.00', 'paid'), exp('l', 'labour', '40.00', 'unpaid'), exp('m', 'medicines', '5.00', 'partially_paid')];
    const payments = [payment(), payment({ id: 'w', kind: 'adjustment', amount: '20.00' }), payment({ id: 'r', kind: 'refund', amount: '5.00' })];
    const s = summarize('ZMW', '2026-10-01', '2026-10-31', { sales: [sale()], payments, expenses, customers: [{ id: 'c1' } as Customer] }, day);
    // ZMW 100 sold, 20 written off: 80 will be paid. Feed 30 → 50 left; all expenses 75 → 5.
    expect(s).toMatchObject({ netSalesCents: 8000, afterFeedCents: 5000, operatingResultCents: 500 });
    expect(s.byCategory).toEqual([
      { category: 'labour', cents: 4000 },
      { category: 'feed', cents: 3000 },
      { category: 'medicines', cents: 500 },
    ]);
    // Cash: 60 received − 30 feed paid − 5 refunded; the unpaid labour is not cash out, the partly paid medicine is unknown.
    expect(s).toMatchObject({ paidOutCents: 3000, cashCents: 2500, partlyPaidCount: 1 });
  });

  it('parses negative amounts', () => {
    expect(toCents('-2.5')).toBe(-250);
  });
});
