import { randomUUID } from 'expo-crypto';
import type { Cattle } from '../animals/model';
import { formatDate, formatDateTime } from '../lib/dates';
import {
  ACTION_LABELS,
  type AlertAction,
  ALERT_TYPE_LABELS,
  type BreedingRecord,
  type CareData,
  type CareKind,
  EVENT_LABELS,
  type HealthRecord,
  type PregnancyCheck,
  RESULT_LABELS,
  type Treatment,
  type Vaccination,
  type VaccinationSchedule,
} from './model';

// Each care record type is described once as fields; one generic form renders all of them.

export type FormValues = Record<string, string | boolean>;

export interface FieldDef {
  key: string;
  label: string;
  type: 'text' | 'multiline' | 'date' | 'datetime' | 'bool' | 'choice' | 'animal' | 'int' | 'ints' | 'link';
  hint?: string;
  required?: boolean;
  allowFuture?: boolean;
  options?: readonly { value: string; label: string }[];
  sex?: 'female';
  link?: CareKind;
  showIf?: (v: FormValues) => boolean;
  /** Only when creating (e.g. registering the calf); not a column of the record. */
  createOnly?: boolean;
}

export interface FormContext {
  today: string;
  now: string;
  care: CareData;
  animals: Cattle[];
  intervals: { pregnancy_check_days: number; gestation_days: number };
}

export interface CareFormConfig {
  kind: CareKind;
  intro?: string;
  fields: FieldDef[];
  defaults: (ctx: FormContext) => FormValues;
  check?: (v: FormValues) => [string, string] | null;
  /** Prefills that follow from a change, e.g. the vaccine name from a schedule. */
  onChange?: (key: string, v: FormValues, ctx: FormContext) => FormValues;
  createOnly?: (v: FormValues) => Record<string, unknown>;
  summary: (row: any, ctx: Pick<FormContext, 'care'>) => string;
}

const opts = <T extends Record<string, string>>(labels: T) => Object.entries(labels).map(([value, label]) => ({ value, label }));
const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const s = (v: FormValues, k: string) => (typeof v[k] === 'string' ? (v[k] as string) : '');

// --- Values <-> record ----------------------------------------------------------

export function toBody(config: CareFormConfig, v: FormValues): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const f of config.fields) {
    if (f.createOnly) continue;
    const raw = v[f.key];
    if (f.type === 'bool') body[f.key] = !!raw;
    else if (f.type === 'int') body[f.key] = raw === '' || raw === undefined ? null : Number(raw);
    else if (f.type === 'ints') body[f.key] = String(raw ?? '').split(',').map((x) => x.trim()).filter(Boolean).map(Number);
    else body[f.key] = typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;
  }
  return body;
}

export function fromRecord(config: CareFormConfig, row: Record<string, unknown>): FormValues {
  const v: FormValues = {};
  for (const f of config.fields) {
    if (f.createOnly) continue;
    const raw = row[f.key];
    v[f.key] = f.type === 'bool' ? !!raw : f.type === 'ints' ? ((raw as number[] | null) ?? []).join(', ') : raw === null || raw === undefined ? '' : String(raw);
  }
  return v;
}

/** Required fields, number formats and the entity's own rule. Returns [field, message] or null. */
export function validate(config: CareFormConfig, v: FormValues): [string, string] | null {
  for (const f of config.fields) {
    if (f.showIf && !f.showIf(v)) continue;
    const raw = v[f.key];
    if (f.required && (raw === '' || raw === undefined)) return [f.key, `${f.label}: required`];
    if (f.type === 'int' && raw && !/^\d+$/.test(String(raw))) return [f.key, `${f.label}: whole number`];
    if (f.type === 'ints' && raw && !/^\s*\d+(\s*,\s*\d+)*\s*$/.test(String(raw))) return [f.key, `${f.label}: numbers separated by commas`];
  }
  return config.check?.(v) ?? null;
}

// --- Choices -----------------------------------------------------------------------

