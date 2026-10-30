// "This looks already recorded" for money: the same sale, payment or expense entered twice, usually on
// two phones or by tapping save again. The farmer is asked, never blocked. Pure, so it can be tested.

import { toCents } from './calc';
import type { Expense, Payment, Sale } from './model';

/** Two entries this close together, for the same customer and amount, look like one. */
const SAME_ENTRY_MINUTES = 30;
const near = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) <= SAME_ENTRY_MINUTES * 60_000;

export function existingSale(sales: Sale[], s: { customer_id: string; quantity: string; sale_at: string }) {
  return sales.find((x) => x.status === 'completed' && x.customer_id === s.customer_id && toCents(x.quantity) === toCents(s.quantity) && near(x.sale_at, s.sale_at)) ?? null;
}

export function existingPayment(payments: Payment[], p: { customer_id: string; kind: Payment['kind']; amount: string; paid_at: string }) {
  return payments.find((x) => x.status === 'completed' && x.customer_id === p.customer_id && x.kind === p.kind && toCents(x.amount) === toCents(p.amount) && near(x.paid_at, p.paid_at)) ?? null;
}

export function existingExpense(expenses: Expense[], e: { expense_date: string; category: Expense['category']; amount: string; currency: string }) {
  return (
    expenses.find((x) => x.status === 'active' && x.expense_date === e.expense_date && x.category === e.category && x.currency === e.currency && toCents(x.amount) === toCents(e.amount)) ?? null
  );
}
