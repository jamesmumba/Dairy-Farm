import { Pressable, Text } from 'react-native';
import { formatDate, toDateString } from '../lib/dates';
import { runSync, useSyncStatus } from '../sync/engine';
import { minTouch, radius, shadow, spacing, useTheme } from './theme';
import { useOpenOrBack } from './useOpenOrBack';

function ago(iso: string) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`;
  return formatDate(toDateString(new Date(iso)));
}

/** Tells the farmer whether what they see is up to date. Tap to sync, or to review problems. */
export function SyncStatus() {
  const t = useTheme();
  const open = useOpenOrBack();
  const s = useSyncStatus();
  const last = s.lastSyncedAt ? `last synced ${ago(s.lastSyncedAt)}` : 'not synced yet';
  const waiting = s.pending ? ` · ${s.pending} saved on this phone, waiting to sync` : '';

  const { icon, text, color } =
    s.failed > 0 || s.state === 'attention'
      ? { icon: '⚠', text: s.message ?? 'Sync needs attention', color: t.danger }
      : s.state === 'syncing'
        ? { icon: '↻', text: s.photo ? `Uploading photo ${Math.round(s.photo.fraction * 100)}%` : 'Syncing…', color: t.textMuted }
        : s.state === 'offline'
          ? { icon: '○', text: `Offline · showing data saved on this phone · ${last}${waiting}`, color: t.textMuted }
          : { icon: s.pending ? '↻' : '✓', text: `${s.pending ? 'Waiting to sync' : 'Synced'} · ${last}${waiting}`, color: s.pending ? t.textMuted : t.primary };

  const reviewing = s.failed > 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={text}
      accessibilityHint={reviewing ? 'Opens the list of changes that need attention' : 'Syncs now'}
      onPress={() => (reviewing ? open('/sync-issues') : void runSync())}
      style={{ minHeight: minTouch, justifyContent: 'center', paddingHorizontal: spacing.md, backgroundColor: t.surface, borderRadius: radius.card, ...shadow }}
    >
      <Text style={{ color, fontSize: 15 }}>
        {icon} {text}
      </Text>
    </Pressable>
  );
}
