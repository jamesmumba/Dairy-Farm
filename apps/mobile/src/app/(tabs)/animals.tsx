import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { AGE_BANDS, type AnimalFilter, ageLabel, displayName, EMPTY_FILTER, matches, PRODUCTION_LABELS, type ProductionStatus, REPRODUCTIVE_LABELS, type ReproductiveStatus, STATUS_LABELS } from '../../animals/model';
import { listAnimals, listBreeds } from '../../animals/repo';
import { useLocal } from '../../sync/store';
import { activeWithdrawal, underTreatment } from '../../care/model';
import { loadCareData } from '../../care/repo';
import { toDateString } from '../../lib/dates';
import { Chips } from '../../ui/Chips';
import { FilterSheet, SearchBar } from '../../ui/SearchBar';
import { SyncBadge } from '../../ui/SyncBadge';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Avatar, Pill } from '../../ui/kit';
import { useSyncRefresh } from '../../ui/useSyncRefresh';
import { minTouch, radius, shadow, spacing, type, useTheme } from '../../ui/theme';

export default function Animals() {
  const t = useTheme();
  const refresh = useSyncRefresh();
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
        refreshControl={<RefreshControl {...refresh} />}
        data={shown}
        keyExtractor={(a) => a.data.id}
        contentContainerStyle={{ padding: spacing.md, gap: spacing.sm, paddingBottom: 96 }}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={{ gap: spacing.sm, marginBottom: spacing.sm }}>
            <SearchBar value={filter.query} onChangeText={(query) => set({ query })} placeholder="Ear tag, name or ID" activeFilters={activeFilters} onFilters={() => setShowFilters(true)} />
            <FilterSheet
              visible={showFilters}
              onClose={() => setShowFilters(false)}
              onClear={
                activeFilters
                  ? () => {
                      setFilter({ ...EMPTY_FILTER, query: filter.query });
                      setHealth(null);
                    }
                  : undefined
              }
              showLabel={`Show ${shown.length} animal${shown.length === 1 ? '' : 's'}`}
            >
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
            </FilterSheet>
            <Text style={{ color: t.textMuted, fontSize: 15 }} accessibilityLiveRegion="polite">
              {shown.length} of {animals.length} animal{animals.length === 1 ? '' : 's'}
            </Text>
          </View>
        }
        ListEmptyComponent={
          <View style={{ alignItems: 'center', gap: spacing.sm, padding: spacing.lg }}>
            <MaterialCommunityIcons name="cow" size={48} color={t.chart} importantForAccessibility="no" />
            <Text style={{ color: t.textMuted, fontSize: 16, textAlign: 'center' }}>
              {animals.length ? 'No animals match your search or filters.' : 'No animals yet. Register your first animal to start keeping records.'}
            </Text>
          </View>
        }
        renderItem={({ item: { data: a, sync_state } }) => {
          const withdrawal = !!activeWithdrawal(care.treatments, a.id);
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${displayName(a)}, ${a.sex}, ${breedName.get(a.breed_id ?? '') ?? 'breed not set'}, ${STATUS_LABELS[a.status]}${withdrawal ? ', milk withdrawal' : ''}`}
              onPress={() => router.push({ pathname: '/animal/[id]', params: { id: a.id } })}
              style={({ pressed }) => ({
                minHeight: minTouch + 24,
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.md,
                padding: spacing.md,
                borderRadius: radius.card,
                backgroundColor: pressed ? t.primarySoft : t.surface,
                ...shadow,
              })}
            >
              <Avatar name={displayName(a)} tint={a.status !== 'active' ? 'sky' : withdrawal ? 'red' : 'green'} size={48} />
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={{ color: t.text, ...type.cardTitle, fontSize: 17 }}>{displayName(a)}</Text>
                <Text style={{ color: t.textMuted, fontSize: 14 }}>
                  {[breedName.get(a.breed_id ?? ''), ageLabel(a)].filter(Boolean).join(' · ') || (a.sex === 'female' ? 'Female' : 'Male')}
                </Text>
                {/* One label only: the most important thing about this animal right now. */}
                {a.status !== 'active' ? (
                  <Pill label={STATUS_LABELS[a.status]} tint="sky" />
                ) : withdrawal ? (
                  <Pill label="Milk withdrawal" tint="red" />
                ) : a.reproductive_status === 'pregnant' ? (
                  <Pill label="Pregnant" tint="straw" />
                ) : a.production_status === 'lactating' ? (
                  <Pill label="In milk" />
                ) : null}
                <SyncBadge state={sync_state} />
              </View>
              <MaterialCommunityIcons name="chevron-right" size={22} color={t.textMuted} importantForAccessibility="no" />
            </Pressable>
          );
        }}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Register an animal"
        onPress={() => router.push('/animal/new')}
        style={({ pressed }) => ({
          position: 'absolute',
          right: spacing.md,
          bottom: spacing.md,
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.xs,
          height: 56,
          paddingHorizontal: spacing.lg,
          borderRadius: 28,
          backgroundColor: t.primary,
          opacity: pressed ? 0.9 : 1,
          ...shadow,
          shadowOpacity: 0.2,
          elevation: 6,
        })}
      >
        <MaterialCommunityIcons name="plus" size={24} color={t.onPrimary} />
        <Text style={{ color: t.onPrimary, fontSize: 16, fontWeight: '600' }}>Add animal</Text>
      </Pressable>
    </View>
  );
}
