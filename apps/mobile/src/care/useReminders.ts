import * as Notifications from 'expo-notifications';
import { useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { displayName } from '../animals/model';
import { listAnimals } from '../animals/repo';
import { DEFAULT_NOTIFICATION_PREFS } from '../lib/account';
import { getJson, setJson } from '../lib/localDb';
import { useAuth } from '../state/auth';
import { useLocal } from '../sync/store';
import { planNotifications } from './plan';
import { computeReminders } from './reminders';
import { loadCareData } from './repo';
import { loadFinance } from '../finance/repo';
import { financeReminders } from '../finance/reminders';
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
  const timeZone = account?.time_zone;
  return useMemo(() => {
    const now = new Date();
    const farmDate = (iso: string) => farmDateOf(iso, timeZone);
    const active = new Set(animals.filter((a) => a.data.status === 'active').map((a) => a.data.id));
    const names = new Map(animals.map((a) => [a.data.id, displayName(a.data)]));
    const order = { active: 0, overdue: 1, today: 2, upcoming: 3 };
    const reminders = [...computeReminders(care, active, now), ...financeReminders(finance, milk, farmDate(now.toISOString()), farmDate)].sort(
      (a, b) => order[a.urgency] - order[b.urgency] || a.due.localeCompare(b.due),
    );
    return { reminders, names };
  }, [care, animals, finance, milk, timeZone]);
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
  const { reminders, names } = useReminders();
  const prefs = { ...DEFAULT_NOTIFICATION_PREFS, ...account?.notification_prefs };
  const planned = planNotifications(reminders, prefs, names, new Date());
  const key = JSON.stringify(planned.map((p) => [p.id, p.at.getTime(), p.title]));

  useEffect(() => {
    let cancelled = false;
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
