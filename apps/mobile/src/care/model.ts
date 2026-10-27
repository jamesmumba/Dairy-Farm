// Mirrors the care rows returned by the API (apps/api/src/care.ts).

interface Common {
  id: string;
  deleted_at: string | null;
  delete_reason: string | null;
  version: number;
  created_at?: string;
  updated_at?: string;
}

export interface HealthRecord extends Common {
  cattle_id: string;
  first_symptoms_on: string | null;
  reported_on: string;
  observations: string | null;
  suspected_issue: string | null;
  confirmed_diagnosis: string | null;
  condition_status: 'suspected' | 'confirmed' | 'ruled_out';
  severity: 'low' | 'moderate' | 'high' | 'critical' | null;
  urgent: boolean;
  responsible_person: string | null;
  follow_up_on: string | null;
  recovery_status: 'ongoing' | 'recovering' | 'recovered' | 'chronic' | 'died';
  notes: string | null;
}

export interface VetVisit extends Common {
  cattle_id: string;
  health_record_id: string | null;
  visit_at: string;
  veterinarian: string | null;
  purpose: string | null;
  findings: string | null;
  notes: string | null;
}

export interface Treatment extends Common {
  cattle_id: string;
  health_record_id: string | null;
  medication: string;
  dosage_instructions: string | null;
  administered_by: string | null;
  started_on: string;
  completed_on: string | null;
  requires_milk_withdrawal: boolean;
  withdrawal_period_text: string | null;
  withdrawal_ends_at: string | null;
  withdrawal_source: string | null;
  withdrawal_cleared_at: string | null;
  withdrawal_clearance_note: string | null;
  notes: string | null;
  milk_entries_rechecked?: number;
}

export interface BreedingRecord extends Common {
  cattle_id: string;
  event_type: 'heat_observed' | 'natural_mating' | 'artificial_insemination';
  event_at: string;
  bull_or_semen_id: string | null;
  performed_by: string | null;
  notes: string | null;
}

export interface PregnancyCheck extends Common {
  cattle_id: string;
  breeding_record_id: string | null;
  scheduled_on: string | null;
  examined_on: string | null;
  result: 'pending' | 'pregnant' | 'not_pregnant' | 'inconclusive';
  examiner: string | null;
  expected_calving_on: string | null;
  notes: string | null;
}

export interface CalvingRecord extends Common {
  dam_id: string;
  calf_id: string | null;
  calved_on: string;
  outcome: 'live' | 'stillborn' | 'aborted' | 'other';
  complications: string | null;
  dry_off_on: string | null;
  observations: string | null;
}

export interface VaccinationSchedule extends Common {
  vaccine_name: string;
  target_disease: string | null;
  interval_days: number | null;
  reminder_offsets_days: number[];
  guidance_source: string | null;
  active: boolean;
}

export interface Vaccination extends Common {
  cattle_id: string;
  schedule_id: string | null;
  vaccine_name: string;
  target_disease: string | null;
  due_on: string | null;
  administered_on: string | null;
  status: 'scheduled' | 'completed' | 'missed' | 'cancelled';
  batch_number: string | null;
  dosage_as_directed: string | null;
  administered_by: string | null;
  next_due_on: string | null;
  is_booster: boolean;
  group_batch_id: string | null;
  group_label: string | null;
  group_definition: string | null;
  notes: string | null;
}

/** URL segment and local entity (= table) of each care record type. */
export const CARE_KINDS = {
  health: { entity: 'animal_health_records', path: 'health-records', label: 'Health concern' },
  'vet-visit': { entity: 'veterinary_visits', path: 'vet-visits', label: 'Vet visit' },
  treatment: { entity: 'treatments', path: 'treatments', label: 'Treatment' },
  breeding: { entity: 'breeding_records', path: 'breeding', label: 'Heat or breeding' },
  'pregnancy-check': { entity: 'pregnancy_checks', path: 'pregnancy-checks', label: 'Pregnancy check' },
  calving: { entity: 'calving_records', path: 'calvings', label: 'Calving' },
  vaccination: { entity: 'vaccination_records', path: 'vaccinations', label: 'Vaccination' },
  schedule: { entity: 'vaccination_schedules', path: 'vaccination-schedules', label: 'Vaccination schedule' },
} as const;

export type CareKind = keyof typeof CARE_KINDS;

export const kindOfEntity = (entity: string) => (Object.keys(CARE_KINDS) as CareKind[]).find((k) => CARE_KINDS[k].entity === entity);

export interface CareData {
  health: HealthRecord[];
  visits: VetVisit[];
  treatments: Treatment[];
  breeding: BreedingRecord[];
  checks: PregnancyCheck[];
  calvings: CalvingRecord[];
  vaccinations: Vaccination[];
  schedules: VaccinationSchedule[];
}

/** A milk withdrawal still in force at `now` (the vet's end time not yet reached). */
export function activeWithdrawal(treatments: Treatment[], cattleId: string, now = new Date()) {
  return treatments
    .filter((t) => t.cattle_id === cattleId && !t.deleted_at && t.requires_milk_withdrawal && t.withdrawal_ends_at && Date.parse(t.withdrawal_ends_at) > now.getTime())
    .sort((a, b) => Date.parse(b.withdrawal_ends_at!) - Date.parse(a.withdrawal_ends_at!))[0];
}

/** Treatment started and not yet completed. */
export const underTreatment = (treatments: Treatment[], cattleId: string, today: string) =>
  treatments.some((t) => t.cattle_id === cattleId && !t.deleted_at && t.started_on <= today && (!t.completed_on || t.completed_on >= today));

export const EVENT_LABELS = { heat_observed: 'Heat observed', natural_mating: 'Natural mating', artificial_insemination: 'Artificial insemination' } as const;
export const RESULT_LABELS = { pending: 'Not yet examined', pregnant: 'Pregnant', not_pregnant: 'Not pregnant', inconclusive: 'Inconclusive' } as const;
