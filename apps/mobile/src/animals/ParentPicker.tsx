import { useState } from 'react';
import { FlatList, Modal, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, TextField } from '../ui/form';
import { minTouch, spacing, useTheme } from '../ui/theme';
import { type Cattle, displayName, type Sex, shortCode } from './model';

/** Picks a mother or father from the herd (any status: parents may since have been sold). */
export function ParentPicker({
  label,
  sex,
  value,
  animals,
  excludeId,
  onChange,
}: {
  label: string;
  sex?: Sex; // omit for any animal
  value: string | null;
  animals: Cattle[];
  excludeId?: string;
  onChange: (id: string | null) => void;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = animals.find((a) => a.id === value);
  const q = query.trim().toLowerCase();
  const options = animals.filter(
    (a) => (!sex || a.sex === sex) && a.id !== excludeId && (!q || [shortCode(a.id), a.ear_tag ?? '', a.name ?? ''].some((v) => v.toLowerCase().includes(q))),
  );

  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={{ color: t.text, fontSize: 16, fontWeight: '600' }}>{label}</Text>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Button label={selected ? displayName(selected) : 'Choose from herd'} variant="secondary" onPress={() => setOpen(true)} hint={`Choose the ${label.toLowerCase()} from your herd`} />
        </View>
        {selected ? <Button label="Clear" variant="link" onPress={() => onChange(null)} /> : null}
      </View>

      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: t.background, padding: spacing.md, gap: spacing.md }}>
          <Text accessibilityRole="header" style={{ color: t.text, fontSize: 22, fontWeight: '700' }}>
            Choose {label.toLowerCase()}
          </Text>
          <TextField label="Search" value={query} onChangeText={setQuery} placeholder="Ear tag, name or ID" autoCorrect={false} />
          <FlatList
            data={options}
            keyExtractor={(a) => a.id}
            ListEmptyComponent={<Text style={{ color: t.textMuted, fontSize: 16 }}>No {sex ? `${sex} ` : ''}animals match.</Text>}
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={displayName(item)}
                onPress={() => {
                  onChange(item.id);
                  setOpen(false);
                }}
                style={{ minHeight: minTouch, justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: t.border }}
              >
                <Text style={{ color: t.text, fontSize: 17 }}>{displayName(item)}</Text>
                <Text style={{ color: t.textMuted, fontSize: 14 }}>ID {shortCode(item.id)}</Text>
              </Pressable>
            )}
          />
          <Button label="Cancel" variant="secondary" onPress={() => setOpen(false)} />
        </SafeAreaView>
      </Modal>
    </View>
  );
}
