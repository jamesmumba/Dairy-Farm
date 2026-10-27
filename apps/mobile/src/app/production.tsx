import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
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
import { minTouch, radius, spacing, useTheme, useCardBasis } from '../ui/theme';

type Choice = Period | 'custom';

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  const t = useTheme();
  const basis = useCardBasis();
  return (
    <View style={{ flexBasis: basis, flexGrow: 1, backgroundColor: t.surface, borderRadius: radius.card, borderWidth: 1, borderColor: t.border, padding: spacing.md, gap: 2 }} accessible accessibilityLabel={`${label}: ${value}${note ? `. ${note}` : ''}`}>
      <Text style={{ color: t.textMuted, fontSize: 14 }}>{label}</Text>
      <Text style={{ color: t.text, fontSize: 22, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{value}</Text>
      {note ? <Text style={{ color: t.textMuted, fontSize: 13 }}>{note}</Text> : null}
    </View>
  );
}

function Heading({ children }: { children: string }) {
  const t = useTheme();
  return (
    <Text accessibilityRole="header" style={{ color: t.text, fontSize: 20, fontWeight: '700', marginTop: spacing.md }}>
      {children}
    </Text>
  );
}

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

  const range = choice === 'custom' ? custom : periodRange(choice, today);
  const to = range.to > today ? today : range.to; // nothing recorded in the future
  const name = useMemo(() => new Map(animals.map((a) => [a.data.id, displayName(a.data)])), [animals]);
  const breedOf = useMemo(() => new Map(animals.map((a) => [a.data.id, a.data.breed_id])), [animals]);

  const s = summarize(milk, range.from, to);
  const prevRange = previousRange({ from: range.from, to });
  const prev = summarize(milk, prevRange.from, prevRange.to);
  const change = prev.totalCl ? Math.round(((s.totalCl - prev.totalCl) / prev.totalCl) * 100) : null;
  const yields = perAnimal(milk, range.from, to);
  // Rank only cows with enough records: the farmer's minimum, or fewer for a short period.
  const longest = Math.max(1, ...yields.map((y) => y.days));
  const { high, low } = highLow(yields, Math.min(rule.min_days, longest));
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

  return (
    <ScrollView style={{ backgroundColor: t.background }} contentContainerStyle={{ padding: spacing.md, gap: spacing.sm }}>
      <Chips
        label="Period"
        value={choice}
        options={[
          { value: 'today', label: 'Today' },
          { value: 'week', label: 'This week' },
          { value: 'month', label: 'This month' },
          { value: 'year', label: 'This year' },
          { value: 'custom', label: 'Dates…' },
        ]}
        onChange={(c) => c && setChoice(c)}
        allowClear={false}
      />
      {choice === 'custom' ? (
        <>
          <DateField label="From" value={custom.from} onChange={(from) => from && setCustom((c) => ({ ...c, from }))} optional={false} />
          <DateField label="To" value={custom.to} onChange={(t2) => t2 && setCustom((c) => ({ ...c, to: t2 }))} optional={false} />
          {custom.from > custom.to ? <Notice tone="error">“From” must be before “To”.</Notice> : null}
        </>
      ) : null}

      <Text style={{ color: t.textMuted, fontSize: 14 }}>
        {dayLabel(range.from)} – {dayLabel(to)} · calculated from records on this phone
        {sync.pending ? `, including ${sync.pending} not yet synced` : ''}. Records made on another phone appear after they sync.
      </Text>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        <Tile
          label="Milk produced"
          value={L(s.totalCl)}
          note={change === null ? 'No records in the previous period' : `${change >= 0 ? '▲' : '▼'} ${Math.abs(change)}% vs previous ${dayLabel(prevRange.from)}–${dayLabel(prevRange.to)}`}
        />
        <Tile label="Not for sale (withdrawal)" value={L(s.restrictedCl)} note={`${L(s.eligibleCl)} eligible`} />
        <Tile label="Average per cow per day" value={s.avgPerCowDayCl === null ? '—' : L(s.avgPerCowDayCl)} note="Days with records only" />
        <Tile label="Cows milked" value={String(s.cows)} note={`${s.entries} entries`} />
      </View>

      {choice === 'today' ? (
        <>
          <Heading>Today by session</Heading>
          {sessionTotals.map(({ session, cl }) => (
            <Text key={session} style={{ color: t.text, fontSize: 16 }}>
              {SESSION_LABELS[session]}: {cl ? L(cl) : 'not recorded yet'}
            </Text>
          ))}
        </>
      ) : custom.from <= custom.to || choice !== 'custom' ? (
        <BarChart
          title="Daily herd production"
          bars={dailyTotals(milk, range.from, to)
            .slice(-62) // keep bars legible on a phone; longer ranges show the last two months
            .map((d) => ({ key: d.date, label: dayLabel(d.date), short: String(Number(d.date.slice(8))), value: d.cl, missing: !d.recorded }))}
          format={L}
        />
      ) : null}

      <Heading>Production alerts</Heading>
      <Text style={{ color: t.textMuted, fontSize: 14 }}>
        A cow is flagged when her average over the last {rule.recent_days} days (to yesterday) is at least {rule.threshold_pct}% below the {rule.baseline_days} days before. Change this in Profile and settings.
      </Text>
      {declines.length === 0 ? (
        <Text style={{ color: t.text, fontSize: 16 }}>No cows flagged.</Text>
      ) : (
        declines.map(({ a, d }) =>
          d.state === 'decline' ? (
            <Pressable
              key={a.id}
              accessibilityRole="button"
              onPress={() => router.push({ pathname: '/animal/[id]', params: { id: a.id } })}
              style={{ minHeight: minTouch, justifyContent: 'center', borderLeftWidth: 4, borderLeftColor: t.danger, paddingLeft: spacing.md }}
            >
              <Text style={{ color: t.text, fontSize: 16 }}>⚠ {displayName(a)}: down {Math.abs(d.changePct)}%</Text>
              <Text style={{ color: t.textMuted, fontSize: 14 }}>
                {L(d.recentAvgCl)}/day vs {L(d.baselineAvgCl)}/day before
              </Text>
            </Pressable>
          ) : null,
        )
      )}

      {yields.length ? (
        <>
          <Heading>Highest and lowest producers</Heading>
          {high.map((y) => (
            <Text key={`h-${y.cattle_id}`} style={{ color: t.text, fontSize: 16 }}>
              ▲ {name.get(y.cattle_id) ?? 'Unknown'}: {L(y.avgCl)}/day over {y.days} day{y.days === 1 ? '' : 's'}
            </Text>
          ))}
          {low.map((y) => (
            <Text key={`l-${y.cattle_id}`} style={{ color: t.text, fontSize: 16 }}>
              ▼ {name.get(y.cattle_id) ?? 'Unknown'}: {L(y.avgCl)}/day over {y.days} day{y.days === 1 ? '' : 's'}
            </Text>
          ))}

          <Heading>By breed</Heading>
          {byBreed.map((b) => (
            <Text key={b.breed_id ?? 'none'} style={{ color: t.text, fontSize: 16 }}>
              {breeds.find((x) => x.id === b.breed_id)?.name ?? 'Breed not set'}: {L(b.totalCl)} · {L(b.avgPerCowDayCl)} per cow per day · {b.cows} cow{b.cows === 1 ? '' : 's'}
            </Text>
          ))}

          <Heading>By cow</Heading>
          {yields.map((y) => (
            <Pressable
              key={y.cattle_id}
              accessibilityRole="button"
              onPress={() => router.push({ pathname: '/animal/[id]', params: { id: y.cattle_id } })}
              style={{ minHeight: minTouch, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: t.border }}
            >
              <Text style={{ color: t.text, fontSize: 16, flex: 1 }}>{name.get(y.cattle_id) ?? 'Unknown'}</Text>
              <Text style={{ color: t.text, fontSize: 16, fontVariant: ['tabular-nums'] }}>
                {L(y.totalCl)} · {L(y.avgCl)}/day
              </Text>
            </Pressable>
          ))}
        </>
      ) : (
        <Notice>No milk recorded in this period.</Notice>
      )}
    </ScrollView>
  );
}
