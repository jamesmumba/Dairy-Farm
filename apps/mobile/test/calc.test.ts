import { describe, expect, it } from 'vitest';
import {
  addDays,
  dailyTotals,
  decline,
  DEFAULT_DECLINE_RULE,
  highLow,
  litres,
  type MilkRow,
  perAnimal,
  perBreed,
  periodRange,
  previousRange,
  summarize,
  toCl,
} from '../src/production/calc';

let n = 0;
const row = (cattle_id: string, production_date: string, quantity: string, extra: Partial<MilkRow> = {}): MilkRow => ({
  id: String(n++),
  cattle_id,
  production_date,
  session: 'morning',
  quantity,
  status: 'valid',
  restricted: false,
  ...extra,
});

/** One record a day for `days` days ending on `to`, each with the given litres. */
const daily = (cow: string, to: string, days: number, quantity: string) =>
  Array.from({ length: days }, (_, i) => row(cow, addDays(to, -i), quantity));

describe('units', () => {
  it('converts litres exactly, with no float error', () => {
    expect(toCl('12.5')).toBe(1250);
    expect(toCl('0.1') + toCl('0.2')).toBe(30);
    expect(litres(toCl('0.1') + toCl('0.2'))).toBe('0.30'); // 0.1 + 0.2 = 0.30000000000000004 in floats
    expect(litres(5)).toBe('0.05');
    expect(litres(-250)).toBe('-2.50');
  });
});

describe('periods', () => {
  it('weeks run Monday to Sunday', () => {
    expect(periodRange('week', '2026-10-28')).toEqual({ from: '2026-10-26', to: '2026-11-01' }); // Wednesday
    expect(periodRange('week', '2026-11-01')).toEqual({ from: '2026-10-26', to: '2026-11-01' }); // Sunday
  });
  it('months and years cover whole calendar periods', () => {
    expect(periodRange('month', '2028-02-10')).toEqual({ from: '2028-02-01', to: '2028-02-29' }); // leap year
    expect(periodRange('year', '2026-10-28')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });
  it('the previous period has the same length', () => {
    expect(previousRange({ from: '2026-10-26', to: '2026-11-01' })).toEqual({ from: '2026-10-19', to: '2026-10-25' });
  });
});

describe('totals', () => {
  it('daily yield is the sum of valid sessions (spec: 12 L + 8 L = 20 L)', () => {
    const rows = [row('cow', '2026-10-05', '12'), row('cow', '2026-10-05', '8', { session: 'afternoon' })];
    expect(summarize(rows, '2026-10-05', '2026-10-05')).toMatchObject({ totalCl: 2000, cows: 1, cowDays: 1, avgPerCowDayCl: 2000 });
    expect(dailyTotals(rows, '2026-10-04', '2026-10-06')).toEqual([
      { date: '2026-10-04', cl: 0, recorded: false },
      { date: '2026-10-05', cl: 2000, recorded: true },
      { date: '2026-10-06', cl: 0, recorded: false },
    ]);
  });

  it('ignores voided entries and separates restricted (withdrawal) milk', () => {
    const rows = [
      row('a', '2026-10-05', '10'),
      row('a', '2026-10-05', '99', { status: 'voided' }),
      row('b', '2026-10-05', '6', { restricted: true }),
    ];
    expect(summarize(rows, '2026-10-05', '2026-10-05')).toMatchObject({ totalCl: 1600, eligibleCl: 1000, restrictedCl: 600, entries: 2 });
  });

  it('averages per producing cow per day, counting only days with records', () => {
    const rows = [row('a', '2026-10-01', '20'), row('a', '2026-10-02', '10'), row('b', '2026-10-01', '6')];
    expect(summarize(rows, '2026-10-01', '2026-10-31')).toMatchObject({ totalCl: 3600, cowDays: 3, avgPerCowDayCl: 1200 });
    expect(perAnimal(rows, '2026-10-01', '2026-10-31')).toEqual([
      { cattle_id: 'a', totalCl: 3000, days: 2, avgCl: 1500 },
      { cattle_id: 'b', totalCl: 600, days: 1, avgCl: 600 },
    ]);
  });

  it('groups by breed', () => {
    const rows = [row('f1', '2026-10-01', '20'), row('f2', '2026-10-01', '10'), row('j1', '2026-10-01', '12')];
    const breed = (id: string) => (id.startsWith('f') ? 'friesian' : 'jersey');
    expect(perBreed(rows, breed, '2026-10-01', '2026-10-01')).toEqual([
      { breed_id: 'friesian', totalCl: 3000, cows: 2, avgPerCowDayCl: 1500 },
      { breed_id: 'jersey', totalCl: 1200, cows: 1, avgPerCowDayCl: 1200 },
    ]);
  });

  it('lists high and low producers only among cows with enough records', () => {
    const yields = [
      { cattle_id: 'a', totalCl: 0, days: 5, avgCl: 2500 },
      { cattle_id: 'b', totalCl: 0, days: 5, avgCl: 2000 },
      { cattle_id: 'c', totalCl: 0, days: 1, avgCl: 1900 },
      { cattle_id: 'd', totalCl: 0, days: 5, avgCl: 900 },
    ];
    const { high, low } = highLow(yields, 3, 1);
    expect(high.map((y) => y.cattle_id)).toEqual(['a']);
    expect(low.map((y) => y.cattle_id)).toEqual(['d']);
  });
});

describe('decline', () => {
  const today = '2026-10-28';
  const yesterday = '2026-10-27';

  it('flags a drop of at least the threshold, comparing the last 7 days to the 7 before (ending yesterday)', () => {
    const rows = [...daily('cow', yesterday, 7, '15'), ...daily('cow', addDays(yesterday, -7), 7, '20')];
    expect(decline(rows, 'cow', today, DEFAULT_DECLINE_RULE)).toMatchObject({
      state: 'decline',
      recentAvgCl: 1500,
      baselineAvgCl: 2000,
      changePct: -25,
      recent: { from: '2026-10-21', to: '2026-10-27', days: 7 },
      baseline: { from: '2026-10-14', to: '2026-10-20', days: 7 },
    });
  });

  it('does not flag a smaller drop', () => {
    const rows = [...daily('cow', yesterday, 7, '17'), ...daily('cow', addDays(yesterday, -7), 7, '20')];
    expect(decline(rows, 'cow', today, DEFAULT_DECLINE_RULE)).toMatchObject({ state: 'ok', changePct: -15 });
  });

  it('ignores today, whose milking may not be finished', () => {
    const rows = [...daily('cow', yesterday, 7, '20'), ...daily('cow', addDays(yesterday, -7), 7, '20'), row('cow', today, '1')];
    expect(decline(rows, 'cow', today, DEFAULT_DECLINE_RULE).state).toBe('ok');
  });

  it('says there is not enough data instead of guessing', () => {
    const rows = [...daily('cow', yesterday, 3, '5'), ...daily('cow', addDays(yesterday, -7), 7, '20')];
    expect(decline(rows, 'cow', today, DEFAULT_DECLINE_RULE)).toMatchObject({ state: 'insufficient', recent: { days: 3 } });
  });

  it('uses the farmer’s own rule', () => {
    const rows = [...daily('cow', yesterday, 3, '18'), ...daily('cow', addDays(yesterday, -3), 14, '20')];
    const rule = { recent_days: 3, baseline_days: 14, threshold_pct: 5, min_days: 3 };
    expect(decline(rows, 'cow', today, rule)).toMatchObject({ state: 'decline', changePct: -10 });
  });
});
