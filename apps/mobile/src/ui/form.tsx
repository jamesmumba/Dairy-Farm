import { useNavigation } from 'expo-router';
import { type ReactNode, useLayoutEffect } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { isAndroid, minTouch, OnCard, radius, shadow, spacing, type, useFieldFill, useTheme } from './theme';

/** The app's mark: a cow in a deep green rounded square. Used where there is no navigation header. */
export function BrandMark({ size = 64 }: { size?: number }) {
  const t = useTheme();
  return (
    <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={{ width: size, height: size, borderRadius: size * 0.28, backgroundColor: t.primary, alignItems: 'center', justifyContent: 'center', ...shadow }}>
      <MaterialCommunityIcons name="cow" size={size * 0.58} color={t.onPrimary} />
    </View>
  );
}

/**
 * Scrolling screen for forms and detail pages. Inside the app the title goes in the navigation header
 * (shown once, not twice); `standalone` screens without a header (sign-in, onboarding) show it as a heading.
 */
export function FormScreen({
  title,
  intro,
  children,
  standalone = false,
  card = false,
  footer,
}: {
  title: string;
  intro?: string;
  children: ReactNode;
  standalone?: boolean;
  /** Put the form in one white card, so it reads as a single sheet on the milk-white page. */
  card?: boolean;
  /** Pinned under the scrolling form (a running total and the save button), so it never scrolls away. */
  footer?: ReactNode;
}) {
  const t = useTheme();
  const navigation = useNavigation();
  useLayoutEffect(() => {
    if (!standalone) navigation.setOptions({ title });
  }, [navigation, title, standalone]);
  return (
    <SafeAreaView edges={standalone ? ['top', 'bottom', 'left', 'right'] : ['bottom', 'left', 'right']} style={{ flex: 1, backgroundColor: t.background }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl }} keyboardShouldPersistTaps="handled">
          {standalone ? (
            <View style={{ gap: spacing.md, marginTop: spacing.lg }}>
              <BrandMark />
              <Text accessibilityRole="header" style={{ color: t.text, ...type.screenTitle }}>
                {title}
              </Text>
            </View>
          ) : null}
          {intro ? <Text style={{ color: t.textMuted, ...type.bodySmall }}>{intro}</Text> : null}
          {card ? (
            <View style={{ backgroundColor: t.surface, borderRadius: radius.card, padding: spacing.md, gap: spacing.md, ...shadow }}>
              <OnCard.Provider value>{children}</OnCard.Provider>
            </View>
          ) : (
            children
          )}
        </ScrollView>
        {footer ? (
          <View style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm, backgroundColor: t.surface, borderTopWidth: 1, borderTopColor: t.border }}>{footer}</View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function TextField({
  label,
  hint,
  error,
  ...input
}: TextInputProps & { label: string; hint?: string; error?: string | null }) {
  const t = useTheme();
  const fill = useFieldFill();
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={{ color: t.text, ...type.cardTitle }}>{label}</Text>
      {hint ? <Text style={{ color: t.textMuted, ...type.secondary }}>{hint}</Text> : null}
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={hint}
        placeholderTextColor={t.textMuted}
        style={{
          minHeight: minTouch,
          borderWidth: error ? 2 : 1,
          borderColor: error ? t.danger : t.border,
          borderRadius: radius.control,
          paddingHorizontal: spacing.md,
          ...type.input,
          color: t.text,
          backgroundColor: fill,
        }}
        {...input}
      />
      {error ? <FieldError message={error} /> : null}
    </View>
  );
}

export function FieldError({ message }: { message: string }) {
  const t = useTheme();
  return (
    <View accessible accessibilityRole="alert" accessibilityLiveRegion="polite" accessibilityLabel={message} style={{ flexDirection: 'row', gap: spacing.xs }}>
      <MaterialCommunityIcons name="alert-outline" size={18} color={t.danger} style={{ marginTop: 1 }} />
      <Text style={{ flex: 1, color: t.danger, ...type.bodySmall }}>{message}</Text>
    </View>
  );
}

