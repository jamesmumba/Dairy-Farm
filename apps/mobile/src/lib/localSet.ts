// A set of keys kept on this phone only (not synced), that screens can watch. For answers that are
// not records: a reminder answered with "nothing to record", a cow not milked at one milking.

import { useSyncExternalStore } from 'react';
import { getJson, setJson } from './localDb';

export function localSet(storageKey: string) {
  const listeners = new Set<() => void>();
  let keys = new Set<string>(getJson<string[]>(storageKey) ?? []);
  const write = (next: Set<string>) => {
    keys = next;
    setJson(storageKey, [...keys]);
    listeners.forEach((l) => l());
  };
  return {
    use: (): Set<string> =>
      useSyncExternalStore(
        (l) => {
          listeners.add(l);
          return () => listeners.delete(l);
        },
        () => keys,
      ),
    add: (key: string) => write(new Set([...keys, key])),
    remove: (key: string) => write(new Set([...keys].filter((k) => k !== key))),
  };
}
