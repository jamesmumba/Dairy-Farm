// Records that belong together, both ways: a health concern with its treatments, vet visits and the milk
// alert that led to it; a mating, its pregnancy check and the calving; a dose and its schedule.
// Pure, so it can be tested.

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
    case 'action':
      return one('health', care.health, r.health_record_id, 'Led to health concern');
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
        ...live(care.actions)
          .filter((a) => a.health_record_id === id)
          .map((a) => ({ kind: 'action' as const, id: a.id, title: 'From a milk alert' })),
      ];
    case 'pregnancy-check':
      return [
        ...one('breeding', care.breeding, r.breeding_record_id, 'For breeding'),
        ...calvingsAfter([id], care),
      ];
    case 'breeding': {
      const checks = live(care.checks).filter((c) => c.breeding_record_id === id);
      return [
        ...checks.map((c) => ({ kind: 'pregnancy-check' as const, id: c.id, title: 'Pregnancy check' })),
        ...calvingsAfter(checks.map((c) => c.id), care),
      ];
    }
    case 'calving': {
      const check = live(care.checks).find((c) => c.id === r.pregnancy_check_id);
      return [
        ...(check ? [{ kind: 'pregnancy-check' as const, id: check.id, title: 'From pregnancy check' }] : []),
        ...one('breeding', care.breeding, check?.breeding_record_id, 'From breeding'),
      ];
    }
    case 'vaccination':
      return one('schedule', care.schedules, r.schedule_id, 'Schedule');
    default:
      return [];
  }
}

const calvingsAfter = (checkIds: string[], care: CareData): Related[] =>
  live(care.calvings)
    .filter((c) => c.pregnancy_check_id && checkIds.includes(c.pregnancy_check_id))
    .map((c) => ({ kind: 'calving' as const, id: c.id, title: 'Calving' }));

/** Every record in one story with this one: the record, what it links to, and what links to it, followed through. */
export function storyOf(kind: CareKind, id: string, care: CareData): { kind: CareKind; id: string }[] {
  const seen = new Map<string, { kind: CareKind; id: string }>([[id, { kind, id }]]);
  const queue = [{ kind, id }];
  const all: Record<string, { id: string }[]> = {
    health: care.health, 'vet-visit': care.visits, treatment: care.treatments, breeding: care.breeding,
    'pregnancy-check': care.checks, calving: care.calvings, vaccination: care.vaccinations, schedule: care.schedules, action: care.actions,
  };
  while (queue.length) {
    const next = queue.shift()!;
    const row = all[next.kind]?.find((x) => x.id === next.id) as Record<string, unknown> | undefined;
    if (!row) continue;
    for (const r of relatedRecords(next.kind, row, care)) {
      if (r.kind === 'schedule' || seen.has(r.id)) continue; // a schedule is shared by the herd, not part of a story
      seen.set(r.id, { kind: r.kind, id: r.id });
      queue.push(r);
    }
  }
  return [...seen.values()];
}

/** What a treatment's withdrawal held back: milkings kept out of stock because of it. */
export function milkHeldBack(treatment: Treatment, treatments: Treatment[], milk: { cattle_id: string; production_date: string; session: keyof typeof SESSION_HOUR; quantity: string; restricted: boolean; status: string }[]) {
  const held = milk.filter(
    (m) => m.restricted && m.status === 'valid' && m.cattle_id === treatment.cattle_id && withdrawalCovering(treatments, m.cattle_id, m.production_date, m.session)?.id === treatment.id,
  );
  return { milkings: held.length, litres: held.reduce((sum, m) => sum + Number(m.quantity), 0) };
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
