import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { type ReactNode, useEffect, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { ageLabel, displayName, PRODUCTION_LABELS, REPRODUCTIVE_LABELS, shortCode, STATUS_LABELS } from '../../../animals/model';
import { deleteAnimal, getAnimal, listAnimals, listBreeds, setAnimalPhoto } from '../../../animals/repo';
import { usePhotoUri } from '../../../animals/usePhotoUri';
import { AnimalMilk } from '../../../production/AnimalMilk';
import { AnimalCare, WithdrawalBanner } from '../../../care/AnimalCare';
import { loadCareData } from '../../../care/repo';
import { api } from '../../../lib/api';
import { getJson, setJson } from '../../../lib/localDb';
import { useAuth } from '../../../state/auth';
import { useSyncStatus } from '../../../sync/engine';
import { hasLocalChanges, useLocal } from '../../../sync/store';
import { Chips } from '../../../ui/Chips';
import { formatDate } from '../../../ui/DateField';
import { Button, Notice } from '../../../ui/form';
import { MissingRecord } from '../../../ui/ProblemView';
import { Avatar, Card, Figure, ListGroup, ListRow, Pill } from '../../../ui/kit';
import { SyncBadge } from '../../../ui/SyncBadge';
import { radius, shadow, spacing, type, useTheme } from '../../../ui/theme';

interface TimelineEvent {
  at: string;
  kind: string;
  title: string;
  detail: string | null;
}

type Section = 'overview' | 'care' | 'milk' | 'history';

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  const t = useTheme();
  if (!value) return null;
  return (
    <View style={{ flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.sm }} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={{ color: t.textMuted, fontSize: 15, width: 120 }}>{label}</Text>
      <Text style={{ color: t.text, fontSize: 15, flex: 1 }}>{value}</Text>
    </View>
  );
}

function useTimeline(id: string, enabled: boolean) {
  const key = `timeline.${id}`;
  const [state, setState] = useState<{ events: TimelineEvent[]; savedAt: string } | null>(() => getJson(key));
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    api<TimelineEvent[]>(`/v1/cattle/${id}/timeline`)
      .then((events) => {
        const next = { events, savedAt: new Date().toISOString() };
        setJson(key, next);
        setState(next);
        setOffline(false);
      })
      .catch(() => setOffline(true));
  }, [id, key, enabled]);
  return { ...state, offline };
}

export default function AnimalProfile() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { account } = useAuth();
  const sync = useSyncStatus();
  const animal = useLocal(() => getAnimal(id), id);
  const animals = useLocal(listAnimals);
  const breeds = useLocal(listBreeds);
  const care = useLocal(loadCareData);
  const photo = usePhotoUri(animal?.data);
  const onServer = !!animal && animal.data.version > 0;
  const timeline = useTimeline(id, onServer);
  const [busy, setBusy] = useState(false);
  // One section at a time keeps the profile short; the farmer picks what to look at.
  const [section, setSection] = useState<Section>('overview');
  const [adding, setAdding] = useState(false);

  if (!animal) return <MissingRecord what="animal" />;
  const a = animal.data;
  const nameOf = (pid: string | null) => {
    const p = animals.find((x) => x.data.id === pid)?.data;
    return p ? displayName(p) : null;
  };
  const dateFmt = account?.date_format;

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
      <Text style={{ color: t.textMuted, fontSize: 15 }}>Registered on this phone. History appears after the first sync.</Text>
    ) : (
      <View style={{ gap: spacing.xs }}>
        {timeline.offline ? (
          <Text style={{ color: t.textMuted, fontSize: 14 }}>
            {timeline.savedAt ? `Offline · showing history saved ${new Date(timeline.savedAt).toLocaleString()}` : 'History needs a connection.'}
          </Text>
        ) : null}
        {hasLocalChanges('cattle', a.id) ? <Text style={{ color: t.textMuted, fontSize: 14 }}>Changes waiting to sync are not in the history yet.</Text> : null}
        {(timeline.events ?? []).map((e, i) => (
          <View key={`${e.at}-${i}`} style={{ flexDirection: 'row', gap: spacing.md }} accessible>
            <View style={{ alignItems: 'center', width: 12 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: t.primary, marginTop: 5 }} />
              <View style={{ flex: 1, width: 2, backgroundColor: t.border }} />
            </View>
            <View style={{ flex: 1, gap: 2, paddingBottom: spacing.md }}>
              <Text style={{ color: t.textMuted, fontSize: 13 }}>{new Date(e.at).toLocaleDateString()}</Text>
              <Text style={{ color: t.text, fontSize: 16 }}>{e.title}</Text>
              {e.detail ? <Text style={{ color: t.textMuted, fontSize: 14 }}>{e.detail}</Text> : null}
            </View>
          </View>
        ))}
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
          {female ? (
            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              <Figure label="Reproduction" value={REPRODUCTIVE_LABELS[a.reproductive_status]} />
              <Figure label="Weight" value={a.weight_kg ? `${a.weight_kg} kg` : '—'} />
            </View>
          ) : null}
        </Card>
        <Card gap={0}>
          <Row label="Ear tag" value={a.ear_tag ?? 'Not tagged yet'} />
          <Row label="Born" value={a.birth_date ? `${a.birth_date_estimated ? 'About ' : ''}${formatDate(a.birth_date, dateFmt)}` : null} />
          <Row label="Mother" value={nameOf(a.dam_id)} />
          <Row label="Father" value={nameOf(a.sire_id) ?? a.sire_identifier} />
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
            <Text accessibilityRole="header" style={{ color: t.text, ...type.screenTitle, fontSize: 24 }}>
              {displayName(a)}
            </Text>
            <Text style={{ color: t.textMuted, fontSize: 14 }}>{[`ID ${shortCode(a.id)}`, female ? 'Female' : 'Male', breed].filter(Boolean).join(' · ')}</Text>
            {a.status !== 'active' ? <Pill label={`${STATUS_LABELS[a.status]} ${formatDate(a.status_date, dateFmt)}`} tint="sky" /> : null}
          </View>
        </View>
        {uploading ? <Text style={{ color: t.textMuted, paddingHorizontal: spacing.md, paddingBottom: spacing.sm }}>Uploading photo {Math.round(sync.photo!.fraction * 100)}%</Text> : null}
      </View>

      <SyncBadge state={animal.sync_state} />
      {animal.sync_state === 'attention' ? <Button label="Review sync problem" variant="link" onPress={() => router.push('/sync-issues')} /> : null}
      <WithdrawalBanner care={care} cattleId={a.id} />
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
