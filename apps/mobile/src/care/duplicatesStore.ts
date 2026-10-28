// Pairs the farmer has looked at and said are different (two real customers called Mrs Phiri), kept on
// this phone so they are not raised again.

import { useSyncExternalStore } from 'react';
import { getJson, setJson } from '../lib/localDb';

const KEY = 'duplicates.dismissed';
const listeners = new Set<() => void>();
let dismissed = new Set<string>(getJson<string[]>(KEY) ?? []);

export function useDismissedDuplicates(): Set<string> {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => dismissed,
  );
}

export function dismissDuplicate(key: string) {
  dismissed = new Set([...dismissed, key]);
  setJson(KEY, [...dismissed]);
  listeners.forEach((l) => l());
}
