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
import { Card, Figure, FormCard, ListGroup, SectionHeader } from '../ui/kit';
import { spacing, type, useTheme } from '../ui/theme';

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
    <FormScreen title="Milk prices">
      <Card>
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          {CURRENCIES.map((c) => {
            const p = listPrice(f.prices, c.value, now);
            return <Figure key={c.value} label={`${c.value} per litre now`} value={p ? p.price_per_litre : 'Not set'} />;
          })}
        </View>
        <Text style={{ color: t.textMuted, ...type.caption }}>Changing the price never changes past sales.</Text>
      </Card>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <FormCard title="Set a new price">
        <Chips label="Currency" value={currency} options={CURRENCIES} onChange={(v) => v && setCurrency(v)} allowClear={false} />
        <TextField label={`Price per litre (${currency})`} value={price} onChangeText={setPriceText} keyboardType="decimal-pad" />
        <DateTimeField label="Starts" value={from} onChange={(v) => v && setFrom(v)} allowFuture optional={false} />
        <TextField label="Reason (optional)" value={reason} onChangeText={setReason} />
        <Button label="Set price" onPress={save} />
      </FormCard>

      {history.length ? (
        <>
          <SectionHeader title="History" />
          <ListGroup>
            {history.map((p) => {
              const waiting = (getRecord('milk_prices', p.id)?.sync_state ?? 'synced') !== 'synced';
              return (
                <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md }} accessible>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ color: t.text, ...type.body }}>From {formatDateTime(p.effective_from)}</Text>
                    {p.reason || waiting ? <Text style={{ color: t.textMuted, ...type.secondary }}>{[p.reason, waiting ? 'waiting to sync' : null].filter(Boolean).join(' · ')}</Text> : null}
                  </View>
                  <Text style={{ color: t.text, ...type.cardTitle, fontVariant: ['tabular-nums'] }}>
                    {p.currency} {p.price_per_litre}
                  </Text>
                </View>
              );
            })}
          </ListGroup>
        </>
      ) : null}
    </FormScreen>
  );
}
