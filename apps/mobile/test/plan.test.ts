import { describe, expect, it } from 'vitest';
import { DEFAULT_NOTIFICATION_PREFS } from '../src/lib/account';
import { MAX_NOTIFICATIONS, planAlerts, planNotifications } from '../src/care/plan';
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

describe('one-off alerts for problems', () => {
  const unpaid = reminder({ key: 'unpaid:c1:ZMW', kind: 'unpaid_balance', urgency: 'overdue', cattleId: '', title: 'Mrs Phiri owes ZMW 40.00', detail: 'Unpaid since 2026-10-14', notifyOffsets: [], alert: 'next_reminder' });

  it('alerts once at the next reminder time, titled without an animal for farm-wide items', () => {
    const { planned, log } = planAlerts([unpaid], prefs, names, NOW, {});
    expect(planned).toHaveLength(1);
    expect(planned[0]).toMatchObject({ id: 'unpaid:c1:ZMW:alert', title: 'Mrs Phiri owes ZMW 40.00' });
    // 06:30 today has passed at 09:00, so tomorrow 06:30.
    expect(planned[0].at).toEqual(new Date('2026-10-29T06:30:00'));
    expect(log['unpaid:c1:ZMW']).toBe(planned[0].at.getTime());
  });

  it('keeps the same time when replanned, and does not alert again once shown', () => {
    const first = planAlerts([unpaid], prefs, names, NOW, {});
    const replanned = planAlerts([unpaid], prefs, names, new Date('2026-10-28T20:00:00'), first.log);
    expect(replanned.planned[0].at).toEqual(first.planned[0].at);
    const afterShown = planAlerts([unpaid], prefs, names, new Date('2026-10-30T09:00:00'), first.log);
    expect(afterShown.planned).toEqual([]);
    expect(afterShown.log['unpaid:c1:ZMW']).toBe(first.log['unpaid:c1:ZMW']);
  });

  it('forgets a problem that cleared, so it alerts again if it comes back', () => {
    const first = planAlerts([unpaid], prefs, names, NOW, {});
    const cleared = planAlerts([], prefs, names, new Date('2026-10-30T09:00:00'), first.log);
    expect(cleared.log).toEqual({});
    const back = planAlerts([unpaid], prefs, names, new Date('2026-11-02T09:00:00'), cleared.log);
    expect(back.planned).toHaveLength(1);
  });

  it('alerts a sync problem within a minute', () => {
    const sync = reminder({ key: 'sync:op1', kind: 'sync_problem', urgency: 'active', cattleId: '', title: '1 change not saved to your account', notifyOffsets: [], alert: 'soon' });
    const { planned } = planAlerts([sync], prefs, names, NOW, {});
    expect(planned[0].at.getTime() - NOW.getTime()).toBe(60_000);
  });

  it('respects the switches, without replaying old problems when switched back on', () => {
    const off = planAlerts([unpaid], { ...prefs, finance: false }, names, NOW, {});
    expect(off.planned).toEqual([]);
    const onLater = planAlerts([unpaid], prefs, names, new Date('2026-10-30T09:00:00'), off.log);
    expect(onLater.planned).toEqual([]);
  });

  it('names the animal for falling milk', () => {
    const fall = reminder({ key: 'decline:cow', kind: 'production_decline', urgency: 'active', title: 'Milk down 25%', notifyOffsets: [], alert: 'next_reminder' });
    expect(planAlerts([fall], prefs, names, NOW, {}).planned[0].title).toBe('ZM-001 · Daisy: Milk down 25%');
  });
});
