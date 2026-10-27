import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { type Href, router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
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
import { HorizontalBars } from '../../ui/HorizontalBars';
import { Avatar, Card, Figure, FigureRow, type IconName, ListGroup, ListRow, SectionHeader } from '../../ui/kit';
import { SyncStatus } from '../../ui/SyncStatus';
import { radius, shadow, spacing, type, useTheme } from '../../ui/theme';

// Home leads with what needs the farmer today and what to do next, then the summary the specification
// asks for (herd, milk, money for a chosen period, with charts); each section opens its details.

const QUICK: { label: string; hint: string; icon: IconName; href: Href }[] = [
  { label: 'Milk', hint: 'Record a milking round', icon: 'water-outline', href: '/milk/round' },
  { label: 'Sale', hint: 'Log milk sold to a customer', icon: 'cash', href: '/sale/new' },
  { label: 'Animal', hint: 'Register an animal', icon: 'cow', href: '/animal/new' },
  { label: 'Health', hint: 'Record a health issue', icon: 'stethoscope', href: { pathname: '/care/[kind]/new', params: { kind: 'health' } } },
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

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function TodayCard({ name, today, milkToday, cows, forSale }: { name?: string | null; today: string; milkToday: string; cows: number; forSale: string }) {
  const t = useTheme();
  const figure = (label: string, value: string, note: string) => (
    <View style={{ flex: 1, gap: 2 }} accessible accessibilityLabel={`${label}: ${value}. ${note}`}>
      <Text style={{ color: t.primarySoft, fontSize: 14 }}>{label}</Text>
      <Text style={{ color: t.onPrimary, fontSize: 30, fontWeight: '600', fontVariant: ['tabular-nums'] }} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={{ color: t.primarySoft, fontSize: 13 }}>{note}</Text>
    </View>
  );
  return (
    <View style={{ backgroundColor: t.primary, borderRadius: radius.card + 4, padding: spacing.lg, gap: spacing.lg, overflow: 'hidden', ...shadow }}>
      <MaterialCommunityIcons name="cow" size={72} color="#FFFFFF" style={{ position: 'absolute', right: 12, top: 8, opacity: 0.1 }} importantForAccessibility="no" />
      <View style={{ gap: 2 }}>
        <Text accessibilityRole="header" style={{ color: t.onPrimary, ...type.screenTitle, fontSize: 24 }}>
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

/** A round icon button with a one-word label under it. */
function QuickAction({ label, hint, icon, href }: (typeof QUICK)[number]) {
  const t = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Record ${label.toLowerCase()}`} accessibilityHint={hint} onPress={() => router.push(href)} style={{ flex: 1, minWidth: 72, alignItems: 'center', gap: spacing.xs }}>
      {({ pressed }) => (
        <>
          <View style={{ width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? t.primary : t.surface, ...shadow }}>
            <MaterialCommunityIcons name={icon} size={28} color={pressed ? t.onPrimary : t.primary} />
          </View>
          <Text style={{ color: t.text, fontSize: 14, fontWeight: '600' }}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

export default function Home() {
  const t = useTheme();
  const { account } = useAuth();
  const sync = useSyncStatus();
  const input = useReportInput();
  const f = useFinance();
  const { reminders, names } = useReminders();
  const [choice, setChoice] = useState<'today' | 'week' | 'month'>('week');
  const [milkChart, setMilkChart] = useState<'daily' | 'cow'>('daily');

  const { today, animals, milk } = input;
  const attention = useMemo(() => needingAttention(input), [input]);
  const withdrawals = reminders.filter((r) => r.urgency === 'active').length;
  const milkDay = summarize(milk, today, today);
  const range = choice === 'today' ? { from: today, to: today } : periodRange(choice, today);
  const to = range.to > today ? today : range.to;
  const chartFrom = choice === 'today' ? addDays(today, -6) : range.from;
  const milkPeriod = summarize(milk, range.from, to);
  const moneyPeriod = summarizeMoney(f.currency, range.from, to, f, f.farmDate);
  const active = animals.filter((a) => a.status === 'active');
  const herd = active.length;
  const inMilk = active.filter((a) => a.production_status === 'lactating').length;
  const pregnant = active.filter((a) => a.reproductive_status === 'pregnant').length;
  const vaccDue = reminders.filter((r) => r.kind === 'vaccination');
  const vaccOverdue = vaccDue.filter((r) => r.urgency === 'overdue').length;
  const byCow = perAnimal(milk, range.from, to).map((y) => ({ key: y.cattle_id, label: names.get(y.cattle_id) ?? 'Unknown', value: y.totalCl }));

  // Sales and payments per day as two small charts on one scale (never two axes).
  const days = dailyTotals([], chartFrom, to).map((d) => d.date);
  const perDay = (pick: (date: string) => number) => days.map((d) => ({ key: d, label: dayLabel(d), short: String(Number(d.slice(8))), value: pick(d) }));
  const salesBars = perDay((d) => f.sales.filter((s) => s.status === 'completed' && s.currency === f.currency && f.farmDate(s.sale_at) === d).reduce((x, s) => x + toCents(s.total), 0));
  const payBars = perDay((d) =>
    f.payments.filter((p) => p.status === 'completed' && p.kind === 'payment' && p.currency === f.currency && f.farmDate(p.paid_at) === d).reduce((x, p) => x + toCents(p.amount), 0),
  );
  const moneyMax = Math.max(0, ...salesBars.map((b) => b.value), ...payBars.map((b) => b.value));
  const fmtMoney = (c: number) => money(c, f.currency);
  const upcoming = reminders.filter((r) => r.urgency === 'overdue' || r.urgency === 'today' || r.urgency === 'upcoming').slice(0, 3);
  const attentionRows = [...attention.entries()].slice(0, 3);
  const syncWorthShowing = sync.pending > 0 || sync.failed > 0 || sync.state === 'offline' || sync.state === 'attention';

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.background }} contentContainerStyle={{ padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl }}>
      <TodayCard name={account?.display_name} today={today} milkToday={L(milkDay.totalCl)} cows={milkDay.cows} forSale={`${litres(f.available(today))} L`} />
      {syncWorthShowing ? <SyncStatus /> : null}

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm, paddingHorizontal: spacing.xs }}>
        {QUICK.map((q) => (
          <QuickAction key={q.label} {...q} />
        ))}
      </View>

      {withdrawals > 0 || attentionRows.length > 0 ? (
        <View style={{ gap: spacing.sm }}>
          <SectionHeader title="Needs attention" action={attention.size > 3 ? `All ${attention.size}` : undefined} onAction={() => router.push('/reminders')} />
          <ListGroup>
            {withdrawals > 0 ? (
              <ListRow icon="water-off-outline" tint="red" title={`${withdrawals} milk withdrawal${withdrawals === 1 ? '' : 's'}`} subtitle="This milk is not for sale" href="/reminders" />
            ) : null}
            {attentionRows.map(([id, reasons]) => {
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
        </View>
      ) : null}

      <View style={{ gap: spacing.sm }}>
        <SectionHeader title="Herd" />
        <Card href="/animals" label={`Herd: ${herd} active of ${animals.length}, ${inMilk} in milk, ${pregnant} confirmed pregnant, ${attention.size} needing attention, ${vaccDue.length} vaccinations due`}>
          <FigureRow>
            <Figure label="Active" value={String(herd)} note={`of ${animals.length} recorded`} />
            <Figure label="In milk" value={String(inMilk)} />
            <Figure label="Pregnant" value={String(pregnant)} note="confirmed" />
            <Figure label="Need attention" value={String(attention.size)} tone={attention.size ? 'danger' : undefined} />
            <Figure label="Vaccinations due" value={String(vaccDue.length)} note={vaccOverdue ? `${vaccOverdue} overdue` : 'next 30 days'} tone={vaccOverdue ? 'danger' : undefined} />
          </FigureRow>
        </Card>
      </View>

      {/* One period choice drives the milk and money cards below. */}
      <Chips
        label="Period for milk and money"
        value={choice}
        options={[
          { value: 'today', label: 'Today' },
          { value: 'week', label: 'This week' },
          { value: 'month', label: 'This month' },
        ]}
        onChange={(v) => v && setChoice(v)}
        allowClear={false}
      />

      <View style={{ gap: spacing.sm }}>
        <SectionHeader title="Milk" action="Production" onAction={() => router.push('/production')} />
        <Card>
          <FigureRow>
            <Figure label="Produced" value={L(milkPeriod.totalCl)} note={milkPeriod.restrictedCl ? `${L(milkPeriod.restrictedCl)} withdrawal` : undefined} />
            <Figure label="Sold" value={L(moneyPeriod.litresCl)} />
            <Figure label="For sale now" value={`${litres(f.available(today))} L`} />
          </FigureRow>
          <Chips
            label="Chart"
            value={milkChart}
            options={[
              { value: 'daily', label: 'Per day' },
              { value: 'cow', label: 'By cow' },
            ]}
            onChange={(v) => v && setMilkChart(v)}
            allowClear={false}
          />
          {milkChart === 'daily' ? (
            <BarChart
              title={choice === 'today' ? 'Milk per day, last 7 days' : 'Milk per day'}
              bars={dailyTotals(milk, chartFrom, to).map((d) => ({ key: d.date, label: dayLabel(d.date), short: String(Number(d.date.slice(8))), value: d.cl, missing: !d.recorded }))}
              format={L}
              height={100}
            />
          ) : (
            <HorizontalBars title="Milk by cow" items={byCow} format={L} limit={6} />
          )}
        </Card>
      </View>

      <View style={{ gap: spacing.sm }}>
        <SectionHeader title={`Money (${f.currency})`} action="Summary" onAction={() => router.push('/finance')} />
        <Card>
          <FigureRow>
            <Figure label="Sales" value={money(moneyPeriod.revenueCents, f.currency)} />
            <Figure label="Received" value={money(moneyPeriod.receiptsCents, f.currency)} />
            <Figure label="Owed now" value={money(moneyPeriod.outstandingCents, f.currency)} tone={moneyPeriod.outstandingCents > 0 ? 'danger' : undefined} />
            <Figure label="Expenses" value={money(moneyPeriod.expensesCents, f.currency)} />
          </FigureRow>
          <BarChart title="Sales per day" bars={salesBars} format={fmtMoney} height={70} max={moneyMax} />
          <BarChart title="Payments received per day" bars={payBars} format={fmtMoney} height={70} max={moneyMax} />
        </Card>
      </View>

      <View style={{ gap: spacing.sm }}>
        <SectionHeader title="Coming up" action="All" onAction={() => router.push('/reminders')} />
        {upcoming.length === 0 ? (
          <Text style={{ color: t.textMuted, fontSize: 15 }}>Nothing due in the coming days.</Text>
        ) : (
          <ListGroup>
            {upcoming.map((r) => (
              <ListRow
                key={r.key}
                icon={REMINDER_ICON[r.kind]}
                tint={r.urgency === 'overdue' ? 'red' : 'straw'}
                title={`${r.cattleId ? `${names.get(r.cattleId) ?? 'Animal'}: ` : ''}${r.title}`}
                subtitle={`${r.urgency === 'overdue' ? 'Overdue · ' : ''}${dayLabel(r.due.slice(0, 10))}`}
                href={(r.href ?? { pathname: '/care/[kind]/[id]', params: { kind: r.record!.kind, id: r.record!.id } }) as Href}
              />
            ))}
          </ListGroup>
        )}
      </View>
    </ScrollView>
  );
}