const CONDITION = { suspected: 'Suspected', confirmed: 'Confirmed by vet', ruled_out: 'Ruled out' } as const;
const SEVERITY = { low: 'Low', moderate: 'Moderate', high: 'High', critical: 'Critical' } as const;
const RECOVERY = { ongoing: 'Ongoing', recovering: 'Recovering', recovered: 'Recovered', chronic: 'Chronic', died: 'Died' } as const;
const OUTCOME = { live: 'Live calf', stillborn: 'Stillborn', aborted: 'Aborted', other: 'Other' } as const;
const VACC_STATUS = { completed: 'Given', scheduled: 'Planned (due)', missed: 'Missed', cancelled: 'Cancelled' } as const;

// --- Entities ------------------------------------------------------------------------

const health: CareFormConfig = {
  kind: 'health',
  intro: 'Record what you see and what the vet says. The app does not diagnose.',
  fields: [
    { key: 'cattle_id', label: 'Animal', type: 'animal', required: true },
    { key: 'reported_on', label: 'Reported on', type: 'date', required: true },
    { key: 'first_symptoms_on', label: 'First symptoms on', type: 'date' },
    { key: 'suspected_issue', label: 'Suspected problem', type: 'text', hint: 'What you think it might be' },
    { key: 'condition_status', label: 'Diagnosis', type: 'choice', options: opts(CONDITION), required: true },
    { key: 'confirmed_diagnosis', label: 'Confirmed diagnosis', type: 'text', hint: 'As confirmed by the vet', showIf: (v) => v.condition_status === 'confirmed' },
    { key: 'severity', label: 'Severity', type: 'choice', options: opts(SEVERITY) },
    { key: 'urgent', label: 'Urgent', type: 'bool', hint: 'Shown at the top of the animal’s profile' },
    { key: 'observations', label: 'Observations', type: 'multiline' },
    { key: 'responsible_person', label: 'Vet or person attending', type: 'text' },
    { key: 'follow_up_on', label: 'Follow up on', type: 'date', allowFuture: true },
    { key: 'recovery_status', label: 'Recovery', type: 'choice', options: opts(RECOVERY), required: true },
    { key: 'notes', label: 'Notes', type: 'multiline' },
  ],
  defaults: ({ today }) => ({ reported_on: today, condition_status: 'suspected', recovery_status: 'ongoing', urgent: false }),
  check: (v) =>
    v.condition_status === 'confirmed' && !s(v, 'confirmed_diagnosis').trim()
      ? ['confirmed_diagnosis', 'Enter the diagnosis the vet confirmed']
      : s(v, 'first_symptoms_on') && s(v, 'first_symptoms_on') > s(v, 'reported_on')
        ? ['first_symptoms_on', 'First symptoms cannot be after the report date']
        : null,
  summary: (r: HealthRecord) =>
    `${r.confirmed_diagnosis ?? r.suspected_issue ?? 'Health concern'} · ${CONDITION[r.condition_status]} · ${RECOVERY[r.recovery_status]}${r.urgent ? ' · urgent' : ''}`,
};

const vetVisit: CareFormConfig = {
  kind: 'vet-visit',
  fields: [
    { key: 'cattle_id', label: 'Animal', type: 'animal', required: true },
    { key: 'visit_at', label: 'Visit', type: 'datetime', required: true },
    { key: 'veterinarian', label: 'Veterinarian', type: 'text' },
    { key: 'purpose', label: 'Reason for the visit', type: 'text' },
    { key: 'health_record_id', label: 'Related health concern', type: 'link', link: 'health' },
    { key: 'findings', label: 'Findings', type: 'multiline' },
    { key: 'notes', label: 'Notes', type: 'multiline' },
  ],
  defaults: ({ now }) => ({ visit_at: now }),
  summary: (r) => `Vet visit${r.veterinarian ? `: ${r.veterinarian}` : ''} · ${formatDateTime(r.visit_at)}`,
};

