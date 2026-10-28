import { router } from 'expo-router';
import { useState } from 'react';
import { authMessage, isEmail } from '../../lib/authErrors';
import { EMAIL_CONFIRMED_URL } from '../../lib/pendingSignUp';
import { supabase } from '../../lib/supabase';
import { Button, FormScreen, Notice, TextField } from '../../ui/form';

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!isEmail(email) || !password) return setError('Enter your email and password.');
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (!err) return; // the layout moves on once the session exists
    if (err.code === 'email_not_confirmed') {
      await supabase.auth.resend({ type: 'signup', email: email.trim(), options: { emailRedirectTo: EMAIL_CONFIRMED_URL } });
      return router.push({ pathname: '/verify-email', params: { email: email.trim() } });
    }
    setError(authMessage(err));
  }

  return (
    <FormScreen card standalone title="Sign in" intro="Keep your herd, milk, health and sales records in one place.">
      {error ? <Notice tone="error">{error}</Notice> : null}
      <TextField label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" />
      <TextField label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" textContentType="password" onSubmitEditing={submit} />
      <Button label="Sign in" onPress={submit} busy={busy} />
      <Button label="Forgot password?" variant="link" onPress={() => router.push('/forgot-password')} />
      <Button label="Create an account" variant="secondary" onPress={() => router.push('/sign-up')} />
    </FormScreen>
  );
}
