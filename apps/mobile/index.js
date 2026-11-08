// Entry point. Before loading the app, check the phone has the native parts it is built on.
// Without them every screen would crash on import (dozens of identical errors and a blank app);
// instead the farmer sees one screen that says what is wrong.
import { requireOptionalNativeModule } from 'expo';

const REQUIRED = ['ExpoSQLite', 'ExpoCrypto', 'ExpoSecureStore'];
const missing = REQUIRED.filter((name) => !requireOptionalNativeModule(name));

if (missing.length) {
  require('./src/startup/missingNative').show(missing);
} else {
  require('expo-router/entry');
}
