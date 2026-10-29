import { type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Button } from './form';
import { minTouch, radius, spacing, useFieldFill, useTheme } from './theme';

/**
 * A search box with, when the list has filters, a filter button beside it. The button shows how many
 * filters are on, so a filtered list never looks like the whole list.
 */
export function SearchBar({
  value,
  onChangeText,
  placeholder,
  label = 'Search',
  activeFilters = 0,
  onFilters,
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  label?: string;
  activeFilters?: number;
  onFilters?: () => void;
}) {
  const t = useTheme();
  const fill = useFieldFill();
  const on = activeFilters > 0;
  return (
    <View style={{ flexDirection: 'row', gap: spacing.sm }}>
      <View
        style={{
          flex: 1,
          minHeight: minTouch,
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          paddingHorizontal: spacing.md,
          borderWidth: 1,
          borderColor: t.border,
          borderRadius: radius.control,
          backgroundColor: fill,
        }}
      >
        <MaterialCommunityIcons name="magnify" size={22} color={t.textMuted} importantForAccessibility="no" />
        <TextInput
          accessibilityLabel={label}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={t.textMuted}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          style={{ flex: 1, minHeight: minTouch, fontSize: 17, color: t.text }}
        />
        {value ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => onChangeText('')} hitSlop={8}>
            <MaterialCommunityIcons name="close-circle" size={20} color={t.textMuted} />
          </Pressable>
        ) : null}
      </View>
      {onFilters ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={on ? `Filters, ${activeFilters} on` : 'Filters'}
          onPress={onFilters}
          style={({ pressed }) => ({
            width: minTouch,
            minHeight: minTouch,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1,
            borderColor: on ? t.primary : t.border,
            borderRadius: radius.control,
            backgroundColor: on ? t.primary : pressed ? t.primarySoft : fill,
          })}
        >
          <MaterialCommunityIcons name={on ? 'filter' : 'filter-outline'} size={22} color={on ? t.onPrimary : t.text} />
          {on ? (
            <View
              importantForAccessibility="no-hide-descendants"
              style={{
                position: 'absolute',
                top: -6,
                right: -6,
                minWidth: 20,
                height: 20,
                paddingHorizontal: 4,
                borderRadius: 10,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: t.surface,
                borderWidth: 1,
                borderColor: t.primary,
              }}
            >
              <Text style={{ color: t.primary, fontSize: 12, fontWeight: '700' }}>{activeFilters}</Text>
            </View>
          ) : null}
        </Pressable>
      ) : null}
    </View>
  );
}

/** The filters, in a sheet from the bottom of the screen. The button shows how many results they leave. */
export function FilterSheet({
  visible,
  onClose,
  onClear,
  showLabel,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  /** Shown only while some filter is on. */
  onClear?: () => void;
  /** The close button's text, e.g. "Show 12 animals". */
  showLabel: string;
  children: ReactNode;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close filters" style={{ flex: 1, backgroundColor: '#0006' }} onPress={onClose} />
      <View
        style={{
          maxHeight: '85%',
          backgroundColor: t.surface,
          borderTopLeftRadius: radius.card + 4,
          borderTopRightRadius: radius.card + 4,
          paddingBottom: insets.bottom + spacing.sm,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, borderBottomWidth: 1, borderBottomColor: t.border }}>
          <Text accessibilityRole="header" style={{ color: t.text, fontSize: 19, fontWeight: '600', paddingVertical: spacing.md }}>
            Filters
          </Text>
          {onClear ? (
            <Pressable accessibilityRole="button" onPress={onClear} hitSlop={8} style={{ minHeight: minTouch, justifyContent: 'center' }}>
              <Text style={{ color: t.primary, fontSize: 17 }}>Clear all</Text>
            </Pressable>
          ) : null}
        </View>
        <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}>{children}</ScrollView>
        <View style={{ paddingHorizontal: spacing.md }}>
          <Button label={showLabel} onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}
