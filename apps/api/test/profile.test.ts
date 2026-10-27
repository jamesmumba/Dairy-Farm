import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { Accounts, FarmerAccount } from '../src/accounts.js';
import { account, fakePhotos, noDb, verifyToken } from './fixtures.js';

// In-memory accounts with the same version rule as the SQL implementation.
function memoryAccounts() {
  const rows = new Map<string, FarmerAccount>();
  const deletionReasons: (string | null)[] = [];
  const accounts: Accounts = {
    async getOrCreate(authUserId) {
      if (!rows.has(authUserId)) rows.set(authUserId, account(`owner-of-${authUserId}`));
      return rows.get(authUserId)!;
    },
    async update(acc, actor, expectedVersion, patch) {
      const current = rows.get(actor)!;
      if (current.version !== expectedVersion) return { ok: false, current };
      const { onboarding_completed, ...fields } = patch;
      const next = { ...current, ...fields, version: current.version + 1 } as FarmerAccount;
      if (onboarding_completed) next.onboarding_completed_at = '2026-10-27T00:00:00Z';
      rows.set(actor, next);
      return { ok: true, account: next };
    },
    async requestDeletion(acc, actor, reason) {
      deletionReasons.push(reason);
      const next = { ...rows.get(actor)!, deletion_requested_at: '2026-10-27T00:00:00Z' };
      rows.set(actor, next);
      return next;
    },
  };
  return { accounts, deletionReasons };
}

let store: ReturnType<typeof memoryAccounts>;
beforeEach(() => {
  store = memoryAccounts();
});

const auth = { authorization: 'Bearer valid-farmer-a' };

async function patch(body: unknown, version: string | null = '1') {
  const app = await buildApp({ verifyToken, accounts: store.accounts, db: noDb, photos: fakePhotos().photos, receipts: fakePhotos().photos, logLevel: 'silent' });
  return app.inject({
    method: 'PATCH',
    url: '/v1/me',
    headers: version === null ? auth : { ...auth, 'if-match': version },
    payload: body as object,
  });
}

describe('PATCH /v1/me', () => {
  it('requires If-Match', async () => {
    const res = await patch({ display_name: 'Mwila' }, null);
    expect(res.statusCode).toBe(428);
  });

  it('updates the profile and bumps the version', async () => {
    const res = await patch({ display_name: '  Mwila Banda ', farm_name: 'Chisamba Dairy', currency: 'USD' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ display_name: 'Mwila Banda', farm_name: 'Chisamba Dairy', currency: 'USD', version: 2 });
  });

  it('returns 409 with the current server row on a stale version', async () => {
    await patch({ display_name: 'First' });
    const res = await patch({ display_name: 'Second' }, '1');
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('version_conflict');
    expect(res.json().current).toMatchObject({ display_name: 'First', version: 2 });
  });

  it.each([
    [{ currency: 'EUR' }, 'currency'],
    [{ time_zone: 'Mars/Olympus' }, 'time_zone'],
    [{ phone: 'call me' }, 'phone'],
    [{ display_name: '   ' }, 'display_name'],
    [{ notification_prefs: { reminder_time: '25:00' } }, 'notification_prefs.reminder_time'],
    [{ owner_id: 'someone-else' }, ''],
  ])('rejects invalid input %j', async (body, field) => {
    const res = await patch(body);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('validation_failed');
    expect(res.json().field).toBe(field);
  });

  it('needs a phone number before phone can be the preferred contact', async () => {
    expect((await patch({ preferred_contact: 'phone' })).statusCode).toBe(400);
    const ok = await patch({ preferred_contact: 'phone', phone: '+260 97 123 4567' });
    expect(ok.statusCode).toBe(200);
  });

  it('turns empty optional text into null', async () => {
    const res = await patch({ farm_name: '' });
    expect(res.json().farm_name).toBeNull();
  });

  it('marks onboarding complete', async () => {
    const res = await patch({ onboarding_step: null, onboarding_completed: true });
    expect(res.json().onboarding_completed_at).not.toBeNull();
  });
});

describe('POST /v1/me/deletion-request', () => {
  it('records the request with an optional reason', async () => {
    const app = await buildApp({ verifyToken, accounts: store.accounts, db: noDb, photos: fakePhotos().photos, receipts: fakePhotos().photos, logLevel: 'silent' });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/me/deletion-request',
      headers: auth,
      payload: { reason: 'Selling the farm' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().deletion_requested_at).not.toBeNull();
    expect(store.deletionReasons).toEqual(['Selling the farm']);
  });
});
