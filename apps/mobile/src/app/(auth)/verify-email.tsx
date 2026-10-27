import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { authMessage } from '../../lib/authErrors';
import { supabase } from '../../lib/supabase';
import { Button, FormScreen, Notice, TextField } from '../../ui/form';

export default function VerifyEmail() {
  const { email } = useLocalSearchParams<{ email: string }>();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function verify() {
    if (!/^\d{6}$/.test(code.trim())) return setError('Enter the 6-digit code from the email.');
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.verifyOtp({ email, token: code.trim(), type: 'email' });
    setBusy(false);
    if (err) setError(authMessage(err)); // on success the layout opens onboarding
  }

  async function resend() {
    setError(null);
    const { error: err } = await supabase.auth.resend({ type: 'signup', email });
    if (err) setError(authMessage(err));
    else setInfo('A new code is on its way. Check your spam folder too.');
  }

  return (
    <FormScreen title="Check your email" intro={`Enter the 6-digit code we sent to ${email}.`}>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {info ? <Notice>{info}</Notice> : null}
      <TextField label="Code" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} autoComplete="one-time-code" textContentType="oneTimeCode" onSubmitEditing={verify} />
      <Button label="Confirm email" onPress={verify} busy={busy} />
      <Button label="Send a new code" variant="link" onPress={resend} />
    </FormScreen>
  );
}
