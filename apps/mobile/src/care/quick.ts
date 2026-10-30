// One-tap answers to what a care record is waiting for: a dose given or missed, a course finished,
// a check result, a follow-up. Pure: which answers fit a record, and what saving one changes.
// The rules mirror the server's checks (apps/api/src/care.ts), so a quick answer is never refused.

import type { FormContext } from './forms';
import type { AlertAction, BreedingRecord, CareKind, HealthRecord, PregnancyCheck, Treatment, Vaccination } from './model';
import type { Reminder } from './reminders';

export type QuickAction =
  | 'given'
  | 'missed'
  | 'course_finished'
  | 'milk_cleared'
  | 'pregnant'
  | 'not_pregnant'
  | 'unclear'
  | 'saw_heat'
  | 'no_heat'
  | 'record_calving'
  | 'recovered'
  | 'resolved'
  | 'not_yet';

export const QUICK_LABELS: Record<QuickAction, string> = {
  given: 'Given',
  missed: 'Missed',
  course_finished: 'Course finished',
  milk_cleared: 'Milk cleared',
  pregnant: 'Pregnant',
  not_pregnant: 'Not pregnant',
  unclear: 'Unclear',
  saw_heat: 'Saw heat',
  no_heat: 'No heat seen',
  record_calving: 'Record calving',
  recovered: 'Recovered',
  resolved: 'Resolved',
  not_yet: 'Not yet',
};

/** What a reminder asks for. The first answer is the usual one and is shown as the main button. */
export function reminderActions(r: Pick<Reminder, 'kind'>): QuickAction[] {
  switch (r.kind) {
    case 'vaccination':
      return ['given', 'missed'];
    case 'withdrawal_clearance':
      return ['milk_cleared'];
    case 'pregnancy_check':
      return ['pregnant', 'not_pregnant', 'unclear'];
    case 'heat_watch':
      return ['saw_heat', 'no_heat'];
    case 'expected_calving':
      return ['record_calving'];
    case 'health_follow_up':
      return ['recovered', 'not_yet'];
    case 'action_follow_up':
      return ['resolved', 'not_yet'];
    default:
      return [];
  }
}

/** What a record itself is still waiting for, shown at the top of its screen. */
export function recordActions(kind: CareKind, r: Record<string, unknown>, ctx: Pick<FormContext, 'care'>, now: Date): QuickAction[] {
  switch (kind) {
    case 'vaccination':
      return (r as unknown as Vaccination).status === 'scheduled' ? ['given', 'missed'] : [];
    case 'treatment': {
      const t = r as unknown as Treatment;
      const out: QuickAction[] = [];
      if (!t.completed_on) out.push('course_finished');
      if (t.requires_milk_withdrawal && t.withdrawal_ends_at && Date.parse(t.withdrawal_ends_at) <= now.getTime() && !t.withdrawal_cleared_at) out.push('milk_cleared');
      return out;
    }
    case 'pregnancy-check': {
      const c = r as unknown as PregnancyCheck;
      if (c.result === 'pending') return ['pregnant', 'not_pregnant', 'unclear'];
      const calved = ctx.care.calvings.some((k) => !k.deleted_at && k.dam_id === c.cattle_id && k.calved_on >= (c.examined_on ?? ''));
      return c.result === 'pregnant' && !calved ? ['record_calving'] : [];
    }
    case 'health':
      return ['recovered', 'died'].includes((r as unknown as HealthRecord).recovery_status) ? [] : ['recovered', 'not_yet'];
    case 'action':
      return (r as unknown as AlertAction).status === 'monitoring' ? ['resolved', 'not_yet'] : [];
    default:
      return [];
  }
}

/** Saved straight away, or opens a form: no sheet. */
export const NO_SHEET: QuickAction[] = ['no_heat', 'record_calving'];

const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** What the sheet asks. Only the fields that matter; everything else stays in Edit. */
export interface SheetValues {
  date: string;
  /** Vaccination: next dose; pregnancy: expected calving; not yet: next check. */
  date2: string | null;
  text: string;
}

export interface SheetSpec {
  title: string;
  dateLabel: string | null;
  allowFutureDate: boolean;
  date2Label: string | null;
  date2Hint?: string;
  /** Quick picks for date2, in days from today. */
  date2Picks?: number[];
  date2Required: boolean;
  textLabel: string | null;
  saveLabel: string;
}

