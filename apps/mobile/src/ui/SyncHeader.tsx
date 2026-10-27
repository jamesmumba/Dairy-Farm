import { router } from 'expo-router';
import { Pressable, Text } from 'react-native';
import { runSync, useSyncStatus } from '../sync/engine';
import { minTouch, radius, spacing, useTheme } from './theme';

/**
 * Compact sync state for every screen header: icon and a short word, never colour alone.
 * Tap to sync now, or to review changes that need attention. Home also shows the full SyncStatus.
 */
export function SyncHeader() {
  const t = useTheme();
  const s = useSyncStatus();
  const attention = s.failed > 0 || s.state === 'attention';

  const { icon, short, full, fg, bg } = attention
    ? { icon: '⚠', short: 'Needs attention', full: s.message ?? 'Sync needs attention', fg: t.danger, bg: t.dangerSoft }
    : s.state === 'syncing'
      ? { icon: '↻', short: 'Syncing', full: 'Syncing', fg: t.info, bg: t.infoSoft }
      : s.state === 'offline'
        ? { icon: '○', short: s.pending ? `Offline · ${s.pending}` : 'Offline', full: `Offline. ${s.pending} changes saved on this phone, waiting to sync`, fg: t.attention, bg: t.attentionSoft }
        : s.pending
          ? { icon: '↻', short: `${s.pending} waiting`, full: `${s.pending} changes saved on this phone, waiting to sync`, fg: t.attention, bg: t.attentionSoft }
          : { icon: '✓', short: 'Synced', full: 'All changes synced', fg: t.primary, bg: t.primarySoft };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={full}
      accessibilityHint={attention ? 'Opens the list of changes that need attention' : 'Syncs now'}
      onPress={() => (s.failed > 0 ? router.push('/sync-issues') : void runSync())}
      hitSlop={8}
      style={{ minHeight: minTouch - 12, justifyContent: 'center', paddingHorizontal: spacing.sm + 2, marginHorizontal: spacing.sm, borderRadius: radius.chip, backgroundColor: bg }}
    >
      <Text numberOfLines={1} maxFontSizeMultiplier={1.4} style={{ color: fg, fontSize: 13, fontWeight: '600' }}>
        {icon} {short}
      </Text>
    </Pressable>
  );
}
