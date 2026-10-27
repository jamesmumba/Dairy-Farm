import { type Href, router } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { summarize } from '../../production/calc';
import { L } from '../../production/format';
import { listMilk } from '../../production/repo';
import { useLocal } from '../../sync/store';
import { toDateString } from '../../ui/DateField';
import { Button } from '../../ui/form';
import { minTouch, radius, spacing, useTheme } from '../../ui/theme';

const CARE_LINKS: { label: string; hint: string; href: Href }[] = [
  { label: 'Health concern', hint: 'Symptoms, suspected or confirmed condition, follow-up', href: { pathname: '/care/[kind]/new', params: { kind: 'health' } } },
  { label: 'Treatment', hint: 'Medicine as instructed, milk withdrawal', href: { pathname: '/care/[kind]/new', params: { kind: 'treatment' } } },
  { label: 'Vet visit', hint: 'Who came, why, findings', href: { pathname: '/care/[kind]/new', params: { kind: 'vet-visit' } } },
  { label: 'Heat or breeding', hint: 'Heat, natural mating, insemination', href: { pathname: '/care/[kind]/new', params: { kind: 'breeding' } } },
  { label: 'Pregnancy check', hint: 'Examination result', href: { pathname: '/care/[kind]/new', params: { kind: 'pregnancy-check' } } },
  { label: 'Calving', hint: 'Outcome, register the calf', href: { pathname: '/care/[kind]/new', params: { kind: 'calving' } } },
  { label: 'Vaccination', hint: 'One animal', href: { pathname: '/care/[kind]/new', params: { kind: 'vaccination' } } },
  { label: 'Group vaccination', hint: 'Several animals at once', href: '/care/vaccination-group' },
  { label: 'Vaccination schedules', hint: 'From your vet’s guidance', href: '/care/schedules' },
  { label: 'Reminders', hint: 'Due, overdue and withdrawal notices', href: '/reminders' },
];

const OTHER_LINKS: { label: string; hint: string; href: Href }[] = [
  { label: 'Milk use', hint: 'Home use, calves, spoilage, gifts', href: { pathname: '/stock/new', params: { kind: 'farm_consumption' } } },
  { label: 'Farm expense', hint: 'Feed, vet, transport and other costs', href: '/expenses/new' },
];


export default function Records() {
  const t = useTheme();
  const today = toDateString(new Date());
  const milk = useLocal(() => listMilk().map((m) => m.data));
  const todaySummary = summarize(milk, today, today);

  const link = (label: string, hint: string, href: Href) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      onPress={() => router.push(href)}
      style={{ minHeight: minTouch + 8, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radius.card, borderWidth: 1, borderColor: t.border, backgroundColor: t.surface }}
    >
      <Text style={{ color: t.text, fontSize: 17 }}>{label}</Text>
      <Text style={{ color: t.textMuted, fontSize: 14 }}>{hint}</Text>
    </Pressable>
  );

  return (
    <ScrollView style={{ backgroundColor: t.background }} contentContainerStyle={{ padding: spacing.md, gap: spacing.sm }}>
      <Text accessibilityRole="header" style={{ color: t.text, fontSize: 20, fontWeight: '700', marginTop: spacing.sm }}>
        Milk
      </Text>
      <Text style={{ color: t.textMuted, fontSize: 15 }}>
        Today so far: {L(todaySummary.totalCl)} from {todaySummary.cows} cow{todaySummary.cows === 1 ? '' : 's'}
      </Text>
      <Button label="Milking round" hint="Enter litres for every cow in one session" onPress={() => router.push('/milk/round')} />
      {link('Single milk entry', 'One cow, one session', '/milk/new')}
      {link('Production summary', 'Totals, averages, trends and alerts', '/production')}

      <Text accessibilityRole="header" style={{ color: t.text, fontSize: 20, fontWeight: '700', marginTop: spacing.md }}>
        Animal care
      </Text>
      {CARE_LINKS.map((l) => (
        <View key={l.label}>{link(l.label, l.hint, l.href)}</View>
      ))}

      <Text accessibilityRole="header" style={{ color: t.text, fontSize: 20, fontWeight: '700', marginTop: spacing.md }}>
        Milk use and costs
      </Text>
      {OTHER_LINKS.map((l) => (
        <View key={l.label}>{link(l.label, l.hint, l.href)}</View>
      ))}
    </ScrollView>
  );
}
