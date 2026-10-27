import { type Href, router } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { Reminder, Urgency } from '../care/reminders';
import { useNotificationStatus, useReminders } from '../care/useReminders';
import { formatDate, formatDateTime } from '../lib/dates';
import { Notice } from '../ui/form';
import { minTouch, radius, spacing, useTheme } from '../ui/theme';

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

  const item = (r: Reminder) => (
    <Pressable
      key={r.key}
      accessibilityRole="button"
      accessibilityLabel={`${r.cattleId ? `${names.get(r.cattleId) ?? 'Animal'}: ` : ''}${r.title}. ${r.detail}`}
      onPress={() => router.push((r.href ?? { pathname: '/care/[kind]/[id]', params: { kind: r.record!.kind, id: r.record!.id } }) as Href)}
      style={{
        minHeight: minTouch,
        padding: spacing.md,
        borderRadius: radius.control,
        backgroundColor: t.surface,
        borderLeftWidth: 4,
        borderLeftColor: r.urgency === 'active' || r.urgency === 'overdue' ? t.danger : t.primary,
        gap: 2,
      }}
    >
      <Text style={{ color: t.text, fontSize: 16, fontWeight: '600' }}>
        {r.urgency === 'overdue' || r.urgency === 'active' ? '⚠ ' : ''}
        {r.cattleId ? `${names.get(r.cattleId) ?? 'Animal'}: ` : ''}
        {r.title}
      </Text>
      <Text style={{ color: t.textMuted, fontSize: 15 }}>{r.detail}</Text>
      <Text style={{ color: t.textMuted, fontSize: 14 }}>{r.kind === 'withdrawal' ? `Until ${formatDateTime(r.due)}` : formatDate(r.due)}</Text>
    </Pressable>
  );

  return (
    <ScrollView style={{ backgroundColor: t.background }} contentContainerStyle={{ padding: spacing.md, gap: spacing.sm }}>
      <Text style={{ color: t.textMuted, fontSize: 14 }}>{statusText} Calculated from records on this phone.</Text>
      {reminders.length === 0 ? <Notice>Nothing due. Withdrawals, vaccinations, pregnancy checks, calvings and follow-ups will appear here.</Notice> : null}
      {SECTIONS.map(({ urgency, title }) => {
        const list = reminders.filter((r) => r.urgency === urgency);
        if (!list.length) return null;
        return (
          <View key={urgency} style={{ gap: spacing.sm }}>
            <Text accessibilityRole="header" style={{ color: t.text, fontSize: 20, fontWeight: '700', marginTop: spacing.md }}>
              {title} ({list.length})
            </Text>
            {list.map(item)}
          </View>
        );
      })}
    </ScrollView>
  );
}
