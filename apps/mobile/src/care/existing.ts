// "This looks already recorded": before a care record is saved, the record it may repeat. The farmer
// is asked (open it, or save anyway), never blocked, since real repeats happen. Pure, so it can be tested.

import { formatDate } from '../lib/dates';
import type { CareData, CareKind } from './model';

export interface Existing {
  kind: CareKind;
  id: string;
  /** What is already there, e.g. "Daisy already has FMD booked for 04/11/2026." */
  message: string;
}

const live = <T extends { deleted_at: string | null }>(rows: T[]) => rows.filter((r) => !r.deleted_at);
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();
const day = (iso: unknown) => String(iso ?? '').slice(0, 10);
const daysApart = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

/** How close two doses of the same vaccine, or two calvings, have to be to look like one. */
const DOSE_WINDOW_DAYS = 14;
const CALVING_WINDOW_DAYS = 30;

/**
 * The record a new one may repeat, if any. `fields` is what the form is about to save; `name` is the
 * animal's display name, used in the message.
 */
export function findExisting(kind: CareKind, fields: Record<string, unknown>, care: CareData, name: string, today: string): Existing | null {
  const cow = (fields.cattle_id ?? fields.dam_id) as string | undefined;
  switch (kind) {
    case 'vaccination': {
      const when = day(fields.administered_on ?? fields.due_on);
      const v = live(care.vaccinations).find(
        (x) =>
          x.cattle_id === cow &&
          norm(x.vaccine_name) === norm(fields.vaccine_name) &&
          (x.status === 'scheduled' || x.status === 'completed') &&
          daysApart(x.administered_on ?? x.due_on ?? '', when) <= DOSE_WINDOW_DAYS,
      );
      if (!v) return null;
      return {
        kind,
        id: v.id,
        message:
          v.status === 'scheduled'
            ? `${name} already has ${v.vaccine_name} booked for ${formatDate(v.due_on)}. If you gave that dose, open it and tap Given instead.`
            : `${name} was already given ${v.vaccine_name} on ${formatDate(v.administered_on)}.`,
      };
    }
    case 'pregnancy-check': {
      const c = live(care.checks).find((x) => x.cattle_id === cow && x.result === 'pending');
      if (!c) return null;
      return {
        kind,
        id: c.id,
        message: `${name} already has a pregnancy check ${c.scheduled_on ? `planned for ${formatDate(c.scheduled_on)}` : 'waiting for a result'}${fields.result && fields.result !== 'pending' ? '. Open it to record this result there' : ''}.`,
      };
    }
    case 'health': {
      const issue = norm(fields.confirmed_diagnosis ?? fields.suspected_issue);
      const open = live(care.health).filter((h) => h.cattle_id === cow && !['recovered', 'died'].includes(h.recovery_status));
      // The same issue still open, or (with no issue named) any concern reported in the last 3 days.
      const h = issue
        ? open.find((x) => norm(x.confirmed_diagnosis) === issue || norm(x.suspected_issue) === issue)
        : open.find((x) => daysApart(x.reported_on, day(fields.reported_on) || today) <= 3);
      if (!h) return null;
      return { kind, id: h.id, message: `${name} already has an open concern: ${h.confirmed_diagnosis ?? h.suspected_issue ?? 'reported'} on ${formatDate(h.reported_on)}.` };
    }
    case 'treatment': {
      const start = day(fields.started_on);
      const end = day(fields.completed_on) || today;
      const t = live(care.treatments).find(
        (x) => x.cattle_id === cow && norm(x.medication) === norm(fields.medication) && x.started_on <= end && (!x.completed_on || x.completed_on >= start),
      );
      if (!t) return null;
      return { kind, id: t.id, message: `${name} already has ${t.medication} from ${formatDate(t.started_on)}${t.completed_on ? ` to ${formatDate(t.completed_on)}` : ', still ongoing'}.` };
    }
    case 'vet-visit': {
      const v = live(care.visits).find((x) => x.cattle_id === cow && day(x.visit_at) === day(fields.visit_at));
      return v ? { kind, id: v.id, message: `A vet visit for ${name} is already recorded on ${formatDate(day(v.visit_at))}.` } : null;
    }
    case 'breeding': {
      const b = live(care.breeding).find((x) => x.cattle_id === cow && x.event_type === fields.event_type && day(x.event_at) === day(fields.event_at));
      return b ? { kind, id: b.id, message: `This is already recorded for ${name} on ${formatDate(day(b.event_at))}.` } : null;
    }
    case 'calving': {
      const k = live(care.calvings).find((x) => x.dam_id === cow && daysApart(x.calved_on, day(fields.calved_on)) <= CALVING_WINDOW_DAYS);
      return k ? { kind, id: k.id, message: `A calving for ${name} is already recorded on ${formatDate(k.calved_on)}.` } : null;
    }
    case 'action': {
      const a = live(care.actions).find((x) => x.cattle_id === cow && x.status === 'monitoring');
      return a ? { kind, id: a.id, message: `${name} is already being watched after an action on ${formatDate(a.action_on)}. Open it to update it.` } : null;
    }
    case 'schedule': {
      const s = live(care.schedules).find((x) => x.active && norm(x.vaccine_name) === norm(fields.vaccine_name));
      return s ? { kind, id: s.id, message: `There is already a schedule for ${s.vaccine_name}.` } : null;
    }
    default:
      return null;
  }
}

/**
 * For a dose given to a group: per cow, whether it completes a dose already booked (so no second
 * record and no leftover reminder), was already given (skipped), or is new.
 */
export function groupDosePlan(cattleIds: string[], vaccine: string, givenOn: string, care: CareData) {
  const plan = { complete: new Map<string, string>(), alreadyGiven: [] as string[], fresh: [] as string[] };
  for (const id of cattleIds) {
    const near = live(care.vaccinations).filter(
      (x) => x.cattle_id === id && norm(x.vaccine_name) === norm(vaccine) && daysApart(x.administered_on ?? x.due_on ?? '', givenOn) <= DOSE_WINDOW_DAYS,
    );
    const booked = near.find((x) => x.status === 'scheduled');
    if (near.some((x) => x.status === 'completed')) plan.alreadyGiven.push(id);
    else if (booked) plan.complete.set(id, booked.id);
    else plan.fresh.push(id);
  }
  return plan;
}
