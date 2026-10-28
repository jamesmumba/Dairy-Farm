// Likely duplicates that can only come from two phones adding the same thing while offline: two customers
// with the same name or phone, or two untagged animals with the same name, sex and birth date. Tagged animals
// cannot clash (the account refuses a second use of an ear tag). Pure, so it can be tested.

import type { Cattle } from '../animals/model';
import type { Customer } from '../finance/model';
import type { Reminder } from './reminders';

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
/** Last 9 digits, so "+260 97 123 4567" and "0971234567" match. */
const phoneKey = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '').slice(-9);

export const duplicateKey = (kind: 'customer' | 'animal', a: string, b: string) => `dup:${kind}:${[a, b].sort().join(':')}`;

function pairs<T extends { id: string }>(items: T[], same: (x: T, y: T) => boolean): [T, T][] {
  const out: [T, T][] = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) if (same(items[i], items[j])) out.push([items[i], items[j]]);
  return out;
}

export function findDuplicates(
  customers: Customer[],
  animals: Pick<Cattle, 'id' | 'ear_tag' | 'name' | 'sex' | 'birth_date' | 'status'>[],
  dismissed: Set<string>,
  today: string,
): Reminder[] {
  const out: Reminder[] = [];
  const active = customers.filter((c) => c.active);
  for (const [x, y] of pairs(active, (a, b) => (!!norm(a.name) && norm(a.name) === norm(b.name)) || (phoneKey(a.phone).length >= 7 && phoneKey(a.phone) === phoneKey(b.phone)))) {
    const key = duplicateKey('customer', x.id, y.id);
    if (dismissed.has(key)) continue;
    out.push({
      key,
      kind: 'possible_duplicate',
      urgency: 'active',
      due: today,
      cattleId: '',
      title: `Possible duplicate customer: ${x.name}${norm(x.name) === norm(y.name) ? '' : ` and ${y.name}`}`,
      detail: norm(x.name) === norm(y.name) ? 'Two customers with the same name' : 'Two customers with the same phone number',
      href: `/duplicate?kind=customer&a=${x.id}&b=${y.id}`,
      notifyOffsets: [],
    });
  }
  const untagged = animals.filter((a) => a.status === 'active' && !a.ear_tag && norm(a.name));
  for (const [x, y] of pairs(untagged, (a, b) => norm(a.name) === norm(b.name) && a.sex === b.sex && (a.birth_date ?? '') === (b.birth_date ?? ''))) {
    const key = duplicateKey('animal', x.id, y.id);
    if (dismissed.has(key)) continue;
    out.push({
      key,
      kind: 'possible_duplicate',
      urgency: 'active',
      due: today,
      cattleId: '',
      title: `Possible duplicate animal: ${x.name}`,
      detail: 'Two untagged animals with the same name, sex and birth date',
      href: `/duplicate?kind=animal&a=${x.id}&b=${y.id}`,
      notifyOffsets: [],
    });
  }
  return out;
}
