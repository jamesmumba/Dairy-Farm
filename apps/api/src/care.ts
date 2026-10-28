import { z } from 'zod';
import { createCattle } from './cattle.js';
import { audit, type DbClient, type Queryable } from './db.js';
import { HttpError } from './http.js';
import { recheckRestrictions } from './milk.js';
import { isoDate, pastDate, reason, text } from './validation.js';

// Animal care records (health, vet visits, treatments, breeding, pregnancy checks, calvings,
// vaccination schedules and doses) share one lifecycle: create (client id, idempotent),
// update (If-Match), remove with a reason (soft delete). Each entity adds its own field rules,
// links and side effects. The app records what the vet or farmer says; it never diagnoses,
// prescribes, calculates doses or sets withdrawal periods.

type Row = Record<string, unknown> & { id: string; version: number; deleted_at: string | null };

interface Ctx {
  client: DbClient;
  owner: string;
  actor: string;
}

interface Link {
  field: string;
  table: 'cattle' | 'animal_health_records' | 'breeding_records' | 'vaccination_schedules';
  label: string;
  female?: boolean;
  /** The linked record must be about the same animal. */
  sameCattle?: boolean;
}

export interface CareEntity {
  table: string;
  path: string;
  label: string;
  columns: string;
  fields: z.ZodRawShape;
  createOnly?: z.ZodRawShape;
  links: Link[];
  /** Cross-field rule on the full record: [field, message] when broken. */
  check?: (r: Record<string, any>) => [string, string] | null;
  /** Side effects in the same transaction; returned fields are added to the response. */
  afterWrite?: (ctx: Ctx, before: Row | null, after: Row, extra: Record<string, any>) => Promise<Record<string, unknown> | void>;
}

const pastDateTime = z.iso
  .datetime({ offset: true })
  .refine((d) => Date.parse(d) <= Date.now() + 86_400_000, 'Date cannot be in the future');
const dateTime = z.iso.datetime({ offset: true });
const opt = <T extends z.ZodType>(s: T) => s.nullable().optional();
const day = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);

// --- Derived animal state ----------------------------------------------------

/**
 * Reproductive status follows records only: the latest of a mating/insemination (bred),
 * a pregnancy check result (pregnant / open) or a calving (open). Breeding alone never
 * makes an animal pregnant.
 */
async function recomputeReproductive(ctx: Ctx, cattleId: string) {
  const { client, owner, actor } = ctx;
  const { rows: cow } = await client.query<{ sex: string; reproductive_status: string }>(
    'select sex, reproductive_status from public.cattle where owner_id = $1 and id = $2',
    [owner, cattleId],
  );
  if (cow[0]?.sex !== 'female') return;
  const { rows } = await client.query<{ status: string }>(
    `select status from (
       select 'bred' as status, event_at::date as d, created_at from public.breeding_records
        where owner_id = $1 and cattle_id = $2 and deleted_at is null and event_type <> 'heat_observed'
       union all
       select case result when 'pregnant' then 'pregnant' else 'open' end, examined_on, created_at from public.pregnancy_checks
        where owner_id = $1 and cattle_id = $2 and deleted_at is null and result in ('pregnant', 'not_pregnant')
       union all
       select 'open', calved_on, created_at from public.calving_records
        where owner_id = $1 and dam_id = $2 and deleted_at is null
     ) e order by d desc, created_at desc limit 1`,
    [owner, cattleId],
  );
  const current = cow[0].reproductive_status;
  // No breeding history left: a derived status falls back to open; a farmer-set one stays.
  const next = rows[0]?.status ?? (['bred', 'pregnant'].includes(current) ? 'open' : current);
  if (next === current) return;
  await client.query('update public.cattle set reproductive_status = $3 where owner_id = $1 and id = $2', [owner, cattleId, next]);
  await audit(client, {
    ownerId: owner,
    actorUserId: actor,
    action: 'cattle.reproductive_status_derived',
    entityTable: 'cattle',
    entityId: cattleId,
    reason: 'From breeding, pregnancy check or calving records',
    before: { reproductive_status: current },
    after: { reproductive_status: next },
  });
}

