import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { AGE_BANDS, type AnimalFilter, ageLabel, displayName, EMPTY_FILTER, matches, PRODUCTION_LABELS, type ProductionStatus, REPRODUCTIVE_LABELS, type ReproductiveStatus, shortCode, STATUS_LABELS } from '../../animals/model';
import { listAnimals, listBreeds } from '../../animals/repo';
import { useLocal } from '../../sync/store';
import { activeWithdrawal, underTreatment } from '../../care/model';
import { loadCareData } from '../../care/repo';
import { toDateString } from '../../lib/dates';
import { Chips } from '../../ui/Chips';
import { Button, TextField } from '../../ui/form';
import { SyncBadge } from '../../ui/SyncBadge';
import { minTouch, radius, spacing, useTheme } from '../../ui/theme';

export default function Animals() {
  const t = useTheme();
  const animals = useLocal(listAnimals);
  const breeds = useLocal(listBreeds);
  const [filter, setFilter] = useState<AnimalFilter>(EMPTY_FILTER);
  const [showFilters, setShowFilters] = useState(false);
  const [health, setHealth] = useState<'treatment' | 'withdrawal' | 'follow_up' | 'urgent' | null>(null);
  const care = useLocal(loadCareData);
  const set = (patch: Partial<AnimalFilter>) => setFilter((f) => ({ ...f, ...patch }));

  const breedName = useMemo(() => new Map(breeds.map((b) => [b.id, b.name])), [breeds]);
  const healthMatch = useMemo(() => {
    if (!health) return () => true;
    const today = toDateString(new Date());
    const open = care.health.filter((h) => !['recovered', 'died'].includes(h.recovery_status));
    const test: Record<string, (id: string) => boolean> = {
      treatment: (id) => underTreatment(care.treatments, id, today),
      withdrawal: (id) => !!activeWithdrawal(care.treatments, id),
      follow_up: (id) => open.some((h) => h.cattle_id === id && !!h.follow_up_on && h.follow_up_on <= today),
      urgent: (id) => open.some((h) => h.cattle_id === id && h.urgent),
    };
    return test[health];
  }, [health, care]);
  const shown = useMemo(
    () =>
      animals
        .filter((a) => matches(a.data, filter) && healthMatch(a.data.id))
        .sort((a, b) => displayName(a.data).localeCompare(displayName(b.data), undefined, { numeric: true })),
    [animals, filter, healthMatch],
  );
  const activeFilters = [filter.sex, filter.breedId, filter.production, filter.reproductive, filter.age, health].filter(Boolean).length + (filter.status !== 'active' ? 1 : 0);

  return (
    <View style={{ flex: 1, backgroundColor: t.background }}>
      <FlatList
        data={shown}
        keyExtractor={(a) => a.data.id}
        contentContainerStyle={{ padding: spacing.md, gap: spacing.sm }}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={{ gap: spacing.sm, marginBottom: spacing.sm }}>
            <Button label="Register an animal" onPress={() => router.push('/animal/new')} />
            <TextField label="Search" value={filter.query} onChangeText={(query) => set({ query })} placeholder="Ear tag, name or ID" autoCorrect={false} autoCapitalize="none" />
            <Button
              label={showFilters ? 'Hide filters' : `Filters${activeFilters ? ` (${activeFilters})` : ''}`}
              variant="link"
              onPress={() => setShowFilters((s) => !s)}
            />
            {showFilters ? (
              <View style={{ gap: spacing.sm }}>
                <Chips
                  label="Status"
                  value={filter.status}
                  options={[
                    { value: 'active', label: 'Active' },
                    { value: 'retired', label: 'Sold, dead or gone' },
                    { value: 'all', label: 'All' },
                  ]}
                  onChange={(status) => set({ status: status ?? 'active' })}
                  allowClear={false}
                />
                <Chips label="Sex" value={filter.sex} options={[{ value: 'female', label: 'Female' }, { value: 'male', label: 'Male' }]} onChange={(sex) => set({ sex })} />
                <Chips label="Breed" value={filter.breedId} options={breeds.map((b) => ({ value: b.id, label: b.name }))} onChange={(breedId) => set({ breedId })} />
                <Chips label="Production" value={filter.production} options={(Object.keys(PRODUCTION_LABELS) as ProductionStatus[]).map((p) => ({ value: p, label: PRODUCTION_LABELS[p] }))} onChange={(production) => set({ production })} />
                <Chips label="Reproduction" value={filter.reproductive} options={(Object.keys(REPRODUCTIVE_LABELS) as ReproductiveStatus[]).map((r) => ({ value: r, label: REPRODUCTIVE_LABELS[r] }))} onChange={(reproductive) => set({ reproductive })} />
                <Chips label="Age" value={filter.age} options={[...AGE_BANDS.map(({ value, label }) => ({ value, label })), { value: 'unknown' as const, label: 'Unknown' }]} onChange={(age) => set({ age })} />
                <Chips
                  label="Health"
                  value={health}
                  options={[
                    { value: 'treatment', label: 'Under treatment' },
                    { value: 'withdrawal', label: 'Milk withdrawal' },
                    { value: 'follow_up', label: 'Follow-up due' },
                    { value: 'urgent', label: 'Urgent' },
                  ]}
                  onChange={setHealth}
                />
                {activeFilters ? <Button label="Clear filters" variant="link" onPress={() => {
                      setFilter({ ...EMPTY_FILTER, query: filter.query });
                      setHealth(null);
                    }} /> : null}
              </View>
            ) : null}
            <Text style={{ color: t.textMuted, fontSize: 15 }} accessibilityLiveRegion="polite">
              {shown.length} of {animals.length} animal{animals.length === 1 ? '' : 's'}
            </Text>
          </View>
        }
        ListEmptyComponent={
          <Text style={{ color: t.textMuted, fontSize: 16 }}>
            {animals.length ? 'No animals match your search or filters.' : 'No animals yet. Register your first animal to start keeping records.'}
          </Text>
        }
        renderItem={({ item: { data: a, sync_state } }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${displayName(a)}, ${a.sex}, ${breedName.get(a.breed_id ?? '') ?? 'breed not set'}, ${STATUS_LABELS[a.status]}`}
            onPress={() => router.push({ pathname: '/animal/[id]', params: { id: a.id } })}
            style={{ minHeight: minTouch + 16, padding: spacing.md, borderRadius: radius.card, borderWidth: 1, borderColor: t.border, backgroundColor: t.surface, gap: 2 }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
              <Text style={{ color: t.text, fontSize: 17, fontWeight: '600', flexShrink: 1 }}>{displayName(a)}</Text>
              <Text style={{ color: t.textMuted, fontSize: 14 }}>ID {shortCode(a.id)}</Text>
            </View>
            <Text style={{ color: t.textMuted, fontSize: 15 }}>
              {[a.sex === 'female' ? 'Female' : 'Male', breedName.get(a.breed_id ?? ''), ageLabel(a), PRODUCTION_LABELS[a.production_status]].filter(Boolean).join(' · ')}
            </Text>
            {a.status !== 'active' ? <Text style={{ color: t.text, fontSize: 15 }}>{STATUS_LABELS[a.status]}</Text> : null}
            {!a.ear_tag ? <Text style={{ color: t.textMuted, fontSize: 14 }}>No ear tag yet</Text> : null}
            <SyncBadge state={sync_state} />
          </Pressable>
        )}
      />
    </View>
  );
}
