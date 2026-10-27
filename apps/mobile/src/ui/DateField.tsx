import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Modal, Platform, Pressable, Text, View } from 'react-native';
import { Button, FieldError } from './form';
import { minTouch, radius, spacing, useTheme } from './theme';
import { formatDate, formatDateTime, fromDateString, toDateString } from '../lib/dates';

export { formatDate, formatDateTime, fromDateString, toDateString };


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

      <Modal visible={iosOpen} transparent animationType="slide" onRequestClose={() => setIosOpen(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#0006' }}>
          <View style={{ backgroundColor: t.background, padding: spacing.md, gap: spacing.md }}>
            <DateTimePicker value={current} mode="date" display="inline" maximumDate={maximumDate} onChange={(_, date) => date && onChange(toDateString(date))} />
            <Button label="Done" onPress={() => setIosOpen(false)} />
          </View>
        </View>
      </Modal>
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
            onChange(combined.toISOString());
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

      <Modal visible={iosOpen} transparent animationType="slide" onRequestClose={() => setIosOpen(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#0006' }}>
          <View style={{ backgroundColor: t.background, padding: spacing.md, gap: spacing.md }}>
            <DateTimePicker value={current} mode="datetime" display="inline" maximumDate={maximumDate} onChange={(_, d) => d && onChange(d.toISOString())} />
            <Button label="Done" onPress={() => setIosOpen(false)} />
          </View>
        </View>
      </Modal>
    </View>
  );
}
