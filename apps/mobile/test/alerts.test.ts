import { describe, expect, it } from 'vitest';
import type { Cattle } from '../src/animals/model';
import type { AlertAction, CareData } from '../src/care/model';
import { milkAlerts, missingMilkings, suddenDrop, unusualAmount } from '../src/production/alerts';
import { addDays, DEFAULT_DECLINE_RULE, type MilkRow, type Session } from '../src/production/calc';

const TODAY = '2026-10-28';
let n = 0;
const row = (cattle_id: string, production_date: string, quantity: string, session: Session = 'morning'): MilkRow => ({
  id: String(n++),
  cattle_id,
  production_date,
  session,
  quantity,
  status: 'valid',
  restricted: false,
});
/** Morning and evening each day for `days` days ending on `to`. */
const twiceDaily = (cattle_id: string, to: string, days: number, perMilking: string) =>
  Array.from({ length: days }, (_, i) => addDays(to, -i)).flatMap((d) => [row(cattle_id, d, perMilking, 'morning'), row(cattle_id, d, perMilking, 'evening')]);

const cow = (id: string, extra: Partial<Cattle> = {}) =>
  ({ id, ear_tag: id, name: null, sex: 'female', status: 'active', production_status: 'lactating', reproductive_status: 'open', version: 1, ...extra }) as Cattle;
const care = (extra: Partial<CareData> = {}): CareData => ({ health: [], visits: [], treatments: [], breeding: [], checks: [], calvings: [], vaccinations: [], schedules: [], actions: [], ...extra });
const action = (extra: Partial<AlertAction>): AlertAction => ({
  id: 'a1',
  cattle_id: 'daisy',
  alert_type: 'milk_drop',
  alert_reason: null,
  action_taken: 'checked_feed_water',
  action_on: TODAY,
  notes: null,
  status: 'monitoring',
  follow_up_on: addDays(TODAY, 3),
  resolved_on: null,
  outcome: null,
  deleted_at: null,
  delete_reason: null,
  version: 1,
  ...extra,
});

// The proposal's example: a cow that usually gives 18 L a day gives 11 L.
const usual18 = twiceDaily('daisy', addDays(TODAY, -2), 7, '9');
const dropTo11 = [...usual18, row('daisy', addDays(TODAY, -1), '6', 'morning'), row('daisy', addDays(TODAY, -1), '5', 'evening')];

describe('sudden milk drop', () => {
  it('flags 11 L against a usual 18 L the next morning, saying what triggered it', () => {
    expect(suddenDrop(dropTo11, 'daisy', TODAY)).toMatchObject({ date: '2026-10-27', dayCl: 1100, usualCl: 1800, changePct: -38.9, sessions: 2, usualSessions: 2 });
    const [alert] = milkAlerts(dropTo11, [cow('daisy')], care(), TODAY, DEFAULT_DECLINE_RULE);
    expect(alert).toMatchObject({ type: 'milk_drop', title: 'Milk down 38.9% yesterday', reason: '11.00 L yesterday (2026-10-27), usually 18.00 L a day' });
    expect(alert.steps[0]).toMatch(/Check the milk record/);
    expect(alert.steps.at(-1)).toMatch(/call your vet/);
  });

  it('does not flag a normal day, or a small dip', () => {
    expect(suddenDrop([...usual18, ...twiceDaily('daisy', addDays(TODAY, -1), 1, '8')], 'daisy', TODAY)).toBeNull();
  });

  it('suspects a missing milking first when fewer milkings than usual are recorded', () => {
    const halfDay = [...usual18, row('daisy', addDays(TODAY, -1), '9', 'morning')];
    const [alert] = milkAlerts(halfDay, [cow('daisy')], care(), TODAY, DEFAULT_DECLINE_RULE);
    expect(alert.steps[0]).toBe('Check the record first: only 1 of her usual 2 milkings is recorded for that day.');
  });

  it('checks today once all her usual milkings are in', () => {
    const today = [...twiceDaily('daisy', addDays(TODAY, -1), 7, '9'), row('daisy', TODAY, '5', 'morning'), row('daisy', TODAY, '5', 'evening')];
    expect(suddenDrop(today, 'daisy', TODAY)?.date).toBe(TODAY);
    expect(suddenDrop(today.slice(0, -1), 'daisy', TODAY)).toBeNull(); // evening not yet recorded, yesterday was normal
  });

  it('needs at least 4 usual days to compare with', () => {
    expect(suddenDrop([...twiceDaily('daisy', addDays(TODAY, -2), 3, '9'), row('daisy', addDays(TODAY, -1), '5')], 'daisy', TODAY)).toBeNull();
  });

  it('mentions an open health concern and points to the vet', () => {
    const health = [{ id: 'h', cattle_id: 'daisy', suspected_issue: 'Mastitis', confirmed_diagnosis: null, recovery_status: 'ongoing', deleted_at: null }] as CareData['health'];
    const [alert] = milkAlerts(dropTo11, [cow('daisy')], care({ health }), TODAY, DEFAULT_DECLINE_RULE);
    expect(alert.steps.at(-1)).toBe('She has an open health concern (Mastitis). Tell your vet about the milk drop.');
  });
});

