import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Tabs } from 'expo-router/js-tabs';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { IconName } from '../../ui/kit';
import { SyncHeader } from '../../ui/SyncHeader';
import { useTheme } from '../../ui/theme';

const TABS: { name: string; title: string; icon: IconName; active: IconName; hint: string }[] = [
  { name: 'index', title: 'Home', icon: 'home-variant-outline', active: 'home-variant', hint: 'Today’s summary and urgent items' },
  { name: 'animals', title: 'Animals', icon: 'cow', active: 'cow', hint: 'Herd list and animal profiles' },
  { name: 'records', title: 'Records', icon: 'clipboard-text-outline', active: 'clipboard-text', hint: 'Milk, health, breeding and expense entry' },
  { name: 'sales', title: 'Sales', icon: 'cash-multiple', active: 'cash-multiple', hint: 'Customers, sales, payments and stock' },
  { name: 'more', title: 'More', icon: 'dots-horizontal-circle-outline', active: 'dots-horizontal-circle', hint: 'Reports, reminders, settings and help' },
];

export default function TabLayout() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  // Clear of the home indicator / gesture bar, plus a little air so thumbs don't hit the edge.
  const bottom = Math.max(insets.bottom, 8) + 8;
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: t.primary,
        tabBarInactiveTintColor: t.textMuted,
        tabBarStyle: { backgroundColor: t.surface, borderTopColor: t.border, height: 64 + bottom, paddingTop: 8, paddingBottom: bottom },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600', marginTop: 2 },
        headerStyle: { backgroundColor: t.background },
        headerShadowVisible: false,
        headerTitleStyle: { fontWeight: '600', fontSize: 20 },
        headerTintColor: t.text,
        headerRight: () => <SyncHeader />,
      }}
    >
      {TABS.map(({ name, title, icon, active, hint }) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title,
            tabBarAccessibilityLabel: `${title}. ${hint}`,
            // The active tab sits in a pale green pill, as well as changing colour and icon weight.
            tabBarIcon: ({ focused }) => (
              <View style={{ width: 56, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: focused ? t.primarySoft : 'transparent' }}>
                <MaterialCommunityIcons name={focused ? active : icon} color={focused ? t.primary : t.textMuted} size={22} />
              </View>
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
