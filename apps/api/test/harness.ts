import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { pgAccounts } from '../src/accounts.js';
import { buildApp } from '../src/app.js';
import { fakePhotos, verifyToken } from './fixtures.js';
import { testDb } from './pglite.js';

/** The real app on real Postgres (PGlite, all migrations); only tokens and storage are faked. */
export async function harness() {
  const db = await testDb();
  const storage = fakePhotos();
  const receiptStorage = fakePhotos();
  const app: FastifyInstance = await buildApp({
    verifyToken,
    accounts: pgAccounts(db),
    db,
    photos: storage.photos,
    receipts: receiptStorage.photos,
    logLevel: 'silent',
  });

  /** A new farmer with their own auth user; returns a request helper bound to their token. */
  async function farmer() {
    const authId = randomUUID();
    await db.createAuthUser(authId);
    const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object, headers: Record<string, string> = {}) =>
      app.inject({
        method,
        url,
        payload,
        headers: {
          authorization: `Bearer valid-${authId}`,
          ...(method !== 'GET' && { 'idempotency-key': randomUUID() }),
          ...headers,
        },
      });
    const ownerId = async () => (await call('GET', '/v1/me')).json().id as string;
    return { authId, call, ownerId };
  }

  return { app, db, storage, receiptStorage, farmer };
}
