import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Notice, BrandMark } from '../ui/form';
import { spacing, type, useTheme } from '../ui/theme';

// Convenience lock only: it never replaces server sign-in or account recovery.
const KEY = 'app_lock_enabled';
const RELOCK_AFTER_MS = 5 * 60 * 1000;

interface AppLockValue {
  enabled: boolean;
  /** Confirms the farmer can unlock with this phone before turning the lock on. */
  enable(): Promise<{ ok: true } | { ok: false; message: string }>;
  disable(): Promise<void>;
}

const AppLockContext = createContext<AppLockValue | null>(null);

export function useAppLock() {
  const value = useContext(AppLockContext);
  if (!value) throw new Error('useAppLock outside AppLockProvider');
  return value;
}

/** Called on sign-out: the next farmer to sign in chooses again. */
export async function forgetAppLock() {
  await SecureStore.deleteItemAsync(KEY);
}

async function deviceCanUnlock() {
  return (await LocalAuthentication.getEnrolledLevelAsync()) !== LocalAuthentication.SecurityLevel.NONE;
}

export function AppLockProvider({ active, onSignOut, children }: { active: boolean; onSignOut: () => void; children: ReactNode }) {
  const [enabled, setEnabled] = useState(() => SecureStore.getItem(KEY) === 'true');
  const [locked, setLocked] = useState(enabled);
  const backgroundedAt = useRef<number | null>(null);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') backgroundedAt.current = Date.now();
      if (state === 'active' && backgroundedAt.current && Date.now() - backgroundedAt.current > RELOCK_AFTER_MS) {
        setLocked(enabled);
      }
    });
    return () => sub.remove();
  }, [enabled]);

  const enable = useCallback(async (): Promise<{ ok: true } | { ok: false; message: string }> => {
    if (!(await deviceCanUnlock())) {
      return { ok: false, message: 'This phone has no screen lock. Set a PIN, pattern, fingerprint or face unlock in the phone settings first.' };
    }
    const result = await LocalAuthentication.authenticateAsync({ promptMessage: 'Confirm to turn on app lock' });
    if (!result.success) return { ok: false, message: 'App lock was not turned on.' };
    await SecureStore.setItemAsync(KEY, 'true');
    setEnabled(true);
    return { ok: true };
  }, []);

  const disable = useCallback(async () => {
    await SecureStore.deleteItemAsync(KEY);
    setEnabled(false);
    setLocked(false);
  }, []);

  return (
    <AppLockContext.Provider value={{ enabled, enable, disable }}>
      {active && locked ? <LockScreen onUnlocked={() => setLocked(false)} onSignOut={onSignOut} /> : children}
    </AppLockContext.Provider>
  );
}

function LockScreen({ onUnlocked, onSignOut }: { onUnlocked: () => void; onSignOut: () => void }) {
  const t = useTheme();
  const [error, setError] = useState<string | null>(null);

  const prompt = useCallback(async () => {
    const result = await LocalAuthentication.authenticateAsync({ promptMessage: 'Unlock Dairy Farm' });
    if (result.success) onUnlocked();
    else if (result.error !== 'user_cancel' && result.error !== 'system_cancel') setError('Could not unlock. Try again.');
  }, [onUnlocked]);

  // Ask straight away when the lock screen appears. This opens the phone's own prompt (an
  // external system); state changes only after the farmer answers it.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void prompt();
  }, [prompt]);

  const unlock = () => {
    setError(null);
    void prompt();
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.background, justifyContent: 'center', padding: spacing.lg }}>
      <View style={{ gap: spacing.md }}>
        <BrandMark />
        <Text accessibilityRole="header" style={{ color: t.text, ...type.screenTitle }}>
          Dairy Farm is locked
        </Text>
        <Text style={{ color: t.textMuted, ...type.body }}>Use your phone’s fingerprint, face or screen lock to continue.</Text>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Button label="Unlock" onPress={unlock} />
        <Button label="Sign out instead" variant="link" onPress={onSignOut} hint="You will need your email and password to sign in again" />
      </View>
    </SafeAreaView>
  );
}
