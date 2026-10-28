// The farmer's choice of light or dark look, kept on this phone. "System" follows the phone's setting.
// Applied through React Native's app-wide override, so the native calendar and status bar follow it too.

import { useSyncExternalStore } from 'react';
import { Appearance } from 'react-native';
import { getJson, setJson } from '../lib/localDb';

export type AppearanceChoice = 'system' | 'light' | 'dark';

const KEY = 'appearance';
const listeners = new Set<() => void>();
let choice: AppearanceChoice = getJson<AppearanceChoice>(KEY) ?? 'system';

const apply = () => Appearance.setColorScheme(choice === 'system' ? 'auto' : choice);

/** Called once at start-up, before the first screen draws. */
export function applySavedAppearance() {
  apply();
}

export function setAppearance(next: AppearanceChoice) {
  choice = next;
  setJson(KEY, next);
  apply();
  listeners.forEach((l) => l());
}

export function useAppearanceChoice(): AppearanceChoice {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => choice,
  );
}
