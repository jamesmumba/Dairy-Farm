import { Chips } from '../ui/Chips';
import { useState } from 'react';
import { Alert, Text } from 'react-native';
import type { FarmerAccount, ProfilePatch } from '../lib/account';
import { ApiError, NetworkError } from '../lib/api';
import { getJson, remove, setJson } from '../lib/localDb';
import { threeWayMerge } from '../lib/merge';
import { useDraft } from '../lib/useDraft';
import { useAuth } from '../state/auth';
import { Button, FormScreen, Notice, TextField } from '../ui/form';
import {
  FarmSection,
  formFromAccount,
  patchFor,
  ProfileSection,
  type ProfileErrors,
  type ProfileForm,
  RemindersSection,
  type Section,
  UnitsSection,
  validate,
} from '../ui/profileFields';
import { FormCard } from '../ui/kit';
import { useTheme } from '../ui/theme';
import { type DeclineRule, DEFAULT_DECLINE_RULE } from '../production/calc';

const ALL: Section[] = ['profile', 'farm', 'units', 'reminders'];

const LABELS: Partial<Record<keyof ProfileForm, string>> = {
  display_name: 'Name',
  preferred_contact: 'Preferred contact',
  phone: 'Phone',
  farm_name: 'Farm name',
  farm_location: 'Location',
  time_zone: 'Time zone',
  currency: 'Currency',
  date_format: 'Date format',
  notification_prefs: 'Reminders',
};

/** Fields where the farmer's edit and the saved server version differ. */
function differences(mine: ProfileForm, saved: ProfileForm) {
  return (Object.keys(LABELS) as (keyof ProfileForm)[])
    .filter((k) => JSON.stringify(mine[k]) !== JSON.stringify(saved[k]))
    .map((k) => {
      const show = (v: unknown) => (typeof v === 'string' ? v || '(empty)' : 'changed');
      return `${LABELS[k]}: yours “${show(mine[k])}”, saved “${show(saved[k])}”`;
    });
}

type Tab = 'profile' | 'farm' | 'units' | 'reminders' | 'alerts' | 'breeding';
const TABS: { value: Tab; label: string }[] = [
  { value: 'profile', label: 'Profile' },
  { value: 'farm', label: 'Farm' },
  { value: 'units', label: 'Units' },
  { value: 'reminders', label: 'Reminders' },
  { value: 'alerts', label: 'Milk alerts' },
  { value: 'breeding', label: 'Breeding' },
];

const BASE_KEY = 'draft.settings.base';

/** Saves one field; if another phone saved meanwhile, saves again on top of its version (only this field is sent). */
async function saveOwnField(updateAccount: (patch: ProfilePatch, version?: number) => Promise<FarmerAccount>, patch: ProfilePatch) {
  try {
    return await updateAccount(patch);
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) return updateAccount(patch, (err.body.current as FarmerAccount).version);
    throw err;
  }
}

export default function Settings() {
  const t = useTheme();
  const [tab, setTab] = useState<Tab>('profile');
  const { account, updateAccount } = useAuth();
  const [form, update, clearForm] = useDraft('settings', () => formFromAccount(account!));
  // What the form started from, kept with the draft: tells this phone's edits apart from another phone's.
  const [base, setBase] = useState<ProfileForm>(() => {
    const kept = getJson<ProfileForm>(BASE_KEY);
    if (kept) return kept;
    const start = formFromAccount(account!);
    setJson(BASE_KEY, start);
    return start;
  });
  const clearDraft = () => {
    clearForm();
    remove(BASE_KEY);
  };
  const [errors, setErrors] = useState<ProfileErrors>({});
  const [message, setMessage] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(version?: number, values: ProfileForm = form, note = 'Saved.') {
    const found = validate(values, ALL);
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    setMessage(null);
    try {
      const next = await updateAccount(patchFor(values, ALL), version);
      clearDraft();
      const start = formFromAccount(next);
      setBase(start);
      setJson(BASE_KEY, start);
      setMessage({ tone: 'info', text: note });
    } catch (err) {
      if (err instanceof NetworkError) {
        setMessage({ tone: 'error', text: 'No connection. Your changes are kept on this phone. Save again when you are connected.' });
      } else if (err instanceof ApiError && err.status === 409) {
        resolveConflict(err.body.current as FarmerAccount);
      } else {
        setMessage({ tone: 'error', text: err instanceof Error ? err.message : 'Could not save.' });
      }
    } finally {
      setBusy(false);
    }
  }

  function resolveConflict(current: FarmerAccount) {
    const saved = formFromAccount(current);
    // Another phone saved meanwhile. If it changed other fields than this phone did, keep both sets of changes.
    const { merged, clashes } = threeWayMerge(base, form, saved);
    if (!clashes.length) {
      update(merged);
      void save(current.version, merged, 'Saved. Changes made on your other phone were kept too.');
      return;
    }
    const clashing = Object.fromEntries(clashes.map((k) => [k, true]));
    const pick = (o: ProfileForm) => Object.fromEntries(Object.entries(o).filter(([k]) => clashing[k])) as ProfileForm;
    Alert.alert('Changed on another device', `These were also changed on your other phone:\n\n${differences(pick(form), pick(saved)).join('\n')}`, [
      {
        text: 'Use saved version',
        onPress: () => {
          update(saved);
          clearDraft();
          setBase(saved);
          setJson(BASE_KEY, saved);
        },
      },
      { text: 'Keep my changes', onPress: () => save(current.version, merged) },
    ]);
  }

  return (
    <FormScreen title="Profile and settings">
      {/* One section at a time; the profile sections share one Save, so switching never loses an edit. */}
      <Chips label="Section" value={tab} options={TABS} onChange={(v) => v && setTab(v)} allowClear={false} />
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {tab === 'alerts' ? (
        <DeclineRuleSection />
      ) : tab === 'breeding' ? (
        <BreedingIntervalsSection />
      ) : (
        <FormCard>
          {tab === 'profile' ? <ProfileSection form={form} errors={errors} update={update} /> : null}
          {tab === 'farm' ? <FarmSection form={form} errors={errors} update={update} /> : null}
          {tab === 'units' ? <UnitsSection form={form} errors={errors} update={update} /> : null}
          {tab === 'reminders' ? <RemindersSection form={form} errors={errors} update={update} /> : null}
          <Button label="Save changes" onPress={() => save()} busy={busy} />
          <Text style={{ color: t.textMuted, fontSize: 13 }}>Saves profile, farm, units and reminders together. Changes are kept in your account history.</Text>
        </FormCard>
      )}
    </FormScreen>
  );
}

