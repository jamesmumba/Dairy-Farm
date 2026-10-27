import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { money, summarize } from '../finance/calc';
import { useFinance } from '../finance/useFinance';
import { formatDate } from '../lib/dates';
import { litres, type Period, periodRange } from '../production/calc';
import { useSyncStatus } from '../sync/engine';
import { Chips } from '../ui/Chips';
import { DateField } from '../ui/DateField';
import { spacing, useTheme } from '../ui/theme';

function Row({ label, value, note, strong }: { label: string; value: string; note?: string; strong?: boolean }) {
  const t = useTheme();
  return (
    <View style={{ paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: t.border }} accessible accessibilityLabel={`${label}: ${value}. ${note ?? ''}`}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }}>
        <Text style={{ color: t.text, fontSize: 16, fontWeight: strong ? '700' : '400', flex: 1 }}>{label}</Text>
        <Text style={{ color: t.text, fontSize: 16, fontWeight: strong ? '700' : '400', fontVariant: ['tabular-nums'] }}>{value}</Text>
      </View>
      {note ? <Text style={{ color: t.textMuted, fontSize: 13 }}>{note}</Text> : null}
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
    <ScrollView style={{ backgroundColor: t.background }} contentContainerStyle={{ padding: spacing.md, gap: spacing.sm }}>
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
        <>
          <DateField label="From" value={custom.from} onChange={(d) => d && setCustom((c) => ({ ...c, from: d }))} optional={false} />
          <DateField label="To" value={custom.to} onChange={(d) => d && setCustom((c) => ({ ...c, to: d }))} optional={false} />
        </>
      ) : null}
      <Text style={{ color: t.textMuted, fontSize: 14 }}>
        {formatDate(range.from)} – {formatDate(range.to)} · from records on this phone{sync.pending ? `, including ${sync.pending} not yet synced` : ''}. Generated {new Date().toLocaleString()}.
      </Text>

      {currencies.map((cur) => {
        const s = summarize(cur, range.from, range.to, f, f.farmDate);
        return (
          <View key={cur} style={{ gap: 2 }}>
            <Text accessibilityRole="header" style={{ color: t.text, fontSize: 20, fontWeight: '700', marginTop: spacing.md }}>
              {cur}
            </Text>
            <Row label="Sales revenue" value={money(s.revenueCents, cur)} note={`${s.salesCount} sales, ${litres(s.litresCl)} L. The amount owed on completed sales in the period, paid or not.`} />
            <Row label="Payments received" value={money(s.receiptsCents, cur)} note="Money received in the period, for any sale." />
            {s.refundsCents ? <Row label="Refunds paid out" value={money(s.refundsCents, cur)} /> : null}
            {s.adjustmentsCents ? <Row label="Discounts and write-offs" value={money(s.adjustmentsCents, cur)} note="Balances reduced without money changing hands." /> : null}
            <Row label="Recorded expenses" value={money(s.expensesCents, cur)} />
            <Row label="Recorded operating result" value={money(s.operatingResultCents, cur)} note="Sales revenue minus recorded expenses. Not audited profit." strong />
            <Row label="Customers owe now" value={money(s.outstandingCents, cur)} note="All unpaid balances today, whenever the sales were made." />
          </View>
        );
      })}
    </ScrollView>
  );
}
