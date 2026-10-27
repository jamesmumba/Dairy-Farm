import { useState } from 'react';
import { Text, View } from 'react-native';
import type { Breed } from '../animals/model';
import { addBreed, updateBreed } from '../animals/repo';
import { getRecord, listRecords, useLocal } from '../sync/store';
import { Button, FormScreen, Notice, TextField, Toggle } from '../ui/form';
import { SyncBadge } from '../ui/SyncBadge';
import { spacing, useTheme } from '../ui/theme';

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
    <FormScreen title="Breeds" intro="Breeds you can choose when registering animals. Turn a breed off to hide it from new registrations; animals already recorded keep it.">
      <TextField label="Add a breed" value={name} onChangeText={setName} error={error} placeholder="e.g. Angoni" onSubmitEditing={add} />
      <Button label="Add breed" onPress={add} />
      {breeds.length === 0 ? <Notice>Your breed list will appear after the first sync.</Notice> : null}
      {breeds.map(({ data: b, sync_state }) => (
        <View key={b.id} style={{ borderBottomWidth: 1, borderBottomColor: t.border, paddingBottom: spacing.sm }}>
          <Toggle label={b.name} hint={b.active ? 'Shown when registering' : 'Hidden'} value={b.active} onChange={(active) => updateBreed(getRecord<Breed>('cattle_breeds', b.id)!, { active })} />
          <SyncBadge state={sync_state} />
        </View>
      ))}
      <Text style={{ color: t.textMuted, fontSize: 14 }}>Breeds are never deleted, so past records stay readable.</Text>
    </FormScreen>
  );
}
