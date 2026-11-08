import { z } from 'zod';
import { audit, type DbClient, isUniqueViolation, type Queryable } from './db.js';
import { HttpError } from './http.js';
import { CURRENCIES } from './profile.js';
import { decimal, pastDate, text } from './validation.js';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const fields = {
  ear_tag: text(30),
  name: text(60),
  breed_id: z.uuid().nullable().optional(),
  sex: z.enum(['female', 'male']),
  birth_date: pastDate.nullable().optional(),
  birth_date_estimated: z.boolean().optional(),
  acquisition_date: pastDate.nullable().optional(),
  acquisition_source: text(120),
  purchase_price: decimal(12).nullable().optional(),
  purchase_currency: z.enum(CURRENCIES).nullable().optional(),
  weight_kg: decimal(5).refine((w) => Number(w) > 0, 'Weight must be more than 0').nullable().optional(),
  dam_id: z.uuid().nullable().optional(),
  sire_id: z.uuid().nullable().optional(),
  sire_identifier: text(60),
  // 'bred' and 'pregnant' come only from breeding and pregnancy-check records (Stage 5).
  reproductive_status: z.enum(['open', 'not_applicable']).optional(),
  production_status: z.enum(['calf', 'heifer', 'lactating', 'dry', 'not_applicable']).optional(),
  notes: text(2000),
};

export const CattleCreate = z.object({ id: z.uuid(), ...fields }).strict();
export const CattleUpdate = z.object(fields).partial().strict();
export type CattleInput = z.infer<typeof CattleUpdate>;

// Why an animal left the herd: causes of death and reasons for sale, kept as categories so they can be counted.
export const DEATH_CAUSES = ['illness', 'calving', 'injury', 'poisoning', 'predator_theft', 'old_age', 'unknown', 'other'] as const;
export const SALE_REASONS = ['low_yield', 'infertility', 'old_age', 'illness', 'surplus', 'needed_money', 'other'] as const;

export const StatusChange = z
  .object({
    status: z.enum(['active', 'sold', 'deceased', 'transferred', 'inactive']),
    status_date: pastDate.nullable().optional(),
    status_details: text(500),
    status_reason: z.enum([...new Set([...DEATH_CAUSES, ...SALE_REASONS])] as [string, ...string[]]).nullable().optional(),
    /** The health concern that led to a death (or a sale for illness). */
    status_health_record_id: z.uuid().nullable().optional(),
    reason: text(500),
  })
  .strict()
  .refine((s) => s.status === 'active' || s.status_date, { message: 'Enter the date', path: ['status_date'] })
  .refine(
    (s) =>
      !s.status_reason ||
      (s.status === 'deceased' && (DEATH_CAUSES as readonly string[]).includes(s.status_reason)) ||
      (s.status === 'sold' && (SALE_REASONS as readonly string[]).includes(s.status_reason)),
    { message: 'Choose a reason that fits the new status', path: ['status_reason'] },
  )
  .refine((s) => !s.status_health_record_id || s.status === 'deceased' || s.status === 'sold', {
    message: 'A health concern can be linked only to a death or a sale',
    path: ['status_health_record_id'],
  })
  .refine((s) => s.status !== 'active' || s.reason, { message: 'Say why the animal is active again', path: ['reason'] });

