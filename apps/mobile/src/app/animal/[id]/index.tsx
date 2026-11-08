import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { type ReactNode, useEffect, useState } from 'react';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { ageLabel, DEATH_CAUSE_LABELS, displayName, PRODUCTION_LABELS, REPRODUCTIVE_LABELS, SALE_REASON_LABELS, shortCode, STATUS_LABELS } from '../../../animals/model';
import { deleteAnimal, editAnimal, getAnimal, listAnimals, listBreeds, setAnimalPhoto } from '../../../animals/repo';
import { usePhotoUri } from '../../../animals/usePhotoUri';
import { AnimalMilk } from '../../../production/AnimalMilk';
import { AnimalCare, WithdrawalBanner } from '../../../care/AnimalCare';
import { MilkAlertBanner } from '../../../production/MilkAlertBanner';
import { loadCareData } from '../../../care/repo';
import { api } from '../../../lib/api';
import { getJson, setJson } from '../../../lib/localDb';
import { useAuth } from '../../../state/auth';
import { useSyncStatus } from '../../../sync/engine';
import { hasLocalChanges, useLocal } from '../../../sync/store';
import { Chips } from '../../../ui/Chips';
import { formatDate, formatDateTime, toDateString } from '../../../lib/dates';
import { Button, Notice } from '../../../ui/form';
import { MissingRecord } from '../../../ui/ProblemView';
import { Avatar, Card, Figure, ListGroup, ListRow, Pill } from '../../../ui/kit';
import { SyncBadge } from '../../../ui/SyncBadge';
import { minTouch, radius, shadow, spacing, type, useTheme } from '../../../ui/theme';
import { useOpenOrBack } from '../../../ui/useOpenOrBack';
import { EVENT_KIND, groupStories, type TimelineEvent } from '../../../animals/timeline';
import { expensesFor, totalCost } from '../../../care/costs';
import { money } from '../../../finance/calc';

type Section = 'overview' | 'care' | 'milk' | 'history';

/** A detail line; with `onPress`, the value opens that animal (her mother, his father). */
function Row({ label, value, onPress }: { label: string; value: string | null | undefined; onPress?: () => void }) {
  const t = useTheme();
  if (!value) return null;
  if (onPress) {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} accessibilityHint="Opens that animal" onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: minTouch - 8, paddingVertical: spacing.sm }}>
        <Text style={{ color: t.textMuted, ...type.bodySmall, width: 120 }}>{label}</Text>
        <Text style={{ color: t.primary, ...type.link, flex: 1 }}>{value}</Text>
        <MaterialCommunityIcons name="chevron-right" size={20} color={t.textMuted} importantForAccessibility="no" />
      </Pressable>
    );
  }
  return (
    <View style={{ flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.sm }} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={{ color: t.textMuted, ...type.bodySmall, width: 120 }}>{label}</Text>
      <Text style={{ color: t.text, ...type.bodySmall, flex: 1 }}>{value}</Text>
    </View>
  );
}

/** The animal's history from the server, kept on the phone for offline viewing. Fetched again after each sync of the animal. */
function useTimeline(id: string, enabled: boolean, version: number) {
  const key = `timeline.${id}`;
  const [state, setState] = useState<{ events: TimelineEvent[]; savedAt: string } | null>(() => getJson(key));
  const [offline, setOffline] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    api<TimelineEvent[]>(`/v1/cattle/${id}/timeline`)
      .then((events) => {
        const next = { events, savedAt: new Date().toISOString() };
        setJson(key, next);
        setState(next);
        setOffline(false);
      })
      .catch(() => setOffline(true))
      .finally(() => setLoaded(true));
  }, [id, key, enabled, version]);
  return { ...state, offline, loaded };
}

