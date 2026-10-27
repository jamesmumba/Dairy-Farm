// Mirrors apps/api/src/profile.ts and the farmer_accounts columns.
import type { DeclineRule } from '../production/calc';

/** Days after a breeding, from the farmer's vet guidance. */
export interface BreedingIntervals {
  pregnancy_check_days: number;
  gestation_days: number;
}

export const ONBOARDING_STEPS = ['profile', 'farm', 'units', 'reminders', 'lock', 'first_task'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const CURRENCIES = [
  { value: 'ZMW', label: 'Zambian kwacha (ZMW)' },
  { value: 'USD', label: 'US dollar (USD)' },
] as const;

export const DATE_FORMATS = [
  { value: 'DD/MM/YYYY', label: '31/12/2026' },
  { value: 'YYYY-MM-DD', label: '2026-12-31' },
] as const;

export interface NotificationPrefs {
  reminder_time: string;
  vaccinations: boolean;
  breeding: boolean;
  health: boolean;
  withdrawal: boolean;
  finance: boolean;
  sync_problems: boolean;
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  reminder_time: '06:00',
  vaccinations: true,
  breeding: true,
  health: true,
  withdrawal: true,
  finance: true,
  sync_problems: true,
};

export interface FarmerAccount {
  id: string;
  display_name: string | null;
  preferred_contact: 'email' | 'phone' | null;
  phone: string | null;
  farm_name: string | null;
  farm_location: string | null;
  time_zone: string;
  currency: string;
  volume_unit: string;
  weight_unit: string;
  language: string;
  date_format: string;
  notification_prefs: Partial<NotificationPrefs>;
  decline_rule?: DeclineRule;
  breeding_intervals?: BreedingIntervals;
  onboarding_step: OnboardingStep | null;
  onboarding_completed_at: string | null;
  deletion_requested_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export type ProfilePatch = Partial<
  Pick<
    FarmerAccount,
    | 'display_name'
    | 'preferred_contact'
    | 'phone'
    | 'farm_name'
    | 'farm_location'
    | 'time_zone'
    | 'currency'
    | 'date_format'
    | 'onboarding_step'
  > & { notification_prefs: NotificationPrefs; decline_rule: DeclineRule; breeding_intervals: BreedingIntervals; onboarding_completed: true }
>;
