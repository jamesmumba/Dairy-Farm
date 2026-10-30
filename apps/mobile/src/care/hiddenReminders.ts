// Reminders the farmer has answered with "nothing to record" (no heat seen), kept on this phone so
// they stop showing and notifying. Keyed by the reminder key, so a new mating starts a new watch.

import { localSet } from '../lib/localSet';

const hidden = localSet('reminders.hidden');
export const useHiddenReminders = hidden.use;
export const hideReminder = hidden.add;
