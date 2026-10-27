// Finance and stock calculations from records on the phone. Pure functions, no I/O.
// Money and litres are handled as integer cents / centilitres. Currencies are never summed together.

import type { MilkRow } from '../production/calc';
import type { Allocation, Customer, Expense, Movement, Payment, Price, Sale } from './model';

export const toCents = (amount: string) => {
  const negative = amount.trim().startsWith('-');
  const [whole, frac = ''] = amount.trim().replace('-', '').split('.');
  const c = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  return negative ? -c : c;
};

export const fromCents = (c: number) => `${c < 0 ? '-' : ''}${Math.floor(Math.abs(c) / 100)}.${String(Math.abs(c) % 100).padStart(2, '0')}`;

export const money = (c: number, currency: string) => `${currency} ${fromCents(c).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;

/** total = quantity × price, rounded half up to cents (the server does the same and is authoritative). */
export function saleTotal(quantity: string, price: string): number {
  return Math.round((toCents(quantity) * toCents(price)) / 100);
}

/** The listed price for a currency at a moment: the latest that has started. */
export function listPrice(prices: Price[], currency: string, at: string): Price | null {
  return (
    prices
      .filter((p) => p.currency === currency && p.effective_from <= at)
      .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0] ?? null
  );
}

// --- Stock -------------------------------------------------------------------------

export interface PendingStock {
  /** Sales saved on this phone that the server has not confirmed. */
  sales: Pick<Sale, 'id' | 'quantity' | 'status' | 'sale_at'>[];
  /** Milk entries saved on this phone (version 0) and eligible as far as the phone knows. */
  production: Pick<MilkRow, 'id' | 'quantity' | 'production_date'>[];
}

/** The server's movements plus this phone's unsynced sales and production, as one ledger. */
export function ledger(movements: Movement[], pending: PendingStock, farmDate: (iso: string) => string): { date: string; cl: number }[] {
  const ids = new Set(movements.map((m) => m.id)); // a server movement shares its sale's / entry's id
  return [
    ...movements.map((m) => ({ date: m.movement_date, cl: toCents(m.quantity) })),
    ...pending.sales.filter((s) => s.status === 'completed' && !ids.has(s.id)).map((s) => ({ date: farmDate(s.sale_at), cl: -toCents(s.quantity) })),
    ...pending.production.filter((p) => !ids.has(p.id)).map((p) => ({ date: p.production_date, cl: toCents(p.quantity) })),
  ];
}

/** Litres that can still go out on `date` without any later day dropping below zero (as the server checks). */
export function availableOn(entries: { date: string; cl: number }[], date: string): number {
  const days = [...new Set(entries.map((e) => e.date))].sort();
  let running = 0;
  let atDate = 0;
  let minAfter = Infinity;
  for (const d of days) {
    running += entries.filter((e) => e.date === d).reduce((s, e) => s + e.cl, 0);
    if (d <= date) atDate = running;
    if (d >= date) minAfter = Math.min(minAfter, running);
  }
  return Math.max(0, Math.min(atDate, minAfter));
}

export interface ReconciliationDay {
  date: string;
  opening: number;
  produced: number; // eligible production into stock
  restricted: number; // produced under withdrawal: recorded, never in stock
  sold: number;
  used: number; // home, calves, spoilage, gifts, other
  adjusted: number; // opening balances, adjustments, reversals
  closing: number;
}

/** Day-by-day stock: closing = opening + produced − sold − used ± adjusted. */
export function reconcile(movements: Movement[], milk: MilkRow[], from: string, to: string): ReconciliationDay[] {
  const before = movements.filter((m) => m.movement_date < from).reduce((s, m) => s + toCents(m.quantity), 0);
  const days: ReconciliationDay[] = [];
  let opening = before;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const today = movements.filter((m) => m.movement_date === d);
    const sum = (kinds: string[]) => today.filter((m) => kinds.includes(m.kind)).reduce((s, m) => s + toCents(m.quantity), 0);
    const produced = sum(['production']);
    const sold = -sum(['sale']);
    const used = -sum(['farm_consumption', 'calf_feeding', 'spoilage', 'gift', 'other_use']);
    const adjusted = sum(['opening_balance', 'adjustment', 'reversal']);
    const restricted = milk.filter((r) => r.status === 'valid' && r.restricted && r.production_date === d).reduce((s, r) => s + toCents(r.quantity), 0);
    const closing = opening + produced - sold - used + adjusted;
    days.push({ date: d, opening, produced, restricted, sold, used, adjusted, closing });
    opening = closing;
  }
  return days;
}

function addDays(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// --- Customers --------------------------------------------------------------------

/** Amount still due on each completed sale, from allocations of completed payments. */
export function saleDue(sales: Sale[], payments: Payment[], allocations: Allocation[]): Map<string, number> {
  const live = new Set(payments.filter((p) => p.status === 'completed').map((p) => p.id));
  const paid = new Map<string, number>();
  for (const a of allocations) if (live.has(a.payment_id)) paid.set(a.sale_id, (paid.get(a.sale_id) ?? 0) + toCents(a.amount));
  return new Map(
    sales.filter((s) => s.status === 'completed').map((s) => [s.id, Math.max(0, toCents(s.total) - (paid.get(s.id) ?? toCents(s.local_amount_paid ?? '0')))]),
  );
}

/**
 * sales − payments − adjustments + refunds, per currency. Positive: the customer owes;
 * negative: they are in credit. Includes money taken with sales not yet synced.
 */
export function balances(customerId: string, sales: Sale[], payments: Payment[]): Record<string, number> {
  const out: Record<string, number> = {};
  const add = (currency: string, c: number) => (out[currency] = (out[currency] ?? 0) + c);
  const paymentIds = new Set(payments.map((p) => p.id));
  for (const s of sales) {
    if (s.customer_id !== customerId || s.status !== 'completed') continue;
    add(s.currency, toCents(s.total));
    // An unsynced sale's payment exists only on the sale until the server sends it.
    if (s.local_amount_paid && !paymentIds.has(s.local_payment_id ?? '')) add(s.currency, -toCents(s.local_amount_paid));
  }
  for (const p of payments) {
    if (p.customer_id !== customerId || p.status !== 'completed') continue;
    add(p.currency, p.kind === 'refund' ? toCents(p.amount) : -toCents(p.amount));
  }
  return out;
}

/** Customers that may be the same person: same phone digits, or the same name ignoring case and spaces. */
export function likelyDuplicates(customers: Customer[], name: string, phone: string | null): Customer[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const digits = (s: string | null) => (s ?? '').replace(/\D/g, '').slice(-9);
  const n = norm(name);
  const p = digits(phone);
  return customers.filter((c) => (n.length >= 3 && (norm(c.name) === n || norm(c.name).includes(n) || n.includes(norm(c.name)))) || (p.length >= 7 && digits(c.phone) === p));
}

// --- Financial summary -----------------------------------------------------------------

export interface FinanceSummary {
  currency: string;
  revenueCents: number; // completed sales in the period (amount owed on them)
  salesCount: number;
  litresCl: number;
  receiptsCents: number; // payments received in the period
  refundsCents: number;
  adjustmentsCents: number; // discounts and write-offs
  expensesCents: number;
  operatingResultCents: number; // recorded revenue − recorded expenses; not audited profit
  outstandingCents: number; // what customers owe now (credit balances excluded)
}

const inPeriod = (date: string, from: string, to: string) => date >= from && date <= to;

/** Accrual basis: revenue when sold, receipts when paid, expenses on their date. */
export function summarize(
  currency: string,
  from: string,
  to: string,
  data: { sales: Sale[]; payments: Payment[]; expenses: Expense[]; customers: Customer[] },
  farmDate: (iso: string) => string,
): FinanceSummary {
  const sales = data.sales.filter((s) => s.currency === currency && s.status === 'completed' && inPeriod(farmDate(s.sale_at), from, to));
  const pays = data.payments.filter((p) => p.currency === currency && p.status === 'completed' && inPeriod(farmDate(p.paid_at), from, to));
  const sum = (kind: Payment['kind']) => pays.filter((p) => p.kind === kind).reduce((s, p) => s + toCents(p.amount), 0);
  const revenue = sales.reduce((s, x) => s + toCents(x.total), 0);
  const expenses = data.expenses
    .filter((e) => e.currency === currency && e.status === 'active' && inPeriod(e.expense_date, from, to))
    .reduce((s, e) => s + toCents(e.amount), 0);
  const outstanding = data.customers.reduce((s, c) => s + Math.max(0, balances(c.id, data.sales, data.payments)[currency] ?? 0), 0);
  return {
    currency,
    revenueCents: revenue,
    salesCount: sales.length,
    litresCl: sales.reduce((s, x) => s + toCents(x.quantity), 0),
    receiptsCents: sum('payment'),
    refundsCents: sum('refund'),
    adjustmentsCents: sum('adjustment'),
    expensesCents: expenses,
    operatingResultCents: revenue - expenses,
    outstandingCents: outstanding,
  };
}
