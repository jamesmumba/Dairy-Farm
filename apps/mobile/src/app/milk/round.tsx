import { router, useLocalSearchParams } from 'expo-router';
import { type ComponentRef, type ReactNode, useRef, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { displayName } from '../../animals/model';
import { editAnimal, getAnimal, listAnimals } from '../../animals/repo';
import { unusualAmount } from '../../production/alerts';
import { type Session, SESSIONS, sessionFor, toCl } from '../../production/calc';
import { dayLabel, L, LITRES_HINT, parseLitres, SESSION_LABELS } from '../../production/format';
import { markNotMilked, notMilkedKey, undoNotMilked, useNotMilked } from '../../production/notMilked';
import { findSession, listMilk, recordRound } from '../../production/repo';
import { useDraft } from '../../lib/useDraft';
import { useLocal } from '../../sync/store';
import { activeWithdrawal } from '../../care/model';
import { loadCareData } from '../../care/repo';
import { formatDateTime } from '../../lib/dates';
import { Chips } from '../../ui/Chips';
import { DateField, toDateString } from '../../ui/DateField';
import { Button, FieldError, FormScreen, Notice, Toggle } from '../../ui/form';
import { minTouch, radius, shadow, spacing, type, useTheme } from '../../ui/theme';

export default function MilkingRound() {
  // Opened from a "not recorded" reminder: that day and milking.
  const params = useLocalSearchParams<{ date?: string; session?: Session }>();
  const [date, setDate] = useState(params.date ?? toDateString(new Date()));
  const [session, setSession] = useState<Session>(params.session && SESSIONS.includes(params.session) ? params.session : sessionFor(new Date()));
  const [showAll, setShowAll] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  // A new sheet (and draft) per date and session.
  return (
    <RoundSheet key={`${date}-${session}`} date={date} session={session} showAll={showAll} onSaved={setDone}>
      {done ? <Notice tone="success">{done}</Notice> : null}
      <DateField label="Date" value={date} onChange={(d) => d && setDate(d)} optional={false} />
      <Chips label="Session" value={session} options={SESSIONS.map((s) => ({ value: s, label: SESSION_LABELS[s] }))} onChange={(s) => s && setSession(s)} allowClear={false} />
      <Toggle label="Show all females" hint="Not only cows marked as in milk" value={showAll} onChange={setShowAll} />
    </RoundSheet>
  );
}

const INTRO = 'Type the litres for each cow, then save once. Tap the three-dot button beside a cow that was not milked or is dry now. Works offline.';

function RoundSheet({ date, session, showAll, onSaved, children }: { date: string; session: Session; showAll: boolean; onSaved: (message: string) => void; children: ReactNode }) {
  const t = useTheme();
  // The litres boxes in list order, so the keyboard's Next key moves down the herd.
  const inputs = useRef(new Map<string, ComponentRef<typeof TextInput>>());
  const animals = useLocal(listAnimals);
  const milk = useLocal(listMilk);
  const treatments = useLocal(() => loadCareData().treatments);
  // The session's nominal time on the farm, as used by the server for withdrawal.
  const sessionAt = new Date(`${date}T${{ morning: '06', afternoon: '12', evening: '18' }[session]}:00:00`);
  const [values, update, clearDraft] = useDraft<Record<string, string>>(`round-${date}-${session}`, () => ({}));
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const notMilked = useNotMilked();

  // A cow with no figure for this milking: not milked this time, or no longer in milk.
  function noFigure(c: (typeof cows)[number]) {
    Alert.alert(displayName(c), `${SESSION_LABELS[session]}, ${dayLabel(date)}`, [
      { text: 'Not milked this time', onPress: () => markNotMilked(notMilkedKey(date, session, c.id)) },
      {
        text: 'She is dry now',
        onPress: () => {
          const stored = getAnimal(c.id);
          if (stored) editAnimal(stored, { production_status: 'dry' });
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  const cows = animals
    .map((a) => a.data)
    .filter((a) => a.sex === 'female' && a.status === 'active' && (showAll || a.production_status === 'lactating'))
    .sort((a, b) => displayName(a).localeCompare(displayName(b), undefined, { numeric: true }));

  const skipped = (id: string) => notMilked.has(notMilkedKey(date, session, id));
  const typed = cows.filter((c) => (values[c.id] ?? '').trim() !== '' && !skipped(c.id) && !findSession(milk, { cattle_id: c.id, production_date: date, session }));
  const totalCl = typed.reduce((sum, c) => sum + (parseLitres(values[c.id]) ? toCl(parseLitres(values[c.id])!) : 0), 0);

  function save() {
    const bad = Object.fromEntries(typed.filter((c) => !parseLitres(values[c.id])).map((c) => [c.id, true]));
    setErrors(bad);
    if (Object.keys(bad).length) return;
    if (!typed.length) return Alert.alert('Nothing to save', 'Type the litres for at least one cow.');
    // Amounts far from a cow's usual for this milking are listed so a typing mistake is caught here.
    const rows = milk.map((m) => m.data);
    const odd = typed.flatMap((c) => {
      const u = unusualAmount(rows, c.id, session, date, parseLitres(values[c.id])!);
      return u ? [`${displayName(c)}: ${parseLitres(values[c.id])} L${u.usualCl ? ` (usually about ${L(u.usualCl)})` : ''}`] : [];
    });
    const check = odd.length ? `\n\nCheck ${odd.length === 1 ? 'this amount' : 'these amounts'}, far from usual:\n${odd.join('\n')}` : '';
    Alert.alert(odd.length ? 'Check before saving' : 'Save milking round?', `${typed.length} cow${typed.length === 1 ? '' : 's'}, ${L(totalCl)}\n${SESSION_LABELS[session]}, ${dayLabel(date)}${check}`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Save',
        onPress: () => {
          const { saved, skipped } = recordRound(typed.map((c) => ({ cattle_id: c.id, production_date: date, session, quantity: parseLitres(values[c.id])! })));
          clearDraft();
          update(Object.fromEntries(Object.keys(values).map((k) => [k, ''])));
          onSaved(`Saved ${saved} entr${saved === 1 ? 'y' : 'ies'} (${L(totalCl)}).${skipped ? ` ${skipped} already recorded were skipped.` : ''}`);
        },
      },
    ]);
  }

  if (!cows.length) {
    return (
      <FormScreen title="Milking round" intro={INTRO}>
        {children}
        <Notice>
          {showAll ? 'No active female animals.' : 'No cows are marked as in milk. Turn on “Show all females”, or set an animal’s production to “In milk”.'}
        </Notice>
      </FormScreen>
    );
  }

  const open = cows.filter((c) => !skipped(c.id) && !findSession(milk, { cattle_id: c.id, production_date: date, session })).map((c) => c.id);
  const next = (id: string) => open[open.indexOf(id) + 1];

  const footer = (
    <>
      {Object.keys(errors).length ? <FieldError message={LITRES_HINT} /> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <Text style={{ flex: 1, color: t.text, ...type.input, fontWeight: '600' }} accessibilityLiveRegion="polite">
          {typed.length} cow{typed.length === 1 ? '' : 's'} · {L(totalCl)}
        </Text>
        <View style={{ flex: 1 }}>
          <Button label="Save round" onPress={save} />
        </View>
      </View>
    </>
  );

  return (
    <FormScreen title="Milking round" intro={INTRO} footer={footer}>
      {children}
      <View style={{ backgroundColor: t.surface, borderRadius: radius.card, paddingHorizontal: spacing.md, ...shadow }}>
        {cows.map((c, i) => {
          const existing = findSession(milk, { cattle_id: c.id, production_date: date, session });
          const withdrawal = activeWithdrawal(treatments, c.id, sessionAt);
          const after = next(c.id);
          return (
            <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: minTouch + 12, borderTopWidth: i ? 1 : 0, borderTopColor: t.border, paddingVertical: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.text, ...type.input }}>{displayName(c)}</Text>
                {withdrawal ? (
                  <View style={{ flexDirection: 'row', gap: spacing.xs }} accessible accessibilityRole="alert">
                    <MaterialCommunityIcons name="alert-outline" size={16} color={t.danger} style={{ marginTop: 1 }} />
                    <Text style={{ flex: 1, color: t.danger, ...type.secondary }}>
                      Withdrawal until {formatDateTime(withdrawal.withdrawal_ends_at)} · not for sale
                    </Text>
                  </View>
                ) : null}
              </View>
              {existing ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${displayName(c)}: ${L(toCl(existing.data.quantity))} recorded. Open to correct.`}
                  onPress={() => router.push({ pathname: '/milk/[id]', params: { id: existing.data.id } })}
                  style={{ minHeight: minTouch, justifyContent: 'center' }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                    <MaterialCommunityIcons name="check" size={18} color={t.primary} />
                    <Text style={{ color: t.textMuted, ...type.body }}>{L(toCl(existing.data.quantity))}</Text>
                  </View>
                </Pressable>
              ) : skipped(c.id) ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${displayName(c)}: not milked. Undo.`}
                  onPress={() => undoNotMilked(notMilkedKey(date, session, c.id))}
                  style={{ minHeight: minTouch, justifyContent: 'center' }}
                >
                  <Text style={{ color: t.textMuted, ...type.body }}>
                    Not milked · <Text style={{ color: t.primary }}>Undo</Text>
                  </Text>
                </Pressable>
              ) : (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`No figure for ${displayName(c)}`}
                    accessibilityHint="Not milked this time, or she is dry now"
                    onPress={() => noFigure(c)}
                    hitSlop={6}
                    style={{ minHeight: minTouch, minWidth: 36, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <MaterialCommunityIcons name="dots-vertical" size={22} color={t.textMuted} />
                  </Pressable>
                  <View style={{ width: 110 }}>
                    <TextInput
                      ref={(el) => {
                        if (el) inputs.current.set(c.id, el);
                        else inputs.current.delete(c.id);
                      }}
                      accessibilityLabel={`Litres for ${displayName(c)}`}
                      value={values[c.id] ?? ''}
                      onChangeText={(v) => update({ [c.id]: v })}
                      keyboardType="decimal-pad"
                      returnKeyType={after ? 'next' : 'done'}
                      submitBehavior={after ? 'submit' : 'blurAndSubmit'}
                      onSubmitEditing={() => (after ? inputs.current.get(after)?.focus() : undefined)}
                      placeholder="L"
                      placeholderTextColor={t.textMuted}
                      maxLength={6}
                      style={{
                        minHeight: minTouch,
                        borderWidth: errors[c.id] ? 2 : 1,
                        borderColor: errors[c.id] ? t.danger : t.border,
                        borderRadius: radius.control,
                        paddingHorizontal: spacing.md,
                        ...type.input,
                        fontSize: 18, // a little larger: the figure being typed
                        color: t.text,
                        backgroundColor: t.background,
                        textAlign: 'right',
                      }}
                    />
                  </View>
                </View>
              )}
            </View>
          );
        })}
      </View>
    </FormScreen>
  );
}
