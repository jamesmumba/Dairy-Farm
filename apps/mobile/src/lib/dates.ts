// Date helpers with no UI dependencies (also used by tests).

/** Local calendar date as YYYY-MM-DD (toISOString would shift it by the UTC offset). */
export function toDateString(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function fromDateString(s: string) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function formatDate(s: string | null, format = 'DD/MM/YYYY') {
  if (!s) return '';
  const [y, m, d] = s.split('-');
  return format === 'YYYY-MM-DD' ? s : `${d}/${m}/${y}`;
}

/** "28/10/2026 14:30" in the phone's local time. */
export function formatDateTime(iso: string | null, format = 'DD/MM/YYYY') {
  if (!iso) return '';
  const d = new Date(iso);
  return `${formatDate(toDateString(d), format)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** The calendar date of a moment in the farm's time zone (sales and payments belong to farm days). */
export function farmDateOf(iso: string, timeZone = 'Africa/Lusaka') {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}
