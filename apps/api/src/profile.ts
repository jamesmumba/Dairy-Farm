import { z } from 'zod';

export const ONBOARDING_STEPS = ['profile', 'farm', 'units', 'reminders', 'lock', 'first_task'] as const;

// Currencies the farmer may choose. Amounts in different currencies are never combined.
export const CURRENCIES = ['ZMW', 'USD'] as const;

function isTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const optionalText = (max: number) =>
  z.string().trim().max(max).transform((s) => (s === '' ? null : s)).nullable().optional();

export const NotificationPrefs = z
  .object({
    reminder_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM'),
    vaccinations: z.boolean(),
    breeding: z.boolean(),
    health: z.boolean(),
    withdrawal: z.boolean(),
    finance: z.boolean(),
    sync_problems: z.boolean(),
  })
  .strict();

export const DeclineRule = z
  .object({
    recent_days: z.number().int().min(3).max(30),
    baseline_days: z.number().int().min(3).max(60),
    threshold_pct: z.number().int().min(5).max(80),
    min_days: z.number().int().min(1).max(30),
  })
  .strict()
  .refine((r) => r.min_days <= Math.min(r.recent_days, r.baseline_days), {
    message: 'Minimum days cannot be longer than either period',
    path: ['min_days'],
  });

/** Days after a breeding; set from the farmer's vet guidance. */
export const BreedingIntervals = z
  .object({
    pregnancy_check_days: z.number().int().min(14).max(120),
    gestation_days: z.number().int().min(260).max(300),
  })
  .strict();

export const ProfilePatch = z
  .object({
    display_name: z.string().trim().min(1, 'Enter your name').max(80).optional(),
    preferred_contact: z.enum(['email', 'phone']).optional(),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[0-9 ]{7,20}$/, 'Enter a phone number, e.g. +260 97 123 4567')
      .nullable()
      .optional(),
    farm_name: optionalText(120),
    farm_location: optionalText(200),
    time_zone: z.string().refine(isTimeZone, 'Unknown time zone').optional(),
    currency: z.enum(CURRENCIES).optional(),
    language: z.enum(['en']).optional(),
    date_format: z.enum(['DD/MM/YYYY', 'YYYY-MM-DD']).optional(),
    notification_prefs: NotificationPrefs.optional(),
    decline_rule: DeclineRule.optional(),
    breeding_intervals: BreedingIntervals.optional(),
    onboarding_step: z.enum(ONBOARDING_STEPS).nullable().optional(),
    onboarding_completed: z.literal(true).optional(),
  })
  .strict();

export type ProfilePatch = z.infer<typeof ProfilePatch>;