export function sheetSpec(action: QuickAction): SheetSpec {
  const base = { dateLabel: 'Date', allowFutureDate: false, date2Label: null, date2Required: false, textLabel: null } as const;
  switch (action) {
    case 'given':
      return { ...base, title: 'Dose given', date2Label: 'Next dose due', date2Hint: 'From the schedule, if it has an interval. The next dose is added for you.', textLabel: 'Batch number', saveLabel: 'Save as given' };
    case 'missed':
      return { ...base, title: 'Dose missed', dateLabel: null, date2Label: 'Give it on', date2Picks: [1, 3, 7], date2Required: true, saveLabel: 'Save and reschedule' };
    case 'course_finished':
      return { ...base, title: 'Course finished', dateLabel: 'Last dose on', saveLabel: 'Save' };
    case 'milk_cleared':
      return { ...base, title: 'Milk cleared', dateLabel: null, textLabel: 'Note (optional)', saveLabel: 'Confirm milk can be used' };
    case 'pregnant':
      return { ...base, title: 'Pregnant', dateLabel: 'Examined on', date2Label: 'Expected calving', date2Hint: 'From the breeding date and your gestation interval. Change it to the vet’s date.', textLabel: 'Examined by', saveLabel: 'Save result' };
    case 'not_pregnant':
      return { ...base, title: 'Not pregnant', dateLabel: 'Examined on', textLabel: 'Examined by', saveLabel: 'Save result' };
    case 'unclear':
      return { ...base, title: 'Result unclear', dateLabel: 'Examined on', textLabel: 'Examined by', saveLabel: 'Save result' };
    case 'saw_heat':
      return { ...base, title: 'Saw heat', dateLabel: 'Seen on', textLabel: 'Note (optional)', saveLabel: 'Save heat' };
    case 'recovered':
      return { ...base, title: 'Recovered', dateLabel: 'Recovered on', textLabel: 'How she is (optional)', saveLabel: 'Save' };
    case 'resolved':
      return { ...base, title: 'Resolved', dateLabel: 'Resolved on', textLabel: 'Outcome (optional)', saveLabel: 'Save' };
    case 'not_yet':
      return { ...base, title: 'Not better yet', dateLabel: null, date2Label: 'Check again on', date2Picks: [1, 3, 7], date2Required: true, textLabel: 'Note (optional)', saveLabel: 'Save' };
    default:
      return { ...base, title: QUICK_LABELS[action], saveLabel: 'Save' };
  }
}

/** The breeding a pregnancy check is about: its own link, else her latest mating on or before the check. */
function matingFor(c: PregnancyCheck, breeding: BreedingRecord[]) {
  const linked = breeding.find((b) => b.id === c.breeding_record_id && !b.deleted_at);
  if (linked) return linked;
  const by = c.scheduled_on ?? c.examined_on ?? '9999';
  return breeding
    .filter((b) => !b.deleted_at && b.cattle_id === c.cattle_id && b.event_type !== 'heat_observed' && b.event_at.slice(0, 10) <= by)
    .sort((a, b) => b.event_at.localeCompare(a.event_at))[0];
}

/** The sheet's starting values. */
export function sheetDefaults(action: QuickAction, kind: CareKind, r: Record<string, unknown>, ctx: FormContext): SheetValues {
  const today = ctx.today;
  const values: SheetValues = { date: today, date2: null, text: '' };
  if (action === 'given' && kind === 'vaccination') {
    const v = r as unknown as Vaccination;
    const interval = ctx.care.schedules.find((s) => s.id === v.schedule_id)?.interval_days;
    values.date2 = interval ? addDays(today, interval) : null;
    values.text = v.batch_number ?? '';
  }
  if (action === 'missed' || action === 'not_yet') values.date2 = addDays(today, action === 'missed' ? 7 : 3);
  if (action === 'pregnant') {
    const b = matingFor(r as unknown as PregnancyCheck, ctx.care.breeding);
    values.date2 = b ? addDays(b.event_at.slice(0, 10), ctx.intervals.gestation_days) : null;
  }
  return values;
}

export interface QuickChange {
  /** Fields to change on the record. */
  update?: Record<string, unknown>;
  /** A new record to add (the rescheduled dose, the heat seen). */
  create?: { kind: CareKind; fields: Record<string, unknown> };
}

/**
 * What saving an answer changes, or an error to show in the sheet. `now` gives the time for
 * the milk clearance and for a heat seen today.
 */
