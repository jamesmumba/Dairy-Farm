import { describe, expect, it } from 'vitest';
import { lastUsed, newDeviceReminders, platformLabel, type SignedInDevice } from '../src/lib/devices';

const NOW = new Date('2026-10-28T12:00:00Z');
const phone = (id: string, first_seen: string, this_device = false): SignedInDevice => ({
  device_id: id,
  name: `Phone ${id}`,
  platform: 'android',
  app_version: '1.0.0',
  first_seen,
  last_seen: first_seen,
  this_device,
});

describe('new phone signed in', () => {
  it('is raised for a phone that joined after this one, in the last week', () => {
    const found = newDeviceReminders([phone('me', '2026-10-01T08:00:00Z', true), phone('b', '2026-10-27T08:00:00Z')], NOW, '2026-10-28');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ key: 'new_device:b', kind: 'new_device', href: '/devices', notifyOffsets: [] });
  });

  it('is not raised for phones older than this one, older than a week, or before the list is known', () => {
    const me = phone('me', '2026-10-27T09:00:00Z', true);
    expect(newDeviceReminders([me, phone('older', '2026-10-27T08:00:00Z')], NOW, '2026-10-28')).toEqual([]);
    expect(newDeviceReminders([phone('me', '2026-09-01T08:00:00Z', true), phone('b', '2026-10-15T08:00:00Z')], NOW, '2026-10-28')).toEqual([]);
    expect(newDeviceReminders([phone('b', '2026-10-27T08:00:00Z')], NOW, '2026-10-28')).toEqual([]);
  });
});

describe('when a phone was last used', () => {
  it('reads in plain words', () => {
    expect(lastUsed('2026-10-28T11:59:00Z', NOW)).toBe('In use now');
    expect(lastUsed('2026-10-28T11:45:00Z', NOW)).toBe('Used 15 min ago');
    expect(lastUsed('2026-10-28T09:00:00Z', NOW)).toBe('Used 3 h ago');
    expect(lastUsed('2026-10-20T09:00:00Z', NOW)).toBe('Last used 20/10/2026');
    expect(platformLabel('ios')).toBe('iPhone');
    expect(platformLabel('something')).toBe('Phone');
  });
});
