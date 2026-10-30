import { describe, expect, it } from 'vitest';
import type { FormContext } from '../src/care/forms';
import type { CareData, Vaccination } from '../src/care/model';
import { groupDoses, isGroup, quickChange, recordActions, reminderActions, sheetDefaults } from '../src/care/quick';
import type { Reminder } from '../src/care/reminders';

const TODAY = '2026-10-28';
const NOW = new Date('2026-10-28T09:00:00Z');
const base = { deleted_at: null, delete_reason: null, version: 1 };
const care = (extra: Partial<CareData> = {}): CareData => ({ health: [], visits: [], treatments: [], breeding: [], checks: [], calvings: [], vaccinations: [], schedules: [], actions: [], ...extra });
const ctx = (extra: Partial<CareData> = {}): FormContext => ({ today: TODAY, now: NOW.toISOString(), care: care(extra), animals: [], intervals: { pregnancy_check_days: 35, gestation_days: 283 } });

const vaccination = (extra: Partial<Vaccination> = {}): Vaccination => ({
  ...base,
  id: 'v1',
  cattle_id: 'cow',
  schedule_id: 's1',
  vaccine_name: 'FMD',
  target_disease: 'Foot and mouth',
  due_on: TODAY,
  administered_on: null,
  status: 'scheduled',
  batch_number: null,
  dosage_as_directed: null,
  administered_by: null,
  next_due_on: null,
  is_booster: false,
  group_batch_id: null,
  group_label: null,
  group_definition: null,
  notes: null,
  ...extra,
});
const values = (date = TODAY, date2: string | null = null, text = '') => ({ date, date2, text });

describe('which answers a reminder or record offers', () => {
  it('asks the question each reminder is about, usual answer first', () => {
    expect(reminderActions({ kind: 'vaccination' })).toEqual(['given', 'missed']);
    expect(reminderActions({ kind: 'heat_watch' })).toEqual(['saw_heat', 'no_heat']);
    expect(reminderActions({ kind: 'withdrawal' })).toEqual([]); // information only
  });

  it('offers answers only while the record is still waiting', () => {
    expect(recordActions('vaccination', vaccination() as never, ctx(), NOW)).toEqual(['given', 'missed']);
    expect(recordActions('vaccination', vaccination({ status: 'completed' }) as never, ctx(), NOW)).toEqual([]);
    const t = { cattle_id: 'cow', started_on: '2026-10-20', completed_on: null, requires_milk_withdrawal: true, withdrawal_ends_at: '2026-10-27T10:00:00Z', withdrawal_cleared_at: null };
    expect(recordActions('treatment', t, ctx(), NOW)).toEqual(['course_finished', 'milk_cleared']);
    expect(recordActions('treatment', { ...t, withdrawal_ends_at: '2026-10-29T10:00:00Z' }, ctx(), NOW)).toEqual(['course_finished']);
  });
});

describe('vaccination', () => {
  it('given: fills the next dose from the schedule interval, and saves it so the server books it', () => {
    const schedules = [{ ...base, id: 's1', vaccine_name: 'FMD', target_disease: null, interval_days: 180, reminder_offsets_days: [], guidance_source: null, active: true }];
    const v = sheetDefaults('given', 'vaccination', vaccination() as never, ctx({ schedules }));
    expect(v.date2).toBe('2027-04-26');
    expect(quickChange('given', 'vaccination', vaccination() as never, { ...v, text: 'B-77' }, NOW, TODAY)).toEqual({
      update: { status: 'completed', administered_on: TODAY, batch_number: 'B-77', next_due_on: '2027-04-26' },
    });
  });

  it('given: no future date, and the next dose after this one', () => {
    expect(quickChange('given', 'vaccination', vaccination() as never, values('2026-10-29'), NOW, TODAY)).toEqual({ error: 'The date cannot be in the future.' });
    expect(quickChange('given', 'vaccination', vaccination() as never, values(TODAY, TODAY), NOW, TODAY)).toHaveProperty('error');
  });

  it('missed: keeps the missed dose and books a new one for the chosen day', () => {
    const change = quickChange('missed', 'vaccination', vaccination({ group_batch_id: 'g', group_label: 'Herd' }) as never, values(TODAY, '2026-11-04'), NOW, TODAY);
    expect(change).toMatchObject({
      update: { status: 'missed' },
      create: { kind: 'vaccination', fields: { cattle_id: 'cow', vaccine_name: 'FMD', due_on: '2026-11-04', status: 'scheduled', group_batch_id: 'g', group_label: 'Herd' } },
    });
    expect(quickChange('missed', 'vaccination', vaccination() as never, values(TODAY, '2026-10-27'), NOW, TODAY)).toHaveProperty('error');
  });
});

describe('treatment', () => {
  const t = { cattle_id: 'cow', started_on: '2026-10-20', requires_milk_withdrawal: true, withdrawal_ends_at: '2026-10-27T10:00:00Z' };
  it('course finished on a date not before the start', () => {
    expect(quickChange('course_finished', 'treatment', t, values(), NOW, TODAY)).toEqual({ update: { completed_on: TODAY } });
    expect(quickChange('course_finished', 'treatment', t, values('2026-10-19'), NOW, TODAY)).toHaveProperty('error');
  });
  it('milk cleared now, only once the withdrawal has ended', () => {
    expect(quickChange('milk_cleared', 'treatment', t, values(TODAY, null, ' vet ok '), NOW, TODAY)).toEqual({ update: { withdrawal_cleared_at: NOW.toISOString(), withdrawal_clearance_note: 'vet ok' } });
    expect(quickChange('milk_cleared', 'treatment', { ...t, withdrawal_ends_at: '2026-10-29T10:00:00Z' }, values(), NOW, TODAY)).toHaveProperty('error');
  });
});