const treatment: CareFormConfig = {
  kind: 'treatment',
  intro: 'Record the treatment and withdrawal exactly as your vet instructed. The app does not recommend medicines, calculate doses or set withdrawal periods.',
  fields: [
    { key: 'cattle_id', label: 'Animal', type: 'animal', required: true },
    { key: 'health_record_id', label: 'For health concern', type: 'link', link: 'health' },
    { key: 'medication', label: 'Medicine', type: 'text', required: true },
    { key: 'dosage_instructions', label: 'Dosage and instructions', type: 'multiline', hint: 'As written by the vet' },
    { key: 'administered_by', label: 'Given by', type: 'text' },
    { key: 'started_on', label: 'Started on', type: 'date', required: true },
    { key: 'completed_on', label: 'Completed on', type: 'date' },
    { key: 'requires_milk_withdrawal', label: 'Milk withdrawal required', type: 'bool', hint: 'Milk is not for sale or human use until the vet’s end time' },
    { key: 'withdrawal_period_text', label: 'Withdrawal period (as stated by the vet)', type: 'text', hint: 'e.g. 72 hours after the last dose', showIf: (v) => !!v.requires_milk_withdrawal },
    { key: 'withdrawal_ends_at', label: 'Withdrawal ends', type: 'datetime', allowFuture: true, hint: 'The exact date and time from the vet', showIf: (v) => !!v.requires_milk_withdrawal },
    { key: 'withdrawal_source', label: 'Source of the withdrawal instruction', type: 'text', hint: 'e.g. Dr Banda, medicine leaflet', showIf: (v) => !!v.requires_milk_withdrawal },
    { key: 'withdrawal_cleared_at', label: 'Clearance confirmed at', type: 'datetime', hint: 'If your vet requires confirmation before milk is used', showIf: (v) => !!v.requires_milk_withdrawal && !!v.withdrawal_ends_at },
    { key: 'withdrawal_clearance_note', label: 'Clearance note', type: 'text', showIf: (v) => !!v.withdrawal_cleared_at },
    { key: 'notes', label: 'Notes', type: 'multiline' },
  ],
  defaults: ({ today }) => ({ started_on: today, requires_milk_withdrawal: false }),
  check: (v) => {
    if (s(v, 'completed_on') && s(v, 'completed_on') < s(v, 'started_on')) return ['completed_on', 'Completion cannot be before the start'];
    if (v.requires_milk_withdrawal && !s(v, 'withdrawal_ends_at')) return ['withdrawal_ends_at', 'Enter the withdrawal end date and time given by the vet'];
    if (v.requires_milk_withdrawal && s(v, 'withdrawal_ends_at').slice(0, 10) < s(v, 'started_on')) return ['withdrawal_ends_at', 'Withdrawal cannot end before the treatment started'];
    if (s(v, 'withdrawal_cleared_at') && Date.parse(s(v, 'withdrawal_cleared_at')) < Date.parse(s(v, 'withdrawal_ends_at'))) {
      return ['withdrawal_cleared_at', 'Milk cannot be cleared before the withdrawal ends'];
    }
    return null;
  },
  summary: (r: Treatment) =>
    `${r.medication} · from ${formatDate(r.started_on)}${r.completed_on ? ` to ${formatDate(r.completed_on)}` : ', ongoing'}${
      r.requires_milk_withdrawal && r.withdrawal_ends_at ? ` · withdrawal until ${formatDateTime(r.withdrawal_ends_at)}` : ''
    }`,
};

