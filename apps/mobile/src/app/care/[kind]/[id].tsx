import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Text } from 'react-native';
import { displayName } from '../../../animals/model';
import { listAnimals } from '../../../animals/repo';
import { CareForm } from '../../../care/CareForm';
import { CARE_FORMS, fromRecord } from '../../../care/forms';
import { CARE_KINDS, type CareKind, type Treatment } from '../../../care/model';
import { getCare, removeCare, updateCare } from '../../../care/repo';
import { useCareContext } from '../../../care/useCareContext';
import { formatDate, formatDateTime } from '../../../lib/dates';
import { useLocal } from '../../../sync/store';
import { Button, FormScreen, Notice, TextField } from '../../../ui/form';
import { SyncBadge } from '../../../ui/SyncBadge';
import { Details, FormCard, Hero, ListGroup, ListRow } from '../../../ui/kit';
import { useTheme } from '../../../ui/theme';

type Row = { id: string; version: number; deleted_at: string | null } & Record<string, unknown>;

export default function CareRecord() {
  const t = useTheme();
  const { kind, id } = useLocalSearchParams<{ kind: CareKind; id: string }>();
  const ctx = useCareContext();
  const allAnimals = useLocal(() => listAnimals().map((a) => a.data));
  const record = useLocal(() => (kind in CARE_KINDS ? getCare<Row>(kind, id) : null), `${kind}:${id}`);
  const [mode, setMode] = useState<'view' | 'edit' | 'remove'>('view');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!record) return <FormScreen title="Record"><Notice tone="error">This record is no longer on this phone.</Notice></FormScreen>;
  const config = CARE_FORMS[kind];
  const r = record.data;
  const animalId = (r.cattle_id ?? r.dam_id) as string | undefined;
  const animal = allAnimals.find((a) => a.id === animalId);
  const treatment = kind === 'treatment' ? (r as unknown as Treatment) : null;

  const show = (key: string, type: string): string | null => {
    const v = r[key];
    if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) return null;
    if (type === 'bool') return v ? 'Yes' : 'No';
    if (type === 'date') return formatDate(String(v));
    if (type === 'datetime') return formatDateTime(String(v));
    if (type === 'choice') return config.fields.find((f) => f.key === key)?.options?.find((o) => o.value === v)?.label ?? String(v);
    if (type === 'animal') {
      const a = allAnimals.find((x) => x.id === v);
      return a ? displayName(a) : null;
    }
    if (type === 'link') return null;
    return Array.isArray(v) ? v.join(', ') : String(v);
  };

  function remove() {
    if (reason.trim().length < 3) return setError('Say why this record is being removed.');
    Alert.alert('Remove this record?', 'It is kept in the history with your reason but no longer counts anywhere.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          removeCare(kind, record!, reason.trim());
          router.back();
        },
      },
    ]);
  }

  return (
    <FormScreen title={CARE_KINDS[kind].label}>
      <Hero label={animal ? displayName(animal) : CARE_KINDS[kind].label} value={config.summary(r, ctx)} />
      <SyncBadge state={record.sync_state} />
      {r.version === 0 ? <Text style={{ color: t.textMuted, fontSize: 13 }}>Status changes, scheduled checks and milk re-checks appear after this syncs.</Text> : null}
      {treatment?.milk_entries_rechecked ? (
        <Notice>{treatment.milk_entries_rechecked} milk entr{treatment.milk_entries_rechecked === 1 ? 'y was' : 'ies were'} re-checked against this withdrawal and updated.</Notice>
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      {mode === 'edit' ? (
        <CareForm
          kind={kind}
          draftKey={`care-edit-${kind}-${id}`}
          initial={fromRecord(config, r)}
          ctx={ctx}
          creating={false}
          submitLabel="Save changes"
          onSubmit={(body) => {
            const changes = Object.fromEntries(Object.entries(body).filter(([k, v]) => JSON.stringify(v ?? null) !== JSON.stringify(r[k] ?? null)));
            if (Object.keys(changes).length) updateCare(kind, record, changes);
            setMode('view');
          }}
        />
      ) : (
        <>
          <Details
            rows={config.fields
              .filter((f) => !f.createOnly)
              .map((f) => [f.label, show(f.key, f.type)] as [string, string | null])}
          />
          {mode === 'remove' ? (
            <FormCard title="Remove this record">
              <TextField label="Why?" hint="For records entered by mistake" value={reason} onChangeText={setReason} />
              <Button label="Remove record" variant="danger" onPress={remove} />
              <Button label="Cancel" variant="link" onPress={() => setMode('view')} />
            </FormCard>
          ) : (
            <ListGroup>
              {animal ? <ListRow icon="cow" title={displayName(animal)} subtitle="Open the animal" href={{ pathname: '/animal/[id]', params: { id: animal.id } }} /> : null}
              <ListRow icon="pencil-outline" title="Edit" onPress={() => setMode('edit')} />
              <ListRow icon="delete-outline" tint="red" title="Remove" subtitle="Only if entered by mistake" onPress={() => setMode('remove')} />
            </ListGroup>
          )}
        </>
      )}
    </FormScreen>
  );
}
