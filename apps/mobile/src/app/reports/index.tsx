import { ScrollView, Text } from 'react-native';
import { REPORTS } from '../../reports/build';
import { type IconName, ListGroup, ListRow } from '../../ui/kit';
import { spacing, useTheme } from '../../ui/theme';

const ABOUT: Record<string, { icon: IconName; about: string }> = {
  herd: { icon: 'cow', about: 'Animals, breeds, in milk, pregnancies' },
  production: { icon: 'water-outline', about: 'Milk by day, cow and breed' },
  health: { icon: 'stethoscope', about: 'Treatments, withdrawals, follow-ups' },
  reproduction: { icon: 'heart-pulse', about: 'Breeding, pregnancy checks, calvings' },
  vaccination: { icon: 'needle', about: 'Given, due and overdue' },
  finance: { icon: 'cash-multiple', about: 'Sales, payments, expenses, stock' },
};

export default function Reports() {
  const t = useTheme();
  return (
    <ScrollView style={{ backgroundColor: t.background }} contentContainerStyle={{ padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl }}>
      <ListGroup>
        {REPORTS.map((r) => (
          <ListRow key={r.id} icon={ABOUT[r.id]?.icon ?? 'file-chart-outline'} title={r.title} subtitle={ABOUT[r.id]?.about} href={{ pathname: '/reports/[id]', params: { id: r.id } }} />
        ))}
      </ListGroup>
      <Text style={{ color: t.textMuted, fontSize: 13 }}>Made from the records on this phone, so they work offline. Each can be shared as CSV or PDF.</Text>
    </ScrollView>
  );
}
