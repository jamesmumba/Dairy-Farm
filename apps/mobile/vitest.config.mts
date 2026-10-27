import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const shim = (name: string) => fileURLToPath(new URL(`./test/shims/${name}.ts`, import.meta.url));

// Runs the real sync store and engine in Node: native Expo modules are replaced by small shims,
// and SQLite is Node's built-in node:sqlite (same SQL engine as expo-sqlite).
export default defineConfig({
  test: { include: ['test/**/*.test.ts'] },
  resolve: {
    alias: {
      'expo-sqlite': shim('expo-sqlite'),
      'expo-crypto': shim('expo-crypto'),
      'expo-file-system': shim('expo-file-system'),
      'react-native': shim('react-native'),
      '@react-native-community/netinfo': shim('netinfo'),
    },
  },
});