const breeding: CareFormConfig = {
  kind: 'breeding',
  intro: 'Mating or insemination never marks a cow pregnant. A pregnancy check is scheduled from your interval in Settings; the result of that check sets the pregnancy.',
  fields: [
    { key: 'cattle_id', label: 'Cow', type: 'animal', sex: 'female', required: true },
    { key: 'event_type', label: 'Event', type: 'choice', options: opts(EVENT_LABELS), required: true },
    { key: 'event_at', label: 'When', type: 'datetime', required: true },
    { key: 'bull_or_semen_id', label: 'Bull or semen ID', type: 'text', showIf: (v) => v.event_type !== 'heat_observed' },
    { key: 'performed_by', label: 'Done by', type: 'text', showIf: (v) => v.event_type !== 'heat_observed' },
    { key: 'notes', label: 'Notes', type: 'multiline' },
  ],
  defaults: ({ now }) => ({ event_type: 'artificial_insemination', event_at: now }),
  summary: (r: BreedingRecord) => `${EVENT_LABELS[r.event_type]}${r.bull_or_semen_id ? ` · ${r.bull_or_semen_id}` : ''} · ${formatDateTime(r.event_at)}`,
};

/** Expected calving from the linked breeding + the farmer's gestation interval. */
function expectedCalving(v: FormValues, ctx: FormContext) {
  const b = ctx.care.breeding.find((x) => x.id === v.breeding_record_id);
  return b ? addDays(b.event_at.slice(0, 10), ctx.intervals.gestation_days) : '';
}

const pregnancyCheck: CareFormConfig = {
  kind: 'pregnancy-check',
  fields: [
    { key: 'cattle_id', label: 'Cow', type: 'animal', sex: 'female', required: true },
    { key: 'breeding_record_id', label: 'For breeding', type: 'link', link: 'breeding' },
    { key: 'scheduled_on', label: 'Planned for', type: 'date', allowFuture: true },
    { key: 'result', label: 'Result', type: 'choice', options: opts(RESULT_LABELS), required: true },
    { key: 'examined_on', label: 'Examined on', type: 'date', showIf: (v) => v.result !== 'pending' },
    { key: 'examiner', label: 'Examined by', type: 'text', showIf: (v) => v.result !== 'pending' },
    {
      key: 'expected_calving_on',
      label: 'Expected calving',
      type: 'date',
      allowFuture: true,
      hint: 'From the vet. Prefilled from the breeding date and your gestation interval; confirm with your vet.',
      showIf: (v) => v.result === 'pregnant',
    },
    { key: 'notes', label: 'Notes', type: 'multiline' },
  ],
  defaults: ({ today }) => ({ result: 'pending', scheduled_on: today }),
  onChange: (key, v, ctx): FormValues =>
    (key === 'result' || key === 'breeding_record_id') && v.result === 'pregnant' && !v.expected_calving_on ? { expected_calving_on: expectedCalving(v, ctx) } : {},
  check: (v) =>
    v.result !== 'pending' && !s(v, 'examined_on')
      ? ['examined_on', 'Enter the examination date']
      : !s(v, 'scheduled_on') && !s(v, 'examined_on')
        ? ['scheduled_on', 'Enter when the check is planned or was done']
        : null,
  summary: (r: PregnancyCheck) =>
    r.result === 'pending'
      ? `Pregnancy check planned for ${formatDate(r.scheduled_on)}`
      : `${RESULT_LABELS[r.result]} · ${formatDate(r.examined_on)}${r.expected_calving_on ? ` · calving expected ${formatDate(r.expected_calving_on)}` : ''}`,
};

