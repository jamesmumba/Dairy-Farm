import { router } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { useAppLock } from '../state/appLock';
import { useDevices } from '../lib/devicesStore';
import { useAuth } from '../state/auth';
import { FormScreen, Notice, Toggle } from '../ui/form';
import { Card, ListGroup, ListRow } from '../ui/kit';
import { useTheme } from '../ui/theme';
import { useConfirmSignOut } from '../ui/useConfirmSignOut';

export default function Security() {
  const t = useTheme();
  const { email } = useAuth();
  const confirmSignOut = useConfirmSignOut();
  const lock = useAppLock();
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
        <ListRow icon="cellphone-remove" tint="red" title="Sign out on all phones" onPress={() => confirmSignOut('global')} />
      </ListGroup>
    </FormScreen>
  );
}
