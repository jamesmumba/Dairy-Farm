// A small in-memory stand-in for the API's cattle routes, with the same rules that matter to
// sync: idempotency keys, If-Match versions, unique ear tags, and cursor-based pull.

// Singletons: vi.resetModules() ("app restart") must not create a second ApiError class,
// or the engine's `instanceof` checks would fail.
const g = globalThis as { __errors?: { ApiError: typeof ApiErrorImpl; NetworkError: typeof NetworkErrorImpl } };
class ApiErrorImpl extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public body: Record<string, unknown>,
  ) {
    super(message);
  }
}
class NetworkErrorImpl extends Error {}
g.__errors ??= { ApiError: ApiErrorImpl, NetworkError: NetworkErrorImpl };
export const ApiError = g.__errors.ApiError;
export const NetworkError = g.__errors.NetworkError;

type Row = Record<string, unknown> & { id: string; version: number; ear_tag?: string | null; deleted_at?: string | null; _seq: number };
interface Options {
  method?: string;
  body?: Record<string, unknown>;
  ifMatch?: number;
  idempotencyKey?: string;
}

export function createServer() {
  const rows = new Map<string, Row>();
  const keys = new Map<string, unknown>();
  let seq = 0;
  const server = {
    online: true,
    /** The next write is applied, but its response never reaches the phone. */
    loseNextResponse: false,
    writes: 0,
    rows,
    /** Simulates an edit made on another device. */
    editElsewhere(id: string, patch: Record<string, unknown>) {
      const row = rows.get(id)!;
      rows.set(id, { ...row, ...patch, version: row.version + 1, _seq: ++seq });
    },
    async api<T>(path: string, { method = 'GET', body, ifMatch, idempotencyKey }: Options = {}): Promise<T> {
      if (!server.online) throw new NetworkError('offline');
      if (method !== 'GET' && idempotencyKey && keys.has(idempotencyKey)) return keys.get(idempotencyKey) as T;

      const result = handle(path, method, body, ifMatch);
      if (method !== 'GET') {
        server.writes++;
        if (idempotencyKey) keys.set(idempotencyKey, result);
        if (server.loseNextResponse) {
          server.loseNextResponse = false;
          throw new NetworkError('response lost');
        }
      }
      return result as T;
    },
  };

  const publicRow = ({ _seq, ...row }: Row) => row;

  function current(id: string, ifMatch?: number) {
    const row = rows.get(id);
    if (!row || row.deleted_at) throw new ApiError(404, 'not_found', 'Animal not found.', {});
    if (ifMatch !== row.version) throw new ApiError(409, 'version_conflict', 'Changed elsewhere.', { current: publicRow(row) });
    return row;
  }

  function checkTag(id: string, tag: unknown) {
    if (tag && [...rows.values()].some((r) => r.id !== id && !r.deleted_at && r.ear_tag === tag)) {
      throw new ApiError(409, 'ear_tag_taken', 'Another animal in your herd already has this ear tag.', { field: 'ear_tag' });
    }
  }

  function save(row: Row) {
    rows.set(row.id, { ...row, _seq: ++seq });
    return publicRow(rows.get(row.id)!);
  }

  function handle(path: string, method: string, body: Record<string, unknown> = {}, ifMatch?: number) {
    const url = new URL(path, 'http://api');
    const [, , resource, id, action] = url.pathname.split('/');
    if (url.pathname === '/v1/sync/pull') {
      if (url.searchParams.get('entity') !== 'cattle') return { rows: [], next: null, has_more: false };
      const after = Number(url.searchParams.get('after') ?? 0);
      const changed = [...rows.values()].filter((r) => r._seq > after).sort((a, b) => a._seq - b._seq);
      const last = changed[changed.length - 1];
      return { rows: changed.map(publicRow), next: last ? { after: String(last._seq), after_id: last.id } : null, has_more: false };
    }
    if (resource !== 'cattle') throw new ApiError(404, 'not_found', 'No route', {});
    if (method === 'POST' && !id) {
      checkTag(body.id as string, body.ear_tag);
      return save({ status: 'active', ...body, id: body.id as string, version: 1, deleted_at: null, _seq: 0 });
    }
    const row = current(id, ifMatch);
    if (method === 'PATCH') {
      checkTag(id, body.ear_tag ?? row.ear_tag);
      return save({ ...row, ...body, version: row.version + 1 });
    }
    if (method === 'POST' && action === 'status') return save({ ...row, status: body.status, version: row.version + 1 });
    if (method === 'DELETE') return save({ ...row, deleted_at: new Date().toISOString(), version: row.version + 1 });
    throw new ApiError(404, 'not_found', 'No route', {});
  }

  return server;
}
