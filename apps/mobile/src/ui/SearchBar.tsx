import { type ReactNode } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { BottomSheet } from './BottomSheet';
import { Button } from './form';
import { minTouch, radius, spacing, type, useFieldFill, useTheme } from './theme';

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
          style={{ flex: 1, minHeight: minTouch, ...type.input, color: t.text }}
        />
        {value ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => onChangeText('')} hitSlop={8}>
            <MaterialCommunityIcons name="close-circle" size={20} color={t.textMuted} />
          </Pressable>
        ) : null}
      </View>
      {onFilters ? <FilterButton activeFilters={activeFilters} onPress={onFilters} /> : null}
    </View>
  );
}

/** A filter icon button; filled, with a count, while any filter is on. */
export function FilterButton({ activeFilters, onPress }: { activeFilters: number; onPress: () => void }) {
  const t = useTheme();
  const fill = useFieldFill();
  const on = activeFilters > 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={on ? `Filters, ${activeFilters} on` : 'Filters'}
      onPress={onPress}
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
          <Text style={{ color: t.primary, ...type.micro, fontWeight: '700' }}>{activeFilters}</Text>
        </View>
      ) : null}
    </Pressable>
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
  return (
    <BottomSheet visible={visible} title="Filters" onClose={onClose} headerAction={onClear ? { label: 'Clear all', onPress: onClear } : undefined} footer={<Button label={showLabel} onPress={onClose} />}>
      {children}
    </BottomSheet>
  );
}
