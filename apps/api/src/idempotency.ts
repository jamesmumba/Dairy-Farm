import { createHash } from 'node:crypto';
import { type Db, type DbClient, inTransaction, isUniqueViolation } from './db.js';
import { HttpError } from './http.js';

export interface StoredResponse {
  status: number;
  body: unknown;
}

const hash = (operation: string, body: unknown) => createHash('sha256').update(operation).update(JSON.stringify(body ?? null)).digest('hex');

async function stored(db: Db | DbClient, ownerId: string, key: string) {
  const { rows } = await db.query<{ request_hash: string; response_status: number; response_body: unknown }>(
    'select request_hash, response_status, response_body from public.idempotency_keys where owner_id = $1 and key = $2',
    [ownerId, key],
  );
  return rows[0];
}

/**
 * Runs a write at most once per (owner, key). The successful response is stored in the same
 * transaction as the write, so a retry after a lost response gets the original answer back.
 * Errors are not stored: nothing was written, and the client may fix the input and send again
 * under a new key.
 */
export async function idempotent(
  db: Db,
  ownerId: string,
  key: string,
  operation: string,
  body: unknown,
  run: (client: DbClient) => Promise<StoredResponse>,
): Promise<StoredResponse> {
  const requestHash = hash(operation, body);
  const replay = (row: Awaited<ReturnType<typeof stored>>) => {
    if (row.request_hash !== requestHash) {
      throw new HttpError(422, 'idempotency_mismatch', 'This Idempotency-Key was already used for a different request.');
    }
    return { status: row.response_status, body: row.response_body };
  };

  try {
    return await inTransaction(db, async (client) => {
      const existing = await stored(client, ownerId, key);
      if (existing) return replay(existing);
      const result = await run(client);
      await client.query(
        `insert into public.idempotency_keys (owner_id, key, operation, request_hash, response_status, response_body)
         values ($1, $2, $3, $4, $5, $6::text::jsonb)`,
        [ownerId, key, operation, requestHash, result.status, JSON.stringify(result.body)],
      );
      return result;
    });
  } catch (err) {
    // A concurrent retry with the same key committed first; our copy of the write rolled back.
    if (isUniqueViolation(err, 'idempotency_keys_pkey')) return replay((await stored(db, ownerId, key))!);
    throw err;
  }
}
