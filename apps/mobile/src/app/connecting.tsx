import { useAuth } from '../state/auth';
import { runSync, useSyncStatus } from '../sync/engine';
import { Button, FormScreen, Notice } from '../ui/form';

// Signed in, but this phone has never loaded the account (first sign-in while offline).
export default function Connecting() {
  const { signOut } = useAuth();
  const sync = useSyncStatus();
  return (
    <FormScreen title="Setting up your account" intro="Your account needs to be loaded once with an internet connection. After that, you can keep working offline.">
      {sync.state === 'offline' ? <Notice tone="error">No connection. Connect to mobile data or Wi-Fi, then try again.</Notice> : null}
      {sync.state === 'attention' && sync.message ? <Notice tone="error">{sync.message}</Notice> : null}
      <Button label="Try again" onPress={() => void runSync()} busy={sync.state === 'syncing'} />
      <Button label="Sign out" variant="link" onPress={() => signOut()} />
    </FormScreen>
  );
}
