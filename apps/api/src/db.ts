import { AsyncLocalStorage } from 'node:async_hooks';

// Minimal database interface. pg.Pool satisfies it; tests use an in-process PGlite adapter.
export interface DbClient {
  query<T = any>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
  release(): void;
}

/** Anything that can run a query: a pool or a transaction client. */
export type Queryable = Pick<DbClient, 'query'>;

export interface Db {
  query<T = any>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
  connect(): Promise<DbClient>;
}

export async function inTransaction<T>(db: Db, fn: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

export interface AuditEntry {
  ownerId: string;
  actorUserId: string;
  action: string;
  entityTable: string;
  entityId: string;
  reason?: string | null;
  before?: unknown;
  after?: unknown;
}

/** The phone behind the request being handled (set by the API's auth middleware), for the audit trail. */
export const requestDevice = new AsyncLocalStorage<{ deviceId: string | null }>();

/** JSON values are sent as text and cast in SQL (`::text::jsonb`), so every driver stores them the same way. */
export async function audit(client: DbClient, e: AuditEntry) {
  await client.query(
    `insert into public.audit_logs (owner_id, actor_user_id, action, entity_table, entity_id, reason, before_data, after_data, device_id)
     values ($1, $2, $3, $4, $5, $6, $7::text::jsonb, $8::text::jsonb, $9)`,
    [
      e.ownerId,
      e.actorUserId,
      e.action,
      e.entityTable,
      e.entityId,
      e.reason ?? null,
      e.before === undefined ? null : JSON.stringify(e.before),
      e.after === undefined ? null : JSON.stringify(e.after),
      requestDevice.getStore()?.deviceId ?? null,
    ],
  );
}

/** Postgres error code for unique_violation. */
export const UNIQUE_VIOLATION = '23505';

export function isUniqueViolation(err: unknown, constraint?: string) {
  const e = err as { code?: string; constraint?: string; message?: string };
  if (e?.code !== UNIQUE_VIOLATION) return false;
  return !constraint || e.constraint === constraint || !!e.message?.includes(constraint);
}
