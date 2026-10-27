import { isAuthRetryableFetchError, type AuthError } from '@supabase/supabase-js';

export const MIN_PASSWORD = 8;

/** Plain-language auth errors. Messages never reveal whether an account exists. */
export function authMessage(error: AuthError): string {
  if (isAuthRetryableFetchError(error)) return 'No connection. Check your internet and try again.';
  switch (error.code) {
    case 'invalid_credentials':
      return 'Email or password is incorrect.';
    case 'otp_expired':
      return 'That code is wrong or has expired. Request a new code.';
    case 'weak_password':
      return `Choose a stronger password (at least ${MIN_PASSWORD} characters, not a common word).`;
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return 'Too many attempts. Wait a few minutes and try again.';
    case 'same_password':
      return 'Choose a password different from your old one.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
