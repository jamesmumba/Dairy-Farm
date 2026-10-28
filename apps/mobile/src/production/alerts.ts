// Early warning from the milk records. Pure functions, no I/O.
//
// Every rule is a plain comparison the farmer can check by hand, and every alert says what
// triggered it and what to check next. Nothing here diagnoses: the suggestions are checks
// (the record, feed and water, the cow herself) and, when in doubt, the vet.

import type { Cattle } from '../animals/model';
import type { AlertAction, CareData } from '../care/model';
import { addDays, decline, type DeclineRule, litres, type MilkRow, perAnimal, type Session, SESSIONS, sessionFor, toCl } from './calc';

/** A single day this far below the cow's usual daily milk is a sudden drop. */
export const DROP_PCT = 30;
/** Days before the checked day that make up "usual", and how many of them need records. */
const USUAL_DAYS = 7;
const USUAL_MIN_DAYS = 4;

const validFor = (rows: MilkRow[], cattleId: string) => rows.filter((r) => r.status === 'valid' && r.cattle_id === cattleId);

function sessionsOn(rows: MilkRow[], date: string) {
  return new Set(rows.filter((r) => r.production_date === date).map((r) => r.session)).size;
}

/** The number of milkings a day the cow usually has: the most common count over the usual days. */
function usualSessions(rows: MilkRow[], from: string, to: string) {
  const counts = new Map<number, number>();
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const n = sessionsOn(rows, d);
    if (n) counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? 0;
}

export interface SuddenDrop {
  date: string;
  dayCl: number;
  usualCl: number;
  changePct: number;
  /** Milkings recorded that day, and how many she usually has. Fewer may mean a missing entry. */
  sessions: number;
  usualSessions: number;
}

/**
 * Compares the cow's latest complete day with her usual daily milk over the week before it. Today
 * counts once all her usual milkings are in; otherwise yesterday is checked. A day with no
 * records is not a drop (that is a missing record).
 */
export function suddenDrop(rows: MilkRow[], cattleId: string, today: string): SuddenDrop | null {
  const cow = validFor(rows, cattleId);
  const check = (date: string): SuddenDrop | null => {
    const usualTo = addDays(date, -1);
    const usualFrom = addDays(usualTo, -(USUAL_DAYS - 1));
    const usual = perAnimal(cow, usualFrom, usualTo)[0];
    const day = perAnimal(cow, date, date)[0];
    if (!usual || usual.days < USUAL_MIN_DAYS || !usual.avgCl || !day) return null;
    const changePct = Math.round(((day.totalCl - usual.avgCl) / usual.avgCl) * 1000) / 10;
    if (changePct > -DROP_PCT) return null;
    return { date, dayCl: day.totalCl, usualCl: usual.avgCl, changePct, sessions: sessionsOn(cow, date), usualSessions: usualSessions(cow, usualFrom, usualTo) };
  };
  const yesterday = addDays(today, -1);
  const usualToday = usualSessions(cow, addDays(today, -USUAL_DAYS), yesterday);
  const todayComplete = usualToday > 0 && sessionsOn(cow, today) >= usualToday;
  return (todayComplete ? check(today) : null) ?? check(yesterday);
}

export interface MilkAlert {
  cattleId: string;
  type: 'milk_drop' | 'milk_decline';
  /** The first day of the evidence; an action taken on or after it covers this alert. */
  since: string;
  title: string;
  /** What triggered it, in numbers. Saved with the farmer's action. */
  reason: string;
  /** What to check next, in order. */
  steps: string[];
}

const healthNote = (care: CareData, cattleId: string) => {
  const open = care.health.find((h) => !h.deleted_at && h.cattle_id === cattleId && !['recovered', 'died'].includes(h.recovery_status));
  return open ? (open.confirmed_diagnosis ?? open.suspected_issue ?? 'a health concern') : null;
};

function steps(missingMilking: string | null, health: string | null): string[] {
  return [
    missingMilking ?? 'Check the milk record is right: the litres, the cow and the day.',
    'Check her feed and water: is she eating, and can she reach clean water?',
    'Watch her: appetite, udder (hot, hard or swollen), milk (clots or colour), how she walks and lies down.',
    health
      ? `She has an open health concern (${health}). Tell your vet about the milk drop.`
      : 'If she seems unwell, or her milk stays low after these checks, call your vet.',
  ];
}

/** Open actions hold an alert back until resolved; a resolved one covers evidence up to the day it was resolved. */
function covered(actions: AlertAction[], cattleId: string, since: string) {
  return actions.some(
    (a) => !a.deleted_at && a.cattle_id === cattleId && a.alert_type !== 'other' && (a.status === 'monitoring' || (a.resolved_on ?? a.action_on) >= since),
  );
}

