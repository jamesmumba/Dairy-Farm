import { useCallback, useState } from 'react';
import { runSync } from '../sync/engine';
import { useTheme } from './theme';

/**
 * Pull down to sync now: sends what this phone has and brings in what other phones recorded.
 * Spread into a RefreshControl: `refreshControl={<RefreshControl {...useSyncRefresh()} />}`.
 */
export function useSyncRefresh() {
  const t = useTheme();
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await runSync();
    } finally {
      setRefreshing(false);
    }
  }, []);
  return { refreshing, onRefresh, tintColor: t.primary, colors: [t.primary], progressBackgroundColor: t.surface, title: 'Checking for changes' };
}
