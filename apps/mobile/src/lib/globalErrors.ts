// Errors that happen outside drawing a screen (a button's save, a timer) never reach the crash screen.
// In a release build React Native would drop them silently or close the app, so the farmer would not know
// whether a save worked. Here they are told, in plain words. Development builds keep the red error screen.

import { Alert } from 'react-native';
import { SOMETHING_WENT_WRONG } from './errors';

type Handler = (error: unknown, isFatal?: boolean) => void;
declare const ErrorUtils: { getGlobalHandler(): Handler; setGlobalHandler(h: Handler): void } | undefined;
declare const HermesInternal:
  | { enablePromiseRejectionTracker?(o: { allRejections: boolean; onUnhandled(id: number, error: unknown): void }): void }
  | undefined;

let lastShown = 0;
function tell(error: unknown) {
  console.error(error);
  // One message is enough when several things fail together.
  if (Date.now() - lastShown < 3000) return;
  lastShown = Date.now();
  Alert.alert('Something went wrong', SOMETHING_WENT_WRONG);
}

export function installGlobalErrorHandlers() {
  if (__DEV__) return;
  if (typeof ErrorUtils !== 'undefined') {
    const fallback = ErrorUtils.getGlobalHandler();
    // A fatal error still closes the app as before; anything else is reported and the app carries on.
    ErrorUtils.setGlobalHandler((error, isFatal) => (isFatal ? fallback(error, isFatal) : tell(error)));
  }
  if (typeof HermesInternal !== 'undefined') {
    HermesInternal?.enablePromiseRejectionTracker?.({ allRejections: true, onUnhandled: (_id, error) => tell(error) });
  }
}
