import { type Href, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { markSeen, needsAttention, useSeen } from '../care/inbox';
import { REMINDER_ICON } from '../care/reminderIcon';
import type { Reminder } from '../care/reminders';
import { useNotificationStatus, useReminders } from '../care/useReminders';
import { formatDate, formatDateTime } from '../lib/dates';
import { Notice } from '../ui/form';
import { ListGroup, ListRow, SectionHeader } from '../ui/kit';
import { useSyncRefresh } from '../ui/useSyncRefresh';
import { spacing, useTheme } from '../ui/theme';

// The in-app notifications inbox. Everything the app has flagged, worked out from the records on this
// phone: urgent things first, then today, then what is coming up. Opening it marks the items as read.

const SECTIONS: { title: string; match: (r: Reminder) => boolean }[] = [
  { title: 'Needs action', match: (r) => r.urgency === 'active' || r.urgency === 'overdue' },
  { title: 'Today', match: (r) => r.urgency === 'today' },
  { title: 'Coming up', match: (r) => r.urgency === 'upcoming' },
];

const tintOf = (r: Reminder) => (r.urgency === 'active' || r.urgency === 'overdue' ? 'red' : r.urgency === 'today' ? 'straw' : 'green') as 'red' | 'straw' | 'green';

const whenOf = (r: Reminder) =>
  r.kind === 'withdrawal' ? `Until ${formatDateTime(r.due)}` : ['sync_problem', 'production_decline', 'possible_duplicate', 'new_device', 'missing_milk'].includes(r.kind) ? null : `${r.urgency === 'overdue' ? 'Since ' : ''}${formatDate(r.due)}`;

export default function Notifications() {
  const t = useTheme();
  const refresh = useSyncRefresh();
  const { reminders, names } = useReminders();
  const status = useNotificationStatus();
  const seenNow = useSeen();
  // What was unread when the inbox opened stays marked as new while it is on screen.
  const [seenBefore] = useState(seenNow);

  useEffect(() => {
    markSeen(reminders.filter(needsAttention));
  }, [reminders]);

  const statusText =
    status.state === 'scheduled'
      ? `${status.count} phone notification${status.count === 1 ? '' : 's'} scheduled.`
      : status.state === 'denied'
        ? 'Phone notifications are turned off for this app in the phone settings. Everything still appears here.'
        : status.state === 'off'
          ? 'Phone notifications are turned off in Profile and settings › Reminders.'
          : 'No phone notifications scheduled.';

  return (
    <ScrollView refreshControl={<RefreshControl {...refresh} />} style={{ backgroundColor: t.background }} contentContainerStyle={{ padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xl }}>
      {reminders.length === 0 ? (
        <Notice tone="success" title="All clear">
          Nothing needs you right now. Withdrawals, vaccinations, pregnancy checks, heat watch, calvings, follow-ups, unpaid balances, milk drops, missing milk records and sync problems appear here.
        </Notice>
      ) : null}
      {SECTIONS.map(({ title, match }) => {
        const list = reminders.filter(match);
        if (!list.length) return null;
        return (
          <View key={title} style={{ gap: spacing.sm }}>
            <SectionHeader title={`${title} (${list.length})`} />
            <ListGroup>
              {list.map((r) => (
                <ListRow
                  key={r.key}
                  icon={REMINDER_ICON[r.kind]}
                  tint={tintOf(r)}
                  unread={needsAttention(r) && !seenBefore.has(r.key)}
                  title={`${r.cattleId ? `${names.get(r.cattleId) ?? 'Animal'}: ` : ''}${r.title}`}
                  subtitle={[whenOf(r), r.detail].filter(Boolean).join(' · ')}
                  onPress={() => router.push((r.href ?? { pathname: '/care/[kind]/[id]', params: { kind: r.record!.kind, id: r.record!.id } }) as Href)}
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
