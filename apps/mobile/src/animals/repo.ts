import { randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { syncSoon } from '../sync/engine';
import { deleteUnsynced, getRecord, listRecords, saveLocal, type Stored } from '../sync/store';
import type { AnimalStatus, Breed, Cattle, CattleFields } from './model';

// Every write is saved on the phone first and queued; the sync engine sends it when it can.
const queued = syncSoon;

export const listAnimals = () => listRecords<Cattle>('cattle');
export const getAnimal = (id: string) => getRecord<Cattle>('cattle', id);
export const listBreeds = () => listRecords<Breed>('cattle_breeds').map((r) => r.data).sort((a, b) => a.name.localeCompare(b.name));

export function registerAnimal(fields: CattleFields): string {
  const id = randomUUID();
  const animal: Cattle = { ...fields, id, photo_path: null, status: 'active', status_date: null, status_details: null, deleted_at: null, version: 0 };
  saveLocal('cattle', id, animal, { kind: 'create', method: 'POST', path: '/v1/cattle', body: { id, ...fields } });
  queued();
  return id;
}

export function editAnimal(current: Stored<Cattle>, changes: Partial<CattleFields>) {
  const next = { ...current.data, ...changes };
  saveLocal('cattle', next.id, next, {
    kind: 'update',
    method: 'PATCH',
    path: `/v1/cattle/${next.id}`,
    body: changes,
    ifMatch: current.data.version,
  });
  queued();
}

export function changeAnimalStatus(
  current: Stored<Cattle>,
  change: { status: AnimalStatus; status_date: string | null; status_details: string | null; reason?: string | null },
) {
  const next: Cattle = {
    ...current.data,
    status: change.status,
    status_date: change.status === 'active' ? null : change.status_date,
    status_details: change.status === 'active' ? null : change.status_details,
  };
  saveLocal('cattle', next.id, next, {
    kind: 'status',
    method: 'POST',
    path: `/v1/cattle/${next.id}/status`,
    body: change,
    ifMatch: current.data.version,
  });
  queued();
}

export function deleteAnimal(current: Stored<Cattle>) {
  // Never reached the server: remove it here and forget its queued changes.
  if (deleteUnsynced('cattle', current.data.id)) return;
  const next = { ...current.data, deleted_at: new Date().toISOString() };
  saveLocal('cattle', next.id, next, { kind: 'delete', method: 'DELETE', path: `/v1/cattle/${next.id}`, ifMatch: current.data.version });
  queued();
}

const photoDir = () => {
  const dir = new Directory(Paths.document, 'photos');
  if (!dir.exists) dir.create();
  return dir;
};

/**
 * Shrinks the photo (max 1280 px, JPEG) so it uploads quickly on mobile data, keeps a copy in
 * the app's own storage, and queues the upload.
 */
export async function setAnimalPhoto(current: Stored<Cattle>, sourceUri: string) {
  const image = await ImageManipulator.manipulate(sourceUri).resize({ width: 1280 }).renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.7 });
  const file = new File(photoDir(), `${current.data.id}-${randomUUID()}.jpg`);
  new File(saved.uri).moveSync(file);

  const next = { ...current.data, local_photo_uri: file.uri };
  saveLocal('cattle', next.id, next, { kind: 'photo', method: 'POST', path: `/v1/cattle/${next.id}/photo`, body: { local_uri: file.uri } });
  queued();
}

export function addBreed(name: string): string {
  const id = randomUUID();
  saveLocal('cattle_breeds', id, { id, name, active: true, version: 0 }, { kind: 'create', method: 'POST', path: '/v1/breeds', body: { id, name } });
  queued();
  return id;
}

export function updateBreed(current: Stored<Breed>, changes: Partial<Pick<Breed, 'name' | 'active'>>) {
  const next = { ...current.data, ...changes };
  saveLocal('cattle_breeds', next.id, next, { kind: 'update', method: 'PATCH', path: `/v1/breeds/${next.id}`, body: changes, ifMatch: current.data.version });
  queued();
}
