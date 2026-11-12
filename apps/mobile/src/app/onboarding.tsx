import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { ONBOARDING_STEPS, type OnboardingStep, type ProfilePatch } from '../lib/account';
import { ApiError, NetworkError } from '../lib/api';
import { useDraft } from '../lib/useDraft';
import { useAppLock } from '../state/appLock';
import { useAuth } from '../state/auth';
import { Button, FormScreen, Notice, Toggle } from '../ui/form';
import {
  FarmSection,
  formFromAccount,
  patchFor,
  ProfileSection,
  type ProfileErrors,
  RemindersSection,
  type Section,
  UnitsSection,
  validate,
} from '../ui/profileFields';
import { spacing, type, useTheme } from '../ui/theme';
import { friendlyError } from '../lib/errors';

const TITLES: Record<OnboardingStep, string> = {
  profile: 'About you',
  farm: 'Your farm',
  units: 'Money and units',
  reminders: 'Reminders',
  lock: 'Protect this phone',
  first_task: 'You’re ready',
};

const SECTIONS = { profile: ProfileSection, farm: FarmSection, units: UnitsSection, reminders: RemindersSection };

export default function Onboarding() {
  const t = useTheme();
  const { account, updateAccount } = useAuth();
  const lock = useAppLock();
  // Resumes at the last step the server saved; answers in progress stay on the phone.
  const [step, setStep] = useState<OnboardingStep>(account!.onboarding_step ?? 'profile');
  const [form, update, clearDraft] = useDraft('onboarding', () => formFromAccount(account!));
  const [errors, setErrors] = useState<ProfileErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const index = ONBOARDING_STEPS.indexOf(step);
  const Fields = step in SECTIONS ? SECTIONS[step as Section] : null;

  async function save(patch: ProfilePatch) {
    setBusy(true);
    setMessage(null);
    try {
      await updateAccount(patch);
      return true;
    } catch (err) {
      if (err instanceof NetworkError) setMessage('No connection. Your answers are saved on this phone. Try again when you are connected.');
      else if (err instanceof ApiError && err.status === 409) setMessage('Your account was updated on another device. Check your answers and continue.');
      else setMessage(friendlyError(err, 'Could not save. Try again.'));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function next() {
    const nextStep = ONBOARDING_STEPS[index + 1];
    if (Fields) {
      const found = validate(form, [step as Section]);
      setErrors(found);
      if (Object.keys(found).length) return;
      if (!(await save({ ...patchFor(form, [step as Section]), onboarding_step: nextStep }))) return;
    } else if (!(await save({ onboarding_step: nextStep }))) {
      return;
    }
    setStep(nextStep);
  }

  async function finish(destination: '/' | '/animals') {
    if (!(await save({ onboarding_step: null, onboarding_completed: true }))) return;
    clearDraft();
    router.replace(destination);
  }

  async function toggleLock(on: boolean) {
    setMessage(null);
    if (!on) return lock.disable();
    const result = await lock.enable();
    if (!result.ok) setMessage(result.message);
  }

  return (
    <FormScreen card standalone title={TITLES[step]}>
      <Text style={{ color: t.textMuted, ...type.bodySmall }} accessibilityLabel={`Step ${index + 1} of ${ONBOARDING_STEPS.length}`}>
        Step {index + 1} of {ONBOARDING_STEPS.length}
      </Text>
      {message ? <Notice tone="error">{message}</Notice> : null}

      {Fields ? <Fields form={form} errors={errors} update={update} /> : null}

      {step === 'lock' ? (
        <>
          <Text style={{ color: t.textMuted, ...type.bodySmall }}>
            Optional. Ask for your fingerprint, face or phone screen lock when opening the app. This protects your records if someone else uses this phone. You can change it later in Security.
          </Text>
          <Toggle label="Lock the app with this phone’s screen lock" value={lock.enabled} onChange={toggleLock} />
        </>
      ) : null}

      {step === 'first_task' ? (
        <View style={{ gap: spacing.md }}>
          <Text style={{ color: t.text, ...type.body }}>
            Setup is done. A good first step is to register an animal; milk, health and breeding records are all linked to it.
          </Text>
          <Button label="Register my first animal" onPress={() => finish('/animals')} busy={busy} />
          <Button label="Go to Home" variant="secondary" onPress={() => finish('/')} disabled={busy} />
        </View>
      ) : (
        <Button label={step === 'lock' ? 'Continue' : 'Save and continue'} onPress={next} busy={busy} />
      )}
      {index > 0 ? <Button label="Back" variant="text" onPress={() => setStep(ONBOARDING_STEPS[index - 1])} /> : null}
    </FormScreen>
  );
}
