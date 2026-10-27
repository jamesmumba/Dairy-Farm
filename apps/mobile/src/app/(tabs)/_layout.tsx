import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router/js-tabs';
import type { ComponentProps } from 'react';
import { SyncHeader } from '../../ui/SyncHeader';
import { minTouch, useTheme } from '../../ui/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

const TABS: { name: string; title: string; icon: IconName; hint: string }[] = [
  { name: 'index', title: 'Home', icon: 'home-outline', hint: 'Today’s summary and urgent items' },
  { name: 'animals', title: 'Animals', icon: 'paw-outline', hint: 'Herd list and animal profiles' },
  { name: 'records', title: 'Records', icon: 'create-outline', hint: 'Milk, health, breeding and expense entry' },
  { name: 'sales', title: 'Sales', icon: 'cash-outline', hint: 'Customers, sales, payments and stock' },
  { name: 'more', title: 'More', icon: 'ellipsis-horizontal', hint: 'Reports, reminders, settings and help' },
];

export default function TabLayout() {
  const t = useTheme();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: t.primary,
        tabBarInactiveTintColor: t.textMuted,
        tabBarStyle: { backgroundColor: t.background, borderTopColor: t.border, minHeight: minTouch + 8 },
        tabBarLabelStyle: { fontSize: 12 },
        headerStyle: { backgroundColor: t.background },
        headerTintColor: t.text,
        headerRight: () => <SyncHeader />,
      }}
    >
      {TABS.map(({ name, title, icon, hint }) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title,
            tabBarAccessibilityLabel: `${title}. ${hint}`,
            tabBarIcon: ({ focused, size }) => (
              <Ionicons name={icon} color={focused ? t.primary : t.textMuted} size={size} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
