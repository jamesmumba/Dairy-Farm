// Reminders derived from saved records. Pure: no I/O, no clock (callers pass `now`).

import { ACTION_LABELS, ALERT_TYPE_LABELS, type CareData, type CareKind } from './model';

export type ReminderKind =
  | 'withdrawal'
  | 'withdrawal_clearance'
  | 'vaccination'
  | 'pregnancy_check'
  | 'expected_calving'
  | 'heat_watch'
  | 'health_follow_up'
  | 'action_follow_up'
  | 'missing_milk'
  | 'unpaid_balance'
  | 'stock_discrepancy'
  | 'production_decline'
  | 'sync_problem'
  | 'possible_duplicate'
  | 'new_device';

export type Urgency = 'overdue' | 'today' | 'upcoming' | 'active';

export interface Reminder {
  key: string; // stable id, also the notification identifier
  kind: ReminderKind;
  urgency: Urgency;
  due: string; // YYYY-MM-DD (or the exact time for withdrawals)
  cattleId: string;
  title: string;
  detail: string;
  /** The care record it is about; finance reminders link to a screen instead. */
  record?: { kind: CareKind; id: string };
  href?: string;
  /** Days before `due` to notify; [] = no dated notification. */
  notifyOffsets: number[];
  /**
   * A problem rather than a dated task: notify once while it lasts, at the farmer's next reminder time
   * ('next_reminder') or within a minute ('soon'). It can notify again only after it has cleared.
   */
  alert?: 'next_reminder' | 'soon';
}

export const DEFAULT_VACCINE_OFFSETS = [30, 7, 1];
const UPCOMING_DAYS = { vaccination: 30, pregnancy_check: 7, expected_calving: 30, health_follow_up: 7 };
const CLEARANCE_DAYS = 7; // ask to confirm clearance for a week after a withdrawal ends
// A cow that did not conceive usually comes on heat again about 21 days after mating; watch from day 18 to 24.
const HEAT_RETURN_DAYS = 21;
const HEAT_WATCH_WINDOW = 3;

const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const toDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysUntil = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

function urgency(due: string, today: string, window: number): Urgency | null {
  const days = daysUntil(today, due);
  if (days < 0) return 'overdue';
  if (days === 0) return 'today';
  return days <= window ? 'upcoming' : null;
}

/**
 * @param activeCattle animals still on the farm; reminders for others are dropped
 */
