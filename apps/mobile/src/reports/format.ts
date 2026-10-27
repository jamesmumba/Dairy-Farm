// Turns a Report into a CSV file or the HTML of a PDF. Pure, no I/O.

import { formatDate } from '../lib/dates';
import type { Report } from './build';

/**
 * One CSV cell. Quotes when needed, and neutralises spreadsheet formulas (a text starting
 * with = + - @ would be executed by Excel), except plain negative numbers.
 */
export function csvCell(value: string): string {
  let v = value ?? '';
  if (/^[=+\-@\t\r]/.test(v) && !/^-?\d+(\.\d+)?$/.test(v)) v = `'${v}`;
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

const line = (cells: string[]) => cells.map(csvCell).join(',');

export function toCsv(report: Report): string {
  const out: string[] = [
    line(['Report', report.title]),
    line(['Period', report.period ? `${report.period.from} to ${report.period.to}` : 'Current']),
    ...Object.entries(report.filters).map(([k, v]) => line([`Filter: ${k}`, v])),
    line(['Generated', report.generatedAt]),
    line(['Units', report.units]),
    line(['Source', 'Records on this phone']),
    '',
    line(['Summary', '']),
    ...report.summary.map((s) => line([s.label, s.value, s.note ?? ''])),
  ];
  for (const t of report.tables) {
    out.push('', line([t.title]), line(t.columns.map((c) => c.label)));
    for (const row of t.rows) out.push(line(t.columns.map((c) => row[c.key] ?? '')));
  }
  out.push('', line(['Definitions']), ...report.definitions.map((d) => line([d])));
  if (report.missing.length) out.push('', line(['Missing or incomplete']), ...report.missing.map((m) => line([m])));
  // BOM so Excel opens UTF-8 (names with accents, the ✓ sign) correctly.
  return `﻿${out.join('\r\n')}\r\n`;
}

export const escapeHtml = (s: string) => (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function toHtml(report: Report, farmName: string | null): string {
  const e = escapeHtml;
  const period = report.period ? `${formatDate(report.period.from)} – ${formatDate(report.period.to)}` : 'Current';
  const filters = Object.entries(report.filters)
    .map(([k, v]) => `${e(k)}: ${e(v)}`)
    .join(' · ');
  const tables = report.tables
    .map(
      (t) => `
      <h2>${e(t.title)}</h2>
      ${
        t.rows.length
          ? `<table><thead><tr>${t.columns.map((c) => `<th class="${c.numeric ? 'n' : ''}">${e(c.label)}</th>`).join('')}</tr></thead>
             <tbody>${t.rows.map((r) => `<tr>${t.columns.map((c) => `<td class="${c.numeric ? 'n' : ''}">${e(r[c.key] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table>`
          : `<p class="muted">${e(t.empty ?? 'No records.')}</p>`
      }`,
    )
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${e(report.title)}</title>
<style>
  body { font-family: -apple-system, Roboto, Arial, sans-serif; color: #1B1F1C; font-size: 11pt; margin: 24px; }
  h1 { font-size: 18pt; margin: 0 0 4px; } h2 { font-size: 13pt; margin: 20px 0 6px; }
  .muted { color: #4A524C; } .meta { margin-bottom: 12px; }
  table { border-collapse: collapse; width: 100%; } th, td { border-bottom: 1px solid #C5CCC6; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { font-weight: 600; } .n { text-align: right; font-variant-numeric: tabular-nums; }
  .summary td:first-child { width: 55%; } .warn { color: #B3261E; }
</style></head><body>
  <h1>${e(report.title)}</h1>
  <div class="meta muted">${farmName ? `${e(farmName)} · ` : ''}${e(period)}${filters ? ` · ${filters}` : ''}<br>
  Generated ${e(new Date(report.generatedAt).toLocaleString())} from records on this phone · Units: ${e(report.units)}</div>
  <table class="summary"><tbody>${report.summary
    .map((s) => `<tr><td>${e(s.label)}${s.note ? `<br><span class="muted">${e(s.note)}</span>` : ''}</td><td class="n"><strong>${e(s.value)}</strong></td></tr>`)
    .join('')}</tbody></table>
  ${report.missing.length ? `<h2 class="warn">Missing or incomplete</h2><ul>${report.missing.map((m) => `<li>${e(m)}</li>`).join('')}</ul>` : ''}
  ${tables}
  <h2>Definitions</h2><ul>${report.definitions.map((d) => `<li>${e(d)}</li>`).join('')}</ul>
</body></html>`;
}
