import { describe, expect, it } from 'vitest';
import type { Cattle } from '../src/animals/model';
import type { CareData } from '../src/care/model';
import type { FinanceData } from '../src/finance/repo';
import type { MilkRow } from '../src/production/calc';
import { financeReport, herdHealthReport, herdReport, productionReport, reproductionReport, type ReportInput, vaccinationReport } from '../src/reports/build';
import { csvCell, escapeHtml, rangeLabel, toCsv, toHtml } from '../src/reports/format';
import { needingAttention } from '../src/reports/dashboard';

const cow = (id: string, extra: Partial<Cattle> = {}): Cattle =>
  ({
    id,
    ear_tag: id.toUpperCase(),
    name: null,
    breed_id: 'friesian',
    sex: 'female',
    birth_date: '2022-01-01',
    birth_date_estimated: false,
    production_status: 'lactating',
    reproductive_status: 'open',
    status: 'active',
    status_date: null,
    status_details: null,
    version: 1,
    ...extra,
  }) as Cattle;

const emptyCare = (): CareData => ({ health: [], visits: [], treatments: [], breeding: [], checks: [], calvings: [], vaccinations: [], schedules: [], actions: [] });
const emptyFinance = (): FinanceData => ({ customers: [], prices: [], sales: [], payments: [], allocations: [], movements: [], expenses: [] });
const milk = (cattle_id: string, production_date: string, quantity: string, extra: Partial<MilkRow> = {}): MilkRow => ({
  id: `${cattle_id}${production_date}${quantity}${extra.session ?? ''}`,
  cattle_id,
  production_date,
  session: 'morning',
  quantity,
  status: 'valid',
  restricted: false,
  ...extra,
});

const input = (extra: Partial<ReportInput> = {}): ReportInput => ({
  animals: [cow('a'), cow('b', { breed_id: 'jersey' }), cow('c', { status: 'sold', status_date: '2026-10-10' })],
  breeds: [
    { id: 'friesian', name: 'Friesian', active: true, version: 1 },
    { id: 'jersey', name: 'Jersey', active: true, version: 1 },
  ],
  milk: [],
  care: emptyCare(),
  finance: emptyFinance(),
  declineRule: { recent_days: 7, baseline_days: 7, threshold_pct: 20, min_days: 4 },
  today: '2026-10-28',
  now: '2026-10-28T09:00:00.000Z',
  farmDate: (iso) => iso.slice(0, 10),
  ...extra,
});
const f = { from: '2026-10-01', to: '2026-10-31', currency: 'ZMW' };
const value = (r: { summary: { label: string; value: string }[] }, label: string) => r.summary.find((s) => s.label === label)?.value;

describe('herd report', () => {
  it('counts active animals, cows in milk, pregnancies and animals that left', () => {
    const r = herdReport(input({ animals: [cow('a', { reproductive_status: 'pregnant' }), cow('b'), cow('c', { status: 'sold', status_date: '2026-10-10' })] }), f);
    expect(value(r, 'Active (on the farm)')).toBe('2');
    expect(value(r, 'Confirmed pregnancies')).toBe('1');
    expect(r.tables[1].rows).toEqual([expect.objectContaining({ animal: 'C', status: 'Sold' })]);
  });
});

describe('production report', () => {
  it('totals by day, cow and breed with the spec daily sum (12 + 8 = 20 L)', () => {
    const r = productionReport(input({ milk: [milk('a', '2026-10-05', '12'), milk('a', '2026-10-05', '8', { session: 'afternoon' }), milk('b', '2026-10-05', '10')] }), f);
    expect(value(r, 'Milk produced')).toBe('30.00 L');
    const byCow = r.tables.find((t) => t.title === 'By cow')!.rows;
    expect(byCow.find((x) => x.cow === 'A')).toMatchObject({ total: '20.00', avg: '20.00' });
    expect(r.tables.find((t) => t.title === 'By breed')!.rows.map((x) => x.breed)).toEqual(['Friesian', 'Jersey']);
    expect(r.missing[0]).toMatch(/30 day\(s\) in the period have no milk records/);
  });

  it('respects the animal filter and names it', () => {
    const r = productionReport(input({ milk: [milk('a', '2026-10-05', '12'), milk('b', '2026-10-05', '10')] }), { ...f, cattleId: 'b' });
    expect(value(r, 'Milk produced')).toBe('10.00 L');
    expect(r.filters).toEqual({ Animal: 'B' });
  });
});

describe('reproduction report', () => {
  it('counts pregnancies only from checks and lists supported calving intervals', () => {
    const base = { deleted_at: null, delete_reason: null, version: 1 };
    const care = {
      ...emptyCare(),
      breeding: [{ ...base, id: 'br', cattle_id: 'a', event_type: 'artificial_insemination' as const, event_at: '2026-10-02T08:00:00Z', bull_or_semen_id: 'S1', performed_by: null, notes: null }],
      calvings: [
        { ...base, id: 'k1', dam_id: 'a', calf_id: null, calved_on: '2025-09-01', outcome: 'live' as const, complications: null, dry_off_on: null, observations: null },
        { ...base, id: 'k2', dam_id: 'a', calf_id: null, calved_on: '2026-10-01', outcome: 'live' as const, complications: null, dry_off_on: null, observations: null },
      ],
    };
    const r = reproductionReport(input({ care }), f);
    expect(value(r, 'Breeding attempts in period')).toBe('1');
    expect(value(r, 'Confirmed pregnant now')).toBe('0');
    expect(r.tables.find((t) => t.title === 'Calving intervals')!.rows).toEqual([expect.objectContaining({ days: '395' })]);
    expect(r.missing[0]).toMatch(/no pregnancy check result/);
  });
});

