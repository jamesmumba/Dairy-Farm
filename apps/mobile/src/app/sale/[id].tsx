import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Text } from 'react-native';
import { fromCents, money, saleDue, saleTotal, toCents } from '../../finance/calc';
import { METHOD_LABELS, type Sale } from '../../finance/model';
import { correctSale, voidSale } from '../../finance/repo';
import { useFinance } from '../../finance/useFinance';
import { formatDateTime } from '../../lib/dates';
import { getRecord, useLocal } from '../../sync/store';
import { Button, FormScreen, Notice, TextField } from '../../ui/form';
import { SyncBadge } from '../../ui/SyncBadge';
import { useTheme } from '../../ui/theme';

export default function SaleScreen() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const f = useFinance();
  const stored = useLocal(() => getRecord<Sale>('milk_sales', id), id);
  const [mode, setMode] = useState<'view' | 'void' | 'correct'>('view');
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!stored) return <FormScreen title="Sale"><Notice tone="error">This sale is not on this phone.</Notice></FormScreen>;
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
            setError(err instanceof Error ? err.message : 'Could not correct the sale.');
          }
        },
      },
    ]);
  }

  return (
    <FormScreen title={money(toCents(s.total), s.currency)} intro={`${customer?.name ?? 'Customer'} · ${formatDateTime(s.sale_at)}`}>
      <SyncBadge state={stored.sync_state} />
      {s.status === 'voided' ? <Notice>Voided: {s.void_reason}</Notice> : null}
      {correctedBy ? <Button label="Open the corrected sale" variant="link" onPress={() => router.replace({ pathname: '/sale/[id]', params: { id: correctedBy.id } })} /> : null}
      {corrects ? <Text style={{ color: t.textMuted, fontSize: 14 }}>Corrects an earlier sale of {money(toCents(corrects.total), corrects.currency)}.</Text> : null}
      <Text style={{ color: t.text, fontSize: 17 }}>
        {s.quantity} L × {s.currency} {s.price_per_litre}
        {s.price_source === 'override' ? ' (special price)' : ''}
      </Text>
      {s.status === 'completed' ? (
        <Text style={{ color: due ? t.danger : t.text, fontSize: 17 }}>{due ? `Still due: ${money(due, s.currency)}` : 'Paid'}</Text>
      ) : null}
      {s.payment_method ? <Text style={{ color: t.textMuted, fontSize: 15 }}>Payment: {METHOD_LABELS[s.payment_method]}</Text> : null}
      {s.notes ? <Text style={{ color: t.text, fontSize: 15 }}>Notes: {s.notes}</Text> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      {s.status === 'completed' && mode === 'view' ? (
        <>
          {due ? <Button label="Record a payment" onPress={() => router.push({ pathname: '/payment/new', params: { customer_id: s.customer_id, currency: s.currency } })} /> : null}
          <Button
            label="Correct this sale"
            variant="secondary"
            onPress={() => {
              setQuantity(s.quantity);
              setPrice(s.price_per_litre);
              setMode('correct');
            }}
          />
          <Button label="Void this sale" variant="link" onPress={() => setMode('void')} />
        </>
      ) : null}
      {mode === 'correct' ? (
        <>
          <TextField label="Litres" value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" />
          <TextField label={`Price per litre (${s.currency})`} value={price} onChangeText={setPrice} keyboardType="decimal-pad" />
          <TextField label="Reason for the correction" hint="Kept with the original and corrected values" value={reason} onChangeText={setReason} />
          <Button label="Save correction" onPress={doCorrect} />
          <Button label="Cancel" variant="link" onPress={() => setMode('view')} />
        </>
      ) : null}
      {mode === 'void' ? (
        <>
          <TextField label="Why is this sale being voided?" value={reason} onChangeText={setReason} />
          <Button label="Void sale" variant="danger" onPress={doVoid} />
          <Button label="Cancel" variant="link" onPress={() => setMode('view')} />
        </>
      ) : null}
      {customer ? <Button label={`Open ${customer.name}`} variant="link" onPress={() => router.push({ pathname: '/customers/[id]', params: { id: customer.id } })} /> : null}
    </FormScreen>
  );
}
