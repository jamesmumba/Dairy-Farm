// The account's phones, refreshed with each sync and kept on this phone for offline viewing.

import { useSyncExternalStore } from 'react';
import { api } from './api';
import type { SignedInDevice } from './devices';
import { getJson, setJson } from './localDb';

const KEY = 'devices';
const listeners = new Set<() => void>();
let devices: SignedInDevice[] = getJson<SignedInDevice[]>(KEY) ?? [];

function set(next: SignedInDevice[]) {
  devices = next;
  setJson(KEY, next);
  listeners.forEach((l) => l());
}

export function useDevices(): SignedInDevice[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => devices,
  );
}

export async function refreshDevices() {
  set(await api<SignedInDevice[]>('/v1/devices'));
}

/** Runs after each sync. The list is a nice-to-have: a failure here must not mark the sync as failed. */
export async function refreshDevicesQuietly() {
  await refreshDevices().catch(() => {});
}

export async function signOutDevice(id: string) {
  await api(`/v1/devices/${id}/sign-out`, { method: 'POST' });
  await refreshDevices();
}

export async function signOutOtherDevices() {
  await api('/v1/devices/sign-out-others', { method: 'POST' });
  await refreshDevices();
}

/** On sign-out: the next account must not see this one's phones. */
export function forgetDevices() {
  devices = [];
  listeners.forEach((l) => l());
}
