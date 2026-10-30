// Reminders the farmer has answered with "nothing to record" (no heat seen), kept on this phone so
// they stop showing and notifying. Keyed by the reminder key, so a new mating starts a new watch.

import { useSyncExternalStore } from 'react';
import { getJson, setJson } from '../lib/localDb';

const KEY = 'reminders.hidden';
const listeners = new Set<() => void>();
let hidden = new Set<string>(getJson<string[]>(KEY) ?? []);

export function useHiddenReminders(): Set<string> {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => hidden,
  );
}

export function hideReminder(key: string) {
  hidden = new Set([...hidden, key]);
  setJson(KEY, [...hidden]);
  listeners.forEach((l) => l());
}