async function settings(client: Queryable, owner: string) {
  const { rows } = await client.query<{ breeding_intervals: { pregnancy_check_days: number; gestation_days: number } }>(
    'select breeding_intervals from public.farmer_accounts where id = $1',
    [owner],
  );
  return rows[0].breeding_intervals;
}

const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

// --- Entities ----------------------------------------------------------------

const COMMON = 'deleted_at, delete_reason, version, created_at, updated_at';

const health: CareEntity = {
  table: 'animal_health_records',
  path: 'health-records',
  label: 'Health record',
  columns: `id, cattle_id, first_symptoms_on::text, reported_on::text, observations, suspected_issue, confirmed_diagnosis,
    condition_status, severity, urgent, responsible_person, follow_up_on::text, recovery_status, notes, ${COMMON}`,
  fields: {
    cattle_id: z.uuid(),
    first_symptoms_on: opt(pastDate),
    reported_on: pastDate,
    observations: text(2000),
    suspected_issue: text(200),
    confirmed_diagnosis: text(200),
    condition_status: z.enum(['suspected', 'confirmed', 'ruled_out']).optional(),
    severity: opt(z.enum(['low', 'moderate', 'high', 'critical'])),
    urgent: z.boolean().optional(),
    responsible_person: text(120),
    follow_up_on: opt(isoDate),
    recovery_status: z.enum(['ongoing', 'recovering', 'recovered', 'chronic', 'died']).optional(),
    notes: text(2000),
  },
  links: [{ field: 'cattle_id', table: 'cattle', label: 'Animal' }],
  check: (r) =>
    r.condition_status === 'confirmed' && !r.confirmed_diagnosis
      ? ['confirmed_diagnosis', 'Enter the diagnosis the vet confirmed']
      : r.first_symptoms_on && r.first_symptoms_on > r.reported_on
        ? ['first_symptoms_on', 'First symptoms cannot be after the report date']
        : null,
};

const vetVisit: CareEntity = {
  table: 'veterinary_visits',
  path: 'vet-visits',
  label: 'Veterinary visit',
  columns: `id, cattle_id, health_record_id, visit_at, veterinarian, purpose, findings, notes, ${COMMON}`,
  fields: {
    cattle_id: z.uuid(),
    health_record_id: opt(z.uuid()),
    visit_at: pastDateTime,
    veterinarian: text(120),
    purpose: text(200),
    findings: text(2000),
    notes: text(2000),
  },
  links: [
    { field: 'cattle_id', table: 'cattle', label: 'Animal' },
    { field: 'health_record_id', table: 'animal_health_records', label: 'Health record', sameCattle: true },
  ],
};

