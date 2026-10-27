import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { displayName } from '../../animals/model';
import { getAnimal } from '../../animals/repo';
import { type Session, SESSIONS, toCl } from '../../production/calc';
import { dayLabel, L, LITRES_HINT, parseLitres, SESSION_LABELS } from '../../production/format';
import { correctMilk, type MilkEntry, SessionTaken, voidMilk } from '../../production/repo';
import { getRecord, useLocal } from '../../sync/store';
import { Chips } from '../../ui/Chips';
import { DateField } from '../../ui/DateField';
import { Button, FormScreen, Notice, TextField } from '../../ui/form';
import { SyncBadge } from '../../ui/SyncBadge';
import { spacing, useTheme } from '../../ui/theme';

export default function MilkEntryScreen() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const entry = useLocal(() => getRecord<MilkEntry>('milk_production', id), id);
  const cow = useLocal(() => (entry ? getAnimal(entry.data.cattle_id) : null), entry?.data.cattle_id ?? '');
  const [mode, setMode] = useState<'view' | 'correct' | 'void'>('view');
  const [quantity, setQuantity] = useState(entry?.data.quantity ?? '');
  const [date, setDate] = useState(entry?.data.production_date ?? '');
  const [session, setSession] = useState<Session>(entry?.data.session ?? 'morning');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!entry) return <FormScreen title="Milk entry"><Notice tone="error">This entry is no longer on this phone.</Notice></FormScreen>;
  const e = entry.data;
  const voided = e.status === 'voided';

  function saveCorrection() {
    const litres = parseLitres(quantity);
    if (!litres) return setError(LITRES_HINT);
    if (reason.trim().length < 3) return setError('Say why you are correcting this entry.');
    const changes = Object.fromEntries(
      Object.entries({ quantity: litres, production_date: date, session }).filter(([k, v]) =>
        k === 'quantity' ? toCl(v) !== toCl(e.quantity) : v !== e[k as keyof MilkEntry],
      ),
    );
    if (!Object.keys(changes).length) return setError('Nothing changed.');
    try {
      correctMilk(entry!, changes, reason.trim());
      setMode('view');
      setReason('');
      setError(null);
    } catch (err) {
      if (!(err instanceof SessionTaken)) throw err;
      setError(`That cow already has a ${err.existing.session} entry on ${dayLabel(err.existing.production_date)}.`);
    }
  }

  function saveVoid() {
    if (reason.trim().length < 3) return setError('Say why this entry is a mistake.');
    Alert.alert('Void this entry?', 'It stays in the history but no longer counts in totals or stock.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Void',
        style: 'destructive',
        onPress: () => {
          voidMilk(entry!, reason.trim());
          router.back();
        },
      },
    ]);
  }

  return (
    <FormScreen title={`${L(toCl(e.quantity))}`} intro={`${cow ? displayName(cow.data) : 'Animal'} · ${SESSION_LABELS[e.session]}, ${dayLabel(e.production_date)}`}>
      <SyncBadge state={entry.sync_state} />
      {voided ? <Notice>Voided: {e.void_reason}. Not counted in totals or stock.</Notice> : null}
      {e.restricted && !voided ? (
        <Notice tone="error">Milk withdrawal: this milk is not for sale or human consumption. It is recorded as produced but not added to stock.</Notice>
      ) : null}
      {e.notes ? <Text style={{ color: t.text, fontSize: 16 }}>Notes: {e.notes}</Text> : null}
      {e.version === 0 ? <Text style={{ color: t.textMuted, fontSize: 14 }}>Milk withdrawal is checked when this entry syncs.</Text> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      {mode === 'correct' ? (
        <View style={{ gap: spacing.md }}>
          <TextField label="Litres" value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" maxLength={6} />
          <DateField label="Date" value={date} onChange={(d) => d && setDate(d)} optional={false} />
          <Chips label="Session" value={session} options={SESSIONS.map((s) => ({ value: s, label: SESSION_LABELS[s] }))} onChange={(s) => s && setSession(s)} allowClear={false} />
          <TextField label="Reason for the correction" hint="Kept in the history with the old value" value={reason} onChangeText={setReason} />
          <Button label="Save correction" onPress={saveCorrection} />
          <Button label="Cancel" variant="link" onPress={() => setMode('view')} />
        </View>
      ) : mode === 'void' ? (
        <View style={{ gap: spacing.md }}>
          <TextField label="Why is this entry a mistake?" value={reason} onChangeText={setReason} />
          <Button label="Void entry" variant="danger" onPress={saveVoid} />
          <Button label="Cancel" variant="link" onPress={() => setMode('view')} />
        </View>
      ) : !voided ? (
        <>
          <Button
            label="Correct this entry"
            onPress={() => {
              setQuantity(e.quantity);
              setDate(e.production_date);
              setSession(e.session);
              setMode('correct');
            }}
          />
          <Button label="Void (entered by mistake)" variant="secondary" onPress={() => setMode('void')} />
        </>
      ) : null}
      {cow ? <Button label={`Open ${displayName(cow.data)}`} variant="link" onPress={() => router.push({ pathname: '/animal/[id]', params: { id: e.cattle_id } })} /> : null}
    </FormScreen>
  );
}
