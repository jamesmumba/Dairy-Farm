import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
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
import { Card, ListGroup, ListRow, SectionHeader } from '../../ui/kit';
import { spacing, useTheme } from '../../ui/theme';

const REVERSIBLE = ['farm_consumption', 'calf_feeding', 'spoilage', 'gift', 'other_use', 'adjustment', 'opening_balance'];

/** One line of the stock flow: label on the left, litres on the right. */
function Flow({ label, cl, sign, strong }: { label: string; cl: number; sign?: '+' | '−'; strong?: boolean }) {
  const t = useTheme();
  const weight = strong ? '700' : '400';
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }} accessible accessibilityLabel={`${label}: ${sign === '−' ? 'minus ' : ''}${litres(cl)} litres`}>
      <Text style={{ color: strong ? t.text : t.textMuted, fontSize: 15, fontWeight: weight }}>{label}</Text>
      <Text style={{ color: t.text, fontSize: 15, fontWeight: weight, fontVariant: ['tabular-nums'] }}>
        {sign ? `${sign} ` : ''}
        {litres(cl)} L
      </Text>
    </View>
  );
}

export default function Stock() {
  const t = useTheme();
  const f = useFinance();
  const milk = useLocal(() => listMilk().map((m) => m.data));
  const [period, setPeriod] = useState<Exclude<Period, 'year'>>('week');
  const [byDay, setByDay] = useState(false);
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
    .slice(0, 10);

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
    <ScrollView style={{ backgroundColor: t.background }} contentContainerStyle={{ padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl }}>
      <Card gap={2}>
        <Text style={{ color: t.textMuted, fontSize: 14 }}>Milk for sale now</Text>
        <Text style={{ color: t.text, fontSize: 36, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{litres(f.available(f.today))} L</Text>
        <Text style={{ color: t.textMuted, fontSize: 13 }}>
          Milk under withdrawal is never counted{f.unsyncedStockItems ? ` · ${f.unsyncedStockItems} not yet synced` : ''}
        </Text>
      </Card>

      {discrepancies.length ? (
        <Notice tone="error" title="Stock went below zero">
          On {discrepancies.map((d) => formatDate(d.date)).join(', ')}. Check those days for missing milk or a wrong sale.
        </Notice>
      ) : null}

      <ListGroup>
        <ListRow icon="cup-outline" title="Record milk use" subtitle="Home use, calves, spoilage, gifts" href={{ pathname: '/stock/new', params: { kind: 'farm_consumption' } }} />
        <ListRow icon="plus-minus-variant" title="Adjustment" subtitle="Correct the stock, with a reason" href={{ pathname: '/stock/new', params: { kind: 'adjustment' } }} />
        <ListRow icon="flag-outline" title="Opening balance" href={{ pathname: '/stock/new', params: { kind: 'opening_balance' } }} />
      </ListGroup>

      <View style={{ gap: spacing.sm }}>
        <SectionHeader title="How stock changed" action={byDay ? 'Totals' : 'Each day'} onAction={() => setByDay((v) => !v)} />
        <Chips label="Period" value={period} options={[{ value: 'today', label: 'Today' }, { value: 'week', label: 'This week' }, { value: 'month', label: 'This month' }]} onChange={(v) => v && setPeriod(v)} allowClear={false} />
        {byDay ? (
          <Card gap={0}>
            <View style={{ flexDirection: 'row', paddingBottom: spacing.xs }}>
              {['Day', 'In', 'Out', 'Close'].map((h, i) => (
                <Text key={h} style={{ flex: 1, color: t.textMuted, fontSize: 13, textAlign: i ? 'right' : 'left' }}>
                  {h}
                </Text>
              ))}
            </View>
            {days.map((d) => (
              <View
                key={d.date}
                accessible
                accessibilityLabel={`${formatDate(d.date)}: in ${litres(d.produced + Math.max(0, d.adjusted))}, out ${litres(d.sold + d.used + Math.max(0, -d.adjusted))}, closing ${litres(d.closing)} litres`}
                style={{ flexDirection: 'row', paddingVertical: spacing.xs, borderTopWidth: 1, borderTopColor: t.border }}
              >
                <Text style={{ flex: 1, color: t.text, fontSize: 14 }}>{formatDate(d.date).slice(0, 5)}</Text>
                <Text style={{ flex: 1, color: t.text, fontSize: 14, textAlign: 'right', fontVariant: ['tabular-nums'] }}>{litres(d.produced + Math.max(0, d.adjusted))}</Text>
                <Text style={{ flex: 1, color: t.text, fontSize: 14, textAlign: 'right', fontVariant: ['tabular-nums'] }}>{litres(d.sold + d.used + Math.max(0, -d.adjusted))}</Text>
                <Text style={{ flex: 1, color: d.closing < 0 ? t.danger : t.text, fontSize: 14, fontWeight: '600', textAlign: 'right', fontVariant: ['tabular-nums'] }}>{litres(d.closing)}</Text>
              </View>
            ))}
          </Card>
        ) : (
          <Card gap={0}>
            <Flow label="At the start" cl={days[0]?.opening ?? 0} />
            <Flow label="Produced" cl={totals.produced} sign="+" />
            <Flow label="Sold" cl={totals.sold} sign="−" />
            <Flow label="Used on the farm" cl={totals.used} sign="−" />
            {totals.adjusted ? <Flow label="Adjusted" cl={Math.abs(totals.adjusted)} sign={totals.adjusted >= 0 ? '+' : '−'} /> : null}
            <View style={{ height: 1, backgroundColor: t.border, marginVertical: spacing.xs }} />
            <Flow label="At the end" cl={days[days.length - 1]?.closing ?? 0} strong />
            {totals.restricted ? <Text style={{ color: t.textMuted, fontSize: 13, marginTop: spacing.xs }}>Also {litres(totals.restricted)} L under withdrawal, not in stock</Text> : null}
          </Card>
        )}
      </View>

      <View style={{ gap: spacing.sm }}>
        <SectionHeader title="Milk use and adjustments" />
        {recent.length === 0 ? <Text style={{ color: t.textMuted, fontSize: 15 }}>None recorded yet.</Text> : null}
        {recent.length ? (
          <ListGroup>
            {recent.map((m) => {
              const out = m.quantity.startsWith('-');
              const canReverse = REVERSIBLE.includes(m.kind) && !reversed.has(m.id);
              return (
                <Pressable
                  key={m.id}
                  accessibilityRole={canReverse ? 'button' : undefined}
                  accessibilityHint={canReverse ? 'Reverse this record if it was entered by mistake' : undefined}
                  disabled={!canReverse}
                  onPress={() => setReversing(reversing?.id === m.id ? null : m)}
                  style={{ padding: spacing.md, gap: 2 }}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }}>
                    <Text style={{ color: t.text, fontSize: 16, flex: 1 }}>{MOVEMENT_LABELS[m.kind]}</Text>
                    <Text style={{ color: t.text, fontSize: 16, fontWeight: '600', fontVariant: ['tabular-nums'] }}>
                      {out ? '−' : '+'}
                      {m.quantity.replace('-', '')} L
                    </Text>
                  </View>
                  <Text style={{ color: t.textMuted, fontSize: 14 }}>
                    {formatDate(m.movement_date)}
                    {m.reason ? ` · ${m.reason}` : ''}
                    {reversed.has(m.id) ? ' · reversed' : ''}
                  </Text>
                  {reversing?.id === m.id ? (
                    <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
                      <TextField label="Why reverse it?" value={reason} onChangeText={setReason} />
                      <Button label="Reverse this record" variant="danger" onPress={confirmReverse} />
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </ListGroup>
        ) : null}
        {recent.some((m) => REVERSIBLE.includes(m.kind) && !reversed.has(m.id)) ? (
          <Text style={{ color: t.textMuted, fontSize: 13 }}>Tap a record entered by mistake to reverse it.</Text>
        ) : null}
      </View>
    </ScrollView>
  );
}
