import { describe, expect, it } from 'vitest';
import { nextEarTag } from '../src/animals/model';

const herd = (...tags: (string | null)[]) => tags.map((ear_tag) => ({ ear_tag }));

describe('the ear tag offered for a new animal', () => {
  it('starts at C001', () => {
    expect(nextEarTag([])).toBe('C001');
    expect(nextEarTag(herd(null, 'KX-12', 'Daisy'))).toBe('C001');
  });

  it('follows the highest C-number, so a gap is not reused later by surprise', () => {
    expect(nextEarTag(herd('C001', 'C002'))).toBe('C003');
    expect(nextEarTag(herd('C001', 'C007'))).toBe('C008');
  });

  it('never repeats a tag, whatever its letter case or spacing', () => {
    expect(nextEarTag(herd('c004 '))).toBe('C005');
    expect(nextEarTag(herd('C0009', 'C010'))).toBe('C011');
  });

  it('carries on past C999', () => {
    expect(nextEarTag(herd('C999'))).toBe('C1000');
  });
});
