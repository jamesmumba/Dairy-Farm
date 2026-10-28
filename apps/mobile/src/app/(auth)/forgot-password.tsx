import { useState } from 'react';
import { authMessage, isEmail } from '../../lib/authErrors';
import { RESET_REDIRECT } from '../../lib/pendingSignUp';
import { supabase } from '../../lib/supabase';
import { Button, FormScreen, Notice, TextField } from '../../ui/form';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!isEmail(email)) return setError('Enter a valid email address.');
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: RESET_REDIRECT });
    setBusy(false);
    if (err) return setError(authMessage(err));
    // Same message whether or not the account exists (no account enumeration).
    setSent(true);
  }

  return (
    <FormScreen card standalone title="Reset your password" intro="Enter your account email. If an account exists, we will email you a link to choose a new password.">
      {error ? <Notice tone="error">{error}</Notice> : null}
      {sent ? (
        <Notice tone="success" title="Check your email">
          Open the link on this phone: it brings you back here to choose a new password. Check your spam folder too.
        </Notice>
      ) : null}
      <TextField label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" onSubmitEditing={submit} />
      <Button label={sent ? 'Send the link again' : 'Send reset link'} onPress={submit} busy={busy} />
    </FormScreen>
  );
}