export const PhotoConfirm = z.object({ path: z.string().min(1).max(300) }).strict();

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export interface Cattle {
  id: string;
  ear_tag: string | null;
  name: string | null;
  breed_id: string | null;
  sex: 'female' | 'male';
  birth_date: string | null;
  birth_date_estimated: boolean;
  acquisition_date: string | null;
  acquisition_source: string | null;
  purchase_price: string | null;
  purchase_currency: string | null;
  weight_kg: string | null;
  dam_id: string | null;
  sire_id: string | null;
  sire_identifier: string | null;
  reproductive_status: string;
  production_status: string;
  photo_path: string | null;
  notes: string | null;
  status: string;
  status_date: string | null;
  status_details: string | null;
  status_reason: string | null;
  status_health_record_id: string | null;
  deleted_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

// Dates and decimals as text: exact values, no time-zone shifts.
export const CATTLE_COLUMNS = `id, ear_tag, name, breed_id, sex, birth_date::text, birth_date_estimated,
  acquisition_date::text, acquisition_source, purchase_price::text, purchase_currency, weight_kg::text,
  dam_id, sire_id, sire_identifier, reproductive_status, production_status, photo_path, notes, status,
  status_date::text, status_details, status_reason, status_health_record_id, deleted_at, version, created_at, updated_at`;

const EDITABLE = Object.keys(fields) as (keyof typeof fields)[];

export async function getCattle(client: Queryable, ownerId: string, id: string, forUpdate = false): Promise<Cattle> {
  const { rows } = await client.query<Cattle>(
    `select ${CATTLE_COLUMNS} from public.cattle where owner_id = $1 and id = $2 and deleted_at is null ${forUpdate ? 'for update' : ''}`,
    [ownerId, id],
  );
  // Another owner's animal looks exactly like a missing one.
  if (!rows[0]) throw new HttpError(404, 'not_found', 'Animal not found.');
  return rows[0];
}

/** Cross-record rules that need the database: ownership of linked rows and sex consistency. */
async function checkLinks(client: DbClient, ownerId: string, id: string, a: Partial<Cattle>) {
  if (a.breed_id) {
    const { rows } = await client.query('select 1 from public.cattle_breeds where owner_id = $1 and id = $2', [ownerId, a.breed_id]);
    if (!rows[0]) throw new HttpError(400, 'validation_failed', 'Unknown breed.', { field: 'breed_id' });
  }
  for (const [field, sex, label] of [
    ['dam_id', 'female', 'Mother'],
    ['sire_id', 'male', 'Father'],
  ] as const) {
    const parent = a[field];
    if (!parent) continue;
    if (parent === id) throw new HttpError(400, 'validation_failed', `${label} cannot be the animal itself.`, { field });
    const { rows } = await client.query<{ sex: string }>(
      'select sex from public.cattle where owner_id = $1 and id = $2 and deleted_at is null',
      [ownerId, parent],
    );
    if (!rows[0]) throw new HttpError(400, 'validation_failed', `${label} not found in your herd.`, { field });
    if (rows[0].sex !== sex) throw new HttpError(400, 'validation_failed', `${label} must be ${sex}.`, { field });
  }
  if (a.sex === 'male' && (['lactating', 'dry'].includes(a.production_status ?? '') || a.reproductive_status === 'open')) {
    throw new HttpError(400, 'validation_failed', 'Milking and breeding status apply to females only.', { field: 'production_status' });
  }
  if (a.purchase_price && !a.purchase_currency) {
    throw new HttpError(400, 'validation_failed', 'Choose the currency of the purchase price.', { field: 'purchase_currency' });
  }
}

function earTagTaken(err: unknown): never {
  if (isUniqueViolation(err, 'cattle_owner_ear_tag_uq')) {
    throw new HttpError(409, 'ear_tag_taken', 'Another animal in your herd already has this ear tag.', { field: 'ear_tag' });
  }
  throw err;
}

export async function createCattle(client: DbClient, ownerId: string, actor: string, input: z.infer<typeof CattleCreate>) {
  const { id, ...data } = input;
  await checkLinks(client, ownerId, id, data);
  const { rows: clash } = await client.query('select 1 from public.cattle where id = $1', [id]);
  if (clash[0]) throw new HttpError(409, 'id_taken', 'This record id is already used.');

  const columns = Object.keys(data).filter((k) => data[k as keyof typeof data] !== undefined);
  const values = columns.map((k) => data[k as keyof typeof data]);
  const row = await client
    .query<Cattle>(
      `insert into public.cattle (owner_id, id${columns.map((c) => `, ${c}`).join('')})
       values ($1, $2${columns.map((_, i) => `, $${i + 3}`).join('')}) returning ${CATTLE_COLUMNS}`,
      [ownerId, id, ...values],
    )
    .then((r) => r.rows[0], earTagTaken);
  await audit(client, { ownerId, actorUserId: actor, action: 'cattle.created', entityTable: 'cattle', entityId: id, after: row });
  return row;
}

export async function updateCattle(client: DbClient, ownerId: string, actor: string, id: string, version: number, patch: CattleInput) {
  const current = await getCattle(client, ownerId, id, true);
  if (current.version !== version) {
    throw new HttpError(409, 'version_conflict', 'This animal was changed elsewhere. Review the latest version.', { current });
  }
  const changes = Object.fromEntries(
    EDITABLE.filter((k) => patch[k] !== undefined && String(patch[k]) !== String(current[k])).map((k) => [k, patch[k]]),
  );
  if (Object.keys(changes).length === 0) return current;
  await checkLinks(client, ownerId, id, { ...current, ...changes });

  const keys = Object.keys(changes);
  const row = await client
    .query<Cattle>(
      `update public.cattle set ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')}
       where owner_id = $1 and id = $2 returning ${CATTLE_COLUMNS}`,
      [ownerId, id, ...Object.values(changes)],
    )
    .then((r) => r.rows[0], earTagTaken);
  const before = Object.fromEntries(keys.map((k) => [k, current[k as keyof Cattle]]));
  await audit(client, { ownerId, actorUserId: actor, action: 'cattle.updated', entityTable: 'cattle', entityId: id, before, after: changes });
  return row;
}

export async function changeStatus(client: DbClient, ownerId: string, actor: string, id: string, version: number, s: z.infer<typeof StatusChange>) {
  const current = await getCattle(client, ownerId, id, true);
  if (current.version !== version) {
    throw new HttpError(409, 'version_conflict', 'This animal was changed elsewhere. Review the latest version.', { current });
  }
  const active = s.status === 'active';
  const healthId = active ? null : (s.status_health_record_id ?? null);
  if (healthId) {
    const { rows: hr } = await client.query(
      'select 1 from public.animal_health_records where owner_id = $1 and id = $2 and cattle_id = $3 and deleted_at is null',
      [ownerId, healthId, id],
    );
    if (!hr[0]) throw new HttpError(400, 'validation_failed', 'That health concern is not about this animal.', { field: 'status_health_record_id' });
  }
  const { rows } = await client.query<Cattle>(
    `update public.cattle set status = $3, status_date = $4, status_details = $5, status_reason = $6, status_health_record_id = $7
     where owner_id = $1 and id = $2 returning ${CATTLE_COLUMNS}`,
    [ownerId, id, s.status, active ? null : s.status_date, active ? null : (s.status_details ?? null), active ? null : (s.status_reason ?? null), healthId],
  );
  // A death from an illness closes that health concern as "died".
  if (healthId && s.status === 'deceased') {
    const { rows: closed } = await client.query(
      `update public.animal_health_records set recovery_status = 'died' where id = $1 and recovery_status <> 'died' returning id`,
      [healthId],
    );
    if (closed[0]) {
      await audit(client, { ownerId, actorUserId: actor, action: 'animal_health_records.updated', entityTable: 'animal_health_records', entityId: healthId, after: { recovery_status: 'died' } });
    }
  }
  await audit(client, {
    ownerId,
    actorUserId: actor,
    action: 'cattle.status_changed',
    entityTable: 'cattle',
    entityId: id,
    reason: s.reason ?? null,
    before: { status: current.status, status_date: current.status_date, status_details: current.status_details, status_reason: current.status_reason },
    after: { status: rows[0].status, status_date: rows[0].status_date, status_details: rows[0].status_details, status_reason: rows[0].status_reason },
  });
  return rows[0];
}

// Every table that links to an animal. Any row here means the animal has history.
const HISTORY = [
  'select 1 from public.milk_production where cattle_id = $1',
  'select 1 from public.animal_health_records where cattle_id = $1',
  'select 1 from public.treatments where cattle_id = $1',
  'select 1 from public.veterinary_visits where cattle_id = $1',
  'select 1 from public.breeding_records where cattle_id = $1',
  'select 1 from public.pregnancy_checks where cattle_id = $1',
  'select 1 from public.calving_records where dam_id = $1 or calf_id = $1',
  'select 1 from public.vaccination_records where cattle_id = $1',
  'select 1 from public.alert_actions where cattle_id = $1',
  'select 1 from public.cattle where (dam_id = $1 or sire_id = $1) and deleted_at is null',
];

export async function deleteCattle(client: DbClient, ownerId: string, actor: string, id: string, version: number) {
  const current = await getCattle(client, ownerId, id, true);
  if (current.version !== version) {
    throw new HttpError(409, 'version_conflict', 'This animal was changed elsewhere. Review the latest version.', { current });
  }
  const { rows } = await client.query(`select exists (${HISTORY.join(' union all ')}) as has_history`, [id]);
  if (rows[0].has_history) {
    throw new HttpError(409, 'has_history', 'This animal has records linked to it. Change its status (sold, deceased, transferred or inactive) instead.');
  }
  const deleted = await client.query<Cattle>(
    `update public.cattle set deleted_at = now() where owner_id = $1 and id = $2 returning ${CATTLE_COLUMNS}`,
    [ownerId, id],
  );
  await audit(client, { ownerId, actorUserId: actor, action: 'cattle.deleted', entityTable: 'cattle', entityId: id, before: current });
  return deleted.rows[0];
}

export async function setPhoto(client: DbClient, ownerId: string, actor: string, id: string, path: string) {
  const current = await getCattle(client, ownerId, id, true);
  const { rows } = await client.query<Cattle>(
    `update public.cattle set photo_path = $3 where owner_id = $1 and id = $2 returning ${CATTLE_COLUMNS}`,
    [ownerId, id, path],
  );
  await audit(client, {
    ownerId,
    actorUserId: actor,
    action: 'cattle.photo_changed',
    entityTable: 'cattle',
    entityId: id,
    before: { photo_path: current.photo_path },
    after: { photo_path: path },
  });
  return { row: rows[0], previousPath: current.photo_path };
}

// ---------------------------------------------------------------------------
// Timeline: one list of everything recorded for an animal, newest first.
// ---------------------------------------------------------------------------

export interface TimelineEvent {
  at: string;
  kind: string;
  title: string;
  detail: string | null;
  /** The record behind the event (null for daily milk and audit entries). */
  record_id: string | null;
  /** Events of one story share this: a health concern with its visits, treatments and alert action;
   *  a mating with its pregnancy check and calving. */
  episode: string | null;
}

export async function timeline(client: Queryable, ownerId: string, id: string, limit = 200): Promise<TimelineEvent[]> {
  await getCattle(client, ownerId, id);
  // Plain dates count from midnight on the farm (its time zone), so the phone shows the same day. Only what has
  // happened: a vaccination still due or a pregnancy check not yet done belongs to Care, not History.
  const { rows } = await client.query<TimelineEvent>(
    `with farm as (select time_zone as tz from public.farmer_accounts where id = $1)
     select at, kind, title, detail, record_id, episode from (
       select (production_date::timestamp at time zone farm.tz) as at, 'milk' as kind,
              'Milk ' || trim_scale(sum(quantity))::text || ' L' as title,
              initcap(left(string_agg(session, ', ' order by array_position(array['morning', 'afternoon', 'evening'], session)), 1))
                || substr(string_agg(session, ', ' order by array_position(array['morning', 'afternoon', 'evening'], session)), 2) as detail,
              null::uuid as record_id, null::uuid as episode
         from public.milk_production, farm where owner_id = $1 and cattle_id = $2 and status = 'valid'
        group by production_date, farm.tz
       union all
       select (coalesce(first_symptoms_on, reported_on)::timestamp at time zone farm.tz), 'health',
              coalesce(confirmed_diagnosis, suspected_issue, 'Health concern'), observations, id, id
         from public.animal_health_records, farm where owner_id = $1 and cattle_id = $2 and deleted_at is null
       union all
       select (started_on::timestamp at time zone farm.tz), 'treatment', 'Treatment: ' || medication,
              case when requires_milk_withdrawal
                   then 'Milk withdrawal until ' || to_char(withdrawal_ends_at at time zone farm.tz, 'FMDD Mon YYYY, HH24:MI') end,
              id, health_record_id
         from public.treatments, farm where owner_id = $1 and cattle_id = $2 and deleted_at is null
       union all
       select visit_at, 'vet_visit', 'Veterinary visit' || coalesce(': ' || veterinarian, ''), purpose, id, health_record_id
         from public.veterinary_visits where owner_id = $1 and cattle_id = $2 and deleted_at is null
       union all
       select event_at, 'breeding',
              case event_type when 'heat_observed' then 'Heat seen'
                              when 'natural_mating' then 'Natural mating'
                              when 'artificial_insemination' then 'Artificial insemination' end,
              bull_or_semen_id, id, case when event_type <> 'heat_observed' then id end
         from public.breeding_records where owner_id = $1 and cattle_id = $2 and deleted_at is null
       union all
       select (examined_on::timestamp at time zone farm.tz), 'pregnancy_check', 'Pregnancy check: ' || replace(result, '_', ' '), examiner, id, breeding_record_id
         from public.pregnancy_checks, farm where owner_id = $1 and cattle_id = $2 and deleted_at is null and result <> 'pending'
       union all
       select (calved_on::timestamp at time zone farm.tz), 'calving',
              case outcome when 'live' then 'Calved' when 'stillborn' then 'Calving: stillborn'
                           when 'aborted' then 'Calving: aborted' else 'Calving' end,
              complications, id,
              (select p.breeding_record_id from public.pregnancy_checks p where p.id = calving_records.pregnancy_check_id)
         from public.calving_records, farm where owner_id = $1 and dam_id = $2 and deleted_at is null
       union all
       select (coalesce(administered_on, due_on)::timestamp at time zone farm.tz), 'vaccination',
              'Vaccination: ' || vaccine_name || case status when 'missed' then ' (missed)' when 'cancelled' then ' (cancelled)' else '' end,
              target_disease, id, null::uuid
         from public.vaccination_records, farm where owner_id = $1 and cattle_id = $2 and deleted_at is null and status <> 'scheduled'
       union all
       select (action_on::timestamp at time zone farm.tz), 'alert_action',
              'Milk alert: ' || case action_taken when 'checked_record' then 'checked the record'
                                                  when 'checked_feed_water' then 'checked feed and water'
                                                  when 'observed' then 'watched her'
                                                  when 'called_vet' then 'called the vet'
                                                  when 'treated' then 'treated'
                                                  else 'other action' end
                || case status when 'resolved' then ' (resolved)' else ' (watching)' end,
              concat_ws(' · ', alert_reason, outcome), id, health_record_id
         from public.alert_actions, farm where owner_id = $1 and cattle_id = $2 and deleted_at is null
       union all
       select occurred_at, 'audit',
              case action when 'cattle.created' then 'Registered'
                          when 'cattle.updated' then 'Details changed'
                          when 'cattle.status_changed' then
                            case after_data->>'status' when 'active' then 'Back to active' when 'sold' then 'Sold'
                                                       when 'deceased' then 'Died' when 'transferred' then 'Transferred'
                                                       else 'Marked inactive' end
                            || coalesce(' (' || case after_data->>'status_reason'
                                 when 'illness' then 'illness' when 'calving' then 'calving problems' when 'injury' then 'injury or accident'
                                 when 'poisoning' then 'poisoning' when 'predator_theft' then 'predator or theft' when 'old_age' then 'old age'
                                 when 'unknown' then 'cause unknown' when 'low_yield' then 'low yield' when 'infertility' then 'not getting in calf'
                                 when 'surplus' then 'surplus to the herd' when 'needed_money' then 'farm needed money' when 'other' then 'other reason'
                               end || ')', '')
                          when 'cattle.photo_changed' then 'Photo changed'
                          when 'cattle.reproductive_status_derived' then
                            case after_data->>'reproductive_status' when 'pregnant' then 'Now pregnant'
                                                                    when 'bred' then 'Now bred, not yet checked'
                                                                    else 'Now open (not pregnant)' end
                          else 'Record changed' end,
              reason, null::uuid, null::uuid
         from public.audit_logs where owner_id = $1 and entity_table = 'cattle' and entity_id = $2
     ) events, farm
     where (at at time zone farm.tz)::date <= (now() at time zone farm.tz)::date
     order by at desc
     limit $3`,
    [ownerId, id, limit],
  );
  return rows;
}
