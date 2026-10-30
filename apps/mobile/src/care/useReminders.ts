import * as Notifications from 'expo-notifications';
import { useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { displayName } from '../animals/model';
import { listAnimals } from '../animals/repo';
import { DEFAULT_NOTIFICATION_PREFS } from '../lib/account';
import { getJson, setJson } from '../lib/localDb';
import { useAuth } from '../state/auth';
import { addPullHook } from '../sync/engine';
import { failedOps, useLocal } from '../sync/store';
import { findDuplicates } from './duplicates';
import { useDismissedDuplicates } from './duplicatesStore';
import { useHiddenReminders } from './hiddenReminders';
import { newDeviceReminders } from '../lib/devices';
import { useDevices } from '../lib/devicesStore';
import { syncInboxReads } from './inbox';
import { type AlertLog, MAX_NOTIFICATIONS, planAlerts, planNotifications } from './plan';
import { computeReminders, type Reminder } from './reminders';
import { loadCareData } from './repo';
import { loadFinance } from '../finance/repo';
import { financeReminders } from '../finance/reminders';
import { milkAlerts, missingMilkings } from '../production/alerts';
import { DEFAULT_DECLINE_RULE } from '../production/calc';
import { SESSION_LABELS } from '../production/format';
import { useNotMilked } from '../production/notMilked';
import { listMilk } from '../production/repo';
import { farmDateOf } from '../lib/dates';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

/** Reminders from the records on this phone, recomputed when they change. */
export function useReminders() {
  const { account } = useAuth();
  const care = useLocal(loadCareData);
  const animals = useLocal(listAnimals);
  const finance = useLocal(loadFinance);
  const milk = useLocal(() => listMilk().map((m) => m.data));
  const failed = useLocal(failedOps);
  const dismissedDuplicates = useDismissedDuplicates();
  const devices = useDevices();
  const hidden = useHiddenReminders();
  const notMilked = useNotMilked();
  const timeZone = account?.time_zone;
  const rule = account?.decline_rule ?? DEFAULT_DECLINE_RULE;
  return useMemo(() => {
    const now = new Date();
    const farmDate = (iso: string) => farmDateOf(iso, timeZone);
    const active = new Set(animals.filter((a) => a.data.status === 'active').map((a) => a.data.id));
    const names = new Map(animals.map((a) => [a.data.id, displayName(a.data)]));
    const order = { active: 0, overdue: 1, today: 2, upcoming: 3 };
    const today = farmDate(now.toISOString());
    // Early warning: a sudden drop or falling milk, one per cow while it lasts and until the farmer acts on it.
    const cows = animals.map((a) => a.data);
    const declines: Reminder[] = milkAlerts(milk, cows, care, today, rule).map((m) => ({
      // A drop is one event (a new one alerts again); a decline lasts, so it keeps one key while it does.
      key: m.type === 'milk_drop' ? `drop:${m.cattleId}:${m.since}` : `decline:${m.cattleId}`,
      kind: 'production_decline',
      urgency: 'active',
      due: today,
      cattleId: m.cattleId,
      title: m.title,
      detail: m.reason,
      href: `/alert/${m.cattleId}`,
      notifyOffsets: [],
      alert: 'next_reminder',
    }));
    // Milkings already over where cows in milk have no entry: shown in the app, never notified.
    const missing: Reminder[] = missingMilkings(milk, cows, today, now, notMilked).map((m) => ({
      key: `missing:${m.date}:${m.session}`,
      kind: 'missing_milk',
      urgency: 'today',
      due: m.date,
      cattleId: '',
      title: `${SESSION_LABELS[m.session]} milk ${m.date === today ? 'today' : 'yesterday'}: ${m.cattleIds.length} of ${m.of} cows not recorded`,
      detail: 'Record them, or check the cows marked as in milk',
      href: `/milk/round?date=${m.date}&session=${m.session}`,
      notifyOffsets: [],
    }));
    // Changes the account did not accept. The key follows the newest failure, so a new one alerts again.
    const sync: Reminder[] = failed.length
      ? [
          {
            key: `sync:${failed[failed.length - 1].op_id}`,
            kind: 'sync_problem',
            urgency: 'active',
            due: today,
            cattleId: '',
            title: `${failed.length} change${failed.length === 1 ? '' : 's'} not saved to your account`,
            detail: 'Open Sync issues to fix or discard them.',
            href: '/sync-issues',
            notifyOffsets: [],
            alert: 'soon',
          },
        ]
      : [];
    // Two phones adding the same customer or untagged animal while offline.
    const duplicates = findDuplicates(finance.customers, animals.map((a) => a.data), dismissedDuplicates, today);
    const reminders = [...sync, ...duplicates, ...newDeviceReminders(devices, now, today), ...computeReminders(care, active, now), ...declines, ...missing, ...financeReminders(finance, milk, today, farmDate)].filter((r) => !hidden.has(r.key)).sort(
      (a, b) => order[a.urgency] - order[b.urgency] || a.due.localeCompare(b.due),
    );
    return { reminders, names };
  }, [care, animals, finance, milk, timeZone, failed, rule, dismissedDuplicates, devices, hidden, notMilked]);
}

export type NotificationStatus = { state: 'scheduled'; count: number; at: string } | { state: 'denied' } | { state: 'off' } | { state: 'none' };

export const useNotificationStatus = () => {
  const read = (): NotificationStatus => getJson<NotificationStatus>('notifications.status') ?? { state: 'none' };
  const [status, setStatus] = useState(read);
  useEffect(() => {
    const id = setInterval(() => setStatus(read()), 2000);
    return () => clearInterval(id);
  }, []);
  return status;
};

/**
 * Keeps the phone's scheduled notifications in line with the reminders. Mounted once while
 * signed in. Asks for permission only when there is something to notify.
 */
export function useNotificationScheduler() {
  const { account } = useAuth();
  // Read marks for the inbox travel with each sync, so other phones on the account agree.
  useEffect(() => {
    const remove = addPullHook(syncInboxReads);
    return () => {
      remove();
    };
  }, []);
  const { reminders, names } = useReminders();
  const prefs = { ...DEFAULT_NOTIFICATION_PREFS, ...account?.notification_prefs };
  const now = new Date();
  const alerts = planAlerts(reminders, prefs, names, now, getJson<AlertLog>('notifications.alerts') ?? {});
  const planned = [...planNotifications(reminders, prefs, names, now), ...alerts.planned].sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, MAX_NOTIFICATIONS);
  const key = JSON.stringify([planned.map((p) => [p.id, p.at.getTime(), p.title]), alerts.log]);

  useEffect(() => {
    let cancelled = false;
    setJson('notifications.alerts', alerts.log);
    (async () => {
      if (!planned.length) {
        await Notifications.cancelAllScheduledNotificationsAsync();
        setJson('notifications.status', { state: Object.values(prefs).some((v) => v === true) ? 'none' : 'off' } satisfies NotificationStatus);
        return;
      }
      let permission = await Notifications.getPermissionsAsync();
      if (!permission.granted && permission.canAskAgain) permission = await Notifications.requestPermissionsAsync();
      if (cancelled) return;
      if (!permission.granted) {
        setJson('notifications.status', { state: 'denied' } satisfies NotificationStatus);
        return;
      }
      if (Platform.OS === 'android') {
        // AndroidImportance is re-exported via `export *` from a types module, which the lint
        // import plugin cannot follow; it exists at runtime.
        // eslint-disable-next-line import/namespace
        await Notifications.setNotificationChannelAsync('reminders', { name: 'Farm reminders', importance: Notifications.AndroidImportance.DEFAULT });
      }
      await Notifications.cancelAllScheduledNotificationsAsync();
      for (const n of planned) {
        await Notifications.scheduleNotificationAsync({
          identifier: n.id,
          content: { title: n.title, body: n.body },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: n.at, channelId: 'reminders' },
        });
      }
      setJson('notifications.status', { state: 'scheduled', count: planned.length, at: new Date().toISOString() } satisfies NotificationStatus);
    })().catch(() => setJson('notifications.status', { state: 'denied' } satisfies NotificationStatus));
    return () => {
      cancelled = true;
    };
    // `key` captures everything `planned` depends on.
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
}
