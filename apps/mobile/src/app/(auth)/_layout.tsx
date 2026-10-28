import { Stack } from 'expo-router';
import { screenLayout } from '../../ui/ScreenErrorBoundary';

export const unstable_settings = { initialRouteName: 'sign-in' };

export default function AuthLayout() {
  return <Stack screenLayout={screenLayout} screenOptions={{ headerShown: false }} />;
}
