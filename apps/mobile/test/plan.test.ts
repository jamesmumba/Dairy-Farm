import { describe, expect, it } from 'vitest';
import { DEFAULT_NOTIFICATION_PREFS } from '../src/lib/account';
import { MAX_NOTIFICATIONS, planNotifications } from '../src/care/plan';
import type { Reminder } from '../src/care/reminders';

const NOW = new Date('2026-10-28T09:00:00');
const names = new Map([['cow', 'ZM-001 · Daisy']]);
const prefs = { ...DEFAULT_NOTIFICATION_PREFS, reminder_time: '06:30' };

const reminder = (extra: Partial<Reminder>): Reminder => ({
  key: 'vaccination:v1',
  kind: 'vaccination',
  urgency: 'upcoming',
  due: '2026-11-04',
  cattleId: 'cow',
  title: 'Lumpy skin disease due',
  detail: 'Against LSD',
  record: { kind: 'vaccination', id: 'v1' },
  notifyOffsets: [30, 7, 1],
  ...extra,
});

describe('notification plan', () => {
  it('notifies at the farmer’s reminder time on each offset day, skipping times already past', () => {
    const plan = planNotifications([reminder({})], prefs, names, NOW);
    // 30 days before (5 Oct) is past; 7 days before is today 06:30, also past; 1 day before remains.
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ id: 'vaccination:v1:1', title: 'ZM-001 · Daisy: Lumpy skin disease tomorrow' });
    expect(plan[0].at).toEqual(new Date('2026-11-03T06:30:00'));
  });

  it('notifies a withdrawal at the vet’s exact end time', () => {
    const plan = planNotifications([reminder({ key: 'withdrawal:t1', kind: 'withdrawal', urgency: 'active', due: '2026-10-29T10:15:00.000Z', notifyOffsets: [0] })], prefs, names, NOW);
    expect(plan[0].at.toISOString()).toBe('2026-10-29T10:15:00.000Z');
  });

  it('respects the farmer’s reminder settings', () => {
    const plan = planNotifications([reminder({})], { ...prefs, vaccinations: false }, names, NOW);
    expect(plan).toEqual([]);
  });

  it('stays under the phone’s limit, keeping the soonest', () => {
    const many = Array.from({ length: 100 }, (_, i) => reminder({ key: `v:${i}`, due: `2027-01-${String((i % 28) + 1).padStart(2, '0')}`, notifyOffsets: [0] }));
    const plan = planNotifications(many, prefs, names, NOW);
    expect(plan).toHaveLength(MAX_NOTIFICATIONS);
    expect(plan[0].at.getTime()).toBeLessThanOrEqual(plan[plan.length - 1].at.getTime());
  });
});
