import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { money, toCents } from '../../finance/calc';
import { ExpenseForm, type ExpenseFields } from '../../finance/ExpenseForm';
import { CATEGORY_LABELS, type Expense, METHOD_LABELS } from '../../finance/model';
import { editExpense, setReceiptPhoto, voidExpense } from '../../finance/repo';
import { api } from '../../lib/api';
import { formatDate } from '../../lib/dates';
import { getRecord, useLocal } from '../../sync/store';
import { Button, FormScreen, Notice, TextField } from '../../ui/form';
import { SyncBadge } from '../../ui/SyncBadge';
import { Details, FormCard, Hero, ListGroup, ListRow, Pill } from '../../ui/kit';
import { radius } from '../../ui/theme';

export default function ExpenseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const stored = useLocal(() => getRecord<Expense>('farm_expenses', id), id);
  const [mode, setMode] = useState<'view' | 'edit' | 'void'>('view');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  const receiptPath = stored?.data.receipt_path ?? null;

  useEffect(() => {
    if (!receiptPath) return;
    api<{ url: string }>(`/v1/expenses/${id}/receipt-url`)
      .then(({ url }) => setReceiptUrl(url))
      .catch(() => {});
  }, [id, receiptPath]);

  if (!stored) return <FormScreen title="Expense"><Notice tone="error">This expense is not on this phone.</Notice></FormScreen>;
  const e = stored.data;
  const photo = e.local_receipt_uri ? { uri: e.local_receipt_uri } : receiptUrl && receiptPath ? { uri: receiptUrl, cacheKey: receiptPath } : null;

  async function addReceipt() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return Alert.alert('Permission needed', 'Allow camera access in the phone settings to photograph the receipt.');
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
    if (!result.canceled) await setReceiptPhoto(stored!, result.assets[0].uri);
  }

  function doVoid() {
    if (reason.trim().length < 3) return setError('Say why the expense is being voided.');
    Alert.alert('Void this expense?', 'It stays in the list as voided and no longer counts in totals.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Void', style: 'destructive', onPress: () => { voidExpense(stored!, reason.trim()); router.back(); } },
    ]);
  }

  if (mode === 'edit') {
    return (
      <FormScreen title="Correct expense" intro="The old values are kept in the audit history.">
        <ExpenseForm
          initial={e as ExpenseFields}
          submitLabel="Save correction"
          onSubmit={(fields) => {
            const changes = Object.fromEntries(Object.entries(fields).filter(([k, v]) => v !== e[k as keyof Expense]));
            if (Object.keys(changes).length) editExpense(stored, changes);
            setMode('view');
          }}
        />
        <Button label="Cancel" variant="link" onPress={() => setMode('view')} />
      </FormScreen>
    );
  }

  return (
    <FormScreen title="Expense">
      <Hero
        label={`${CATEGORY_LABELS[e.category]} · ${formatDate(e.expense_date)}`}
        value={money(toCents(e.amount), e.currency)}
        tone={e.status === 'voided' ? 'muted' : undefined}
        pill={
          e.status === 'voided' ? (
            <Pill label="Voided" tint="sky" />
          ) : e.payment_status === 'paid' ? (
            <Pill label="Paid" />
          ) : (
            <Pill label={e.payment_status === 'unpaid' ? 'Not paid yet' : 'Partly paid'} tint="straw" />
          )
        }
      />
      <SyncBadge state={stored.sync_state} />
      {e.status === 'voided' && e.void_reason ? <Notice>Voided: {e.void_reason}</Notice> : null}
      <Details
        rows={[
          ['Paid to', e.payee],
          ['Method', e.payment_method ? METHOD_LABELS[e.payment_method] : null],
          ['Note', e.notes],
        ]}
      />
      {photo ? <Image source={photo} style={{ width: '100%', aspectRatio: 3 / 4, borderRadius: radius.card }} contentFit="contain" accessibilityLabel="Receipt photo" cachePolicy="disk" /> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {e.status === 'active' && mode === 'view' ? (
        <ListGroup>
          <ListRow icon="camera-outline" title={photo ? 'Replace receipt photo' : 'Photograph the receipt'} onPress={addReceipt} />
          <ListRow icon="pencil-outline" title="Correct this expense" subtitle="Old values stay in the history" onPress={() => setMode('edit')} />
          <ListRow icon="close-circle-outline" tint="red" title="Void" subtitle="Only if entered by mistake" onPress={() => setMode('void')} />
        </ListGroup>
      ) : null}
      {mode === 'void' ? (
        <FormCard title="Void this expense">
          <TextField label="Why?" value={reason} onChangeText={setReason} />
          <Button label="Void expense" variant="danger" onPress={doVoid} />
          <Button label="Cancel" variant="link" onPress={() => setMode('view')} />
        </FormCard>
      ) : null}
    </FormScreen>
  );
}