const calving: CareFormConfig = {
  kind: 'calving',
  fields: [
    { key: 'dam_id', label: 'Mother', type: 'animal', sex: 'female', required: true },
    { key: 'calved_on', label: 'Calved on', type: 'date', required: true },
    { key: 'outcome', label: 'Outcome', type: 'choice', options: opts(OUTCOME), required: true },
    { key: 'register_calf', label: 'Register the calf as a new animal', type: 'bool', createOnly: true, showIf: (v) => v.outcome === 'live' },
    { key: 'calf_sex', label: 'Calf sex', type: 'choice', options: [{ value: 'female', label: 'Female' }, { value: 'male', label: 'Male' }], createOnly: true, showIf: (v) => v.outcome === 'live' && !!v.register_calf },
    { key: 'calf_ear_tag', label: 'Calf ear tag (optional)', type: 'text', createOnly: true, showIf: (v) => v.outcome === 'live' && !!v.register_calf },
    { key: 'calf_name', label: 'Calf name (optional)', type: 'text', createOnly: true, showIf: (v) => v.outcome === 'live' && !!v.register_calf },
    { key: 'complications', label: 'Complications', type: 'multiline' },
    { key: 'dry_off_on', label: 'Dried off on', type: 'date', hint: 'If the cow was dried off before calving' },
    { key: 'observations', label: 'Observations', type: 'multiline' },
  ],
  defaults: ({ today }) => ({ calved_on: today, outcome: 'live', register_calf: true, calf_sex: 'female' }),
  createOnly: (v) =>
    v.outcome === 'live' && v.register_calf
      ? { calf: { id: randomUUID(), sex: s(v, 'calf_sex') || 'female', ear_tag: s(v, 'calf_ear_tag').trim() || null, name: s(v, 'calf_name').trim() || null } }
      : {},
  summary: (r) => `Calving · ${OUTCOME[r.outcome as keyof typeof OUTCOME]} · ${formatDate(r.calved_on)}`,
};

const vaccination: CareFormConfig = {
  kind: 'vaccination',
  fields: [
    { key: 'cattle_id', label: 'Animal', type: 'animal', required: true },
    { key: 'schedule_id', label: 'Schedule', type: 'link', link: 'schedule' },
    { key: 'vaccine_name', label: 'Vaccine', type: 'text', required: true },
    { key: 'target_disease', label: 'Against (disease)', type: 'text' },
    { key: 'status', label: 'Status', type: 'choice', options: opts(VACC_STATUS), required: true },
    { key: 'due_on', label: 'Due on', type: 'date', allowFuture: true },
    { key: 'administered_on', label: 'Given on', type: 'date', showIf: (v) => v.status === 'completed' },
    { key: 'batch_number', label: 'Batch number', type: 'text', showIf: (v) => v.status === 'completed' },
    { key: 'dosage_as_directed', label: 'Dose as directed', type: 'text', hint: 'As directed by the vet or the vaccine label', showIf: (v) => v.status === 'completed' },
    { key: 'administered_by', label: 'Given by', type: 'text', showIf: (v) => v.status === 'completed' },
    { key: 'next_due_on', label: 'Next dose due', type: 'date', allowFuture: true, hint: 'A reminder is scheduled for it', showIf: (v) => v.status === 'completed' },
    { key: 'is_booster', label: 'Booster dose', type: 'bool' },
    { key: 'notes', label: 'Notes', type: 'multiline' },
  ],
  defaults: ({ today }) => ({ status: 'completed', administered_on: today, is_booster: false }),
  onChange: (key, v, ctx) => {
    const schedule = ctx.care.schedules.find((x) => x.id === v.schedule_id);
    const patch: FormValues = {};
    if (key === 'schedule_id' && schedule) {
      patch.vaccine_name = schedule.vaccine_name;
      patch.target_disease = schedule.target_disease ?? '';
    }
    const given = s(v, 'administered_on');
    if (schedule?.interval_days && given && v.status === 'completed' && !v.next_due_on && ['schedule_id', 'administered_on', 'status'].includes(key)) {
      patch.next_due_on = addDays(given, schedule.interval_days);
    }
    return patch;
  },
  check: (v) =>
    v.status === 'completed' && !s(v, 'administered_on')
      ? ['administered_on', 'Enter the date the dose was given']
      : !s(v, 'due_on') && !s(v, 'administered_on')
        ? ['due_on', 'Enter the due date or the date given']
        : s(v, 'next_due_on') && s(v, 'administered_on') && s(v, 'next_due_on') <= s(v, 'administered_on')
          ? ['next_due_on', 'The next dose must be after this one']
          : null,
  summary: (r: Vaccination) =>
    `${r.vaccine_name} · ${VACC_STATUS[r.status]}${r.administered_on ? ` ${formatDate(r.administered_on)}` : r.due_on ? ` · due ${formatDate(r.due_on)}` : ''}${r.group_label ? ` · group: ${r.group_label}` : ''}`,
};

