import { describe, expect, it } from 'vitest';
import type { CareData, Treatment } from '../src/care/model';
import { relatedRecords, withdrawalCovering } from '../src/care/related';

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

describe('the withdrawal behind restricted milk', () => {
  it('finds the treatment whose withdrawal covers that milking', () => {
    const t = [treatment()];
    expect(withdrawalCovering(t, 'cow', '2026-10-25', 'morning')?.id).toBe('t1');
    expect(withdrawalCovering(t, 'cow', '2026-10-25', 'evening')).toBeUndefined(); // ended at 10:00
    expect(withdrawalCovering(t, 'cow', '2026-10-19', 'morning')).toBeUndefined(); // before the treatment
  });
});
