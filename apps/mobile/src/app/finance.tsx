import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { money, summarize } from '../finance/calc';
import { useFinance } from '../finance/useFinance';
import { formatDate } from '../lib/dates';
import { litres, type Period, periodRange } from '../production/calc';
import { useSyncStatus } from '../sync/engine';
import { Chips } from '../ui/Chips';
import { DateField } from '../ui/DateField';
import { Card, Figure, SectionHeader } from '../ui/kit';
import { spacing, useTheme } from '../ui/theme';

/** A line of the statement: label (with an optional short note under it) and the amount. */
function Line({ label, value, note, strong, sign }: { label: string; value: string; note?: string; strong?: boolean; sign?: '+' | '−' }) {
  const t = useTheme();
  const weight = strong ? '700' : '400';
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, paddingVertical: 6 }} accessible accessibilityLabel={`${label}: ${sign === '−' ? 'minus ' : ''}${value}. ${note ?? ''}`}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: strong ? t.text : t.textMuted, fontSize: 15, fontWeight: weight }}>{label}</Text>
        {note ? <Text style={{ color: t.textMuted, fontSize: 12 }}>{note}</Text> : null}
      </View>
      <Text style={{ color: t.text, fontSize: 15, fontWeight: weight, fontVariant: ['tabular-nums'] }}>
        {sign ? `${sign} ` : ''}
        {value}
      </Text>
    </View>
  );
}

export default function FinanceSummary() {
  const t = useTheme();
  const f = useFinance();
  const sync = useSyncStatus();
  const [choice, setChoice] = useState<Period | 'custom'>('month');
  const [custom, setCustom] = useState({ from: periodRange('month', f.today).from, to: f.today });
  const range = choice === 'custom' ? custom : periodRange(choice, f.today);
  // Only currencies actually used; never added together.
  const currencies = [...new Set([f.currency, ...f.sales.map((s) => s.currency), ...f.payments.map((p) => p.currency), ...f.expenses.map((e) => e.currency)])];

  return (
    <ScrollView style={{ backgroundColor: t.background }} contentContainerStyle={{ padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl }}>
      <Chips
        label="Period"
        value={choice}
        options={[
          { value: 'week', label: 'This week' },
          { value: 'month', label: 'This month' },
          { value: 'year', label: 'This year' },
          { value: 'custom', label: 'Dates…' },
        ]}
        onChange={(v) => v && setChoice(v)}
        allowClear={false}
      />
      {choice === 'custom' ? (
        <View style={{ gap: spacing.sm }}>
          <DateField label="From" value={custom.from} onChange={(d) => d && setCustom((c) => ({ ...c, from: d }))} optional={false} />
          <DateField label="To" value={custom.to} onChange={(d) => d && setCustom((c) => ({ ...c, to: d }))} optional={false} />
        </View>
      ) : null}

      {currencies.map((cur) => {
        const s = summarize(cur, range.from, range.to, f, f.farmDate);
        return (
          <View key={cur} style={{ gap: spacing.sm }}>
            {currencies.length > 1 ? <SectionHeader title={cur} /> : null}
            <Card>
              <View style={{ gap: 2 }} accessible>
                <Text style={{ color: t.textMuted, fontSize: 14 }}>
                  Operating result · {formatDate(range.from)} – {formatDate(range.to)}
                </Text>
                <Text style={{ color: s.operatingResultCents < 0 ? t.danger : t.text, fontSize: 32, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{money(s.operatingResultCents, cur)}</Text>
                <Text style={{ color: t.textMuted, fontSize: 13 }}>Sales minus expenses, as recorded. Not audited profit.</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: spacing.md }}>
                <Figure label="Milk sold" value={`${litres(s.litresCl)} L`} note={`${s.salesCount} sales`} />
                <Figure label="Owed to you now" value={money(s.outstandingCents, cur)} tone={s.outstandingCents > 0 ? 'danger' : undefined} />
              </View>
            </Card>
            <Card gap={0}>
              <Line label="Sales" value={money(s.revenueCents, cur)} note="Completed sales, paid or not" />
              <Line label="Expenses" value={money(s.expensesCents, cur)} sign="−" />
              <View style={{ height: 1, backgroundColor: t.border, marginVertical: spacing.xs }} />
              <Line label="Operating result" value={money(s.operatingResultCents, cur)} strong />
            </Card>
            <Card gap={0}>
              <Line label="Money received" value={money(s.receiptsCents, cur)} note="For any sale, old or new" />
              {s.refundsCents ? <Line label="Refunds paid out" value={money(s.refundsCents, cur)} /> : null}
              {s.adjustmentsCents ? <Line label="Discounts and write-offs" value={money(s.adjustmentsCents, cur)} /> : null}
            </Card>
          </View>
        );
      })}
      <Text style={{ color: t.textMuted, fontSize: 12 }}>From records on this phone{sync.pending ? `, including ${sync.pending} not yet synced` : ''}.</Text>
    </ScrollView>
  );
}