const treatment: CareEntity = {
  table: 'treatments',
  path: 'treatments',
  label: 'Treatment',
  columns: `id, cattle_id, health_record_id, medication, dosage_instructions, administered_by, started_on::text, completed_on::text,
    requires_milk_withdrawal, withdrawal_period_text, withdrawal_ends_at, withdrawal_source, withdrawal_cleared_at,
    withdrawal_clearance_note, notes, ${COMMON}`,
  fields: {
    cattle_id: z.uuid(),
    health_record_id: opt(z.uuid()),
    medication: z.string().trim().min(1, 'Enter the medicine').max(200),
    dosage_instructions: text(500), // as instructed by the vet; never calculated
    administered_by: text(120),
    started_on: pastDate,
    completed_on: opt(pastDate),
    requires_milk_withdrawal: z.boolean().optional(),
    withdrawal_period_text: text(200),
    withdrawal_ends_at: opt(dateTime), // the vet's exact end time
    withdrawal_source: text(200),
    withdrawal_cleared_at: opt(pastDateTime),
    withdrawal_clearance_note: text(500),
    notes: text(2000),
  },
  links: [
    { field: 'cattle_id', table: 'cattle', label: 'Animal' },
    { field: 'health_record_id', table: 'animal_health_records', label: 'Health record', sameCattle: true },
  ],
  check: (r) => {
    if (r.completed_on && r.completed_on < r.started_on) return ['completed_on', 'Completion cannot be before the start'];
    if (r.requires_milk_withdrawal && !r.withdrawal_ends_at) return ['withdrawal_ends_at', 'Enter the withdrawal end date and time given by the vet'];
    if (r.withdrawal_ends_at && day(r.withdrawal_ends_at) < r.started_on) return ['withdrawal_ends_at', 'Withdrawal cannot end before the treatment started'];
    if (r.withdrawal_cleared_at && !r.requires_milk_withdrawal) return ['withdrawal_cleared_at', 'Clearance applies only to a milk withdrawal'];
    if (r.withdrawal_cleared_at && Date.parse(r.withdrawal_cleared_at) < Date.parse(r.withdrawal_ends_at)) {
      return ['withdrawal_cleared_at', 'Milk cannot be cleared before the withdrawal ends'];
    }
    return null;
  },
  // Milk already recorded in the (old or new) withdrawal window is re-checked.
  async afterWrite(ctx, before, after) {
    const windows = [before, after].filter((t) => t && t.requires_milk_withdrawal && t.withdrawal_ends_at) as Row[];
    if (!windows.length) return;
    const from = windows.map((t) => String(t.started_on)).sort()[0];
    const to = addDays(windows.map((t) => day(t.withdrawal_ends_at)).sort().reverse()[0], 1);
    const n = await recheckRestrictions(ctx.client, ctx.owner, ctx.actor, String(after.cattle_id), from, to, `Milk withdrawal (${after.medication})`);
    return { milk_entries_rechecked: n };
  },
};

const breeding: CareEntity = {
  table: 'breeding_records',
  path: 'breeding',
  label: 'Breeding record',
  columns: `id, cattle_id, event_type, event_at, bull_or_semen_id, performed_by, notes, ${COMMON}`,
  fields: {
    cattle_id: z.uuid(),
    event_type: z.enum(['heat_observed', 'natural_mating', 'artificial_insemination']),
    event_at: pastDateTime,
    bull_or_semen_id: text(80),
    performed_by: text(120),
    notes: text(2000),
  },
  links: [{ field: 'cattle_id', table: 'cattle', label: 'Animal', female: true }],
  async afterWrite(ctx, before, after) {
    const mating = after.event_type !== 'heat_observed';
    if (!before && mating && !after.deleted_at) {
      // Schedule a pregnancy check from the farmer's vet-approved interval.
      const { pregnancy_check_days } = await settings(ctx.client, ctx.owner);
      await ctx.client.query(
        `insert into public.pregnancy_checks (owner_id, cattle_id, breeding_record_id, scheduled_on, result)
         values ($1, $2, $3, $4, 'pending')`,
        [ctx.owner, after.cattle_id, after.id, addDays(day(after.event_at), pregnancy_check_days)],
      );
    }
    if (before && !after.deleted_at && day(before.event_at) !== day(after.event_at)) {
      const { pregnancy_check_days } = await settings(ctx.client, ctx.owner);
      await ctx.client.query(
        `update public.pregnancy_checks set scheduled_on = $3
         where owner_id = $1 and breeding_record_id = $2 and result = 'pending' and deleted_at is null`,
        [ctx.owner, after.id, addDays(day(after.event_at), pregnancy_check_days)],
      );
    }
    if (after.deleted_at) {
      // Pending checks scheduled from this breeding go with it; recorded results stay.
      await ctx.client.query(
        `update public.pregnancy_checks set deleted_at = now(), delete_reason = 'Breeding record removed'
         where owner_id = $1 and breeding_record_id = $2 and result = 'pending' and deleted_at is null`,
        [ctx.owner, after.id],
      );
    }
    await recomputeReproductive(ctx, String(after.cattle_id));
  },
};