describe('acting on an alert', () => {
  it('holds the alert back while the farmer is watching her', () => {
    expect(milkAlerts(dropTo11, [cow('daisy')], care({ actions: [action({})] }), TODAY, DEFAULT_DECLINE_RULE)).toEqual([]);
  });

  it('a resolved action covers the drop it dealt with, but not a newer one', () => {
    const resolved = action({ status: 'resolved', resolved_on: TODAY, follow_up_on: null });
    expect(milkAlerts(dropTo11, [cow('daisy')], care({ actions: [resolved] }), TODAY, DEFAULT_DECLINE_RULE)).toEqual([]);
    const older = action({ status: 'resolved', action_on: '2026-10-20', resolved_on: '2026-10-21', follow_up_on: null });
    expect(milkAlerts(dropTo11, [cow('daisy')], care({ actions: [older] }), TODAY, DEFAULT_DECLINE_RULE)).toHaveLength(1);
  });

  it('a removed action no longer counts', () => {
    expect(milkAlerts(dropTo11, [cow('daisy')], care({ actions: [action({ deleted_at: TODAY })] }), TODAY, DEFAULT_DECLINE_RULE)).toHaveLength(1);
  });

  it('falls back to the steady decline rule when there is no single-day drop', () => {
    const slow = [...twiceDaily('daisy', addDays(TODAY, -8), 7, '10'), ...twiceDaily('daisy', addDays(TODAY, -1), 7, '7.5')];
    expect(milkAlerts(slow, [cow('daisy')], care(), TODAY, DEFAULT_DECLINE_RULE)).toEqual([
      expect.objectContaining({ type: 'milk_decline', title: 'Milk down 25%', since: addDays(TODAY, -7) }),
    ]);
  });

  it('only looks at active females', () => {
    expect(milkAlerts(dropTo11, [cow('daisy', { status: 'sold' })], care(), TODAY, DEFAULT_DECLINE_RULE)).toEqual([]);
  });
});

describe('missing milk records', () => {
  const herd = [cow('daisy'), cow('rosa'), cow('dry', { production_status: 'dry' })];
  const week = [...twiceDaily('daisy', addDays(TODAY, -1), 7, '9'), ...twiceDaily('rosa', addDays(TODAY, -2), 6, '8')];

  it('lists cows in milk with no entry for a milking that is over', () => {
    const at = new Date('2026-10-28T13:00:00'); // afternoon: this morning is over
    expect(missingMilkings(week, herd, TODAY, at)).toEqual([
      { date: '2026-10-27', session: 'morning', cattleIds: ['rosa'], of: 2 },
      { date: '2026-10-27', session: 'evening', cattleIds: ['rosa'], of: 2 },
      { date: TODAY, session: 'morning', cattleIds: ['daisy', 'rosa'], of: 2 },
    ]);
  });

  it('does not expect the milking in progress, or sessions the farm never records', () => {
    const early = new Date('2026-10-28T07:00:00');
    expect(missingMilkings(week, herd, TODAY, early).map((m) => `${m.date} ${m.session}`)).toEqual(['2026-10-27 morning', '2026-10-27 evening']);
  });

  it('says nothing for a farm that does not record milk per cow', () => {
    expect(missingMilkings([], herd, TODAY, new Date('2026-10-28T20:00:00'))).toEqual([]);
  });
});

describe('unusual amount when saving', () => {
  const week = twiceDaily('daisy', addDays(TODAY, -1), 7, '9');

  it('asks about far more or far less than her usual for that milking', () => {
    expect(unusualAmount(week, 'daisy', 'morning', TODAY, '25')).toEqual({ direction: 'high', usualCl: 900 });
    expect(unusualAmount(week, 'daisy', 'morning', TODAY, '4')).toEqual({ direction: 'low', usualCl: 900 });
    expect(unusualAmount(week, 'daisy', 'morning', TODAY, '11')).toBeNull();
  });

  it('without enough history, only questions an impossible amount', () => {
    expect(unusualAmount([], 'daisy', 'morning', TODAY, '25')).toBeNull();
    expect(unusualAmount([], 'daisy', 'morning', TODAY, '45')).toEqual({ direction: 'high', usualCl: 0 });
  });
});
