import { type Href, router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { displayName } from '../../animals/model';
import { useReminders } from '../../care/useReminders';
import { money, summarize as summarizeMoney, toCents } from '../../finance/calc';
import { useFinance } from '../../finance/useFinance';
import { addDays, dailyTotals, litres, perAnimal, periodRange, summarize } from '../../production/calc';
import { dayLabel, L } from '../../production/format';
import { ATTENTION_LABELS, needingAttention } from '../../reports/dashboard';
import { useReportInput } from '../../reports/useReportInput';
import { useAuth } from '../../state/auth';
import { BarChart } from '../../ui/BarChart';
import { Chips } from '../../ui/Chips';
import { Button } from '../../ui/form';
import { HorizontalBars } from '../../ui/HorizontalBars';
import { SyncStatus } from '../../ui/SyncStatus';
import { minTouch, radius, spacing, type, useTheme, useCardBasis } from '../../ui/theme';

type Choice = 'today' | 'week' | 'month';

function Tile({ label, value, note, href, danger }: { label: string; value: string; note?: string; href: Href; danger?: boolean }) {
  const t = useTheme();
  const basis = useCardBasis();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}${note ? `. ${note}` : ''}`}
      accessibilityHint="Opens the details"
      onPress={() => router.push(href)}
      style={{ flexBasis: basis, flexGrow: 1, minHeight: minTouch + 24, backgroundColor: t.surface, borderRadius: radius.card, borderWidth: 1, borderColor: t.border, padding: spacing.md, borderLeftWidth: danger ? 4 : 1, borderLeftColor: danger ? t.danger : t.border }}
    >
      <Text style={{ color: t.textMuted, fontSize: 13 }}>{label}</Text>
      <Text style={{ color: danger ? t.danger : t.text, fontSize: 22, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{value}</Text>
      {note ? <Text style={{ color: t.textMuted, fontSize: 12 }}>{note}</Text> : null}
    </Pressable>
  );
}

function Section({ title }: { title: string }) {
  const t = useTheme();
  return (
    <Text accessibilityRole="header" style={{ color: t.text, ...type.sectionTitle, marginTop: spacing.md }}>
      {title}
    </Text>
  );
}

const QUICK: { label: string; hint: string; href: Href }[] = [
  { label: 'Record milk', hint: 'Milking round for one session', href: '/milk/round' },
  { label: 'Add animal', hint: 'Register an animal', href: '/animal/new' },
  { label: 'Log sale', hint: 'Milk sold to a customer', href: '/sale/new' },
  { label: 'Record health issue', hint: 'Symptoms or a suspected condition', href: { pathname: '/care/[kind]/new', params: { kind: 'health' } } },
];

function QuickActions() {
  const t = useTheme();
  const basis = useCardBasis();
  return (
    <View style={grid}>
      {QUICK.map((q) => (
        <Pressable
          key={q.label}
          accessibilityRole="button"
          accessibilityLabel={q.label}
          accessibilityHint={q.hint}
          onPress={() => router.push(q.href)}
          style={({ pressed }) => ({
            flexBasis: basis,
            flexGrow: 1,
            minHeight: minTouch + 8,
            justifyContent: 'center',
            paddingHorizontal: spacing.md,
            borderRadius: radius.control,
            backgroundColor: t.primary,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Text style={{ color: t.onPrimary, fontSize: 16, fontWeight: '600' }}>{q.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const grid = { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm };

export default function Home() {
  const t = useTheme();
  const { account } = useAuth();
  const input = useReportInput();
  const f = useFinance();
  const { reminders, names } = useReminders();
  const [choice, setChoice] = useState<Choice>('week');

  const { today, animals, milk } = input;
  const range = choice === 'today' ? { from: today, to: today } : periodRange(choice, today);
  const to = range.to > today ? today : range.to;
  const chartFrom = choice === 'today' ? addDays(today, -6) : range.from;
  const attention = useMemo(() => needingAttention(input), [input]);

  const active = animals.filter((a) => a.status === 'active');
  const vaccDue = reminders.filter((r) => r.kind === 'vaccination');
  const vaccOverdue = vaccDue.filter((r) => r.urgency === 'overdue').length;
  const withdrawals = reminders.filter((r) => r.urgency === 'active').length;
  const milkDay = summarize(milk, today, today);
  const milkWeek = summarize(milk, periodRange('week', today).from, today);
  const milkMonth = summarize(milk, periodRange('month', today).from, today);
  const period = summarizeMoney(f.currency, range.from, to, f, f.farmDate);
  const expensesUnpaid = f.expenses.filter((e) => e.status === 'active' && e.payment_status !== 'paid').length;
  const byCow = perAnimal(milk, range.from, to).map((y) => ({ key: y.cattle_id, label: names.get(y.cattle_id) ?? 'Unknown', value: y.totalCl }));

  // Sales and payments per day as two small charts on one scale (never two axes).
  const days = dailyTotals([], chartFrom, to).map((d) => d.date);
  const perDay = (pick: (date: string) => number) => days.map((d) => ({ key: d, label: dayLabel(d), short: String(Number(d.slice(8))), value: pick(d) }));
  const salesBars = perDay((d) => f.sales.filter((s) => s.status === 'completed' && s.currency === f.currency && f.farmDate(s.sale_at) === d).reduce((x, s) => x + toCents(s.total), 0));
  const payBars = perDay((d) =>
    f.payments.filter((p) => p.status === 'completed' && p.kind === 'payment' && p.currency === f.currency && f.farmDate(p.paid_at) === d).reduce((x, p) => x + toCents(p.amount), 0),
  );
  const moneyMax = Math.max(0, ...salesBars.map((b) => b.value), ...payBars.map((b) => b.value));
  const upcoming = reminders.filter((r) => r.urgency === 'today' || r.urgency === 'upcoming').slice(0, 6);
  const fmtMoney = (c: number) => money(c, f.currency);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.background }} contentContainerStyle={{ padding: spacing.md, gap: spacing.sm }}>
      <View>
        <Text accessibilityRole="header" style={{ color: t.text, ...type.screenTitle }}>
          {account?.display_name ? `Hello, ${account.display_name}` : 'Home'}
        </Text>
        <Text style={{ color: t.textMuted, ...type.secondary }}>{dayLabel(today)}</Text>
      </View>
      <SyncStatus />
      {withdrawals > 0 || attention.size > 0 ? (
        <>
          <Section title="Needs attention" />
          <View style={grid}>
            <Tile label="Milk withdrawal now" value={String(withdrawals)} note="Milk not for sale" href="/reminders" danger={withdrawals > 0} />
            <Tile label="Animals needing attention" value={String(attention.size)} note="Withdrawal, health, overdue care or falling milk" href="/reminders" danger={attention.size > 0} />
          </View>
          {[...attention.entries()].slice(0, 5).map(([id, reasons]) => {
            const a = animals.find((x) => x.id === id);
            return a ? (
              <Pressable
                key={id}
                accessibilityRole="button"
                onPress={() => router.push({ pathname: '/animal/[id]', params: { id } })}
                style={{ minHeight: minTouch, justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: t.border }}
              >
                <Text style={{ color: t.text, fontSize: 16 }}>⚠ {displayName(a)}</Text>
                <Text style={{ color: t.textMuted, fontSize: 14 }}>{reasons.map((r) => ATTENTION_LABELS[r]).join(', ')}</Text>
              </Pressable>
            ) : null;
          })}
        </>
      ) : null}

      <Section title="Quick actions" />
      <QuickActions />

      <Chips
        label="Period for sales, money and charts"
        value={choice}
        options={[
          { value: 'today', label: 'Today' },
          { value: 'week', label: 'This week' },
          { value: 'month', label: 'This month' },
        ]}
        onChange={(v) => v && setChoice(v)}
        allowClear={false}
      />

      <Section title="Herd" />
      <View style={grid}>
        <Tile label="Active animals" value={String(active.length)} note={`${animals.length} recorded`} href="/animals" />
        <Tile label="Cows in milk" value={String(active.filter((a) => a.production_status === 'lactating').length)} href="/animals" />
        <Tile
          label="Confirmed pregnancies"
          value={String(active.filter((a) => a.reproductive_status === 'pregnant').length)}
          note="From pregnancy checks"
          href={{ pathname: '/reports/[id]', params: { id: 'reproduction' } }}
        />
        <Tile label="Vaccinations due" value={String(vaccDue.length)} note={vaccOverdue ? `${vaccOverdue} overdue` : 'Next 30 days'} href="/reminders" danger={vaccOverdue > 0} />
      </View>

      <Section title="Milk" />
      <View style={grid}>
        <Tile label="Today" value={L(milkDay.totalCl)} href="/production" />
        <Tile label="This week" value={L(milkWeek.totalCl)} href="/production" />
        <Tile label="This month" value={L(milkMonth.totalCl)} note={milkMonth.restrictedCl ? `${L(milkMonth.restrictedCl)} under withdrawal` : undefined} href="/production" />
        <Tile label="Milk for sale now" value={`${litres(f.available(today))} L`} href="/stock" />
      </View>
      <BarChart
        title={choice === 'today' ? 'Daily milk, last 7 days' : 'Daily milk'}
        bars={dailyTotals(milk, chartFrom, to).map((d) => ({ key: d.date, label: dayLabel(d.date), short: String(Number(d.date.slice(8))), value: d.cl, missing: !d.recorded }))}
        format={L}
      />
      <HorizontalBars title="Milk by cow" items={byCow} format={L} limit={8} />

      <Section title={`Sales and money (${f.currency})`} />
      <View style={grid}>
        <Tile label="Milk sold" value={L(period.litresCl)} note={`${period.salesCount} sales`} href="/finance" />
        <Tile label="Sales revenue" value={fmtMoney(period.revenueCents)} href="/finance" />
        <Tile label="Payments received" value={fmtMoney(period.receiptsCents)} href="/finance" />
        <Tile label="Customers owe now" value={fmtMoney(period.outstandingCents)} href="/sales" danger={period.outstandingCents > 0} />
        <Tile label="Expenses" value={fmtMoney(period.expensesCents)} note={expensesUnpaid ? `${expensesUnpaid} not fully paid` : undefined} href="/expenses" />
        <Tile label="Recorded operating result" value={fmtMoney(period.operatingResultCents)} note="Not audited profit" href="/finance" />
      </View>
      <BarChart title="Sales per day" bars={salesBars} format={fmtMoney} height={90} max={moneyMax} />
      <BarChart title="Payments received per day" bars={payBars} format={fmtMoney} height={90} max={moneyMax} />

      <Section title="Coming up" />
      {upcoming.length === 0 ? <Text style={{ color: t.textMuted }}>Nothing due in the coming days.</Text> : null}
      {upcoming.map((r) => (
        <Pressable
          key={r.key}
          accessibilityRole="button"
          onPress={() => router.push((r.href ?? { pathname: '/care/[kind]/[id]', params: { kind: r.record!.kind, id: r.record!.id } }) as Href)}
          style={{ minHeight: minTouch, justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: t.border }}
        >
          <Text style={{ color: t.text, fontSize: 16 }}>
            {r.cattleId ? `${names.get(r.cattleId) ?? 'Animal'}: ` : ''}
            {r.title}
          </Text>
          <Text style={{ color: t.textMuted, fontSize: 14 }}>{dayLabel(r.due.slice(0, 10))}</Text>
        </Pressable>
      ))}
      <Button label="All reminders" variant="link" onPress={() => router.push('/reminders')} />
      <Button label="Reports and exports" onPress={() => router.push('/reports')} />
      <Text style={{ color: t.textMuted, fontSize: 12 }}>Calculated from records on this phone. Records made on another phone appear after they sync.</Text>
    </ScrollView>
  );
}
