import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { AppLockProvider } from '../state/appLock';
import { AuthProvider, useAuth } from '../state/auth';
import { SyncHeader } from '../ui/SyncHeader';
import { useTheme } from '../ui/theme';
import { useNotificationScheduler } from '../care/useReminders';

function NotificationScheduler() {
  useNotificationScheduler();
  return null;
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="auto" />
      <Gate />
    </AuthProvider>
  );
}

function Gate() {
  const t = useTheme();
  const { status, account, signOut } = useAuth();

  if (status === 'loading') {
    return (
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: t.background }}>
        <ActivityIndicator accessibilityLabel="Loading" color={t.primary} />
      </View>
    );
  }

  const signedIn = status === 'signedIn';
  const onboarded = !!account?.onboarding_completed_at;
  const header = { headerShown: true, headerStyle: { backgroundColor: t.background }, headerTintColor: t.text, headerRight: () => <SyncHeader /> };

  return (
    <AppLockProvider key={signedIn ? 'in' : 'out'} active={signedIn} onSignOut={() => signOut()}>
      {signedIn && onboarded ? <NotificationScheduler /> : null}
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.background } }}>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Protected guard={signedIn && !account}>
          <Stack.Screen name="connecting" />
        </Stack.Protected>
        <Stack.Protected guard={signedIn && !!account && !onboarded}>
          <Stack.Screen name="onboarding" />
        </Stack.Protected>
        <Stack.Protected guard={signedIn && onboarded}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="settings" options={{ ...header, title: 'Profile and settings' }} />
          <Stack.Screen name="security" options={{ ...header, title: 'Security' }} />
          <Stack.Screen name="delete-account" options={{ ...header, title: 'Delete account' }} />
          <Stack.Screen name="animal/new" options={{ ...header, title: 'New animal' }} />
          <Stack.Screen name="animal/[id]/index" options={{ ...header, title: 'Animal' }} />
          <Stack.Screen name="animal/[id]/edit" options={{ ...header, title: 'Edit animal' }} />
          <Stack.Screen name="animal/[id]/status" options={{ ...header, title: 'Change status' }} />
          <Stack.Screen name="breeds" options={{ ...header, title: 'Breeds' }} />
          <Stack.Screen name="sync-issues" options={{ ...header, title: 'Sync issues' }} />
          <Stack.Screen name="milk/round" options={{ ...header, title: 'Milking round' }} />
          <Stack.Screen name="milk/new" options={{ ...header, title: 'Milk entry' }} />
          <Stack.Screen name="milk/[id]" options={{ ...header, title: 'Milk entry' }} />
          <Stack.Screen name="production" options={{ ...header, title: 'Production' }} />
          <Stack.Screen name="care/[kind]/new" options={{ ...header, title: 'New record' }} />
          <Stack.Screen name="care/[kind]/[id]" options={{ ...header, title: 'Record' }} />
          <Stack.Screen name="care/vaccination-group" options={{ ...header, title: 'Group vaccination' }} />
          <Stack.Screen name="care/schedules" options={{ ...header, title: 'Vaccination schedules' }} />
          <Stack.Screen name="reminders" options={{ ...header, title: 'Reminders' }} />
          <Stack.Screen name="customers/new" options={{ ...header, title: 'New customer' }} />
          <Stack.Screen name="customers/[id]" options={{ ...header, title: 'Customer' }} />
          <Stack.Screen name="sale/new" options={{ ...header, title: 'New sale' }} />
          <Stack.Screen name="sale/[id]" options={{ ...header, title: 'Sale' }} />
          <Stack.Screen name="payment/new" options={{ ...header, title: 'Payment' }} />
          <Stack.Screen name="payment/[id]" options={{ ...header, title: 'Payment' }} />
          <Stack.Screen name="stock/index" options={{ ...header, title: 'Milk stock' }} />
          <Stack.Screen name="stock/new" options={{ ...header, title: 'Stock record' }} />
          <Stack.Screen name="expenses/index" options={{ ...header, title: 'Expenses' }} />
          <Stack.Screen name="expenses/new" options={{ ...header, title: 'New expense' }} />
          <Stack.Screen name="expenses/[id]" options={{ ...header, title: 'Expense' }} />
          <Stack.Screen name="finance" options={{ ...header, title: 'Money summary' }} />
          <Stack.Screen name="prices" options={{ ...header, title: 'Milk prices' }} />
          <Stack.Screen name="audit" options={{ ...header, title: 'Audit history' }} />
          <Stack.Screen name="reports/index" options={{ ...header, title: 'Reports' }} />
          <Stack.Screen name="reports/[id]" options={{ ...header, title: 'Report' }} />
        </Stack.Protected>
        <Stack.Screen name="reset-password" />
      </Stack>
    </AppLockProvider>
  );
}
