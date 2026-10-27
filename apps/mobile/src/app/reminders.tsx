import type { Href } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';
import type { Reminder, Urgency } from '../care/reminders';
import { useNotificationStatus, useReminders } from '../care/useReminders';
import { formatDate, formatDateTime } from '../lib/dates';
import { Notice } from '../ui/form';
import { type IconName, ListGroup, ListRow, SectionHeader } from '../ui/kit';
import { spacing, useTheme } from '../ui/theme';

const SECTIONS: { urgency: Urgency; title: string }[] = [
  { urgency: 'active', title: 'Milk withdrawal in force' },
  { urgency: 'overdue', title: 'Overdue' },
  { urgency: 'today', title: 'Today' },
  { urgency: 'upcoming', title: 'Coming up' },
];

export default function Reminders() {
  const t = useTheme();
  const { reminders, names } = useReminders();
  const status = useNotificationStatus();

  const statusText =
    status.state === 'scheduled'
      ? `${status.count} notification${status.count === 1 ? '' : 's'} scheduled on this phone.`
      : status.state === 'denied'
        ? 'Notifications are turned off for this app in the phone settings. Reminders still appear here.'
        : status.state === 'off'
          ? 'All reminder notifications are turned off in Profile and settings.'
          : 'No notifications scheduled.';

  const ICON: Record<Reminder['kind'], IconName> = {
    withdrawal: 'water-off-outline',
    withdrawal_clearance: 'water-check-outline',
    vaccination: 'needle',
    pregnancy_check: 'heart-pulse',
    expected_calving: 'cow',
    health_follow_up: 'stethoscope',
    unpaid_balance: 'account-cash-outline',
    stock_discrepancy: 'warehouse',
  };

  return (
    <ScrollView style={{ backgroundColor: t.background }} contentContainerStyle={{ padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xl }}>
      {reminders.length === 0 ? <Notice>Nothing due. Withdrawals, vaccinations, pregnancy checks, calvings and follow-ups will appear here.</Notice> : null}
      {SECTIONS.map(({ urgency, title }) => {
        const list = reminders.filter((r) => r.urgency === urgency);
        if (!list.length) return null;
        const urgent = urgency === 'active' || urgency === 'overdue';
        return (
          <View key={urgency} style={{ gap: spacing.sm }}>
            <SectionHeader title={`${title} (${list.length})`} />
            <ListGroup>
              {list.map((r) => (
                <ListRow
                  key={r.key}
                  icon={ICON[r.kind]}
                  tint={urgent ? 'red' : urgency === 'today' ? 'straw' : 'green'}
                  title={`${r.cattleId ? `${names.get(r.cattleId) ?? 'Animal'}: ` : ''}${r.title}`}
                  subtitle={`${r.kind === 'withdrawal' ? `Until ${formatDateTime(r.due)}` : formatDate(r.due)}${r.detail ? ` · ${r.detail}` : ''}`}
                  href={(r.href ?? { pathname: '/care/[kind]/[id]', params: { kind: r.record!.kind, id: r.record!.id } }) as Href}
                />
              ))}
            </ListGroup>
          </View>
        );
      })}
      <Text style={{ color: t.textMuted, fontSize: 13, marginTop: spacing.sm }}>{statusText}</Text>
    </ScrollView>
  );
}
