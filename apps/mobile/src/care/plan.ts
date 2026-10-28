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
  production_decline: 'health',
  sync_problem: 'sync_problems',
  possible_duplicate: 'sync_problems', // shown in the app only (no phone notification)
};

/** "ZM-001 · Daisy: …" for an animal; the reminder's own title for farm-wide items (customers, stock, sync). */
const heading = (r: Reminder, names: Map<string, string>, text: string) => (r.cattleId ? `${names.get(r.cattleId) ?? 'An animal'}: ${text}` : text);

export function planNotifications(reminders: Reminder[], prefs: NotificationPrefs, names: Map<string, string>, now: Date): PlannedNotification[] {
  const [hh, mm] = prefs.reminder_time.split(':').map(Number);
  const out: PlannedNotification[] = [];
  for (const r of reminders) {
    if (!prefs[PREF[r.kind]]) continue;
    if (r.kind === 'withdrawal') {
      // At the vet's exact end time.
      out.push({ id: `${r.key}:end`, title: heading(r, names, 'withdrawal period ended'), body: 'Check with your vet whether clearance is needed before using this milk.', at: new Date(r.due) });
      continue;
    }
    for (const offset of r.notifyOffsets) {
      const at = new Date(`${r.due}T00:00:00`);
      at.setDate(at.getDate() - offset);
      at.setHours(hh, mm, 0, 0);
      const when = offset === 0 ? 'today' : offset === 1 ? 'tomorrow' : `in ${offset} days`;
      out.push({ id: `${r.key}:${offset}`, title: heading(r, names, `${r.title.replace(/ (due|overdue)$/, '')} ${when}`), body: r.detail, at });
    }
  }
  return out
    .filter((n) => n.at.getTime() > now.getTime())
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(0, MAX_NOTIFICATIONS);
}

/** When each one-off alert was (or will be) shown, by reminder key, as epoch milliseconds. Kept on the phone. */
export type AlertLog = Record<string, number>;

/**
 * One-off alerts for problems (unpaid balance, stock below zero, falling milk, clearance to confirm, sync
 * problem): each is shown once while it lasts, at the next reminder time or within a minute. A problem that
 * clears is forgotten, so if it comes back it alerts again. Returns what to schedule and the updated log.
 */
export function planAlerts(reminders: Reminder[], prefs: NotificationPrefs, names: Map<string, string>, now: Date, log: AlertLog): { planned: PlannedNotification[]; log: AlertLog } {
  const [hh, mm] = prefs.reminder_time.split(':').map(Number);
  const nextReminderTime = new Date(now);
  nextReminderTime.setHours(hh, mm, 0, 0);
  if (nextReminderTime.getTime() <= now.getTime()) nextReminderTime.setDate(nextReminderTime.getDate() + 1);

  const next: AlertLog = {};
  const planned: PlannedNotification[] = [];
  for (const r of reminders) {
    if (!r.alert) continue;
    const at = log[r.key] ?? (r.alert === 'soon' ? now.getTime() + 60_000 : nextReminderTime.getTime());
    next[r.key] = at; // kept while the problem lasts, even when switched off, so turning it on later does not replay old problems
    if (!prefs[PREF[r.kind]] || at <= now.getTime()) continue; // switched off, or already shown
    planned.push({ id: `${r.key}:alert`, title: heading(r, names, r.title), body: r.detail, at: new Date(at) });
  }
  return { planned, log: next };
}
