import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Text } from 'react-native';
import { authMessage } from '../lib/authErrors';
import { supabase } from '../lib/supabase';
import { useAppLock } from '../state/appLock';
import { useAuth } from '../state/auth';
import { useSyncStatus } from '../sync/engine';
import { Button, FormScreen, Notice, Toggle } from '../ui/form';
import { useTheme } from '../ui/theme';

export default function Security() {
  const t = useTheme();
  const { email, signOut } = useAuth();
  const lock = useAppLock();
  const sync = useSyncStatus();
  const [message, setMessage] = useState<string | null>(null);

  async function toggleLock(on: boolean) {
    setMessage(null);
    if (!on) return lock.disable();
    const result = await lock.enable();
    if (!result.ok) setMessage(result.message);
  }

  async function changePassword() {
    if (!email) return;
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) return setMessage(authMessage(error));
    router.push({ pathname: '/reset-password', params: { email } });
  }

  function confirmSignOut(scope: 'local' | 'global') {
    Alert.alert(
      scope === 'global' ? 'Sign out everywhere?' : 'Sign out?',
      sync.pending + sync.failed > 0
        ? `${sync.pending + sync.failed} change${sync.pending + sync.failed === 1 ? ' has' : 's have'} not reached your account yet and will be lost if you sign out now. Connect to the internet and let them sync first.`
        : 'All your records are saved to your account. They will be removed from this phone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: () => signOut(scope) },
      ],
    );
  }

  return (
    <FormScreen title="Security">
      {message ? <Notice tone="error">{message}</Notice> : null}
      <Text style={{ color: t.textMuted, fontSize: 15 }}>Signed in as {email}</Text>
      <Toggle
        label="App lock"
        hint="Ask for fingerprint, face or screen lock when opening the app"
        value={lock.enabled}
        onChange={toggleLock}
      />
      <Button label="Change password" variant="secondary" onPress={changePassword} hint="We will email you a 6-digit code" />
      <Button label="Sign out" variant="secondary" onPress={() => confirmSignOut('local')} />
      <Button label="Sign out on all devices" variant="secondary" onPress={() => confirmSignOut('global')} />
    </FormScreen>
  );
}
