import { Pressable, ScrollView, Text, View } from 'react-native';
import { minTouch, spacing, useTheme } from './theme';

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
      <Text style={{ color: t.textMuted, fontSize: 14 }}>{label}</Text>
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
              style={{
                minHeight: minTouch - 8,
                paddingHorizontal: spacing.md,
                justifyContent: 'center',
                borderRadius: 20,
                borderWidth: 1,
                borderColor: selected ? t.primary : t.border,
                backgroundColor: selected ? t.primary : t.background,
              }}
            >
              <Text style={{ color: selected ? t.onPrimary : t.text, fontSize: 15 }}>
                {selected ? '✓ ' : ''}
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
