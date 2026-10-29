import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Text } from 'react-native';
import { displayName } from '../../animals/model';
import { getAnimal } from '../../animals/repo';
import { type Session, SESSIONS, toCl } from '../../production/calc';
import { dayLabel, L, LITRES_HINT, parseLitres, SESSION_LABELS } from '../../production/format';
import { correctMilk, type MilkEntry, SessionTaken, voidMilk } from '../../production/repo';
import { getRecord, useLocal } from '../../sync/store';
import { Chips } from '../../ui/Chips';
import { DateField } from '../../ui/DateField';
import { Button, FormScreen, Notice, TextField } from '../../ui/form';
import { MissingRecord } from '../../ui/ProblemView';
import { SyncBadge } from '../../ui/SyncBadge';
import { Details, FormCard, Hero, ListGroup, ListRow, Pill } from '../../ui/kit';
import { useTheme } from '../../ui/theme';

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

  if (!entry) return <MissingRecord what="milk entry" />;
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
    <FormScreen title="Milk entry">
      <Hero
        label={`${cow ? displayName(cow.data) : 'Animal'} · ${SESSION_LABELS[e.session]}, ${dayLabel(e.production_date)}`}
        value={L(toCl(e.quantity))}
        tone={voided ? 'muted' : undefined}
        pill={voided ? <Pill label="Voided" tint="sky" /> : e.restricted ? <Pill label="Withdrawal · not for sale" tint="red" /> : undefined}
      />
      <SyncBadge state={entry.sync_state} />
      {voided ? <Notice>Voided: {e.void_reason}. Not counted in totals or stock.</Notice> : null}
      {e.restricted && !voided ? <Notice tone="error">Under milk withdrawal: recorded as produced, but not for sale or drinking and not added to stock.</Notice> : null}
      <Details rows={[['Note', e.notes]]} />
      {e.version === 0 ? <Text style={{ color: t.textMuted, fontSize: 13 }}>Milk withdrawal is checked again when this entry syncs.</Text> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      {mode === 'correct' ? (
        <FormCard title="Correct this entry">
          <TextField label="Litres" value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" maxLength={6} />
          <DateField label="Date" value={date} onChange={(d) => d && setDate(d)} optional={false} />
          <Chips label="Session" value={session} options={SESSIONS.map((s) => ({ value: s, label: SESSION_LABELS[s] }))} onChange={(s) => s && setSession(s)} allowClear={false} />
          <TextField label="Reason" hint="Kept in the history with the old value" value={reason} onChangeText={setReason} />
          <Button label="Save correction" onPress={saveCorrection} />
          <Button label="Cancel" variant="link" onPress={() => setMode('view')} />
        </FormCard>
      ) : mode === 'void' ? (
        <FormCard title="Void this entry">
          <TextField label="Why is it a mistake?" value={reason} onChangeText={setReason} />
          <Button label="Void entry" variant="danger" onPress={saveVoid} />
          <Button label="Cancel" variant="link" onPress={() => setMode('view')} />
        </FormCard>
      ) : (
        <ListGroup>
          {cow ? <ListRow icon="cow" title={displayName(cow.data)} subtitle="Open the animal" back href={{ pathname: '/animal/[id]', params: { id: e.cattle_id } }} /> : null}
          {!voided ? (
            <ListRow
              icon="pencil-outline"
              title="Correct this entry"
              onPress={() => {
                setQuantity(e.quantity);
                setDate(e.production_date);
                setSession(e.session);
                setMode('correct');
              }}
            />
          ) : null}
          {!voided ? <ListRow icon="close-circle-outline" tint="red" title="Void" subtitle="Only if entered by mistake" onPress={() => setMode('void')} /> : null}
        </ListGroup>
      )}
    </FormScreen>
  );
}
