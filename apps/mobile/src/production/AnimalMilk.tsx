import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useAuth } from '../state/auth';
import { useLocal } from '../sync/store';
import { BarChart } from '../ui/BarChart';
import { toDateString } from '../ui/DateField';
import { Button } from '../ui/form';
import { SyncBadge } from '../ui/SyncBadge';
import { minTouch, spacing, useTheme } from '../ui/theme';
import { addDays, dailyTotals, decline, DEFAULT_DECLINE_RULE, periodRange, summarize, toCl } from './calc';
import { dayLabel, L, SESSION_LABELS } from './format';
import { listMilk } from './repo';

/** Milk section of a cow's profile: recent yield, decline status, recent entries. */
export function AnimalMilk({ cattleId, canRecord }: { cattleId: string; canRecord: boolean }) {
  const t = useTheme();
  const { account } = useAuth();
  const entries = useLocal(() => listMilk().filter((m) => m.data.cattle_id === cattleId), cattleId);
  const rows = entries.map((e) => e.data);
  const today = toDateString(new Date());
  const last7 = summarize(rows, addDays(today, -6), today);
  const month = summarize(rows, periodRange('month', today).from, today);
  const d = decline(rows, cattleId, today, account?.decline_rule ?? DEFAULT_DECLINE_RULE);
  const recent = [...entries].sort((a, b) => (b.data.production_date + b.data.session).localeCompare(a.data.production_date + a.data.session)).slice(0, 8);

  return (
    <View style={{ gap: spacing.sm }}>
      <Text accessibilityRole="header" style={{ color: t.text, fontSize: 20, fontWeight: '700', marginTop: spacing.md }}>
        Milk
      </Text>
      <Text style={{ color: t.text, fontSize: 16 }}>
        Last 7 days: {L(last7.totalCl)}
        {last7.avgPerCowDayCl !== null ? ` · ${L(last7.avgPerCowDayCl)}/day` : ''} · This month: {L(month.totalCl)}
      </Text>
      {d.state === 'decline' ? (
        <Text style={{ color: t.danger, fontSize: 16 }} accessibilityRole="alert">
          ⚠ Production down {Math.abs(d.changePct)}%: {L(d.recentAvgCl)}/day vs {L(d.baselineAvgCl)}/day the {d.baseline.days > 1 ? 'days' : 'day'} before
        </Text>
      ) : d.state === 'ok' ? (
        <Text style={{ color: t.textMuted, fontSize: 15 }}>
          Trend: {d.changePct >= 0 ? '▲' : '▼'} {Math.abs(d.changePct)}% vs the previous period
        </Text>
      ) : (
        <Text style={{ color: t.textMuted, fontSize: 15 }}>Not enough records yet to check the trend.</Text>
      )}

      {rows.length ? (
        <BarChart
          title="Daily milk, last 14 days"
          bars={dailyTotals(rows, addDays(today, -13), today).map((x) => ({
            key: x.date,
            label: dayLabel(x.date),
            short: String(Number(x.date.slice(8))),
            value: x.cl,
            missing: !x.recorded,
          }))}
          format={L}
          height={100}
        />
      ) : null}

      {canRecord ? <Button label="Record milk" onPress={() => router.push({ pathname: '/milk/new', params: { cattle_id: cattleId } })} /> : null}

      {recent.map(({ data: m, sync_state }) => (
        <Pressable
          key={m.id}
          accessibilityRole="button"
          accessibilityLabel={`${dayLabel(m.production_date)} ${m.session}: ${L(toCl(m.quantity))}${m.status === 'voided' ? ', voided' : ''}${m.restricted ? ', milk withdrawal' : ''}`}
          onPress={() => router.push({ pathname: '/milk/[id]', params: { id: m.id } })}
          style={{ minHeight: minTouch, justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: t.border }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ color: t.text, fontSize: 16, textDecorationLine: m.status === 'voided' ? 'line-through' : 'none' }}>
              {dayLabel(m.production_date)} · {SESSION_LABELS[m.session]}
            </Text>
            <Text style={{ color: t.text, fontSize: 16, fontVariant: ['tabular-nums'] }}>{L(toCl(m.quantity))}</Text>
          </View>
          {m.status === 'voided' ? <Text style={{ color: t.textMuted, fontSize: 13 }}>Voided</Text> : null}
          {m.restricted && m.status === 'valid' ? <Text style={{ color: t.danger, fontSize: 13 }}>Milk withdrawal: not for sale</Text> : null}
          <SyncBadge state={sync_state} />
        </Pressable>
      ))}
    </View>
  );
}
