// Phones signed in to the account, as the API lists them. Pure: no I/O, no clock (callers pass `now`).

import type { Reminder } from '../care/reminders';
import { formatDate, formatDateTime } from './dates';

export interface SignedInDevice {
  device_id: string;
  name: string;
  platform: string;
  app_version: string | null;
  first_seen: string;
  last_seen: string;
  this_device: boolean;
}

/** How long a newly signed-in phone is mentioned in Notifications. */
const NEW_FOR_DAYS = 7;

/**
 * "New phone signed in" for phones that joined the account after this one, in the last week. A phone
 * the farmer does not recognise can then be signed out from Security › Signed-in phones.
 */
export function newDeviceReminders(devices: SignedInDevice[], now: Date, today: string): Reminder[] {
  const me = devices.find((d) => d.this_device);
  if (!me) return [];
  return devices
    .filter((d) => !d.this_device && d.first_seen > me.first_seen && now.getTime() - Date.parse(d.first_seen) < NEW_FOR_DAYS * 86_400_000)
    .map((d) => ({
      key: `new_device:${d.device_id}`,
      kind: 'new_device' as const,
      urgency: 'active' as const,
      due: today,
      cattleId: '',
      title: 'New phone signed in',
      detail: `${d.name}, ${formatDateTime(d.first_seen)}. Not yours? Sign it out.`,
      href: '/devices',
      notifyOffsets: [],
    }));
}

/** "In use now", "Used 15 min ago", "Used 3 h ago", else "Last used <date>". */
export function lastUsed(iso: string, now: Date): string {
  const minutes = Math.floor((now.getTime() - Date.parse(iso)) / 60_000);
  if (minutes < 3) return 'In use now';
  if (minutes < 60) return `Used ${minutes} min ago`;
  if (minutes < 24 * 60) return `Used ${Math.floor(minutes / 60)} h ago`;
  return `Last used ${formatDate(iso.slice(0, 10))}`;
}

export const platformLabel = (p: string) => ({ android: 'Android', ios: 'iPhone', web: 'Web' })[p] ?? 'Phone';
