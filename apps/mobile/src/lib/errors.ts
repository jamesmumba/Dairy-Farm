// What the farmer is told when something fails. Messages from the API are already written for farmers;
// anything else (a bug, a phone storage error) must never show its technical text ("Cannot convert …").

import { ApiError, NetworkError } from './api';

export const SOMETHING_WENT_WRONG = 'Something went wrong. What you saved before is safe. Try again.';

/** One plain sentence for an error, or `fallback` when there is nothing better to say. */
export function friendlyError(err: unknown, fallback = SOMETHING_WENT_WRONG): string {
  if (err instanceof NetworkError) return 'No connection right now. Your changes are kept on this phone and sent when you are back online.';
  if (err instanceof ApiError) {
    if (err.status === 401) return err.code === 'signed_out' ? err.message : 'Your sign-in has expired. Sign in again.';
    if (err.status === 429) return 'Too many requests at once. Wait a minute and try again.';
    if (err.status >= 500) return 'Your farm account could not be reached properly. Your changes are kept on this phone. Try again in a few minutes.';
    return err.message || fallback;
  }
  return fallback;
}

/** Technical detail for the crash screen's "Show details" (and for someone helping the farmer). */
export function errorDetails(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}
