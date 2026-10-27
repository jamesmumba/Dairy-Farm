import { type Href, router } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { summarize } from '../../production/calc';
import { L } from '../../production/format';
import { listMilk } from '../../production/repo';
import { useLocal } from '../../sync/store';
import { toDateString } from '../../ui/DateField';
import { ActionTile, IconBadge, type IconName, ListGroup, ListRow, SectionHeader, type Tint } from '../../ui/kit';
import { radius, shadow, spacing, useTheme } from '../../ui/theme';

const CARE: { label: string; hint: string; icon: IconName; tint: Tint; href: Href }[] = [
  { label: 'Health concern', hint: 'Symptoms, suspected or confirmed condition, follow-up', icon: 'stethoscope', tint: 'red', href: { pathname: '/care/[kind]/new', params: { kind: 'health' } } },
  { label: 'Treatment', hint: 'Medicine as instructed, milk withdrawal', icon: 'pill', tint: 'red', href: { pathname: '/care/[kind]/new', params: { kind: 'treatment' } } },
  { label: 'Vet visit', hint: 'Who came, why, findings', icon: 'medical-bag', tint: 'sky', href: { pathname: '/care/[kind]/new', params: { kind: 'vet-visit' } } },
  { label: 'Heat or breeding', hint: 'Heat, natural mating, insemination', icon: 'heart-outline', tint: 'straw', href: { pathname: '/care/[kind]/new', params: { kind: 'breeding' } } },
  { label: 'Pregnancy check', hint: 'Examination result', icon: 'heart-pulse', tint: 'straw', href: { pathname: '/care/[kind]/new', params: { kind: 'pregnancy-check' } } },
  { label: 'Calving', hint: 'Outcome, register the calf', icon: 'cow', tint: 'straw', href: { pathname: '/care/[kind]/new', params: { kind: 'calving' } } },
  { label: 'Vaccination', hint: 'One animal', icon: 'needle', tint: 'green', href: { pathname: '/care/[kind]/new', params: { kind: 'vaccination' } } },
  { label: 'Group vaccination', hint: 'Several animals at once', icon: 'account-group', tint: 'green', href: '/care/vaccination-group' },
];

export default function Records() {
  const t = useTheme();
  const today = toDateString(new Date());
  const milk = useLocal(() => listMilk().map((m) => m.data));
  const todaySummary = summarize(milk, today, today);

  return (
    <ScrollView style={{ backgroundColor: t.background }} contentContainerStyle={{ padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xl }}>
      {/* The most frequent job on a dairy farm gets the biggest target. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Milking round. Today so far ${L(todaySummary.totalCl)} from ${todaySummary.cows} cows`}
        accessibilityHint="Enter litres for every cow in one session"
        onPress={() => router.push('/milk/round')}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radius.card + 4, backgroundColor: t.primary, opacity: pressed ? 0.9 : 1, ...shadow })}
      >
        <IconBadge icon="water-outline" tint="green" size={52} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: t.onPrimary, fontSize: 20, fontWeight: '600' }}>Milking round</Text>
          <Text style={{ color: t.primarySoft, fontSize: 14 }}>
            Today so far: {L(todaySummary.totalCl)} from {todaySummary.cows} cow{todaySummary.cows === 1 ? '' : 's'}
          </Text>
        </View>
      </Pressable>
      <ListGroup>
        <ListRow icon="water-plus-outline" tint="sky" title="Single milk entry" subtitle="One cow, one session" href="/milk/new" />
        <ListRow icon="chart-line" tint="sky" title="Production summary" subtitle="Totals, averages, trends and alerts" href="/production" />
      </ListGroup>

      <SectionHeader title="Animal care" action="Reminders" onAction={() => router.push('/reminders')} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {CARE.map((c) => (
          <ActionTile key={c.label} icon={c.icon} tint={c.tint} label={c.label} hint={c.hint} href={c.href} />
        ))}
      </View>
      <ListGroup>
        <ListRow icon="calendar-check" title="Vaccination schedules" subtitle="From your vet’s guidance" href="/care/schedules" />
      </ListGroup>

      <SectionHeader title="Milk use and costs" />
      <ListGroup>
        <ListRow icon="cup-outline" tint="sky" title="Milk use" subtitle="Home use, calves, spoilage, gifts" href={{ pathname: '/stock/new', params: { kind: 'farm_consumption' } }} />
        <ListRow icon="receipt" tint="straw" title="Farm expense" subtitle="Feed, vet, transport and other costs" href="/expenses/new" />
      </ListGroup>
    </ScrollView>
  );
}
