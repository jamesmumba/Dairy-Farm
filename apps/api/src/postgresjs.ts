import type postgres from 'postgres';
import type { Db } from './db.js';

/**
 * The Db interface over postgres.js — the driver used inside Supabase Edge Functions (Deno).
 * Transactions run on a reserved connection, so `begin … commit` from inTransaction() works as
 * with pg.Pool. Values come back as with node-pg: numeric and bigint as strings, timestamps as Date.
 */
export function postgresDb(sql: postgres.Sql): Db {
  const run = (target: postgres.Sql | postgres.ReservedSql) => async (text: string, params: unknown[] = []) => ({
    rows: [...(await target.unsafe(text, params as postgres.ParameterOrJSON<never>[]))] as any[],
  });
  return {
    query: run(sql),
    async connect() {
      const reserved = await sql.reserve();
      return { query: run(reserved), release: () => reserved.release() };
    },
  };
}
