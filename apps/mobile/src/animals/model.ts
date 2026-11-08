// Mirrors the cattle and cattle_breeds rows returned by the API (apps/api/src/cattle.ts).

export interface Breed {
  id: string;
  name: string;
  active: boolean;
  version: number;
}

export type Sex = 'female' | 'male';
export type AnimalStatus = 'active' | 'sold' | 'deceased' | 'transferred' | 'inactive';
export type ProductionStatus = 'calf' | 'heifer' | 'lactating' | 'dry' | 'not_applicable';
export type ReproductiveStatus = 'open' | 'bred' | 'pregnant' | 'not_applicable';

export interface Cattle {
  id: string;
  ear_tag: string | null;
  name: string | null;
  breed_id: string | null;
  sex: Sex;
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
  reproductive_status: ReproductiveStatus;
  production_status: ProductionStatus;
  photo_path: string | null;
  notes: string | null;
  status: AnimalStatus;
  status_date: string | null;
  status_details: string | null;
  /** Why it left the herd: a cause of death or a reason for sale (see DEATH_CAUSE_LABELS, SALE_REASON_LABELS). */
  status_reason?: string | null;
  /** The health concern that led to a death (or a sale for illness). */
  status_health_record_id?: string | null;
  deleted_at: string | null;
  version: number;
  created_at?: string;
  updated_at?: string;
  /** Local only: a photo taken on this phone that has not finished uploading. */
  local_photo_uri?: string;
}

/** Fields the farmer edits on the registration form. */
export type CattleFields = Omit<
  Cattle,
  | 'id'
  | 'photo_path'
  | 'status'
  | 'status_date'
  | 'status_details'
  | 'status_reason'
  | 'status_health_record_id'
  | 'deleted_at'
  | 'version'
  | 'created_at'
  | 'updated_at'
  | 'local_photo_uri'
>;

/** The farmer-visible permanent ID: first 6 characters of the UUID. Exists offline, never changes. */
export const shortCode = (id: string) => id.replace(/-/g, '').slice(0, 6).toUpperCase();

/** Causes of death, as categories so deaths can be counted by cause. */
export const DEATH_CAUSE_LABELS = {
  illness: 'Illness',
  calving: 'Calving problems',
  injury: 'Injury or accident',
  poisoning: 'Poisoning',
  predator_theft: 'Predator or theft',
  old_age: 'Old age',
  unknown: 'Not known',
  other: 'Other',
} as const;

/** Reasons for selling, so culling can be counted by reason. */
export const SALE_REASON_LABELS = {
  low_yield: 'Low milk yield',
  infertility: 'Not getting in calf',
  old_age: 'Old age',
  illness: 'Illness',
  surplus: 'Surplus to the herd',
  needed_money: 'Farm needed money',
  other: 'Other',
} as const;

export const STATUS_LABELS: Record<AnimalStatus, string> = {
  active: 'Active',
  sold: 'Sold',
  deceased: 'Deceased',
  transferred: 'Transferred',
  inactive: 'Inactive',
};

export const PRODUCTION_LABELS: Record<ProductionStatus, string> = {
  calf: 'Calf',
  heifer: 'Heifer',
  lactating: 'In milk',
  dry: 'Dry',
  not_applicable: 'Not applicable',
};

export const REPRODUCTIVE_LABELS: Record<ReproductiveStatus, string> = {
  open: 'Open (not pregnant)',
  bred: 'Bred, not yet checked',
  pregnant: 'Pregnant (confirmed)',
  not_applicable: 'Not applicable',
};

/** Age in whole months from the birth date, or null if unknown. */
export function ageInMonths(birthDate: string | null, today = new Date()) {
  if (!birthDate) return null;
  const [y, m, d] = birthDate.split('-').map(Number);
  let months = (today.getFullYear() - y) * 12 + (today.getMonth() + 1 - m);
  if (today.getDate() < d) months--;
  return Math.max(0, months);
}

export function ageLabel(a: Pick<Cattle, 'birth_date' | 'birth_date_estimated'>) {
  const months = ageInMonths(a.birth_date);
  if (months === null) return 'Age unknown';
  const text = months < 24 ? `${months} month${months === 1 ? '' : 's'}` : `${Math.floor(months / 12)} years`;
  return a.birth_date_estimated ? `about ${text}` : text;
}

export const AGE_BANDS = [
  { value: 'under1', label: 'Under 1 year', test: (m: number) => m < 12 },
  { value: '1to2', label: '1–2 years', test: (m: number) => m >= 12 && m < 24 },
  { value: '2plus', label: '2 years and over', test: (m: number) => m >= 24 },
] as const;

export interface AnimalFilter {
  query: string;
  status: 'active' | 'retired' | 'all';
  sex: Sex | null;
  breedId: string | null;
  production: ProductionStatus | null;
  reproductive: ReproductiveStatus | null;
  age: (typeof AGE_BANDS)[number]['value'] | 'unknown' | null;
}

export const EMPTY_FILTER: AnimalFilter = { query: '', status: 'active', sex: null, breedId: null, production: null, reproductive: null, age: null };

export function matches(a: Cattle, f: AnimalFilter) {
  const q = f.query.trim().toLowerCase();
  if (q && ![shortCode(a.id), a.ear_tag ?? '', a.name ?? ''].some((v) => v.toLowerCase().includes(q))) return false;
  if (f.status === 'active' && a.status !== 'active') return false;
  if (f.status === 'retired' && a.status === 'active') return false;
  if (f.sex && a.sex !== f.sex) return false;
  if (f.breedId && a.breed_id !== f.breedId) return false;
  if (f.production && a.production_status !== f.production) return false;
  if (f.reproductive && a.reproductive_status !== f.reproductive) return false;
  if (f.age) {
    const months = ageInMonths(a.birth_date);
    if (f.age === 'unknown') return months === null;
    if (months === null || !AGE_BANDS.find((b) => b.value === f.age)!.test(months)) return false;
  }
  return true;
}

/**
 * The ear tag offered for a new animal: C001, C002… one past the highest C-number in the herd, skipping any
 * tag already used (in any letter case). Past C999 it carries on as C1000. The farmer can change or clear it.
 */
export function nextEarTag(animals: Pick<Cattle, 'ear_tag'>[]) {
  const taken = new Set(animals.map((a) => a.ear_tag?.trim().toUpperCase()).filter(Boolean));
  const highest = Math.max(0, ...[...taken].map((t) => /^C(\d+)$/.exec(t!)?.[1]).filter(Boolean).map(Number));
  let n = highest + 1;
  while (taken.has(`C${String(n).padStart(3, '0')}`)) n++;
  return `C${String(n).padStart(3, '0')}`;
}

/** The label the farmer sees for an animal everywhere: tag and name, falling back to the ID. */
export function displayName(a: Pick<Cattle, 'id' | 'ear_tag' | 'name'>) {
  return [a.ear_tag, a.name].filter(Boolean).join(' · ') || `Untagged ${shortCode(a.id)}`;
}
