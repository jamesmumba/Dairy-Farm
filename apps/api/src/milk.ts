import { z } from 'zod';
import { audit, type DbClient, isUniqueViolation, type Queryable } from './db.js';
import { HttpError } from './http.js';
import { decimal, pastDate, reason, text } from './validation.js';

export const SESSIONS = ['morning', 'afternoon', 'evening'] as const;
type Session = (typeof SESSIONS)[number];

// Nominal clock time of each session on the farm, used to decide whether a medicine's
// milk-withdrawal period still covered the milking.
const SESSION_HOUR: Record<Session, number> = { morning: 6, afternoon: 12, evening: 18 };

const quantity = decimal(3).refine((q) => Number(q) > 0, 'Litres must be more than 0').refine((q) => Number(q) <= 100, 'More than 100 L in one session: check the number');

export const MilkCreate = z
  .object({
    id: z.uuid(),
    cattle_id: z.uuid(),
    production_date: pastDate,
    session: z.enum(SESSIONS),
    quantity,
    notes: text(500),
    captured_at: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();

export const MilkCorrect = z
  .object({
    cattle_id: z.uuid().optional(),
    production_date: pastDate.optional(),
    session: z.enum(SESSIONS).optional(),
    quantity: quantity.optional(),
    notes: text(500),
    reason,
  })
  .strict();

export const MilkVoid = z.object({ reason }).strict();

export const MilkListQuery = z
  .object({
    from: pastDate.optional(),
    to: pastDate.optional(),
    cattle_id: z.uuid().optional(),
  })
  .strict();

export interface MilkEntry {
  id: string;
  cattle_id: string;
  production_date: string;
  session: Session;
  quantity: string;
  unit: string;
  restricted: boolean;
  notes: string | null;
  captured_at: string | null;
  status: 'valid' | 'voided';
  void_reason: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export const MILK_COLUMNS = `id, cattle_id, production_date::text, session, quantity::text, unit, restricted, notes,
  captured_at, status, void_reason, version, created_at, updated_at`;

/** Litres that count as saleable stock: none if voided or under milk withdrawal. */
const eligible = (e: Pick<MilkEntry, 'status' | 'restricted' | 'quantity'>) => (e.status === 'valid' && !e.restricted ? e.quantity : '0');

async function getEntry(client: Queryable, ownerId: string, id: string, forUpdate = false) {
  const { rows } = await client.query<MilkEntry>(
    `select ${MILK_COLUMNS} from public.milk_production where owner_id = $1 and id = $2 ${forUpdate ? 'for update' : ''}`,
    [ownerId, id],
  );
  if (!rows[0]) throw new HttpError(404, 'not_found', 'Milk entry not found.');
  return rows[0];
}

/** The animal must be in this herd, female, and still on the farm on that date. */
async function checkAnimal(client: DbClient, ownerId: string, cattleId: string, date: string) {
  const { rows } = await client.query<{ sex: string; status: string; status_date: string | null; birth_date: string | null }>(
    `select sex, status, status_date::text, birth_date::text from public.cattle
     where owner_id = $1 and id = $2 and deleted_at is null`,
    [ownerId, cattleId],
  );
  const a = rows[0];
  if (!a) throw new HttpError(400, 'validation_failed', 'Animal not found in your herd.', { field: 'cattle_id' });
  if (a.sex !== 'female') throw new HttpError(400, 'validation_failed', 'Milk can only be recorded for female animals.', { field: 'cattle_id' });
  if (a.birth_date && date < a.birth_date) throw new HttpError(400, 'validation_failed', 'Date is before the animal was born.', { field: 'production_date' });
  if (a.status !== 'active' && a.status_date && date > a.status_date) {
    throw new HttpError(400, 'validation_failed', `The animal was ${a.status} on ${a.status_date}.`, { field: 'production_date' });
  }
}

/** True when a recorded milk-withdrawal period still covered this session. */
async function isRestricted(client: DbClient, ownerId: string, cattleId: string, date: string, session: Session) {
  const { rows } = await client.query<{ restricted: boolean }>(
    `select exists (
       select 1 from public.treatments t
       where t.owner_id = $1 and t.cattle_id = $2 and t.requires_milk_withdrawal and t.deleted_at is null
         and t.started_on <= $3::date
         and t.withdrawal_ends_at > (($3::date + make_interval(hours => $4))::timestamp
                                     at time zone (select time_zone from public.farmer_accounts where id = $1))
     ) as restricted`,
    [ownerId, cattleId, date, SESSION_HOUR[session]],
  );
  return rows[0].restricted;
}

async function sessionTaken(client: DbClient, ownerId: string, e: { cattle_id: string; production_date: string; session: string }, exceptId?: string) {
  const { rows } = await client.query<MilkEntry>(
    `select ${MILK_COLUMNS} from public.milk_production
     where owner_id = $1 and cattle_id = $2 and production_date = $3 and session = $4 and status = 'valid'
       and ($5::uuid is null or id <> $5::uuid)`,
    [ownerId, e.cattle_id, e.production_date, e.session, exceptId ?? null],
  );
  if (rows[0]) {
    throw new HttpError(409, 'session_exists', `This cow already has a ${e.session} entry for ${e.production_date}.`, { existing: rows[0] });
  }
}

async function stockMovement(client: DbClient, ownerId: string, entryId: string, kind: 'production' | 'adjustment', date: string, litres: string, why?: string) {
  if (Number(litres) === 0) return;
  // An entry's production movement shares the entry's id, so the app can tell when the
  // server's copy of an entry it saved offline has arrived.
  await client.query(
    `insert into public.milk_stock_movements (id, owner_id, movement_date, kind, quantity, reason, milk_production_id)
     values (case when $3 = 'production' then $6::uuid else gen_random_uuid() end, $1, $2, $3, $4, $5, $6)`,
    [ownerId, date, kind, litres, why ?? null, entryId],
  );
}

const negate = (litres: string) => (litres.startsWith('-') ? litres.slice(1) : `-${litres}`);

/**
 * Keeps the stock ledger equal to the entry's eligible litres: the sum of an entry's
 * movements is always eligible(current entry).
 */
async function moveStock(client: DbClient, ownerId: string, before: MilkEntry, after: MilkEntry, why: string) {
  const was = eligible(before);
  const now = eligible(after);
  if (before.production_date === after.production_date) {
    const { rows } = await client.query<{ delta: string }>('select ($1::numeric - $2::numeric)::text as delta', [now, was]);
    await stockMovement(client, ownerId, after.id, 'adjustment', after.production_date, rows[0].delta, why);
  } else {
    await stockMovement(client, ownerId, after.id, 'adjustment', before.production_date, negate(was), why);
    await stockMovement(client, ownerId, after.id, 'adjustment', after.production_date, now, why);
  }
}

export async function createMilk(client: DbClient, ownerId: string, actor: string, input: z.infer<typeof MilkCreate>) {
  await checkAnimal(client, ownerId, input.cattle_id, input.production_date);
  const { rows: clash } = await client.query('select 1 from public.milk_production where id = $1', [input.id]);
  if (clash[0]) throw new HttpError(409, 'id_taken', 'This record id is already used.');
  await sessionTaken(client, ownerId, input);

  const restricted = await isRestricted(client, ownerId, input.cattle_id, input.production_date, input.session);
  const row = await client
    .query<MilkEntry>(
      `insert into public.milk_production (id, owner_id, cattle_id, production_date, session, quantity, restricted, notes, captured_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning ${MILK_COLUMNS}`,
      [input.id, ownerId, input.cattle_id, input.production_date, input.session, input.quantity, restricted, input.notes ?? null, input.captured_at ?? null],
    )
    .then(
      (r) => r.rows[0],
      async (err) => {
        // A concurrent request for the same session committed first.
        if (isUniqueViolation(err, 'milk_production_session_uq')) {
          throw new HttpError(409, 'session_exists', `This cow already has a ${input.session} entry for ${input.production_date}.`);
        }
        throw err;
      },
    );
  await stockMovement(client, ownerId, row.id, 'production', row.production_date, eligible(row));
  await audit(client, { ownerId, actorUserId: actor, action: 'milk_production.created', entityTable: 'milk_production', entityId: row.id, after: row });
  return row;
}

function checkVersion(current: MilkEntry, version: number) {
  if (current.version !== version) {
    throw new HttpError(409, 'version_conflict', 'This entry was changed elsewhere. Review the latest version.', { current });
  }
  if (current.status === 'voided') throw new HttpError(409, 'voided', 'This entry was voided and cannot be changed.', { current });
}

export async function correctMilk(client: DbClient, ownerId: string, actor: string, id: string, version: number, input: z.infer<typeof MilkCorrect>) {
  const before = await getEntry(client, ownerId, id, true);
  checkVersion(before, version);
  const { reason: why, ...changes } = input;
  const next = { ...before, ...Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined)) } as MilkEntry;

  await checkAnimal(client, ownerId, next.cattle_id, next.production_date);
  await sessionTaken(client, ownerId, next, id);
  const restricted = await isRestricted(client, ownerId, next.cattle_id, next.production_date, next.session);

  const { rows } = await client.query<MilkEntry>(
    `update public.milk_production set cattle_id = $3, production_date = $4, session = $5, quantity = $6, notes = $7, restricted = $8
     where owner_id = $1 and id = $2 returning ${MILK_COLUMNS}`,
    [ownerId, id, next.cattle_id, next.production_date, next.session, next.quantity, next.notes, restricted],
  );
  const after = rows[0];
  await moveStock(client, ownerId, before, after, `Correction: ${why}`);
  const changed = (['cattle_id', 'production_date', 'session', 'quantity', 'notes', 'restricted'] as const).filter((k) => before[k] !== after[k]);
  await audit(client, {
    ownerId,
    actorUserId: actor,
    action: 'milk_production.corrected',
    entityTable: 'milk_production',
    entityId: id,
    reason: why,
    before: Object.fromEntries(changed.map((k) => [k, before[k]])),
    after: Object.fromEntries(changed.map((k) => [k, after[k]])),
  });
  return after;
}

export async function voidMilk(client: DbClient, ownerId: string, actor: string, id: string, version: number, why: string) {
  const before = await getEntry(client, ownerId, id, true);
  checkVersion(before, version);
  const { rows } = await client.query<MilkEntry>(
    `update public.milk_production set status = 'voided', void_reason = $3 where owner_id = $1 and id = $2 returning ${MILK_COLUMNS}`,
    [ownerId, id, why],
  );
  await moveStock(client, ownerId, before, rows[0], `Void: ${why}`);
  await audit(client, {
    ownerId,
    actorUserId: actor,
    action: 'milk_production.voided',
    entityTable: 'milk_production',
    entityId: id,
    reason: why,
    before: { status: 'valid', quantity: before.quantity },
    after: { status: 'voided' },
  });
  return rows[0];
}

/**
 * Re-evaluates the withdrawal restriction of a cow's valid milk entries between two dates
 * (after a treatment is recorded, corrected or removed). Changed entries are re-marked,
 * their stock adjusted and the change audited. Returns how many entries changed.
 */
export async function recheckRestrictions(client: DbClient, ownerId: string, actor: string, cattleId: string, from: string, to: string, why: string) {
  const { rows } = await client.query<MilkEntry>(
    `select ${MILK_COLUMNS} from public.milk_production
     where owner_id = $1 and cattle_id = $2 and status = 'valid' and production_date between $3 and $4
     for update`,
    [ownerId, cattleId, from, to],
  );
  let changed = 0;
  for (const before of rows) {
    const restricted = await isRestricted(client, ownerId, cattleId, before.production_date, before.session);
    if (restricted === before.restricted) continue;
    const { rows: updated } = await client.query<MilkEntry>(
      `update public.milk_production set restricted = $3 where owner_id = $1 and id = $2 returning ${MILK_COLUMNS}`,
      [ownerId, before.id, restricted],
    );
    await moveStock(client, ownerId, before, updated[0], why);
    await audit(client, {
      ownerId,
      actorUserId: actor,
      action: 'milk_production.restriction_changed',
      entityTable: 'milk_production',
      entityId: before.id,
      reason: why,
      before: { restricted: before.restricted },
      after: { restricted },
    });
    changed++;
  }
  return changed;
}

export async function listMilk(db: Queryable, ownerId: string, q: z.infer<typeof MilkListQuery>) {
  const { rows } = await db.query<MilkEntry>(
    `select ${MILK_COLUMNS} from public.milk_production
     where owner_id = $1 and ($2::date is null or production_date >= $2) and ($3::date is null or production_date <= $3)
       and ($4::uuid is null or cattle_id = $4)
     order by production_date desc, session`,
    [ownerId, q.from ?? null, q.to ?? null, q.cattle_id ?? null],
  );
  return rows;
}
