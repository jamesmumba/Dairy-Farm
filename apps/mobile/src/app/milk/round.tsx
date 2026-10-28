import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import { displayName } from '../../animals/model';
import { listAnimals } from '../../animals/repo';
import { unusualAmount } from '../../production/alerts';
import { type Session, SESSIONS, sessionFor, toCl } from '../../production/calc';
import { dayLabel, L, LITRES_HINT, parseLitres, SESSION_LABELS } from '../../production/format';
import { findSession, listMilk, recordRound } from '../../production/repo';
import { useDraft } from '../../lib/useDraft';
import { useLocal } from '../../sync/store';
import { activeWithdrawal } from '../../care/model';
import { loadCareData } from '../../care/repo';
import { formatDateTime } from '../../lib/dates';
import { Chips } from '../../ui/Chips';
import { DateField, toDateString } from '../../ui/DateField';
import { Button, FieldError, FormScreen, Notice, Toggle } from '../../ui/form';
import { minTouch, radius, shadow, spacing, useTheme } from '../../ui/theme';

export default function MilkingRound() {
  // Opened from a "not recorded" reminder: that day and milking.
  const params = useLocalSearchParams<{ date?: string; session?: Session }>();
  const [date, setDate] = useState(params.date ?? toDateString(new Date()));
  const [session, setSession] = useState<Session>(params.session && SESSIONS.includes(params.session) ? params.session : sessionFor(new Date()));
  const [showAll, setShowAll] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  return (
    <FormScreen title="Milking round" intro="Type the litres for each cow, then save once. Works offline.">
      {done ? <Notice>{done}</Notice> : null}
      <DateField label="Date" value={date} onChange={(d) => d && setDate(d)} optional={false} />
      <Chips label="Session" value={session} options={SESSIONS.map((s) => ({ value: s, label: SESSION_LABELS[s] }))} onChange={(s) => s && setSession(s)} allowClear={false} />
      <Toggle label="Show all females" hint="Not only cows marked as in milk" value={showAll} onChange={setShowAll} />
      {/* A new sheet (and draft) per date and session. */}
      <RoundSheet key={`${date}-${session}`} date={date} session={session} showAll={showAll} onSaved={setDone} />
    </FormScreen>
  );
}

function RoundSheet({ date, session, showAll, onSaved }: { date: string; session: Session; showAll: boolean; onSaved: (message: string) => void }) {
  const t = useTheme();
  const animals = useLocal(listAnimals);
  const milk = useLocal(listMilk);
  const treatments = useLocal(() => loadCareData().treatments);
  // The session's nominal time on the farm, as used by the server for withdrawal.
  const sessionAt = new Date(`${date}T${{ morning: '06', afternoon: '12', evening: '18' }[session]}:00:00`);
  const [values, update, clearDraft] = useDraft<Record<string, string>>(`round-${date}-${session}`, () => ({}));
  const [errors, setErrors] = useState<Record<string, boolean>>({});

  const cows = animals
    .map((a) => a.data)
    .filter((a) => a.sex === 'female' && a.status === 'active' && (showAll || a.production_status === 'lactating'))
    .sort((a, b) => displayName(a).localeCompare(displayName(b), undefined, { numeric: true }));

  const typed = cows.filter((c) => (values[c.id] ?? '').trim() !== '' && !findSession(milk, { cattle_id: c.id, production_date: date, session }));
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
      <Notice>
        {showAll ? 'No active female animals.' : 'No cows are marked as in milk. Turn on “Show all females”, or set an animal’s production to “In milk”.'}
      </Notice>
    );
  }

  return (
    <View style={{ gap: spacing.md }}>
      <View style={{ backgroundColor: t.surface, borderRadius: radius.card, paddingHorizontal: spacing.md, ...shadow }}>
        {cows.map((c, i) => {
          const existing = findSession(milk, { cattle_id: c.id, production_date: date, session });
          const withdrawal = activeWithdrawal(treatments, c.id, sessionAt);
          return (
            <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: minTouch + 12, borderTopWidth: i ? 1 : 0, borderTopColor: t.border, paddingVertical: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.text, fontSize: 17 }}>{displayName(c)}</Text>
                {withdrawal ? (
                  <Text style={{ color: t.danger, fontSize: 14 }} accessibilityRole="alert">
                    ⚠ Withdrawal until {formatDateTime(withdrawal.withdrawal_ends_at)} · not for sale
                  </Text>
                ) : null}
              </View>
              {existing ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${displayName(c)}: ${L(toCl(existing.data.quantity))} recorded. Open to correct.`}
                  onPress={() => router.push({ pathname: '/milk/[id]', params: { id: existing.data.id } })}
                  style={{ minHeight: minTouch, justifyContent: 'center' }}
                >
                  <Text style={{ color: t.textMuted, fontSize: 16 }}>✓ {L(toCl(existing.data.quantity))}</Text>
                </Pressable>
              ) : (
                <View style={{ width: 110 }}>
                  <TextInput
                    accessibilityLabel={`Litres for ${displayName(c)}`}
                    value={values[c.id] ?? ''}
                    onChangeText={(v) => update({ [c.id]: v })}
                    keyboardType="decimal-pad"
                    placeholder="L"
                    placeholderTextColor={t.textMuted}
                    maxLength={6}
                    style={{
                      minHeight: minTouch,
                      borderWidth: errors[c.id] ? 2 : 1,
                      borderColor: errors[c.id] ? t.danger : t.border,
                      borderRadius: radius.control,
                      paddingHorizontal: spacing.md,
                      fontSize: 18,
                      color: t.text,
                      backgroundColor: t.background,
                      textAlign: 'right',
                    }}
                  />
                </View>
              )}
            </View>
          );
        })}
      </View>
      {Object.keys(errors).length ? <FieldError message={LITRES_HINT} /> : null}
      <Text style={{ color: t.text, fontSize: 17, fontWeight: '600' }} accessibilityLiveRegion="polite">
        {typed.length} cow{typed.length === 1 ? '' : 's'} · {L(totalCl)}
      </Text>
      <Button label="Save round" onPress={save} />
    </View>
  );
}