describe('vaccination report', () => {
  it('reports coverage of active animals and compliance with doses due', () => {
    const base = { deleted_at: null, delete_reason: null, version: 1, schedule_id: null, target_disease: null, batch_number: null, dosage_as_directed: null, administered_by: null, next_due_on: null, is_booster: false, group_batch_id: null, group_label: null, group_definition: null, notes: null };
    const care = {
      ...emptyCare(),
      vaccinations: [
        { ...base, id: 'v1', cattle_id: 'a', vaccine_name: 'FMD', due_on: '2026-10-10', administered_on: '2026-10-10', status: 'completed' as const },
        { ...base, id: 'v2', cattle_id: 'b', vaccine_name: 'FMD', due_on: '2026-10-10', administered_on: null, status: 'scheduled' as const },
      ],
    };
    const r = vaccinationReport(input({ care }), f);
    expect(value(r, 'Compliance in period')).toBe('50%');
    expect(value(r, 'Overdue now')).toBe('1');
    expect(r.tables[0].rows[0]).toMatchObject({ covered: '1 of 2', pct: '50%' });
    // A cancelled dose was never due, so it does not lower compliance.
    const cancelled = { ...care, vaccinations: [care.vaccinations[0], { ...care.vaccinations[1], status: 'cancelled' as const }] };
    expect(value(vaccinationReport(input({ care: cancelled }), f), 'Compliance in period')).toBe('100%');
  });
});

describe('finance report', () => {
  it('keeps revenue and receipts distinct and filters by customer and payment status', () => {
    const finance = {
      ...emptyFinance(),
      customers: [{ id: 'c1', name: 'Mrs Phiri' }, { id: 'c2', name: 'School' }] as FinanceData['customers'],
      sales: [
        { id: 's1', customer_id: 'c1', sale_at: '2026-10-05T08:00:00Z', quantity: '10', price_per_litre: '10.00', currency: 'ZMW', total: '100.00', price_source: 'list', status: 'completed' },
        { id: 's2', customer_id: 'c2', sale_at: '2026-10-06T08:00:00Z', quantity: '5', price_per_litre: '10.00', currency: 'ZMW', total: '50.00', price_source: 'list', status: 'completed' },
      ] as FinanceData['sales'],
      payments: [{ id: 'p1', customer_id: 'c1', kind: 'payment', amount: '60.00', currency: 'ZMW', method: 'cash', paid_at: '2026-10-05T09:00:00Z', status: 'completed' }] as FinanceData['payments'],
      allocations: [{ id: 'a1', payment_id: 'p1', sale_id: 's1', amount: '60.00' }],
    };
    const r = financeReport(input({ finance }), f);
    expect(value(r, 'Sales revenue')).toBe('ZMW 150.00');
    expect(value(r, 'Payments received')).toBe('ZMW 60.00');
    expect(value(r, 'Customers owe now')).toBe('ZMW 90.00');
    const unpaidPhiri = financeReport(input({ finance }), { ...f, customerId: 'c1', paid: 'unpaid' });
    expect(unpaidPhiri.tables[0].rows).toEqual([expect.objectContaining({ customer: 'Mrs Phiri', total: '100.00', due: '40.00' })]);
    expect(unpaidPhiri.filters).toMatchObject({ Customer: 'Mrs Phiri', 'Payment status': 'Unpaid' });
    // The summary follows the filters, so it matches the table; farm-wide figures are left out.
    const phiri = financeReport(input({ finance }), { ...f, customerId: 'c1' });
    expect(value(phiri, 'Sales revenue')).toBe('ZMW 100.00');
    expect(value(phiri, 'Customers owe now')).toBe('ZMW 40.00');
    expect(phiri.summary.map((s) => s.label)).not.toContain('Recorded operating result');
    expect(phiri.tables[1].rows[0]).toMatchObject({ kind: 'Payment received' });
  });
});

describe('export formats', () => {
  it('quotes CSV cells and neutralises spreadsheet formulas, but not negative numbers', () => {
    expect(csvCell('Mrs "Grace", Phiri')).toBe('"Mrs ""Grace"", Phiri"');
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell('-5.00')).toBe('-5.00');
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });

  it('puts report, period, filters, generation time and units at the top of the CSV', () => {
    const csv = toCsv(productionReport(input({ milk: [milk('a', '2026-10-05', '12')] }), { ...f, cattleId: 'a' }));
    const lines = csv.replace('﻿', '').split('\r\n');
    expect(lines.slice(0, 5)).toEqual(['Report,Milk production', 'Period,2026-10-01 to 2026-10-31', 'Filter: Animal,A', 'Generated,2026-10-28T09:00:00.000Z', 'Units,litres (L)']);
    expect(csv).toContain('Definitions');
  });

  it('escapes record text in the PDF HTML', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    const html = toHtml(herdReport(input({ animals: [cow('a', { name: '<b>Daisy</b>' })] }), f), 'Chisamba & Sons');
    expect(html).toContain('&lt;b&gt;Daisy&lt;/b&gt;');
    expect(html).toContain('Chisamba &amp; Sons');
    expect(html).not.toContain('<b>Daisy</b>');
  });
});


