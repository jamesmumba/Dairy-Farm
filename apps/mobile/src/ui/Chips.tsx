import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { minTouch, radius, spacing, type, useTheme } from './theme';

/** A labelled row of single-choice chips. Selecting the active chip again clears it. */
export function Chips<V extends string>({
  label,
  value,
  options,
  onChange,
  allowClear = true,
}: {
  label: string;
  value: V | null;
  options: readonly { value: V; label: string }[];
  onChange: (value: V | null) => void;
  allowClear?: boolean;
}) {
  const t = useTheme();
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={{ color: t.textMuted, ...type.secondary }}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <Pressable
              key={o.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={`${label}: ${o.label}`}
              onPress={() => onChange(selected && allowClear ? null : o.value)}
              android_ripple={{ color: t.ripple }}
              style={{
                minHeight: minTouch - 8,
                overflow: 'hidden',
                justifyContent: 'center',
                borderRadius: radius.chip,
                borderWidth: selected ? 2 : 1,
                paddingHorizontal: selected ? spacing.md - 1 : spacing.md,
                borderColor: selected ? t.primary : t.border,
                backgroundColor: selected ? t.primarySoft : t.surface,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                {selected ? <MaterialCommunityIcons name="check-circle" size={16} color={t.primary} /> : null}
                <Text style={{ color: t.text, ...type.bodySmall, fontWeight: selected ? '600' : '400' }}>{o.label}</Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
