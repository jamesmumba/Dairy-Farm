import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';
import { type AnimalStatus, displayName, STATUS_LABELS } from '../../../animals/model';
import { changeAnimalStatus, getAnimal } from '../../../animals/repo';
import { useLocal } from '../../../sync/store';
import { DateField, toDateString } from '../../../ui/DateField';
import { Button, Choice, FormScreen, Notice, TextField } from '../../../ui/form';

const HINTS: Record<AnimalStatus, string> = {
  active: 'Still on the farm.',
  sold: 'Add the buyer and price in the details.',
  deceased: 'Add the cause, if known, in the details.',
  transferred: 'Moved to another farm or owner.',
  inactive: 'No longer kept for production, but still recorded.',
};

export default function ChangeStatus() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const animal = useLocal(() => getAnimal(id), id);
  const [status, setStatus] = useState<AnimalStatus>(animal?.data.status === 'active' ? 'sold' : 'active');
  const [date, setDate] = useState<string | null>(toDateString(new Date()));
  const [details, setDetails] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (!animal) return <FormScreen card title="Change status"><Notice tone="error">This animal is no longer in your herd.</Notice></FormScreen>;

  const reactivating = status === 'active';

  function save() {
    if (status === animal!.data.status) return setError(`The animal is already ${STATUS_LABELS[status].toLowerCase()}.`);
    if (!reactivating && !date) return setError('Enter the date.');
    if (reactivating && !reason.trim()) return setError('Say why the animal is active again.');
    Alert.alert('Save status change?', `${displayName(animal!.data)} will be marked ${STATUS_LABELS[status].toLowerCase()}. Its records are kept.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Save',
        onPress: () => {
          changeAnimalStatus(animal!, {
            status,
            status_date: reactivating ? null : date,
            status_details: reactivating ? null : details.trim() || null,
            reason: reason.trim() || null,
          });
          router.back();
        },
      },
    ]);
  }

  return (
    <FormScreen card title="Change status" intro={`${displayName(animal.data)} is currently ${STATUS_LABELS[animal.data.status].toLowerCase()}.`}>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Choice
        label="New status"
        value={status}
        options={(Object.keys(STATUS_LABELS) as AnimalStatus[]).filter((s) => s !== animal.data.status).map((s) => ({ value: s, label: `${STATUS_LABELS[s]}: ${HINTS[s]}` }))}
        onChange={(s) => {
          setStatus(s);
          setError(null);
        }}
      />
      {reactivating ? (
        <TextField label="Why is the animal active again?" hint="For example: sale cancelled, recorded by mistake" value={reason} onChangeText={setReason} />
      ) : (
        <>
          <DateField label="Date" value={date} onChange={setDate} optional={false} />
          <TextField label="Details (optional)" hint="Buyer, price, cause of death, new owner…" value={details} onChangeText={setDetails} multiline />
        </>
      )}
      <Button label="Save" onPress={save} />
    </FormScreen>
  );
}
