import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { type Href, router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { displayName } from '../../animals/model';
import type { ReminderKind } from '../../care/reminders';
import { useReminders } from '../../care/useReminders';
import { money, summarize as summarizeMoney, toCents } from '../../finance/calc';
import { useFinance } from '../../finance/useFinance';
import { addDays, dailyTotals, litres, perAnimal, periodRange, summarize } from '../../production/calc';
import { dayLabel, L } from '../../production/format';
import { ATTENTION_LABELS, needingAttention } from '../../reports/dashboard';
import { useReportInput } from '../../reports/useReportInput';
import { useAuth } from '../../state/auth';
import { useSyncStatus } from '../../sync/engine';
import { BarChart } from '../../ui/BarChart';
import { Chips } from '../../ui/Chips';
import { ActionTile, Avatar, type IconName, ListGroup, ListRow, SectionHeader, StatCard, type Tint } from '../../ui/kit';
import { HorizontalBars } from '../../ui/HorizontalBars';
import { SyncStatus } from '../../ui/SyncStatus';
import { radius, shadow, spacing, type, useTheme } from '../../ui/theme';

type Choice = 'today' | 'week' | 'month';

const QUICK: { label: string; hint: string; icon: IconName; tint: Tint; href: Href }[] = [
  { label: 'Record milk', hint: 'Milking round for one session', icon: 'water-outline', tint: 'sky', href: '/milk/round' },
  { label: 'Log sale', hint: 'Milk sold to a customer', icon: 'cash', tint: 'green', href: '/sale/new' },
  { label: 'Add animal', hint: 'Register an animal', icon: 'cow', tint: 'straw', href: '/animal/new' },
  { label: 'Health issue', hint: 'Record symptoms or a suspected condition', icon: 'stethoscope', tint: 'red', href: { pathname: '/care/[kind]/new', params: { kind: 'health' } } },
];

const REMINDER_ICON: Record<ReminderKind, IconName> = {
  withdrawal: 'water-off-outline',
  withdrawal_clearance: 'water-check-outline',
  vaccination: 'needle',
  pregnancy_check: 'heart-pulse',
  expected_calving: 'cow',
  health_follow_up: 'stethoscope',
  unpaid_balance: 'account-cash-outline',
  stock_discrepancy: 'warehouse',
};

const grid = { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm };

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

/** The green "today" card: who, when, and the two milk numbers that matter right now. */
function TodayCard({ name, today, milkToday, cows, forSale }: { name?: string | null; today: string; milkToday: string; cows: number; forSale: string }) {
  const t = useTheme();
  const figure = (label: string, value: string, note: string) => (
    <View style={{ flex: 1, gap: 2 }} accessible accessibilityLabel={`${label}: ${value}. ${note}`}>
      <Text style={{ color: t.primarySoft, fontSize: 14 }}>{label}</Text>
      <Text style={{ color: t.onPrimary, fontSize: 30, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{value}</Text>
      <Text style={{ color: t.primarySoft, fontSize: 13 }}>{note}</Text>
    </View>
  );
  return (
    <View style={{ backgroundColor: t.primary, borderRadius: radius.card + 4, padding: spacing.lg, gap: spacing.md, overflow: 'hidden', ...shadow }}>
      {/* A soft milk-white circle: the only decoration, kept out of the way of the text. */}
      <View importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', right: -40, top: -40, width: 160, height: 160, borderRadius: 80, backgroundColor: '#FFFFFF', opacity: 0.07 }} />
      <MaterialCommunityIcons name="cow" size={64} color="#FFFFFF" style={{ position: 'absolute', right: 16, top: 14, opacity: 0.14 }} importantForAccessibility="no" />
      <View style={{ gap: 2 }}>
        <Text accessibilityRole="header" style={{ color: t.onPrimary, ...type.screenTitle, fontSize: 26 }}>
          {greeting()}
          {name ? `, ${name}` : ''}
        </Text>
        <Text style={{ color: t.primarySoft, fontSize: 15 }}>{dayLabel(today)}</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        {figure('Milk today', milkToday, `from ${cows} cow${cows === 1 ? '' : 's'}`)}
        {figure('For sale now', forSale, 'not under withdrawal')}
      </View>
    </View>
  );
}

export default function Home() {
  const t = useTheme();
  const { account } = useAuth();
  const sync = useSyncStatus();
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
  const milkPeriod = summarize(milk, range.from, to);
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
  const upcoming = reminders.filter((r) => r.urgency === 'today' || r.urgency === 'upcoming').slice(0, 5);
  const fmtMoney = (c: number) => money(c, f.currency);
  const periodName = choice === 'today' ? 'today' : choice === 'week' ? 'this week' : 'this month';
  const syncWorthShowing = sync.pending > 0 || sync.failed > 0 || sync.state === 'offline' || sync.state === 'attention';

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.background }} contentContainerStyle={{ padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xl }}>
      <TodayCard name={account?.display_name} today={today} milkToday={L(milkDay.totalCl)} cows={milkDay.cows} forSale={`${litres(f.available(today))} L`} />
      {syncWorthShowing ? <SyncStatus /> : null}

      {withdrawals > 0 || attention.size > 0 ? (
        <>
          <SectionHeader title="Needs attention" action="Reminders" onAction={() => router.push('/reminders')} />
          <ListGroup>
            {withdrawals > 0 ? (
              <ListRow icon="water-off-outline" tint="red" title={`${withdrawals} milk withdrawal${withdrawals === 1 ? '' : 's'} now`} subtitle="This milk is not for sale" href="/reminders" />
            ) : null}
            {[...attention.entries()].slice(0, 5).map(([id, reasons]) => {
              const a = animals.find((x) => x.id === id);
              return a ? (
                <ListRow
                  key={id}
                  leading={<Avatar name={displayName(a)} tint="red" size={40} />}
                  title={displayName(a)}
                  subtitle={reasons.map((r) => ATTENTION_LABELS[r]).join(', ')}
                  href={{ pathname: '/animal/[id]', params: { id } }}
                />
              ) : null;
            })}
          </ListGroup>
        </>
      ) : null}

      <SectionHeader title="Quick actions" />
      <View style={grid}>
        {QUICK.map((q) => (
          <ActionTile key={q.label} icon={q.icon} tint={q.tint} label={q.label} hint={q.hint} href={q.href} />
        ))}
      </View>

      <SectionHeader title="Herd" action="All animals" onAction={() => router.push('/animals')} />
      <View style={grid}>
        <StatCard icon="cow" label="Active animals" value={String(active.length)} note={`${animals.length} recorded`} href="/animals" />
        <StatCard icon="water-outline" tint="sky" label="Cows in milk" value={String(active.filter((a) => a.production_status === 'lactating').length)} href="/animals" />
        <StatCard
          icon="heart-pulse"
          tint="straw"
          label="Confirmed pregnant"
          value={String(active.filter((a) => a.reproductive_status === 'pregnant').length)}
          note="From pregnancy checks"
          href={{ pathname: '/reports/[id]', params: { id: 'reproduction' } }}
        />
        <StatCard icon="needle" tint="straw" label="Vaccinations due" value={String(vaccDue.length)} note={vaccOverdue ? `${vaccOverdue} overdue` : 'Next 30 days'} href="/reminders" alert={vaccOverdue > 0} />
      </View>

      <Chips
        label="Period for milk, sales and money"
        value={choice}
        options={[
          { value: 'today', label: 'Today' },
          { value: 'week', label: 'This week' },
          { value: 'month', label: 'This month' },
        ]}
        onChange={(v) => v && setChoice(v)}
        allowClear={false}
      />

      <SectionHeader title="Milk" action="Production" onAction={() => router.push('/production')} />
      <View style={grid}>
        <StatCard icon="water-outline" tint="sky" label={`Milk ${periodName}`} value={L(milkPeriod.totalCl)} note={milkPeriod.restrictedCl ? `${L(milkPeriod.restrictedCl)} under withdrawal` : undefined} href="/production" />
        <StatCard icon="warehouse" label="Milk for sale now" value={`${litres(f.available(today))} L`} href="/stock" />
      </View>
      <View style={{ backgroundColor: t.surface, borderRadius: radius.card, borderWidth: 1, borderColor: t.border, padding: spacing.md, gap: spacing.md, ...shadow }}>
        <BarChart
          title={choice === 'today' ? 'Daily milk, last 7 days' : 'Daily milk'}
          bars={dailyTotals(milk, chartFrom, to).map((d) => ({ key: d.date, label: dayLabel(d.date), short: String(Number(d.date.slice(8))), value: d.cl, missing: !d.recorded }))}
          format={L}
        />
        <HorizontalBars title="Milk by cow" items={byCow} format={L} limit={6} />
      </View>

      <SectionHeader title={`Sales and money (${f.currency})`} action="Summary" onAction={() => router.push('/finance')} />
      <View style={grid}>
        <StatCard icon="water-outline" tint="sky" label="Milk sold" value={L(period.litresCl)} note={`${period.salesCount} sales`} href="/finance" />
        <StatCard icon="cash" label="Sales revenue" value={fmtMoney(period.revenueCents)} href="/finance" />
        <StatCard icon="cash-multiple" label="Payments received" value={fmtMoney(period.receiptsCents)} href="/finance" />
        <StatCard icon="account-cash-outline" tint="straw" label="Customers owe now" value={fmtMoney(period.outstandingCents)} href="/sales" alert={period.outstandingCents > 0} />
        <StatCard icon="receipt" tint="straw" label="Expenses" value={fmtMoney(period.expensesCents)} note={expensesUnpaid ? `${expensesUnpaid} not fully paid` : undefined} href="/expenses" />
        <StatCard icon="scale-balance" label="Operating result" value={fmtMoney(period.operatingResultCents)} note="Recorded, not audited profit" href="/finance" />
      </View>
      <View style={{ backgroundColor: t.surface, borderRadius: radius.card, borderWidth: 1, borderColor: t.border, padding: spacing.md, gap: spacing.md, ...shadow }}>
        <BarChart title="Sales per day" bars={salesBars} format={fmtMoney} height={90} max={moneyMax} />
        <BarChart title="Payments received per day" bars={payBars} format={fmtMoney} height={90} max={moneyMax} />
      </View>

      <SectionHeader title="Coming up" action="All reminders" onAction={() => router.push('/reminders')} />
      {upcoming.length === 0 ? (
        <Text style={{ color: t.textMuted, fontSize: 15 }}>Nothing due in the coming days.</Text>
      ) : (
        <ListGroup>
          {upcoming.map((r) => (
            <ListRow
              key={r.key}
              icon={REMINDER_ICON[r.kind]}
              tint="straw"
              title={`${r.cattleId ? `${names.get(r.cattleId) ?? 'Animal'}: ` : ''}${r.title}`}
              subtitle={dayLabel(r.due.slice(0, 10))}
              href={(r.href ?? { pathname: '/care/[kind]/[id]', params: { kind: r.record!.kind, id: r.record!.id } }) as Href}
            />
          ))}
        </ListGroup>
      )}

      <SectionHeader title="Reports" />
      <ListGroup>
        <ListRow icon="file-chart-outline" title="Reports and exports" subtitle="Herd, milk, health, breeding, money; CSV and PDF" href="/reports" />
      </ListGroup>
      <Text style={{ color: t.textMuted, fontSize: 12, marginTop: spacing.sm }}>Calculated from records on this phone. Records made on another phone appear after they sync.</Text>
    </ScrollView>
  );
}
