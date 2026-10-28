import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { harness } from './harness.js';

let h: Awaited<ReturnType<typeof harness>>;
beforeAll(async () => {
  h = await harness();
});

/** One farmer with phones: each phone has its own sign-in (session) and device id. */
async function farmerWithPhones() {
  const f = await h.farmer();
  const phone = (name: string, platform = 'android') => {
    const id = randomUUID();
    let session = randomUUID();
    const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
      f.call(method, url, payload, {
        authorization: `Bearer valid-${f.authId}~${session}`,
        'x-device-id': id,
        'x-device-name': encodeURIComponent(name),
        'x-device-platform': platform,
        'x-app-version': '1.0.0',
      });
    const signIn = async () => {
      session = randomUUID();
      await h.db.query('insert into auth.sessions (id, user_id) values ($1, $2)', [session, f.authId]);
    };
    return { id, call, signIn, session: () => session };
  };
  return { f, phone };
}

const sessionsOf = async (authId: string) =>
  (await h.db.query<{ id: string }>('select id::text from auth.sessions where user_id = $1', [authId])).rows.map((r) => r.id).sort();

describe('phones signed in to the account', () => {
  it('are recorded from each request and listed with this phone marked', async () => {
    const { phone } = await farmerWithPhones();
    const a = phone('Grace’s Samsung A14');
    const b = phone('Tecno Spark', 'android');
    await a.signIn();
    await b.signIn();
    await a.call('GET', '/v1/me');
    await b.call('GET', '/v1/me');
    const list = (await a.call('GET', '/v1/devices')).json();
    expect(list).toHaveLength(2);
    expect(list.find((d: { device_id: string }) => d.device_id === a.id)).toMatchObject({ name: 'Grace’s Samsung A14', platform: 'android', app_version: '1.0.0', this_device: true });
    expect(list.find((d: { device_id: string }) => d.device_id === b.id).this_device).toBe(false);
  });

  it('can sign out another phone, which is refused until it signs in again', async () => {
    const { f, phone } = await farmerWithPhones();
    const a = phone('Mine');
    const lost = phone('Lost phone');
    await a.signIn();
    await lost.signIn();
    await a.call('GET', '/v1/me');
    await lost.call('GET', '/v1/me');

    expect((await a.call('POST', `/v1/devices/${lost.id}/sign-out`)).json()).toEqual({ signed_out: 1 });
    const refused = await lost.call('GET', '/v1/animals');
    expect(refused.statusCode).toBe(401);
    expect(refused.json().error).toBe('signed_out');
    // Its sign-in is ended too, so its refresh token no longer works.
    expect(await sessionsOf(f.authId)).toEqual([a.session()]);
    expect((await a.call('GET', '/v1/devices')).json().map((d: { name: string }) => d.name)).toEqual(['Mine']);

    await lost.signIn();
    expect((await lost.call('GET', '/v1/me')).statusCode).toBe(200);
    expect((await a.call('GET', '/v1/devices')).json()).toHaveLength(2);
  });

  it('can sign out every other phone at once, keeping this one', async () => {
    const { f, phone } = await farmerWithPhones();
    const [a, b, c] = [phone('A'), phone('B'), phone('C')];
    for (const p of [a, b, c]) {
      await p.signIn();
      await p.call('GET', '/v1/me');
    }
    await h.db.query('insert into auth.sessions (id, user_id) values ($1, $2)', [randomUUID(), f.authId]); // an old app without a device id
    expect((await a.call('POST', '/v1/devices/sign-out-others')).json()).toEqual({ signed_out: 2 });
    expect(await sessionsOf(f.authId)).toEqual([a.session()]);
    expect((await b.call('GET', '/v1/me')).statusCode).toBe(401);
    expect((await a.call('GET', '/v1/me')).statusCode).toBe(200);
  });

  it('cannot sign out this phone from the list, or a phone on another account', async () => {
    const { phone } = await farmerWithPhones();
    const mine = phone('Mine');
    await mine.call('GET', '/v1/me');
    expect((await mine.call('POST', `/v1/devices/${mine.id}/sign-out`)).statusCode).toBe(400);

    const other = (await farmerWithPhones()).phone('Someone else');
    await other.call('GET', '/v1/me');
    expect((await mine.call('POST', `/v1/devices/${other.id}/sign-out`)).statusCode).toBe(404);
    expect((await other.call('GET', '/v1/me')).statusCode).toBe(200);
    expect((await mine.call('POST', '/v1/devices/not-a-uuid/sign-out')).statusCode).toBe(400);
  });

  it('name the phone that made each change in the audit history', async () => {
    const { phone } = await farmerWithPhones();
    const a = phone('Samsung A14');
    await a.call('POST', '/v1/customers', { id: randomUUID(), name: 'Mrs Phiri', registered_on: '2026-10-28' });
    const [entry] = (await a.call('GET', '/v1/audit?entity_table=customers')).json();
    expect(entry).toMatchObject({ action: 'customer.created', device_name: 'Samsung A14' });
  });

  it('are optional: requests without a device id work as before', async () => {
    const f = await h.farmer();
    expect((await f.call('GET', '/v1/me')).statusCode).toBe(200);
    expect((await f.call('GET', '/v1/me', undefined, { 'x-device-id': 'nonsense' })).statusCode).toBe(200);
    expect((await f.call('GET', '/v1/devices')).json()).toEqual([]);
    expect((await f.call('POST', '/v1/devices/sign-out-others')).statusCode).toBe(400);
  });
});