const pregnancyCheck: CareEntity = {
  table: 'pregnancy_checks',
  path: 'pregnancy-checks',
  label: 'Pregnancy check',
  columns: `id, cattle_id, breeding_record_id, scheduled_on::text, examined_on::text, result, examiner, expected_calving_on::text, notes, ${COMMON}`,
  fields: {
    cattle_id: z.uuid(),
    breeding_record_id: opt(z.uuid()),
    scheduled_on: opt(isoDate),
    examined_on: opt(pastDate),
    result: z.enum(['pending', 'pregnant', 'not_pregnant', 'inconclusive']).optional(),
    examiner: text(120),
    expected_calving_on: opt(isoDate),
    notes: text(2000),
  },
  links: [
    { field: 'cattle_id', table: 'cattle', label: 'Animal', female: true },
    { field: 'breeding_record_id', table: 'breeding_records', label: 'Breeding record', sameCattle: true },
  ],
  check: (r) =>
    r.result && r.result !== 'pending' && !r.examined_on
      ? ['examined_on', 'Enter the examination date']
      : r.expected_calving_on && r.result !== 'pregnant'
        ? ['expected_calving_on', 'Expected calving applies only to a confirmed pregnancy']
        : !r.scheduled_on && !r.examined_on
          ? ['scheduled_on', 'Enter when the check is planned or was done']
          : null,
  afterWrite: async (ctx, _before, after) => recomputeReproductive(ctx, String(after.cattle_id)),
};

const Calf = z
  .object({ id: z.uuid(), sex: z.enum(['female', 'male']), ear_tag: text(30), name: text(60) })
  .strict();

const calving: CareEntity = {
  table: 'calving_records',
  path: 'calvings',
  label: 'Calving record',
  columns: `id, dam_id, calf_id, calved_on::text, outcome, complications, dry_off_on::text, observations, ${COMMON}`,
  fields: {
    dam_id: z.uuid(),
    calf_id: opt(z.uuid()),
    calved_on: pastDate,
    outcome: z.enum(['live', 'stillborn', 'aborted', 'other']),
    complications: text(1000),
    dry_off_on: opt(pastDate),
    observations: text(2000),
  },
  createOnly: { calf: Calf.optional() },
  links: [
    { field: 'dam_id', table: 'cattle', label: 'Mother', female: true },
    { field: 'calf_id', table: 'cattle', label: 'Calf' },
  ],
  check: (r) => (r.calf_id && r.calf_id === r.dam_id ? ['calf_id', 'The calf cannot be its own mother'] : null),
  async afterWrite(ctx, before, after, extra) {
    if (!before && extra.calf) {
      if (after.outcome !== 'live') throw new HttpError(400, 'validation_failed', 'A calf can be registered only for a live birth.', { field: 'calf' });
      const { rows: bull } = await ctx.client.query<{ bull_or_semen_id: string | null }>(
        `select bull_or_semen_id from public.breeding_records
         where owner_id = $1 and cattle_id = $2 and deleted_at is null and event_type <> 'heat_observed' and event_at::date <= $3
         order by event_at desc limit 1`,
        [ctx.owner, after.dam_id, after.calved_on],
      );
      const calf = await createCattle(ctx.client, ctx.owner, ctx.actor, {
        ...extra.calf,
        dam_id: String(after.dam_id),
        birth_date: String(after.calved_on),
        production_status: 'calf',
        sire_identifier: bull[0]?.bull_or_semen_id ?? null,
      });
      await ctx.client.query('update public.calving_records set calf_id = $2 where id = $1', [after.id, calf.id]);
      after.calf_id = calf.id;
    }
    if (!before && !after.deleted_at) {
      // After calving the cow is in milk; the farmer can change this on her profile.
      await ctx.client.query(
        `update public.cattle set production_status = 'lactating' where owner_id = $1 and id = $2 and production_status <> 'lactating'`,
        [ctx.owner, after.dam_id],
      );
    }
    await recomputeReproductive(ctx, String(after.dam_id));
  },
};

