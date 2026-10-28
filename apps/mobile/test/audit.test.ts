import { describe, expect, it } from 'vitest';
import { type AuditEntry, describe as describeEntry, type DescribeContext } from '../src/audit/describe';

const COW = '11111111-1111-4111-8111-111111111111';
const CALF = '22222222-2222-4222-8222-222222222222';
const CUSTOMER = '33333333-3333-4333-8333-333333333333';
const MILK = '44444444-4444-4444-8444-444444444444';

const ctx: DescribeContext = {
  animalName: (id) => ({ [COW]: 'ZM-001 · Daisy', [CALF]: 'ZM-007' })[id] ?? null,
  customerName: (id) => (id === CUSTOMER ? 'Mrs Phiri' : null),
  breedName: () => 'Jersey',
  milkCattle: (id) => (id === MILK ? COW : null),
  careCattle: () => COW,
  care: { health: [], visits: [], treatments: [], breeding: [], checks: [], calvings: [], vaccinations: [], schedules: [] } as never,
  currency: 'ZMW',
};

const entry = (action: string, table: string, extra: Partial<AuditEntry> = {}): AuditEntry => ({
  id: 1,
  action,
  entity_table: table,
  entity_id: MILK,
  reason: null,
  before_data: null,
  after_data: null,
  occurred_at: '2026-10-28T07:42:00Z',
  ...extra,
});

// No internal codes, ids, true/false or JSON may reach the farmer.
const RAW = /[0-9a-f]{8}-[0-9a-f]{4}-|\btrue\b|\bfalse\b|[{}]|_/;
const text = (d: { title: string; lines: string[] }) => [d.title, ...d.lines].join(' | ');

describe('audit history in plain words', () => {
  it('says which cow, what was corrected, with units and dates, and keeps the reason', () => {
    const d = describeEntry(
      entry('milk_production.corrected', 'milk_production', {
        reason: 'Misread the bucket',
        before_data: { quantity: '12.00', production_date: '2026-10-21' },
        after_data: { quantity: '10.00', production_date: '2026-10-22' },
      }),
      ctx,
    )!;
    expect(d.title).toBe('ZM-001 · Daisy: milk entry corrected');
    expect(d.lines).toEqual(['Milk changed from 12 L to 10 L', 'Date changed from 21/10/2026 to 22/10/2026']);
    expect(d.reason).toBe('Misread the bucket');
    expect(d.href).toBe(`/milk/${MILK}`);
    expect(d.important).toBe(true);
    expect(text(d)).not.toMatch(RAW);
  });

  it('names people and animals instead of ids', () => {
    const d = describeEntry(
      entry('cattle.updated', 'cattle', { entity_id: CALF, before_data: { dam_id: null, production_status: 'calf' }, after_data: { dam_id: COW, production_status: 'heifer' } }),
      ctx,
    )!;
    expect(d.title).toBe('ZM-007: details changed');
    expect(d.lines).toEqual(['Mother set to ZM-001 · Daisy', 'Milk status changed from Calf to Heifer']);
    expect(text(d)).not.toMatch(RAW);
  });

  it('describes money with its currency, and voids as such', () => {
    const d = describeEntry(
      entry('milk_sale.voided', 'milk_sales', { reason: 'Customer returned the milk', before_data: { customer_id: CUSTOMER, total: '100.00', currency: 'ZMW', quantity: '10.00' }, after_data: { status: 'voided' } }),
      ctx,
    )!;
    expect(d.title).toBe('Sale to Mrs Phiri voided (ZMW 100.00)');
    expect(d.important).toBe(true);
    const price = describeEntry(entry('milk_price.set', 'milk_prices', { after_data: { currency: 'ZMW', price_per_litre: '12.00', effective_from: '2026-11-01T00:00:00.000Z' } }), ctx)!;
    expect(price.title).toBe('Milk price set to ZMW 12.00 per litre');
  });

  it('turns settings changes into sentences, not JSON', () => {
    const d = describeEntry(
      entry('account.settings_updated', 'farmer_accounts', {
        before_data: { notification_prefs: { reminder_time: '06:00', vaccinations: true, finance: true } },
        after_data: { notification_prefs: { reminder_time: '05:30', vaccinations: false, finance: true }, farm_name: 'Mapalo Farm' },
      }),
      ctx,
    )!;
    expect(d.lines).toEqual(['Reminder time changed to 05:30', 'Vaccination reminders turned off', 'Farm name set to Mapalo Farm']);
    expect(text(d)).not.toMatch(RAW);
  });

  it('skips steps of first-time setup that mean nothing to the farmer', () => {
    expect(describeEntry(entry('account.settings_updated', 'farmer_accounts', { before_data: { onboarding_step: 'farm' }, after_data: { onboarding_step: 'units' } }), ctx)).toBeNull();
  });

  it('marks new records as routine and changes as worth reviewing', () => {
    const made = describeEntry(entry('milk_production.created', 'milk_production', { after_data: { cattle_id: COW, session: 'morning', production_date: '2026-10-28', quantity: '12.50' } }), ctx)!;
    expect(made.title).toBe('ZM-001 · Daisy: morning milk 28/10/2026, 12.5 L');
    expect(made.important).toBe(false);
    const use = describeEntry(entry('stock.farm_consumption', 'milk_stock_movements', { after_data: { kind: 'farm_consumption', quantity: '-2.00', movement_date: '2026-10-28' } }), ctx)!;
    expect(use.title).toBe('Milk used at home: 2.00 L');
    expect(use.important).toBe(false);
    const adj = describeEntry(entry('stock.adjustment', 'milk_stock_movements', { reason: 'Spilt bucket', after_data: { kind: 'adjustment', quantity: '-5.00', movement_date: '2026-10-28' } }), ctx)!;
    expect(adj).toMatchObject({ title: 'Stock adjusted: removed 5.00 L', important: true, reason: 'Spilt bucket' });
  });

  it('describes care records with their own wording', () => {
    const d = describeEntry(
      entry('treatments.removed', 'treatments', { reason: 'Entered on the wrong cow', before_data: { cattle_id: COW, medication: 'Oxytetracycline', started_on: '2026-10-20', requires_milk_withdrawal: false } }),
      ctx,
    )!;
    expect(d.title).toBe('ZM-001 · Daisy: treatment removed');
    expect(d.lines[0]).toContain('Oxytetracycline');
    expect(d.important).toBe(true);
  });

  it('names exports by report', () => {
    const d = describeEntry(entry('export.pdf', 'exports', { after_data: { report: 'production', format: 'pdf', row_count: 24 } }), ctx)!;
    expect(d).toMatchObject({ title: 'Milk production report exported as PDF', lines: ['24 rows'], group: 'settings' });
  });
});
