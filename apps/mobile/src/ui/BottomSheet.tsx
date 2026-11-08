import { type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { minTouch, radius, spacing, type, useTheme } from './theme';

/** A sheet from the bottom of the screen: a title (with an optional action beside it), content, and a footer. */
export function BottomSheet({
  visible,
  title,
  onClose,
  headerAction,
  footer,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  headerAction?: { label: string; onPress: () => void };
  footer: ReactNode;
  children: ReactNode;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" style={{ flex: 1, backgroundColor: '#0006' }} onPress={onClose} />
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
            <Text accessibilityRole="header" style={{ flex: 1, color: t.text, ...type.sectionTitle, paddingVertical: spacing.md }}>
              {title}
            </Text>
            {headerAction ? (
              <Pressable accessibilityRole="button" onPress={headerAction.onPress} hitSlop={8} style={{ minHeight: minTouch, justifyContent: 'center' }}>
                <Text style={{ color: t.primary, ...type.input }}>{headerAction.label}</Text>
              </Pressable>
            ) : null}
          </View>
          <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.md }} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
          <View style={{ paddingHorizontal: spacing.md, gap: spacing.xs }}>{footer}</View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
