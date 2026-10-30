import { router } from 'expo-router';
import { Alert } from 'react-native';
import { NetworkError } from '../lib/api';
import { friendlyError } from '../lib/errors';
import { useAuth } from '../state/auth';
import { getSyncStatus, runSync } from '../sync/engine';

const changes = (n: number) => `${n} change${n === 1 ? '' : 's'}`;

/**
 * Asks before signing out. Sign-out removes the farm records from this phone, so changes that have not
 * reached the account yet are offered a sync first, and ones the account refused are offered for review.
 */
export function useConfirmSignOut() {
  const { signOut } = useAuth();

  function go(scope: 'local' | 'global') {
    signOut(scope).catch((err) =>
      Alert.alert(
        'Could not sign out the other phones',
        err instanceof NetworkError ? 'This needs the internet. Connect and try again. This phone is still signed in.' : friendlyError(err),
      ),
    );
  }

  return function confirm(scope: 'local' | 'global', triedSync = false) {
    const { pending, failed } = getSyncStatus();
    const title = scope === 'global' ? 'Sign out on all phones?' : 'Sign out?';
    const cancel = { text: 'Cancel', style: 'cancel' as const };
    const anyway = { text: 'Sign out anyway', style: 'destructive' as const, onPress: () => go(scope) };

    if (pending) {
      return Alert.alert(
        title,
        triedSync
          ? `${changes(pending)} still could not reach your account. Connect to the internet and try again. Signing out now loses ${pending === 1 ? 'it' : 'them'}.`
          : `${changes(pending)} on this phone ${pending === 1 ? 'has' : 'have'} not reached your account yet. Signing out now loses ${pending === 1 ? 'it' : 'them'}.`,
        [cancel, { text: triedSync ? 'Try again' : 'Sync first', onPress: () => void runSync().then(() => confirm(scope, true)) }, anyway],
      );
    }
    if (failed) {
      return Alert.alert(title, `${changes(failed)} your account did not accept ${failed === 1 ? 'is' : 'are'} waiting in Sync issues. Signing out loses ${failed === 1 ? 'it' : 'them'}.`, [
        cancel,
        { text: 'Review', onPress: () => router.push('/sync-issues') },
        anyway,
      ]);
    }
    Alert.alert(
      title,
      scope === 'global'
        ? 'Every phone on your account will need your email and password again. Your records stay in your account.'
        : 'Your records are saved to your account and will be removed from this phone. Sign in again to get them back.',
      [cancel, { text: 'Sign out', style: 'destructive', onPress: () => go(scope) }],
    );
  };
}
