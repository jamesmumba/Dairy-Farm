import { audit, type Db, inTransaction } from './db.js';
import type { ProfilePatch } from './profile.js';

export interface FarmerAccount {
  id: string;
  display_name: string | null;
  preferred_contact: string | null;
  phone: string | null;
  farm_name: string | null;
  farm_location: string | null;
  time_zone: string;
  currency: string;
  volume_unit: string;
  weight_unit: string;
  language: string;
  date_format: string;
  notification_prefs: Record<string, unknown>;
  decline_rule: Record<string, number>;
  breeding_intervals: { pregnancy_check_days: number; gestation_days: number };
  onboarding_step: string | null;
  onboarding_completed_at: string | null;
  deletion_requested_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export type UpdateResult = { ok: true; account: FarmerAccount } | { ok: false; current: FarmerAccount };

export interface Accounts {
  /** Returns the farmer account for an auth user, creating it on first sign-in. */
  getOrCreate(authUserId: string): Promise<FarmerAccount>;
  /** Applies a profile patch if `expectedVersion` still matches; audits changed fields. */
  update(account: FarmerAccount, actorUserId: string, expectedVersion: number, patch: ProfilePatch): Promise<UpdateResult>;
  /** Records an account deletion request (processed by the documented deletion procedure). */
  requestDeletion(account: FarmerAccount, actorUserId: string, reason: string | null): Promise<FarmerAccount>;
}

// Starting breed list; the farmer can rename, deactivate or add breeds later.
const DEFAULT_BREEDS = ['Friesian', 'Jersey', 'Ayrshire', 'Guernsey', 'Boran', 'Tonga', 'Crossbreed'];

const COLUMNS = `id, display_name, preferred_contact, phone, farm_name, farm_location, time_zone,
  currency, volume_unit, weight_unit, language, date_format, notification_prefs, decline_rule, breeding_intervals, onboarding_step,
  onboarding_completed_at, deletion_requested_at, version, created_at, updated_at`;

export function pgAccounts(pool: Db): Accounts {
  return {
    async getOrCreate(authUserId) {
      const found = await pool.query<FarmerAccount>(
        `select ${COLUMNS} from public.farmer_accounts where auth_user_id = $1`,
        [authUserId],
      );
      if (found.rows[0]) return found.rows[0];

      const account = await inTransaction(pool, async (client) => {
        // do nothing on conflict: a racing first request already created it (and its breeds).
        const created = await client.query<FarmerAccount>(
          `insert into public.farmer_accounts (auth_user_id) values ($1)
           on conflict (auth_user_id) do nothing returning ${COLUMNS}`,
          [authUserId],
        );
        const row = created.rows[0];
        if (row) {
          await client.query(
            `insert into public.cattle_breeds (owner_id, name) select $1, unnest($2::text[])`,
            [row.id, DEFAULT_BREEDS],
          );
          await audit(client, { ownerId: row.id, actorUserId: authUserId, action: 'account.created', entityTable: 'farmer_accounts', entityId: row.id });
        }
        return row;
      });
      if (account) return account;
      const raced = await pool.query<FarmerAccount>(
        `select ${COLUMNS} from public.farmer_accounts where auth_user_id = $1`,
        [authUserId],
      );
      return raced.rows[0];
    },

    async update(account, actorUserId, expectedVersion, patch) {
      return inTransaction(pool, async (client) => {
        const locked = await client.query<FarmerAccount>(
          `select ${COLUMNS} from public.farmer_accounts where id = $1 for update`,
          [account.id],
        );
        const current = locked.rows[0];
        if (current.version !== expectedVersion) return { ok: false, current };

        const { onboarding_completed, ...fields } = patch;
        const changes: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(fields)) {
          if (value === undefined) continue;
          const old = current[key as keyof FarmerAccount];
          if (JSON.stringify(old) !== JSON.stringify(value)) changes[key] = value;
        }
        const completing = onboarding_completed && !current.onboarding_completed_at;
        if (Object.keys(changes).length === 0 && !completing) return { ok: true, account: current };

        // Column names come from the strict zod schema keys, never from raw input.
        // JSON goes in as text and is parsed once by Postgres (drivers differ in how they
        // encode a string sent to a jsonb parameter).
        const sets = Object.entries(changes).map(([key, v], i) => `${key} = $${i + 2}${typeof v === 'object' && v !== null ? '::text::jsonb' : ''}`);
        if (completing) sets.push('onboarding_completed_at = now()');
        const values = Object.values(changes).map((v) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : v));
        const updated = await client.query<FarmerAccount>(
          `update public.farmer_accounts set ${sets.join(', ')} where id = $1 returning ${COLUMNS}`,
          [account.id, ...values],
        );

        const before = Object.fromEntries(Object.keys(changes).map((k) => [k, current[k as keyof FarmerAccount]]));
        if (completing) changes.onboarding_completed_at = updated.rows[0].onboarding_completed_at;
        await audit(client, {
          ownerId: account.id,
          actorUserId,
          action: 'account.settings_updated',
          entityTable: 'farmer_accounts',
          entityId: account.id,
          before,
          after: changes,
        });
        return { ok: true, account: updated.rows[0] };
      });
    },

    async requestDeletion(account, actorUserId, reason) {
      return inTransaction(pool, async (client) => {
        const updated = await client.query<FarmerAccount>(
          `update public.farmer_accounts set deletion_requested_at = coalesce(deletion_requested_at, now())
           where id = $1 returning ${COLUMNS}`,
          [account.id],
        );
        await audit(client, {
          ownerId: account.id,
          actorUserId,
          action: 'account.deletion_requested',
          entityTable: 'farmer_accounts',
          entityId: account.id,
          reason,
        });
        return updated.rows[0];
      });
    },
  };
}
