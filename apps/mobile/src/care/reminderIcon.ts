import type { IconName } from '../ui/kit';
import type { ReminderKind } from './reminders';

/** One icon per kind of reminder, used on Home and in Notifications. */
export const REMINDER_ICON: Record<ReminderKind, IconName> = {
  withdrawal: 'water-off-outline',
  withdrawal_clearance: 'water-check-outline',
  vaccination: 'needle',
  pregnancy_check: 'heart-pulse',
  expected_calving: 'cow',
  health_follow_up: 'stethoscope',
  unpaid_balance: 'account-cash-outline',
  stock_discrepancy: 'warehouse',
  production_decline: 'chart-line-variant',
  sync_problem: 'cloud-alert',
  possible_duplicate: 'content-duplicate',
  new_device: 'cellphone-link',
};
