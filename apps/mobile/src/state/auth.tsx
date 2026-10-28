import type { Session } from '@supabase/supabase-js';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { FarmerAccount, ProfilePatch } from '../lib/account';
import { api, ApiError } from '../lib/api';
import { clearLocalData, getJson, setJson } from '../lib/localDb';
import { supabase } from '../lib/supabase';
import { forgetDevices, refreshDevicesQuietly } from '../lib/devicesStore';
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

  const signOut = useCallback(async (scope: 'local' | 'global' = 'local') => {
    await supabase.auth.signOut({ scope });
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
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
