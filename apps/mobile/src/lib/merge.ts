// Three-way merge for a form edited on this phone while another phone saved the same record.
// base = what the form started from; mine = this phone's edit; saved = what the account has now.

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Keeps each side's changes. A field both sides changed, to different values, is a clash for the farmer
 * to decide; everything else merges on its own.
 */
export function threeWayMerge<T extends object>(base: T, mine: T, saved: T): { merged: T; clashes: (keyof T)[] } {
  const keys = [...new Set([...Object.keys(base), ...Object.keys(mine), ...Object.keys(saved)])] as (keyof T)[];
  const merged = { ...saved };
  const clashes: (keyof T)[] = [];
  for (const k of keys) {
    const mineChanged = !same(mine[k], base[k]);
    const theirsChanged = !same(saved[k], base[k]);
    if (mineChanged && theirsChanged && !same(mine[k], saved[k])) clashes.push(k);
    if (mineChanged) merged[k] = mine[k];
  }
  return { merged, clashes };
}
