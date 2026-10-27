import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// Static accessibility checks over every screen and component: interactive elements must
// tell screen readers what they are. (Contrast is fixed in the theme; text scaling relies on
// no fixed text heights; both are also checked by hand on devices — see docs/testing.md.)

const SRC = join(import.meta.dirname, '..', 'src');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith('.tsx') ? [path] : [];
  });
}

/** The opening tag of each <Name ...> element, braces and nested arrows handled. */
function openingTags(source: string, name: string): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = [];
  const re = new RegExp(`<${name}[\\s>]`, 'g');
  for (let m = re.exec(source); m; m = re.exec(source)) {
    let depth = 0;
    let i = m.index + 1;
    for (; i < source.length; i++) {
      const ch = source[i];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      else if (ch === '>' && depth === 0 && source[i - 1] !== '=') break;
    }
    out.push({ text: source.slice(m.index, i + 1), line: source.slice(0, m.index).split('\n').length });
  }
  return out;
}

const RULES: { element: string; needs: RegExp; why: string }[] = [
  { element: 'Pressable', needs: /accessibilityRole=/, why: 'says it is a button (accessibilityRole)' },
  { element: 'TextInput', needs: /accessibilityLabel=/, why: 'has a spoken label' },
  { element: 'Switch', needs: /accessibilityLabel=/, why: 'has a spoken label' },
  { element: 'Image', needs: /accessibilityLabel=/, why: 'describes the picture' },
];

describe('accessibility of interactive elements', () => {
  const all = files(SRC);

  it('scans the app (sanity)', () => {
    expect(all.length).toBeGreaterThan(40);
  });

  for (const rule of RULES) {
    it(`every <${rule.element}> ${rule.why}`, () => {
      const missing = all.flatMap((file) =>
        openingTags(readFileSync(file, 'utf8'), rule.element)
          .filter((tag) => !rule.needs.test(tag.text))
          .map((tag) => `${relative(SRC, file)}:${tag.line}`),
      );
      expect(missing).toEqual([]);
    });
  }

  it('gives every button a visible text label or an accessibility label', () => {
    // <Button label="..."> always renders its label; this catches empty labels.
    const empty = all.flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/<Button[^>]*\blabel=(""|\{''\})/g)].map(() => relative(SRC, file)));
    expect(empty).toEqual([]);
  });
});
