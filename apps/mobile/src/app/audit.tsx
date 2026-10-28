import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { type Href, router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { displayName } from '../animals/model';
import { listAnimals, listBreeds } from '../animals/repo';
import { type AuditEntry, type AuditGroup, type Described, describe, type DescribeContext } from '../audit/describe';
import { loadCareData } from '../care/repo';
import { useFinance } from '../finance/useFinance';
import { api, NetworkError } from '../lib/api';
import { getJson, setJson } from '../lib/localDb';
import { dayLabel } from '../production/format';
import { listMilk } from '../production/repo';
import { useAuth } from '../state/auth';
import { useLocal } from '../sync/store';
import { Chips } from '../ui/Chips';
import { Button, Notice, Toggle } from '../ui/form';
import { Card, IconBadge, SectionHeader } from '../ui/kit';
import { radius, shadow, spacing, useTheme } from '../ui/theme';

// What changed in the farm records and why, in plain words: corrections, voids, removals, price changes,
// stock adjustments, settings and exports. New records can be shown too. Loaded from the account (needs a
// connection); the last view is kept for offline.

const FILTERS: { value: AuditGroup; label: string }[] = [
  { value: 'milk', label: 'Milk and stock' },
  { value: 'animals', label: 'Animals and care' },
  { value: 'money', label: 'Sales and money' },
  { value: 'settings', label: 'Settings and exports' },
];

const CACHE = 'audit.all';
const PAGE = 50;

const localDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const time = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

function Entry({ d, at }: { d: Described; at: string }) {
  const t = useTheme();
  const tint = d.important ? (/voided|removed|deleted/.test(d.title) ? 'red' : 'straw') : 'green';
  const body = (
    <View style={{ flexDirection: 'row', gap: spacing.md, padding: spacing.md }}>
      <IconBadge icon={d.icon} tint={tint} size={36} />
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
          <Text style={{ color: t.text, fontSize: 16, fontWeight: '600', flex: 1 }}>{d.title}</Text>
          <Text style={{ color: t.textMuted, fontSize: 13 }}>{time(at)}</Text>
        </View>
        {d.lines.map((l) => (
          <Text key={l} style={{ color: t.textMuted, fontSize: 14 }}>
            {l}
          </Text>
        ))}
        {d.reason ? <Text style={{ color: t.text, fontSize: 14, fontStyle: 'italic' }}>“{d.reason}”</Text> : null}
      </View>
      {d.href ? <MaterialCommunityIcons name="chevron-right" size={22} color={t.textMuted} style={{ alignSelf: 'center' }} importantForAccessibility="no" /> : null}
    </View>
  );
  const label = [d.title, ...d.lines, d.reason ? `Reason: ${d.reason}` : null, `at ${time(at)}`].filter(Boolean).join('. ');
  return d.href ? (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint="Opens the record" onPress={() => router.push(d.href as Href)} style={({ pressed }) => ({ backgroundColor: pressed ? t.primarySoft : 'transparent' })}>
      {body}
    </Pressable>
  ) : (
    <View accessible accessibilityLabel={label}>
      {body}
    </View>
  );
}

export default function AuditHistory() {
  const t = useTheme();
  const { account } = useAuth();
  const f = useFinance();
  const animals = useLocal(listAnimals);
  const breeds = useLocal(listBreeds);
  const milk = useLocal(() => listMilk().map((m) => m.data));
  const care = useLocal(loadCareData);
  const [group, setGroup] = useState<AuditGroup | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [entries, setEntries] = useState<AuditEntry[]>(() => getJson(CACHE) ?? []);
  const [offline, setOffline] = useState(false);
  const [more, setMore] = useState(true);
  // When the screen opened, for the Today and Yesterday headings.
  const [now] = useState(() => Date.now());

  const load = useCallback(async (before?: number) => {
    try {
      const q = new URLSearchParams({ limit: String(PAGE), ...(before && { before_id: String(before) }) });
      const rows = await api<AuditEntry[]>(`/v1/audit?${q}`);
      setOffline(false);
      setMore(rows.length === PAGE);
      setEntries((prev) => {
        if (!before) setJson(CACHE, rows);
        return before ? [...prev, ...rows] : rows;
      });
    } catch (err) {
      if (err instanceof NetworkError) setOffline(true);
    }
  }, []);

  // Fetches from the account (an external system); state is set only after the response.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const ctx = useMemo<DescribeContext>(() => {
    const animalNames = new Map(animals.map((a) => [a.data.id, displayName(a.data)]));
    const customers = new Map(f.customers.map((c) => [c.id, c.name]));
    const breedNames = new Map(breeds.map((b) => [b.id, b.name]));
    const milkCow = new Map(milk.map((m) => [m.id, m.cattle_id]));
    const careCow = new Map<string, string>();
    for (const list of Object.values(care) as { id: string; cattle_id?: string; dam_id?: string }[][]) {
      for (const r of list) if (r.cattle_id ?? r.dam_id) careCow.set(r.id, (r.cattle_id ?? r.dam_id)!);
    }
    return {
      animalName: (id) => animalNames.get(id) ?? null,
      customerName: (id) => customers.get(id) ?? null,
      breedName: (id) => breedNames.get(id) ?? null,
      milkCattle: (id) => milkCow.get(id) ?? null,
      careCattle: (_table, id) => careCow.get(id) ?? null,
      care,
      currency: account?.currency ?? 'ZMW',
      dateFormat: account?.date_format,
    };
  }, [animals, f.customers, breeds, milk, care, account?.currency, account?.date_format]);

  const shown = useMemo(
    () =>
      entries
        .map((e) => ({ e, d: describe(e, ctx) }))
        .filter((x): x is { e: AuditEntry; d: Described } => !!x.d && (showNew || x.d.important) && (!group || x.d.group === group)),
    [entries, ctx, showNew, group],
  );

  // Newest first, grouped by day.
  const days = useMemo(() => {
    const out: { day: string; items: typeof shown }[] = [];
    for (const x of shown) {
      const day = localDay(x.e.occurred_at);
      if (out[out.length - 1]?.day !== day) out.push({ day, items: [] });
      out[out.length - 1].items.push(x);
    }
    return out;
  }, [shown]);

  const today = localDay(new Date(now).toISOString());
  const yesterday = localDay(new Date(now - 86_400_000).toISOString());
  const heading = (day: string) => (day === today ? 'Today' : day === yesterday ? 'Yesterday' : dayLabel(day));

  return (
    <ScrollView style={{ backgroundColor: t.background }} contentContainerStyle={{ padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xl }}>
      <Chips label="Show" value={group} options={FILTERS} onChange={setGroup} />
      <Card gap={0}>
        <Toggle label="Include new records" hint="Every new animal, milk entry, sale and payment, not only changes" value={showNew} onChange={setShowNew} />
      </Card>
      {offline ? <Notice>Offline: showing the history last loaded on this phone.</Notice> : null}
      {days.length === 0 ? (
        <Notice>{entries.length ? 'Nothing here for this choice. Try another filter or include new records.' : 'No changes recorded yet. Corrections, voids, price changes and adjustments will appear here with their reasons.'}</Notice>
      ) : null}
      {days.map(({ day, items }) => (
        <View key={day} style={{ gap: spacing.sm }}>
          <SectionHeader title={heading(day)} />
          <View style={{ backgroundColor: t.surface, borderRadius: radius.card, overflow: 'hidden', ...shadow }}>
            {items.map(({ e, d }, i) => (
              <View key={e.id}>
                {i ? <View style={{ height: 1, backgroundColor: t.border, marginLeft: 68 }} /> : null}
                <Entry d={d} at={e.occurred_at} />
              </View>
            ))}
          </View>
        </View>
      ))}
      {more && entries.length && !offline ? <Button label="Load older" variant="link" onPress={() => load(entries[entries.length - 1].id)} /> : null}
    </ScrollView>
  );
}
