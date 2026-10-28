import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { type Href, router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { displayName } from '../../animals/model';
import { REMINDER_ICON } from '../../care/reminderIcon';
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
import { HorizontalBars } from '../../ui/HorizontalBars';
import { Avatar, Card, Figure, Headline, IconBadge, type IconName, ListGroup, ListRow, MetricChip, SectionHeader, Segmented, StatementLine } from '../../ui/kit';
import { SyncStatus } from '../../ui/SyncStatus';
import { useSyncRefresh } from '../../ui/useSyncRefresh';
import { minTouch, radius, shadow, spacing, type, useTheme } from '../../ui/theme';

// Home leads with what needs the farmer today and what to do next, then the summary the specification
// asks for (herd, milk, money for a chosen period, with charts); each section opens its details.

const QUICK: { label: string; hint: string; icon: IconName; href: Href }[] = [
  { label: 'Milk', hint: 'Record a milking round', icon: 'water-outline', href: '/milk/round' },
  { label: 'Sale', hint: 'Log milk sold to a customer', icon: 'cash', href: '/sale/new' },
  { label: 'Animal', hint: 'Register an animal', icon: 'cow', href: '/animal/new' },
  { label: 'Health', hint: 'Record a health issue', icon: 'stethoscope', href: { pathname: '/care/[kind]/new', params: { kind: 'health' } } },
];

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function TodayCard({ name, today, milkToday, cows, forSale }: { name?: string | null; today: string; milkToday: string; cows: number; forSale: string }) {
  const t = useTheme();
  const figure = (label: string, value: string, note: string) => (
    <View style={{ flex: 1, gap: 2 }} accessible accessibilityLabel={`${label}: ${value}. ${note}`}>
      <Text style={{ color: t.heroMuted, fontSize: 14 }}>{label}</Text>
      <Text style={{ color: t.onHero, fontSize: 30, fontWeight: '600', fontVariant: ['tabular-nums'] }} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={{ color: t.heroMuted, fontSize: 13 }}>{note}</Text>
    </View>
  );
  return (
    <View style={{ backgroundColor: t.hero, borderRadius: radius.card + 4, padding: spacing.lg, gap: spacing.lg, overflow: 'hidden', ...shadow }}>
      <MaterialCommunityIcons name="cow" size={72} color={t.onHero} style={{ position: 'absolute', right: 12, top: 8, opacity: 0.1 }} importantForAccessibility="no" />
      <View style={{ gap: 2 }}>
        <Text accessibilityRole="header" style={{ color: t.onHero, ...type.screenTitle, fontSize: 24 }}>
          {greeting()}
          {name ? `, ${name}` : ''}
        </Text>
        <Text style={{ color: t.heroMuted, fontSize: 15 }}>{dayLabel(today)}</Text>
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
  const refresh = useSyncRefresh();
  const { account } = useAuth();
  const sync = useSyncStatus();
  const input = useReportInput();
  const f = useFinance();
  const { reminders, names } = useReminders();
  const [choice, setChoice] = useState<'today' | 'week' | 'month'>('week');
  const [milkChart, setMilkChart] = useState<'daily' | 'cow'>('daily');

  const { today, animals, milk } = input;
  const attention = useMemo(() => needingAttention(input), [input]);
  const withdrawals = reminders.filter((r) => r.kind === 'withdrawal').length;
  const missingMilk = reminders.filter((r) => r.kind === 'missing_milk');
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
  const periodName = choice === 'today' ? 'today' : choice === 'week' ? 'this week' : 'this month';
  const upcoming = reminders.filter((r) => r.urgency === 'overdue' || r.urgency === 'today' || r.urgency === 'upcoming').slice(0, 3);
  const attentionRows = [...attention.entries()].slice(0, 3);
  const syncWorthShowing = sync.pending > 0 || sync.failed > 0 || sync.state === 'offline' || sync.state === 'attention';

  return (
    <ScrollView refreshControl={<RefreshControl {...refresh} />} style={{ flex: 1, backgroundColor: t.background }} contentContainerStyle={{ padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl }}>
      <TodayCard name={account?.display_name} today={today} milkToday={L(milkDay.totalCl)} cows={milkDay.cows} forSale={`${litres(f.available(today))} L`} />
      {syncWorthShowing ? <SyncStatus /> : null}

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm, paddingHorizontal: spacing.xs }}>
        {QUICK.map((q) => (
          <QuickAction key={q.label} {...q} />
        ))}
      </View>

      {withdrawals > 0 || missingMilk.length > 0 || attentionRows.length > 0 ? (
        <View style={{ gap: spacing.sm }}>
          <SectionHeader title="Needs attention" action={attention.size > 3 ? `All ${attention.size}` : undefined} onAction={() => router.push('/reminders')} />
          <ListGroup>
            {withdrawals > 0 ? (
              <ListRow icon="water-off-outline" tint="red" title={`${withdrawals} milk withdrawal${withdrawals === 1 ? '' : 's'}`} subtitle="This milk is not for sale" href="/reminders" />
            ) : null}
            {missingMilk.map((r) => (
              <ListRow key={r.key} icon={REMINDER_ICON.missing_milk} tint="straw" title={r.title} subtitle="Tap to record them" href={r.href as Href} />
            ))}
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

      {/* Herd: one big number, then chips for the groups that matter; warnings only when there are any. */}
      <View style={{ gap: spacing.sm }}>
        <SectionHeader title="Herd" action="Animals" onAction={() => router.push('/animals')} />
        <Card href="/animals" label={`Herd: ${herd} active animals of ${animals.length} recorded, ${inMilk} in milk, ${pregnant} confirmed pregnant`}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <IconBadge icon="cow" size={48} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: t.text, fontSize: 26, fontWeight: '600' }}>
                {herd} <Text style={{ fontSize: 17, fontWeight: '500', color: t.textMuted }}>active animal{herd === 1 ? '' : 's'}</Text>
              </Text>
              <Text style={{ color: t.textMuted, fontSize: 14 }}>{animals.length} recorded in total</Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            <MetricChip icon="water-outline" value={String(inMilk)} label="in milk" tint="sky" />
            <MetricChip icon="heart-pulse" value={String(pregnant)} label="pregnant" tint="straw" />
            {attention.size ? <MetricChip icon="alert-circle-outline" value={String(attention.size)} label="need attention" tint="red" /> : null}
            {vaccOverdue ? (
              <MetricChip icon="needle" value={String(vaccOverdue)} label={`vaccination${vaccOverdue === 1 ? '' : 's'} overdue`} tint="red" />
            ) : (
              <MetricChip icon="needle" value={String(vaccDue.length)} label={`vaccination${vaccDue.length === 1 ? '' : 's'} due`} />
            )}
          </View>
        </Card>
      </View>

      <View style={{ gap: spacing.sm }}>
        <SectionHeader title="Milk and money" />
        <Segmented
          label="Period for milk and money"
          value={choice}
          options={[
            { value: 'today', label: 'Today' },
            { value: 'week', label: 'This week' },
            { value: 'month', label: 'This month' },
          ]}
          onChange={setChoice}
        />
      </View>

      {/* Milk: what was produced is the headline; where it went sits underneath. */}
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md }}>
          <View style={{ flex: 1 }}>
            <Headline label={`Milk produced ${periodName}`} value={L(milkPeriod.totalCl)} />
          </View>
          <IconBadge icon="water-outline" tint="sky" />
        </View>
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          <Figure label="Sold" value={L(moneyPeriod.litresCl)} />
          <Figure label="For sale now" value={`${litres(f.available(today))} L`} />
          {milkPeriod.restrictedCl ? <Figure label="Withdrawal" value={L(milkPeriod.restrictedCl)} tone="danger" /> : null}
        </View>
        <Segmented
          label="Milk chart"
          value={milkChart}
          options={[
            { value: 'daily', label: 'Per day' },
            { value: 'cow', label: 'By cow' },
          ]}
          onChange={setMilkChart}
        />
        {milkChart === 'daily' ? (
          <BarChart
            title={choice === 'today' ? 'Last 7 days' : 'Per day'}
            bars={dailyTotals(milk, chartFrom, to).map((d) => ({ key: d.date, label: dayLabel(d.date), short: String(Number(d.date.slice(8))), value: d.cl, missing: !d.recorded }))}
            format={L}
            height={100}
          />
        ) : (
          <HorizontalBars title="By cow" items={byCow} format={L} limit={6} />
        )}
        <Pressable accessibilityRole="button" onPress={() => router.push('/production')} style={{ minHeight: minTouch - 8, justifyContent: 'center' }}>
          <Text style={{ color: t.primary, fontSize: 15, fontWeight: '600' }}>Production details ›</Text>
        </Pressable>
      </Card>

      {/* Money: sales as the headline, then a short statement, then the two trends on one scale. */}
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md }}>
          <View style={{ flex: 1 }}>
            <Headline label={`Sales ${periodName}`} value={money(moneyPeriod.revenueCents, f.currency)} note={`${moneyPeriod.salesCount} sale${moneyPeriod.salesCount === 1 ? '' : 's'}`} />
          </View>
          <IconBadge icon="cash-multiple" />
        </View>
        <View>
          <StatementLine first label="Money received" value={money(moneyPeriod.receiptsCents, f.currency)} />
          <StatementLine label="Customers owe now" value={money(moneyPeriod.outstandingCents, f.currency)} tone={moneyPeriod.outstandingCents > 0 ? 'danger' : undefined} />
          <StatementLine label="Expenses" value={money(moneyPeriod.expensesCents, f.currency)} />
          <StatementLine label="Sales left after feed" value={money(moneyPeriod.afterFeedCents, f.currency)} tone={moneyPeriod.afterFeedCents < 0 ? 'danger' : undefined} />
        </View>
        <BarChart title="Sales per day" bars={salesBars} format={fmtMoney} height={64} max={moneyMax} />
        <BarChart title="Payments received per day" bars={payBars} format={fmtMoney} height={64} max={moneyMax} />
        <Pressable accessibilityRole="button" onPress={() => router.push('/finance')} style={{ minHeight: minTouch - 8, justifyContent: 'center' }}>
          <Text style={{ color: t.primary, fontSize: 15, fontWeight: '600' }}>Money summary ›</Text>
        </Pressable>
      </Card>

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