const vaccinationSchedule: CareEntity = {
  table: 'vaccination_schedules',
  path: 'vaccination-schedules',
  label: 'Vaccination schedule',
  columns: `id, vaccine_name, target_disease, interval_days, reminder_offsets_days, guidance_source, active, ${COMMON}`,
  fields: {
    vaccine_name: z.string().trim().min(1, 'Enter the vaccine').max(120),
    target_disease: text(120),
    interval_days: opt(z.number().int().min(1).max(3650)),
    reminder_offsets_days: z.array(z.number().int().min(0).max(365)).max(5).optional(),
    guidance_source: text(200),
    active: z.boolean().optional(),
  },
  links: [],
};

const vaccination: CareEntity = {
  table: 'vaccination_records',
  path: 'vaccinations',
  label: 'Vaccination',
  columns: `id, cattle_id, schedule_id, vaccine_name, target_disease, due_on::text, administered_on::text, status, batch_number,
    dosage_as_directed, administered_by, next_due_on::text, is_booster, group_batch_id, group_label, group_definition, notes, ${COMMON}`,
  fields: {
    cattle_id: z.uuid(),
    schedule_id: opt(z.uuid()),
    vaccine_name: z.string().trim().min(1, 'Enter the vaccine').max(120),
    target_disease: text(120),
    due_on: opt(isoDate),
    administered_on: opt(pastDate),
    status: z.enum(['scheduled', 'completed', 'missed', 'cancelled']).optional(),
    batch_number: text(60),
    dosage_as_directed: text(200),
    administered_by: text(120),
    next_due_on: opt(isoDate),
    is_booster: z.boolean().optional(),
    group_batch_id: opt(z.uuid()),
    group_label: text(120),
    group_definition: text(500),
    notes: text(2000),
  },
  links: [
    { field: 'cattle_id', table: 'cattle', label: 'Animal' },
    { field: 'schedule_id', table: 'vaccination_schedules', label: 'Vaccination schedule' },
  ],
  check: (r) =>
    r.status === 'completed' && !r.administered_on
      ? ['administered_on', 'Enter the date the dose was given']
      : !r.due_on && !r.administered_on
        ? ['due_on', 'Enter the due date or the date given']
        : r.next_due_on && r.administered_on && r.next_due_on <= r.administered_on
          ? ['next_due_on', 'The next dose must be after this one']
          : null,
  // A completed dose with a next due date schedules the next dose (once).
  async afterWrite(ctx, before, after) {
    const completedNow = after.status === 'completed' && after.next_due_on && !after.deleted_at;
    const changed = !before || before.status !== 'completed' || before.next_due_on !== after.next_due_on;
    if (!completedNow || !changed) return;
    await ctx.client.query(
      `insert into public.vaccination_records (owner_id, cattle_id, schedule_id, vaccine_name, target_disease, due_on, status, is_booster,
         group_batch_id, group_label, group_definition)
       select $1, $2, $3, $4, $5, $6, 'scheduled', true, $7, $8, $9
       where not exists (
         select 1 from public.vaccination_records
         where owner_id = $1 and cattle_id = $2 and vaccine_name = $4 and due_on = $6 and deleted_at is null and status = 'scheduled')`,
      [ctx.owner, after.cattle_id, after.schedule_id, after.vaccine_name, after.target_disease, after.next_due_on, after.group_batch_id, after.group_label, after.group_definition],
    );
  },
};

// What the farmer did about an early-warning alert. The alert is worked out on the phone; this keeps
// the response, the follow-up date while the cow is watched, and the outcome.
const alertAction: CareEntity = {
  table: 'alert_actions',
  path: 'alert-actions',
  label: 'Alert action',
  columns: `id, cattle_id, alert_type, alert_reason, action_taken, action_on::text, notes, status, follow_up_on::text, resolved_on::text,
    outcome, ${COMMON}`,
  fields: {
    cattle_id: z.uuid(),
    alert_type: z.enum(['milk_drop', 'milk_decline', 'other']),
    alert_reason: text(300),
    action_taken: z.enum(['checked_record', 'checked_feed_water', 'observed', 'called_vet', 'treated', 'other']),
    action_on: pastDate,
    notes: text(2000),
    status: z.enum(['monitoring', 'resolved']).optional(),
    follow_up_on: opt(isoDate),
    resolved_on: opt(pastDate),
    outcome: text(1000),
  },
  links: [{ field: 'cattle_id', table: 'cattle', label: 'Animal' }],
  check: (r) =>
    r.status !== 'resolved' && !r.follow_up_on
      ? ['follow_up_on', 'Choose when to check on her again']
      : r.status === 'resolved' && !r.resolved_on
        ? ['resolved_on', 'Enter when it was resolved']
        : r.resolved_on && r.resolved_on < r.action_on
          ? ['resolved_on', 'It cannot be resolved before the action was taken']
          : null,
};

