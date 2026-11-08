import { Text } from 'react-native';
import type { SyncState } from '../sync/store';
import { type, useTheme } from './theme';

/** Per-record save state, in words (never colour alone). Nothing is shown once synced. */
export function SyncBadge({ state }: { state: SyncState }) {
  const t = useTheme();
  if (state === 'synced') return null;
  return state === 'pending' ? (
    <Text style={{ color: t.textMuted, ...type.caption }}>↻ Saved on this phone · waiting to sync</Text>
  ) : (
    <Text style={{ color: t.danger, ...type.caption }}>⚠ Not saved to your account · needs attention</Text>
  );
}
