import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Text } from 'react-native';
import { toCents } from '../../finance/calc';
import { USE_LABELS } from '../../finance/model';
import { recordMovement } from '../../finance/repo';
import { useFinance } from '../../finance/useFinance';
import { litres } from '../../production/calc';
import { Chips } from '../../ui/Chips';
import { DateField } from '../../ui/DateField';
import { Button, FormScreen, Notice, TextField } from '../../ui/form';
import { useTheme } from '../../ui/theme';

type Kind = keyof typeof USE_LABELS | 'adjustment' | 'opening_balance';

const KIND_OPTIONS: { value: Kind; label: string }[] = [
  ...Object.entries(USE_LABELS).map(([value, label]) => ({ value: value as Kind, label })),
  { value: 'adjustment', label: 'Adjustment' },
  { value: 'opening_balance', label: 'Opening balance' },
];

export default function NewStockRecord() {
  const t = useTheme();
  const params = useLocalSearchParams<{ kind?: Kind; date?: string }>();
  const f = useFinance();
  const [kind, setKind] = useState<Kind>(params.kind ?? 'farm_consumption');
  const [direction, setDirection] = useState<'add' | 'remove'>('add');
  const [quantity, setQuantity] = useState('');
  const [date, setDate] = useState(params.date ?? f.today);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const outgoing = kind in USE_LABELS || (kind === 'adjustment' && direction === 'remove');
  const needsReason = kind === 'adjustment' || kind === 'opening_balance' || kind === 'other_use';
  const stockCl = f.available(date);

  function save() {
    const q = quantity.trim().replace(',', '.');
    if (!/^\d{1,7}(\.\d{1,2})?$/.test(q) || Number(q) <= 0) return setError('Enter the litres.');
    if (needsReason && reason.trim().length < 3) return setError(kind === 'opening_balance' ? 'Say where the opening figure comes from.' : 'Say why.');
    if (outgoing && toCents(q) > stockCl) return setError(`Only ${litres(stockCl)} L is in stock for this date.`);
    const label = KIND_OPTIONS.find((k) => k.value === kind)!.label;
    Alert.alert('Save stock record?', `${label}: ${outgoing ? '−' : '+'}${q} L on ${date}\nStock: ${litres(stockCl)} L → ${litres(stockCl + (outgoing ? -1 : 1) * toCents(q))} L`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Save',
        onPress: () => {
          recordMovement({ kind, quantity: q, direction: kind === 'adjustment' ? direction : undefined, movement_date: date, reason: reason.trim() || null });
          router.back();
        },
      },
    ]);
  }

  return (
    <FormScreen title="Stock record" intro="Record milk that leaves stock without being sold, or correct stock with a reason. Adjustments are kept in the history.">
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Chips label="What happened" value={kind} options={KIND_OPTIONS} onChange={(v) => v && setKind(v)} allowClear={false} />
      {kind === 'adjustment' ? (
        <Chips label="Adjustment" value={direction} options={[{ value: 'add', label: 'Add milk to stock' }, { value: 'remove', label: 'Remove milk from stock' }]} onChange={(v) => v && setDirection(v)} allowClear={false} />
      ) : null}
      <TextField label="Litres" value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" />
      <DateField label="Date" value={date} onChange={(d) => d && setDate(d)} optional={false} />
      <TextField
        label={needsReason ? (kind === 'opening_balance' ? 'Where does this figure come from?' : 'Reason') : 'Reason (optional)'}
        hint={kind === 'opening_balance' ? 'e.g. counted in the cooler on the first day of using the app' : undefined}
        value={reason}
        onChangeText={setReason}
      />
      <Text style={{ color: t.textMuted, fontSize: 14 }}>Stock for this date: {litres(stockCl)} L</Text>
      <Button label="Review and save" onPress={save} />
    </FormScreen>
  );
}