const schedule: CareFormConfig = {
  kind: 'schedule',
  intro: 'Enter schedules from current veterinary guidance and Zambian livestock requirements. The app has no built-in vaccination calendar.',
  fields: [
    { key: 'vaccine_name', label: 'Vaccine', type: 'text', required: true },
    { key: 'target_disease', label: 'Against (disease)', type: 'text' },
    { key: 'interval_days', label: 'Days between doses', type: 'int', hint: 'From your vet or the vaccine guidance' },
    { key: 'reminder_offsets_days', label: 'Remind me (days before due)', type: 'ints', hint: 'Separated by commas, e.g. 30, 7, 1' },
    { key: 'guidance_source', label: 'Source of this schedule', type: 'text', hint: 'e.g. your vet, DVS circular' },
    { key: 'active', label: 'In use', type: 'bool' },
  ],
  defaults: () => ({ reminder_offsets_days: '30, 7, 1', active: true }),
  summary: (r: VaccinationSchedule) =>
    `${r.vaccine_name}${r.interval_days ? ` · every ${r.interval_days} days` : ''}${r.active ? '' : ' · not in use'}`,
};

const ACTION_STATUS = { monitoring: 'Still watching her', resolved: 'Resolved' } as const;

const action: CareFormConfig = {
  kind: 'action',
  intro: 'Record what you did about the alert. While you are still watching her, the alert waits until the follow-up date.',
  fields: [
    { key: 'cattle_id', label: 'Animal', type: 'animal', required: true },
    { key: 'alert_type', label: 'Alert', type: 'choice', options: opts(ALERT_TYPE_LABELS), required: true },
    { key: 'alert_reason', label: 'What the alert said', type: 'text' },
    { key: 'action_taken', label: 'What you did', type: 'choice', options: opts(ACTION_LABELS), required: true },
    { key: 'action_on', label: 'Done on', type: 'date', required: true },
    { key: 'notes', label: 'What you found', type: 'multiline', hint: 'e.g. water trough blocked, udder hot, record was typed wrong' },
    { key: 'status', label: 'Now', type: 'choice', options: opts(ACTION_STATUS), required: true },
    { key: 'follow_up_on', label: 'Check on her again on', type: 'date', allowFuture: true, showIf: (v) => v.status !== 'resolved' },
    { key: 'resolved_on', label: 'Resolved on', type: 'date', showIf: (v) => v.status === 'resolved' },
    { key: 'outcome', label: 'Outcome', type: 'multiline', showIf: (v) => v.status === 'resolved' },
  ],
  defaults: ({ today }) => ({ alert_type: 'other', action_taken: 'observed', action_on: today, status: 'monitoring', follow_up_on: addDays(today, 3) }),
  onChange: (key, v, { today }): FormValues => (key === 'status' && v.status === 'resolved' && !v.resolved_on ? { resolved_on: today } : {}),
  check: (v) =>
    v.status !== 'resolved' && !s(v, 'follow_up_on')
      ? ['follow_up_on', 'Choose when to check on her again']
      : v.status === 'resolved' && !s(v, 'resolved_on')
        ? ['resolved_on', 'Enter when it was resolved']
        : v.status === 'resolved' && s(v, 'resolved_on') < s(v, 'action_on')
          ? ['resolved_on', 'It cannot be resolved before the action was taken']
          : null,
  summary: (r: AlertAction) =>
    `${ACTION_LABELS[r.action_taken]} · ${ALERT_TYPE_LABELS[r.alert_type].toLowerCase()} · ${
      r.status === 'resolved' ? `resolved ${formatDate(r.resolved_on)}` : `follow up ${formatDate(r.follow_up_on)}`
    }`,
};

export const CARE_FORMS: Record<CareKind, CareFormConfig> = {
  health,
  'vet-visit': vetVisit,
  treatment,
  breeding,
  'pregnancy-check': pregnancyCheck,
  calving,
  vaccination,
  schedule,
  action,
};
