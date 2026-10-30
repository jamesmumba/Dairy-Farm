import type { Session } from '@supabase/supabase-js';
import * as Notifications from 'expo-notifications';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { FarmerAccount, ProfilePatch } from '../lib/account';
import { api, ApiError, noteSignedOutHere } from '../lib/api';
import { clearLocalData, getJson, setJson } from '../lib/localDb';
import { supabase } from '../lib/supabase';
import { forgetDevices, refreshDevicesQuietly, signOutOtherDevices } from '../lib/devicesStore';
import { forgetAppLock } from './appLock';
import { addPullHook, resetSyncStatus, runSync, startSyncTriggers } from '../sync/engine';

interface CachedAccount {
  authUserId: string;
  account: FarmerAccount;
}

interface AuthValue {
  status: 'loading' | 'signedOut' | 'signedIn';
  email: string | null;
  account: FarmerAccount | null;
  /** Throws NetworkError when offline and ApiError (409 carries `current`) on rejection. */
  updateAccount(patch: ProfilePatch, version?: number): Promise<FarmerAccount>;
  signOut(scope?: 'local' | 'global'): Promise<void>;
  signingOut: boolean;
}

const AuthContext = createContext<AuthValue | null>(null);

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth outside AuthProvider');
  return value;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [fetched, setFetched] = useState<CachedAccount | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const userId = session?.user.id ?? null;

  // The latest account from the server, else the copy saved on this phone (works offline).
  const account = useMemo(() => {
    if (!userId) return null;
    if (fetched?.authUserId === userId) return fetched.account;
    const cached = getJson<CachedAccount>('account');
    return cached?.authUserId === userId ? cached.account : null;
  }, [userId, fetched]);

  const storeAccount = useCallback(
    (next: FarmerAccount) => {
      if (!userId) return;
      const entry = { authUserId: userId, account: next } satisfies CachedAccount;
      setFetched(entry);
      setJson('account', entry);
    },
    [userId],
  );

  const updateAccount = useCallback(
    async (patch: ProfilePatch, version?: number) => {
      const current = account;
      if (!current) throw new Error('Account not loaded');
      try {
        const next = await api<FarmerAccount>('/v1/me', { method: 'PATCH', body: patch, ifMatch: version ?? current.version });
        storeAccount(next);
        return next;
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) storeAccount(err.body.current as FarmerAccount);
        throw err;
      }
    },
    [account, storeAccount],
  );

  /** Throws (NetworkError offline) only when signing out the other phones fails; this phone is then still signed in. */
  const signOut = useCallback(async (scope: 'local' | 'global' = 'local') => {
    setSigningOut(true);
    try {
      // The other phones need the server, so do them first: offline, nothing changes.
      if (scope === 'global') await signOutOtherDevices();
      noteSignedOutHere();
      // Best effort: take this phone off the account's list of signed-in phones.
      await api('/v1/devices/sign-out-this', { method: 'POST', timeoutMs: 5000 }).catch(() => {});
      // Clears the sign-in on this phone even offline; the SIGNED_OUT handler below removes the farm data.
      await supabase.auth.signOut({ scope: 'local' });
    } finally {
      setSigningOut(false);
    }
  }, []);

  // Session lifecycle.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      if (event === 'SIGNED_OUT') {
        // Farm data must not stay readable on a shared phone after sign-out.
        clearLocalData();
        resetSyncStatus();
        void forgetAppLock();
        forgetDevices();
        setFetched(null);
        // Reminders name the animals: none may fire or stay in the tray for the next person.
        void Notifications.cancelAllScheduledNotificationsAsync().catch(() => {});
        void Notifications.dismissAllNotificationsAsync().catch(() => {});
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // Signed in: sync records and the account.
  useEffect(() => {
    if (!userId) return;
    const removeHook = addPullHook(async () => storeAccount(await api<FarmerAccount>('/v1/me')));
    const removeDevicesHook = addPullHook(refreshDevicesQuietly);
    const stopTriggers = startSyncTriggers();
    void runSync();
    return () => {
      removeHook();
      removeDevicesHook();
      stopTriggers();
    };
  }, [userId, storeAccount]);

  const value: AuthValue = {
    status: session === undefined ? 'loading' : session ? 'signedIn' : 'signedOut',
    email: session?.user.email ?? null,
    account,
    updateAccount,
    signOut,
    signingOut,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