/**
 * One milk alert per cow in milk: a sudden drop when there is one (it is the more specific), else a
 * steady decline by the farmer's own rule. Alerts the farmer has already acted on are left out.
 */
export function milkAlerts(rows: MilkRow[], animals: Cattle[], care: CareData, today: string, rule: DeclineRule): MilkAlert[] {
  const out: MilkAlert[] = [];
  for (const a of animals) {
    if (a.status !== 'active' || a.sex !== 'female') continue;
    const health = healthNote(care, a.id);
    const drop = suddenDrop(rows, a.id, today);
    if (drop) {
      const missing =
        drop.sessions < drop.usualSessions
          ? `Check the record first: only ${drop.sessions} of her usual ${drop.usualSessions} milkings is recorded for that day.`
          : null;
      const when = drop.date === today ? 'today' : 'yesterday';
      const alert: MilkAlert = {
        cattleId: a.id,
        type: 'milk_drop',
        since: drop.date,
        title: `Milk down ${Math.abs(drop.changePct)}% ${when}`,
        reason: `${litres(drop.dayCl)} L ${when} (${drop.date}), usually ${litres(drop.usualCl)} L a day`,
        steps: steps(missing, health),
      };
      if (!covered(care.actions, a.id, alert.since)) out.push(alert);
      continue;
    }
    const d = decline(rows, a.id, today, rule);
    if (d.state !== 'decline') continue;
    const alert: MilkAlert = {
      cattleId: a.id,
      type: 'milk_decline',
      since: d.recent.from,
      title: `Milk down ${Math.abs(d.changePct)}%`,
      reason: `${litres(d.recentAvgCl)} L a day over the last ${rule.recent_days} days, against ${litres(d.baselineAvgCl)} L the ${rule.baseline_days} days before`,
      steps: steps(null, health),
    };
    if (!covered(care.actions, a.id, alert.since)) out.push(alert);
  }
  return out;
}

// --- Missing records --------------------------------------------------------------

export interface MissingMilking {
  date: string;
  session: Session;
  /** Cows in milk with no entry for that milking. */
  cattleIds: string[];
  /** Cows in milk at the time of the check. */
  of: number;
}

/**
 * Milkings already over (yesterday's, and today's before the current one) where some cows in milk
 * have no entry. Only milkings the farm records are checked: a session no one has recorded in the
 * last two weeks is not expected. A milking with no entries at all is reported too.
 */
export function missingMilkings(rows: MilkRow[], animals: Cattle[], today: string, now: Date): MissingMilking[] {
  const valid = rows.filter((r) => r.status === 'valid');
  const recent = valid.filter((r) => r.production_date >= addDays(today, -14) && r.production_date < today);
  const used = SESSIONS.filter((s) => recent.some((r) => r.session === s));
  if (!used.length) return [];
  const cows = animals.filter((a) => a.status === 'active' && a.sex === 'female' && a.production_status === 'lactating').map((a) => a.id);
  if (!cows.length) return [];
  const current = SESSIONS.indexOf(sessionFor(now));
  const due = [
    ...used.map((session) => ({ date: addDays(today, -1), session })),
    ...used.filter((s) => SESSIONS.indexOf(s) < current).map((session) => ({ date: today, session })),
  ];
  return due
    .map(({ date, session }) => {
      const have = new Set(valid.filter((r) => r.production_date === date && r.session === session).map((r) => r.cattle_id));
      return { date, session, cattleIds: cows.filter((c) => !have.has(c)), of: cows.length };
    })
    .filter((m) => m.cattleIds.length > 0);
}

// --- Checking an amount as it is entered ---------------------------------------------

export interface UnusualAmount {
  direction: 'high' | 'low';
  usualCl: number;
}

/** No cow gives this much at one milking: always worth a second look. */
const MAX_SESSION_CL = 4000;

/**
 * Whether litres typed for a cow's milking are far from her usual for that milking (under half or
 * over one and a half times, from at least 4 of the last 14 days), or simply too much for one milking.
 * Asked before saving so a typing mistake never reaches the alerts and reports.
 */
export function unusualAmount(rows: MilkRow[], cattleId: string, session: Session, date: string, quantity: string): UnusualAmount | null {
  const cl = toCl(quantity);
  const same = rows.filter(
    (r) => r.status === 'valid' && r.cattle_id === cattleId && r.session === session && r.production_date < date && r.production_date >= addDays(date, -14),
  );
  const usualCl = same.length >= 4 ? Math.round(same.reduce((s, r) => s + toCl(r.quantity), 0) / same.length) : null;
  if (usualCl && cl > usualCl * 1.5) return { direction: 'high', usualCl };
  if (usualCl && cl < usualCl * 0.5) return { direction: 'low', usualCl };
  if (cl > MAX_SESSION_CL) return { direction: 'high', usualCl: usualCl ?? 0 };
  return null;
}
