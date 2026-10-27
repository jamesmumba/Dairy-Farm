import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { unreadCount, useSeen } from '../care/inbox';
import { useReminders } from '../care/useReminders';
import { useTheme } from './theme';

/** Header bell that opens the notifications inbox, with the number of unread items. */
export function InboxBell() {
  const t = useTheme();
  const { reminders } = useReminders();
  const unread = unreadCount(reminders, useSeen());
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={unread ? `Notifications, ${unread} new` : 'Notifications'}
      onPress={() => router.push('/reminders')}
      hitSlop={8}
      style={{ width: 40, height: 36, alignItems: 'center', justifyContent: 'center' }}
    >
      <MaterialCommunityIcons name={unread ? 'bell-badge-outline' : 'bell-outline'} size={24} color={t.text} />
      {unread ? (
        <View style={{ position: 'absolute', top: 0, right: 2, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, backgroundColor: t.danger, alignItems: 'center', justifyContent: 'center' }}>
          <Text maxFontSizeMultiplier={1.2} style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '700' }}>
            {unread > 9 ? '9+' : unread}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}
