import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { authMessage } from '../../lib/authErrors';
import { clearPendingSignUp, EMAIL_CONFIRMED_URL, takePendingSignUp } from '../../lib/pendingSignUp';
import { supabase } from '../../lib/supabase';
import { Button, FormScreen, Notice } from '../../ui/form';

// Sign-up is confirmed by Supabase's email link. The farmer taps it (on this phone or any other device),
// comes back, and taps "I've confirmed my email"; we sign them in with what they just typed.

export default function VerifyEmail() {
  const { email } = useLocalSearchParams<{ email: string }>();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function continueAfterLink() {
    const pending = takePendingSignUp();
    if (!pending || pending.email !== email) return router.replace('/sign-in'); // app restarted: sign in as usual
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword(pending);
    setBusy(false);
    if (!err) return clearPendingSignUp(); // the layout opens onboarding
    setError(err.code === 'email_not_confirmed' ? 'Not confirmed yet. Tap the link in the email first, then come back here.' : authMessage(err));
  }

  async function resend() {
    setError(null);
    const { error: err } = await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: EMAIL_CONFIRMED_URL } });
    if (err) setError(authMessage(err));
    else setInfo('A new email is on its way. Check your spam folder too.');
  }

  return (
    <FormScreen card standalone title="Check your email" intro={`We sent a confirmation link to ${email}. Tap it, then come back to this app.`}>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {info ? <Notice>{info}</Notice> : null}
      <Button label="I've confirmed my email" onPress={continueAfterLink} busy={busy} />
      <Button label="Send the email again" variant="link" onPress={resend} />
      <Button label="Back to sign in" variant="link" onPress={() => router.replace('/sign-in')} />
    </FormScreen>
  );
}
