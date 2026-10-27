import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Text } from 'react-native';
import { money, toCents } from '../../finance/calc';
import { METHOD_LABELS, type Payment } from '../../finance/model';
import { voidPayment } from '../../finance/repo';
import { useFinance } from '../../finance/useFinance';
import { formatDateTime } from '../../lib/dates';
import { getRecord, useLocal } from '../../sync/store';
import { Button, FormScreen, Notice, TextField } from '../../ui/form';
import { SyncBadge } from '../../ui/SyncBadge';
import { useTheme } from '../../ui/theme';

export default function PaymentScreen() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const f = useFinance();
  const stored = useLocal(() => getRecord<Payment>('payments', id), id);
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (!stored) return <FormScreen title="Payment"><Notice tone="error">This payment is not on this phone.</Notice></FormScreen>;
  const p = stored.data;
  const customer = f.customers.find((c) => c.id === p.customer_id);
  const applied = f.allocations.filter((a) => a.payment_id === p.id).reduce((s, a) => s + toCents(a.amount), 0);

  function doVoid() {
    if (reason.trim().length < 3) return setError('Say why the payment is being voided.');
    Alert.alert('Void this payment?', 'The amount goes back on the customer’s account. The payment stays on the statement as voided.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Void payment', style: 'destructive', onPress: () => { voidPayment(stored!, reason.trim()); router.back(); } },
    ]);
  }

  return (
    <FormScreen title={money(toCents(p.amount), p.currency)} intro={`${{ payment: 'Payment', refund: 'Refund', adjustment: 'Discount or write-off' }[p.kind]} · ${customer?.name ?? ''} · ${formatDateTime(p.paid_at)}`}>
      <SyncBadge state={stored.sync_state} />
      {p.status === 'voided' ? <Notice>Voided: {p.void_reason}</Notice> : null}
      <Text style={{ color: t.text, fontSize: 16 }}>Method: {METHOD_LABELS[p.method]}</Text>
      {p.reference ? <Text style={{ color: t.text, fontSize: 16 }}>Reference: {p.reference}</Text> : null}
      {p.reason ? <Text style={{ color: t.text, fontSize: 16 }}>Reason: {p.reason}</Text> : null}
      {p.kind !== 'refund' && p.status === 'completed' ? (
        <Text style={{ color: t.textMuted, fontSize: 15 }}>
          Applied to sales: {money(applied, p.currency)}
          {toCents(p.amount) > applied ? ` · kept as credit: ${money(toCents(p.amount) - applied, p.currency)}` : ''}
        </Text>
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {p.status === 'completed' && !voiding ? <Button label="Void this payment" variant="link" onPress={() => setVoiding(true)} /> : null}
      {voiding ? (
        <>
          <TextField label="Why is this payment being voided?" value={reason} onChangeText={setReason} />
          <Button label="Void payment" variant="danger" onPress={doVoid} />
          <Button label="Cancel" variant="link" onPress={() => setVoiding(false)} />
        </>
      ) : null}
      {customer ? <Button label={`Open ${customer.name}`} variant="link" onPress={() => router.push({ pathname: '/customers/[id]', params: { id: customer.id } })} /> : null}
    </FormScreen>
  );
}
