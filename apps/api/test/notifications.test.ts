import { beforeAll, describe, expect, it } from 'vitest';
import { harness } from './harness.js';

let h: Awaited<ReturnType<typeof harness>>;
beforeAll(async () => {
  h = await harness();
});

describe('notification read marks', () => {
  it('are shared by every phone on the account and safe to send twice', async () => {
    const f = await h.farmer();
    expect((await f.call('GET', '/v1/notifications/read')).json()).toEqual({ keys: [] });
    const res = await f.call('POST', '/v1/notifications/read', { keys: ['vaccination:v1', 'unpaid:c1:ZMW', 'vaccination:v1'] });
    expect(res.statusCode).toBe(200);
    await f.call('POST', '/v1/notifications/read', { keys: ['vaccination:v1'] });
    expect((await f.call('GET', '/v1/notifications/read')).json().keys.sort()).toEqual(['unpaid:c1:ZMW', 'vaccination:v1']);
  });

  it('belong to one farmer only', async () => {
    const a = await h.farmer();
    const b = await h.farmer();
    await a.call('POST', '/v1/notifications/read', { keys: ['decline:cow-a'] });
    expect((await b.call('GET', '/v1/notifications/read')).json().keys).toEqual([]);
  });

  it('can be fetched since a time, and reject bad input', async () => {
    const f = await h.farmer();
    await f.call('POST', '/v1/notifications/read', { keys: ['sync:op1'] });
    const later = new Date(Date.now() + 60_000).toISOString();
    expect((await f.call('GET', `/v1/notifications/read?since=${encodeURIComponent(later)}`)).json().keys).toEqual([]);
    expect((await f.call('POST', '/v1/notifications/read', { keys: [] })).statusCode).toBe(400);
    expect((await f.call('POST', '/v1/notifications/read', { keys: ['x'.repeat(201)] })).statusCode).toBe(400);
    expect((await f.call('POST', '/v1/notifications/read', { keys: ['ok'], owner_id: 'someone-else' })).statusCode).toBe(400);
  });

  it('need a signed-in farmer', async () => {
    expect((await h.app.inject({ url: '/v1/notifications/read' })).statusCode).toBe(401);
  });
});
