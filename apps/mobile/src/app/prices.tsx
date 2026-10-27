import { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { listPrice } from '../finance/calc';
import { setPrice } from '../finance/repo';
import { useFinance } from '../finance/useFinance';
import { CURRENCIES } from '../lib/account';
import { formatDateTime } from '../lib/dates';
import { getRecord } from '../sync/store';
import { Chips } from '../ui/Chips';
import { DateTimeField } from '../ui/DateField';
import { Button, FormScreen, Notice, TextField } from '../ui/form';
import { SyncBadge } from '../ui/SyncBadge';
import { spacing, useTheme } from '../ui/theme';

export default function Prices() {
  const t = useTheme();
  const f = useFinance();
  const [currency, setCurrency] = useState(f.currency);
  const [price, setPriceText] = useState('');
  const [from, setFrom] = useState(new Date().toISOString());
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const now = new Date().toISOString();
  const history = [...f.prices].sort((a, b) => b.effective_from.localeCompare(a.effective_from));

  function save() {
    const p = price.trim().replace(',', '.');
    if (!/^\d{1,8}(\.\d{1,2})?$/.test(p) || Number(p) <= 0) return setError('Enter the price per litre.');
    Alert.alert('Set price?', `${currency} ${p} per litre from ${formatDateTime(from)}.\nSales already recorded keep their own price.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Set price',
        onPress: () => {
          setPrice(currency, p, from, reason.trim() || null);
          setPriceText('');
          setReason('');
          setError(null);
        },
      },
    ]);
  }

  return (
    <FormScreen title="Milk prices" intro="New sales use the price in force at the time of the sale. Changing the price never changes past sales.">
      {CURRENCIES.map((c) => {
        const p = listPrice(f.prices, c.value, now);
        return (
          <Text key={c.value} style={{ color: t.text, fontSize: 18 }}>
            {c.value}: {p ? `${p.price_per_litre} per litre` : 'not set'}
          </Text>
        );
      })}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Chips label="Currency" value={currency} options={CURRENCIES} onChange={(v) => v && setCurrency(v)} allowClear={false} />
      <TextField label={`New price per litre (${currency})`} value={price} onChangeText={setPriceText} keyboardType="decimal-pad" />
      <DateTimeField label="Starts" value={from} onChange={(v) => v && setFrom(v)} allowFuture optional={false} />
      <TextField label="Reason (optional)" value={reason} onChangeText={setReason} />
      <Button label="Set price" onPress={save} />

      <Text accessibilityRole="header" style={{ color: t.text, fontSize: 20, fontWeight: '700', marginTop: spacing.md }}>
        History
      </Text>
      {history.map((p) => (
        <View key={p.id} style={{ borderBottomWidth: 1, borderBottomColor: t.border, paddingVertical: spacing.xs }}>
          <Text style={{ color: t.text, fontSize: 16 }}>
            {p.currency} {p.price_per_litre} from {formatDateTime(p.effective_from)}
          </Text>
          {p.reason ? <Text style={{ color: t.textMuted, fontSize: 14 }}>{p.reason}</Text> : null}
          <SyncBadge state={getRecord('milk_prices', p.id)?.sync_state ?? 'synced'} />
        </View>
      ))}
    </FormScreen>
  );
}
