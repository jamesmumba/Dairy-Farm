// What care cost: expenses recorded against a care record (a vet visit, a treatment, an insemination…).

import { toCents } from '../finance/calc';
import type { Expense } from '../finance/model';
import { listRecords } from '../sync/store';
import type { CareKind } from './model';

/** Kinds an expense can be recorded against, with the category it usually falls under. */
export const COST_CATEGORY: Partial<Record<CareKind, Expense['category']>> = {
  health: 'veterinary_care',
  'vet-visit': 'veterinary_care',
  treatment: 'medicines',
  breeding: 'veterinary_care',
  'pregnancy-check': 'veterinary_care',
  calving: 'veterinary_care',
  vaccination: 'medicines',
};

/** Active expenses recorded against any of these records. */
export const expensesFor = (ids: string[]) =>
  listRecords<Expense>('farm_expenses')
    .map((r) => r.data)
    .filter((e) => e.status === 'active' && !!e.care_id && ids.includes(e.care_id));

/** Totals per currency, in cents (a farm normally has one). */
export function totalCost(expenses: Pick<Expense, 'amount' | 'currency'>[]) {
  const totals = new Map<string, number>();
  for (const e of expenses) totals.set(e.currency, (totals.get(e.currency) ?? 0) + toCents(e.amount));
  return [...totals.entries()];
}
