import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';
import { fromCents, money, saleDue, saleTotal, toCents } from '../../finance/calc';
import { METHOD_LABELS, type Sale } from '../../finance/model';
import { correctSale, voidSale } from '../../finance/repo';
import { useFinance } from '../../finance/useFinance';
import { formatDateTime } from '../../lib/dates';
import { getRecord, useLocal } from '../../sync/store';
import { Button, FormScreen, Notice, TextField } from '../../ui/form';
import { MissingRecord } from '../../ui/ProblemView';
import { SyncBadge } from '../../ui/SyncBadge';
import { Details, FormCard, Hero, ListGroup, ListRow, Pill } from '../../ui/kit';
import { spacing } from '../../ui/theme';
import { friendlyError } from '../../lib/errors';
import { useOpenOrBack } from '../../ui/useOpenOrBack';

export default function SaleScreen() {
  const open = useOpenOrBack();
  const { id } = useLocalSearchParams<{ id: string }>();
  const f = useFinance();
  const stored = useLocal(() => getRecord<Sale>('milk_sales', id), id);
  const [mode, setMode] = useState<'view' | 'void' | 'correct'>('view');
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!stored) return <MissingRecord what="sale" />;
  const s = stored.data;
  const customer = f.customers.find((c) => c.id === s.customer_id);
  const due = saleDue([s], f.payments, f.allocations).get(s.id) ?? 0;
  const correctedBy = f.sales.find((x) => x.corrects_sale_id === s.id);
  const corrects = s.corrects_sale_id ? f.sales.find((x) => x.id === s.corrects_sale_id) : undefined;

  function doVoid() {
    if (reason.trim().length < 3) return setError('Say why the sale is being voided.');
    Alert.alert('Void this sale?', 'It stays on the statement as voided. The milk goes back into stock; money already paid becomes credit for this customer.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Void sale', style: 'destructive', onPress: () => { voidSale(stored!, reason.trim()); router.back(); } },
    ]);
  }

  function doCorrect() {
    const q = quantity.trim().replace(',', '.');
    const p = price.trim().replace(',', '.');
    if (reason.trim().length < 3) return setError('Say why the sale is being corrected.');
    if (!/^\d{1,6}(\.\d{1,2})?$/.test(q) || Number(q) <= 0) return setError('Enter the correct litres.');
    if (!/^\d{1,8}(\.\d{1,2})?$/.test(p) || Number(p) <= 0) return setError('Enter the correct price per litre.');
    const changes = { ...(q !== s.quantity && toCents(q) !== toCents(s.quantity) && { quantity: q }), ...(toCents(p) !== toCents(s.price_per_litre) && { price_per_litre: p }) };
    if (!Object.keys(changes).length) return setError('Nothing changed.');
    const newTotal = fromCents(saleTotal(q, p));
    Alert.alert('Save correction?', `The original sale (${money(toCents(s.total), s.currency)}) is kept as voided, and a corrected sale of ${s.currency} ${newTotal} is recorded with your reason.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Save correction',
        onPress: () => {
          try {
            const newId = correctSale(stored!, changes, reason.trim());
            router.replace({ pathname: '/sale/[id]', params: { id: newId } });
          } catch (err) {
            setError(friendlyError(err, 'Could not correct the sale. Try again.'));
          }
        },
      },
    ]);
  }

  return (
    <FormScreen title="Sale">
      <Hero
        label={`${customer?.name ?? 'Customer'} · ${formatDateTime(s.sale_at)}`}
        value={money(toCents(s.total), s.currency)}
        tone={s.status === 'voided' ? 'muted' : undefined}
        pill={s.status === 'voided' ? <Pill label="Voided" tint="sky" /> : due ? <Pill label={`Still due ${money(due, s.currency)}`} tint="straw" /> : <Pill label="Paid" />}
      />
      <SyncBadge state={stored.sync_state} />
      {s.status === 'voided' && s.void_reason ? <Notice>Voided: {s.void_reason}</Notice> : null}
      {correctedBy ? (
        <ListGroup>
          <ListRow icon="file-replace-outline" tint="sky" title="Open the corrected sale" subtitle="This sale was voided and replaced" onPress={() => router.replace({ pathname: '/sale/[id]', params: { id: correctedBy.id } })} />
        </ListGroup>
      ) : null}
      <Details
        rows={[
          ['Litres', `${s.quantity} L`],
          ['Price per litre', `${s.currency} ${s.price_per_litre}${s.price_source === 'override' ? ' (special)' : ''}`],
          ['Paid by', s.payment_method ? METHOD_LABELS[s.payment_method] : null],
          ['Note', s.notes],
          ['Corrects', corrects ? `An earlier sale of ${money(toCents(corrects.total), corrects.currency)}` : null],
        ]}
      />
      {error ? <Notice tone="error">{error}</Notice> : null}

      {s.status === 'completed' && mode === 'view' ? (
        <View style={{ gap: spacing.sm }}>
          {due ? <Button label="Record a payment" onPress={() => router.push({ pathname: '/payment/new', params: { customer_id: s.customer_id, currency: s.currency } })} /> : null}
          <ListGroup>
            {customer ? <ListRow icon="account-outline" title={customer.name} subtitle="Customer statement" onPress={() => open({ pathname: '/customers/[id]', params: { id: customer.id } })} /> : null}
            <ListRow
              icon="pencil-outline"
              title="Correct this sale"
              subtitle="Keeps the original as voided"
              onPress={() => {
                setQuantity(s.quantity);
                setPrice(s.price_per_litre);
                setMode('correct');
              }}
            />
            <ListRow icon="close-circle-outline" tint="red" title="Void this sale" onPress={() => setMode('void')} />
          </ListGroup>
        </View>
      ) : null}
      {mode === 'correct' ? (
        <FormCard title="Correct this sale">
          <TextField label="Litres" value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" />
          <TextField label={`Price per litre (${s.currency})`} value={price} onChangeText={setPrice} keyboardType="decimal-pad" />
          <TextField label="Reason" hint="Kept with the original and corrected values" value={reason} onChangeText={setReason} />
          <Button label="Save correction" onPress={doCorrect} />
          <Button label="Cancel" variant="text" onPress={() => setMode('view')} />
        </FormCard>
      ) : null}
      {mode === 'void' ? (
        <FormCard title="Void this sale">
          <TextField label="Why?" value={reason} onChangeText={setReason} />
          <Button label="Void sale" variant="danger" onPress={doVoid} />
          <Button label="Cancel" variant="text" onPress={() => setMode('view')} />
        </FormCard>
      ) : null}
    </FormScreen>
  );
}
