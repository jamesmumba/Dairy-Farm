import { router } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';
import { money, toCents } from '../../finance/calc';
import { CATEGORY_LABELS } from '../../finance/model';
import { useFinance } from '../../finance/useFinance';
import { formatDate } from '../../lib/dates';
import { periodRange } from '../../production/calc';
import { getRecord } from '../../sync/store';
import { Button } from '../../ui/form';
import { Card, ListGroup, ListRow } from '../../ui/kit';
import { spacing, type, useTheme } from '../../ui/theme';

export default function Expenses() {
  const t = useTheme();
  const f = useFinance();
  const month = periodRange('month', f.today);
  const list = [...f.expenses].sort((a, b) => b.expense_date.localeCompare(a.expense_date));
  const monthTotals = Object.entries(
    f.expenses
      .filter((e) => e.status === 'active' && e.expense_date >= month.from && e.expense_date <= month.to)
      .reduce<Record<string, number>>((acc, e) => ({ ...acc, [e.currency]: (acc[e.currency] ?? 0) + toCents(e.amount) }), {}),
  );

  return (
    <ScrollView style={{ backgroundColor: t.background }} contentContainerStyle={{ padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl }}>
      <Card gap={2}>
        <Text style={{ color: t.textMuted, ...type.secondary }}>Spent this month</Text>
        <Text style={{ color: t.text, ...type.display, fontVariant: ['tabular-nums'] }}>{monthTotals.length ? monthTotals.map(([cur, c]) => money(c, cur)).join(' · ') : 'Nothing yet'}</Text>
      </Card>
      <Button label="Add an expense" onPress={() => router.push('/expenses/new')} />
      {list.length ? (
        <ListGroup>
          {list.map((e) => {
            const voided = e.status === 'voided';
            const waiting = (getRecord('farm_expenses', e.id)?.sync_state ?? 'synced') !== 'synced';
            return (
              <View key={e.id} style={{ opacity: voided ? 0.55 : 1 }}>
                <ListRow
                  icon="receipt"
                  tint={e.payment_status !== 'paid' && !voided ? 'straw' : 'green'}
                  title={`${CATEGORY_LABELS[e.category]}${e.payee ? ` · ${e.payee}` : ''}`}
                  subtitle={[
                    formatDate(e.expense_date),
                    voided ? 'voided' : e.payment_status === 'unpaid' ? 'not paid yet' : e.payment_status === 'partially_paid' ? 'partly paid' : null,
                    waiting ? 'waiting to sync' : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  value={money(toCents(e.amount), e.currency)}
                  href={{ pathname: '/expenses/[id]', params: { id: e.id } }}
                />
              </View>
            );
          })}
        </ListGroup>
      ) : null}
    </ScrollView>
  );
}
