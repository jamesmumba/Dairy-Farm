import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Text } from 'react-native';
import { useAppLock } from '../state/appLock';
import { useDevices } from '../lib/devicesStore';
import { useAuth } from '../state/auth';
import { useSyncStatus } from '../sync/engine';
import { FormScreen, Notice, Toggle } from '../ui/form';
import { Card, ListGroup, ListRow } from '../ui/kit';
import { useTheme } from '../ui/theme';

export default function Security() {
  const t = useTheme();
  const { email, signOut } = useAuth();
  const lock = useAppLock();
  const sync = useSyncStatus();
  const devices = useDevices();
  const [message, setMessage] = useState<string | null>(null);

  async function toggleLock(on: boolean) {
    setMessage(null);
    if (!on) return lock.disable();
    const result = await lock.enable();
    if (!result.ok) setMessage(result.message);
  }

  // Already signed in, so no email is needed: the reset screen sets the new password directly.
  const changePassword = () => router.push('/reset-password');

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
      <Text style={{ color: t.textMuted, fontSize: 14 }}>Signed in as {email}</Text>
      <Card>
        <Toggle label="App lock" hint="Fingerprint, face or screen lock when opening the app" value={lock.enabled} onChange={toggleLock} />
      </Card>
      <ListGroup>
        <ListRow icon="key-outline" title="Change password" subtitle="Choose a new one on the next screen" onPress={changePassword} />
        <ListRow
          icon="cellphone-link"
          title="Signed-in phones"
          subtitle={devices.length > 1 ? `${devices.length} phones use this account` : 'See and sign out other phones'}
          href="/devices"
        />
        <ListRow icon="logout" title="Sign out" onPress={() => confirmSignOut('local')} />
        <ListRow icon="cellphone-remove" tint="red" title="Sign out on all devices" onPress={() => confirmSignOut('global')} />
      </ListGroup>
    </FormScreen>
  );
}
