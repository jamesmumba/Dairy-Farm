// The in-app notifications inbox: what is read is remembered on this phone only.

import { useSyncExternalStore } from 'react';
import { getJson, setJson } from '../lib/localDb';
import type { Reminder } from './reminders';

const KEY = 'inbox.seen';
const listeners = new Set<() => void>();
let seen = new Set<string>(getJson<string[]>(KEY) ?? []);

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Items that ask for attention now count as unread until the inbox has been opened; coming-up items never do. */
export const needsAttention = (r: Reminder) => r.urgency !== 'upcoming';

export function useSeen(): Set<string> {
  return useSyncExternalStore(subscribe, () => seen);
}

/** Marks these items read. Keys of items that no longer exist are dropped, so the list stays small. */
export function markSeen(items: Reminder[]) {
  const next = new Set(items.map((r) => r.key));
  if (next.size === seen.size && [...next].every((k) => seen.has(k))) return;
  seen = next;
  setJson(KEY, [...seen]);
  listeners.forEach((l) => l());
}

export function unreadCount(items: Reminder[], read: Set<string>) {
  return items.filter((r) => needsAttention(r) && !read.has(r.key)).length;
}
