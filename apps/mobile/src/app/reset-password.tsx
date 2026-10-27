import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { authMessage, MIN_PASSWORD } from '../lib/authErrors';
import { supabase } from '../lib/supabase';
import { Button, FormScreen, Notice, TextField } from '../ui/form';

// Outside the sign-in guards: verifying the code signs the farmer in, and this screen must
// stay open until the new password is saved. Also used for "Change password" when signed in.
export default function ResetPassword() {
  const { email } = useLocalSearchParams<{ email: string }>();
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!/^\d{6}$/.test(code.trim())) return setError('Enter the 6-digit code from the email.');
    if (password.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters.`);
    if (password !== confirm) return setError('Passwords do not match.');
    setBusy(true);
    setError(null);
    const verified = await supabase.auth.verifyOtp({ email, token: code.trim(), type: 'recovery' });
    const updated = verified.error ? verified : await supabase.auth.updateUser({ password });
    setBusy(false);
    if (updated.error) return setError(authMessage(updated.error));
    router.replace('/');
  }

  return (
    <FormScreen standalone title="Choose a new password" intro={`Enter the 6-digit code we sent to ${email} and your new password.`}>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <TextField label="Code" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} autoComplete="one-time-code" textContentType="oneTimeCode" />
      <TextField label="New password" hint={`At least ${MIN_PASSWORD} characters`} value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" textContentType="newPassword" />
      <TextField label="Confirm new password" value={confirm} onChangeText={setConfirm} secureTextEntry autoComplete="new-password" textContentType="newPassword" />
      <Button label="Save new password" onPress={submit} busy={busy} />
      <Button label="Cancel" variant="link" onPress={() => router.back()} />
    </FormScreen>
  );
}
