// This phone, as the account knows it: an id made up on first launch and a name the farmer recognises.
// Both are sent with every API request, so the account can list its phones, sign one out, and say in the
// audit history which phone made a change. They stay on the phone across sign-outs (see clearLocalData).

import Constants from 'expo-constants';
import { randomUUID } from 'expo-crypto';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { getJson, setJson } from './localDb';

const ID = 'device.id';
const NAME = 'device.name'; // both kept by clearLocalData

export function deviceId(): string {
  let id = getJson<string>(ID);
  if (!id) {
    id = randomUUID();
    setJson(ID, id);
  }
  return id;
}

/** What the phone calls itself ("Galaxy A14"), else its make and model. */
export function defaultDeviceName(): string {
  const name = Device.deviceName?.trim() || [Device.manufacturer, Device.modelName].filter(Boolean).join(' ');
  return (name || 'Phone').slice(0, 60);
}

export function deviceName(): string {
  return getJson<string>(NAME) ?? defaultDeviceName();
}

/** The farmer's own name for this phone ("Grace's phone"); blank goes back to the phone's own name. */
export function setDeviceName(name: string) {
  const trimmed = name.trim().slice(0, 60);
  setJson(NAME, trimmed || null);
}

export function deviceHeaders(): Record<string, string> {
  return {
    'X-Device-Id': deviceId(),
    'X-Device-Name': encodeURIComponent(deviceName()),
    'X-Device-Platform': Platform.OS,
    'X-App-Version': Constants.expoConfig?.version ?? '',
  };
}
