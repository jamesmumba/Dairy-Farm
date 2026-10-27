// Finance reminders from records on the phone: unpaid balances and stock discrepancies.
// Shown in the app only (no phone notifications).

import type { MilkRow } from '../production/calc';
import type { Reminder } from '../care/reminders';
import { balances, money, reconcile, saleDue } from './calc';
import type { Allocation, Customer, Movement, Payment, Sale } from './model';

const UNPAID_AFTER_DAYS = 7;

export function financeReminders(
  data: { customers: Customer[]; sales: Sale[]; payments: Payment[]; allocations: Allocation[]; movements: Movement[] },
  milk: MilkRow[],
  today: string,
  farmDate: (iso: string) => string,
): Reminder[] {
  const out: Reminder[] = [];
  const due = saleDue(data.sales, data.payments, data.allocations);
  const cutoff = new Date(`${today}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - UNPAID_AFTER_DAYS);
  const cutoffDate = cutoff.toISOString().slice(0, 10);

  for (const c of data.customers) {
    for (const [currency, owed] of Object.entries(balances(c.id, data.sales, data.payments))) {
      if (owed <= 0) continue;
      const oldest = data.sales
        .filter((s) => s.customer_id === c.id && s.currency === currency && (due.get(s.id) ?? 0) > 0)
        .map((s) => farmDate(s.sale_at))
        .sort()[0];
      if (!oldest || oldest > cutoffDate) continue;
      out.push({
        key: `unpaid:${c.id}:${currency}`,
        kind: 'unpaid_balance',
        urgency: 'overdue',
        due: oldest,
        cattleId: '',
        title: `${c.name} owes ${money(owed, currency)}`,
        detail: `Unpaid since ${oldest}`,
        href: `/customers/${c.id}`,
        notifyOffsets: [],
      });
    }
  }

  if (data.movements.length) {
    const first = data.movements.map((m) => m.movement_date).sort()[0];
    const negative = reconcile(data.movements, milk, first, today).filter((d) => d.closing < 0);
    if (negative.length) {
      out.push({
        key: 'stock-discrepancy',
        kind: 'stock_discrepancy',
        urgency: 'overdue',
        due: negative[0].date,
        cattleId: '',
        title: 'Stock discrepancy',
        detail: `Stock went below zero on ${negative.length} day(s), first on ${negative[0].date}. Check production and sales.`,
        href: '/stock',
        notifyOffsets: [],
      });
    }
  }
  return out;
}
