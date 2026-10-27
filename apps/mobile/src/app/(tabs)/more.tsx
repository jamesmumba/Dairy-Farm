import { ScrollView, Text, View } from 'react-native';
import { useAuth } from '../../state/auth';
import { Avatar, ListGroup, ListRow, SectionHeader } from '../../ui/kit';
import { radius, shadow, spacing, type, useTheme } from '../../ui/theme';

export default function More() {
  const t = useTheme();
  const { account } = useAuth();
  const farm = account?.farm_name || 'Your farm';
  return (
    <ScrollView style={{ backgroundColor: t.background }} contentContainerStyle={{ padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xl }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.card, backgroundColor: t.surface, ...shadow }}>
        <Avatar name={account?.display_name || farm} size={52} />
        <View style={{ flex: 1 }}>
          <Text accessibilityRole="header" style={{ color: t.text, ...type.sectionTitle }}>
            {farm}
          </Text>
          <Text style={{ color: t.textMuted, ...type.secondary }}>{[account?.display_name, account?.farm_location].filter(Boolean).join(' · ') || 'Add your farm details in settings'}</Text>
        </View>
      </View>

      <SectionHeader title="Farm records" />
      <ListGroup>
        <ListRow icon="file-chart-outline" title="Reports and exports" subtitle="Herd, milk, health, breeding, money; CSV and PDF" href="/reports" />
        <ListRow icon="bell-outline" tint="straw" title="Notifications" subtitle="Reminders, warnings and problems to fix" href="/reminders" />
        <ListRow icon="history" tint="sky" title="Audit history" subtitle="Corrections, voids, price changes and adjustments" href="/audit" />
        <ListRow icon="cow" title="Breeds" subtitle="Add or hide breeds" href="/breeds" />
      </ListGroup>

      <SectionHeader title="Account" />
      <ListGroup>
        <ListRow icon="cog-outline" title="Profile and settings" subtitle="Name, farm, currency, reminders" href="/settings" />
        <ListRow icon="shield-lock-outline" title="Security" subtitle="App lock, password, sign out" href="/security" />
        <ListRow icon="sync" tint="sky" title="Sync issues" subtitle="Changes your account did not accept" href="/sync-issues" />
      </ListGroup>

      <SectionHeader title="Your data" />
      <ListGroup>
        <ListRow icon="delete-outline" tint="red" title="Delete account" subtitle="Request deletion of your account and records" href="/delete-account" />
      </ListGroup>
    </ScrollView>
  );
}
