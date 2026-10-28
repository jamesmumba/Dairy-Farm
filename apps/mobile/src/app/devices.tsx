import { useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { deviceName, setDeviceName } from '../lib/device';
import { lastUsed, platformLabel, type SignedInDevice } from '../lib/devices';
import { refreshDevices, signOutDevice, signOutOtherDevices, useDevices } from '../lib/devicesStore';
import { runSync } from '../sync/engine';
import { Button, FormScreen, Notice, TextField } from '../ui/form';
import { Card, ListGroup, ListRow, SectionHeader } from '../ui/kit';
import { spacing, useTheme } from '../ui/theme';

// Phones signed in to this account: rename this one, see when the others were last used, and sign
// out any that should not have access (a lost phone, a worker who has left).

export default function Devices() {
  const t = useTheme();
  const devices = useDevices();
  const [now] = useState(() => new Date());
  const [name, setName] = useState(deviceName);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);

  useEffect(() => {
    refreshDevices().catch(() => setMessage({ tone: 'error', text: 'Can’t reach your account right now. This is the list from the last sync.' }));
  }, []);

  const me = devices.find((d) => d.this_device);
  const others = devices.filter((d) => !d.this_device);

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      setMessage({ tone: 'info', text: done });
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof Error ? err.message : 'Something went wrong. Try again.' });
    } finally {
      setBusy(false);
    }
  }

  function saveName() {
    setDeviceName(name);
    setName(deviceName());
    // The account learns the new name with the next request.
    void run(async () => {
      await runSync();
      await refreshDevices();
    }, 'Name saved.');
  }

  const warning = 'It will need your email and password to use the account again. Changes made on it that have not synced yet are lost.';
  const confirmOne = (d: SignedInDevice) =>
    Alert.alert(`Sign out ${d.name}?`, warning, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => run(() => signOutDevice(d.device_id), `${d.name} is signed out.`) },
    ]);
  const confirmAll = () =>
    Alert.alert('Sign out all other phones?', `Only this phone stays signed in. ${warning}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out others', style: 'destructive', onPress: () => run(signOutOtherDevices, 'Every other phone is signed out.') },
    ]);

  return (
    <FormScreen title="Signed-in phones">
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

      <SectionHeader title="This phone" />
      <Card>
        <View style={{ gap: spacing.md }}>
          <TextField label="Name" hint="How this phone shows on your other phones and in the history" value={name} onChangeText={setName} maxLength={60} onSubmitEditing={saveName} />
          <Button label="Save name" variant="secondary" onPress={saveName} busy={busy} />
          {me ? (
            <Text style={{ color: t.textMuted, fontSize: 14 }}>
              {platformLabel(me.platform)}
              {me.app_version ? `, app ${me.app_version}` : ''}
            </Text>
          ) : null}
        </View>
      </Card>

      <SectionHeader title={others.length ? `Other phones (${others.length})` : 'Other phones'} />
      {others.length ? (
        <>
          <ListGroup>
            {others.map((d) => (
              <ListRow
                key={d.device_id}
                icon={d.platform === 'web' ? 'monitor' : 'cellphone'}
                title={d.name}
                subtitle={`${platformLabel(d.platform)}. ${lastUsed(d.last_seen, now)}`}
                value="Sign out"
                valueTone="danger"
                onPress={() => confirmOne(d)}
              />
            ))}
          </ListGroup>
          {others.length > 1 ? <Button label="Sign out all other phones" variant="danger" onPress={confirmAll} busy={busy} /> : null}
          <Text style={{ color: t.textMuted, fontSize: 14 }}>A phone you don’t recognise? Sign it out, then change your password under Security.</Text>
        </>
      ) : (
        <Notice>Only this phone is signed in to your account.</Notice>
      )}
    </FormScreen>
  );
}
