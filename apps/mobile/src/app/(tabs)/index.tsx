import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { type Href, router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { displayName } from '../../animals/model';
import type { ReminderKind } from '../../care/reminders';
import { useReminders } from '../../care/useReminders';
import { money, summarize as summarizeMoney } from '../../finance/calc';
import { useFinance } from '../../finance/useFinance';
import { addDays, dailyTotals, litres, periodRange, summarize } from '../../production/calc';
import { dayLabel, L } from '../../production/format';
import { ATTENTION_LABELS, needingAttention } from '../../reports/dashboard';
import { useReportInput } from '../../reports/useReportInput';
import { useAuth } from '../../state/auth';
import { useSyncStatus } from '../../sync/engine';
import { BarChart } from '../../ui/BarChart';
import { Avatar, Card, Figure, type IconName, ListGroup, ListRow, SectionHeader } from '../../ui/kit';
import { SyncStatus } from '../../ui/SyncStatus';
import { radius, shadow, spacing, type, useTheme } from '../../ui/theme';

// Home answers two questions only: what needs me today, and what do I do next.
// Everything else (herd detail, money, reports) is one tap away.

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

  const { today, animals, milk } = input;
  const attention = useMemo(() => needingAttention(input), [input]);
  const withdrawals = reminders.filter((r) => r.urgency === 'active').length;
  const milkDay = summarize(milk, today, today);
  const week = periodRange('week', today);
  const milkWeek = summarize(milk, week.from, today);
  const moneyWeek = summarizeMoney(f.currency, week.from, today, f, f.farmDate);
  const inMilk = animals.filter((a) => a.status === 'active' && a.production_status === 'lactating').length;
  const herd = animals.filter((a) => a.status === 'active').length;
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
        <SectionHeader title="This week" action="Details" onAction={() => router.push('/production')} />
        <Card>
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <Figure label="Milk" value={L(milkWeek.totalCl)} />
            <Figure label="Sold" value={money(moneyWeek.revenueCents, f.currency)} />
            <Figure label="Owed to you" value={money(moneyWeek.outstandingCents, f.currency)} tone={moneyWeek.outstandingCents > 0 ? 'danger' : undefined} />
          </View>
          <BarChart
            title="Daily milk"
            bars={dailyTotals(milk, addDays(today, -6), today).map((d) => ({ key: d.date, label: dayLabel(d.date), short: String(Number(d.date.slice(8))), value: d.cl, missing: !d.recorded }))}
            format={L}
            height={100}
          />
          <Text style={{ color: t.textMuted, fontSize: 13 }}>
            {herd} animal{herd === 1 ? '' : 's'} · {inMilk} in milk
          </Text>
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
