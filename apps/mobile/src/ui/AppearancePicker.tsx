import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Pressable, Text, View } from 'react-native';
import { type AppearanceChoice, setAppearance, useAppearanceChoice } from './appearance';
import { dark, light } from './palette';
import { minTouch, radius, spacing, type, useTheme } from './theme';

type Palette = typeof light;

/** A tiny picture of the app in one palette: header bar, two cards and a green button. */
function Mini({ p }: { p: Palette }) {
  return (
    <View style={{ flex: 1, backgroundColor: p.background, padding: 6, gap: 4 }}>
      <View style={{ height: 6, width: '55%', borderRadius: 3, backgroundColor: p.textMuted, opacity: 0.5 }} />
      <View style={{ height: 18, borderRadius: 5, backgroundColor: p.hero }} />
      <View style={{ height: 12, borderRadius: 4, backgroundColor: p.surface, borderWidth: 1, borderColor: p.border }} />
      <View style={{ height: 12, borderRadius: 4, backgroundColor: p.surface, borderWidth: 1, borderColor: p.border }} />
      <View style={{ height: 8, width: '45%', borderRadius: 4, backgroundColor: p.primary }} />
    </View>
  );
}

const OPTIONS: { value: AppearanceChoice; label: string }[] = [
  { value: 'system', label: 'Phone setting' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/** Three preview cards; the chosen one has a green ring and a tick. "Phone setting" shows light and dark side by side. */
export function AppearancePicker() {
  const t = useTheme();
  const choice = useAppearanceChoice();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="Appearance" style={{ flexDirection: 'row', gap: spacing.sm }}>
      {OPTIONS.map((o) => {
        const on = o.value === choice;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={o.label}
            onPress={() => setAppearance(o.value)}
            style={{ flex: 1, minHeight: minTouch, alignItems: 'center', gap: spacing.xs }}
          >
            <View
              style={{
                width: '100%',
                aspectRatio: 0.8,
                borderRadius: radius.control,
                borderWidth: on ? 2.5 : 1,
                borderColor: on ? t.primary : t.border,
                overflow: 'hidden',
                flexDirection: 'row',
              }}
            >
              {o.value === 'system' ? (
                <>
                  <Mini p={light} />
                  <Mini p={dark} />
                </>
              ) : (
                <Mini p={o.value === 'dark' ? dark : light} />
              )}
              {on ? (
                <View style={{ position: 'absolute', right: 5, bottom: 5, width: 22, height: 22, borderRadius: 11, backgroundColor: t.primary, alignItems: 'center', justifyContent: 'center' }}>
                  <MaterialCommunityIcons name="check" size={15} color={t.onPrimary} />
                </View>
              ) : null}
            </View>
            <Text style={{ color: on ? t.text : t.textMuted, ...type.secondary, fontWeight: on ? '700' : '500' }} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
