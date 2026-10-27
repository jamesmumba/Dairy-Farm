import { randomUUID } from 'expo-crypto';
import { syncSoon } from '../sync/engine';
import { deleteUnsynced, getRecord, listRecords, saveLocal, type Stored } from '../sync/store';
import { CARE_KINDS, type CareData, type CareKind } from './model';

// Care records follow the same rule as everything else: saved on the phone, then queued.
// Side effects computed by the server (scheduled pregnancy checks, the calf of a calving,
// the next vaccination dose, reproductive status, milk re-checks) arrive with the next sync.

type Row = { id: string; version: number; deleted_at: string | null };

export function listCare<T extends Row>(kind: CareKind): Stored<T>[] {
  return listRecords<T>(CARE_KINDS[kind].entity).filter((r) => !r.data.deleted_at);
}

export const getCare = <T extends Row>(kind: CareKind, id: string) => {
  const r = getRecord<T>(CARE_KINDS[kind].entity, id);
  return r && !r.data.deleted_at ? r : null;
};

export function loadCareData(): CareData {
  const d = <T extends Row>(kind: CareKind) => listCare<T>(kind).map((r) => r.data);
  return {
    health: d('health'),
    visits: d('vet-visit'),
    treatments: d('treatment'),
    breeding: d('breeding'),
    checks: d('pregnancy-check'),
    calvings: d('calving'),
    vaccinations: d('vaccination'),
    schedules: d('schedule'),
  };
}

export function createCare(kind: CareKind, fields: Record<string, unknown>, createOnly: Record<string, unknown> = {}): string {
  const { entity, path } = CARE_KINDS[kind];
  const id = randomUUID();
  saveLocal(entity, id, { ...fields, id, deleted_at: null, delete_reason: null, version: 0 }, {
    kind: 'create',
    method: 'POST',
    path: `/v1/${path}`,
    body: { id, ...fields, ...createOnly },
  });
  syncSoon();
  return id;
}

export function updateCare<T extends Row>(kind: CareKind, current: Stored<T>, changes: Record<string, unknown>) {
  const { entity, path } = CARE_KINDS[kind];
  saveLocal(entity, current.data.id, { ...current.data, ...changes }, {
    kind: 'update',
    method: 'PATCH',
    path: `/v1/${path}/${current.data.id}`,
    body: changes,
    ifMatch: current.data.version,
  });
  syncSoon();
}

export function removeCare<T extends Row>(kind: CareKind, current: Stored<T>, reason: string) {
  const { entity, path } = CARE_KINDS[kind];
  if (deleteUnsynced(entity, current.data.id)) return;
  saveLocal(entity, current.data.id, { ...current.data, deleted_at: new Date().toISOString(), delete_reason: reason }, {
    kind: 'delete',
    method: 'POST',
    path: `/v1/${path}/${current.data.id}/remove`,
    body: { reason },
    ifMatch: current.data.version,
  });
  syncSoon();
}