describe('animals needing attention', () => {
  it('lists active animals with a withdrawal, an open concern or overdue care, with the reasons', () => {
    const base = { deleted_at: null, delete_reason: null, version: 1 };
    const care = {
      ...emptyCare(),
      treatments: [{ ...base, id: 't', cattle_id: 'a', health_record_id: null, medication: 'X', dosage_instructions: null, administered_by: null, started_on: '2026-10-25', completed_on: '2026-10-26', requires_milk_withdrawal: true, withdrawal_period_text: null, withdrawal_ends_at: '2026-10-30T10:00:00Z', withdrawal_source: null, withdrawal_cleared_at: null, withdrawal_clearance_note: null, notes: null }],
      checks: [{ ...base, id: 'k', cattle_id: 'b', breeding_record_id: null, scheduled_on: '2026-10-20', examined_on: null, result: 'pending' as const, examiner: null, expected_calving_on: null, notes: null }],
    };
    const result = needingAttention(input({ care }));
    expect(result.get('a')).toEqual(['withdrawal']);
    expect(result.get('b')).toEqual(['overdue_care']);
    expect(result.has('c')).toBe(false); // sold
  });
});

describe('period heading', () => {
  it('reads like a date range a person would write', () => {
    expect(rangeLabel('2026-10-01', '2026-10-28')).toBe('1 – 28 October 2026');
    expect(rangeLabel('2026-09-01', '2026-10-28')).toBe('1 Sep – 28 Oct 2026');
    expect(rangeLabel('2025-12-05', '2026-01-02')).toBe('5 December 2025 – 2 January 2026');
    expect(rangeLabel('2026-10-28', '2026-10-28')).toBe('28 October 2026');
  });
});

describe('herd health trends report', () => {
  const hr = (id: string, cattle_id: string, reported_on: string, condition: string | null, extra = {}) =>
    ({ id, cattle_id, reported_on, condition, recovery_status: 'ongoing', confirmed_diagnosis: null, suspected_issue: null, deleted_at: null, ...extra }) as unknown as CareData['health'][number];

  it('counts deaths by cause (calves apart), sales by reason, problems by kind and repeat cases', () => {
    const animals = [
      cow('a'),
      cow('b', { status: 'deceased', status_date: '2026-10-20', status_reason: 'illness', status_health_record_id: 'h2' }),
      cow('calf', { birth_date: '2026-08-01', status: 'deceased', status_date: '2026-10-05' }),
      cow('c', { status: 'sold', status_date: '2026-10-10', status_reason: 'low_yield' }),
    ];
    const care = { ...emptyCare(), health: [hr('h1', 'a', '2026-10-02', 'mastitis'), hr('h3', 'a', '2026-10-25', 'mastitis'), hr('h2', 'b', '2026-10-15', 'tick_borne', { recovery_status: 'died', suspected_issue: 'East Coast fever' }), hr('h4', 'a', '2026-10-26', null)] };
    const expenses = [{ id: 'e1', status: 'active', currency: 'ZMW', amount: '700.00', care_id: 'h2' }] as unknown as FinanceData['expenses'];
    const r = herdHealthReport(input({ animals, care, finance: { ...emptyFinance(), expenses } }), f);

    expect(value(r, 'Deaths')).toBe('2');
    expect(r.summary[0].note).toContain('1 calves under 6 months');
    expect(r.summary[0].note).not.toContain('%'); // too few animals for a share of the herd
    const table = (title: string) => r.tables.find((t) => t.title === title)!.rows;
    expect(table('Deaths by cause')).toEqual([
      { cause: 'Illness', n: '1', calves: '0' },
      { cause: 'Not given', n: '1', calves: '1' },
    ]);
    expect(table('Each death').find((d) => d.animal === 'B')?.illness).toBe('East Coast fever');
    expect(table('Sales by reason')).toEqual([{ reason: 'Low milk yield', n: '1' }]);
    expect(table('Health problems by kind')[0]).toMatchObject({ kind: 'Mastitis (udder)', cases: '2', animals: '1' });
    expect(table('Health problems by kind').find((k) => k.kind.startsWith('Tick'))).toMatchObject({ died: '1', cost: 'ZMW 700.00' });
    expect(table('Animals with repeat problems')).toEqual([{ animal: 'A', kind: 'Mastitis (udder)', cases: '2' }]);
    expect(r.missing).toEqual(['1 health concern has no kind of problem chosen; they are counted as “Not set”.', '1 death has no cause recorded.']);
  });
});
