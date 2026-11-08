import { useState } from 'react';
import { Text, View } from 'react-native';
import type { Breed } from '../animals/model';
import { addBreed, updateBreed } from '../animals/repo';
import { getRecord, listRecords, useLocal } from '../sync/store';
import { Button, FormScreen, Notice, TextField, Toggle } from '../ui/form';
import { SyncBadge } from '../ui/SyncBadge';
import { FormCard, ListGroup } from '../ui/kit';
import { spacing, type, useTheme } from '../ui/theme';

export default function Breeds() {
  const t = useTheme();
  const breeds = useLocal(() => listRecords<Breed>('cattle_breeds').sort((a, b) => a.data.name.localeCompare(b.data.name)));
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  function add() {
    const trimmed = name.trim();
    if (!trimmed) return setError('Enter a breed name.');
    if (breeds.some((b) => b.data.name.toLowerCase() === trimmed.toLowerCase())) return setError('You already have this breed.');
    addBreed(trimmed);
    setName('');
    setError(null);
  }

  return (
    <FormScreen title="Breeds">
      <FormCard>
        <TextField label="Add a breed" value={name} onChangeText={setName} error={error} placeholder="e.g. Angoni" onSubmitEditing={add} />
        <Button label="Add breed" onPress={add} />
      </FormCard>
      {breeds.length === 0 ? <Notice>Your breed list will appear after the first sync.</Notice> : null}
      {breeds.length ? (
        <ListGroup>
          {breeds.map(({ data: b, sync_state }) => (
            <View key={b.id} style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
              <Toggle label={b.name} hint={b.active ? undefined : 'Hidden when registering'} value={b.active} onChange={(active) => updateBreed(getRecord<Breed>('cattle_breeds', b.id)!, { active })} />
              <SyncBadge state={sync_state} />
            </View>
          ))}
        </ListGroup>
      ) : null}
      <Text style={{ color: t.textMuted, ...type.caption }}>Turn a breed off to hide it from new registrations. Breeds are never deleted, so past records stay readable.</Text>
    </FormScreen>
  );
}
