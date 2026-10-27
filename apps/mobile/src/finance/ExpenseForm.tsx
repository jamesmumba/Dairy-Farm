import { useState } from 'react';
import { CURRENCIES } from '../lib/account';
import { Chips } from '../ui/Chips';
import { DateField } from '../ui/DateField';
import { Button, Notice, TextField } from '../ui/form';
import { CATEGORY_LABELS, type Expense, METHOD_LABELS, type Method } from './model';

export type ExpenseFields = Pick<Expense, 'expense_date' | 'category' | 'amount' | 'currency' | 'payee' | 'payment_method' | 'payment_status' | 'notes'>;

const STATUS = { paid: 'Paid', partially_paid: 'Partly paid', unpaid: 'Not paid yet' } as const;

/** New expense and correction share one form. */
export function ExpenseForm({ initial, submitLabel, onSubmit }: { initial: ExpenseFields; submitLabel: string; onSubmit: (fields: ExpenseFields) => void }) {
  const [v, setV] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<ExpenseFields>) => setV((x) => ({ ...x, ...patch }));

  function submit() {
    const amount = v.amount.trim().replace(',', '.');
    if (!/^\d{1,12}(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) return setError('Enter the amount.');
    onSubmit({ ...v, amount, payee: v.payee?.trim() || null, notes: v.notes?.trim() || null });
  }

  return (
    <>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <DateField label="Date" value={v.expense_date} onChange={(d) => d && set({ expense_date: d })} optional={false} />
      <Chips label="Category" value={v.category} options={Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value: value as Expense['category'], label }))} onChange={(c) => c && set({ category: c })} allowClear={false} />
      <TextField label={`Amount (${v.currency})`} value={v.amount} onChangeText={(amount) => set({ amount })} keyboardType="decimal-pad" />
      {CURRENCIES.length > 1 ? <Chips label="Currency" value={v.currency} options={CURRENCIES} onChange={(c) => c && set({ currency: c })} allowClear={false} /> : null}
      <TextField label="Paid to (optional)" value={v.payee ?? ''} onChangeText={(payee) => set({ payee })} />
      <Chips label="Status" value={v.payment_status} options={Object.entries(STATUS).map(([value, label]) => ({ value: value as Expense['payment_status'], label }))} onChange={(s) => s && set({ payment_status: s })} allowClear={false} />
      <Chips label="Paid by" value={v.payment_method} options={(Object.keys(METHOD_LABELS) as Method[]).map((m) => ({ value: m, label: METHOD_LABELS[m] }))} onChange={(m) => set({ payment_method: m })} />
      <TextField label="Notes (optional)" value={v.notes ?? ''} onChangeText={(notes) => set({ notes })} multiline />
      <Button label={submitLabel} onPress={submit} />
    </>
  );
}
