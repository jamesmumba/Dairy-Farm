import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';
import { type AnimalStatus, DEATH_CAUSE_LABELS, displayName, SALE_REASON_LABELS, STATUS_LABELS } from '../../../animals/model';
import { changeAnimalStatus, getAnimal } from '../../../animals/repo';
import { CARE_FORMS } from '../../../care/forms';
import { useCareContext } from '../../../care/useCareContext';
import { useLocal } from '../../../sync/store';
import { Chips } from '../../../ui/Chips';
import { DateField, toDateString } from '../../../ui/DateField';
import { Button, Choice, FormScreen, Notice, TextField } from '../../../ui/form';
import { MissingRecord } from '../../../ui/ProblemView';

const HINTS: Record<AnimalStatus, string> = {
  active: 'Still on the farm.',
  sold: 'Add the buyer and price in the details.',
  deceased: 'Choose the cause, if known.',
  transferred: 'Moved to another farm or owner.',
  inactive: 'No longer kept for production, but still recorded.',
};

/** Why it left, as a category, so deaths and sales can be counted by cause in the herd health report. */
const REASONS: Partial<Record<AnimalStatus, { label: string; options: Record<string, string> }>> = {
  deceased: { label: 'Cause of death', options: DEATH_CAUSE_LABELS },
  sold: { label: 'Main reason for selling', options: SALE_REASON_LABELS },
};

export default function ChangeStatus() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const animal = useLocal(() => getAnimal(id), id);
  const ctx = useCareContext();
  const [status, setStatus] = useState<AnimalStatus>(animal?.data.status === 'active' ? 'sold' : 'active');
  const [date, setDate] = useState<string | null>(toDateString(new Date()));
  const [details, setDetails] = useState('');
  const [why, setWhy] = useState<string | null>(null);
  const [healthId, setHealthId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (!animal) return <MissingRecord what="animal" />;

  const reactivating = status === 'active';
  const reasons = REASONS[status];
  // The illness behind a death or sale: this animal's health concerns, newest first.
  const concerns = ctx.care.health
    .filter((h) => h.cattle_id === animal.data.id)
    .sort((a, b) => b.reported_on.localeCompare(a.reported_on))
    .slice(0, 6);
  const askIllness = why === 'illness' && concerns.length > 0;

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
            status_reason: reasons ? why : null,
            status_health_record_id: askIllness ? healthId : null,
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
          setWhy(null);
          setHealthId(null);
          setError(null);
        }}
      />
      {reactivating ? (
        <TextField label="Why is the animal active again?" hint="For example: sale cancelled, recorded by mistake" value={reason} onChangeText={setReason} />
      ) : (
        <>
          <DateField label="Date" value={date} onChange={setDate} optional={false} />
          {reasons ? (
            <Chips label={reasons.label} value={why} options={Object.entries(reasons.options).map(([value, label]) => ({ value, label }))} onChange={setWhy} />
          ) : null}
          {askIllness ? (
            <Chips
              label="Which illness? (optional)"
              value={healthId}
              options={concerns.map((h) => ({ value: h.id, label: CARE_FORMS.health.summary(h, ctx) }))}
              onChange={setHealthId}
            />
          ) : null}
          <TextField label="Details (optional)" hint="Buyer, price, what happened, new owner…" value={details} onChangeText={setDetails} multiline />
        </>
      )}
      <Button label="Save" onPress={save} />
    </FormScreen>
  );
}
