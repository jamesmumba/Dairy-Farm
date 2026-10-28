import { router } from 'expo-router';
import { useState } from 'react';
import { authMessage, isEmail } from '../../lib/authErrors';
import { supabase } from '../../lib/supabase';
import { Button, FormScreen, Notice, TextField } from '../../ui/form';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!isEmail(email)) return setError('Enter a valid email address.');
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim());
    setBusy(false);
    if (err) return setError(authMessage(err));
    router.push({ pathname: '/reset-password', params: { email: email.trim() } });
  }

  return (
    <FormScreen card standalone title="Reset your password" intro="Enter your account email. If an account exists, we will send a 6-digit code to reset your password.">
      {error ? <Notice tone="error">{error}</Notice> : null}
      <TextField label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" onSubmitEditing={submit} />
      <Button label="Send code" onPress={submit} busy={busy} />
    </FormScreen>
  );
}
