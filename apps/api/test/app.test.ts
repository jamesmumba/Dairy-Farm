import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { account, fakePhotos, noDb, verifyToken } from './fixtures.js';
import type { Accounts } from '../src/accounts.js';

const unused = async (): Promise<never> => {
  throw new Error('not used in this test');
};

const accounts: Accounts = {
  getOrCreate: async (authUserId) => account(`owner-of-${authUserId}`),
  update: unused,
  requestDeletion: unused,
};

const app = () => buildApp({ verifyToken, accounts, db: noDb, photos: fakePhotos().photos, receipts: fakePhotos().photos, logLevel: 'silent' });

describe('API foundation', () => {
  it('serves an unauthenticated health check', async () => {
    const res = await (await app()).inject({ url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('rejects /v1 requests without a token', async () => {
    const res = await (await app()).inject({ url: '/v1/me' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects an invalid token', async () => {
    const res = await (await app()).inject({ url: '/v1/me', headers: { authorization: 'Bearer forged' } });
    expect(res.statusCode).toBe(401);
  });

  it('derives the owner from the token, ignoring any client-supplied owner_id', async () => {
    const res = await (await app()).inject({
      url: '/v1/me?owner_id=someone-else',
      headers: { authorization: 'Bearer valid-farmer-a', 'x-owner-id': 'someone-else' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe('owner-of-farmer-a');
  });

  it('hides internal error details', async () => {
    const failing = await buildApp({
      verifyToken,
      accounts: {
        ...accounts,
        getOrCreate: async () => {
          throw new Error('connection to db.internal:5432 refused');
        },
      },
      db: noDb, photos: fakePhotos().photos, receipts: fakePhotos().photos, logLevel: 'silent',
    });
    const res = await failing.inject({ url: '/v1/me', headers: { authorization: 'Bearer valid-x' } });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('db.internal');
  });

  it('marks responses as not cacheable and refuses oversized bodies', async () => {
    const a = await app();
    const res = await a.inject({ url: '/health' });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    const big = await a.inject({ method: 'PATCH', url: '/v1/me', headers: { authorization: 'Bearer valid-x', 'content-type': 'application/json', 'if-match': '1' }, payload: JSON.stringify({ notes: 'x'.repeat(300 * 1024) }) });
    expect(big.statusCode).toBe(413);
  });
});
