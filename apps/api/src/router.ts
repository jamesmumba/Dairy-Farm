import type { Context, Hono } from 'hono';
import type { FarmerAccount } from './accounts.js';

// A small request/reply shape for route handlers, independent of the web framework. It runs
// on Hono, which serves both Node (local dev, tests) and Supabase Edge Functions (Deno).

export interface Farmer {
  authUserId: string;
  account: FarmerAccount;
}

export type ApiEnv = { Variables: { farmer: Farmer } };

export interface Req {
  headers: Record<string, string | undefined>; // lower-case names
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  /** Set by the auth middleware on every /v1 route. The only source of owner_id. */
  farmer: Farmer;
  log: { error(...args: unknown[]): void; warn(...args: unknown[]): void };
}

const SENT = Symbol('sent');
type Sent = { [SENT]: true; status: number; body: unknown };

export interface Reply {
  status(code: number): { send(body: unknown): Sent };
}

export type Handler = (req: Req, reply: Reply) => unknown;

export interface Router {
  get(path: string, handler: Handler): void;
  post(path: string, handler: Handler): void;
  patch(path: string, handler: Handler): void;
  delete(path: string, handler: Handler): void;
}

const reply: Reply = { status: (status) => ({ send: (body) => ({ [SENT]: true, status, body }) }) };
const log = { error: (...a: unknown[]) => console.error(...a), warn: (...a: unknown[]) => console.warn(...a) };

/** Bad JSON in a request body: answered as 400 by the app's error handler. */
export class BadJson extends Error {}

async function toReq(c: Context<ApiEnv>): Promise<Req> {
  let body: unknown;
  if (c.req.method !== 'GET' && c.req.header('content-type')?.includes('application/json')) {
    const text = await c.req.text();
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        throw new BadJson('The request body is not valid JSON.');
      }
    }
  }
  return {
    headers: Object.fromEntries([...c.req.raw.headers].map(([k, v]) => [k.toLowerCase(), v])),
    params: c.req.param() as Record<string, string>,
    query: c.req.query(),
    body,
    farmer: c.get('farmer'),
    log,
  };
}

export function router(app: Hono<ApiEnv>): Router {
  const add = (method: 'get' | 'post' | 'patch' | 'delete') => (path: string, handler: Handler) => {
    app[method](path, async (c) => {
      const result = await handler(await toReq(c), reply);
      if (result && typeof result === 'object' && SENT in result) {
        const sent = result as Sent;
        return c.json(sent.body as object, sent.status as 200);
      }
      return c.json(result as object);
    });
  };
  return { get: add('get'), post: add('post'), patch: add('patch'), delete: add('delete') };
}
