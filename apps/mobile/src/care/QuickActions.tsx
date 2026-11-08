import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { type ComponentProps, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { displayName } from '../animals/model';
import { listAnimals } from '../animals/repo';
import { formatDate } from '../lib/dates';
import { useLocal } from '../sync/store';
import { BottomSheet } from '../ui/BottomSheet';
import { DateField } from '../ui/DateField';
import { Button, Notice, TextField } from '../ui/form';
import { ListRow } from '../ui/kit';
import { minTouch, radius, spacing, type, useTheme } from '../ui/theme';
import { hideReminder } from './hiddenReminders';
import type { CareKind } from './model';
import { type GroupDose, NO_SHEET, QUICK_LABELS, type QuickAction, quickChange, type SheetValues, sheetDefaults, sheetSpec } from './quick';
import { createCare, getCare, updateCare } from './repo';
import { useCareContext } from './useCareContext';

type Row = { id: string; version: number; deleted_at: string | null } & Record<string, unknown>;
export interface QuickTarget {
  kind: CareKind;
  id: string;
  /** The reminder answered, for answers that only hide it (no heat seen). */
  reminderKey?: string;
}

const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** The answers as buttons: the first (the usual answer) filled, the others outlined. */
export function QuickButtons({ actions, onPick, label }: { actions: QuickAction[]; onPick: (a: QuickAction) => void; label?: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
      {actions.map((a, i) => {
        const main = i === 0;
        return (
          <Pressable
            key={a}
            accessibilityRole="button"
            accessibilityLabel={label ? `${QUICK_LABELS[a]}: ${label}` : QUICK_LABELS[a]}
            onPress={() => onPick(a)}
            style={({ pressed }) => ({
              minHeight: minTouch - 8,
              paddingHorizontal: spacing.md,
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.xs,
              borderRadius: radius.chip,
              borderWidth: 1,
              borderColor: t.primary,
              backgroundColor: main ? t.primary : pressed ? t.primarySoft : 'transparent',
              opacity: pressed && main ? 0.85 : 1,
            })}
          >
            {main ? <MaterialCommunityIcons name="check" size={18} color={t.onPrimary} importantForAccessibility="no" /> : null}
            <Text style={{ color: main ? t.onPrimary : t.primary, ...type.link }}>{QUICK_LABELS[a]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A reminder row with its answers under it. Tapping the row itself still opens the record. */
export function ReminderRow({ actions, onAction, ...row }: ComponentProps<typeof ListRow> & { actions: QuickAction[]; onAction: (a: QuickAction) => void }) {
  return (
    <View>
      <ListRow {...row} />
      {actions.length ? (
        <View style={{ paddingLeft: 72, paddingRight: spacing.md, paddingBottom: spacing.sm + 2, marginTop: -spacing.xs }}>
          <QuickButtons actions={actions} onPick={onAction} label={row.title} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * Starts an answer: hides the reminder, opens a prefilled form, or opens the sheet that asks for the
 * date and the one or two details that matter. Render `sheet` once on the screen.
 */
export function useQuickActions() {
  const [open, setOpen] = useState<{ action: QuickAction; target: QuickTarget } | { group: GroupDose } | null>(null);
  const start = (action: QuickAction, target: QuickTarget) => {
    if (action === 'no_heat') {
      if (target.reminderKey) hideReminder(target.reminderKey);
      return;
    }
    if (action === 'record_calving') {
      const r = getCare<Row>(target.kind, target.id);
      if (r) router.push({ pathname: '/care/[kind]/new', params: { kind: 'calving', cattle_id: String(r.data.cattle_id) } });
      return;
    }
    if (!NO_SHEET.includes(action)) setOpen({ action, target });
  };
  const close = () => setOpen(null);
  const sheet = !open ? null : 'group' in open ? <GroupSheet group={open.group} onClose={close} /> : <QuickSheet action={open.action} target={open.target} onClose={close} />;
  return { start, startGroup: (group: GroupDose) => setOpen({ group }), sheet };
}

/** Date quick picks under a date field: tomorrow, in 3 days, in a week. */
function Picks({ days, today, value, onPick }: { days: number[]; today: string; value: string | null; onPick: (d: string) => void }) {
  const t = useTheme();
  const label = (n: number) => (n === 1 ? 'Tomorrow' : n === 7 ? 'In a week' : `In ${n} days`);
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: -spacing.xs }}>
      {days.map((n) => {
        const d = addDays(today, n);
        const on = d === value;
        return (
          <Pressable
            key={n}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => onPick(d)}
            style={{ minHeight: minTouch - 12, paddingHorizontal: spacing.md, justifyContent: 'center', borderRadius: radius.chip, borderWidth: 1, borderColor: on ? t.primary : t.border, backgroundColor: on ? t.primarySoft : t.surface }}
          >
            <Text style={{ color: t.text, ...type.secondary }}>{label(n)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function QuickSheet({ action, target, onClose }: { action: QuickAction; target: QuickTarget; onClose: () => void }) {
  const ctx = useCareContext();
  const record = getCare<Row>(target.kind, target.id);
  const spec = sheetSpec(action);
  // Mounted only while open, so each opening starts from the record as it is now.
  const [values, setValues] = useState<SheetValues>(() => (record ? sheetDefaults(action, target.kind, record.data, ctx) : { date: ctx.today, date2: null, text: '' }));
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<SheetValues>) => setValues((v) => ({ ...v, ...patch }));

  function save() {
    const current = getCare<Row>(target.kind, target.id);
    if (!current) return setError('This record is no longer here.');
    const change = quickChange(action, target.kind, current.data, values, new Date(), ctx.today);
    if ('error' in change) return setError(change.error);
    if (change.update) updateCare(target.kind, current, change.update);
    if (change.create) createCare(change.create.kind, change.create.fields);
    onClose();
  }

  return (
    <BottomSheet visible title={spec.title} onClose={onClose} footer={<Button label={spec.saveLabel} onPress={save} />}>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {spec.dateLabel ? <DateField label={spec.dateLabel} value={values.date} onChange={(d) => d && set({ date: d })} optional={false} /> : null}
      {spec.date2Label ? (
        <>
          <DateField label={spec.date2Label} value={values.date2} onChange={(d) => set({ date2: d })} allowFuture optional={!spec.date2Required} />
          {spec.date2Picks ? <Picks days={spec.date2Picks} today={ctx.today} value={values.date2} onPick={(d) => set({ date2: d })} /> : null}
          {spec.date2Hint ? <SheetHint text={spec.date2Hint} /> : null}
        </>
      ) : null}
      {spec.textLabel ? <TextField label={spec.textLabel} value={values.text} onChangeText={(text) => set({ text })} /> : null}
    </BottomSheet>
  );
}

function SheetHint({ text }: { text: string }) {
  const t = useTheme();
  return <Text style={{ color: t.textMuted, ...type.secondary, marginTop: -spacing.xs }}>{text}</Text>;
}

/** A dose given to a group together: everyone ticked; untick a cow that missed it and choose her new date. */
function GroupSheet({ group, onClose }: { group: GroupDose; onClose: () => void }) {
  const t = useTheme();
  const ctx = useCareContext();
  const names = useLocal(() => new Map(listAnimals().map((a) => [a.data.id, displayName(a.data)])));
  const first = getCare<Row>('vaccination', group.ids[0]);
  const [given, setGiven] = useState(() => new Set(group.ids));
  const [values, setValues] = useState<SheetValues>(() => (first ? sheetDefaults('given', 'vaccination', first.data, ctx) : { date: ctx.today, date2: null, text: '' }));
  const [missedOn, setMissedOn] = useState<string | null>(addDays(ctx.today, 7));
  const [error, setError] = useState<string | null>(null);
  const missed = group.ids.filter((id) => !given.has(id));

  function save() {
    const answers = group.ids.map((id) => {
      const current = getCare<Row>('vaccination', id);
      if (!current) return null;
      const change = given.has(id)
        ? quickChange('given', 'vaccination', current.data, values, new Date(), ctx.today)
        : quickChange('missed', 'vaccination', current.data, { ...values, date2: missedOn }, new Date(), ctx.today);
      return { current, change };
    });
    // Check every cow first, so the group is saved all at once or not at all.
    const failed = answers.find((a) => a && 'error' in a.change);
    if (failed && 'error' in failed.change) return setError(failed.change.error);
    for (const a of answers) {
      if (!a || 'error' in a.change) continue;
      if (a.change.update) updateCare('vaccination', a.current, a.change.update);
      if (a.change.create) createCare(a.change.create.kind, a.change.create.fields);
    }
    onClose();
  }

  const toggle = (id: string) =>
    setGiven((g) => {
      const next = new Set(g);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <BottomSheet
      visible
      title={`${group.title.replace(/ (due|overdue)/, '')} · ${formatDate(group.due)}`}
      onClose={onClose}
      footer={<Button label={missed.length ? `Save: ${given.size} given, ${missed.length} missed` : `Save: all ${given.size} given`} onPress={save} />}
    >
      {error ? <Notice tone="error">{error}</Notice> : null}
      <View style={{ gap: spacing.xs }}>
        <Text style={{ color: t.text, ...type.cardTitle }}>Given to</Text>
        <Text style={{ color: t.textMuted, ...type.secondary }}>Untick any cow that did not get it.</Text>
        {group.ids.map((id, i) => {
          const on = given.has(id);
          const name = names.get(group.cattleIds[i]) ?? 'Animal';
          return (
            <Pressable
              key={id}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={name}
              onPress={() => toggle(id)}
              style={{ minHeight: minTouch, flexDirection: 'row', alignItems: 'center', gap: spacing.md }}
            >
              <MaterialCommunityIcons name={on ? 'checkbox-marked' : 'checkbox-blank-outline'} size={26} color={on ? t.primary : t.textMuted} />
              <Text style={{ color: t.text, ...type.body }}>{name}</Text>
            </Pressable>
          );
        })}
      </View>
      {given.size ? (
        <>
          <DateField label="Given on" value={values.date} onChange={(d) => d && setValues((v) => ({ ...v, date: d }))} optional={false} />
          <TextField label="Batch number" value={values.text} onChangeText={(text) => setValues((v) => ({ ...v, text }))} />
          <DateField label="Next dose due" value={values.date2} onChange={(d) => setValues((v) => ({ ...v, date2: d }))} allowFuture />
          <SheetHint text="From the schedule, if it has an interval. The next dose is added for each cow." />
        </>
      ) : null}
      {missed.length ? (
        <>
          <DateField label={`Give the ${missed.length} missed on`} value={missedOn} onChange={setMissedOn} allowFuture optional={false} />
          <Picks days={[1, 3, 7]} today={ctx.today} value={missedOn} onPick={setMissedOn} />
        </>
      ) : null}
    </BottomSheet>
  );
}
