import { randomUUID } from 'expo-crypto';
import { syncSoon } from '../sync/engine';
import { deleteUnsynced, listRecords, saveLocal, type Stored } from '../sync/store';
import type { MilkRow, Session } from './calc';

export interface MilkEntry extends MilkRow {
  unit: string;
  notes: string | null;
  captured_at: string | null;
  void_reason: string | null;
  version: number;
  created_at?: string;
  updated_at?: string;
}

export interface MilkInput {
  cattle_id: string;
  production_date: string;
  session: Session;
  quantity: string;
  notes?: string | null;
}

/** A valid entry already exists for that cow, date and session. */
export class SessionTaken extends Error {
  constructor(public existing: MilkEntry) {
    super('Already recorded');
  }
}

export const listMilk = () => listRecords<MilkEntry>('milk_production');

export function findSession(entries: Stored<MilkEntry>[], key: Pick<MilkInput, 'cattle_id' | 'production_date' | 'session'>, exceptId?: string) {
  return entries.find(
    (e) =>
      e.data.status === 'valid' &&
      e.data.id !== exceptId &&
      e.data.cattle_id === key.cattle_id &&
      e.data.production_date === key.production_date &&
      e.data.session === key.session,
  );
}

/** Saves on the phone and queues for the server. Throws SessionTaken for a duplicate session. */
export function recordMilk(input: MilkInput): string {
  const existing = findSession(listMilk(), input);
  if (existing) throw new SessionTaken(existing.data);
  const id = randomUUID();
  const captured_at = new Date().toISOString();
  const body = { id, ...input, notes: input.notes ?? null, captured_at };
  const entry: MilkEntry = { ...body, unit: 'L', status: 'valid', restricted: false, void_reason: null, version: 0 };
  saveLocal('milk_production', id, entry, { kind: 'create', method: 'POST', path: '/v1/milk-production', body });
  return id;
}

/** Records a whole milking round; entries already recorded for the session are skipped. */
export function recordRound(entries: MilkInput[]): { saved: number; skipped: number } {
  let saved = 0;
  let skipped = 0;
  for (const e of entries) {
    try {
      recordMilk(e);
      saved++;
    } catch (err) {
      if (!(err instanceof SessionTaken)) throw err;
      skipped++;
    }
  }
  syncSoon();
  return { saved, skipped };
}

export function addMilk(input: MilkInput) {
  const id = recordMilk(input);
  syncSoon();
  return id;
}

export function correctMilk(current: Stored<MilkEntry>, changes: Partial<MilkInput>, reason: string) {
  const next = { ...current.data, ...changes };
  const clash = findSession(listMilk(), next, next.id);
  if (clash) throw new SessionTaken(clash.data);
  saveLocal('milk_production', next.id, next, {
    kind: 'correct',
    method: 'POST',
    path: `/v1/milk-production/${next.id}/correct`,
    body: { ...changes, reason },
    ifMatch: current.data.version,
  });
  syncSoon();
}

export function voidMilk(current: Stored<MilkEntry>, reason: string) {
  // Never reached the server: just remove it.
  if (deleteUnsynced('milk_production', current.data.id)) return;
  saveLocal('milk_production', current.data.id, { ...current.data, status: 'voided', void_reason: reason }, {
    kind: 'void',
    method: 'POST',
    path: `/v1/milk-production/${current.data.id}/void`,
    body: { reason },
    ifMatch: current.data.version,
  });
  syncSoon();
}
