import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';
import { ParentPicker } from '../../animals/ParentPicker';
import { listAnimals } from '../../animals/repo';
import { type Session, SESSIONS, sessionFor } from '../../production/calc';
import { LITRES_HINT, parseLitres, SESSION_LABELS } from '../../production/format';
import { addMilk, SessionTaken } from '../../production/repo';
import { useLocal } from '../../sync/store';
import { Chips } from '../../ui/Chips';
import { DateField, toDateString } from '../../ui/DateField';
import { Button, FormScreen, Notice, TextField } from '../../ui/form';

export default function NewMilkEntry() {
  const params = useLocalSearchParams<{ cattle_id?: string }>();
  const animals = useLocal(listAnimals);
  const cows = animals.map((a) => a.data).filter((a) => a.sex === 'female' && a.status === 'active');
  const [cattleId, setCattleId] = useState<string | null>(params.cattle_id ?? null);
  const [date, setDate] = useState(toDateString(new Date()));
  const [session, setSession] = useState<Session>(sessionFor(new Date()));
  const [quantity, setQuantity] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  function save() {
    const litres = parseLitres(quantity);
    if (!cattleId) return setError('Choose the cow.');
    if (!litres) return setError(LITRES_HINT);
    try {
      addMilk({ cattle_id: cattleId, production_date: date, session, quantity: litres, notes: notes.trim() || null });
      router.back();
    } catch (err) {
      if (!(err instanceof SessionTaken)) throw err;
      Alert.alert('Already recorded', `This cow already has a ${session} entry for that day (${err.existing.quantity} L). Open it to correct it?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open entry', onPress: () => router.replace({ pathname: '/milk/[id]', params: { id: err.existing.id } }) },
      ]);
    }
  }

  return (
    <FormScreen title="Milk entry">
      {error ? <Notice tone="error">{error}</Notice> : null}
      <ParentPicker label="Cow" sex="female" value={cattleId} animals={cows} onChange={setCattleId} />
      <DateField label="Date" value={date} onChange={(d) => d && setDate(d)} optional={false} />
      <Chips label="Session" value={session} options={SESSIONS.map((s) => ({ value: s, label: SESSION_LABELS[s] }))} onChange={(s) => s && setSession(s)} allowClear={false} />
      <TextField label="Litres" value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" maxLength={6} />
      <TextField label="Notes (optional)" value={notes} onChangeText={setNotes} multiline />
      <Button label="Save" onPress={save} />
    </FormScreen>
  );
}
