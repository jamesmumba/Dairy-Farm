import { beforeAll, describe, expect, it } from 'vitest';
import { harness } from './harness.js';

let h: Awaited<ReturnType<typeof harness>>;
beforeAll(async () => {
  h = await harness();
});

// The real account repository on the real database (both drivers: npm test and npm run test:postgres).
describe('account settings in the database', () => {
  it('stores JSON settings as objects, bumps the version and audits the change', async () => {
    const f = await h.farmer();
    const me = (await f.call('GET', '/v1/me')).json();
    expect(me).toMatchObject({ version: 1, decline_rule: { recent_days: 7 }, breeding_intervals: { gestation_days: 283 } });

    const prefs = { reminder_time: '05:30', vaccinations: true, breeding: false, health: true, withdrawal: true, finance: false, sync_problems: true };
    const res = await f.call(
      'PATCH',
      '/v1/me',
      { display_name: 'Mwila', notification_prefs: prefs, decline_rule: { recent_days: 3, baseline_days: 14, threshold_pct: 15, min_days: 3 } },
      { 'if-match': '1' },
    );
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ display_name: 'Mwila', notification_prefs: prefs, decline_rule: { recent_days: 3 }, version: 2 });
    expect((await f.call('GET', '/v1/me')).json().notification_prefs).toEqual(prefs);

    const { rows } = await h.db.query(`select after_data from public.audit_logs where owner_id = $1 and action = 'account.settings_updated'`, [me.id]);
    expect(rows[0].after_data).toMatchObject({ display_name: 'Mwila', notification_prefs: { reminder_time: '05:30' } });
  });

  it('creates the account and default breeds once, on first request', async () => {
    const f = await h.farmer();
    await Promise.all([f.call('GET', '/v1/me'), f.call('GET', '/v1/breeds')]);
    const breeds = (await f.call('GET', '/v1/breeds')).json();
    expect(breeds.map((b: { name: string }) => b.name)).toContain('Friesian');
    expect(new Set(breeds.map((b: { name: string }) => b.name)).size).toBe(breeds.length);
  });
});
