import { describe, expect, it } from 'vitest';
import { financeReminders } from '../src/finance/reminders';
import type { Customer, Movement, Sale } from '../src/finance/model';

const day = (iso: string) => iso.slice(0, 10);
const customer = { id: 'c1', name: 'Mrs Phiri', phone: null, address: null, customer_type: 'individual', registered_on: '2026-01-01', notes: null, active: true, version: 1 } as Customer;
const sale = (sale_at: string, extra: Partial<Sale> = {}) =>
  ({ id: sale_at, customer_id: 'c1', sale_at, quantity: '10', price_per_litre: '10', currency: 'ZMW', total: '100.00', price_id: null, price_source: 'list', payment_method: null, notes: null, status: 'completed', void_reason: null, voided_at: null, corrects_sale_id: null, ...extra }) as Sale;
const mv = (movement_date: string, kind: Movement['kind'], quantity: string): Movement => ({ id: `${movement_date}${kind}${quantity}`, movement_date, kind, quantity, reason: null, milk_production_id: null, sale_id: null, reverses_id: null });
const base = { customers: [customer], payments: [], allocations: [], movements: [] as Movement[] };

describe('finance reminders', () => {
  it('flags balances unpaid for more than a week', () => {
    const old = financeReminders({ ...base, sales: [sale('2026-10-10T08:00:00Z')] }, [], '2026-10-28', day);
    expect(old).toEqual([expect.objectContaining({ kind: 'unpaid_balance', title: 'Mrs Phiri owes ZMW 100.00', href: '/customers/c1' })]);
    // Its button opens a payment for the whole amount, ready to save.
    expect(old[0].actionHref).toBe('/payment/new?customer_id=c1&currency=ZMW&amount=100.00');
    expect(financeReminders({ ...base, sales: [sale('2026-10-25T08:00:00Z')] }, [], '2026-10-28', day)).toEqual([]);
  });

  it('flags a stock discrepancy for investigation rather than correcting it', () => {
    const movements = [mv('2026-10-01', 'opening_balance', '10.00'), mv('2026-10-02', 'sale', '-10.00'), mv('2026-10-02', 'adjustment', '-5.00')];
    const r = financeReminders({ ...base, sales: [], movements }, [], '2026-10-03', day);
    expect(r).toEqual([expect.objectContaining({ kind: 'stock_discrepancy', due: '2026-10-02', href: '/stock' })]);
    // Its button opens an adjustment for the shortfall on the first day stock went below zero; the farmer gives the reason.
    expect(r[0].actionHref).toBe('/stock/new?kind=adjustment&date=2026-10-02&quantity=5.00');
  });
});
