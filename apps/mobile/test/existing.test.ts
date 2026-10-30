import { describe, expect, it } from 'vitest';
import { findExisting, groupDosePlan } from '../src/care/existing';
import type { CareData, Vaccination } from '../src/care/model';
import { existingExpense, existingPayment, existingSale } from '../src/finance/existing';
import type { Expense, Payment, Sale } from '../src/finance/model';

const TODAY = '2026-10-28';
const base = { deleted_at: null, delete_reason: null, version: 1 };
const care = (extra: Partial<CareData> = {}): CareData => ({ health: [], visits: [], treatments: [], breeding: [], checks: [], calvings: [], vaccinations: [], schedules: [], actions: [], ...extra });
const dose = (extra: Partial<Vaccination>) => ({ ...base, id: 'v1', cattle_id: 'cow', vaccine_name: 'FMD', status: 'scheduled', due_on: '2026-11-04', administered_on: null, ...extra }) as Vaccination;

describe('care records already recorded', () => {
  it('a dose of the same vaccine booked or given within two weeks', () => {
    const data = care({ vaccinations: [dose({})] });
    expect(findExisting('vaccination', { cattle_id: 'cow', vaccine_name: 'fmd ', status: 'completed', administered_on: TODAY }, data, 'Daisy', TODAY)).toMatchObject({
      id: 'v1',
      message: 'Daisy already has FMD booked for 04/11/2026. If you gave that dose, open it and tap Given instead.',
    });
    expect(findExisting('vaccination', { cattle_id: 'cow', vaccine_name: 'FMD', due_on: '2027-04-01' }, data, 'Daisy', TODAY)).toBeNull(); // the next one
    expect(findExisting('vaccination', { cattle_id: 'cow', vaccine_name: 'Anthrax', due_on: '2026-11-04' }, data, 'Daisy', TODAY)).toBeNull();
  });

  it('a pending pregnancy check, such as the one booked after mating', () => {
    const check = { ...base, id: 'c1', cattle_id: 'cow', result: 'pending', scheduled_on: '2026-11-01' } as CareData['checks'][number];
    expect(findExisting('pregnancy-check', { cattle_id: 'cow', result: 'pregnant', examined_on: TODAY }, care({ checks: [check] }), 'Daisy', TODAY)?.message).toBe(
      'Daisy already has a pregnancy check planned for 01/11/2026. Open it to record this result there.',
    );
  });

  it('the same health issue still open, but not one she recovered from', () => {
    const h = { ...base, id: 'h1', cattle_id: 'cow', suspected_issue: 'Mastitis', confirmed_diagnosis: null, recovery_status: 'ongoing', reported_on: '2026-10-20' } as CareData['health'][number];
    expect(findExisting('health', { cattle_id: 'cow', suspected_issue: 'mastitis', reported_on: TODAY }, care({ health: [h] }), 'Daisy', TODAY)?.id).toBe('h1');
    expect(findExisting('health', { cattle_id: 'cow', suspected_issue: 'Mastitis', reported_on: TODAY }, care({ health: [{ ...h, recovery_status: 'recovered' }] }), 'Daisy', TODAY)).toBeNull();
    expect(findExisting('health', { cattle_id: 'cow', suspected_issue: 'Lameness', reported_on: TODAY }, care({ health: [h] }), 'Daisy', TODAY)).toBeNull();
  });

  it('the same medicine over the same days, and the same mating day', () => {
    const t = { ...base, id: 't1', cattle_id: 'cow', medication: 'Oxytetracycline', started_on: '2026-10-25', completed_on: null } as CareData['treatments'][number];
    expect(findExisting('treatment', { cattle_id: 'cow', medication: 'oxytetracycline', started_on: TODAY }, care({ treatments: [t] }), 'Daisy', TODAY)?.id).toBe('t1');
    expect(findExisting('treatment', { cattle_id: 'cow', medication: 'Oxytetracycline', started_on: TODAY }, care({ treatments: [{ ...t, completed_on: '2026-10-26' }] }), 'Daisy', TODAY)).toBeNull();
    const b = { ...base, id: 'b1', cattle_id: 'cow', event_type: 'artificial_insemination', event_at: '2026-10-28T06:00:00Z' } as CareData['breeding'][number];
    expect(findExisting('breeding', { cattle_id: 'cow', event_type: 'artificial_insemination', event_at: '2026-10-28T09:00:00Z' }, care({ breeding: [b] }), 'Daisy', TODAY)?.id).toBe('b1');
    expect(findExisting('breeding', { cattle_id: 'cow', event_type: 'heat_observed', event_at: '2026-10-28T09:00:00Z' }, care({ breeding: [b] }), 'Daisy', TODAY)).toBeNull();
  });

  it('a removed record never counts', () => {
    expect(findExisting('vaccination', { cattle_id: 'cow', vaccine_name: 'FMD', due_on: '2026-11-04' }, care({ vaccinations: [dose({ deleted_at: TODAY })] }), 'Daisy', TODAY)).toBeNull();
  });
});

describe('a dose given to a group', () => {
  it('completes a booked dose, skips cows already given it, and adds the rest', () => {
    const data = care({ vaccinations: [dose({ id: 'booked', cattle_id: 'a' }), dose({ id: 'given', cattle_id: 'b', status: 'completed', administered_on: '2026-10-26', due_on: null })] });
    const plan = groupDosePlan(['a', 'b', 'c'], 'FMD', TODAY, data);
    expect([...plan.complete]).toEqual([['a', 'booked']]);
    expect(plan.alreadyGiven).toEqual(['b']);
    expect(plan.fresh).toEqual(['c']);
  });
});

describe('money already recorded', () => {
  it('the same sale or payment within half an hour', () => {
    const sale = { id: 's1', customer_id: 'c1', quantity: '10.0', sale_at: '2026-10-28T08:00:00Z', status: 'completed' } as Sale;
    expect(existingSale([sale], { customer_id: 'c1', quantity: '10', sale_at: '2026-10-28T08:20:00Z' })?.id).toBe('s1');
    expect(existingSale([sale], { customer_id: 'c1', quantity: '10', sale_at: '2026-10-28T17:00:00Z' })).toBeNull(); // the evening sale
    const pay = { id: 'p1', customer_id: 'c1', kind: 'payment', amount: '50.00', paid_at: '2026-10-28T08:00:00Z', status: 'completed' } as Payment;
    expect(existingPayment([pay], { customer_id: 'c1', kind: 'payment', amount: '50', paid_at: '2026-10-28T08:10:00Z' })?.id).toBe('p1');
    expect(existingPayment([{ ...pay, status: 'voided' }], { customer_id: 'c1', kind: 'payment', amount: '50', paid_at: '2026-10-28T08:10:00Z' })).toBeNull();
  });

  it('the same expense on the same day', () => {
    const e = { id: 'e1', expense_date: TODAY, category: 'feed', amount: '300.00', currency: 'ZMW', status: 'active' } as Expense;
    expect(existingExpense([e], { expense_date: TODAY, category: 'feed', amount: '300', currency: 'ZMW' })?.id).toBe('e1');
    expect(existingExpense([e], { expense_date: TODAY, category: 'medicines', amount: '300', currency: 'ZMW' })).toBeNull();
  });
});
