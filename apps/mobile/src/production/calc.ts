// Production calculations from saved milk records. Pure functions, no I/O.
//
// Litres are handled as whole centilitres (integers), so sums and averages never pick up
// binary floating-point error. Dates are 'YYYY-MM-DD' strings in farm time.

export type Session = 'morning' | 'afternoon' | 'evening';
export const SESSIONS: Session[] = ['morning', 'afternoon', 'evening'];

export interface MilkRow {
  id: string;
  cattle_id: string;
  production_date: string;
  session: Session;
  quantity: string; // decimal string, e.g. "12.50"
  status: 'valid' | 'voided';
  restricted: boolean;
}

export interface DeclineRule {
  recent_days: number;
  baseline_days: number;
  threshold_pct: number;
  min_days: number;
}

export const DEFAULT_DECLINE_RULE: DeclineRule = { recent_days: 7, baseline_days: 7, threshold_pct: 20, min_days: 4 };

// --- Units -----------------------------------------------------------------

/** "12.5" → 1250 centilitres. */
export function toCl(quantity: string): number {
  const [whole, frac = ''] = quantity.trim().split('.');
  return Number(whole) * 100 + Number((frac + '00').slice(0, 2));
}

/** 1250 → "12.50". */
export function litres(cl: number): string {
  const sign = cl < 0 ? '-' : '';
  const abs = Math.abs(cl);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

// --- Dates -----------------------------------------------------------------

const utc = (d: string) => new Date(`${d}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(date: string, days: number): string {
  const d = utc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((utc(to).getTime() - utc(from).getTime()) / 86_400_000) + 1;
}

export type Period = 'today' | 'week' | 'month' | 'year';

/** Calendar periods containing `today`. Weeks run Monday to Sunday. */
/** The calendar month before the one `today` is in. */
export const lastMonthRange = (today: string) => periodRange('month', addDays(`${today.slice(0, 7)}-01`, -1));

export function periodRange(period: Period, today: string): { from: string; to: string } {
  const d = utc(today);
  switch (period) {
    case 'today':
      return { from: today, to: today };
    case 'week': {
      const monday = addDays(today, -((d.getUTCDay() + 6) % 7));
      return { from: monday, to: addDays(monday, 6) };
    }
    case 'month': {
      const from = `${today.slice(0, 7)}-01`;
      const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
      return { from, to: addDays(iso(next), -1) };
    }
    case 'year':
      return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
  }
}

/** The period of the same length immediately before, for comparisons. */
export function previousRange({ from, to }: { from: string; to: string }) {
  const length = daysBetween(from, to);
  return { from: addDays(from, -length), to: addDays(from, -1) };
}

// --- Aggregates ------------------------------------------------------------

const valid = (rows: MilkRow[], from: string, to: string) =>
  rows.filter((r) => r.status === 'valid' && r.production_date >= from && r.production_date <= to);

export interface Summary {
  totalCl: number; // all valid milk produced
  eligibleCl: number; // produced and not under milk withdrawal
  restrictedCl: number;
  cows: number; // cows with at least one record
  cowDays: number; // (cow, day) pairs with records
  avgPerCowDayCl: number | null; // average daily yield per producing cow
  entries: number;
}

export function summarize(rows: MilkRow[], from: string, to: string): Summary {
  const inRange = valid(rows, from, to);
  let totalCl = 0;
  let restrictedCl = 0;
  const cowDays = new Set<string>();
  const cows = new Set<string>();
  for (const r of inRange) {
    const cl = toCl(r.quantity);
    totalCl += cl;
    if (r.restricted) restrictedCl += cl;
    cows.add(r.cattle_id);
    cowDays.add(`${r.cattle_id}|${r.production_date}`);
  }
  return {
    totalCl,
    eligibleCl: totalCl - restrictedCl,
    restrictedCl,
    cows: cows.size,
    cowDays: cowDays.size,
    avgPerCowDayCl: cowDays.size ? Math.round(totalCl / cowDays.size) : null,
    entries: inRange.length,
  };
}

/** One entry per day in the range, zero-filled, for trend charts. */
export function dailyTotals(rows: MilkRow[], from: string, to: string): { date: string; cl: number; recorded: boolean }[] {
  const byDate = new Map<string, number>();
  for (const r of valid(rows, from, to)) byDate.set(r.production_date, (byDate.get(r.production_date) ?? 0) + toCl(r.quantity));
  return Array.from({ length: daysBetween(from, to) }, (_, i) => {
    const date = addDays(from, i);
    return { date, cl: byDate.get(date) ?? 0, recorded: byDate.has(date) };
  });
}

export interface AnimalYield {
  cattle_id: string;
  totalCl: number;
  days: number; // days with records
  avgCl: number; // average daily yield on days with records
}

export function perAnimal(rows: MilkRow[], from: string, to: string): AnimalYield[] {
  const acc = new Map<string, { totalCl: number; days: Set<string> }>();
  for (const r of valid(rows, from, to)) {
    const a = acc.get(r.cattle_id) ?? { totalCl: 0, days: new Set<string>() };
    a.totalCl += toCl(r.quantity);
    a.days.add(r.production_date);
    acc.set(r.cattle_id, a);
  }
  return [...acc.entries()]
    .map(([cattle_id, a]) => ({ cattle_id, totalCl: a.totalCl, days: a.days.size, avgCl: Math.round(a.totalCl / a.days.size) }))
    .sort((x, y) => y.avgCl - x.avgCl);
}

export interface BreedYield {
  breed_id: string | null;
  totalCl: number;
  cows: number;
  avgPerCowDayCl: number;
}

export function perBreed(rows: MilkRow[], breedOf: (cattleId: string) => string | null, from: string, to: string): BreedYield[] {
  const acc = new Map<string | null, { totalCl: number; cows: Set<string>; cowDays: number }>();
  for (const a of perAnimal(rows, from, to)) {
    const key = breedOf(a.cattle_id);
    const b = acc.get(key) ?? { totalCl: 0, cows: new Set<string>(), cowDays: 0 };
    b.totalCl += a.totalCl;
    b.cows.add(a.cattle_id);
    b.cowDays += a.days;
    acc.set(key, b);
  }
  return [...acc.entries()]
    .map(([breed_id, b]) => ({ breed_id, totalCl: b.totalCl, cows: b.cows.size, avgPerCowDayCl: Math.round(b.totalCl / b.cowDays) }))
    .sort((x, y) => y.avgPerCowDayCl - x.avgPerCowDayCl);
}

/** Highest and lowest producers by average daily yield, among cows with enough records. */
export function highLow(yields: AnimalYield[], minDays: number, count = 3) {
  const eligible = yields.filter((y) => y.days >= minDays);
  return {
    high: eligible.slice(0, count),
    low: eligible.length > count ? eligible.slice(-count).reverse() : [],
  };
}

// --- Decline ---------------------------------------------------------------

export type DeclineResult =
  | { state: 'insufficient'; recent: { from: string; to: string; days: number }; baseline: { from: string; to: string; days: number } }
  | {
      state: 'decline' | 'ok';
      recent: { from: string; to: string; days: number };
      baseline: { from: string; to: string; days: number };
      recentAvgCl: number;
      baselineAvgCl: number;
      changePct: number;
    };

/**
 * Compares a cow's average daily yield over the recent period (ending yesterday, since
 * today's milking may not be finished) with the period before it.
 */
export function decline(rows: MilkRow[], cattleId: string, today: string, rule: DeclineRule): DeclineResult {
  const recentTo = addDays(today, -1);
  const recentFrom = addDays(recentTo, -(rule.recent_days - 1));
  const baselineTo = addDays(recentFrom, -1);
  const baselineFrom = addDays(baselineTo, -(rule.baseline_days - 1));
  const cow = rows.filter((r) => r.cattle_id === cattleId);
  const recentYield = perAnimal(cow, recentFrom, recentTo)[0];
  const baselineYield = perAnimal(cow, baselineFrom, baselineTo)[0];
  const recent = { from: recentFrom, to: recentTo, days: recentYield?.days ?? 0 };
  const baseline = { from: baselineFrom, to: baselineTo, days: baselineYield?.days ?? 0 };
  if (recent.days < rule.min_days || baseline.days < rule.min_days || !baselineYield.avgCl) {
    return { state: 'insufficient', recent, baseline };
  }
  const changePct = Math.round(((recentYield.avgCl - baselineYield.avgCl) / baselineYield.avgCl) * 1000) / 10;
  return {
    state: changePct <= -rule.threshold_pct ? 'decline' : 'ok',
    recent,
    baseline,
    recentAvgCl: recentYield.avgCl,
    baselineAvgCl: baselineYield.avgCl,
    changePct,
  };
}

/** The usual session for the time of day: before 11:00 morning, before 16:00 afternoon, else evening. */
export function sessionFor(now: Date): Session {
  const h = now.getHours();
  return h < 11 ? 'morning' : h < 16 ? 'afternoon' : 'evening';
}
