import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Modal, Platform, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FieldError } from './form';
import { minTouch, radius, spacing, useTheme } from './theme';
import { formatDate, formatDateTime, fromDateString, toDateString } from '../lib/dates';

export { formatDate, formatDateTime, fromDateString, toDateString };

/**
 * iOS bottom sheet around the native calendar. The choice is a draft until Done, so picking today
 * (already highlighted) still counts, and Cancel leaves the field as it was. The picker is forced to
 * the light look: with the phone in dark mode it would otherwise draw white text on the light sheet.
 */
function IosPickerSheet({
  initial,
  mode,
  maximumDate,
  onCancel,
  onDone,
}: {
  initial: Date;
  mode: 'date' | 'datetime';
  maximumDate?: Date;
  onCancel: () => void;
  onDone: (d: Date) => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  // Mounted only while open, so each opening starts from the field's current value.
  const [draft, setDraft] = useState(initial);
  const action = (label: string, onPress: () => void, strong = false) => (
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={8} style={{ minHeight: minTouch, minWidth: minTouch, justifyContent: 'center', paddingHorizontal: spacing.sm }}>
      <Text style={{ color: t.primary, fontSize: 17, fontWeight: strong ? '700' : '500' }}>{label}</Text>
    </Pressable>
  );
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close the calendar" style={{ flex: 1, backgroundColor: '#0006' }} onPress={onCancel} />
      <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.card + 4, borderTopRightRadius: radius.card + 4, paddingBottom: insets.bottom + spacing.sm, paddingHorizontal: spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: t.border }}>
          {action('Cancel', onCancel)}
          {action(mode === 'date' ? 'Today' : 'Now', () => setDraft(new Date()))}
          {action('Done', () => onDone(draft), true)}
        </View>
        <DateTimePicker
          value={draft}
          mode={mode}
          display="inline"
          themeVariant="light"
          accentColor={t.primary}
          textColor={t.text}
          maximumDate={maximumDate}
          onChange={(_, d) => d && setDraft(d)}
          style={{ alignSelf: 'center' }}
        />
      </View>
    </Modal>
  );
}


export function DateField({
  label,
  value,
  onChange,
  error,
  allowFuture = false,
  optional = true,
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  error?: string | null;
  allowFuture?: boolean;
  optional?: boolean;
}) {
  const t = useTheme();
  const [iosOpen, setIosOpen] = useState(false);
  const current = value ? fromDateString(value) : new Date();
  const maximumDate = allowFuture ? undefined : new Date();

  function open() {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: current,
        mode: 'date',
        maximumDate,
        onChange: (event, date) => {
          if (event.type === 'set' && date) onChange(toDateString(date));
        },
      });
    } else {
      setIosOpen(true);
    }
  }

  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={{ color: t.text, fontSize: 16, fontWeight: '600' }}>{label}</Text>
      <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${value ? formatDate(value) : 'not set'}`}
          accessibilityHint="Opens a date picker"
          onPress={open}
          style={{
            flex: 1,
            minHeight: minTouch,
            justifyContent: 'center',
            paddingHorizontal: spacing.md,
            borderRadius: radius.control,
            borderWidth: error ? 2 : 1,
            borderColor: error ? t.danger : t.border,
            backgroundColor: t.surface,
          }}
        >
          <Text style={{ color: value ? t.text : t.textMuted, fontSize: 17 }}>{value ? formatDate(value) : 'Choose a date'}</Text>
        </Pressable>
        {optional && value ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`Clear ${label}`} onPress={() => onChange(null)} style={{ minHeight: minTouch, minWidth: minTouch, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: t.primary, fontSize: 16 }}>Clear</Text>
          </Pressable>
        ) : null}
      </View>
      {error ? <FieldError message={error} /> : null}

      {iosOpen ? (
        <IosPickerSheet
          initial={current}
          mode="date"
          maximumDate={maximumDate}
          onCancel={() => setIosOpen(false)}
          onDone={(d) => {
            setIosOpen(false);
            onChange(toDateString(d));
          }}
        />
      ) : null}
    </View>
  );
}


/** Date and time (e.g. a vet's exact withdrawal end). Value is an ISO timestamp. */
export function DateTimeField({
  label,
  value,
  onChange,
  error,
  allowFuture = false,
  optional = true,
  hint,
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  error?: string | null;
  allowFuture?: boolean;
  optional?: boolean;
  hint?: string;
}) {
  const t = useTheme();
  const [iosOpen, setIosOpen] = useState(false);
  const current = value ? new Date(value) : new Date();
  const maximumDate = allowFuture ? undefined : new Date();

  function open() {
    if (Platform.OS !== 'android') return setIosOpen(true);
    // Android shows the date and time pickers one after the other.
    DateTimePickerAndroid.open({
      value: current,
      mode: 'date',
      maximumDate,
      onChange: (event, date) => {
        if (event.type !== 'set' || !date) return;
        DateTimePickerAndroid.open({
          value: current,
          mode: 'time',
          is24Hour: true,
          onChange: (e2, time) => {
            if (e2.type !== 'set' || !time) return;
            const combined = new Date(date);
            combined.setHours(time.getHours(), time.getMinutes(), 0, 0);
            onChange((maximumDate && combined > maximumDate ? maximumDate : combined).toISOString());
          },
        });
      },
    });
  }

  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={{ color: t.text, fontSize: 16, fontWeight: '600' }}>{label}</Text>
      {hint ? <Text style={{ color: t.textMuted, fontSize: 14 }}>{hint}</Text> : null}
      <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${value ? formatDateTime(value) : 'not set'}`}
          accessibilityHint="Opens a date and time picker"
          onPress={open}
          style={{
            flex: 1,
            minHeight: minTouch,
            justifyContent: 'center',
            paddingHorizontal: spacing.md,
            borderRadius: radius.control,
            borderWidth: error ? 2 : 1,
            borderColor: error ? t.danger : t.border,
            backgroundColor: t.surface,
          }}
        >
          <Text style={{ color: value ? t.text : t.textMuted, fontSize: 17 }}>{value ? formatDateTime(value) : 'Choose date and time'}</Text>
        </Pressable>
        {optional && value ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`Clear ${label}`} onPress={() => onChange(null)} style={{ minHeight: minTouch, minWidth: minTouch, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: t.primary, fontSize: 16 }}>Clear</Text>
          </Pressable>
        ) : null}
      </View>
      {error ? <FieldError message={error} /> : null}

      {iosOpen ? (
        <IosPickerSheet
          initial={current}
          mode="datetime"
          maximumDate={maximumDate}
          onCancel={() => setIosOpen(false)}
          onDone={(d) => {
            setIosOpen(false);
            onChange(d.toISOString());
          }}
        />
      ) : null}
    </View>
  );
}
