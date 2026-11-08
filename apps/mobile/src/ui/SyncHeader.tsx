import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Pressable, Text, View } from 'react-native';
import { runSync, useSyncStatus } from '../sync/engine';
import type { IconName } from './kit';
import { minTouch, type, useTheme } from './theme';
import { useOpenOrBack } from './useOpenOrBack';

/**
 * Compact sync state for every screen header: a cloud icon whose shape and colour change, plus a count of
 * changes waiting. Small enough for any header; the full words are the accessibility label and on Home.
 * Tap to sync now, or to review changes that need attention.
 */
export function SyncHeader() {
  const t = useTheme();
  const open = useOpenOrBack();
  const s = useSyncStatus();
  const attention = s.failed > 0 || s.state === 'attention';

  const { icon, full, fg, bg }: { icon: IconName; full: string; fg: string; bg: string } = attention
    ? { icon: 'cloud-alert', full: s.message ?? 'Sync needs attention', fg: t.danger, bg: t.dangerSoft }
    : s.state === 'syncing'
      ? { icon: 'cloud-sync-outline', full: 'Syncing', fg: t.info, bg: t.infoSoft }
      : s.state === 'offline'
        ? { icon: 'cloud-off-outline', full: `Offline. ${s.pending} changes saved on this phone, waiting to sync`, fg: t.attention, bg: t.attentionSoft }
        : s.pending
          ? { icon: 'cloud-upload-outline', full: `${s.pending} changes saved on this phone, waiting to sync`, fg: t.attention, bg: t.attentionSoft }
          : { icon: 'cloud-check-outline', full: 'All changes synced', fg: t.primary, bg: t.primarySoft };
  const count = attention ? s.failed : s.pending;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={full}
      accessibilityHint={attention ? 'Opens the list of changes that need attention' : 'Syncs now'}
      onPress={() => (s.failed > 0 ? open('/sync-issues') : void runSync())}
      hitSlop={8}
      style={{ minWidth: minTouch - 8, height: 36, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: 18, backgroundColor: bg }}
    >
      <MaterialCommunityIcons name={icon} size={20} color={fg} />
      {count > 0 ? (
        <View>
          <Text maxFontSizeMultiplier={1.3} style={{ color: fg, ...type.secondary, fontWeight: '700' }}>
            {count}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}
