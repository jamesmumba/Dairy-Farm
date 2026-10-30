// Records that belong together, both ways: a health concern and its treatments and vet visits, a
// mating and its pregnancy check, a dose and its schedule. Pure, so it can be tested.

import type { CareData, CareKind, Treatment } from './model';

export interface Related {
  kind: CareKind;
  id: string;
  /** How it relates, e.g. "For health concern", "Treatment". */
  title: string;
}

const live = <T extends { deleted_at: string | null }>(rows: T[]) => rows.filter((r) => !r.deleted_at);

export function relatedRecords(kind: CareKind, r: Record<string, unknown>, care: CareData): Related[] {
  const id = r.id as string;
  const one = (k: CareKind, rows: { id: string; deleted_at: string | null }[], linked: unknown, title: string): Related[] =>
    linked && live(rows).some((x) => x.id === linked) ? [{ kind: k, id: linked as string, title }] : [];
  switch (kind) {
    case 'treatment':
    case 'vet-visit':
      return one('health', care.health, r.health_record_id, 'For health concern');
    case 'health':
      return [
        ...live(care.treatments)
          .filter((t) => t.health_record_id === id)
          .sort((a, b) => a.started_on.localeCompare(b.started_on))
          .map((t) => ({ kind: 'treatment' as const, id: t.id, title: 'Treatment' })),
        ...live(care.visits)
          .filter((v) => v.health_record_id === id)
          .sort((a, b) => a.visit_at.localeCompare(b.visit_at))
          .map((v) => ({ kind: 'vet-visit' as const, id: v.id, title: 'Vet visit' })),
      ];
    case 'pregnancy-check':
      return one('breeding', care.breeding, r.breeding_record_id, 'For breeding');
    case 'breeding':
      return live(care.checks)
        .filter((c) => c.breeding_record_id === id)
        .map((c) => ({ kind: 'pregnancy-check' as const, id: c.id, title: 'Pregnancy check' }));
    case 'vaccination':
      return one('schedule', care.schedules, r.schedule_id, 'Schedule');
    default:
      return [];
  }
}

/** The nominal time of each milking, as the server uses it to decide whether milk is under withdrawal. */
export const SESSION_HOUR = { morning: '06', afternoon: '12', evening: '18' } as const;

/** The treatment whose milk withdrawal covers a milking: started by that day, ending after that milking. */
export function withdrawalCovering(treatments: Treatment[], cattleId: string, date: string, session: keyof typeof SESSION_HOUR) {
  const at = Date.parse(`${date}T${SESSION_HOUR[session]}:00:00`);
  return live(treatments)
    .filter((t) => t.cattle_id === cattleId && t.requires_milk_withdrawal && t.withdrawal_ends_at && t.started_on <= date && Date.parse(t.withdrawal_ends_at) > at)
    .sort((a, b) => Date.parse(b.withdrawal_ends_at!) - Date.parse(a.withdrawal_ends_at!))[0];
}
