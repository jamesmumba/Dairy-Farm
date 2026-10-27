// Which local notifications to schedule. Pure, so it can be tested without a phone.

import type { NotificationPrefs } from '../lib/account';
import type { Reminder, ReminderKind } from './reminders';

export interface PlannedNotification {
  id: string;
  title: string;
  body: string;
  at: Date;
}

/** iOS keeps at most 64 pending local notifications; stay under it. */
export const MAX_NOTIFICATIONS = 60;

const PREF: Record<ReminderKind, keyof NotificationPrefs> = {
  withdrawal: 'withdrawal',
  withdrawal_clearance: 'withdrawal',
  vaccination: 'vaccinations',
  pregnancy_check: 'breeding',
  expected_calving: 'breeding',
  health_follow_up: 'health',
  unpaid_balance: 'finance',
  stock_discrepancy: 'finance',
};

export function planNotifications(reminders: Reminder[], prefs: NotificationPrefs, names: Map<string, string>, now: Date): PlannedNotification[] {
  const [hh, mm] = prefs.reminder_time.split(':').map(Number);
  const out: PlannedNotification[] = [];
  for (const r of reminders) {
    if (!prefs[PREF[r.kind]]) continue;
    const animal = names.get(r.cattleId) ?? 'An animal';
    if (r.kind === 'withdrawal') {
      // At the vet's exact end time.
      out.push({ id: `${r.key}:end`, title: `${animal}: withdrawal period ended`, body: 'Check with your vet whether clearance is needed before using this milk.', at: new Date(r.due) });
      continue;
    }
    for (const offset of r.notifyOffsets) {
      const at = new Date(`${r.due}T00:00:00`);
      at.setDate(at.getDate() - offset);
      at.setHours(hh, mm, 0, 0);
      const when = offset === 0 ? 'today' : offset === 1 ? 'tomorrow' : `in ${offset} days`;
      out.push({ id: `${r.key}:${offset}`, title: `${animal}: ${r.title.replace(/ (due|overdue)$/, '')} ${when}`, body: r.detail, at });
    }
  }
  return out
    .filter((n) => n.at.getTime() > now.getTime())
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(0, MAX_NOTIFICATIONS);
}