export const CARE_ENTITIES = [health, vetVisit, treatment, breeding, pregnancyCheck, calving, vaccinationSchedule, vaccination, alertAction];

// --- Lifecycle -----------------------------------------------------------------

const normalise = (v: unknown) => (v instanceof Date ? v.toISOString() : v);

async function getRow(client: Queryable, e: CareEntity, owner: string, id: string, forUpdate = false): Promise<Row> {
  const { rows } = await client.query<Row>(
    `select ${e.columns} from public.${e.table} where owner_id = $1 and id = $2 and deleted_at is null ${forUpdate ? 'for update' : ''}`,
    [owner, id],
  );
  if (!rows[0]) throw new HttpError(404, 'not_found', `${e.label} not found.`);
  return Object.fromEntries(Object.entries(rows[0]).map(([k, v]) => [k, normalise(v)])) as Row;
}

function validateFull(e: CareEntity, record: Record<string, unknown>) {
  const parsed = z.object(e.fields).strict().safeParse(record);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new HttpError(400, 'validation_failed', issue.message, { field: issue.path.join('.') });
  }
  const broken = e.check?.(parsed.data);
  if (broken) throw new HttpError(400, 'validation_failed', broken[1], { field: broken[0] });
  return parsed.data as Record<string, unknown>;
}

async function checkLinks(ctx: Ctx, e: CareEntity, r: Record<string, unknown>) {
  for (const link of e.links) {
    const id = r[link.field];
    if (!id) continue;
    const extra = link.table === 'cattle' ? ', sex' : link.table === 'vaccination_schedules' ? '' : ', cattle_id';
    const { rows } = await ctx.client.query<{ sex?: string; cattle_id?: string }>(
      `select id${extra} from public.${link.table} where owner_id = $1 and id = $2 and deleted_at is null`,
      [ctx.owner, id],
    );
    const found = rows[0];
    if (!found) throw new HttpError(400, 'validation_failed', `${link.label} not found.`, { field: link.field });
    if (link.female && found.sex !== 'female') throw new HttpError(400, 'validation_failed', `${link.label} must be female.`, { field: link.field });
    if (link.sameCattle && found.cattle_id !== r.cattle_id) {
      throw new HttpError(400, 'validation_failed', `${link.label} is about a different animal.`, { field: link.field });
    }
  }
}

export const createSchema = (e: CareEntity) => z.object({ id: z.uuid(), ...e.fields, ...(e.createOnly ?? {}) }).strict();
export const updateSchema = (e: CareEntity) => z.object(e.fields).partial().strict();
export const RemoveBody = z.object({ reason }).strict();

export async function createCare(ctx: Ctx, e: CareEntity, input: Record<string, unknown>) {
  const { id, ...rest } = input;
  const extra = Object.fromEntries(Object.keys(e.createOnly ?? {}).map((k) => [k, rest[k]]));
  const fields = Object.fromEntries(Object.entries(rest).filter(([k, v]) => !(k in (e.createOnly ?? {})) && v !== undefined));
  const record = validateFull(e, fields);
  await checkLinks(ctx, e, record);
  const { rows: clash } = await ctx.client.query(`select 1 from public.${e.table} where id = $1`, [id]);
  if (clash[0]) throw new HttpError(409, 'id_taken', 'This record id is already used.');

  const keys = Object.keys(record).filter((k) => record[k] !== undefined);
  await ctx.client.query(
    `insert into public.${e.table} (owner_id, id${keys.map((k) => `, ${k}`).join('')})
     values ($1, $2${keys.map((_, i) => `, $${i + 3}`).join('')})`,
    [ctx.owner, id, ...keys.map((k) => record[k])],
  );
  const row = await getRow(ctx.client, e, ctx.owner, String(id));
  const info = await e.afterWrite?.(ctx, null, row, extra);
  const saved = await getRow(ctx.client, e, ctx.owner, String(id)); // side effects may have changed it
  await audit(ctx.client, { ownerId: ctx.owner, actorUserId: ctx.actor, action: `${e.table}.created`, entityTable: e.table, entityId: saved.id, after: saved });
  return { ...saved, ...(info ?? {}) };
}

