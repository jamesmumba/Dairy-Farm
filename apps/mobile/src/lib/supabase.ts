import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';
import { config } from '../config';
import { secureStorage } from './secureStorage';

// Used for Auth only. Farm data goes through the API (the Data API is locked out).
export const supabase = createClient(config.supabaseUrl, config.supabaseKey, {
  auth: {
    storage: secureStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: 'pkce',
  },
});

// Only refresh tokens while the app is in the foreground.
AppState.addEventListener('change', (state) => {
  if (state === 'active') supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});
