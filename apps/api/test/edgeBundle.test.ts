import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDb } from './pglite.js';

// Runs the built Edge Function file (supabase/functions/api/index.js, from `npm run build:edge`)
// with a stand-in for Deno: `npm:` imports are mapped back to the packages installed here, and
// the database is PGlite over a real Postgres socket, reached with postgres.js as in Supabase.

const BUNDLE = join(import.meta.dirname, '../../../supabase/functions/api/index.js');
const RUNNABLE = join(import.meta.dirname, `.edge-bundle-${process.pid}.mjs`);
const PROJECT = 'https://edgetest.supabase.co';

let handler: (req: Request) => Promise<Response>;
let token: (sub: string) => Promise<string>;
let db: Awaited<ReturnType<typeof testDb>>;

beforeAll(async () => {
  db = await testDb();
  const port = 40000 + Math.floor(Math.random() * 10000);
  await new PGLiteSocketServer({ db: db.pg, port, host: '127.0.0.1' }).start();

  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const jwks = { keys: [{ ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256' }] };
  token = (sub) =>
    new SignJWT({}).setProtectedHeader({ alg: 'ES256', kid: 'k1' }).setIssuer(`${PROJECT}/auth/v1`).setAudience('authenticated').setSubject(sub).setExpirationTime('1h').sign(privateKey);

  const env: Record<string, string> = {
    SUPABASE_URL: PROJECT,
    SUPABASE_DB_URL: `postgres://postgres@127.0.0.1:${port}/postgres`,
    SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_secret_test' }),
    SUPABASE_JWKS: JSON.stringify(jwks),
  };
  (globalThis as { Deno?: unknown }).Deno = {
    env: { get: (name: string) => env[name] },
    serve: (h: typeof handler) => {
      handler = h;
    },
  };

  const source = readFileSync(BUNDLE, 'utf8').replace(/(["'])npm:((?:@[^/@"']+\/)?[^/@"']+)@[^/"']+(\/[^"']*)?\1/g, '$1$2$3$1');
  expect(source).not.toMatch(/npm:/);
  writeFileSync(RUNNABLE, source);
  await import(pathToFileURL(RUNNABLE).href);
}, 60_000);

afterAll(() => rmSync(RUNNABLE, { force: true }));

const call = async (path: string, init: RequestInit & { sub?: string } = {}) => {
  const headers = new Headers(init.headers);
  if (init.sub) headers.set('authorization', `Bearer ${await token(init.sub)}`);
  const res = await handler(new Request(`http://localhost/api${path}`, { ...init, headers }));
  return { status: res.status, body: await res.json(), headers: res.headers };
};

describe('built Edge Function bundle', () => {
  it('serves health and reaches the database', async () => {
    expect(await call('/health')).toMatchObject({ status: 200, body: { status: 'ok' } });
    expect(await call('/health/ready')).toMatchObject({ status: 200, body: { database: 'ok' } });
  });

  it('requires a valid token for farm data', async () => {
    expect((await call('/v1/me')).status).toBe(401);
    expect((await call('/v1/me', { headers: { authorization: 'Bearer forged' } })).status).toBe(401);
  });

  it('serves a farmer end to end: account, animal, milk, sale, with retries safe', async () => {
    const sub = randomUUID();
    await db.createAuthUser(sub);
    const me = await call('/v1/me', { sub });
    expect(me).toMatchObject({ status: 200, body: { currency: 'ZMW', version: 1 } });
    expect(me.headers.get('cache-control')).toBe('no-store');

    const json = (body: object, extra: Record<string, string> = {}) => ({
      method: 'POST',
      sub,
      headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID(), ...extra },
      body: JSON.stringify(body),
    });
    const cow = randomUUID();
    expect((await call('/v1/cattle', json({ id: cow, sex: 'female', ear_tag: 'EDGE-1' }))).status).toBe(201);
    expect((await call('/v1/milk-production', json({ id: randomUUID(), cattle_id: cow, production_date: '2026-10-05', session: 'morning', quantity: '12' }))).status).toBe(201);
    const customer = randomUUID();
    await call('/v1/customers', json({ id: customer, name: 'Mrs Phiri' }));
    await call('/v1/milk-prices', json({ id: randomUUID(), currency: 'ZMW', price_per_litre: '10', effective_from: '2026-01-01T00:00:00Z' }));
    const saleBody = { id: randomUUID(), customer_id: customer, sale_at: '2026-10-05T10:00:00Z', quantity: '10', currency: 'ZMW', amount_paid: '60', payment_method: 'cash' };
    const key = randomUUID();
    const sale = await call('/v1/milk-sales', json(saleBody, { 'idempotency-key': key }));
    expect(sale).toMatchObject({ status: 201, body: { total: '100.00' } });
    expect(await call('/v1/milk-sales', json(saleBody, { 'idempotency-key': key }))).toMatchObject({ status: 201, body: sale.body });

    const statement = await call(`/v1/customers/${customer}/statement`, { sub });
    expect(statement.body.balances).toEqual({ ZMW: '40.00' });
    expect((await call('/v1/sync/pull?entity=milk_sales', { sub })).body.rows).toHaveLength(1);
  });

  it('pages through many rows changed in one transaction (same updated_at) without repeating', async () => {
    const sub = randomUUID();
    await db.createAuthUser(sub);
    await call('/v1/me', { sub });
    const cow = randomUUID();
    expect((await call('/v1/cattle', { method: 'POST', sub, headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() }, body: JSON.stringify({ id: cow, sex: 'female' }) })).status).toBe(201);
    // As a bulk import or seed would: 410 rows inserted in one statement share one updated_at.
    await db.pg.query(
      `insert into public.milk_production (owner_id, cattle_id, production_date, session, quantity)
       select a.id, $1, date '2026-01-01' + g, 'morning', 10 from public.farmer_accounts a, generate_series(0, 409) g where a.auth_user_id = $2`,
      [cow, sub],
    );
    const seen = new Set<string>();
    let q = 'entity=milk_production&limit=200';
    for (let page = 0; page < 10; page++) {
      const { body } = await call(`/v1/sync/pull?${q}`, { sub });
      body.rows.forEach((r: { id: string }) => seen.add(r.id));
      if (!body.has_more) break;
      q = `entity=milk_production&limit=200&${new URLSearchParams(body.next)}`;
    }
    expect(seen.size).toBe(410);
  });
});