export async function updateCare(ctx: Ctx, e: CareEntity, id: string, version: number, patch: Record<string, unknown>) {
  const before = await getRow(ctx.client, e, ctx.owner, id, true);
  if (before.version !== version) {
    throw new HttpError(409, 'version_conflict', `This ${e.label.toLowerCase()} was changed elsewhere. Review the latest version.`, { current: before });
  }
  const fieldKeys = Object.keys(e.fields);
  const current = Object.fromEntries(fieldKeys.filter((k) => before[k] !== null && before[k] !== undefined).map((k) => [k, before[k]]));
  const merged = { ...current, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
  const record = validateFull(e, merged);
  await checkLinks(ctx, e, record);

  const changed = fieldKeys.filter((k) => k in patch && JSON.stringify(record[k] ?? null) !== JSON.stringify(before[k] ?? null));
  if (!changed.length) return before;
  await ctx.client.query(
    `update public.${e.table} set ${changed.map((k, i) => `${k} = $${i + 3}`).join(', ')} where owner_id = $1 and id = $2`,
    [ctx.owner, id, ...changed.map((k) => record[k] ?? null)],
  );
  const after = await getRow(ctx.client, e, ctx.owner, id);
  const info = await e.afterWrite?.(ctx, before, after, {});
  await audit(ctx.client, {
    ownerId: ctx.owner,
    actorUserId: ctx.actor,
    action: `${e.table}.updated`,
    entityTable: e.table,
    entityId: id,
    before: Object.fromEntries(changed.map((k) => [k, before[k]])),
    after: Object.fromEntries(changed.map((k) => [k, after[k]])),
  });
  return { ...(await getRow(ctx.client, e, ctx.owner, id)), ...(info ?? {}) };
}

export async function removeCare(ctx: Ctx, e: CareEntity, id: string, version: number, why: string) {
  const before = await getRow(ctx.client, e, ctx.owner, id, true);
  if (before.version !== version) {
    throw new HttpError(409, 'version_conflict', `This ${e.label.toLowerCase()} was changed elsewhere. Review the latest version.`, { current: before });
  }
  const { rows } = await ctx.client.query<Row>(
    `update public.${e.table} set deleted_at = now(), delete_reason = $3 where owner_id = $1 and id = $2 returning ${e.columns}`,
    [ctx.owner, id, why],
  );
  const after = Object.fromEntries(Object.entries(rows[0]).map(([k, v]) => [k, normalise(v)])) as Row;
  const info = await e.afterWrite?.(ctx, before, after, {});
  await audit(ctx.client, { ownerId: ctx.owner, actorUserId: ctx.actor, action: `${e.table}.removed`, entityTable: e.table, entityId: id, reason: why, before });
  return { ...after, ...(info ?? {}) };
}

export async function listCare(db: Queryable, e: CareEntity, owner: string, cattleId?: string) {
  const cattleField = e.links.find((l) => l.table === 'cattle' && (l.field === 'cattle_id' || l.field === 'dam_id'))?.field;
  const { rows } = await db.query(
    `select ${e.columns} from public.${e.table} where owner_id = $1 and deleted_at is null
     ${cattleId && cattleField ? `and ${cattleField} = $2` : ''} order by created_at desc`,
    cattleId && cattleField ? [owner, cattleId] : [owner],
  );
  return rows;
}
