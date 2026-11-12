import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { authMessage, MIN_PASSWORD } from '../lib/authErrors';
import { supabase } from '../lib/supabase';
import { useAuth } from '../state/auth';
import { Button, FormScreen, Notice, TextField } from '../ui/form';
import { type, useTheme } from '../ui/theme';

// Two ways in, both outside the sign-in guards so the screen stays open until the password is saved:
//  - the reset link from the email opens it with ?code=… (PKCE): the code becomes a session on this phone;
//  - "Change password" in Security opens it while signed in.

type Stage = 'opening' | 'ready' | 'failed';

export default function ResetPassword() {
  const t = useTheme();
  const { status } = useAuth();
  const params = useLocalSearchParams<{ code?: string; error_description?: string }>();
  const [stage, setStage] = useState<Stage>(params.code ? 'opening' : status === 'signedIn' ? 'ready' : 'failed');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(params.error_description ?? null);
  const [busy, setBusy] = useState(false);

  // Turns the link's one-time code into a session (an external call; state is set from its result).
  useEffect(() => {
    if (!params.code) return;
    supabase.auth.exchangeCodeForSession(params.code).then(({ error: err }) => {
      if (err) {
        setError('This link has expired or was opened on another phone. Ask for a new one on this phone.');
        setStage('failed');
      } else setStage('ready');
    });
  }, [params.code]);

  async function submit() {
    if (password.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters.`);
    if (password !== confirm) return setError('Passwords do not match.');
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (err) return setError(authMessage(err));
    router.replace('/');
  }

  if (stage === 'opening') {
    return (
      <FormScreen card standalone title="Choose a new password">
        <Text style={{ color: t.textMuted, ...type.bodySmall }}>Checking your reset link…</Text>
      </FormScreen>
    );
  }

  if (stage === 'failed') {
    return (
      <FormScreen card standalone title="Choose a new password">
        <Notice tone="error">{error ?? 'Open the reset link from your email on this phone.'}</Notice>
        <Button label="Ask for a new link" onPress={() => router.replace('/forgot-password')} />
        <Button label="Back to sign in" variant="text" onPress={() => router.replace('/sign-in')} />
      </FormScreen>
    );
  }

  return (
    <FormScreen card standalone title="Choose a new password" intro="You will stay signed in on this phone.">
      {error ? <Notice tone="error">{error}</Notice> : null}
      <TextField label="New password" hint={`At least ${MIN_PASSWORD} characters`} value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" textContentType="newPassword" />
      <TextField label="Confirm new password" value={confirm} onChangeText={setConfirm} secureTextEntry autoComplete="new-password" textContentType="newPassword" onSubmitEditing={submit} />
      <Button label="Save new password" onPress={submit} busy={busy} />
      <Button label="Cancel" variant="text" onPress={() => router.replace('/')} />
    </FormScreen>
  );
}