describe('pregnancy check', () => {
  const mating = { ...base, id: 'b1', cattle_id: 'cow', event_type: 'artificial_insemination' as const, event_at: '2026-09-01T08:00:00Z', bull_or_semen_id: null, performed_by: null, notes: null };
  const check = { id: 'c1', cattle_id: 'cow', breeding_record_id: null, scheduled_on: '2026-10-06', examined_on: null, result: 'pending' };

  it('pregnant: expected calving prefilled from her mating and the gestation interval', () => {
    const v = sheetDefaults('pregnant', 'pregnancy-check', check, ctx({ breeding: [mating] }));
    expect(v.date2).toBe('2027-06-11');
    expect(quickChange('pregnant', 'pregnancy-check', check, v, NOW, TODAY)).toEqual({ update: { result: 'pregnant', examined_on: TODAY, examiner: null, expected_calving_on: '2027-06-11' } });
  });

  it('not pregnant or unclear never keeps a calving date', () => {
    expect(quickChange('unclear', 'pregnancy-check', check, values(TODAY, '2027-06-11'), NOW, TODAY)).toMatchObject({ update: { result: 'inconclusive', expected_calving_on: null } });
  });

  it('a confirmed pregnancy with no calving since offers to record the calving', () => {
    const pregnant = { ...check, result: 'pregnant', examined_on: '2026-10-06' };
    expect(recordActions('pregnancy-check', pregnant, ctx(), NOW)).toEqual(['record_calving']);
    const calving = { ...base, id: 'k', dam_id: 'cow', calf_id: null, calved_on: '2027-06-10', outcome: 'live' as const, complications: null, dry_off_on: null, observations: null };
    expect(recordActions('pregnancy-check', pregnant, ctx({ calvings: [calving] }), NOW)).toEqual([]);
  });
});

describe('heat and follow-ups', () => {
  it('saw heat adds a heat record after the mating', () => {
    const mating = { cattle_id: 'cow', event_at: '2026-10-07T08:00:00Z' };
    expect(quickChange('saw_heat', 'breeding', mating, values(), NOW, TODAY)).toEqual({
      create: { kind: 'breeding', fields: { cattle_id: 'cow', event_type: 'heat_observed', event_at: NOW.toISOString(), notes: null } },
    });
    expect(quickChange('saw_heat', 'breeding', mating, values('2026-10-06'), NOW, TODAY)).toHaveProperty('error');
  });

  it('recovered keeps the date and note in the record’s notes', () => {
    const h = { cattle_id: 'cow', reported_on: '2026-10-20', notes: 'Limping', recovery_status: 'ongoing' };
    expect(quickChange('recovered', 'health', h, values(TODAY, null, 'walking well'), NOW, TODAY)).toEqual({
      update: { recovery_status: 'recovered', notes: 'Limping\nRecovered on 2026-10-28: walking well' },
    });
  });

  it('not yet moves the follow-up to a day not in the past', () => {
    const a = { cattle_id: 'cow', action_on: '2026-10-25', notes: null, status: 'monitoring' };
    expect(sheetDefaults('not_yet', 'action', a, ctx()).date2).toBe('2026-10-31');
    expect(quickChange('not_yet', 'action', a, values(TODAY, '2026-10-29'), NOW, TODAY)).toEqual({ update: { follow_up_on: '2026-10-29' } });
    expect(quickChange('not_yet', 'action', a, values(TODAY, '2026-10-27'), NOW, TODAY)).toHaveProperty('error');
  });

  it('resolved not before the action', () => {
    const a = { cattle_id: 'cow', action_on: '2026-10-25', notes: null };
    expect(quickChange('resolved', 'action', a, values(TODAY, null, 'Back to 18 L'), NOW, TODAY)).toEqual({ update: { status: 'resolved', resolved_on: TODAY, outcome: 'Back to 18 L' } });
    expect(quickChange('resolved', 'action', a, values('2026-10-24'), NOW, TODAY)).toHaveProperty('error');
  });
});

describe('group doses', () => {
  const reminder = (id: string, cattleId: string): Reminder => ({ key: `vaccination:${id}`, kind: 'vaccination', urgency: 'today', due: TODAY, cattleId, title: 'FMD due', detail: '', record: { kind: 'vaccination', id }, notifyOffsets: [] });

  it('shows doses given to a group together as one row', () => {
    const vs = ['a', 'b', 'c'].map((c) => vaccination({ id: `v-${c}`, cattle_id: c, group_batch_id: 'g1', group_label: 'Milking herd' }));
    const other = reminder('v-x', 'x');
    const rows = groupDoses([reminder('v-a', 'a'), other, reminder('v-b', 'b'), reminder('v-c', 'c')], [...vs, vaccination({ id: 'v-x', cattle_id: 'x' })]);
    expect(rows).toHaveLength(2);
    const [group, single] = rows;
    expect(isGroup(group) && group).toMatchObject({ title: 'FMD due · Milking herd', ids: ['v-a', 'v-b', 'v-c'], cattleIds: ['a', 'b', 'c'] });
    expect(single).toBe(other);
  });

  it('a group with one dose left is shown as that cow’s reminder', () => {
    const r = reminder('v-a', 'a');
    expect(groupDoses([r], [vaccination({ id: 'v-a', cattle_id: 'a', group_batch_id: 'g1' })])).toEqual([r]);
  });
});
