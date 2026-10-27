import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
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
import { formatDate } from '../../../ui/DateField';
import { Button, Notice } from '../../../ui/form';
import { SyncBadge } from '../../../ui/SyncBadge';
import { spacing, useTheme } from '../../../ui/theme';

interface TimelineEvent {
  at: string;
  kind: string;
  title: string;
  detail: string | null;
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  const t = useTheme();
  if (!value) return null;
  return (
    <View style={{ flexDirection: 'row', gap: spacing.md, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: t.border }} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={{ color: t.textMuted, fontSize: 15, width: 130 }}>{label}</Text>
      <Text style={{ color: t.text, fontSize: 16, flex: 1 }}>{value}</Text>
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

  if (!animal) {
    return (
      <View style={{ flex: 1, padding: spacing.md, backgroundColor: t.background }}>
        <Notice tone="error">This animal is no longer in your herd.</Notice>
      </View>
    );
  }
  const a = animal.data;
  const nameOf = (pid: string | null) => {
    const p = animals.find((x) => x.data.id === pid)?.data;
    return p ? displayName(p) : null;
  };
  const dateFmt = account?.date_format;

  async function choosePhoto(source: 'camera' | 'library') {
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

  return (
    <ScrollView style={{ backgroundColor: t.background }} contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}>
      {photo ? (
        <Image source={photo} style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: 8 }} contentFit="cover" accessibilityLabel={`Photo of ${displayName(a)}`} cachePolicy="disk" />
      ) : null}
      {uploading ? <Text style={{ color: t.textMuted }}>Uploading photo {Math.round(sync.photo!.fraction * 100)}%</Text> : null}

      <View style={{ gap: 4 }}>
        <Text accessibilityRole="header" style={{ color: t.text, fontSize: 26, fontWeight: '700' }}>
          {displayName(a)}
        </Text>
        <Text style={{ color: t.textMuted, fontSize: 16 }}>ID {shortCode(a.id)} · {STATUS_LABELS[a.status]}</Text>
        <SyncBadge state={animal.sync_state} />
        <WithdrawalBanner care={care} cattleId={a.id} />
        {animal.sync_state === 'attention' ? <Button label="Review sync problem" variant="link" onPress={() => router.push('/sync-issues')} /> : null}
      </View>

      {a.status !== 'active' ? (
        <Notice>
          {STATUS_LABELS[a.status]} on {formatDate(a.status_date, dateFmt)}
          {a.status_details ? `: ${a.status_details}` : ''}
        </Notice>
      ) : null}

      <View>
        <Row label="Ear tag" value={a.ear_tag ?? 'Not tagged yet'} />
        <Row label="Sex" value={a.sex === 'female' ? 'Female' : 'Male'} />
        <Row label="Breed" value={breeds.find((b) => b.id === a.breed_id)?.name} />
        <Row label="Age" value={`${ageLabel(a)}${a.birth_date ? ` (born ${a.birth_date_estimated ? 'about ' : ''}${formatDate(a.birth_date, dateFmt)})` : ''}`} />
        <Row label="Production" value={PRODUCTION_LABELS[a.production_status]} />
        {a.sex === 'female' ? <Row label="Reproduction" value={REPRODUCTIVE_LABELS[a.reproductive_status]} /> : null}
        <Row label="Weight" value={a.weight_kg ? `${a.weight_kg} kg` : null} />
        <Row label="Mother" value={nameOf(a.dam_id)} />
        <Row label="Father" value={nameOf(a.sire_id) ?? a.sire_identifier} />
        <Row label="Acquired" value={a.acquisition_date ? formatDate(a.acquisition_date, dateFmt) + (a.acquisition_source ? ` from ${a.acquisition_source}` : '') : a.acquisition_source} />
        <Row label="Purchase price" value={a.purchase_price ? `${a.purchase_currency} ${a.purchase_price}` : null} />
        <Row label="Notes" value={a.notes} />
      </View>

      <AnimalCare animal={a} care={care} />
      {a.sex === 'female' ? <AnimalMilk cattleId={a.id} canRecord={a.status === 'active'} /> : null}

      <Button label="Edit details" onPress={() => router.push({ pathname: '/animal/[id]/edit', params: { id: a.id } })} />
      <Button label={photo ? 'Take a new photo' : 'Take a photo'} variant="secondary" onPress={() => choosePhoto('camera')} busy={busy} />
      <Button label="Choose photo from phone" variant="secondary" onPress={() => choosePhoto('library')} disabled={busy} />
      <Button
        label={a.status === 'active' ? 'Record sale, death or transfer' : 'Change status'}
        variant="secondary"
        onPress={() => router.push({ pathname: '/animal/[id]/status', params: { id: a.id } })}
      />

      <Text accessibilityRole="header" style={{ color: t.text, fontSize: 20, fontWeight: '700', marginTop: spacing.md }}>
        History
      </Text>
      {!onServer ? (
        <Text style={{ color: t.textMuted, fontSize: 15 }}>Registered on this phone. History appears after the first sync.</Text>
      ) : (
        <>
          {timeline.offline ? (
            <Text style={{ color: t.textMuted, fontSize: 15 }}>
              {timeline.savedAt ? `Offline · showing history saved ${new Date(timeline.savedAt).toLocaleString()}` : 'History needs a connection.'}
            </Text>
          ) : null}
          {hasLocalChanges('cattle', a.id) ? <Text style={{ color: t.textMuted, fontSize: 15 }}>Changes waiting to sync are not in the history yet.</Text> : null}
          {(timeline.events ?? []).map((e, i) => (
            <View key={`${e.at}-${i}`} style={{ borderLeftWidth: 3, borderLeftColor: t.primary, paddingLeft: spacing.md, gap: 2 }} accessible>
              <Text style={{ color: t.textMuted, fontSize: 14 }}>{new Date(e.at).toLocaleDateString()}</Text>
              <Text style={{ color: t.text, fontSize: 16 }}>{e.title}</Text>
              {e.detail ? <Text style={{ color: t.textMuted, fontSize: 15 }}>{e.detail}</Text> : null}
            </View>
          ))}
        </>
      )}

      <Button label="Delete (entered by mistake)" variant="link" onPress={confirmDelete} />
    </ScrollView>
  );
}
