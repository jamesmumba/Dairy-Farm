import type { ReactNode } from 'react';
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
import { minTouch, radius, spacing, type, useTheme } from './theme';

export function FormScreen({ title, intro, children }: { title: string; intro?: string; children: ReactNode }) {
  const t = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.background }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.md }} keyboardShouldPersistTaps="handled">
          <Text accessibilityRole="header" style={{ color: t.text, ...type.screenTitle }}>
            {title}
          </Text>
          {intro ? <Text style={{ color: t.textMuted, fontSize: 16 }}>{intro}</Text> : null}
          {children}
        </ScrollView>
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
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={{ color: t.text, fontSize: 16, fontWeight: '600' }}>{label}</Text>
      {hint ? <Text style={{ color: t.textMuted, fontSize: 14 }}>{hint}</Text> : null}
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
          fontSize: 17,
          color: t.text,
          backgroundColor: t.surface,
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
    <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ color: t.danger, fontSize: 15 }}>
      ⚠ {message}
    </Text>
  );
}

const NOTICE = {
  info: { icon: 'ℹ', fg: 'info', bg: 'infoSoft' },
  success: { icon: '✓', fg: 'primary', bg: 'primarySoft' },
  attention: { icon: '!', fg: 'attention', bg: 'attentionSoft' },
  error: { icon: '⚠', fg: 'danger', bg: 'dangerSoft' },
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
      <Text style={{ color: t[n.fg], fontSize: 16, fontWeight: '600' }} importantForAccessibility="no" accessibilityElementsHidden>
        {n.icon}
      </Text>
      <View style={{ flex: 1, gap: 2 }}>
        {title ? <Text style={{ color: t.text, ...type.cardTitle }}>{title}</Text> : null}
        <Text style={{ color: t.text, fontSize: 15 }}>{children}</Text>
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
  const fg = filled ? t.onPrimary : t.primary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: minTouch,
        borderRadius: radius.control,
        paddingHorizontal: spacing.md,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: bg,
        borderWidth: variant === 'secondary' ? 1 : 0,
        borderColor: t.primary,
        opacity: inactive ? 0.5 : pressed ? 0.8 : 1,
      })}
    >
      {busy ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={{ color: fg, fontSize: 17, fontWeight: '600', textDecorationLine: variant === 'link' ? 'underline' : 'none' }}>
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
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ gap: spacing.xs }}>
      <Text style={{ color: t.text, fontSize: 16, fontWeight: '600' }}>{label}</Text>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={o.label}
            onPress={() => onChange(o.value)}
            style={{
              minHeight: minTouch,
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.sm,
              paddingHorizontal: spacing.md,
              borderRadius: radius.control,
              borderWidth: selected ? 2 : 1,
              borderColor: selected ? t.primary : t.border,
              backgroundColor: selected ? t.primarySoft : t.surface,
            }}
          >
            <Text style={{ color: selected ? t.primary : t.textMuted, fontSize: 18 }}>{selected ? '◉' : '○'}</Text>
            <Text style={{ color: t.text, fontSize: 16 }}>{o.label}</Text>
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
        <Text style={{ color: t.text, fontSize: 16 }}>{label}</Text>
        {hint ? <Text style={{ color: t.textMuted, fontSize: 14 }}>{hint}</Text> : null}
      </View>
      <Switch accessibilityLabel={label} accessibilityHint={hint} value={value} onValueChange={onChange} />
    </View>
  );
}
