import { router } from 'expo-router';
import { Pressable, ScrollView, Text } from 'react-native';
import { REPORTS } from '../../reports/build';
import { minTouch, spacing, useTheme } from '../../ui/theme';

const ABOUT: Record<string, string> = {
  herd: 'Animals on the farm, breeds, cows in milk, pregnancies, animals that left',
  production: 'Totals by day, cow and breed, averages, high and low producers, declines',
  health: 'Treatments, milk withdrawal, health concerns, follow-ups and outcomes',
  reproduction: 'Breeding attempts, pregnancy checks, pregnancies, calvings, calving intervals',
  vaccination: 'Doses given, due and overdue, coverage and compliance',
  finance: 'Sales, payments, balances, expenses, operating result and stock',
};

export default function Reports() {
  const t = useTheme();
  return (
    <ScrollView style={{ backgroundColor: t.background }} contentContainerStyle={{ padding: spacing.md, gap: spacing.sm }}>
      <Text style={{ color: t.textMuted, fontSize: 15 }}>Reports are calculated from the records on this phone and work offline. Each can be shared as a CSV or PDF file.</Text>
      {REPORTS.map((r) => (
        <Pressable
          key={r.id}
          accessibilityRole="button"
          accessibilityHint={ABOUT[r.id]}
          onPress={() => router.push({ pathname: '/reports/[id]', params: { id: r.id } })}
          style={{ minHeight: minTouch + 8, justifyContent: 'center', padding: spacing.md, borderRadius: 8, backgroundColor: t.surface }}
        >
          <Text style={{ color: t.text, fontSize: 17, fontWeight: '600' }}>{r.title}</Text>
          <Text style={{ color: t.textMuted, fontSize: 14 }}>{ABOUT[r.id]}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}
