import { registerRootComponent } from 'expo';
import { Text, useColorScheme, View } from 'react-native';
import { dark, light } from '../ui/palette';

// Shown instead of the app when the phone's app shell lacks a native part the app needs: usually an
// Expo Go session that lost its connection, or an outdated Expo Go. Imports nothing that touches
// SQLite or other native modules, so it always renders.
export function show(missing: string[]) {
  function MissingNative() {
    const t = useColorScheme() === 'dark' ? dark : light;
    return (
      <View style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 12, backgroundColor: t.background }}>
        <Text accessibilityRole="header" style={{ color: t.text, fontSize: 24, fontWeight: '600' }}>
          The app can’t start on this phone
        </Text>
        <Text style={{ color: t.text, fontSize: 16 }}>
          Parts of the app that should be built in are missing. Close the app completely and open it again. If you opened it
          from Expo Go, update Expo Go or install the Dairy Farm app instead.
        </Text>
        <Text selectable style={{ color: t.textMuted, fontSize: 13, fontFamily: 'monospace' }}>
          Missing: {missing.join(', ')}
        </Text>
      </View>
    );
  }
  registerRootComponent(MissingNative);
}
