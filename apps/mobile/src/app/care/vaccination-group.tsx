import { randomUUID } from 'expo-crypto';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Text } from 'react-native';
import { type Cattle, displayName } from '../../animals/model';
import { listBreeds } from '../../animals/repo';
import { groupDosePlan } from '../../care/existing';
import type { Vaccination } from '../../care/model';
import { createCare, getCare, updateCare } from '../../care/repo';
import { useCareContext } from '../../care/useCareContext';
import { formatDate } from '../../lib/dates';
import { useLocal } from '../../sync/store';
import { Chips } from '../../ui/Chips';
import { DateField } from '../../ui/DateField';
import { Button, FormScreen, Notice, TextField, Toggle } from '../../ui/form';
import { type, useTheme } from '../../ui/theme';

type Group = 'all' | 'milking' | 'females' | 'calves' | 'breed';

const GROUPS: { value: Group; label: string; test: (a: Cattle, breed: string | null) => boolean }[] = [
  { value: 'all', label: 'All animals', test: () => true },
  { value: 'milking', label: 'Cows in milk', test: (a) => a.production_status === 'lactating' },
  { value: 'females', label: 'All females', test: (a) => a.sex === 'female' },
  { value: 'calves', label: 'Calves', test: (a) => a.production_status === 'calf' },
  { value: 'breed', label: 'One breed', test: (a, breed) => a.breed_id === breed },
];

const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export default function GroupVaccination() {
  const t = useTheme();
  const ctx = useCareContext();
  const breeds = useLocal(listBreeds);
  const [group, setGroup] = useState<Group>('milking');
  const [breed, setBreed] = useState<string | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [scheduleId, setScheduleId] = useState<string | null>(null);
  const [vaccine, setVaccine] = useState('');
  const [disease, setDisease] = useState('');
  const [given, setGiven] = useState(ctx.today);
  const [batch, setBatch] = useState('');
  const [dose, setDose] = useState('');
  const [by, setBy] = useState('');
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const g = GROUPS.find((x) => x.value === group)!;
  const inGroup = useMemo(() => ctx.animals.filter((a) => g.test(a, breed)).sort((a, b) => displayName(a).localeCompare(displayName(b), undefined, { numeric: true })), [ctx.animals, g, breed]);
  const selected = inGroup.filter((a) => !excluded.has(a.id));
  const groupLabel = group === 'breed' ? `Breed: ${breeds.find((b) => b.id === breed)?.name ?? '?'}` : g.label;

  function chooseSchedule(id: string | null) {
    setScheduleId(id);
    const s = ctx.care.schedules.find((x) => x.id === id);
    if (!s) return;
    setVaccine(s.vaccine_name);
    setDisease(s.target_disease ?? '');
    if (s.interval_days) setNext(addDays(given, s.interval_days));
  }

  function save() {
    if (!vaccine.trim()) return setError('Enter the vaccine.');
    if (!selected.length) return setError('Select at least one animal.');
    if (next && next <= given) return setError('The next dose must be after this one.');
    const definition = `${groupLabel}, active animals on ${formatDate(given)}: ${selected.length} selected${excluded.size ? `, ${inGroup.length - selected.length} left out` : ''}`;
    // Cows with this dose already booked get that booking marked given (no second record, no leftover
    // reminder); cows already given it in the last two weeks are left out.
    const plan = groupDosePlan(selected.map((a) => a.id), vaccine.trim(), given, ctx.care);
    const recorded = plan.complete.size + plan.fresh.length;
    if (!recorded) return setError(`All ${selected.length} selected were already given ${vaccine.trim()} in the last two weeks.`);
    const notes = [
      plan.complete.size ? `${plan.complete.size} already booked: marked as given.` : null,
      plan.alreadyGiven.length ? `${plan.alreadyGiven.length} already given it in the last two weeks: left out.` : null,
    ].filter(Boolean);
    const summary = `${vaccine.trim()} for ${recorded} animal${recorded === 1 ? '' : 's'} on ${formatDate(given)}.`;
    Alert.alert('Save group vaccination?', [summary, ...notes].join('\n\n'), [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Save',
        onPress: () => {
          const batchId = randomUUID();
          for (const [, doseId] of plan.complete) {
            const booked = getCare<Vaccination>('vaccination', doseId);
            if (booked) {
              updateCare('vaccination', booked, {
                status: 'completed',
                administered_on: given,
                batch_number: batch.trim() || null,
                dosage_as_directed: dose.trim() || null,
                administered_by: by.trim() || null,
                next_due_on: next,
              });
            }
          }
          for (const a of selected.filter((x) => plan.fresh.includes(x.id))) {
            createCare('vaccination', {
              cattle_id: a.id,
              schedule_id: scheduleId,
              vaccine_name: vaccine.trim(),
              target_disease: disease.trim() || null,
              status: 'completed',
              administered_on: given,
              batch_number: batch.trim() || null,
              dosage_as_directed: dose.trim() || null,
              administered_by: by.trim() || null,
              next_due_on: next,
              is_booster: false,
              group_batch_id: batchId,
              group_label: groupLabel,
              group_definition: definition,
            });
          }
          router.back();
        },
      },
    ]);
  }

  return (
    <FormScreen card title="Group vaccination" intro="Record one vaccination for several animals. Each animal gets its own record, and the group as it was today is kept with it.">
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Chips label="Group" value={group} options={GROUPS.map(({ value, label }) => ({ value, label }))} onChange={(v) => { if (v) { setGroup(v); setExcluded(new Set()); } }} allowClear={false} />
      {group === 'breed' ? <Chips label="Breed" value={breed} options={breeds.map((b) => ({ value: b.id, label: b.name }))} onChange={setBreed} /> : null}
      <Text style={{ color: t.text, ...type.cardTitle }}>
        {selected.length} of {inGroup.length} selected
      </Text>
      {inGroup.map((a) => (
        <Toggle
          key={a.id}
          label={displayName(a)}
          value={!excluded.has(a.id)}
          onChange={(on) =>
            setExcluded((prev) => {
              const nextSet = new Set(prev);
              if (on) nextSet.delete(a.id);
              else nextSet.add(a.id);
              return nextSet;
            })
          }
        />
      ))}

      {ctx.care.schedules.length ? (
        <Chips label="Schedule" value={scheduleId} options={ctx.care.schedules.filter((s) => s.active).map((s) => ({ value: s.id, label: s.vaccine_name }))} onChange={chooseSchedule} />
      ) : null}
      <TextField label="Vaccine" value={vaccine} onChangeText={setVaccine} />
      <TextField label="Against (disease)" value={disease} onChangeText={setDisease} />
      <DateField label="Given on" value={given} onChange={(d) => d && setGiven(d)} optional={false} />
      <TextField label="Batch number" value={batch} onChangeText={setBatch} />
      <TextField label="Dose as directed" hint="As directed by the vet or the vaccine label" value={dose} onChangeText={setDose} />
      <TextField label="Given by" value={by} onChangeText={setBy} />
      <DateField label="Next dose due" value={next} onChange={setNext} allowFuture />
      <Button label={`Save for ${selected.length} animal${selected.length === 1 ? '' : 's'}`} onPress={save} />
    </FormScreen>
  );
}
