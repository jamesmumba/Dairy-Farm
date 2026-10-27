import { router } from 'expo-router';
import { Pressable, ScrollView, Text } from 'react-native';
import { money, toCents } from '../../finance/calc';
import { CATEGORY_LABELS } from '../../finance/model';
import { useFinance } from '../../finance/useFinance';
import { formatDate } from '../../lib/dates';
import { periodRange } from '../../production/calc';
import { getRecord } from '../../sync/store';
import { Button } from '../../ui/form';
import { SyncBadge } from '../../ui/SyncBadge';
import { minTouch, spacing, useTheme } from '../../ui/theme';

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
    <ScrollView style={{ backgroundColor: t.background }} contentContainerStyle={{ padding: spacing.md, gap: spacing.sm }}>
      <Text style={{ color: t.text, fontSize: 18, fontWeight: '600' }}>
        This month: {monthTotals.length ? monthTotals.map(([cur, c]) => money(c, cur)).join(' · ') : 'no expenses'}
      </Text>
      <Button label="Add an expense" onPress={() => router.push('/expenses/new')} />
      {list.map((e) => (
        <Pressable
          key={e.id}
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/expenses/[id]', params: { id: e.id } })}
          style={{ minHeight: minTouch, justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: t.border, paddingVertical: 4, opacity: e.status === 'voided' ? 0.6 : 1 }}
        >
          <Text style={{ color: t.text, fontSize: 16, textDecorationLine: e.status === 'voided' ? 'line-through' : 'none' }}>
            {CATEGORY_LABELS[e.category]}: {money(toCents(e.amount), e.currency)}
            {e.payee ? ` · ${e.payee}` : ''}
          </Text>
          <Text style={{ color: t.textMuted, fontSize: 14 }}>
            {formatDate(e.expense_date)}
            {e.payment_status !== 'paid' ? ` · ${e.payment_status === 'unpaid' ? 'not paid yet' : 'partly paid'}` : ''}
            {e.receipt_path || e.local_receipt_uri ? ' · receipt' : ''}
            {e.status === 'voided' ? ' · voided' : ''}
          </Text>
          <SyncBadge state={getRecord('farm_expenses', e.id)?.sync_state ?? 'synced'} />
        </Pressable>
      ))}
    </ScrollView>
  );
}
