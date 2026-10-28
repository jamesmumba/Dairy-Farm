import { describe, expect, it } from 'vitest';
import { dark, light } from '../src/ui/palette';

// WCAG 2.2 contrast for every text/background pair the components use.

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

type Key = keyof typeof light;
const TEXT: [Key, Key][] = [
  ['text', 'background'],
  ['text', 'surface'],
  ['textMuted', 'background'],
  ['textMuted', 'surface'],
  ['primary', 'background'],
  ['primary', 'surface'],
  ['primary', 'primarySoft'],
  ['text', 'primarySoft'],
  ['onPrimary', 'primary'],
  ['danger', 'background'],
  ['danger', 'surface'],
  ['danger', 'dangerSoft'],
  ['text', 'dangerSoft'],
  ['attention', 'attentionSoft'],
  ['text', 'attentionSoft'],
  ['info', 'infoSoft'],
  ['text', 'infoSoft'],
  ['onHero', 'hero'],
  ['heroMuted', 'hero'],
  ['onDanger', 'danger'],
];

describe.each([
  ['light', light],
  ['dark', dark],
])('%s palette', (_, p) => {
  it.each(TEXT)('%s on %s is at least 4.5:1', (fg, bg) => {
    expect(ratio(p[fg], p[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it('chart marks are at least 3:1 against the surface and the background', () => {
    expect(ratio(p.chart, p.surface)).toBeGreaterThanOrEqual(3);
    expect(ratio(p.chart, p.background)).toBeGreaterThanOrEqual(3);
  });
});
