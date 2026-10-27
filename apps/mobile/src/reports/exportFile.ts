import { randomUUID } from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import { printToFileAsync } from 'expo-print';
import { shareAsync } from 'expo-sharing';
import { syncSoon } from '../sync/engine';
import { saveLocal } from '../sync/store';
import type { Report } from './build';
import { toCsv, toHtml } from './format';

const rowCount = (r: Report) => r.tables.reduce((n, t) => n + t.rows.length, 0);

/**
 * Writes the report as CSV or PDF on the phone and opens the share sheet. The export is
 * logged to the audit history through the sync queue (also when offline).
 */
export async function exportReport(report: Report, format: 'csv' | 'pdf', farmName: string | null) {
  const stamp = report.generatedAt.slice(0, 16).replace(/[:T]/g, '-');
  const name = `${report.id}-${report.period ? `${report.period.from}_${report.period.to}` : 'current'}-${stamp}`;
  let uri: string;
  if (format === 'csv') {
    const file = new File(Paths.cache, `${name}.csv`);
    if (file.exists) file.delete();
    file.create();
    file.write(toCsv(report));
    uri = file.uri;
  } else {
    ({ uri } = await printToFileAsync({ html: toHtml(report, farmName) }));
  }

  const id = randomUUID();
  const body = {
    id,
    report: report.id,
    format,
    filters: { ...report.filters, ...(report.period && { from: report.period.from, to: report.period.to }) },
    row_count: rowCount(report),
    generated_at: report.generatedAt,
  };
  saveLocal('exports', id, body, { kind: 'create', method: 'POST', path: '/v1/exports', body });
  syncSoon();

  await shareAsync(uri, {
    mimeType: format === 'csv' ? 'text/csv' : 'application/pdf',
    UTI: format === 'csv' ? 'public.comma-separated-values-text' : 'com.adobe.pdf',
    dialogTitle: `Share ${report.title}`,
  });
}
