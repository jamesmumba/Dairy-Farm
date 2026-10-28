import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Text } from 'react-native';
import { money, toCents } from '../../finance/calc';
import { METHOD_LABELS, type Method, type Payment } from '../../finance/model';
import { recordPayment } from '../../finance/repo';
import { useFinance } from '../../finance/useFinance';
import { CURRENCIES } from '../../lib/account';
import { Chips } from '../../ui/Chips';
import { DateTimeField } from '../../ui/DateField';
import { Button, FormScreen, Notice, TextField } from '../../ui/form';
import { useTheme } from '../../ui/theme';

const KINDS = { payment: 'Payment received', refund: 'Refund to customer', adjustment: 'Discount or write-off' } as const;

export default function NewPayment() {
  const t = useTheme();
  const params = useLocalSearchParams<{ customer_id?: string; currency?: string }>();
  const f = useFinance();
  const [customerId, setCustomerId] = useState<string | null>(params.customer_id ?? null);
  const [kind, setKind] = useState<Payment['kind']>('payment');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(params.currency ?? f.currency);
  const [method, setMethod] = useState<Method>('cash');
  const [paidAt, setPaidAt] = useState(new Date().toISOString());
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const customer = f.customers.find((c) => c.id === customerId);
  const balance = customer ? (f.balanceOf(customer.id)[currency] ?? 0) : 0;

  function save() {
    setError(null);
    const a = amount.trim().replace(',', '.');
    if (!customer) return setError('Choose the customer.');
    if (!/^\d{1,12}(\.\d{1,2})?$/.test(a) || Number(a) <= 0) return setError('Enter the amount.');
    if (kind !== 'payment' && reason.trim().length < 3) return setError('Say why.');
    if (kind === 'refund' && toCents(a) > -balance) return setError(`A refund cannot be more than the customer’s credit (${money(Math.max(0, -balance), currency)}).`);
    if (kind === 'adjustment' && toCents(a) > balance) return setError(`A discount or write-off cannot be more than what is owed (${money(Math.max(0, balance), currency)}).`);
    const after = balance + (kind === 'refund' ? toCents(a) : -toCents(a));
    Alert.alert('Confirm', `${KINDS[kind]}: ${money(toCents(a), currency)} — ${customer.name}\nBalance after: ${after > 0 ? `owes ${money(after, currency)}` : after < 0 ? `in credit ${money(-after, currency)}` : 'settled'}`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Save',
        onPress: () => {
          recordPayment({
            customer_id: customer.id,
            kind,
            amount: a,
            currency,
            method: kind === 'adjustment' ? 'other' : method,
            paid_at: paidAt,
            reference: reference.trim() || null,
            notes: null,
            reason: kind === 'payment' ? null : reason.trim(),
          });
          router.replace({ pathname: '/customers/[id]', params: { id: customer.id } });
        },
      },
    ]);
  }

  return (
    <FormScreen card title="Record a payment" intro="Payments are applied to the customer’s oldest unpaid sales first; anything extra is kept as credit for their next sales.">
      {error ? <Notice tone="error">{error}</Notice> : null}
      {customer ? (
        <Text style={{ color: t.text, fontSize: 18, fontWeight: '600' }}>{customer.name}</Text>
      ) : (
        <Chips label="Customer" value={customerId} options={f.customers.filter((c) => c.active).map((c) => ({ value: c.id, label: c.name }))} onChange={setCustomerId} />
      )}
      {customer ? (
        <Text style={{ color: balance > 0 ? t.danger : t.textMuted, fontSize: 16 }}>
          {balance > 0 ? `Owes ${money(balance, currency)}` : balance < 0 ? `In credit ${money(-balance, currency)}` : 'Nothing owed'}
        </Text>
      ) : null}
      <Chips label="Type" value={kind} options={Object.entries(KINDS).map(([value, label]) => ({ value: value as Payment['kind'], label }))} onChange={(v) => v && setKind(v)} allowClear={false} />
      <TextField label={`Amount (${currency})`} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
      {CURRENCIES.length > 1 ? <Chips label="Currency" value={currency} options={CURRENCIES} onChange={(v) => v && setCurrency(v)} allowClear={false} /> : null}
      {kind !== 'adjustment' ? (
        <Chips label="Method" value={method} options={(Object.keys(METHOD_LABELS) as Method[]).filter((m) => m !== 'credit').map((m) => ({ value: m, label: METHOD_LABELS[m] }))} onChange={(v) => v && setMethod(v)} allowClear={false} />
      ) : null}
      <DateTimeField label="Date" value={paidAt} onChange={(v) => v && setPaidAt(v)} optional={false} />
      <TextField label="Reference (optional)" hint="e.g. mobile money transaction ID" value={reference} onChangeText={setReference} />
      {kind !== 'payment' ? <TextField label="Reason" value={reason} onChangeText={setReason} /> : null}
      <Button label="Review and save" onPress={save} />
    </FormScreen>
  );
}
