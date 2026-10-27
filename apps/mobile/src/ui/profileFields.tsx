import { Text } from 'react-native';
import {
  CURRENCIES,
  DATE_FORMATS,
  DEFAULT_NOTIFICATION_PREFS,
  type FarmerAccount,
  type NotificationPrefs,
  type ProfilePatch,
} from '../lib/account';
import { Choice, TextField, Toggle } from './form';
import { useTheme } from './theme';

export interface ProfileForm {
  display_name: string;
  preferred_contact: 'email' | 'phone';
  phone: string;
  farm_name: string;
  farm_location: string;
  time_zone: string;
  currency: string;
  date_format: string;
  notification_prefs: NotificationPrefs;
}

export type ProfileErrors = Partial<Record<keyof ProfileForm | 'reminder_time', string>>;

export function formFromAccount(a: FarmerAccount): ProfileForm {
  return {
    display_name: a.display_name ?? '',
    preferred_contact: a.preferred_contact ?? 'email',
    phone: a.phone ?? '',
    farm_name: a.farm_name ?? '',
    farm_location: a.farm_location ?? '',
    time_zone: a.time_zone,
    currency: a.currency,
    date_format: a.date_format,
    notification_prefs: { ...DEFAULT_NOTIFICATION_PREFS, ...a.notification_prefs },
  };
}

export const SECTION_FIELDS = {
  profile: ['display_name', 'preferred_contact', 'phone'],
  farm: ['farm_name', 'farm_location', 'time_zone'],
  units: ['currency', 'date_format'],
  reminders: ['notification_prefs'],
} as const satisfies Record<string, readonly (keyof ProfileForm)[]>;

export type Section = keyof typeof SECTION_FIELDS;

/** Client-side checks; the server validates again. */
export function validate(form: ProfileForm, sections: readonly Section[]): ProfileErrors {
  const errors: ProfileErrors = {};
  if (sections.includes('profile')) {
    if (!form.display_name.trim()) errors.display_name = 'Enter your name.';
    if (form.phone.trim() && !/^\+?[0-9 ]{7,20}$/.test(form.phone.trim())) errors.phone = 'Enter a phone number, e.g. +260 97 123 4567.';
    if (form.preferred_contact === 'phone' && !form.phone.trim()) errors.phone = 'Add a phone number to use phone as your contact.';
  }
  if (sections.includes('reminders') && !/^([01]\d|2[0-3]):[0-5]\d$/.test(form.notification_prefs.reminder_time)) {
    errors.reminder_time = 'Use 24-hour time, e.g. 06:00.';
  }
  return errors;
}

export function patchFor(form: ProfileForm, sections: readonly Section[]): ProfilePatch {
  const patch: ProfilePatch = {};
  for (const section of sections) {
    for (const field of SECTION_FIELDS[section]) {
      const value = form[field];
      (patch as Record<string, unknown>)[field] =
        typeof value === 'string' ? (field === 'phone' && !value.trim() ? null : value.trim()) : value;
    }
  }
  return patch;
}

function Why({ children }: { children: string }) {
  const t = useTheme();
  return <Text style={{ color: t.textMuted, fontSize: 15 }}>{children}</Text>;
}

type SectionProps = { form: ProfileForm; errors: ProfileErrors; update: (patch: Partial<ProfileForm>) => void };

export function ProfileSection({ form, errors, update }: SectionProps) {
  return (
    <>
      <Why>Your name appears on reports and statements you share. Your contact preference is how you would like to be reached about your account.</Why>
      <TextField label="Your name" value={form.display_name} onChangeText={(display_name) => update({ display_name })} error={errors.display_name} autoComplete="name" />
      <Choice
        label="Preferred contact"
        value={form.preferred_contact}
        options={[
          { value: 'email', label: 'Email' },
          { value: 'phone', label: 'Phone' },
        ]}
        onChange={(preferred_contact) => update({ preferred_contact })}
      />
      <TextField label="Phone (optional)" value={form.phone} onChangeText={(phone) => update({ phone })} error={errors.phone} keyboardType="phone-pad" autoComplete="tel" placeholder="+260 97 123 4567" />
    </>
  );
}

export function FarmSection({ form, update }: SectionProps) {
  const device = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const zones = [...new Set(['Africa/Lusaka', device, form.time_zone].filter(Boolean))];
  return (
    <>
      <Why>The farm name and location are labels for your reports. The time zone decides which day a milking or sale belongs to and when reminders go off.</Why>
      <TextField label="Farm name (optional)" value={form.farm_name} onChangeText={(farm_name) => update({ farm_name })} />
      <TextField label="Location (optional)" hint="e.g. Chisamba, Central Province" value={form.farm_location} onChangeText={(farm_location) => update({ farm_location })} />
      <Choice label="Time zone" value={form.time_zone} options={zones.map((z) => ({ value: z, label: z.replace('_', ' ') }))} onChange={(time_zone) => update({ time_zone })} />
    </>
  );
}

export function UnitsSection({ form, update }: SectionProps) {
  return (
    <>
      <Why>Prices, sales and expenses are recorded in your currency. Each sale keeps the currency it was made in, so changing this later does not alter past records.</Why>
      <Choice label="Currency" value={form.currency} options={CURRENCIES} onChange={(currency) => update({ currency })} />
      <Choice label="Date format" value={form.date_format} options={DATE_FORMATS} onChange={(date_format) => update({ date_format })} />
      <Why>Milk is measured in litres (L) and animal weight in kilograms (kg).</Why>
    </>
  );
}

export function RemindersSection({ form, errors, update }: SectionProps) {
  const prefs = form.notification_prefs;
  const set = (patch: Partial<NotificationPrefs>) => update({ notification_prefs: { ...prefs, ...patch } });
  return (
    <>
      <Why>Choose which reminders you want. Your phone will ask for permission to show notifications only when the first reminder is set.</Why>
      <TextField label="Daily reminder time" hint="24-hour time, e.g. 06:00" value={prefs.reminder_time} onChangeText={(reminder_time) => set({ reminder_time })} error={errors.reminder_time} keyboardType="numbers-and-punctuation" maxLength={5} />
      <Toggle label="Vaccinations due or overdue" value={prefs.vaccinations} onChange={(vaccinations) => set({ vaccinations })} />
      <Toggle label="Pregnancy checks and calving" value={prefs.breeding} onChange={(breeding) => set({ breeding })} />
      <Toggle label="Health follow-ups" value={prefs.health} onChange={(health) => set({ health })} />
      <Toggle label="Milk withdrawal ending" hint="Strongly recommended" value={prefs.withdrawal} onChange={(withdrawal) => set({ withdrawal })} />
      <Toggle label="Unpaid balances and stock problems" value={prefs.finance} onChange={(finance) => set({ finance })} />
      <Toggle label="Records that failed to sync" value={prefs.sync_problems} onChange={(sync_problems) => set({ sync_problems })} />
    </>
  );
}
