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
              android_ripple={{ color: selected ? t.rippleOnFilled : t.ripple }}
              style={{
                minHeight: minTouch - 8,
                overflow: 'hidden',
                paddingHorizontal: spacing.md,
                justifyContent: 'center',
                borderRadius: radius.chip,
                borderWidth: 1,
                borderColor: selected ? t.primary : t.border,
                backgroundColor: selected ? t.primary : t.surface,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                {selected ? <MaterialCommunityIcons name="check" size={16} color={t.onPrimary} /> : null}
                <Text style={{ color: selected ? t.onPrimary : t.text, ...type.bodySmall }}>{o.label}</Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
