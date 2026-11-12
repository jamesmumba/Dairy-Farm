import type { SyncState } from '../sync/store';
import { IconLine } from './kit';
import { type, useTheme } from './theme';

/** Per-record save state, in words (never colour alone). Nothing is shown once synced. */
export function SyncBadge({ state }: { state: SyncState }) {
  const t = useTheme();
  if (state === 'synced') return null;
  return state === 'pending' ? (
    <IconLine icon="sync" color={t.textMuted} textStyle={type.caption}>
      Saved on this phone · waiting to sync
    </IconLine>
  ) : (
    <IconLine icon="alert-circle-outline" color={t.danger} textStyle={type.caption}>
      Not saved to your account · needs attention
    </IconLine>
  );
}
