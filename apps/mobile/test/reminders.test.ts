import { describe, expect, it } from 'vitest';
import { activeWithdrawal, type CareData } from '../src/care/model';
import { computeReminders } from '../src/care/reminders';

const NOW = new Date('2026-10-28T09:00:00'); // local time; "today" is 2026-10-28
const base = { deleted_at: null, delete_reason: null, version: 1 };
const empty = (): CareData => ({ health: [], visits: [], treatments: [], breeding: [], checks: [], calvings: [], vaccinations: [], schedules: [], actions: [] });
const herd = new Set(['cow']);

const vaccination = (due_on: string, extra = {}) => ({
  ...base,
  id: `v-${due_on}`,
  cattle_id: 'cow',
  schedule_id: null,
  vaccine_name: 'Lumpy skin disease',
  target_disease: 'LSD',
  due_on,
  administered_on: null,
  status: 'scheduled' as const,
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

const treatment = (withdrawal_ends_at: string, extra = {}) => ({
  ...base,
  id: 't1',
  cattle_id: 'cow',
  health_record_id: null,
  medication: 'Oxytetracycline',
  dosage_instructions: null,
  administered_by: null,
  started_on: '2026-10-20',
  completed_on: '2026-10-22',
  requires_milk_withdrawal: true,
  withdrawal_period_text: null,
  withdrawal_ends_at,
  withdrawal_source: null,
  withdrawal_cleared_at: null,
  withdrawal_clearance_note: null,
  notes: null,
  ...extra,
});

describe('vaccination reminders (spec: due in seven days)', () => {
  it('shows a vaccination due in 7 days as upcoming, with 30/7/1-day notifications', () => {
    const data = { ...empty(), vaccinations: [vaccination('2026-11-04')] };
    expect(computeReminders(data, herd, NOW)).toEqual([
      expect.objectContaining({ kind: 'vaccination', urgency: 'upcoming', due: '2026-11-04', notifyOffsets: [30, 7, 1] }),
    ]);
  });

  it('turns overdue after the due date, and disappears once given', () => {
    expect(computeReminders({ ...empty(), vaccinations: [vaccination('2026-10-20')] }, herd, NOW)[0]).toMatchObject({ urgency: 'overdue', title: 'Lumpy skin disease overdue' });
    expect(computeReminders({ ...empty(), vaccinations: [vaccination('2026-10-20', { status: 'completed' })] }, herd, NOW)).toEqual([]);
  });

  it('uses the schedule’s own reminder days', () => {
    const schedule = { ...base, id: 's1', vaccine_name: 'FMD', target_disease: null, interval_days: 180, reminder_offsets_days: [14, 2], guidance_source: null, active: true };
    const data = { ...empty(), schedules: [schedule], vaccinations: [vaccination('2026-11-04', { schedule_id: 's1' })] };
    expect(computeReminders(data, herd, NOW)[0].notifyOffsets).toEqual([14, 2]);
  });

  it('drops reminders for animals no longer on the farm', () => {
    expect(computeReminders({ ...empty(), vaccinations: [vaccination('2026-11-04')] }, new Set(), NOW)).toEqual([]);
  });
});

describe('withdrawal', () => {
  it('is in force until the vet’s end time, even after treatment is complete (spec)', () => {
    const data = { ...empty(), treatments: [treatment('2026-10-29T10:00:00')] };
    expect(computeReminders(data, herd, NOW)[0]).toMatchObject({ kind: 'withdrawal', urgency: 'active' });
    expect(activeWithdrawal(data.treatments, 'cow', NOW)?.id).toBe('t1');
    expect(activeWithdrawal(data.treatments, 'cow', new Date('2026-10-29T10:00:01'))).toBeUndefined();
  });

  it('asks to confirm clearance for a week after it ends, until cleared', () => {
    const ended = { ...empty(), treatments: [treatment('2026-10-27T10:00:00')] };
    expect(computeReminders(ended, herd, NOW)[0]).toMatchObject({ kind: 'withdrawal_clearance' });
    const cleared = { ...empty(), treatments: [treatment('2026-10-27T10:00:00', { withdrawal_cleared_at: '2026-10-27T12:00:00' })] };
    expect(computeReminders(cleared, herd, NOW)).toEqual([]);
  });

  it('lists withdrawals before everything else', () => {
    const data = { ...empty(), treatments: [treatment('2026-10-29T10:00:00')], vaccinations: [vaccination('2026-10-01')] };
    expect(computeReminders(data, herd, NOW).map((r) => r.kind)).toEqual(['withdrawal', 'vaccination']);
  });
});

describe('breeding reminders', () => {
  const check = (extra: object) => ({
    ...base,
    id: 'c1',
    cattle_id: 'cow',
    breeding_record_id: null,
    scheduled_on: null,
    examined_on: null,
    result: 'pending' as const,
    examiner: null,
    expected_calving_on: null,
    notes: null,
    ...extra,
  });

  it('reminds of a pending pregnancy check, and marks it overdue after the date', () => {
    expect(computeReminders({ ...empty(), checks: [check({ scheduled_on: '2026-10-30' })] }, herd, NOW)[0]).toMatchObject({ kind: 'pregnancy_check', urgency: 'upcoming' });
    expect(computeReminders({ ...empty(), checks: [check({ scheduled_on: '2026-10-25' })] }, herd, NOW)[0]).toMatchObject({ urgency: 'overdue' });
  });

  it('reminds of expected calving only from a confirmed pregnancy, until a calving is recorded', () => {
    const pregnant = check({ examined_on: '2026-03-01', result: 'pregnant', expected_calving_on: '2026-11-10' });
    expect(computeReminders({ ...empty(), checks: [pregnant] }, herd, NOW)[0]).toMatchObject({ kind: 'expected_calving', urgency: 'upcoming' });
    const calving = { ...base, id: 'k1', dam_id: 'cow', calf_id: null, calved_on: '2026-10-27', outcome: 'live' as const, complications: null, dry_off_on: null, observations: null };
    expect(computeReminders({ ...empty(), checks: [pregnant], calvings: [calving] }, herd, NOW)).toEqual([]);
  });
});

describe('health follow-up', () => {
  it('reminds until the animal has recovered', () => {
    const record = {
      ...base,
      id: 'h1',
      cattle_id: 'cow',
      first_symptoms_on: null,
      reported_on: '2026-10-20',
      observations: null,
      suspected_issue: 'Mastitis',
      confirmed_diagnosis: null,
      condition_status: 'suspected' as const,
      severity: null,
      urgent: false,
      responsible_person: null,
      follow_up_on: '2026-10-28',
      recovery_status: 'ongoing' as const,
      notes: null,
    };
    expect(computeReminders({ ...empty(), health: [record] }, herd, NOW)[0]).toMatchObject({ urgency: 'today', detail: 'Mastitis' });
    expect(computeReminders({ ...empty(), health: [{ ...record, recovery_status: 'recovered' as const }] }, herd, NOW)).toEqual([]);
  });
});

describe('watch for heat after breeding', () => {
  const bred = (event_at: string, extra = {}) => ({ ...base, id: `b-${event_at}`, cattle_id: 'cow', event_type: 'artificial_insemination' as const, event_at, bull_or_semen_id: null, performed_by: null, notes: null, ...extra });

  it('reminds from day 18 to day 24 after the latest insemination', () => {
    const watch = (date: string) => computeReminders({ ...empty(), breeding: [bred(`${date}T08:00:00Z`)] }, herd, NOW).filter((r) => r.kind === 'heat_watch');
    expect(watch('2026-10-10')).toEqual([expect.objectContaining({ urgency: 'upcoming', due: '2026-10-31', notifyOffsets: [3] })]); // day 18
    expect(watch('2026-10-07')[0]).toMatchObject({ urgency: 'today', detail: expect.stringMatching(/^21 days since she was bred/) });
    expect(watch('2026-10-04')).toHaveLength(1); // day 24
    expect(watch('2026-10-03')).toEqual([]); // day 25
    expect(watch('2026-10-11')).toEqual([]); // day 17
  });

  it('stops once a heat, a check result or a calving answers it', () => {
    const mating = bred('2026-10-07T08:00:00Z');
    const heat = { ...mating, id: 'h', event_type: 'heat_observed' as const, event_at: '2026-10-27T06:00:00Z' };
    expect(computeReminders({ ...empty(), breeding: [mating, heat] }, herd, NOW).filter((r) => r.kind === 'heat_watch')).toEqual([]);
    const check = { ...base, id: 'c', cattle_id: 'cow', breeding_record_id: mating.id, scheduled_on: null, examined_on: '2026-10-27', result: 'pregnant' as const, examiner: null, expected_calving_on: '2027-07-17', notes: null };
    expect(computeReminders({ ...empty(), breeding: [mating], checks: [check] }, herd, NOW).filter((r) => r.kind === 'heat_watch')).toEqual([]);
    // An inconclusive result does not say whether she conceived: keep watching.
    const unclear = { ...check, result: 'inconclusive' as const, expected_calving_on: null };
    expect(computeReminders({ ...empty(), breeding: [mating], checks: [unclear] }, herd, NOW).filter((r) => r.kind === 'heat_watch')).toHaveLength(1);
  });
});

describe('follow-up of an action on an alert', () => {
  const action = (extra = {}) => ({
    ...base,
    id: 'a1',
    cattle_id: 'cow',
    alert_type: 'milk_drop' as const,
    alert_reason: '11 L, usually 18 L',
    action_taken: 'checked_feed_water' as const,
    action_on: '2026-10-25',
    notes: null,
    status: 'monitoring' as const,
    follow_up_on: '2026-10-28',
    resolved_on: null,
    outcome: null,
    ...extra,
  });

  it('brings the farmer back on the follow-up date until it is resolved', () => {
    expect(computeReminders({ ...empty(), actions: [action()] }, herd, NOW)).toEqual([
      expect.objectContaining({ kind: 'action_follow_up', urgency: 'today', title: 'Follow up: sudden milk drop', record: { kind: 'action', id: 'a1' } }),
    ]);
    expect(computeReminders({ ...empty(), actions: [action({ status: 'resolved', resolved_on: '2026-10-28' })] }, herd, NOW)).toEqual([]);
  });

  it('a new follow-up date is a new reminder', () => {
    const [a, b] = [action(), action({ follow_up_on: '2026-10-30' })].map((x) => computeReminders({ ...empty(), actions: [x] }, herd, NOW)[0].key);
    expect(a).not.toBe(b);
  });
});
