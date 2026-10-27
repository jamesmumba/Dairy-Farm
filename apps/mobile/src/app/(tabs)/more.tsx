import { type Href, router } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useAuth } from '../../state/auth';
import { SyncStatus } from '../../ui/SyncStatus';
import { minTouch, spacing, useTheme } from '../../ui/theme';

const ITEMS: { label: string; hint: string; href?: Href }[] = [
  { label: 'Profile and settings', hint: 'Name, farm, currency, reminders', href: '/settings' },
  { label: 'Security', hint: 'App lock, password, sign out', href: '/security' },
  { label: 'Breeds', hint: 'Add or hide breeds', href: '/breeds' },
  { label: 'Sync issues', hint: 'Changes your account did not accept', href: '/sync-issues' },
  { label: 'Reminders', hint: 'Due, overdue and withdrawal notices', href: '/reminders' },
  { label: 'Audit history', hint: 'Corrections, voids, price changes and adjustments', href: '/audit' },
  { label: 'Reports and exports', hint: 'Herd, milk, health, breeding, vaccination, money; CSV and PDF', href: '/reports' },
  { label: 'Delete account', hint: 'Request deletion of your account and records', href: '/delete-account' },
];

export default function More() {
  const t = useTheme();
  const { account } = useAuth();
  return (
    <ScrollView style={{ backgroundColor: t.background }} contentContainerStyle={{ padding: spacing.md, gap: spacing.sm }}>
      <Text accessibilityRole="header" style={{ color: t.text, fontSize: 24, fontWeight: '700' }}>
        {account?.farm_name || 'More'}
      </Text>
      <SyncStatus />
      {ITEMS.map(({ label, hint, href }) => (
        <Pressable
          key={label}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityHint={hint}
          accessibilityState={{ disabled: !href }}
          disabled={!href}
          onPress={() => href && router.push(href)}
          style={{ minHeight: minTouch + 8, justifyContent: 'center', paddingHorizontal: spacing.md, borderBottomWidth: 1, borderBottomColor: t.border }}
        >
          <View style={{ opacity: href ? 1 : 0.6 }}>
            <Text style={{ color: t.text, fontSize: 17 }}>{label}</Text>
            <Text style={{ color: t.textMuted, fontSize: 14 }}>{hint}</Text>
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}
