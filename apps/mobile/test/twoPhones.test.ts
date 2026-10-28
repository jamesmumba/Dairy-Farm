import { describe, expect, it } from 'vitest';
import { duplicateKey, findDuplicates } from '../src/care/duplicates';
import { threeWayMerge } from '../src/lib/merge';
import type { Customer } from '../src/finance/model';

// What two phones on one account can produce, and how the app handles it.

const customer = (id: string, name: string, phone: string | null = null, active = true) => ({ id, name, phone, active }) as Customer;
const animal = (id: string, extra: object = {}) => ({ id, ear_tag: null, name: 'Daisy', sex: 'female' as const, birth_date: '2024-02-01', status: 'active' as const, ...extra });
const TODAY = '2026-10-28';

describe('likely duplicates from two phones', () => {
  it('finds two customers with the same name, whatever the spacing and case', () => {
    const found = findDuplicates([customer('a', 'Mrs Phiri'), customer('b', ' mrs  phiri '), customer('c', 'Mr Banda')], [], new Set(), TODAY);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: 'possible_duplicate', key: duplicateKey('customer', 'a', 'b'), href: '/duplicate?kind=customer&a=a&b=b' });
  });

  it('finds two customers with the same phone written differently', () => {
    const found = findDuplicates([customer('a', 'Grace', '+260 97 123 4567'), customer('b', 'Grace Phiri', '0971234567')], [], new Set(), TODAY);
    expect(found[0].detail).toBe('Two customers with the same phone number');
  });

  it('ignores inactive customers and pairs the farmer said are different', () => {
    expect(findDuplicates([customer('a', 'Mrs Phiri'), customer('b', 'Mrs Phiri', null, false)], [], new Set(), TODAY)).toEqual([]);
    expect(findDuplicates([customer('a', 'Mrs Phiri'), customer('b', 'Mrs Phiri')], [], new Set([duplicateKey('customer', 'b', 'a')]), TODAY)).toEqual([]);
  });

  it('finds untagged animals with the same name, sex and birth date only', () => {
    expect(findDuplicates([], [animal('x'), animal('y')], new Set(), TODAY)).toHaveLength(1);
    expect(findDuplicates([], [animal('x'), animal('y', { birth_date: '2024-03-01' })], new Set(), TODAY)).toEqual([]);
    expect(findDuplicates([], [animal('x', { ear_tag: 'ZM-1' }), animal('y', { ear_tag: 'ZM-2' })], new Set(), TODAY)).toEqual([]);
    expect(findDuplicates([], [animal('x'), animal('y', { status: 'sold' })], new Set(), TODAY)).toEqual([]);
  });
});

describe('settings saved on two phones at once', () => {
  const base = { farm_name: 'Mapalo', currency: 'ZMW', reminder_time: '06:00' };

  it('keeps both phones’ changes when they changed different fields', () => {
    const mine = { ...base, reminder_time: '05:30' };
    const saved = { ...base, farm_name: 'Mapalo Dairy' };
    expect(threeWayMerge(base, mine, saved)).toEqual({ merged: { farm_name: 'Mapalo Dairy', currency: 'ZMW', reminder_time: '05:30' }, clashes: [] });
  });

  it('does not undo the other phone’s change to a field this phone left alone', () => {
    const saved = { ...base, currency: 'USD' };
    expect(threeWayMerge(base, base, saved).merged.currency).toBe('USD');
  });

  it('asks only when both changed the same field to different values', () => {
    const mine = { ...base, farm_name: 'Mapalo Farm' };
    expect(threeWayMerge(base, mine, { ...base, farm_name: 'Mapalo Dairy' }).clashes).toEqual(['farm_name']);
    expect(threeWayMerge(base, mine, { ...base, farm_name: 'Mapalo Farm' }).clashes).toEqual([]);
  });

  it('compares nested settings by value', () => {
    const b = { prefs: { vaccinations: true, finance: true } };
    const mine = { prefs: { vaccinations: false, finance: true } };
    expect(threeWayMerge(b, mine, b)).toEqual({ merged: mine, clashes: [] });
  });
});
