import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BottomSheet } from '../ui/BottomSheet';
import { Button } from '../ui/form';
import { Avatar } from '../ui/kit';
import { SearchBar } from '../ui/SearchBar';
import { minTouch, radius, spacing, type, useTheme } from '../ui/theme';
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
      <Text style={{ color: t.text, ...type.cardTitle }}>{label}</Text>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Button label={selected ? displayName(selected) : 'Choose from herd'} variant="secondary" onPress={() => setOpen(true)} hint={`Choose the ${label.toLowerCase()} from your herd`} />
        </View>
        {selected ? <Button label="Clear" variant="link" onPress={() => onChange(null)} /> : null}
      </View>

      <BottomSheet visible={open} title={`Choose ${label.toLowerCase().replace(' (optional)', '')}`} onClose={() => setOpen(false)} footer={<Button label="Cancel" variant="secondary" onPress={() => setOpen(false)} />}>
        <SearchBar value={query} onChangeText={setQuery} placeholder="Ear tag, name or ID" />
        {options.length === 0 ? <Text style={{ color: t.textMuted, ...type.body }}>No {sex ? `${sex} ` : ''}animals match.</Text> : null}
        <View>
          {options.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityLabel={displayName(item)}
              onPress={() => {
                onChange(item.id);
                setOpen(false);
              }}
              style={({ pressed }) => ({ minHeight: minTouch + 12, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, backgroundColor: pressed ? t.primarySoft : 'transparent', borderRadius: radius.control })}
            >
              <Avatar name={displayName(item)} size={40} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.text, ...type.cardTitle }}>{displayName(item)}</Text>
                <Text style={{ color: t.textMuted, ...type.secondary }}>ID {shortCode(item.id)}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      </BottomSheet>
    </View>
  );
}
