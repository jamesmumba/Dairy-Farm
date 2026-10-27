import { litres } from './calc';

export const SESSION_LABELS = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' } as const;

/** Litres for reading on screen: "10 L", "12.5 L", "12.25 L" (exports keep two decimals). */
export const L = (cl: number) => `${litres(cl).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')} L`;

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-21" → "Wed 21 Oct" */
export function dayLabel(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** Decimal string from what the farmer typed: "12,5" → "12.5". Null if not a valid amount. */
export function parseLitres(input: string): string | null {
  const v = input.trim().replace(',', '.');
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(v)) return null;
  const n = Number(v);
  return n > 0 && n <= 100 ? v : null;
}

export const LITRES_HINT = 'Enter litres, e.g. 12 or 12.5 (more than 0, at most 100 per session).';
