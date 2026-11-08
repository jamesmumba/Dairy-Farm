import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { useAuth } from '../state/auth';
import { useLocal } from '../sync/store';
import { BarChart } from '../ui/BarChart';
import { toDateString } from '../ui/DateField';
import { Button } from '../ui/form';
import { Card, Figure, ListGroup, ListRow } from '../ui/kit';
import { spacing, type, useTheme } from '../ui/theme';
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
    <View style={{ gap: spacing.md }}>
      <Card>
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          <Figure label="Last 7 days" value={L(last7.totalCl)} note={last7.avgPerCowDayCl !== null ? `${L(last7.avgPerCowDayCl)} a day` : undefined} />
          <Figure label="This month" value={L(month.totalCl)} />
        </View>
        {d.state === 'decline' ? (
          <Text style={{ color: t.danger, ...type.secondary }} accessibilityRole="alert">
            ⚠ Down {Math.abs(d.changePct)}%: {L(d.recentAvgCl)} a day, was {L(d.baselineAvgCl)}
          </Text>
        ) : d.state === 'ok' ? (
          <Text style={{ color: t.textMuted, ...type.secondary }}>
            {d.changePct >= 0 ? '▲' : '▼'} {Math.abs(d.changePct)}% on the period before
          </Text>
        ) : null}
        {rows.length ? (
          <BarChart
            title="Last 14 days"
            bars={dailyTotals(rows, addDays(today, -13), today).map((x) => ({
              key: x.date,
              label: dayLabel(x.date),
              short: String(Number(x.date.slice(8))),
              value: x.cl,
              missing: !x.recorded,
            }))}
            format={L}
            height={90}
          />
        ) : null}
      </Card>

      {canRecord ? <Button label="Record milk" onPress={() => router.push({ pathname: '/milk/new', params: { cattle_id: cattleId } })} /> : null}

      {recent.length ? (
        <ListGroup>
          {recent.map(({ data: m, sync_state }) => {
            const voided = m.status === 'voided';
            return (
              <View key={m.id} style={{ opacity: voided ? 0.55 : 1 }}>
                <ListRow
                  icon={m.restricted && !voided ? 'water-off-outline' : 'water-outline'}
                  tint={m.restricted && !voided ? 'red' : 'green'}
                  title={`${dayLabel(m.production_date)} · ${SESSION_LABELS[m.session]}`}
                  subtitle={[voided ? 'voided' : null, m.restricted && !voided ? 'withdrawal, not for sale' : null, sync_state !== 'synced' ? 'waiting to sync' : null].filter(Boolean).join(' · ') || undefined}
                  value={L(toCl(m.quantity))}
                  href={{ pathname: '/milk/[id]', params: { id: m.id } }}
                />
              </View>
            );
          })}
        </ListGroup>
      ) : null}
    </View>
  );
}
