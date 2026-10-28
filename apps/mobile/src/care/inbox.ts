// The in-app notifications inbox: which items have been read.
// Read marks are kept on this phone and shared through the account, so another phone signed in to the
// same account does not show them as new. Marks waiting to be sent survive restarts and go with each sync.

import { useSyncExternalStore } from 'react';
import { api } from '../lib/api';
import { getJson, setJson } from '../lib/localDb';
import type { Reminder } from './reminders';

const SEEN = 'inbox.seen'; // read on this phone (current items only)
const SHARED = 'inbox.shared'; // read on any phone, from the account
const PENDING = 'inbox.pending'; // read here, not yet sent

const listeners = new Set<() => void>();
let seen = new Set<string>(getJson<string[]>(SEEN) ?? []);
let shared = new Set<string>(getJson<string[]>(SHARED) ?? []);
let pending = new Set<string>(getJson<string[]>(PENDING) ?? []);
let read = new Set([...seen, ...shared]);

function changed() {
  read = new Set([...seen, ...shared]);
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Items that ask for attention now count as unread until the inbox has been opened; coming-up items never do. */
export const needsAttention = (r: Reminder) => r.urgency !== 'upcoming';

/** Keys read on this phone or any other phone on the account. */
export function useSeen(): Set<string> {
  return useSyncExternalStore(subscribe, () => read);
}

/** Marks these items read here and queues them for the account. Keys of items that no longer exist are dropped locally. */
export function markSeen(items: Reminder[]) {
  const keys = items.map((r) => r.key);
  const fresh = keys.filter((k) => !read.has(k));
  const next = new Set(keys);
  if (!fresh.length && next.size === seen.size && keys.every((k) => seen.has(k))) return;
  seen = next;
  setJson(SEEN, [...seen]);
  if (fresh.length) {
    fresh.forEach((k) => pending.add(k));
    setJson(PENDING, [...pending]);
    void sendPending();
  }
  changed();
}

export function unreadCount(items: Reminder[], marks: Set<string>) {
  return items.filter((r) => needsAttention(r) && !marks.has(r.key)).length;
}

/** Sends queued read marks; on any failure they stay queued for the next sync. */
async function sendPending() {
  const batch = [...pending].slice(0, 200);
  if (!batch.length) return;
  try {
    await api('/v1/notifications/read', { method: 'POST', body: { keys: batch } });
    batch.forEach((k) => pending.delete(k));
    setJson(PENDING, [...pending]);
  } catch {
    // Offline or refused: kept for the next sync.
  }
}

/** Runs after each sync: send what is queued, then take in what other phones have read. */
export async function syncInboxReads() {
  await sendPending();
  const { keys } = await api<{ keys: string[] }>('/v1/notifications/read');
  shared = new Set(keys);
  setJson(SHARED, keys);
  changed();
}
