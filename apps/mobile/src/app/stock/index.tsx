import { type Href, router } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { reconcile } from '../../finance/calc';
import { MOVEMENT_LABELS, type Movement } from '../../finance/model';
import { reverseMovement } from '../../finance/repo';
import { useFinance } from '../../finance/useFinance';
import { formatDate } from '../../lib/dates';
import { litres, type Period, periodRange } from '../../production/calc';
import { listMilk } from '../../production/repo';
import { useLocal } from '../../sync/store';
import { Chips } from '../../ui/Chips';
import { Button, Notice, TextField } from '../../ui/form';
import { radius, spacing, useTheme, useCardBasis } from '../../ui/theme';

const REVERSIBLE = ['farm_consumption', 'calf_feeding', 'spoilage', 'gift', 'other_use', 'adjustment', 'opening_balance'];

export default function Stock() {
  const t = useTheme();
  const basis = useCardBasis();
  const f = useFinance();
  const milk = useLocal(() => listMilk().map((m) => m.data));
  const [period, setPeriod] = useState<Exclude<Period, 'year'>>('week');
  const [reversing, setReversing] = useState<Movement | null>(null);
  const [reason, setReason] = useState('');

  const range = periodRange(period, f.today);
  const to = range.to > f.today ? f.today : range.to;
  const days = reconcile(f.movements, milk, range.from, to);
  const discrepancies = reconcile(f.movements, milk, '2000-01-01', f.today).filter((d) => d.closing < 0);
  const reversed = new Set(f.movements.map((m) => m.reverses_id).filter(Boolean));
  const recent = [...f.movements]
    .filter((m) => REVERSIBLE.includes(m.kind) || m.kind === 'reversal')
    .sort((a, b) => b.movement_date.localeCompare(a.movement_date))
    .slice(0, 15);

  function confirmReverse() {
    if (!reversing || reason.trim().length < 3) return;
    Alert.alert('Reverse this record?', 'An opposite stock record is added with your reason; the original stays in the history.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reverse',
        onPress: () => {
          reverseMovement(reversing, reason.trim());
          setReversing(null);
          setReason('');
        },
      },
    ]);
  }

  const totals = days.reduce((s, d) => ({ produced: s.produced + d.produced, sold: s.sold + d.sold, used: s.used + d.used, adjusted: s.adjusted + d.adjusted, restricted: s.restricted + d.restricted }), {
    produced: 0,
    sold: 0,
    used: 0,
    adjusted: 0,
    restricted: 0,
  });

  return (
    <ScrollView style={{ backgroundColor: t.background }} contentContainerStyle={{ padding: spacing.md, gap: spacing.sm }}>
      <View style={{ backgroundColor: t.surface, borderRadius: radius.card, borderWidth: 1, borderColor: t.border, padding: spacing.md }} accessible>
        <Text style={{ color: t.textMuted, fontSize: 14 }}>Saleable milk in stock now</Text>
        <Text style={{ color: t.text, fontSize: 26, fontWeight: '700' }}>{litres(f.available(f.today))} L</Text>
        <Text style={{ color: t.textMuted, fontSize: 13 }}>Milk under withdrawal is never counted. {f.unsyncedStockItems ? `Includes ${f.unsyncedStockItems} records not yet synced.` : ''}</Text>
      </View>
      {discrepancies.length ? (
        <Notice tone="error">
          Stock went below zero on {discrepancies.map((d) => formatDate(d.date)).join(', ')}. Check those days for missing production or wrong sales, then correct them or make an
          adjustment with a reason. Nothing is corrected automatically.
        </Notice>
      ) : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {[
          ['Record milk use', { pathname: '/stock/new', params: { kind: 'farm_consumption' } }],
          ['Adjustment', { pathname: '/stock/new', params: { kind: 'adjustment' } }],
          ['Opening balance', { pathname: '/stock/new', params: { kind: 'opening_balance' } }],
        ].map(([label, href]) => (
          <View key={label as string} style={{ flexBasis: basis, flexGrow: 1 }}>
            <Button label={label as string} variant="secondary" onPress={() => router.push(href as Href)} />
          </View>
        ))}
      </View>

      <Chips label="Period" value={period} options={[{ value: 'today', label: 'Today' }, { value: 'week', label: 'This week' }, { value: 'month', label: 'This month' }]} onChange={(v) => v && setPeriod(v)} allowClear={false} />
      <Text style={{ color: t.text, fontSize: 15 }}>
        Opening {litres(days[0]?.opening ?? 0)} L + produced {litres(totals.produced)} L − sold {litres(totals.sold)} L − used {litres(totals.used)} L {totals.adjusted >= 0 ? '+' : '−'} adjusted{' '}
        {litres(Math.abs(totals.adjusted))} L = closing {litres(days[days.length - 1]?.closing ?? 0)} L
      </Text>
      {totals.restricted ? <Text style={{ color: t.textMuted, fontSize: 14 }}>Also produced under milk withdrawal (not in stock): {litres(totals.restricted)} L</Text> : null}

      <View accessibilityRole="list">
        <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: t.border, paddingVertical: 4 }}>
          {['Day', 'Open', 'In', 'Sold', 'Used', '±', 'Close'].map((h) => (
            <Text key={h} style={{ flex: h === 'Day' ? 1.4 : 1, color: t.textMuted, fontSize: 12 }}>
              {h}
            </Text>
          ))}
        </View>
        {days.map((d) => (
          <View
            key={d.date}
            accessible
            accessibilityLabel={`${formatDate(d.date)}: opening ${litres(d.opening)}, produced ${litres(d.produced)}, sold ${litres(d.sold)}, used ${litres(d.used)}, adjusted ${litres(d.adjusted)}, closing ${litres(d.closing)} litres`}
            style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: t.border, paddingVertical: 6 }}
          >
            {[formatDate(d.date).slice(0, 5), d.opening, d.produced, d.sold, d.used, d.adjusted, d.closing].map((v, i) => (
              <Text key={i} style={{ flex: i === 0 ? 1.4 : 1, color: i === 6 && d.closing < 0 ? t.danger : t.text, fontSize: 13, fontVariant: ['tabular-nums'] }}>
                {typeof v === 'number' ? litres(v) : v}
              </Text>
            ))}
          </View>
        ))}
      </View>

      <Text accessibilityRole="header" style={{ color: t.text, fontSize: 20, fontWeight: '700', marginTop: spacing.md }}>
        Milk use and adjustments
      </Text>
      {recent.length === 0 ? <Text style={{ color: t.textMuted }}>None recorded yet.</Text> : null}
      {recent.map((m) => (
        <View key={m.id} style={{ borderBottomWidth: 1, borderBottomColor: t.border, paddingVertical: spacing.xs }}>
          <Text style={{ color: t.text, fontSize: 16 }}>
            {formatDate(m.movement_date)} · {MOVEMENT_LABELS[m.kind]}: {m.quantity.startsWith('-') ? '−' : '+'}
            {m.quantity.replace('-', '')} L
          </Text>
          {m.reason ? <Text style={{ color: t.textMuted, fontSize: 14 }}>{m.reason}</Text> : null}
          {REVERSIBLE.includes(m.kind) && !reversed.has(m.id) ? <Button label="Reverse (entered by mistake)" variant="link" onPress={() => setReversing(m)} /> : null}
          {reversed.has(m.id) ? <Text style={{ color: t.textMuted, fontSize: 13 }}>Reversed</Text> : null}
          {reversing?.id === m.id ? (
            <>
              <TextField label="Why reverse it?" value={reason} onChangeText={setReason} />
              <Button label="Reverse" onPress={confirmReverse} />
              <Button label="Cancel" variant="link" onPress={() => setReversing(null)} />
            </>
          ) : null}
        </View>
      ))}
    </ScrollView>
  );
}