export default function AnimalProfile() {
  const open = useOpenOrBack();
  const t = useTheme();
  // `section` opens a part of the profile directly (a treatment links to the cow's milk).
  const { id, section: startAt } = useLocalSearchParams<{ id: string; section?: Section }>();
  const { account } = useAuth();
  const sync = useSyncStatus();
  const animal = useLocal(() => getAnimal(id), id);
  const animals = useLocal(listAnimals);
  const breeds = useLocal(listBreeds);
  const care = useLocal(loadCareData);
  const photo = usePhotoUri(animal?.data);
  const onServer = !!animal && animal.data.version > 0;
  const timeline = useTimeline(id, onServer, animal?.data.version ?? 0);
  const [busy, setBusy] = useState(false);
  // One section at a time keeps the profile short; the farmer picks what to look at.
  const [section, setSection] = useState<Section>(startAt && ['overview', 'care', 'milk', 'history'].includes(startAt) ? startAt : 'overview');
  const [adding, setAdding] = useState(false);

  if (!animal) return <MissingRecord what="animal" />;
  const a = animal.data;
  const nameOf = (pid: string | null) => {
    const p = animals.find((x) => x.data.id === pid)?.data;
    return p ? displayName(p) : null;
  };
  const parentLink = (pid: string | null) => (pid && animals.some((x) => x.data.id === pid) ? () => open({ pathname: '/animal/[id]', params: { id: pid } }) : undefined);
  const dateFmt = account?.date_format;
  // A calf born on the farm: her birth is a calving record on her mother.
  const birth = care.calvings.find((c) => c.calf_id === a.id && !c.deleted_at);
  // Why it left the herd, in words.
  const reasons: Record<string, string> = a.status === 'deceased' ? DEATH_CAUSE_LABELS : a.status === 'sold' ? SALE_REASON_LABELS : {};
  const leftBecause = a.status_reason ? (reasons[a.status_reason] ?? null) : null;

  async function choosePhoto(source: 'camera' | 'library') {
    if (busy) return;
    const permission = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', `Allow access to your ${source === 'camera' ? 'camera' : 'photos'} in the phone settings to add a photo.`);
      return;
    }
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: true, aspect: [4, 3], quality: 1 };
    const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled) return;
    setBusy(true);
    try {
      await setAnimalPhoto(animal!, result.assets[0].uri);
    } finally {
      setBusy(false);
    }
  }

  function confirmDelete() {
    Alert.alert(
      'Delete this animal?',
      'Only for animals entered by mistake. Animals that were sold, died or left the farm should get a status change instead, which keeps their history.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteAnimal(animal!);
            router.back();
          },
        },
      ],
    );
  }

  // Drying off and coming back into milk happen every lactation: one tap, not the Edit form.
  function toggleMilking() {
    const drying = a.production_status === 'lactating';
    Alert.alert(
      drying ? `Dry off ${displayName(a)}?` : `${displayName(a)} back in milk?`,
      drying ? 'She leaves the milking round and the missing-milk checks.' : 'She joins the milking round again.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: drying ? 'Dry off' : 'Back in milk', onPress: () => editAnimal(animal!, { production_status: drying ? 'dry' : 'lactating' }) },
      ],
    );
  }

  const uploading = sync.photo?.recordId === a.id;
  const female = a.sex === 'female';
  const breed = breeds.find((b) => b.id === a.breed_id)?.name;
  const addRecord = (kind: string) => router.push({ pathname: '/care/[kind]/new', params: { kind, cattle_id: a.id } });
  const sections: { value: Section; label: string }[] = [
    { value: 'overview', label: 'Overview' },
    { value: 'care', label: 'Care' },
    ...(female ? [{ value: 'milk' as const, label: 'Milk' }] : []),
    { value: 'history', label: 'History' },
  ];

  let body: ReactNode;
  if (section === 'care') body = <AnimalCare animal={a} care={care} showAdd={false} />;
  else if (section === 'milk') body = <AnimalMilk cattleId={a.id} canRecord={a.status === 'active'} />;
  else if (section === 'history')
    body = !onServer ? (
      <Text style={{ color: t.textMuted, ...type.bodySmall }}>Registered on this phone. History appears after the first sync.</Text>
    ) : (
      <View style={{ gap: spacing.xs }}>
        {timeline.offline ? (
          <Text style={{ color: t.textMuted, ...type.secondary }}>
            {timeline.savedAt ? `Offline · showing history saved ${formatDateTime(timeline.savedAt, dateFmt)}` : 'History needs a connection.'}
          </Text>
        ) : null}
        {hasLocalChanges('cattle', a.id) ? <Text style={{ color: t.textMuted, ...type.secondary }}>Changes waiting to sync are not in the history yet.</Text> : null}
        {!timeline.events && !timeline.offline ? <Text style={{ color: t.textMuted, ...type.bodySmall }}>Loading history…</Text> : null}
        {timeline.events?.length === 0 && timeline.loaded ? <Text style={{ color: t.textMuted, ...type.bodySmall }}>Nothing recorded yet.</Text> : null}
        {groupStories(timeline.events ?? []).map((item, i) => {
          const day = (at: string) => formatDate(toDateString(new Date(at)), dateFmt);
          // Opens the record behind an event, where there is one.
          const openEvent = (e: TimelineEvent) =>
            e.record_id && EVENT_KIND[e.kind] ? () => open({ pathname: '/care/[kind]/[id]', params: { kind: EVENT_KIND[e.kind], id: e.record_id! } }) : undefined;
          const dot = (
            <View style={{ alignItems: 'center', width: 12 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: item.type === 'story' && item.kind === 'health' ? t.danger : t.primary, marginTop: 5 }} />
              <View style={{ flex: 1, width: 2, backgroundColor: t.border }} />
            </View>
          );
          if (item.type === 'event') {
            const e = item.event;
            const onPress = openEvent(e);
            return (
              <Pressable key={`${e.at}-${i}`} disabled={!onPress} onPress={onPress} accessibilityRole={onPress ? 'button' : undefined} style={{ flexDirection: 'row', gap: spacing.md }}>
                {dot}
                <View style={{ flex: 1, gap: 2, paddingBottom: spacing.md }}>
                  <Text style={{ color: t.textMuted, ...type.caption }}>{day(e.at)}</Text>
                  <Text style={{ color: onPress ? t.primary : t.text, ...type.body }}>{e.title}</Text>
                  {e.detail ? <Text style={{ color: t.textMuted, ...type.secondary }}>{e.detail}</Text> : null}
                </View>
              </Pressable>
            );
          }
          // A story: one card with what happened, in order, and what it cost.
          const cost = totalCost(expensesFor(item.events.map((e) => e.record_id).filter((x): x is string => !!x)));
          return (
            <View key={item.episode} style={{ flexDirection: 'row', gap: spacing.md }}>
              {dot}
              <View style={{ flex: 1, paddingBottom: spacing.md }}>
                <Card gap={spacing.sm}>
                  <View style={{ gap: 2 }}>
                    <Text style={{ color: t.textMuted, ...type.caption }}>{item.from === item.to ? day(item.from) : `${day(item.from)} – ${day(item.to)}`}</Text>
                    <Text style={{ color: t.text, ...type.cardTitle }}>{item.title}</Text>
                    {cost.length ? <Text style={{ color: t.textMuted, ...type.secondary }}>Cost: {cost.map(([cur, c]) => money(c, cur)).join(', ')}</Text> : null}
                  </View>
                  {item.events.map((e, j) => {
                    const onPress = openEvent(e);
                    return (
                      <Pressable key={`${e.at}-${j}`} disabled={!onPress} onPress={onPress} accessibilityRole={onPress ? 'button' : undefined} style={{ minHeight: minTouch - 8, justifyContent: 'center', borderTopWidth: 1, borderTopColor: t.border, paddingTop: spacing.sm }}>
                        <Text style={{ color: t.textMuted, ...type.caption }}>{day(e.at)}</Text>
                        <Text style={{ color: onPress ? t.primary : t.text, ...type.bodySmall }}>{e.title}</Text>
                        {e.detail ? <Text style={{ color: t.textMuted, ...type.secondary }}>{e.detail}</Text> : null}
                      </Pressable>
                    );
                  })}
                </Card>
              </View>
            </View>
          );
        })}
      </View>
    );
  else
    body = (
      <View style={{ gap: spacing.md }}>
        <Card>
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <Figure label="Age" value={ageLabel(a) || 'Unknown'} />
            <Figure label="Milk" value={PRODUCTION_LABELS[a.production_status]} />
          </View>
          {female && a.status === 'active' && (a.production_status === 'lactating' || a.production_status === 'dry') ? (
            <Button label={a.production_status === 'lactating' ? 'Dry her off' : 'Back in milk'} variant="secondary" onPress={toggleMilking} />
          ) : null}
          {female ? (
            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              <Figure label="Reproduction" value={REPRODUCTIVE_LABELS[a.reproductive_status]} />
              <Figure label="Weight" value={a.weight_kg ? `${a.weight_kg} kg` : '—'} />
            </View>
          ) : null}
        </Card>
        <Card gap={0}>
          <Row label="Ear tag" value={a.ear_tag ?? 'Not tagged yet'} />
          <Row
            label="Born"
            value={a.birth_date ? `${a.birth_date_estimated ? 'About ' : ''}${formatDate(a.birth_date, dateFmt)}` : null}
            onPress={birth ? () => open({ pathname: '/care/[kind]/[id]', params: { kind: 'calving', id: birth.id } }) : undefined}
          />
          <Row label="Mother" value={nameOf(a.dam_id)} onPress={parentLink(a.dam_id)} />
          <Row label="Father" value={nameOf(a.sire_id) ?? a.sire_identifier} onPress={parentLink(a.sire_id)} />
          <Row label="Acquired" value={a.acquisition_date ? formatDate(a.acquisition_date, dateFmt) + (a.acquisition_source ? ` from ${a.acquisition_source}` : '') : a.acquisition_source} />
          <Row label="Purchase price" value={a.purchase_price ? `${a.purchase_currency} ${a.purchase_price}` : null} />
          <Row label="Notes" value={a.notes} />
        </Card>
        <ListGroup>
          <ListRow icon="camera-outline" title={busy ? 'Saving photo…' : photo ? 'Take a new photo' : 'Take a photo'} onPress={() => choosePhoto('camera')} />
          <ListRow icon="image-outline" title="Choose photo from phone" onPress={() => choosePhoto('library')} />
          <ListRow icon="swap-horizontal" title={a.status === 'active' ? 'Sold, died or left the farm' : 'Change status'} href={{ pathname: '/animal/[id]/status', params: { id: a.id } }} />
          <ListRow icon="delete-outline" tint="red" title="Delete" subtitle="Only if entered by mistake" onPress={confirmDelete} />
        </ListGroup>
      </View>
    );

  return (
    <ScrollView style={{ backgroundColor: t.background }} contentContainerStyle={{ padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl }}>
      <View style={{ backgroundColor: t.surface, borderRadius: radius.card, overflow: 'hidden', ...shadow }}>
        {photo ? <Image source={photo} style={{ width: '100%', aspectRatio: 16 / 10 }} contentFit="cover" accessibilityLabel={`Photo of ${displayName(a)}`} cachePolicy="disk" /> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md }}>
          {photo ? null : <Avatar name={displayName(a)} size={56} />}
          <View style={{ flex: 1, gap: 4 }}>
            <Text accessibilityRole="header" style={{ color: t.text, ...type.headline }}>
              {displayName(a)}
            </Text>
            <Text style={{ color: t.textMuted, ...type.secondary }}>{[`ID ${shortCode(a.id)}`, female ? 'Female' : 'Male', breed].filter(Boolean).join(' · ')}</Text>
            {a.status !== 'active' ? (
              <Pill label={`${STATUS_LABELS[a.status]} ${formatDate(a.status_date, dateFmt)}${leftBecause ? ` · ${leftBecause}` : ''}`} tint="sky" />
            ) : null}
          </View>
        </View>
        {uploading ? <Text style={{ color: t.textMuted, paddingHorizontal: spacing.md, paddingBottom: spacing.sm }}>Uploading photo {Math.round(sync.photo!.fraction * 100)}%</Text> : null}
      </View>

      <SyncBadge state={animal.sync_state} />
      {animal.sync_state === 'attention' ? <Button label="Review sync problem" variant="link" onPress={() => open('/sync-issues')} /> : null}
      <WithdrawalBanner care={care} cattleId={a.id} />
      {a.status === 'active' && female ? <MilkAlertBanner animal={a} /> : null}
      {a.status !== 'active' && a.status_details ? <Notice>{a.status_details}</Notice> : null}

      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Button label={adding ? 'Close' : 'Add record'} onPress={() => setAdding((v) => !v)} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="Edit details" variant="secondary" onPress={() => router.push({ pathname: '/animal/[id]/edit', params: { id: a.id } })} />
        </View>
      </View>
      {adding ? (
        <ListGroup>
          {female && a.status === 'active' ? <ListRow icon="water-outline" title="Milk" onPress={() => router.push({ pathname: '/milk/new', params: { cattle_id: a.id } })} /> : null}
          <ListRow icon="stethoscope" title="Health concern" onPress={() => addRecord('health')} />
          <ListRow icon="pill" title="Treatment" onPress={() => addRecord('treatment')} />
          <ListRow icon="medical-bag" title="Vet visit" onPress={() => addRecord('vet-visit')} />
          <ListRow icon="needle" title="Vaccination" onPress={() => addRecord('vaccination')} />
          {female ? <ListRow icon="heart-outline" title="Heat or breeding" onPress={() => addRecord('breeding')} /> : null}
          {female ? <ListRow icon="heart-pulse" title="Pregnancy check" onPress={() => addRecord('pregnancy-check')} /> : null}
          {female ? <ListRow icon="cow" title="Calving" onPress={() => addRecord('calving')} /> : null}
        </ListGroup>
      ) : null}

      <Chips label="Show" value={section} options={sections} onChange={(v) => v && setSection(v)} allowClear={false} />
      {body}
    </ScrollView>
  );
}
