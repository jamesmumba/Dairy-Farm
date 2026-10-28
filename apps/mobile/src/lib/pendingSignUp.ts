// The email and password just used to sign up, held in memory only (never stored or put in a URL),
// so "I've tapped the link" can sign the farmer straight in. Lost if the app restarts; then they sign in.

import { config } from '../config';

let pending: { email: string; password: string } | null = null;

export const setPendingSignUp = (email: string, password: string) => {
  pending = { email, password };
};
export const takePendingSignUp = () => pending;
export const clearPendingSignUp = () => {
  pending = null;
};

/** Where the confirmation link lands after Supabase has confirmed the address: a plain "go back to the app" page. */
export const EMAIL_CONFIRMED_URL = `${config.apiUrl.replace(/\/$/, '')}/email-confirmed`;