/** Days after a breeding used to schedule pregnancy checks and suggest calving dates. */
function BreedingIntervalsSection() {
  const t = useTheme();
  const { account, updateAccount } = useAuth();
  const current = account?.breeding_intervals ?? { pregnancy_check_days: 35, gestation_days: 283 };
  const [check, setCheck] = useState(String(current.pregnancy_check_days));
  const [gestation, setGestation] = useState(String(current.gestation_days));
  const [message, setMessage] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);

  async function save() {
    const c = Number(check);
    const g = Number(gestation);
    if (!Number.isInteger(c) || c < 14 || c > 120 || !Number.isInteger(g) || g < 260 || g > 300) {
      return setMessage({ tone: 'error', text: 'Pregnancy check: 14–120 days. Gestation: 260–300 days.' });
    }
    try {
      await saveOwnField(updateAccount, { breeding_intervals: { pregnancy_check_days: c, gestation_days: g } });
      setMessage({ tone: 'info', text: 'Saved.' });
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof NetworkError ? 'No connection. Try again when you are connected.' : 'Could not save. Try again.' });
    }
  }

  return (
    <FormCard title="Breeding intervals">
      <Text style={{ color: t.textMuted, fontSize: 14 }}>
        Used to plan a pregnancy check after each mating or insemination, and to suggest a calving date once a pregnancy is confirmed.
        The starting values are commonly used ones: confirm them with your vet.
      </Text>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <TextField label="Pregnancy check after (days)" value={check} onChangeText={setCheck} keyboardType="number-pad" maxLength={3} />
      <TextField label="Gestation (days)" value={gestation} onChangeText={setGestation} keyboardType="number-pad" maxLength={3} />
      <Button label="Save breeding intervals" onPress={save} />
    </FormCard>
  );
}

/** The farmer's "meaningful decline" rule for milk production alerts. */
function DeclineRuleSection() {
  const t = useTheme();
  const { account, updateAccount } = useAuth();
  const current = account?.decline_rule ?? DEFAULT_DECLINE_RULE;
  const [form, setForm] = useState(() => Object.fromEntries(Object.entries(current).map(([k, v]) => [k, String(v)])) as Record<keyof DeclineRule, string>);
  const [message, setMessage] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const set = (k: keyof DeclineRule) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    const rule = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, Number(v)])) as unknown as DeclineRule;
    const bad =
      !(rule.recent_days >= 3 && rule.recent_days <= 30) ||
      !(rule.baseline_days >= 3 && rule.baseline_days <= 60) ||
      !(rule.threshold_pct >= 5 && rule.threshold_pct <= 80) ||
      !(rule.min_days >= 1 && rule.min_days <= Math.min(rule.recent_days, rule.baseline_days)) ||
      Object.values(rule).some((n) => !Number.isInteger(n));
    if (bad) return setMessage({ tone: 'error', text: 'Use whole numbers: recent 3–30 days, earlier 3–60 days, drop 5–80%, minimum days no more than either period.' });
    try {
      await saveOwnField(updateAccount, { decline_rule: rule });
      setMessage({ tone: 'info', text: 'Saved.' });
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof NetworkError ? 'No connection. Try again when you are connected.' : 'Could not save. Try again.' });
    }
  }

  return (
    <FormCard title="Production alerts">
      <Text style={{ color: t.textMuted, fontSize: 14 }}>
        A cow is flagged when her average daily milk over the recent days (up to yesterday) is lower than her average over the days before by at least the percentage below.
      </Text>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <TextField label="Recent days" value={form.recent_days} onChangeText={set('recent_days')} keyboardType="number-pad" maxLength={2} />
      <TextField label="Compared with the days before" value={form.baseline_days} onChangeText={set('baseline_days')} keyboardType="number-pad" maxLength={2} />
      <TextField label="Flag a drop of at least (%)" value={form.threshold_pct} onChangeText={set('threshold_pct')} keyboardType="number-pad" maxLength={2} />
      <TextField label="Minimum days with records in each period" value={form.min_days} onChangeText={set('min_days')} keyboardType="number-pad" maxLength={2} />
      <Button label="Save alert settings" onPress={save} />
    </FormCard>
  );
}
