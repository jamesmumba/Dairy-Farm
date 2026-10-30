import { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { displayName } from '../animals/model';
import { listAnimals, listBreeds } from '../animals/repo';
import {
  dailyTotals,
  decline,
  DEFAULT_DECLINE_RULE,
  highLow,
  type Period,
  perAnimal,
  perBreed,
  lastMonthRange,
  periodRange,
  previousRange,
  SESSIONS,
  summarize,
  toCl,
} from '../production/calc';
import { dayLabel, L, SESSION_LABELS } from '../production/format';
import { listMilk } from '../production/repo';
import { useAuth } from '../state/auth';
import { useSyncStatus } from '../sync/engine';
import { useLocal } from '../sync/store';
import { BarChart } from '../ui/BarChart';
import { Chips } from '../ui/Chips';
import { DateField, toDateString } from '../ui/DateField';
import { Notice } from '../ui/form';
import { Avatar, Card, Figure, ListGroup, ListRow, Pill, SectionHeader } from '../ui/kit';
import { spacing, useTheme } from '../ui/theme';

type Choice = Period | 'last_month' | 'custom';

export default function Production() {
  const t = useTheme();
  const { account } = useAuth();
  const sync = useSyncStatus();
  const today = toDateString(new Date());
  const rule = account?.decline_rule ?? DEFAULT_DECLINE_RULE;
  const milk = useLocal(() => listMilk().map((m) => m.data));
  const animals = useLocal(listAnimals);
  const breeds = useLocal(listBreeds);
  const [choice, setChoice] = useState<Choice>('week');
  const [custom, setCustom] = useState({ from: periodRange('month', today).from, to: today });

  const range = choice === 'custom' ? custom : choice === 'last_month' ? lastMonthRange(today) : periodRange(choice, today);
  const to = range.to > today ? today : range.to; // nothing recorded in the future
  const name = useMemo(() => new Map(animals.map((a) => [a.data.id, displayName(a.data)])), [animals]);
  const breedOf = useMemo(() => new Map(animals.map((a) => [a.data.id, a.data.breed_id])), [animals]);

  const s = summarize(milk, range.from, to);
  const prevRange = previousRange({ from: range.from, to });
  const prev = summarize(milk, prevRange.from, prevRange.to);
  const change = prev.totalCl ? Math.round(((s.totalCl - prev.totalCl) / prev.totalCl) * 100) : null;
  const yields = perAnimal(milk, range.from, to).sort((a, b) => b.avgCl - a.avgCl);
  // Rank only cows with enough records: the farmer's minimum, or fewer for a short period.
  const longest = Math.max(1, ...yields.map((y) => y.days));
  const { high, low } = highLow(yields, Math.min(rule.min_days, longest));
  const highIds = new Set(high.map((y) => y.cattle_id));
  const lowIds = new Set(low.map((y) => y.cattle_id));
  const byBreed = perBreed(milk, (id) => breedOf.get(id) ?? null, range.from, to);
  const declines = animals
    .map((a) => a.data)
    .filter((a) => a.status === 'active' && a.sex === 'female')
    .map((a) => ({ a, d: decline(milk, a.id, today, rule) }))
    .filter(({ d }) => d.state === 'decline');

  const sessionTotals = SESSIONS.map((session) => ({
    session,
    cl: milk.filter((m) => m.status === 'valid' && m.production_date === today && m.session === session).reduce((sum, m) => sum + toCl(m.quantity), 0),
  }));
  const datesOk = choice !== 'custom' || custom.from <= custom.to;

  return (
    <ScrollView style={{ backgroundColor: t.background }} contentContainerStyle={{ padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl }}>
      <Chips
        label="Period"
        value={choice}
        options={[
          { value: 'today', label: 'Today' },
          { value: 'week', label: 'This week' },
          { value: 'month', label: 'This month' },
          { value: 'last_month', label: 'Last month' },
          { value: 'year', label: 'This year' },
          { value: 'custom', label: 'Dates…' },
        ]}
        onChange={(c) => c && setChoice(c)}
        allowClear={false}
      />
      {choice === 'custom' ? (
        <View style={{ gap: spacing.sm }}>
          <DateField label="From" value={custom.from} onChange={(from) => from && setCustom((c) => ({ ...c, from }))} optional={false} />
          <DateField label="To" value={custom.to} onChange={(t2) => t2 && setCustom((c) => ({ ...c, to: t2 }))} optional={false} />
          {!datesOk ? <Notice tone="error">“From” must be before “To”.</Notice> : null}
        </View>
      ) : null}

      {/* The headline: how much milk, and how that compares. Everything else supports it. */}
      <Card>
        <View style={{ gap: 2 }} accessible accessibilityLabel={`Milk produced ${dayLabel(range.from)} to ${dayLabel(to)}: ${L(s.totalCl)}${change === null ? '' : `, ${change >= 0 ? 'up' : 'down'} ${Math.abs(change)}% on the period before`}`}>
          <Text style={{ color: t.textMuted, fontSize: 14 }}>
            Milk produced · {range.from === to ? dayLabel(to) : `${dayLabel(range.from)} – ${dayLabel(to)}`}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
            <Text style={{ color: t.text, fontSize: 36, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{L(s.totalCl)}</Text>
            {change !== null ? <Pill label={`${change >= 0 ? '▲' : '▼'} ${Math.abs(change)}% on period before`} tint={change >= 0 ? 'green' : 'straw'} /> : null}
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          <Figure label="Per cow a day" value={s.avgPerCowDayCl === null ? '—' : L(s.avgPerCowDayCl)} />
          <Figure label="Cows milked" value={String(s.cows)} />
          <Figure label="Not for sale" value={L(s.restrictedCl)} tone={s.restrictedCl ? 'danger' : undefined} />
        </View>
        {sync.pending ? <Text style={{ color: t.textMuted, fontSize: 13 }}>Includes {sync.pending} changes not yet synced.</Text> : null}
      </Card>

      {choice === 'today' ? (
        <Card>
          <Text style={{ color: t.text, fontSize: 16, fontWeight: '600' }}>Today by session</Text>
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            {sessionTotals.map(({ session, cl }) => (
              <Figure key={session} label={SESSION_LABELS[session]} value={cl ? L(cl) : '—'} />
            ))}
          </View>
        </Card>
      ) : datesOk ? (
        <Card>
          <BarChart
            title="Milk per day"
            bars={dailyTotals(milk, range.from, to)
              .slice(-62) // keep bars legible on a phone; longer ranges show the last two months
              .map((d) => ({ key: d.date, label: dayLabel(d.date), short: String(Number(d.date.slice(8))), value: d.cl, missing: !d.recorded }))}
            format={L}
            height={120}
          />
        </Card>
      ) : null}

      {declines.length ? (
        <View style={{ gap: spacing.sm }}>
          <SectionHeader title="Falling milk" />
          <Text style={{ color: t.textMuted, fontSize: 13 }}>
            Last {rule.recent_days} days (to yesterday) against the {rule.baseline_days} before, flagged at {rule.threshold_pct}% down. Change this in settings.
          </Text>
          <ListGroup>
            {declines.map(({ a, d }) =>
              d.state === 'decline' ? (
                <ListRow
                  key={a.id}
                  leading={<Avatar name={displayName(a)} tint="red" size={40} />}
                  title={displayName(a)}
                  subtitle={`${L(d.recentAvgCl)} a day, was ${L(d.baselineAvgCl)}`}
                  value={`▼ ${Math.abs(d.changePct)}%`}
                  valueTone="danger"
                  href={{ pathname: '/animal/[id]', params: { id: a.id } }}
                />
              ) : null,
            )}
          </ListGroup>
        </View>
      ) : null}

      {yields.length ? (
        <View style={{ gap: spacing.sm }}>
          <SectionHeader title="By cow" />
          <ListGroup>
            {yields.map((y) => (
              <ListRow
                key={y.cattle_id}
                leading={<Avatar name={name.get(y.cattle_id) ?? '?'} size={40} />}
                title={name.get(y.cattle_id) ?? 'Unknown'}
                subtitle={`${L(y.avgCl)} a day${highIds.has(y.cattle_id) ? ' · highest' : lowIds.has(y.cattle_id) ? ' · lowest' : ''}`}
                value={L(y.totalCl)}
                href={{ pathname: '/animal/[id]', params: { id: y.cattle_id } }}
              />
            ))}
          </ListGroup>
        </View>
      ) : (
        <Notice>No milk recorded in this period.</Notice>
      )}

      {byBreed.length > 1 ? (
        <View style={{ gap: spacing.sm }}>
          <SectionHeader title="By breed" />
          <Card gap={spacing.sm}>
            {byBreed.map((b) => (
              <View key={b.breed_id ?? 'none'} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }} accessible>
                <Text style={{ color: t.text, fontSize: 15, flex: 1 }}>
                  {breeds.find((x) => x.id === b.breed_id)?.name ?? 'Breed not set'} <Text style={{ color: t.textMuted }}>· {b.cows} cow{b.cows === 1 ? '' : 's'}</Text>
                </Text>
                <Text style={{ color: t.text, fontSize: 15, fontVariant: ['tabular-nums'] }}>{L(b.avgPerCowDayCl)} a day</Text>
              </View>
            ))}
          </Card>
        </View>
      ) : null}
    </ScrollView>
  );
}