export function computeReminders(data: CareData, activeCattle: Set<string>, now: Date): Reminder[] {
  const today = toDate(now);
  const out: Reminder[] = [];
  const live = <T extends { deleted_at: string | null }>(rows: T[]) => rows.filter((r) => !r.deleted_at);
  const schedules = new Map(live(data.schedules).map((s) => [s.id, s]));

  for (const t of live(data.treatments)) {
    if (!activeCattle.has(t.cattle_id) || !t.requires_milk_withdrawal || !t.withdrawal_ends_at) continue;
    const ends = new Date(t.withdrawal_ends_at);
    if (ends > now) {
      out.push({
        key: `withdrawal:${t.id}`,
        kind: 'withdrawal',
        urgency: 'active',
        due: t.withdrawal_ends_at,
        cattleId: t.cattle_id,
        title: 'Milk withdrawal in force',
        detail: `${t.medication}: milk is not for sale or human use until ${ends.toLocaleString()}`,
        record: { kind: 'treatment', id: t.id },
        notifyOffsets: [0],
      });
    } else if (!t.withdrawal_cleared_at && daysUntil(toDate(ends), today) <= CLEARANCE_DAYS) {
      out.push({
        key: `clearance:${t.id}`,
        kind: 'withdrawal_clearance',
        urgency: 'today',
        due: toDate(ends),
        cattleId: t.cattle_id,
        title: 'Withdrawal period ended',
        detail: `${t.medication}: confirm clearance if your vet requires it`,
        record: { kind: 'treatment', id: t.id },
        notifyOffsets: [],
        alert: 'next_reminder',
      });
    }
  }

  for (const v of live(data.vaccinations)) {
    if (!activeCattle.has(v.cattle_id) || v.status !== 'scheduled' || !v.due_on) continue;
    const offsets = (v.schedule_id && schedules.get(v.schedule_id)?.reminder_offsets_days) || DEFAULT_VACCINE_OFFSETS;
    const u = urgency(v.due_on, today, Math.max(UPCOMING_DAYS.vaccination, ...offsets));
    if (!u) continue;
    out.push({
      key: `vaccination:${v.id}`,
      kind: 'vaccination',
      urgency: u,
      due: v.due_on,
      cattleId: v.cattle_id,
      title: `${v.vaccine_name} ${u === 'overdue' ? 'overdue' : 'due'}`,
      detail: v.target_disease ? `Against ${v.target_disease}` : 'Vaccination',
      record: { kind: 'vaccination', id: v.id },
      notifyOffsets: offsets,
    });
  }

  for (const c of live(data.checks)) {
    if (!activeCattle.has(c.cattle_id) || c.result !== 'pending' || !c.scheduled_on) continue;
    const u = urgency(c.scheduled_on, today, UPCOMING_DAYS.pregnancy_check);
    if (!u) continue;
    out.push({
      key: `check:${c.id}`,
      kind: 'pregnancy_check',
      urgency: u,
      due: c.scheduled_on,
      cattleId: c.cattle_id,
      title: `Pregnancy check ${u === 'overdue' ? 'overdue' : 'due'}`,
      detail: 'Record the result after the examination',
      record: { kind: 'pregnancy-check', id: c.id },
      notifyOffsets: [1, 0],
    });
  }

  // Expected calving: from the latest confirmed pregnancy with no calving recorded since.
  const calvedSince = (cattleId: string, date: string) => live(data.calvings).some((k) => k.dam_id === cattleId && k.calved_on >= date);
  const latestPregnant = new Map<string, (typeof data.checks)[number]>();
  for (const c of live(data.checks)) {
    if (c.result !== 'pregnant' || !c.expected_calving_on || !c.examined_on) continue;
    const prev = latestPregnant.get(c.cattle_id);
    if (!prev || c.examined_on > prev.examined_on!) latestPregnant.set(c.cattle_id, c);
  }
  for (const c of latestPregnant.values()) {
    if (!activeCattle.has(c.cattle_id) || calvedSince(c.cattle_id, c.examined_on!)) continue;
    const u = urgency(c.expected_calving_on!, today, UPCOMING_DAYS.expected_calving);
    if (!u) continue;
    out.push({
      key: `calving:${c.id}`,
      kind: 'expected_calving',
      urgency: u,
      due: c.expected_calving_on!,
      cattleId: c.cattle_id,
      title: u === 'overdue' ? 'Expected calving date passed' : 'Calving expected',
      detail: u === 'overdue' ? 'Record the calving, or update the pregnancy check' : 'Prepare for calving',
      record: { kind: 'pregnancy-check', id: c.id },
      notifyOffsets: [7, 1],
    });
  }

  // Watch for a return to heat after the latest mating or insemination, unless something since
  // (a heat, another mating, a pregnant / not pregnant result or a calving) already answers it.
  const latestMating = new Map<string, (typeof data.breeding)[number]>();
  for (const b of live(data.breeding)) {
    if (b.event_type === 'heat_observed') continue;
    const prev = latestMating.get(b.cattle_id);
    if (!prev || b.event_at > prev.event_at) latestMating.set(b.cattle_id, b);
  }
  for (const b of latestMating.values()) {
    if (!activeCattle.has(b.cattle_id)) continue;
    const bred = b.event_at.slice(0, 10);
    const answered =
      live(data.breeding).some((x) => x.cattle_id === b.cattle_id && x.id !== b.id && x.event_at > b.event_at) ||
      live(data.checks).some((c) => c.cattle_id === b.cattle_id && (c.result === 'pregnant' || c.result === 'not_pregnant') && (c.examined_on ?? '') >= bred) ||
      calvedSince(b.cattle_id, bred);
    if (answered) continue;
    const due = addDays(bred, HEAT_RETURN_DAYS);
    const days = daysUntil(today, due);
    if (days > HEAT_WATCH_WINDOW || days < -HEAT_WATCH_WINDOW) continue;
    out.push({
      key: `heat:${b.id}`,
      kind: 'heat_watch',
      urgency: days > 0 ? 'upcoming' : 'today',
      due,
      cattleId: b.cattle_id,
      title: 'Watch for heat',
      detail: `${daysUntil(bred, today)} days since she was bred. If she comes on heat she has probably not conceived: record the heat`,
      record: { kind: 'breeding', id: b.id },
      notifyOffsets: [HEAT_WATCH_WINDOW],
    });
  }

  for (const a of live(data.actions)) {
    if (!activeCattle.has(a.cattle_id) || a.status !== 'monitoring' || !a.follow_up_on) continue;
    const u = urgency(a.follow_up_on, today, UPCOMING_DAYS.health_follow_up);
    if (!u) continue;
    out.push({
      key: `action:${a.id}:${a.follow_up_on}`,
      kind: 'action_follow_up',
      urgency: u,
      due: a.follow_up_on,
      cattleId: a.cattle_id,
      title: `Follow up: ${ALERT_TYPE_LABELS[a.alert_type].toLowerCase()}`,
      detail: `${ACTION_LABELS[a.action_taken]} on ${a.action_on}. Record how she is now`,
      record: { kind: 'action', id: a.id },
      notifyOffsets: [0],
    });
  }

  for (const h of live(data.health)) {
    if (!activeCattle.has(h.cattle_id) || !h.follow_up_on || ['recovered', 'died'].includes(h.recovery_status)) continue;
    const u = urgency(h.follow_up_on, today, UPCOMING_DAYS.health_follow_up);
    if (!u) continue;
    out.push({
      key: `followup:${h.id}`,
      kind: 'health_follow_up',
      urgency: u,
      due: h.follow_up_on,
      cattleId: h.cattle_id,
      title: `Health follow-up ${u === 'overdue' ? 'overdue' : 'due'}`,
      detail: h.confirmed_diagnosis ?? h.suspected_issue ?? 'Health concern',
      record: { kind: 'health', id: h.id },
      notifyOffsets: [0],
    });
  }

  // Withdrawal first (it decides what milk can be sold), then overdue, today, upcoming.
  const order: Record<Urgency, number> = { active: 0, overdue: 1, today: 2, upcoming: 3 };
  return out.sort((a, b) => order[a.urgency] - order[b.urgency] || a.due.localeCompare(b.due));
}
