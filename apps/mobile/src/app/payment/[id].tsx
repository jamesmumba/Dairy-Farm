import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';
import { money, toCents } from '../../finance/calc';
import { METHOD_LABELS, type Payment } from '../../finance/model';
import { voidPayment } from '../../finance/repo';
import { useFinance } from '../../finance/useFinance';
import { formatDateTime } from '../../lib/dates';
import { getRecord, useLocal } from '../../sync/store';
import { Button, FormScreen, Notice, TextField } from '../../ui/form';
import { MissingRecord } from '../../ui/ProblemView';
import { SyncBadge } from '../../ui/SyncBadge';
import { Details, FormCard, Hero, ListGroup, ListRow, Pill } from '../../ui/kit';

export default function PaymentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const f = useFinance();
  const stored = useLocal(() => getRecord<Payment>('payments', id), id);
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (!stored) return <MissingRecord what="payment" />;
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
    <FormScreen title={{ payment: 'Payment', refund: 'Refund', adjustment: 'Discount or write-off' }[p.kind]}>
      <Hero
        label={`${customer?.name ?? 'Customer'} · ${formatDateTime(p.paid_at)}`}
        value={money(toCents(p.amount), p.currency)}
        tone={p.status === 'voided' ? 'muted' : undefined}
        pill={p.status === 'voided' ? <Pill label="Voided" tint="sky" /> : undefined}
      />
      <SyncBadge state={stored.sync_state} />
      {p.status === 'voided' && p.void_reason ? <Notice>Voided: {p.void_reason}</Notice> : null}
      <Details
        rows={[
          ['Method', METHOD_LABELS[p.method]],
          ['Reference', p.reference],
          ['Reason', p.reason],
          ['Applied to sales', p.kind !== 'refund' && p.status === 'completed' ? money(applied, p.currency) : null],
          ['Kept as credit', p.kind !== 'refund' && p.status === 'completed' && toCents(p.amount) > applied ? money(toCents(p.amount) - applied, p.currency) : null],
        ]}
      />
      {error ? <Notice tone="error">{error}</Notice> : null}
      {!voiding ? (
        <ListGroup>
          {customer ? <ListRow icon="account-outline" title={customer.name} subtitle="Customer statement" href={{ pathname: '/customers/[id]', params: { id: customer.id } }} /> : null}
          {p.status === 'completed' ? <ListRow icon="close-circle-outline" tint="red" title="Void this payment" onPress={() => setVoiding(true)} /> : null}
        </ListGroup>
      ) : (
        <FormCard title="Void this payment">
          <TextField label="Why?" value={reason} onChangeText={setReason} />
          <Button label="Void payment" variant="danger" onPress={doVoid} />
          <Button label="Cancel" variant="link" onPress={() => setVoiding(false)} />
        </FormCard>
      )}
    </FormScreen>
  );
}
