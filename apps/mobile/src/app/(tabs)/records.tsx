import { router } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { summarize } from '../../production/calc';
import { L } from '../../production/format';
import { listMilk } from '../../production/repo';
import { useLocal } from '../../sync/store';
import { toDateString } from '../../ui/DateField';
import { IconBadge, ListGroup, ListRow, SectionHeader } from '../../ui/kit';
import { radius, shadow, spacing, useTheme } from '../../ui/theme';

const care = (kind: string) => ({ pathname: '/care/[kind]/new', params: { kind } }) as const;

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
        accessibilityLabel={`Milking round. Today so far ${L(todaySummary.totalCl)}`}
        accessibilityHint="Enter litres for every cow in one session"
        onPress={() => router.push('/milk/round')}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radius.card + 4, backgroundColor: t.hero, opacity: pressed ? 0.9 : 1, ...shadow })}
      >
        <IconBadge icon="water-outline" size={48} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: t.onHero, fontSize: 20, fontWeight: '600' }}>Milking round</Text>
          <Text style={{ color: t.heroMuted, fontSize: 14 }}>Today so far: {L(todaySummary.totalCl)}</Text>
        </View>
      </Pressable>
      <ListGroup>
        <ListRow icon="water-plus-outline" title="One milk entry" href="/milk/new" />
        <ListRow icon="chart-line" title="Production" subtitle="Totals and trends" href="/production" />
      </ListGroup>

      <SectionHeader title="Health" action="Notifications" onAction={() => router.push('/reminders')} />
      <ListGroup>
        <ListRow icon="stethoscope" title="Health concern" href={care('health')} />
        <ListRow icon="pill" title="Treatment" subtitle="Includes milk withdrawal" href={care('treatment')} />
        <ListRow icon="medical-bag" title="Vet visit" href={care('vet-visit')} />
        <ListRow icon="needle" title="Vaccination" subtitle="One animal or a group" href={care('vaccination')} />
      </ListGroup>

      <SectionHeader title="Breeding" />
      <ListGroup>
        <ListRow icon="heart-outline" title="Heat or breeding" href={care('breeding')} />
        <ListRow icon="heart-pulse" title="Pregnancy check" href={care('pregnancy-check')} />
        <ListRow icon="cow" title="Calving" href={care('calving')} />
      </ListGroup>

      <SectionHeader title="Other" />
      <ListGroup>
        <ListRow icon="account-group" title="Group vaccination" href="/care/vaccination-group" />
        <ListRow icon="calendar-check" title="Vaccination schedules" href="/care/schedules" />
        <ListRow icon="cup-outline" title="Milk use" subtitle="Home use, calves, spoilage" href={{ pathname: '/stock/new', params: { kind: 'farm_consumption' } }} />
        <ListRow icon="receipt" title="Farm expense" href="/expenses/new" />
      </ListGroup>
    </ScrollView>
  );
}