export function quickChange(action: QuickAction, kind: CareKind, r: Record<string, unknown>, values: SheetValues, now: Date, today: string): QuickChange | { error: string } {
  const { date, date2 } = values;
  const text = values.text.trim() || null;
  if (date > today && !['missed', 'not_yet'].includes(action)) return { error: 'The date cannot be in the future.' };
  switch (action) {
    case 'given': {
      if (date2 && date2 <= date) return { error: 'The next dose must be after this one.' };
      return { update: { status: 'completed', administered_on: date, batch_number: text, next_due_on: date2 } };
    }
    case 'missed': {
      if (!date2) return { error: 'Choose when to give it instead.' };
      if (date2 < today) return { error: 'Choose today or a later date.' };
      const v = r as unknown as Vaccination;
      return {
        update: { status: 'missed' },
        create: {
          kind: 'vaccination',
          fields: {
            cattle_id: v.cattle_id,
            schedule_id: v.schedule_id,
            vaccine_name: v.vaccine_name,
            target_disease: v.target_disease,
            due_on: date2,
            status: 'scheduled',
            is_booster: v.is_booster,
            group_batch_id: v.group_batch_id,
            group_label: v.group_label,
            group_definition: v.group_definition,
          },
        },
      };
    }
    case 'course_finished': {
      const t = r as unknown as Treatment;
      if (date < t.started_on) return { error: 'The course cannot finish before it started.' };
      return { update: { completed_on: date } };
    }
    case 'milk_cleared': {
      const t = r as unknown as Treatment;
      if (!t.withdrawal_ends_at || Date.parse(t.withdrawal_ends_at) > now.getTime()) return { error: 'The withdrawal has not ended yet.' };
      return { update: { withdrawal_cleared_at: now.toISOString(), withdrawal_clearance_note: text } };
    }
    case 'pregnant':
    case 'not_pregnant':
    case 'unclear': {
      const result = action === 'unclear' ? 'inconclusive' : action;
      if (action === 'pregnant' && date2 && date2 <= date) return { error: 'Expected calving must be after the examination.' };
      return { update: { result, examined_on: date, examiner: text, expected_calving_on: action === 'pregnant' ? date2 : null } };
    }
    case 'saw_heat': {
      const b = r as unknown as BreedingRecord;
      // Seen today: now. An earlier day: midday, as the hour was not given.
      const at = date === today ? now.toISOString() : new Date(`${date}T12:00:00`).toISOString();
      if (Date.parse(at) <= Date.parse(b.event_at)) return { error: 'The heat must be after the mating.' };
      return { create: { kind: 'breeding', fields: { cattle_id: b.cattle_id, event_type: 'heat_observed', event_at: at, notes: text } } };
    }
    case 'recovered': {
      const h = r as unknown as HealthRecord;
      if (date < h.reported_on) return { error: 'She cannot recover before it was reported.' };
      const line = `Recovered on ${date}${text ? `: ${text}` : ''}`;
      return { update: { recovery_status: 'recovered', notes: h.notes ? `${h.notes}\n${line}` : line } };
    }
    case 'resolved': {
      const a = r as unknown as AlertAction;
      if (date < a.action_on) return { error: 'It cannot be resolved before the action was taken.' };
      return { update: { status: 'resolved', resolved_on: date, outcome: text } };
    }
    case 'not_yet': {
      if (!date2) return { error: 'Choose when to check again.' };
      if (date2 < today) return { error: 'Choose today or a later date.' };
      if (kind === 'health') {
        const h = r as unknown as HealthRecord;
        return { update: { follow_up_on: date2, ...(text ? { notes: h.notes ? `${h.notes}\n${today}: ${text}` : `${today}: ${text}` } : {}) } };
      }
      const a = r as unknown as AlertAction;
      return { update: { follow_up_on: date2, ...(text ? { notes: a.notes ? `${a.notes}\n${today}: ${text}` : `${today}: ${text}` } : {}) } };
    }
    default:
      return { error: 'This answer is not saved from here.' };
  }
}

// --- Group doses --------------------------------------------------------------------------

export interface GroupDose {
  key: string;
  title: string;
  due: string;
  urgency: Reminder['urgency'];
  /** The scheduled doses, one per cow. */
  ids: string[];
  cattleIds: string[];
}

/**
 * Vaccination reminders for doses given to a group together (same group, vaccine and due date)
 * become one row. Everything else is returned as it was. Only for display: phone notifications
 * keep one per cow.
 */
export function groupDoses(reminders: Reminder[], vaccinations: Vaccination[]): (Reminder | GroupDose)[] {
  const byId = new Map(vaccinations.map((v) => [v.id, v]));
  const groups = new Map<string, GroupDose>();
  const out: (Reminder | GroupDose)[] = [];
  for (const r of reminders) {
    const v = r.kind === 'vaccination' && r.record ? byId.get(r.record.id) : undefined;
    if (!v?.group_batch_id) {
      out.push(r);
      continue;
    }
    const key = `group:${v.group_batch_id}:${v.vaccine_name}:${r.due}`;
    const g = groups.get(key);
    if (g) {
      g.ids.push(v.id);
      g.cattleIds.push(v.cattle_id);
      continue;
    }
    const dose: GroupDose = { key, title: `${v.vaccine_name} ${r.urgency === 'overdue' ? 'overdue' : 'due'}${v.group_label ? ` · ${v.group_label}` : ''}`, due: r.due, urgency: r.urgency, ids: [v.id], cattleIds: [v.cattle_id] };
    groups.set(key, dose);
    out.push(dose);
  }
  // A "group" of one is just that cow's reminder.
  return out.map((x) => ('ids' in x && x.ids.length === 1 ? reminders.find((r) => r.record?.id === x.ids[0])! : x));
}

export const isGroup = (x: Reminder | GroupDose): x is GroupDose => 'ids' in x;
