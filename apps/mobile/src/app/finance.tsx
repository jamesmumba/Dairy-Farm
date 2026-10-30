import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { money, summarize } from '../finance/calc';
import { CATEGORY_LABELS } from '../finance/model';
import { useFinance } from '../finance/useFinance';
import { formatDate } from '../lib/dates';
import { addDays, litres, type Period, periodRange } from '../production/calc';
import { useSyncStatus } from '../sync/engine';
import { Chips } from '../ui/Chips';
import { DateField } from '../ui/DateField';
import { Notice } from '../ui/form';
import { Card, Figure, SectionHeader } from '../ui/kit';
import { spacing, useTheme } from '../ui/theme';

/** A line of the statement: label (with an optional short note under it) and the amount. */
function Line({ label, value, note, strong, sign }: { label: string; value: string; note?: string; strong?: boolean; sign?: '+' | '−' | '=' }) {
  const t = useTheme();
  const weight = strong ? '700' : '400';
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, paddingVertical: 6 }} accessible accessibilityLabel={`${label}: ${sign === '−' ? 'minus ' : ''}${value}. ${note ?? ''}`}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: strong ? t.text : t.textMuted, fontSize: 15, fontWeight: weight }}>{label}</Text>
        {note ? <Text style={{ color: t.textMuted, fontSize: 12 }}>{note}</Text> : null}
      </View>
      <Text style={{ color: t.text, fontSize: 15, fontWeight: weight, fontVariant: ['tabular-nums'] }}>
        {sign && sign !== '=' ? `${sign} ` : ''}
        {value}
      </Text>
    </View>
  );
}

function Rule() {
  const t = useTheme();
  return <View style={{ height: 1, backgroundColor: t.border, marginVertical: spacing.xs }} />;
}

type Choice = Exclude<Period, 'today'> | 'last_month' | 'custom';

/** The month before the one `today` is in. */
const lastMonth = (today: string) => periodRange('month', addDays(`${today.slice(0, 7)}-01`, -1));

export default function FinanceSummary() {
  const t = useTheme();
  const f = useFinance();
  const sync = useSyncStatus();
  const [choice, setChoice] = useState<Choice>('month');
  const [custom, setCustom] = useState({ from: periodRange('month', f.today).from, to: f.today });
  const range = choice === 'custom' ? custom : choice === 'last_month' ? lastMonth(f.today) : periodRange(choice, f.today);
  const backwards = range.from > range.to;
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
          { value: 'last_month', label: 'Last month' },
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
      {backwards ? <Notice tone="error">“From” is after “To”. Swap the dates to see the figures.</Notice> : null}

      {backwards
        ? null
        : currencies.map((cur) => {
            const s = summarize(cur, range.from, range.to, f, f.farmDate);
            const otherExpenses = s.expensesCents - s.feedCents;
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
                    <Figure label="Milk sold" value={`${litres(s.litresCl)} L`} note={`${s.salesCount} sale${s.salesCount === 1 ? '' : 's'}`} />
                    <Figure label="Owed to you now" value={money(s.outstandingCents, cur)} tone={s.outstandingCents > 0 ? 'danger' : undefined} />
                  </View>
                </Card>

                <SectionHeader title="How it adds up" />
                <Card gap={0}>
                  <Line label="Sales" value={money(s.revenueCents, cur)} note="Completed sales, paid or not" />
                  {s.adjustmentsCents ? <Line label="Discounts and write-offs" value={money(s.adjustmentsCents, cur)} sign="−" note="Sales that will not be paid" /> : null}
                  <Line label="Feed" value={money(s.feedCents, cur)} sign="−" />
                  <Rule />
                  <Line label="Left after feed" value={money(s.afterFeedCents, cur)} sign="=" strong />
                  <Line label="Other expenses" value={money(otherExpenses, cur)} sign="−" note="Labour, vet care, medicines, transport and the rest" />
                  <Rule />
                  <Line label="Operating result" value={money(s.operatingResultCents, cur)} sign="=" strong />
                </Card>

                {s.byCategory.length ? (
                  <>
                    <SectionHeader title="Where the money went" />
                    <Card gap={0}>
                      {s.byCategory.map((c) => (
                        <Line key={c.category} label={CATEGORY_LABELS[c.category]} value={money(c.cents, cur)} />
                      ))}
                      <Rule />
                      <Line label="All expenses" value={money(s.expensesCents, cur)} strong />
                    </Card>
                  </>
                ) : null}

                <SectionHeader title="Cash in and out" />
                <Card gap={0}>
                  <Line label="Money received" value={money(s.receiptsCents, cur)} sign="+" note="For any sale, old or new" />
                  <Line label="Expenses paid" value={money(s.paidOutCents, cur)} sign="−" note="Expenses marked paid; unpaid ones are not cash yet" />
                  {s.refundsCents ? <Line label="Refunds paid out" value={money(s.refundsCents, cur)} sign="−" /> : null}
                  <Rule />
                  <Line label="Cash in less cash out" value={money(s.cashCents, cur)} sign="=" strong />
                  {s.partlyPaidCount ? (
                    <Text style={{ color: t.textMuted, fontSize: 13, marginTop: spacing.xs }}>
                      {s.partlyPaidCount} partly paid expense{s.partlyPaidCount === 1 ? ' is' : 's are'} not included: how much was paid is not recorded.
                    </Text>
                  ) : null}
                </Card>
              </View>
            );
          })}
      <Text style={{ color: t.textMuted, fontSize: 12 }}>From records on this phone{sync.pending ? `, including ${sync.pending} not yet synced` : ''}.</Text>
    </ScrollView>
  );
}
