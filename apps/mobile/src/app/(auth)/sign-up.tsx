import { router } from 'expo-router';
import { useState } from 'react';
import { authMessage, isEmail, MIN_PASSWORD } from '../../lib/authErrors';
import { EMAIL_CONFIRMED_URL, setPendingSignUp } from '../../lib/pendingSignUp';
import { supabase } from '../../lib/supabase';
import { Button, FormScreen, Notice, TextField } from '../../ui/form';

export default function SignUp() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string; confirm?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  async function submit() {
    const next: typeof errors = {};
    if (!isEmail(email)) next.email = 'Enter a valid email address.';
    if (password.length < MIN_PASSWORD) next.password = `Use at least ${MIN_PASSWORD} characters.`;
    if (confirm !== password) next.confirm = 'Passwords do not match.';
    setErrors(next);
    if (Object.keys(next).length) return;

    setBusy(true);
    const { error } = await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: EMAIL_CONFIRMED_URL } });
    setBusy(false);
    if (error) return setErrors({ form: authMessage(error) });
    setPendingSignUp(email.trim(), password);
    // Same next step whether or not the email is already registered (no account enumeration).
    router.push({ pathname: '/verify-email', params: { email: email.trim() } });
  }

  return (
    <FormScreen card standalone title="Create your account" intro="We will email you a link to confirm your address. Your email is used to sign in and to recover your account.">
      {errors.form ? <Notice tone="error">{errors.form}</Notice> : null}
      <TextField label="Email" value={email} onChangeText={setEmail} error={errors.email} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" />
      <TextField label="Password" hint={`At least ${MIN_PASSWORD} characters`} value={password} onChangeText={setPassword} error={errors.password} secureTextEntry autoComplete="new-password" textContentType="newPassword" />
      <TextField label="Confirm password" value={confirm} onChangeText={setConfirm} error={errors.confirm} secureTextEntry autoComplete="new-password" textContentType="newPassword" />
      <Button label="Create account" onPress={submit} busy={busy} />
      <Button label="I already have an account" variant="link" onPress={() => router.back()} />
    </FormScreen>
  );
}