const NOTICE = {
  info: { icon: 'information-outline', fg: 'info', bg: 'infoSoft' },
  success: { icon: 'check-circle-outline', fg: 'primary', bg: 'primarySoft' },
  attention: { icon: 'alert-circle-outline', fg: 'attention', bg: 'attentionSoft' },
  error: { icon: 'alert-outline', fg: 'danger', bg: 'dangerSoft' },
} as const;

/** Inline message with an icon, a coloured edge and soft background; the words carry the meaning. */
export function Notice({ tone = 'info', title, children }: { tone?: keyof typeof NOTICE; title?: string; children: ReactNode }) {
  const t = useTheme();
  const n = NOTICE[tone];
  return (
    <View
      accessibilityRole={tone === 'error' ? 'alert' : undefined}
      accessibilityLiveRegion="polite"
      style={{ flexDirection: 'row', gap: spacing.sm, borderLeftWidth: 4, borderLeftColor: t[n.fg], backgroundColor: t[n.bg], padding: spacing.md, borderRadius: radius.control }}
    >
      <MaterialCommunityIcons name={n.icon} size={20} color={t[n.fg]} importantForAccessibility="no" accessibilityElementsHidden />

      <View style={{ flex: 1, gap: 2 }}>
        {title ? <Text style={{ color: t.text, ...type.cardTitle }}>{title}</Text> : null}
        <Text style={{ color: t.text, ...type.bodySmall }}>{children}</Text>
      </View>
    </View>
  );
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  busy = false,
  disabled = false,
  hint,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'link' | 'danger';
  busy?: boolean;
  disabled?: boolean;
  hint?: string;
}) {
  const t = useTheme();
  const inactive = disabled || busy;
  const filled = variant === 'primary' || variant === 'danger';
  const bg = variant === 'primary' ? t.primary : variant === 'danger' ? t.danger : 'transparent';
  const fg = variant === 'danger' ? t.onDanger : filled ? t.onPrimary : t.primary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={onPress}
      android_ripple={{ color: filled ? t.rippleOnFilled : t.ripple }}
      style={({ pressed }) => ({
        minHeight: minTouch,
        borderRadius: radius.control,
        overflow: 'hidden',
        paddingHorizontal: spacing.md,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: bg,
        borderWidth: variant === 'secondary' ? 1 : 0,
        borderColor: t.primary,
        opacity: inactive ? 0.5 : pressed && !isAndroid ? 0.8 : 1,
      })}
    >
      {busy ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={{ color: fg, ...type.input, fontWeight: '600', textDecorationLine: variant === 'link' ? 'underline' : 'none' }}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

/** Single-choice list announced as radio buttons. */
export function Choice<V extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: V | null;
  options: readonly { value: V; label: string }[];
  onChange: (value: V) => void;
}) {
  const t = useTheme();
  const fill = useFieldFill();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ gap: spacing.xs }}>
      <Text style={{ color: t.text, ...type.cardTitle }}>{label}</Text>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={o.label}
            onPress={() => onChange(o.value)}
            android_ripple={{ color: t.ripple }}
            style={{
              minHeight: minTouch,
              overflow: 'hidden',
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.sm,
              paddingHorizontal: spacing.md,
              borderRadius: radius.control,
              borderWidth: selected ? 2 : 1,
              borderColor: selected ? t.primary : t.border,
              backgroundColor: selected ? t.primarySoft : fill,
            }}
          >
            <MaterialCommunityIcons name={selected ? 'radiobox-marked' : 'radiobox-blank'} size={22} color={selected ? t.primary : t.textMuted} />
            <Text style={{ color: t.text, ...type.body }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Toggle({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  const t = useTheme();
  return (
    <View style={{ minHeight: minTouch, flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.text, ...type.body }}>{label}</Text>
        {hint ? <Text style={{ color: t.textMuted, ...type.secondary }}>{hint}</Text> : null}
      </View>
      <Switch accessibilityLabel={label} accessibilityHint={hint} value={value} onValueChange={onChange} />
    </View>
  );
}
