import { useState } from 'react';
import { Alert, Text } from 'react-native';
import { api, NetworkError } from '../lib/api';
import type { FarmerAccount } from '../lib/account';
import { useAuth } from '../state/auth';
import { runSync } from '../sync/engine';
import { Button, FormScreen, Notice, TextField } from '../ui/form';
import { useTheme } from '../ui/theme';

export default function DeleteAccount() {
  const t = useTheme();
  const { account } = useAuth();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (account?.deletion_requested_at) {
    return (
      <FormScreen title="Deletion requested">
        <Notice>
          We received your request on {new Date(account.deletion_requested_at).toLocaleDateString()}. Your account stays usable until the
          request is processed. We will contact you by email before anything is deleted.
        </Notice>
      </FormScreen>
    );
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api<FarmerAccount>('/v1/me/deletion-request', { method: 'POST', body: reason.trim() ? { reason: reason.trim() } : {} });
      await runSync();
    } catch (err) {
      setError(err instanceof NetworkError ? 'No connection. Try again when you are connected.' : 'Could not send the request. Try again.');
    } finally {
      setBusy(false);
    }
  }

  function confirm() {
    Alert.alert('Request account deletion?', 'Your herd, production, health, sales and other records will be deleted when the request is processed.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Request deletion', style: 'destructive', onPress: submit },
    ]);
  }

  return (
    <FormScreen title="Delete account">
      <Text style={{ color: t.text, fontSize: 16 }}>
        Deleting your account erases all your records, photos and your sign-in from our service. Only an anonymous note that a
        deletion happened is kept, and backups containing your data expire within 30 days.
      </Text>
      <Text style={{ color: t.text, fontSize: 16 }}>Before you continue, export any records you want to keep (More › Reports and exports).</Text>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <TextField label="Reason (optional)" value={reason} onChangeText={setReason} multiline />
      <Button label="Request account deletion" variant="danger" onPress={confirm} busy={busy} />
    </FormScreen>
  );
}
