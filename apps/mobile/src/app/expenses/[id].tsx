import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { money, toCents } from '../../finance/calc';
import { ExpenseForm, type ExpenseFields } from '../../finance/ExpenseForm';
import { CATEGORY_LABELS, type Expense, METHOD_LABELS, type Method } from '../../finance/model';
import { editExpense, setReceiptPhoto, voidExpense } from '../../finance/repo';
import { api } from '../../lib/api';
import { formatDate } from '../../lib/dates';
import { getRecord, useLocal } from '../../sync/store';
import { BottomSheet } from '../../ui/BottomSheet';
import { Chips } from '../../ui/Chips';
import { DateField, toDateString } from '../../ui/DateField';
import { Button, FormScreen, Notice, TextField } from '../../ui/form';
import { MissingRecord } from '../../ui/ProblemView';
import { SyncBadge } from '../../ui/SyncBadge';
import { Details, FormCard, Hero, ListGroup, ListRow, Pill } from '../../ui/kit';
import { radius } from '../../ui/theme';
import { useOpenOrBack } from '../../ui/useOpenOrBack';
import { displayName } from '../../animals/model';
import { KIND_ICON } from '../../care/AnimalCare';
import { CARE_FORMS } from '../../care/forms';
import { CARE_KINDS, type CareKind } from '../../care/model';
import { getCare } from '../../care/repo';
import { useCareContext } from '../../care/useCareContext';

export default function ExpenseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const stored = useLocal(() => getRecord<Expense>('farm_expenses', id), id);
  const open = useOpenOrBack();
  const careCtx = useCareContext();
  const allAnimals = careCtx.animals;
  const [mode, setMode] = useState<'view' | 'edit' | 'void' | 'pay'>('view');
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

  if (!stored) return <MissingRecord what="expense" />;
  const e = stored.data;
  // The care record this expense paid for, with the animal's name.
  const careKind = e.care_kind && e.care_kind in CARE_KINDS ? (e.care_kind as CareKind) : null;
  const careRow = careKind && e.care_id ? getCare<{ id: string; version: number; deleted_at: string | null; cattle_id?: string; dam_id?: string }>(careKind, e.care_id)?.data : null;
  const careAnimal = careRow ? allAnimals.find((a) => a.id === (careRow.cattle_id ?? careRow.dam_id)) : undefined;
  const forRecord =
    careKind && careRow
      ? { kind: careKind, id: careRow.id, subtitle: [careAnimal ? displayName(careAnimal) : null, CARE_FORMS[careKind].summary(careRow, careCtx)].filter(Boolean).join(' · ') }
      : null;
  const photo = e.local_receipt_uri ? { uri: e.local_receipt_uri } : receiptUrl && receiptPath ? { uri: receiptUrl, cacheKey: receiptPath } : null;

  async function addReceipt() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return Alert.alert('Permission needed', 'Allow camera access in the phone settings to photograph the receipt.');
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
    if (!result.canceled) await setReceiptPhoto(stored!, result.assets[0].uri);
  }

  /** The rest is paid: the status changes, and the day it was paid goes in the note. */
  function markPaid(paidOn: string, method: Method) {
    const line = `Paid on ${paidOn}`;
    editExpense(stored!, { payment_status: 'paid', payment_method: method, notes: e.notes ? `${e.notes}\n${line}` : line });
    setMode('view');
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
      <FormScreen card title="Correct expense" intro="The old values are kept in the audit history.">
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
      {forRecord ? (
        <ListGroup>
          <ListRow icon={KIND_ICON[forRecord.kind]} title={`For: ${CARE_KINDS[forRecord.kind].label}`} subtitle={forRecord.subtitle} onPress={() => open({ pathname: '/care/[kind]/[id]', params: { kind: forRecord.kind, id: forRecord.id } })} />
        </ListGroup>
      ) : null}
      {photo ? <Image source={photo} style={{ width: '100%', aspectRatio: 3 / 4, borderRadius: radius.card }} contentFit="contain" accessibilityLabel="Receipt photo" cachePolicy="disk" /> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {e.status === 'active' && mode === 'view' ? (
        <ListGroup>
          {e.payment_status !== 'paid' ? <ListRow icon="cash-check" title="Mark paid" subtitle={e.payment_status === 'unpaid' ? 'Not paid yet' : 'Partly paid so far'} onPress={() => setMode('pay')} /> : null}
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
      {mode === 'pay' ? <MarkPaidSheet initialMethod={e.payment_method} notBefore={e.expense_date} onClose={() => setMode('view')} onSave={markPaid} /> : null}
    </FormScreen>
  );
}

function MarkPaidSheet({ initialMethod, notBefore, onClose, onSave }: { initialMethod: Method | null; notBefore: string; onClose: () => void; onSave: (paidOn: string, method: Method) => void }) {
  const [paidOn, setPaidOn] = useState(toDateString(new Date()));
  const [method, setMethod] = useState<Method>(initialMethod && initialMethod !== 'credit' ? initialMethod : 'cash');
  const [error, setError] = useState<string | null>(null);
  return (
    <BottomSheet
      visible
      title="Mark paid"
      onClose={onClose}
      footer={<Button label="Save as paid" onPress={() => (paidOn < notBefore ? setError('It cannot be paid before the expense date.') : onSave(paidOn, method))} />}
    >
      {error ? <Notice tone="error">{error}</Notice> : null}
      <DateField label="Paid on" value={paidOn} onChange={(d) => d && setPaidOn(d)} optional={false} />
      <Chips label="Paid by" value={method} options={(Object.keys(METHOD_LABELS) as Method[]).filter((m) => m !== 'credit').map((m) => ({ value: m, label: METHOD_LABELS[m] }))} onChange={(m) => m && setMethod(m)} allowClear={false} />
    </BottomSheet>
  );
}
