import { describe, expect, it } from 'vitest';
import type { CareData, Treatment } from '../src/care/model';
import { milkHeldBack, relatedRecords, storyOf, withdrawalCovering } from '../src/care/related';

const base = { deleted_at: null, delete_reason: null, version: 1 };
const care = (extra: Partial<CareData> = {}): CareData => ({ health: [], visits: [], treatments: [], breeding: [], checks: [], calvings: [], vaccinations: [], schedules: [], actions: [], ...extra });
const treatment = (extra: Partial<Treatment> = {}): Treatment => ({
  ...base,
  id: 't1',
  cattle_id: 'cow',
  health_record_id: 'h1',
  medication: 'Oxytetracycline',
  dosage_instructions: null,
  administered_by: null,
  started_on: '2026-10-20',
  completed_on: null,
  requires_milk_withdrawal: true,
  withdrawal_period_text: null,
  withdrawal_ends_at: '2026-10-25T10:00:00',
  withdrawal_source: null,
  withdrawal_cleared_at: null,
  withdrawal_clearance_note: null,
  notes: null,
  ...extra,
});
const health = { ...base, id: 'h1', cattle_id: 'cow' } as CareData['health'][number];
const visit = { ...base, id: 'v1', cattle_id: 'cow', health_record_id: 'h1', visit_at: '2026-10-19T09:00:00Z' } as CareData['visits'][number];

describe('related records', () => {
  it('links a health concern and its treatments and vet visits, both ways', () => {
    const data = care({ health: [health], treatments: [treatment(), treatment({ id: 't2', deleted_at: '2026-10-21' })], visits: [visit] });
    expect(relatedRecords('health', { id: 'h1' }, data)).toEqual([
      { kind: 'treatment', id: 't1', title: 'Treatment' },
      { kind: 'vet-visit', id: 'v1', title: 'Vet visit' },
    ]);
    expect(relatedRecords('treatment', treatment() as never, data)).toEqual([{ kind: 'health', id: 'h1', title: 'For health concern' }]);
    // A link to a removed concern is not offered.
    expect(relatedRecords('vet-visit', visit as never, care({ health: [{ ...health, deleted_at: '2026-10-22' }] }))).toEqual([]);
  });

  it('links a mating and its pregnancy check', () => {
    const mating = { ...base, id: 'b1', cattle_id: 'cow' } as CareData['breeding'][number];
    const check = { ...base, id: 'c1', cattle_id: 'cow', breeding_record_id: 'b1' } as CareData['checks'][number];
    const data = care({ breeding: [mating], checks: [check] });
    expect(relatedRecords('breeding', { id: 'b1' }, data)).toEqual([{ kind: 'pregnancy-check', id: 'c1', title: 'Pregnancy check' }]);
    expect(relatedRecords('pregnancy-check', check as never, data)).toEqual([{ kind: 'breeding', id: 'b1', title: 'For breeding' }]);
  });
});

describe('stories across records', () => {
  const mating = { ...base, id: 'b1', cattle_id: 'cow', event_type: 'artificial_insemination' } as CareData['breeding'][number];
  const check = { ...base, id: 'c1', cattle_id: 'cow', breeding_record_id: 'b1', result: 'pregnant' } as CareData['checks'][number];
  const calving = { ...base, id: 'k1', dam_id: 'cow', calf_id: 'calf', pregnancy_check_id: 'c1' } as CareData['calvings'][number];

  it('follows a mating through its pregnancy check to the calving, both ways', () => {
    const data = care({ breeding: [mating], checks: [check], calvings: [calving] });
    expect(relatedRecords('calving', calving as never, data)).toEqual([
      { kind: 'pregnancy-check', id: 'c1', title: 'From pregnancy check' },
      { kind: 'breeding', id: 'b1', title: 'From breeding' },
    ]);
    expect(relatedRecords('breeding', { id: 'b1' }, data).map((r) => r.kind)).toEqual(['pregnancy-check', 'calving']);
    expect(storyOf('calving', 'k1', data).map((r) => r.id).sort()).toEqual(['b1', 'c1', 'k1']);
  });

  it('links an action on a milk alert and the health concern it led to', () => {
    const action = { ...base, id: 'a1', cattle_id: 'cow', health_record_id: 'h1' } as CareData['actions'][number];
    const data = care({ health: [health], actions: [action], visits: [visit] });
    expect(relatedRecords('action', action as never, data)).toEqual([{ kind: 'health', id: 'h1', title: 'Led to health concern' }]);
    expect(storyOf('health', 'h1', data).map((r) => r.id).sort()).toEqual(['a1', 'h1', 'v1']);
  });

  it('counts the milk a withdrawal held back', () => {
    const milk = [
      { cattle_id: 'cow', production_date: '2026-10-21', session: 'morning' as const, quantity: '8.5', restricted: true, status: 'valid' },
      { cattle_id: 'cow', production_date: '2026-10-21', session: 'evening' as const, quantity: '6', restricted: true, status: 'valid' },
      { cattle_id: 'cow', production_date: '2026-10-26', session: 'morning' as const, quantity: '9', restricted: false, status: 'valid' },
    ];
    expect(milkHeldBack(treatment(), [treatment()], milk)).toEqual({ milkings: 2, litres: 14.5 });
  });
});

describe('the withdrawal behind restricted milk', () => {
  it('finds the treatment whose withdrawal covers that milking', () => {
    const t = [treatment()];
    expect(withdrawalCovering(t, 'cow', '2026-10-25', 'morning')?.id).toBe('t1');
    expect(withdrawalCovering(t, 'cow', '2026-10-25', 'evening')).toBeUndefined(); // ended at 10:00
    expect(withdrawalCovering(t, 'cow', '2026-10-19', 'morning')).toBeUndefined(); // before the treatment
  });
});
