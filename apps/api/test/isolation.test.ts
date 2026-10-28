import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { harness } from './harness.js';

// Spec §17: "Attempt to access another owner's record by changing request IDs; server denies
// access. Exports remain owner-scoped." Farmer A creates one record of every kind; farmer B
// then tries every route that takes an id, and every sync pull.

let h: Awaited<ReturnType<typeof harness>>;
let A: Awaited<ReturnType<typeof h.farmer>>;
let B: Awaited<ReturnType<typeof h.farmer>>;
const ids: Record<string, string> = {};

async function created(res: { statusCode: number; json(): any }) {
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

beforeAll(async () => {
  h = await harness();
  A = await h.farmer();
  B = await h.farmer();
  const post = (url: string, body: object) => A.call('POST', url, { id: randomUUID(), ...body });
  ids.cow = await created(await post('/v1/cattle', { sex: 'female', ear_tag: 'A-1', production_status: 'lactating' }));
  ids.breed = await created(await post('/v1/breeds', { name: 'Angoni' }));
  ids.milk = await created(await post('/v1/milk-production', { cattle_id: ids.cow, production_date: '2026-10-05', session: 'morning', quantity: '20' }));
  ids.health = await created(await post('/v1/health-records', { cattle_id: ids.cow, reported_on: '2026-10-05' }));
  ids.visit = await created(await post('/v1/vet-visits', { cattle_id: ids.cow, visit_at: '2026-10-05T08:00:00Z' }));
  ids.treatment = await created(await post('/v1/treatments', { cattle_id: ids.cow, medication: 'X', started_on: '2026-10-05' }));
  ids.breeding = await created(await post('/v1/breeding', { cattle_id: ids.cow, event_type: 'heat_observed', event_at: '2026-10-05T08:00:00Z' }));
  ids.check = await created(await post('/v1/pregnancy-checks', { cattle_id: ids.cow, scheduled_on: '2026-11-05' }));
  ids.calving = await created(await post('/v1/calvings', { dam_id: ids.cow, calved_on: '2026-09-01', outcome: 'live' }));
  ids.schedule = await created(await post('/v1/vaccination-schedules', { vaccine_name: 'FMD' }));
  ids.vaccination = await created(await post('/v1/vaccinations', { cattle_id: ids.cow, vaccine_name: 'FMD', due_on: '2026-11-01' }));
  ids.action = await created(await post('/v1/alert-actions', { cattle_id: ids.cow, alert_type: 'milk_drop', action_taken: 'observed', action_on: '2026-10-05', follow_up_on: '2026-10-08' }));
  ids.customer = await created(await post('/v1/customers', { name: 'Mrs Phiri' }));
  await created(await post('/v1/milk-prices', { currency: 'ZMW', price_per_litre: '10', effective_from: '2026-01-01T00:00:00Z' }));
  ids.sale = await created(await post('/v1/milk-sales', { customer_id: ids.customer, sale_at: '2026-10-05T10:00:00Z', quantity: '5', currency: 'ZMW', amount_paid: '20', payment_method: 'cash' }));
  ids.payment = await created(await post('/v1/payments', { customer_id: ids.customer, kind: 'payment', amount: '10', currency: 'ZMW', method: 'cash', paid_at: '2026-10-06T10:00:00Z' }));
  ids.movement = await created(await post('/v1/stock/movements', { kind: 'spoilage', quantity: '1', movement_date: '2026-10-05' }));
  ids.expense = await created(await post('/v1/expenses', { expense_date: '2026-10-05', category: 'feed', amount: '100', currency: 'ZMW' }));
  ids.device = randomUUID();
  await A.call('GET', '/v1/me', undefined, { 'x-device-id': ids.device, 'x-device-name': 'A phone' });
  expect((await post('/v1/exports', { report: 'herd', format: 'pdf', row_count: 1, generated_at: '2026-10-28T10:00:00Z' })).statusCode).toBe(201);
  before = { cow: (await A.call('GET', `/v1/cattle/${ids.cow}`)).json(), statement: (await A.call('GET', `/v1/customers/${ids.customer}/statement`)).json() };
});
let before: { cow: object; statement: { balances: object; sales: object[]; payments: object[] } };

const v1 = { 'if-match': '1' };
type Attempt = [method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: () => string, body?: object, headers?: Record<string, string>];
const BODY_FOR: Record<string, object> = { calvings: { observations: 'mine' }, 'vaccination-schedules': { guidance_source: 'mine' } };

// Every route that addresses one record by id (or links to one), as farmer B.
const ATTEMPTS: Attempt[] = [
  ['GET', () => `/v1/cattle/${ids.cow}`],
  ['PATCH', () => `/v1/cattle/${ids.cow}`, { name: 'Mine' }, v1],
  ['POST', () => `/v1/cattle/${ids.cow}/status`, { status: 'sold', status_date: '2026-10-10' }, v1],
  ['DELETE', () => `/v1/cattle/${ids.cow}`, undefined, v1],
  ['GET', () => `/v1/cattle/${ids.cow}/timeline`],
  ['POST', () => `/v1/cattle/${ids.cow}/photo-upload`],
  ['POST', () => `/v1/cattle/${ids.cow}/photo`, { path: `x/${ids.cow}/p.jpg` }],
  ['GET', () => `/v1/cattle/${ids.cow}/photo-url`],
  ['PATCH', () => `/v1/breeds/${ids.breed}`, { active: false }, v1],
  ['POST', () => `/v1/milk-production/${ids.milk}/correct`, { quantity: '1', reason: 'mine' }, v1],
  ['POST', () => `/v1/milk-production/${ids.milk}/void`, { reason: 'mine' }, v1],
  ...(['health-records', 'vet-visits', 'treatments', 'breeding', 'pregnancy-checks', 'calvings', 'vaccination-schedules', 'vaccinations', 'alert-actions'] as const).flatMap(
    (path): Attempt[] => {
      const key = { 'health-records': 'health', 'vet-visits': 'visit', treatments: 'treatment', breeding: 'breeding', 'pregnancy-checks': 'check', calvings: 'calving', 'vaccination-schedules': 'schedule', vaccinations: 'vaccination', 'alert-actions': 'action' }[path];
      return [
        ['PATCH', () => `/v1/${path}/${ids[key]}`, BODY_FOR[path] ?? { notes: 'mine' }, v1],
        ['POST', () => `/v1/${path}/${ids[key]}/remove`, { reason: 'mine' }, v1],
      ];
    },
  ),
  ['PATCH', () => `/v1/customers/${ids.customer}`, { name: 'Mine' }, v1],
  ['GET', () => `/v1/customers/${ids.customer}/statement`],
  ['POST', () => `/v1/milk-sales/${ids.sale}/void`, { reason: 'mine' }],
  ['POST', () => `/v1/milk-sales/${ids.sale}/correct`, { new_id: randomUUID(), quantity: '1', reason: 'mine' }],
  ['POST', () => `/v1/payments/${ids.payment}/void`, { reason: 'mine' }],
  ['POST', () => `/v1/stock/movements/${ids.movement}/reverse`, { id: randomUUID(), reason: 'mine' }],
  ['PATCH', () => `/v1/expenses/${ids.expense}`, { amount: '1' }, v1],
  ['POST', () => `/v1/expenses/${ids.expense}/void`, { reason: 'mine' }, v1],
  ['POST', () => `/v1/expenses/${ids.expense}/receipt-upload`],
  ['POST', () => `/v1/expenses/${ids.expense}/receipt`, { path: `x/${ids.expense}/r.jpg` }],
  ['POST', () => `/v1/devices/${ids.device}/sign-out`],
  ['GET', () => `/v1/expenses/${ids.expense}/receipt-url`],
];

// Creating B's own records that point at A's records must fail too.
const LINKS: [url: string, body: () => object][] = [
  ['/v1/milk-production', () => ({ cattle_id: ids.cow, production_date: '2026-10-05', session: 'evening', quantity: '1' })],
  ['/v1/health-records', () => ({ cattle_id: ids.cow, reported_on: '2026-10-05' })],
  ['/v1/treatments', () => ({ cattle_id: ids.cow, medication: 'X', started_on: '2026-10-05' })],
  ['/v1/breeding', () => ({ cattle_id: ids.cow, event_type: 'natural_mating', event_at: '2026-10-05T08:00:00Z' })],
  ['/v1/calvings', () => ({ dam_id: ids.cow, calved_on: '2026-09-01', outcome: 'live' })],
  ['/v1/alert-actions', () => ({ cattle_id: ids.cow, alert_type: 'other', action_taken: 'observed', action_on: '2026-10-05', follow_up_on: '2026-10-08' })],
  ['/v1/vaccinations', () => ({ cattle_id: ids.cow, vaccine_name: 'FMD', due_on: '2026-11-01' })],
  ['/v1/cattle', () => ({ sex: 'female', dam_id: ids.cow })],
  ['/v1/milk-sales', () => ({ customer_id: ids.customer, sale_at: '2026-10-05T10:00:00Z', quantity: '1', currency: 'ZMW', price_per_litre: '1' })],
  ['/v1/payments', () => ({ customer_id: ids.customer, kind: 'payment', amount: '1', currency: 'ZMW', method: 'cash', paid_at: '2026-10-06T10:00:00Z' })],
];

const PULL = [
  'cattle_breeds',
  'cattle',
  'milk_production',
  'animal_health_records',
  'veterinary_visits',
  'treatments',
  'breeding_records',
  'pregnancy_checks',
  'calving_records',
  'vaccination_schedules',
  'vaccination_records',
  'alert_actions',
  'customers',
  'milk_prices',
  'milk_sales',
  'payments',
  'payment_allocations',
  'milk_stock_movements',
  'farm_expenses',
];

describe('owner isolation sweep', () => {
  // Names use the route pattern: the ids only exist once beforeAll has run.
  it.each(ATTEMPTS.map((a) => [`${a[0]} ${a[1].toString().match(/`(.*)`/)?.[1].replace(/\$\{[^}]+\}/g, ':id') ?? ''}`, a] as const))('denies %s', async (_, [method, url, body, headers]) => {
    const res = await B.call(method, url(), body, headers);
    expect(res.statusCode).toBe(404);
  });

  it.each(LINKS.map(([url, body]) => [url, body] as const))('refuses to link B’s new record to A’s record via %s', async (url, body) => {
    const res = await B.call('POST', url, { id: randomUUID(), ...body() });
    expect([400, 404]).toContain(res.statusCode);
  });

  it.each(PULL)('pulls none of A’s %s', async (entity) => {
    const rows = (await B.call('GET', `/v1/sync/pull?entity=${entity}`)).json().rows as { id: string }[];
    expect(rows.filter((r) => Object.values(ids).includes(r.id))).toEqual([]);
  });

  it('lists none of A’s records, audit entries or exports', async () => {
    for (const url of ['/v1/cattle', '/v1/milk-production', '/v1/customers', '/v1/milk-sales', '/v1/payments', '/v1/expenses', '/v1/milk-prices', '/v1/health-records', '/v1/vaccinations']) {
      const rows = (await B.call('GET', url)).json() as { id: string }[];
      expect(rows.filter((r) => Object.values(ids).includes(r.id)), url).toEqual([]);
    }
    expect((await B.call('GET', '/v1/audit')).json().every((e: { entity_id: string }) => !Object.values(ids).includes(e.entity_id))).toBe(true);
    expect((await B.call('GET', '/v1/audit?entity_table=exports')).json()).toEqual([]);
  });

  it('left A’s records exactly as they were', async () => {
    expect((await A.call('GET', `/v1/cattle/${ids.cow}`)).json()).toEqual(before.cow);
    const st = (await A.call('GET', `/v1/customers/${ids.customer}/statement`)).json();
    expect({ balances: st.balances, sales: st.sales, payments: st.payments }).toEqual({ balances: before.statement.balances, sales: before.statement.sales, payments: before.statement.payments });
  });

  it('covers every route that takes an id', () => {
    // Fails, naming the route, when an id route is added to the API without an isolation check here.
    const pattern = (url: string) => url.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id').split('?')[0];
    const attempted = new Set(ATTEMPTS.map(([method, url]) => `${method} ${pattern(url())}`));
    const routes = h.app.routes.filter((r) => r.method !== 'ALL' && r.path.includes(':id')).map((r) => `${r.method} ${r.path}`);
    expect(routes.length).toBeGreaterThan(30);
    expect(routes.filter((r) => !attempted.has(r))).toEqual([]);
  });
});
